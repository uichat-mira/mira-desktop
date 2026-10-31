# Context Budget Runtime

Status: Current
Owner: runtime
Last verified: 2026-06-28
Layer: raw-source
Module: Develoments
Feature: ContextBudget
Doc Type: design

## 单点真相范围

这页定义模型调用前的 token 审计与动态上下文控制协议。

它主要回答：

- 为什么 context budget 要独立成 runtime 模块
- 协议输入输出长什么样
- token 估算、预算策略、上下文 packing 怎么分工
- 各类节点以后怎么接入同一个 packer

相关文档：

- `../provider/README.md`
- `model-config-api.md`
- `rag-node-development.md`
- `../uchat.md`

## 背景

Context 爆炸不是单个模型参数问题，而是请求组装问题。

进入 LLM 前可能同时叠加：

- 角色设定
- 线程摘要
- 长期记忆
- agent 环境说明
- web_search 预取结果
- 系统提示词
- payload 载荷
- 完整历史消息
- 当前用户问题

这些上下文来源如果没有统一预算和统一审计，最后就会在 provider 调用前一起爆开。

## 当前实现

模块已经落地在：

```text
server/src/services/context-budget/
  index.ts
  types.ts
  token-estimator.ts
  policies.ts
  packer.ts
  audit.ts
  context-budget.service.test.ts
```

当前协议输入输出如下：

```ts
ContextBudgetPackInput.sections = {
  prefaceMessages?: NormalizedChatMessage[];
  instructionMessages?: NormalizedChatMessage[];
  payloads?: ContextBudgetPayload[];
  historyMessages?: NormalizedChatMessage[];
  latestUserMessage: NormalizedChatMessage;
}

ContextBudgetPackResult = {
  messages: NormalizedChatMessage[];
  payloads: PackedContextPayload[];
  audit: ContextBudgetAudit;
}
```

### 现在的约束

- `latestUserMessage` 必保。
- `prefaceMessages`、`instructionMessages`、`payloads`、`historyMessages` 按预算分别裁剪。
- `payloads` 是通用载荷，不再绑定 RAG 语义。
- `audit` 会记录每个 section 的 before / after token。
- 第一版使用启发式 token 估算，不引入额外 tokenizer 依赖。

## 设计结论

Context budget 应独立为 runtime/core 模块，而不是散落在：

- chat route
- RAG node
- provider adapter
- role resolver
- web_search resolver

原因：

1. 上下文预算是所有模型调用入口的共同前置能力。
2. 不同来源需要按统一优先级裁剪，否则局部补丁会互相打架。
3. 审计报告需要进入 execution trace，方便定位是哪一类上下文撑爆。
4. 后续 tokenizer、模型 context window、provider 差异都应集中演进。

## 协议说明

### `types.ts`

```ts
export type ContextBudgetPolicyName = "plain-chat" | "rag-chat" | "task-chat";

export interface ContextBudgetPayload<TMeta = unknown> {
  id: string;
  messages: NormalizedChatMessage[];
  metadata?: TMeta;
  maxTokens?: number;
  required?: boolean;
}

export interface ContextBudgetPackInput {
  policy: ContextBudgetPolicyName;
  roleType: "llm" | "task" | "evaluation";
  providerCode?: string;
  model?: string;
  params?: Record<string, unknown>;
  sections: {
    prefaceMessages?: NormalizedChatMessage[];
    instructionMessages?: NormalizedChatMessage[];
    payloads?: ContextBudgetPayload[];
    historyMessages?: NormalizedChatMessage[];
    latestUserMessage: NormalizedChatMessage;
  };
}
```

### `token-estimator.ts`

提供统一 token 估算接口：

```ts
estimateTextTokens(text: string): number
estimateMessageTokens(message: NormalizedChatMessage): number
estimateMessagesTokens(messages: NormalizedChatMessage[]): number
```

第一版使用保守启发式估算：

- CJK 字符约 `1 char ~= 1 token`
- 英文、数字、常见符号约 `4 chars ~= 1 token`
- 混合文本按偏保守结果计
- 每条 message 增加固定 overhead

