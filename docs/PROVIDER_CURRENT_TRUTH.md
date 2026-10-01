---
status: current
owner: runtime
last_verified: 2026-09-16
layer: wiki
module: ModelSetting
feature: ProviderRuntimeTruth
doc_type: current-snapshot
canonical: true
related:
  - provider/README.md
  - provider/FIRST_MODEL_SETUP.md
  - architecture/provider-api-standards.md
  - architecture/provider-proxy-api.md
  - EVALUATION_CURRENT_TRUTH.md
  - CURRENT_PRODUCT_TRUTH.md
  - archive/provider/README.md
---

# UIChat Mira Provider 当前真相

> 本页只记录 `dev` 当前可由代码和测试核对的 Provider、模型绑定与调用事实。首次使用请先读 [[provider/FIRST_MODEL_SETUP]]。

## 1. 结论先说

Mira 的模型配置不是“保存一个默认模型名称”。当前真实链路是：

```text
ProviderTemplate
→ ProviderConnection
→ ProviderModel Cache
→ ModelRoleConfig
→ ProviderResolution
→ Protocol Adapter
→ Invocation / Observation
```

这七层分别回答：

1. 这类连接使用什么协议模板；
2. 请求发往哪个具体地址、使用哪份凭据；
3. 最近一次同步发现了哪些远端模型；
4. 某个模型在 Mira 中承担什么用途；
5. 本次运行实际解析到了哪条连接和哪个模型；
6. 请求怎样投影为 Ollama、OpenAI-compatible 或 Cloudflare 协议；
7. 实际调用产生了什么请求元数据、耗时、结果或错误。

任何一层成立，都不能替代其余层。

```text
有 Provider 卡片
!= 连接配置完整

模型目录同步成功
!= 聊天调用成功

保存了模型绑定
!= 本地服务正在运行

模板声明支持某个角色
!= 某个具体模型已经验证该能力
```

## 2. 当前核心对象

### 2.1 `ProviderTemplate`

Provider Template 是协议和能力族模板。它声明：

- 默认显示名与 Base URL；
- 模型目录同步 adapter；
- Chat adapter；
- Planner structured-output adapter（若已实现）；
- Embedding adapter；
- Rerank adapter；
- Image adapter；
- 可以绑定的模型角色。

Template 不是用户凭据，也不是某个具体账号连接。

### 2.2 `ProviderConnection`

Provider Connection 是真实连接实例，保存：

- connection id；
- template code；
- 可选 runtime provider code；
- 显示名称；
- Base URL；
- 加密保存的 API Key；
- enabled 状态；
- 最近一次同步状态、错误与时间。

内置连接由系统 seed。用户可以额外创建多个 `openai-compatible-custom` 连接。

### 2.3 `ProviderModel`

`ProviderModel` 是最近一次目录同步后写入本地数据库的模型缓存，包含远端 model id、显示名、原始 payload 和同步时间。

它不是永久模型注册表。远端目录变化后，需要重新同步。

手工输入的模型 ID 可以直接绑定，即使它不在本地同步缓存中。

### 2.4 `ModelRoleConfig`

模型角色配置把一条 Provider Connection 上的 remote model id 绑定到 Mira 的具体用途，并保存该用途的长期参数。

当前角色：

```text
llm
embedding
rerank
task
agentTask
evaluation
imageGeneration
voice
```

### 2.5 `ProviderResolution`

运行前，Provider Proxy 会把角色配置解析为：

```text
providerCode
providerConnectionId
providerTemplateCode
baseUrl
apiKey
model
modelConfigId
params
```

执行层不应重新猜测用户想用哪条连接。

## 3. 第一次使用的最短闭环

新用户的第一目标不是配齐八种角色，而是得到一条真实聊天回复：

```text
启动本地模型服务 / 准备云端 API Key
→ 设置 > 模型设置
→ 主模型 > 选择模型
→ 选择或创建 Provider Connection
→ 填写 Base URL / API Key
→ 同步模型目录，或手工填写 Model ID
→ 绑定为主模型
→ 回到聊天发送最小测试消息
→ 收到真实回复
```

同步模型目录只证明列表接口成功。最终验收必须是一次真实 Chat invocation。

