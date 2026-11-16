import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ort from "onnxruntime-web";
import { Tokenizer } from "@huggingface/tokenizers";
import loadLocalEnv from "./load-local-env.cjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
loadLocalEnv(rootDir);
const rawRoot =
  process.env.LOCAL_MODEL_RAW_ROOT?.trim() || "";
const wasmRoot =
  process.env.LOCAL_ONNX_WASM_ROOT?.trim() || "";
if (!rawRoot) {
  throw new Error("LOCAL_MODEL_RAW_ROOT is not set");
}
if (!wasmRoot) {
  throw new Error("LOCAL_ONNX_WASM_ROOT is not set");
}
const outputDir =
  process.env.LOCAL_MODEL_EVAL_OUTPUT_DIR?.trim() ||
  path.join(rootDir, "reports", "model-packs", "eval");
const outputPath = path.join(outputDir, "local-model-runtime-eval.json");

ort.env.wasm.wasmPaths = `${pathToFileURL(wasmRoot).href}/`;
ort.env.wasm.numThreads = 1;

const loadJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, "utf8"));

const loadTokenizer = async (modelDir) => {
  const tokenizerJson = await loadJson(path.join(modelDir, "tokenizer.json"));
  const tokenizerConfig = await loadJson(
    path.join(modelDir, "tokenizer_config.json"),
  );
  return new Tokenizer(tokenizerJson, tokenizerConfig);
};

const createSession = async (modelDir) =>
  ort.InferenceSession.create(path.join(modelDir, "onnx", "model_quantized.onnx"), {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });

const toBigIntTensor = (values, shape) =>
  new ort.Tensor("int64", BigInt64Array.from(values.map(BigInt)), shape);

const toNumberArray = (value) =>
  ArrayBuffer.isView(value) ? Array.from(value) : Array.isArray(value) ? value : [];

const resolveOutput = (outputs, preferredNames) => {
  for (const name of preferredNames) {
    if (outputs[name]) {
      return outputs[name];
    }
  }
  return Object.values(outputs)[0];
};

const normalize = (vector) => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
};

const meanPool = (lastHiddenState, attentionMask, shape) => {
  const [, sequenceLength, hiddenSize] = shape;
  const values = Array.from(lastHiddenState);
  const output = new Array(hiddenSize).fill(0);
  let activeTokens = 0;

  for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex += 1) {
    if (!attentionMask[tokenIndex]) {
      continue;
    }
    activeTokens += 1;
    const offset = tokenIndex * hiddenSize;
    for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
      output[hiddenIndex] += values[offset + hiddenIndex] ?? 0;
    }
  }

  const divisor = Math.max(activeTokens, 1);
  return output.map((value) => value / divisor);
};

let embeddingRuntimePromise = null;
let rerankRuntimePromise = null;

const getEmbeddingRuntime = async () => {
  embeddingRuntimePromise ??= (async () => {
    const modelDir = path.join(rawRoot, "embedding", "multilingual-e5-small");
    const [tokenizer, session] = await Promise.all([
      loadTokenizer(modelDir),
      createSession(modelDir),
    ]);
    return { tokenizer, session };
  })();
  return embeddingRuntimePromise;
};

const getRerankRuntime = async () => {
  rerankRuntimePromise ??= (async () => {
    const modelDir = path.join(rawRoot, "rerank", "ms-marco-MiniLM-L-6-v2");
    const [tokenizer, session] = await Promise.all([
      loadTokenizer(modelDir),
      createSession(modelDir),
    ]);
    return { tokenizer, session };
  })();
  return rerankRuntimePromise;
};

const embedTexts = async (texts) => {
  const runtime = await getEmbeddingRuntime();
  const embeddings = [];
  for (const text of texts) {
    const encoded = runtime.tokenizer.encode(`query: ${text}`);
    const ids = toNumberArray(encoded.ids);
    const attentionMask = toNumberArray(encoded.attention_mask);
    const tokenTypeIds = encoded.type_ids
      ? toNumberArray(encoded.type_ids)
      : new Array(ids.length).fill(0);
    const outputs = await runtime.session.run({
      input_ids: toBigIntTensor(ids, [1, ids.length]),
      attention_mask: toBigIntTensor(attentionMask, [1, ids.length]),
      token_type_ids: toBigIntTensor(tokenTypeIds, [1, ids.length]),
    });
    const output = resolveOutput(outputs, ["last_hidden_state"]);
    embeddings.push(normalize(meanPool(output.data, attentionMask, output.dims)));
  }
  return { embeddings };
};

const sigmoid = (value) => 1 / (1 + Math.exp(-value));