### `policies.ts`

根据场景返回预算配置：

```ts
export interface ContextBudgetPolicy {
  name: ContextBudgetPolicyName;
  modelContextTokens: number;
  reservedOutputTokens: number;
  prefaceMaxTokens: number;
  instructionMaxTokens: number;
  payloadMaxTokens: number;
  historyMaxTokens: number;
}
```

第一版默认策略：

- `plain-chat`
  - `reservedOutputTokens`: 1024
  - `prefaceMaxTokens`: 1200
  - `instructionMaxTokens`: 1200
  - `payloadMaxTokens`: 0
  - `historyMaxTokens`: 6000
- `rag-chat`
  - `reservedOutputTokens`: 1024
  - `prefaceMaxTokens`: 1200
  - `instructionMaxTokens`: 1200
  - `payloadMaxTokens`: 5000
  - `historyMaxTokens`: 2500
- `task-chat`
  - `reservedOutputTokens`: 512
  - `prefaceMaxTokens`: 800
  - `instructionMaxTokens`: 800
  - `payloadMaxTokens`: 0
  - `historyMaxTokens`: 1200

`modelContextTokens` 第一版先使用本地配置表 fallback。

### `packer.ts`

负责把多个上下文来源裁剪并组装成最终 provider messages。

保留优先级：

1. 当前用户消息必须保留。
2. 核心 instruction 必须保留。
3. preface 按 section budget 保留。
4. payloads 按输入顺序保留。
5. history 优先保留最近轮次。

裁剪规则：

- history 从最新消息向前累计，超出预算即停止。
- payloads 先限制总 token，再对单个 payload 消息做截断。
- preface / instruction 各自按 section budget 裁剪。

### `audit.ts`

输出审计报告：

```ts
export interface ContextBudgetAudit {
  policy: ContextBudgetPolicyName;
  model: string;
  providerCode: string;
  modelContextTokens: number;
  reservedOutputTokens: number;
  maxInputTokens: number;
  totalEstimatedTokensBefore: number;
  totalEstimatedTokensAfter: number;
  sections: Array<{
    name: string;
    beforeTokens: number;
    afterTokens: number;
    action: "kept" | "trimmed" | "dropped";
    reason?: string;
  }>;
  warnings: string[];
}
```

审计报告应进入 execution trace 或节点观测，帮助定位：

- 是 history 撑爆
- 是 payload 撑爆
- 是角色设定撑爆
- 是模型 context window 太小

## 对外 API

```ts
export const contextBudgetService = {
  pack(input: ContextBudgetPackInput): ContextBudgetPackResult;
};
```

调用示例：

```ts
const packed = contextBudgetService.pack({
  policy: "rag-chat",
  roleType: "llm",
  sections: {
    prefaceMessages: requestContextMessages,
    instructionMessages: [{ role: "system", content: ragSystemPrompt }],
    payloads: chunks.map((chunk, index) => ({
      id: `chunk-${index + 1}`,
      required: true,
      messages: [{ role: "system", content: chunk.content }],
    })),
    historyMessages: conversationHistory,
    latestUserMessage: { role: "user", content: query },
  },
});

return providerProxyService.streamChatText("default", packed.messages);
```

## 接入点

### RAG generate

当前位置：

- `server/src/services/rag-nodes/generate.service.ts`

当前 generate 已经改成先 pack，再调 provider。

### 普通 default chat

当前位置：

- `server/src/routes/proxy-provider/chat.routes.ts`
- `server/src/services/provider-proxy.service/index.ts`

普通聊天后续也应在 route 层先 pack，再进入 provider。

### Task chat

当前位置：

- `providerProxyService.streamTaskChatText`
- 标题生成、rewrite、工具摘要等调用

Task chat 应使用 `task-chat` policy，默认保守预算，避免后台任务为了小输出携带过长上下文。

## 第一版依赖策略

第一版不新增依赖。

理由：

1. 当前最大缺口是没有预算闸门，不是 token 估算不够精确。
2. 启发式估算已经足以阻止极端 context 爆炸。
3. 先把模块接口稳定下来，后续再替换 tokenizer 实现。

