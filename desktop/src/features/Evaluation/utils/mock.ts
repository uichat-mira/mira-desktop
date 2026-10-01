import type {
  EvaluationLogEntry,
  EvaluationMetricSummary,
  EvaluationRunRecord,
  EvaluationSampleResult,
  ParsedDataset,
  ParsedDatasetDocument,
  ParsedDatasetSample,
  ParsedDatasetValidationItem,
} from "./types";

const sampleQuestionPool = [
  {
    question: "客户觉得报价高于竞品时，该如何说明我们的优势？",
    expectedAnswer:
      "先确认预算顾虑，再回到交付价值、售后承诺与成功案例，避免直接陷入价格拉扯。",
    tags: ["异议处理", "高价解释"],
  },
  {
    question: "客户担心签约后落地支持不足，话术应该怎么组织？",
    expectedAnswer:
      "先给出服务边界，再引用实施陪跑机制和历史交付案例，帮助客户建立可预期性。",
    tags: ["服务承诺", "签约前顾虑"],
  },
  {
    question: "客户要求折扣时，销售是否可以口头承诺额外赠送服务？",
    expectedAnswer:
      "需要先引用规章确认权限，再决定是否可以承诺，不能直接越权口头让利。",
    tags: ["规章", "权限"],
  },
  {
    question: "客户来自制造业，想看类似成交案例，应该优先引用哪类资料？",
    expectedAnswer:
      "优先引用同业或相近流程复杂度的案例，再补充实施和复购结果。",
    tags: ["案例", "行业匹配"],
  },
  {
    question: "客户说内部还要再讨论，如何推进下一步而不显得逼单？",
    expectedAnswer:
      "先确认决策链条和阻碍点，再以共创行动项推动下一次沟通，而不是单纯催促成交。",
    tags: ["推进成交", "跟进"],
  },
];

const documentPool: Array<Omit<ParsedDatasetDocument, "id">> = [
  { name: "销售话术_价值呈现.md", type: "话术", sizeLabel: "18 KB" },
  { name: "销售话术_异议处理.md", type: "话术", sizeLabel: "22 KB" },
  { name: "成交案例_制造业升级.md", type: "案例", sizeLabel: "31 KB" },
  { name: "成交案例_渠道拓展.md", type: "案例", sizeLabel: "27 KB" },
  { name: "销售管理规范_报价审批.md", type: "规章", sizeLabel: "14 KB" },
  { name: "销售管理规范_折扣权限.md", type: "规章", sizeLabel: "16 KB" },
];

const nowIso = () => new Date().toISOString();

const hashString = (value: string) =>
  Array.from(value).reduce((acc, char) => acc + char.charCodeAt(0), 0);

const createSeededRandom = (seed: number) => {
  let value = seed % 2147483647;
  if (value <= 0) {
    value += 2147483646;
  }

  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const createDatasetDocuments = (random: () => number, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const base = documentPool[index % documentPool.length]!;
    return {
      id: `doc-${index + 1}`,
      ...base,
    };
  });

const createPreviewSamples = (
  random: () => number,
  documents: ParsedDatasetDocument[],
  count: number,
): ParsedDatasetSample[] =>
  Array.from({ length: count }, (_, index) => {
    const base = sampleQuestionPool[index % sampleQuestionPool.length]!;
    const firstDoc = documents[Math.floor(random() * documents.length)]!;
    const secondDoc = documents[Math.floor(random() * documents.length)]!;

    return {
      id: `sample-${String(index + 1).padStart(3, "0")}`,
      question: base.question,
      expectedAnswer: base.expectedAnswer,
      goldSources: Array.from(new Set([firstDoc.name, secondDoc.name])),
      tags: base.tags,
    };
  });

const createValidations = (sampleCount: number): ParsedDatasetValidationItem[] => [
  {
    id: "structure",
    label: "评测包结构完整",
    status: "pass",
    detail: "已识别 manifest、documents 和 evalset 清单。",
  },
  {
    id: "reference",
    label: "参考答案字段齐全",
    status: "pass",
    detail: `检测到 ${sampleCount} 条样本均包含 reference answer。`,
  },
  {
    id: "sources",
    label: "gold sources 可用于检索评测",
    status: "pass",
    detail: `检测到 ${sampleCount - 2} 条样本包含 gold sources。`,
  },
  {
    id: "note",
    label: "样本标签覆盖多种销售场景",
    status: "warning",
    detail: "建议后续补充“无答案问题”和“多文档混合引用”场景。",
  },
];

export const parseEvaluationZipMock = async (file: File): Promise<ParsedDataset> => {
  await new Promise((resolve) => window.setTimeout(resolve, 600));

  const seed = hashString(`${file.name}:${file.size}`);
  const random = createSeededRandom(seed);
  const documentCount = 8 + Math.floor(random() * 6);
  const sampleCount = 48 + Math.floor(random() * 60);
  const topK = 8 + Math.floor(random() * 5);
  const topN = 3 + Math.floor(random() * 3);
  const repeat = 2 + Math.floor(random() * 3);
  const documents = createDatasetDocuments(random, documentCount);
  const previewSamples = createPreviewSamples(random, documents, Math.min(4, sampleCount));
  const datasetName = file.name.replace(/\.zip$/i, "") || "sales-eval-pack";

  return {
    id: `dataset-${seed}`,
    datasetName,
    fileName: file.name,
    fileSize: file.size,
    uploadedAt: nowIso(),
    summary: {
      documentCount,
      sampleCount,
      hasReferenceAnswers: true,
      hasGoldSources: true,
    },
    config: {
      mode: random() > 0.45 ? "retrieve-generate" : "retrieve",
      topK,
      topN,
      repeat,
      concurrency: 2,
      timeoutSeconds: 30,
    },
    documents,
    previewSamples,
    validations: createValidations(sampleCount),
  };
};

