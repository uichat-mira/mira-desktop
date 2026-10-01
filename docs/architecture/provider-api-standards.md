---
status: current
owner: runtime
last_verified: 2026-09-16
layer: schema
module: ModelSetting
feature: ProviderStandards
doc_type: current-contract
canonical: true
related:
  - ../PROVIDER_CURRENT_TRUTH.md
  - ../provider/README.md
  - provider-proxy-api.md
  - ../archive/provider/README.md
---

# Provider Template 与 Adapter 标准

## 1. 文档范围

本页定义当前 Provider Template、runtime provider code、adapter family 与能力声明合同。

本页不定义：

- 首次配置步骤；
- Chat 消息和附件的应用协议；
- Thread 持久化；
- RAG 文档导入；
- 某个远端模型的真实 Vision / Tool Calling 能力；
- Image Generation 与 TTS Studio 的完整运行时。

首次配置见 [[provider/FIRST_MODEL_SETUP]]；运行时解析见 [[architecture/provider-proxy-api]]。

## 2. Template 与 Connection

### `ProviderTemplateCode`

Template code 描述协议和能力族。

当前值：

```text
ollama
lmstudio
openai
google
cloudflare
volcengine
volcengine-code-plan
volcengine-agent-plan
openai-compatible-custom
```

### `ProviderCode`

Runtime provider code 是执行层当前识别的供应商族：

```text
ollama
lmstudio
openai
google
cloudflare
volcengine
```

Template code 和 runtime provider code 不能互换使用。

例如：

- `volcengine-code-plan` 是 Template；
- 它保存独立 Provider Connection；
- 执行层的 provider code 仍是 `volcengine`；
- 专用 endpoint 由 `providerTemplateCode` 在 adapter 内解析。

### `ProviderConnection`

Connection 是 Template 的实例。多个自定义 OpenAI-compatible Connection 可以共享同一个 Template，但拥有不同：

- ID；
- 显示名；
- Base URL；
- API Key；
- 模型目录；
- 角色绑定。

因此：

```text
ProviderTemplate
1 → N ProviderConnection
```

## 3. Adapter Family

### Model Sync Adapter

```ts
"ollama" | "openai-compatible" | "cloudflare"
```

职责：获取远端模型目录并标准化为：

```text
remoteModelId
modelName
rawPayload
```

特殊说明：Ark Plan Template 虽在 catalog 中声明 OpenAI-compatible sync family，但实际模型发现由 Ark Plan adapter 处理。

### Chat Adapter

```ts
"ollama" | "openai-compatible"
```

职责：

- 将 `NormalizedChatMessage[]` 投影为上游消息；
- 解析图片和文件附件；
- 应用角色参数；
- 流式输出文本 delta；
- 生成 invocation metadata。

### Embedding Adapter

```ts
"ollama" | "openai-compatible" | "cloudflare" | "none"
```

职责：

- 构造向量请求；
- 验证向量数量；
- 读取实际 dimensions；
- 将 dimensions 回写到当前远程 Embedding 角色配置。

### Rerank Adapter

```ts
"openai-compatible" | "none"
```

Rerank 必须显式声明，不能从 Chat adapter 推断。

### Image Adapter

```ts
"openai-images" | "none"
```

该字段只说明 Provider Template 的图片协议资格。Image Generation Studio 仍拥有独立的 Provider/Flow/Artifact Runtime，不能仅凭该字段推断 Studio Ready。

## 4. 当前 Template Matrix