const rerankCandidates = async ({ query, candidates, topN }) => {
  const runtime = await getRerankRuntime();
  const scored = [];
  for (const candidate of candidates) {
    const encoded = runtime.tokenizer.encode(query, {
      text_pair: candidate.text,
      return_token_type_ids: true,
    });
    const ids = toNumberArray(encoded.ids);
    const attentionMask = toNumberArray(encoded.attention_mask);
    const tokenTypeIds = encoded.type_ids
      ? toNumberArray(encoded.type_ids)
      : new Array(ids.length).fill(0);
    const outputs = await runtime.session.run({
      input_ids: toBigIntTensor(ids, [1, ids.length]),
      attention_mask: toBigIntTensor(attentionMask, [1, ids.length]),
      token_type_ids: toBigIntTensor(tokenTypeIds, [1, ids.length]),
    });
    const logits = resolveOutput(outputs, ["logits"]);
    const score = Number(logits.data[0] ?? 0);
    scored.push({
      ...candidate,
      score,
      probability: sigmoid(score),
    });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN ?? scored.length)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
};

const cosineSimilarity = (left, right) => {
  if (!left.length || left.length !== right.length) {
    return -1;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return dot / Math.max(Math.sqrt(leftNorm) * Math.sqrt(rightNorm), 1e-9);
};

const evaluateEmbeddingClassification = async (suite) => {
  const texts = [
    suite.query,
    ...suite.candidates.map((candidate) => candidate.text),
  ];
  const result = await embedTexts(texts);
  const [queryEmbedding, ...candidateEmbeddings] = result.embeddings;
  const ranked = suite.candidates
    .map((candidate, index) => ({
      ...candidate,
      score: cosineSimilarity(queryEmbedding ?? [], candidateEmbeddings[index] ?? []),
    }))
    .sort((a, b) => b.score - a.score);

  return {
    id: suite.id,
    type: suite.type,
    query: suite.query,
    expectedTopId: suite.expectedTopId,
    actualTopId: ranked[0]?.id ?? null,
    passed: ranked[0]?.id === suite.expectedTopId,
    ranked: ranked.map((item, index) => ({
      rank: index + 1,
      id: item.id,
      label: item.label,
      score: Number(item.score.toFixed(6)),
      expected: item.id === suite.expectedTopId,
    })),
  };
};

const evaluateRerank = async (suite) => {
  const result = await rerankCandidates({
    query: suite.query,
    candidates: suite.candidates.map((candidate) => ({
      id: candidate.id,
      text: candidate.text,
      metadata: {
        label: candidate.label,
      },
    })),
    topN: suite.candidates.length,
  });

  return {
    id: suite.id,
    type: suite.type,
    query: suite.query,
    expectedTopId: suite.expectedTopId,
    actualTopId: result[0]?.id ?? null,
    passed: result[0]?.id === suite.expectedTopId,
    ranked: result.map((item) => ({
      rank: item.rank,
      id: item.id,
      label: item.metadata?.label,
      score: Number(item.score.toFixed(6)),
      probability: Number(item.probability.toFixed(8)),
      expected: item.id === suite.expectedTopId,
    })),
  };
};

const suites = [
  {
    id: "tool-intent-terminal",
    type: "工具意图识别",
    query: "帮我在项目里查找所有调用 providerProxyService 的地方",
    expectedTopId: "tool-search-code",
    candidates: [
      {
        id: "tool-search-code",
        label: "代码搜索工具",
        text: "在本地工作区使用 rg 搜索文件、函数、类型、接口和调用点，适合定位代码实现。",
      },
      {
        id: "tool-send-message",
        label: "发送通知工具",
        text: "向企业微信或外部系统发送消息通知，适合提醒用户任务状态。",
      },
      {
        id: "tool-read-doc",
        label: "文档阅读工具",
        text: "读取 Word、PDF、Markdown 文档内容并提取摘要。",
      },
    ],
  },
  {
    id: "tool-intent-notify",
    type: "工具意图识别",
    query: "把构建失败的结果发到企业微信机器人",
    expectedTopId: "tool-wecom-notify",
    candidates: [
      {
        id: "tool-code-edit",
        label: "代码编辑工具",
        text: "修改项目源代码、补丁和测试文件。",
      },
      {
        id: "tool-wecom-notify",
        label: "企业微信通知工具",
        text: "调用企业微信机器人或应用消息接口发送构建结果、报警和任务通知。",
      },
      {
        id: "tool-doc-index",
        label: "文档索引工具",
        text: "扫描知识库文档并生成索引。",
      },
    ],
  },
  {
    id: "document-type-contract",
    type: "文档识别",
    query: "这份文档描述接口字段、请求路径和响应结构，应该归到哪里？",
    expectedTopId: "doc-api-contract",
    candidates: [
      {
        id: "doc-api-contract",
        label: "API 契约文档",
        text: "记录后端路由、请求参数、响应 envelope、错误码和接口兼容规则。",
      },
      {
        id: "doc-product-roadmap",
        label: "产品路线文档",
        text: "记录产品优先级、阶段目标、用户价值和发布计划。",
      },
      {
        id: "doc-incident",
        label: "故障复盘文档",
        text: "记录线上事故时间线、影响范围、根因和修复行动。",
      },
    ],
  },
  {
    id: "document-type-runtime",
    type: "文档识别",
    query: "这篇说明 Electron、backend 进程和 preload 边界",
    expectedTopId: "doc-runtime-architecture",
    candidates: [
      {
        id: "doc-runtime-architecture",
        label: "运行时架构文档",
        text: "说明桌面壳层、React renderer、Fastify backend、preload、IPC 和打包进程边界。",
      },
      {
        id: "doc-role-design",
        label: "角色系统文档",
        text: "说明 persona、角色提示词、头像和角色绑定规则。",
      },
      {
        id: "doc-evaluation",
        label: "评测工作台文档",
        text: "说明数据集、评测指标、运行记录和评分报告。",
      },
    ],
  },
  {
    id: "rag-context-budget",
    type: "RAG 识别",
    query: "context 爆炸时应该优先裁剪历史还是当前用户问题？",
    expectedTopId: "rag-context-budget",
    candidates: [
      {
        id: "rag-context-budget",
        label: "上下文预算协议",
        text: "context budget 会保留 latestUserMessage 和核心 instruction，优先裁剪长 history 与超长 payload。",
      },
      {
        id: "rag-model-provider",
        label: "模型服务商配置",
        text: "provider 配置包含 baseUrl、apiKey、模型 id、连接状态和默认角色绑定。",
      },
      {
        id: "rag-ui-theme",
        label: "前端主题样式",
        text: "主题系统负责颜色、布局密度、按钮样式和侧边栏导航。",
      },
    ],
  },
  {
    id: "rag-packaging-models",
    type: "RAG 识别",
    query: "默认安装包应该内置 reranker 吗？",
    expectedTopId: "rag-model-packaging",
    candidates: [
      {
        id: "rag-model-packaging",
        label: "本地模型包策略",
        text: "默认内置 multilingual-e5-small embedding，reranker 作为高级检索质量开关按需下载。",
      },
      {
        id: "rag-thread-memory",
        label: "线程记忆",
        text: "线程摘要和长期记忆会作为 request-only system messages 注入模型调用。",
      },
      {
        id: "rag-vector-db",
        label: "向量数据库",
        text: "知识库向量索引存储 chunk embedding，检索时按维度和模型配置校验。",
      },
    ],
  },
];

const rerankSuites = [
  {
    id: "rerank-english-control",
    type: "Rerank 英文对照",
    query: "How does context budget prevent long chat context overflow?",
    expectedTopId: "budget",
    candidates: [
      {
        id: "budget",
        label: "上下文预算",
        text: "Token auditing and dynamic trimming keep the latest user message, core instructions, and recent history within the model context window.",
      },
      {
        id: "packaging",
        label: "桌面打包",
        text: "Electron packaging configures application icons, installer output directories, and native resource copying.",
      },
    ],
  },
  {
    id: "rerank-chinese-probe",
    type: "Rerank 中文探针",
    query: "context budget 如何避免长对话爆炸？",
    expectedTopId: "budget",
    candidates: [
      {
        id: "budget",
        label: "上下文预算",
        text: "通过 token 审计和动态裁剪，可以优先保留当前用户问题、系统指令和最近历史。",
      },
      {
        id: "packaging",
        label: "桌面打包",
        text: "Electron 打包时要处理图标、窗口大小和安装器配置。",
      },
    ],
  },
];

const main = async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const embeddingResults = [];
  for (const suite of suites) {
    embeddingResults.push(await evaluateEmbeddingClassification(suite));
  }
  const rerankResults = [];
  for (const suite of rerankSuites) {
    rerankResults.push(await evaluateRerank(suite));
  }
  const result = {
    generatedAt: new Date().toISOString(),
    startedAt,
    models: {
      embedding: "Xenova/multilingual-e5-small",
      rerank: "Xenova/ms-marco-MiniLM-L-6-v2",
      runtime: "onnxruntime-web/wasm",
    },
    summary: {
      embeddingPassed: embeddingResults.filter((item) => item.passed).length,
      embeddingTotal: embeddingResults.length,
      rerankPassed: rerankResults.filter((item) => item.passed).length,
      rerankTotal: rerankResults.length,
    },
    embeddingResults,
    rerankResults,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result.summary, null, 2));
  console.log(`Wrote ${outputPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