const formatClock = (date: Date) =>
  date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const createRunLogs = (dataset: ParsedDataset): EvaluationLogEntry[] => {
  const baseTime = new Date();
  const entries = [
    ["info", `开始读取评测包 ${dataset.fileName}`],
    ["success", `数据集解析完成，发现 ${dataset.summary.sampleCount} 条样本`],
    ["info", `加载运行参数：mode=${dataset.config.mode} topK=${dataset.config.topK} topN=${dataset.config.topN}`],
    ["info", `开始执行第 1/${dataset.summary.sampleCount} 条样本`],
    ["info", "检索阶段完成，准备进入答案评估"],
    ["success", "批量评测完成，结果已汇总"],
  ] as const;

  return entries.map(([level, text], index) => ({
    id: `log-${index + 1}`,
    timestamp: formatClock(new Date(baseTime.getTime() + index * 1200)),
    level,
    text,
  }));
};

const createSampleResults = (dataset: ParsedDataset): EvaluationSampleResult[] => {
  const seed = hashString(dataset.id);
  const random = createSeededRandom(seed + dataset.summary.sampleCount);
  const total = Math.min(12, dataset.summary.sampleCount);

  return Array.from({ length: total }, (_, index) => {
    const preview = dataset.previewSamples[index % dataset.previewSamples.length]!;
    const success = random() > 0.12;
    const hit = random() > 0.18;
    const sourceHit = random() > 0.2;
    const latencyMs = 2800 + Math.round(random() * 3200);
    const faithfulness = 0.68 + random() * 0.28;
    const answerRelevance = 0.62 + random() * 0.3;
    const answerCompleteness = 0.58 + random() * 0.32;
    const goldSources = preview.goldSources;
    const matchedGoldSources =
      hit && sourceHit ? goldSources.slice(0, Math.max(1, Math.min(goldSources.length, 2))) : [];
    const retrievedSources = goldSources.map((documentName, sourceIndex) => ({
      documentName,
      chunkId: sourceIndex + 1,
      score: Number((0.72 + random() * 0.24).toFixed(3)),
      contentPreview: `${documentName} 命中了与问题“${preview.question.slice(0, 18)}”相关的片段摘要。`,
    }));
    const fallbackSource = dataset.documents[(index + 1) % dataset.documents.length];
    if (!sourceHit && fallbackSource) {
      retrievedSources.push({
        documentName: fallbackSource.name,
        chunkId: retrievedSources.length + 1,
        score: Number((0.41 + random() * 0.18).toFixed(3)),
        contentPreview: `${fallbackSource.name} 被检索到，但与标准来源不完全一致。`,
      });
    }
    const attempts = [
      {
        attempt: 1,
        status: success
          ? ("success" as const)
          : ("failed" as const),
        latencyMs,
        hit,
        recall: hit ? 0.55 + random() * 0.4 : 0.1 + random() * 0.25,
        faithfulness,
        answerRelevance,
        answerCompleteness,
        retrievedSources,
        errorMessage: success ? undefined : "judge timeout",
      },
    ];

    return {
      id: preview.id,
      question: preview.question,
      goldSources,
      matchedGoldSources,
      retrievedSources,
      status: success ? "success" : "failed",
      hit,
      recall: attempts[0].recall,
      latencyMs,
      sourceHit,
      faithfulness,
      answerRelevance,
      answerCompleteness,
      attempts,
      errorMessage: success ? undefined : "judge timeout",
    };
  });
};

const createMetricSummary = (
  sampleResults: EvaluationSampleResult[],
): EvaluationMetricSummary => {
  const total = sampleResults.length || 1;
  const successItems = sampleResults.filter((item) => item.status === "success");
  const successCount = successItems.length || 1;

  return {
    hitAtK:
      sampleResults.filter((item) => item.hit).length / total,
    recallAtK:
      sampleResults.reduce((sum, item) => sum + item.recall, 0) / total,
    mrr:
      sampleResults.reduce((sum, item) => sum + (item.hit ? 1 / (1 + (1 - item.recall) * 4) : 0), 0) /
      total,
    faithfulness:
      successItems.reduce((sum, item) => sum + item.faithfulness, 0) / successCount,
    answerRelevance:
      successItems.reduce((sum, item) => sum + item.answerRelevance, 0) / successCount,
    answerCompleteness:
      successItems.reduce((sum, item) => sum + item.answerCompleteness, 0) / successCount,
    sourceHitRate:
      sampleResults.filter((item) => item.sourceHit).length / total,
    averageLatencyMs:
      sampleResults.reduce((sum, item) => sum + item.latencyMs, 0) / total,
    failedCount: sampleResults.filter((item) => item.status === "failed").length,
  };
};

export const buildEvaluationRunRecord = (dataset: ParsedDataset): EvaluationRunRecord => {
  const sampleResults = createSampleResults(dataset);
  const metrics = createMetricSummary(sampleResults);
  const startedAt = nowIso();
  const completedAt = new Date(Date.now() + 18_000).toISOString();

  return {
    id: `run-${dataset.id}-${Date.now()}`,
    name: `${dataset.datasetName}-${new Date().toLocaleString("sv-SE").replace(" ", "_")}`,
    dataset,
    status: metrics.failedCount > 0 ? "failed" : "completed",
    startedAt,
    completedAt,
    metrics,
    logs: createRunLogs(dataset),
    sampleResults,
  };
};