如后续需要更精确的 tokenizer，优先考虑：

```bash
pnpm --filter @ui-chat-mira/server add gpt-tokenizer
```

不建议第一版把 LangChain 作为预算核心。LangChain 更适合 text splitter / document transform，而 context budget 需要覆盖 provider messages、system context、history、payload、web_search 等多类输入，应该由项目自己的 runtime contract 主导。

## 本地模型包与打包策略

Context budget 解决的是进入 LLM 前的上下文控制。Embedding / rerank 属于检索质量链路，但它们会影响桌面端安装包体积、离线能力和首次启动体验，因此这里记录当前产品线结论。

### 产品线结论

默认体验应是：

```text
开箱即用 embedding 检索
rerank 是高级检索质量开关
默认运行时使用 onnxruntime-web / WASM
```

建议分三档：

- 默认内置
  - embedding：`Xenova/multilingual-e5-small`
  - rerank：不默认内置
  - runtime：`onnxruntime-web` / WASM
  - 目标：主安装包新增资源控制在 50-100MB 以内
- 轻量增强包
  - embedding：沿用默认 embedding
  - rerank：20M-30M 级轻量 cross-encoder，例如 `cross-encoder/ms-marco-MiniLM-L6-v2`
  - runtime：优先继续使用 WASM
  - 目标：额外下载 50-150MB
  - 策略：只 rerank top 10-20
- 高质量包
  - embedding：可选更强 BGE / E5 系列
  - rerank：BGE reranker
  - runtime：可选 native 性能包
  - 目标：额外下载 300MB-1GB
  - 策略：仅作为可选下载，不随主安装包发

### Runtime 选择

默认不引入 `onnxruntime-node`。

当前结论：

```text
默认内置：
  onnxruntime-web / WASM
  embedding 模型
  无 Windows native binding

可选性能包：
  onnxruntime-node CPU
  只下载当前平台版本
  用于高质量 rerank 或大知识库本地检索

不默认提供：
  CUDA / DirectML provider
  多平台 native binaries
```

原因：

- `onnxruntime-node` 会带 native `.node` binding 和 ONNX Runtime shared library。
- 当前包体估算显示 native runtime 未压缩可能达到 100MB+，安装包增量也可能达到 30-80MB。
- 默认 embedding 可以批处理，WASM 性能损失可接受。
- rerank 对延迟更敏感，因此默认不内置；如启用轻量 rerank，应限制 `rerankTopK` 并支持关闭。
- native runtime 更适合作为可选性能包，而不是主安装包默认能力。

### 打包归属

本页只记录本地模型的产品线选择和评测结论。

Electron resources 入包、模型包压缩、首启解压、checksum 校验、`onnxruntime-web` WASM 文件复制和 userData 路径解析，归 Build 模块维护：

- `../build/local-model-packaging.md`

### 本地模型评测样例

评测脚本：

```bash
pnpm eval:local-model-runtime
```

结果文件：

```text
.artifacts/model-packs/eval/local-model-runtime-eval.json
```

本轮验证时间：2026-06-28。

模型：

- embedding：`Xenova/multilingual-e5-small`
- rerank：`Xenova/ms-marco-MiniLM-L-6-v2`
- runtime：`onnxruntime-web/wasm`

汇总结果：

| 能力 | 通过 | 总数 |
| --- | ---: | ---: |
| embedding 分类/召回 | 6 | 6 |
| rerank 排序 | 2 | 2 |

#### Embedding 场景

这些用例模拟“query -> 多个候选能力/文档/知识片段 -> embedding 相似度排序”的场景。