详细步骤见 [[provider/FIRST_MODEL_SETUP]]。

## 4. 当前模型设置页面

模型设置总览当前显示六张卡：

| 卡片 | role | 当前用途 | 当前界面边界 |
| --- | --- | --- | --- |
| 主模型 | `llm` | 普通聊天与最终文本生成 | 可选择模型、编辑参数 |
| 小任务模型 | `task` | 标题、摘要等轻量任务兼容角色 | 可选择模型；参数详情只读 |
| Agent 任务模型 | `agentTask` | Agent Planner / Generate 等任务模型 | 可选择模型；参数详情只读；未绑定时回退到 `task` |
| 评测模型 | `evaluation` | 从 Knowledge Base Chunk 生成评测包样本 | 可选择模型、编辑参数；当前不承担 Run Judge |
| 向量模型 | `embedding` | 远程文本向量化 | 可选择模型、编辑参数 |
| 排序模型 | `rerank` | 远程候选重排 | 可选择模型、编辑参数 |

`imageGeneration` 与 `voice` 虽然存在于全局模型角色和 Provider capability schema 中，但当前主要由 Image Generation Studio 与 TTS Studio 的独立 Provider 配置管理，不在这六张总览卡中。

## 5. 当前 Provider Template

| Template | 目录同步 | Chat | Embedding | Rerank | Image | Planner structured | 关键说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ollama` | Ollama `/api/tags` | Ollama `/api/chat` | Ollama `/api/embed` | 无 | 无 | Ollama JSON Schema | 本地服务；执行前会检查模型是否已下载 |
| `lmstudio` | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | 无 | 无 | 无，保留 text-JSON compatibility | 默认 `127.0.0.1:1234/v1` |
| `openai` | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | 无 | OpenAI Images | 无，保留 text-JSON compatibility | API Key 必填 |
| `google` | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | 无 | 无 | 无，保留 text-JSON compatibility | 使用 Gemini OpenAI-compatible endpoint |
| `cloudflare` | Cloudflare | OpenAI-compatible | Cloudflare | 无 | 无 | 无，保留 text-JSON compatibility | Base URL 必须包含真实 Account ID；可调用模型 ID 需以 `@cf/` 开头 |
| `volcengine` | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | OpenAI Images | 无，保留 text-JSON compatibility | 默认地址是本地 `9997` 协议适配入口 |
| `volcengine-code-plan` | Ark Plan adapter | OpenAI-compatible | 无 | 无 | 无 | Ark JSON Schema | 只允许文本角色 |
| `volcengine-agent-plan` | Ark Plan adapter | OpenAI-compatible | 无 | 无 | 无 | Ark JSON Schema | 只允许文本角色 |
| `openai-compatible-custom` | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | OpenAI-compatible | OpenAI Images | 无，保留 text-JSON compatibility | 可创建多个连接；当前有 runtime code 兼容映射漂移 |

Template capability 是协议级和角色级声明，不是某个具体远端模型的视觉、工具调用、上下文长度或结构化输出验证结果。

Planner structured-output 列只表示 Mira 当前 adapter 已实现并声明的请求协议：Ollama 使用 `format` JSON Schema，Ark Plan 使用 `response_format.json_schema`。共享的 OpenAI-compatible Chat adapter 本身不自动获得 Planner structured 能力。

## 6. 模型目录同步的真实含义

同步流程：

```text
保存 Base URL / API Key
→ connection.status = syncing
→ 调用模型目录 adapter
→ 替换该 connection 的本地 ProviderModel 缓存
→ 成功：status = connected，记录 lastSyncedAt
→ 失败：status = error，记录 lastError
```

因此：

| UI / 数据状态 | 实际证明 | 不能证明 |
| --- | --- | --- |
| `idle` | 尚未完成本轮同步或配置刚变化 | 连接失败 |
| `syncing` | 正在请求模型目录 | Chat 可用 |
| `connected` | 最近一次模型目录同步成功 | 当前服务仍在线、模型能聊天、API 额度有效 |
| `error` | 最近一次目录同步失败 | 所有协议端点都永久不可用 |
| 模型卡“已配置” | 已保存 connection + remote model id | 当前请求一定成功 |

修改 Base URL 或 API Key 后，应重新同步；但即使同步成功，仍要执行一次真实业务调用。

## 7. 角色绑定与运行时解析

保存角色绑定时，系统会：

1. 检查 Provider Template 是否允许该 role；
2. 保存必要的连接字段；
3. 接受同步目录中的模型，或接受手工填写的 model id；
4. 建立默认 `ModelRoleConfig`；
5. 写入该角色的默认参数；
6. 对可识别的 Embedding 模型尝试读取维度。

调用时：

```text
role
→ 读取默认 ModelRoleConfig
→ 定位 ProviderConnection
→ 校验 enabled / Base URL / API Key
→ 解析 callable model id
→ 合并角色参数
→ 选择 adapter
→ 发出请求
```

显式请求 `/proxy/.../:provider` 不等于任意切换连接。当前 runtime 会检查显式 provider 是否与该角色的默认 runtime provider 一致。

## 8. Chat、Evaluation、Embedding 与 Rerank

### Chat

- `llm` 用于普通聊天；
- `agentTask` 用于 Agent 任务模型；
- 未显式配置 `agentTask` 时，当前实现回退到 `task`；
- Ollama 使用原生 Chat API；
- 其他当前文本 Provider 主要走 OpenAI-compatible Chat；
- Ark Plan 连接在 adapter 内解析专用 Base URL。

### Evaluation

`evaluation` role 当前只在评测包生成器中使用，用于基于 Knowledge Base Chunk 生成：

- question；
- expectedAnswer；
- tags。

Evaluation Run 的 Faithfulness、Relevance 和 Completeness 当前使用本地词项重合启发式，不调用 `evaluation` role 做 Judge。完整事实见 [[EVALUATION_CURRENT_TRUTH]]。

### Embedding

远程 Embedding 根据 Template 使用：

- Ollama native；
- Cloudflare；
- OpenAI-compatible。

成功调用后，系统会用实际向量长度回写当前 Embedding role 的 dimensions。

### Rerank

Rerank 不从 Chat 兼容性推断。只有 Template 明确声明 `rerankAdapter: openai-compatible` 时，Provider Proxy 才会解析 `/rerank` 调用。

## 9. 内置本地模型 Runtime

Mira 还包含一条不依赖 Provider Connection 的本地 ONNX / WASM 路径：

| role | 内置模型 | 当前状态 |
| --- | --- | --- |
| Embedding | `multilingual-e5-small`，384 维 | 内置本地能力 |
| Rerank | `ms-marco-MiniLM-L-6-v2` | 可选内置能力 |

它们由 Local Model Runtime 加载本地资源，Observation 中使用：

```text
providerCode: local
modelConfigId: local:<model-id>
runtime: onnxruntime-web/wasm
```

“内置本地能力 ready”和“远程 Embedding/Rerank role 已绑定”是两种不同状态，不能混写。

## 10. Image 与 Voice 的独立配置

当前代码同时存在：

1. 全局模型角色：`imageGeneration` / `voice`；
2. MicroApp Studio provider config：`image_generation` / `tts`。

Studio 配置保存：

```text
kind
baseUrl
apiKey
modelId
```

这两套来源尚未完全统一。首次聊天配置不应要求用户先处理 Image 或 TTS；相关能力应分别在对应 Studio 中配置和验证。

## 11. 导入、导出与凭据安全

模型设置导出格式：

```text
format: uichat-mira-model-settings
version: 1
connections[]
assignments[]
```

当前导出文件包含可用于恢复连接的明文 API Key。

因此：

- 不要把导出 JSON 提交到 Git；
- 不要发到公开聊天或工单；
- 不要用普通云盘公开链接分享；
- 备份应按凭据文件处理；
- 导入前应确认来源可信。

导入会恢复连接、API Key、角色绑定和参数；它不是只导入“模型名称”。

## 12. Observation 与调试

当前 Model Call Observation 可以记录：

- role；
- provider code / label；
- protocol；
- operation；
- endpoint；
- model / modelConfigId；
- params；
- 请求摘要；
- startedAt / finishedAt / durationMs；
- 结果、失败或检索上下文。

Provider Proxy 当前没有为所有 Provider 统一归一化 Token 与成本字段。文档和 UI 不能承诺所有调用都能显示准确 Token、计费和成本。

## 13. 已知实现漂移与真相债

### 13.1 配置状态不等于运行健康

模型卡“已配置”只检查是否保存了 connection 和 remote model id。Provider `connected` 只表示最近一次模型目录同步成功。两者都不等于真实 Chat invocation 已通过。

### 13.2 Seed 默认值可能形成假就绪感

数据库会 seed Ollama 的主模型、Task 和远程 Embedding 默认绑定。若 Ollama 未启动或对应模型未下载，UI 仍可能显示已有绑定；运行时才会返回连接拒绝或模型不可用。

### 13.3 Custom OpenAI-compatible 的 runtime code 映射

当前 `openai-compatible-custom` 在 Provider Resolution 中会被映射为 runtime provider code `volcengine`。

这是一处历史兼容实现，不是目标上的供应商身份合同。它可能影响：

- Provider label；
- Task / AgentTask 参数特判；
- 调试信息中的 provider code；
- 对“自定义连接完全供应商中立”的理解。

本轮文档只公开该事实，不修改 Runtime。

### 13.4 Image / Voice 存在双配置来源

全局角色绑定与 Studio provider config 尚未成为同一个 source of truth。不能用其中一处“已配置”推断另一处 ready。

### 13.5 Evaluation role 不是 Judge role

模型设置页面提供 `evaluation` role，但当前只被评测包生成器调用。Run 指标没有模型裁判调用。把该角色描述成“评测生成与裁判”会高估当前实现。

### 13.6 Template capability 不是 per-model capability profile

当前 catalog 能说明 adapter、Planner structured transport 和 role eligibility，但不能自动证明某个具体模型支持 Vision、Tool Calling、JSON Schema 的全部约束、上下文长度或全部参数。native 请求失败时，Planner 对未声明 native 能力的 Provider 保留 text-JSON compatibility；已声明 native 的 Provider 按 adapter 错误合同报告失败。

### 13.7 Token / Cost 尚未统一

请求身份和耗时已有结构化 Observation，但 Token 与成本尚未在所有 Provider adapter 上形成统一、可信的归一化合同。

## 14. 当前非目标

Mira 当前没有承诺：

- 所有 OpenAI-compatible 服务都百分之百行为一致；
- 模型目录同步就是完整健康检查；
- 一个模型可以自动承担全部角色；
- 评测模型已经承担 LLM Judge；
- 通过供应商名称自动推断 Vision / Tool 能力；
- Image、TTS、Chat 共用一个完成统一的 Provider Gateway；
- 所有 Provider 都能返回统一 Token 与成本；
- 角色绑定后自动下载本地模型；
- 显式 provider 参数可以绕过默认角色绑定。

## 15. 代码与验证锚点

主要实现：

- `desktop/src/features/Settings/pages/ModelSetting/index.tsx`；
- `desktop/src/features/Settings/components/DefaultModelCard.tsx`；
- `desktop/src/features/Settings/components/ModelConfig.tsx`；
- `desktop/src/features/Settings/components/PlatformConfigModal.tsx`；
- `desktop/src/features/Settings/components/ApiConfigCard.tsx`；
- `desktop/src/shared/api/modelSettings.ts`；
- `server/src/providers/catalog.ts`；
- `server/src/services/provider-settings.service.ts`；
- `server/src/services/provider-proxy.service/`；
- `server/src/services/local-model-runtime/`；
- `server/src/services/evaluation-package-generator.service.ts`；
- `server/src/routes/microapps/index.ts`。

主要回归：

- `server/src/services/provider-settings.service.test.ts`；
- `server/src/services/evaluation-package-generator.service.test.ts`；
- `desktop/src/features/Settings/components/PlatformConfigModal.test.tsx`；
- `desktop/src/features/Settings/components/ApiConfigCard.test.tsx`；
- `desktop/src/features/Settings/components/ModelConfig.test.tsx`；
- `desktop/src/shared/api/__tests__/modelSettings.test.ts`。