| Template | Sync | Chat | Embedding | Rerank | Image | Planner structured | 显式 role 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ollama` | Ollama | Ollama | Ollama | 无 | 无 | Ollama JSON Schema | 默认角色集合 |
| `lmstudio` | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | 无 | 无 | 无，保留 text-JSON compatibility | 默认角色集合 |
| `openai` | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | 无 | OpenAI Images | 无，保留 text-JSON compatibility | 默认角色集合 |
| `google` | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | 无 | 无 | 无，保留 text-JSON compatibility | 默认角色集合 |
| `cloudflare` | Cloudflare | OpenAI-compatible | Cloudflare | 无 | 无 | 无，保留 text-JSON compatibility | 默认角色集合 |
| `volcengine` | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | OpenAI Images | 无，保留 text-JSON compatibility | 默认角色集合 |
| `volcengine-code-plan` | Ark Plan | OpenAI-compatible | 无 | 无 | 无 | Ark JSON Schema | `llm / task / agentTask / evaluation` |
| `volcengine-agent-plan` | Ark Plan | OpenAI-compatible | 无 | 无 | 无 | Ark JSON Schema | `llm / task / agentTask / evaluation` |
| `openai-compatible-custom` | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | OpenAI Images | 无，保留 text-JSON compatibility | 默认角色集合 |

Planner structured 只有在 Template 明确声明对应 adapter 且当前 Mira 调用协议已覆盖时才成立。共享的 OpenAI-compatible Chat adapter 不自动等于 Planner native structured；未声明的 Provider 继续使用 text-JSON compatibility codec。

## 5. 默认角色集合

未显式声明 `supportedRoles` 的 Template 当前从 adapter 推导角色资格。

基础集合：

```text
llm
task
agentTask
evaluation
embedding
voice
```

当 `rerankAdapter != none` 时增加：

```text
rerank
```

当 `imageAdapter != none` 时增加：

```text
imageGeneration
```

### 重要限制

这只是**绑定资格**。

它不自动证明：

- 某个具体模型支持该用途；
- Voice 已接入统一 Provider Proxy；
- Image Studio 已使用全局角色绑定；
- Chat 模型支持 Vision；
- Chat 模型支持 Tool Calling；
- Provider 接受所有统一参数。

## 6. 当前 Template 定义

### Ollama

```text
Base URL: http://localhost:11434
Sync: /api/tags
Chat: /api/chat
Embedding: /api/embed
```

执行 Chat / Embedding 前会检查模型是否出现在本地目录中。

### LM Studio

```text
Base URL: http://127.0.0.1:1234/v1
Protocol: OpenAI-compatible
```

Mira 不负责启动 LM Studio server 或加载模型。

### OpenAI

```text
Base URL: https://api.openai.com/v1
Protocol: OpenAI-compatible
API Key: required by runtime validation
Image adapter: openai-images
```

### Google Gemini

```text
Base URL: https://generativelanguage.googleapis.com/v1beta/openai
Protocol: OpenAI-compatible
```

该 Template 使用 Google 提供的 OpenAI-compatible endpoint，不代表 Google 原生 API 已形成独立 adapter。

### Cloudflare

默认地址包含 Account ID 占位符：

```text
https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
```

运行时要求：

- 替换真实 Account ID；
- Base URL 通过 Cloudflare 格式检查；
- API Key 非空；
- callable model id 以 `@cf/` 开头。

### 火山引擎

普通 `volcengine` 默认地址：

```text
http://localhost:9997
```

这表示当前默认口径依赖本地协议适配入口，不等于直接使用所有火山官方 endpoint。

### Ark Plan

```text
volcengine-code-plan
volcengine-agent-plan
```

特点：

- 独立 Connection；
- runtime provider code 为 `volcengine`；
- 只承接文本角色；
- 专用 Base URL 由 Ark Plan adapter 解析；
- 模型目录和 Chat endpoint 不按普通火山连接处理。

### Custom OpenAI-compatible

用户可以创建多个连接：

```text
templateCode: openai-compatible-custom
providerCode: null
```

目标合同是供应商中立的 OpenAI-compatible Connection。

当前 Provider Resolution 仍把它映射为 runtime provider code `volcengine`。这是已知实现漂移，见 [[PROVIDER_CURRENT_TRUTH]]。

## 7. 模型目录标准

同步 adapter 的输出必须可以归一化为：

```ts
{
  id: string;
  name: string;
  raw?: unknown;
}
```

同步成功后：

- 替换当前 Connection 的 ProviderModel 缓存；
- 写入 `syncedAt`；
- Connection 状态变为 `connected`；
- 清除 `lastError`。

同步失败后：

- Connection 状态变为 `error`；
- 写入 `lastError`；
- 保留之前的 `lastSyncedAt`；
- 调用方收到真实错误。

同步不是 Chat 健康检查。

## 8. Model ID 标准

绑定时允许两类来源：

1. 同步缓存中的 `remoteModelId`；
2. 用户手工输入的 model id。

手工 ID 可以在缓存中不存在。

Cloudflare 额外要求 callable identifier。解析顺序：

1. 当前 `remoteModelId`；
2. 当前配置的模型名称；
3. ProviderModel 缓存中的 model name；
4. 都不满足时失败。

## 9. 参数边界

统一角色参数包括：

- Temperature；
- Top P；
- Top K；
- Max Tokens；
- Frequency Penalty；
- Presence Penalty；
- Embedding dimensions / batch / normalize；
- Rerank topN / scoreThreshold。

Adapter 只转发自己支持的标准化参数。

当前角色特判：

- Ollama `task / agentTask` 注入 `think: false`；
- Volcengine `task / agentTask` 注入 `thinking: false`。

不要把某个 Provider 的私有参数默认为所有 OpenAI-compatible 服务都支持。

## 10. 能力声明规则

Provider capability 当前属于 Template 级静态声明。

新增或修改 Template 时必须同时核对：

- sync adapter；
- chat adapter；
- embedding adapter；
- rerank adapter；
- image adapter；
- supported roles；
- model id 特殊规则；
- 前端显示与选择过滤；
- route schema / database enum；
- 回归测试。

不得仅凭供应商名称推断能力。

## 11. 代码锚点

- `server/src/providers/codes.ts`；
- `server/src/providers/catalog.ts`；
- `server/src/services/provider-settings.service.ts`；
- `server/src/services/provider-proxy.service/chat-adapters.ts`；
- `server/src/services/provider-proxy.service/resolution.ts`；
- `desktop/src/shared/providerCatalog.ts`；
- `desktop/src/shared/api/modelSettings.ts`。

## 12. 外部标准参考

实现 Provider adapter 时，先核对对应上游官方 API；本地实现只描述 Mira 当前适配，不替代供应商标准。

- OpenAI API Reference；
- Google Gemini OpenAI compatibility；
- Cloudflare Workers AI OpenAI compatibility；
- LM Studio Developer / OpenAI-compatible API；
- Ollama native API；
- 火山引擎 Ark / Plan API。

供应商接口变化时，应先更新 adapter 和验证，再更新本合同。