| 场景 | 中文 query | 预期命中 | 实际 Top1 | Top1 分数 |
| --- | --- | --- | --- | ---: |
| 工具意图识别 | 帮我在项目里查找所有调用 providerProxyService 的地方 | 代码搜索工具 | 代码搜索工具 | 0.879846 |
| 工具意图识别 | 把构建失败的结果发到企业微信机器人 | 企业微信通知工具 | 企业微信通知工具 | 0.931092 |
| 文档识别 | 这份文档描述接口字段、请求路径和响应结构，应该归到哪里？ | API 契约文档 | API 契约文档 | 0.911365 |
| 文档识别 | 这篇说明 Electron、backend 进程和 preload 边界 | 运行时架构文档 | 运行时架构文档 | 0.920655 |
| RAG 识别 | context 爆炸时应该优先裁剪历史还是当前用户问题？ | 上下文预算协议 | 上下文预算协议 | 0.920916 |
| RAG 识别 | 默认安装包应该内置 reranker 吗？ | 本地模型包策略 | 本地模型包策略 | 0.892018 |

观察：

- `multilingual-e5-small` 对中文工具意图、文档分类和 RAG 片段识别都能给出可用 Top1。
- 分数整体偏高且候选间距不总是很大，因此生产侧不能只看绝对分数；更适合看 TopK、相对排序和 margin。
- 工具意图识别可以先用 embedding 做召回，再交给策略节点或 LLM 做最终确认。

#### Rerank 场景

这些用例模拟“query + candidate text -> cross-encoder pair scoring -> 重排”的场景。

| 场景 | Query | 预期 Top1 | 实际 Top1 | Top1 score |
| --- | --- | --- | --- | ---: |
| 英文对照 | How does context budget prevent long chat context overflow? | 上下文预算 | 上下文预算 | -10.068593 |
| 中文探针 | context budget 如何避免长对话爆炸？ | 上下文预算 | 上下文预算 | -7.448614 |

观察：

- `ms-marco-MiniLM-L-6-v2` 在这组小样例里能把相关片段排到第一。
- 该模型偏英文；中文样例虽然排序正确，但概率值很低，不能把 sigmoid 后的绝对值当作“可信度”。
- 中文主链路不建议依赖“先用 task 模型翻译再 rerank”的补丁，前置翻译会引入 JSON 结构不稳定和语义漂移。
- 生产策略应限制 `rerankTopK`，默认仍以 embedding 检索为主，rerank 作为高级检索质量开关。

## 测试要求

当前已覆盖：

- 长历史只保留最近消息。
- 当前用户消息永不丢弃。
- 核心 instruction / preface 按 section 预算裁剪。
- payload 超预算时会被截断。
- unknown model 使用 8192 fallback context window。
- audit before / after token 数可读且稳定。
- pack 后总 token 不超过 `modelContextTokens - reservedOutputTokens`，除非必保内容本身已经超限。

## Implementation Checklist

### Phase 0：确认范围

- [x] 确认第一期目标是 runtime 侧 context budget，不改 provider 协议。
- [x] 确认第一期不新增 tokenizer 依赖。
- [x] 确认第一期不改模型设置 UI。
- [x] 确认第一期不做自动历史总结。
- [x] 确认第一期 audit 先写入现有 execution node，不新增前端 trace 组件。

### Phase 1：最小可用版

状态：已完成。

- [x] 新建 `server/src/services/context-budget/`。
- [x] 新建 `types.ts`。
- [x] 新建 `token-estimator.ts`。
- [x] 新建 `policies.ts`。
- [x] 新建 `packer.ts`。
- [x] 新建 `audit.ts`。
- [x] 暴露 `contextBudgetService.pack`。
- [x] 接入 `server/src/services/rag-nodes/generate.service.ts`。
- [x] RAG generate 使用 `packed.messages` 调 provider。
- [x] RAG generate observation 写入 `packed.audit`。
- [x] 单测覆盖长 history 裁剪。
- [x] 单测覆盖 payload 总预算裁剪。
- [x] 单测覆盖 latest user message 永不丢。
- [x] 单测覆盖 instruction / preface section 裁剪。
- [x] 跑 `pnpm --filter @ui-chat-mira/server test`。
- [x] 跑 `pnpm --filter @ui-chat-mira/server typecheck`。

完成条件：

- [x] RAG 请求进入 LLM 前有统一 audit。
- [x] RAG 输入估算 token 不超过 `modelContextTokens - reservedOutputTokens`，除非必保内容本身已经超限。
- [x] execution trace 能看出 history / payload / preface / instruction 的 before / after token。
