---
status: current
owner: project-owner
last_verified: 2026-07-31
freshness_audited: 2026-09-19
layer: wiki
module: Project
feature: ProductTruth
doc_type: current-snapshot
canonical: true
related:
  - ENGINEERING_MEMORY.md
  - PROVIDER_CURRENT_TRUTH.md
  - KNOWLEDGE_BASE_CURRENT_TRUTH.md
  - EVALUATION_CURRENT_TRUTH.md
  - AGENT_CURRENT_TRUTH.md
  - TOOL_CURRENT_TRUTH.md
  - MICROAPP_CURRENT_TRUTH.md
  - harness/agentgraph-harness-protocol.md
  - skill/README.md
  - knowledge-base/README.md
  - evaluation/README.md
  - provider/README.md
---

# UIChat Mira 当前产品真相

> 这页只记录当前已经成立的产品事实、能力边界和阶段重点。愿景、POC、路线图和施工过程不能覆盖这里。

## 当前阶段

从 **2026 年 8 月**开始，UIChat Mira 进入功能稳定迭代阶段。

当前优先级：

1. 真实可用性与失败恢复；
2. 已有能力的回归测试；
3. 当前契约一致；
4. 可观测性、诊断与 Evidence；
5. 文档与实现保持同一份真相；
6. 小步、可验证、可回退的增量。

这不等于停止开发，而是停止用新功能掩盖旧能力没有站稳的问题。

## 产品定位

UIChat Mira 是一个 **本地优先、桌面优先、多 Provider 的个人 AI 工作台**。

产品主线不是 OpenAI-only，也不是单一聊天壳。当前工程同时容纳：

- Chat；
- Provider / Model Gateway；
- Knowledge Base / RAG；
- Evaluation；
- Agent；
- Harness 与 Tool Runtime；
- MCP Host；
- Skill / SubAgent；
- MicroApps Hub、领域 Studio 与外部 Runtime。

## 当前已经成立的能力

### 桌面运行与发布

- Electron 与 Tauri 两条桌面路径并存；
- 主项目提供统一开发、构建、校验和发布脚本；
- 桌面端是当前主要产品形态。

### Chat 与 Provider

完整事实见 [[PROVIDER_CURRENT_TRUTH]]。

当前已经成立：

- 支持多个内置 Provider Template 与多个自定义 OpenAI-compatible Connection；
- Provider Template、Provider Connection、模型目录缓存和模型角色绑定是独立对象；
- 模型设置总览当前显示 `llm / task / agentTask / evaluation / embedding / rerank` 六个角色；
- `imageGeneration / voice` 存在于全局角色 schema，但对应 Studio 仍有独立 Provider 配置；
- 模型目录同步支持 Ollama、OpenAI-compatible、Cloudflare 与 Ark Plan 路径；
- Chat 根据角色绑定解析具体 Connection、模型、参数与 adapter；
- AgentTask 未显式绑定时，当前兼容路径回退到 Task；
- 远程 Embedding 支持 Ollama、Cloudflare 与 OpenAI-compatible adapter；
- Rerank 必须由 Template 显式声明，不能从 Chat 兼容推断；
- 内置本地 Embedding / Rerank 使用独立 ONNX / WASM Runtime；
- 模型调用 Observation 已能记录 Provider、协议、endpoint、模型、参数、请求摘要与耗时；
- 模型设置支持包含 Connection、凭据、角色绑定与参数的导入导出。

新安装的第一验收不是“Provider 卡片出现”或“目录同步成功”，而是按 [[provider/FIRST_MODEL_SETUP]] 得到一条真实 Chat 回复。

当前已知边界：

- 模型卡“已配置”只表示保存了 Connection 与 remote model id；
- Provider `connected` 只表示最近一次模型目录同步成功；
- seed 的 Ollama 默认绑定可能在本地服务未启动、模型未下载时形成假就绪感；
- `openai-compatible-custom` 当前在 Runtime Resolution 中映射为 `volcengine` provider code，供应商中立身份尚未完全收口；
- Image / Voice 的全局角色绑定与 Studio provider config 尚未统一；
- `evaluation` role 当前用于评测包样本生成，不是 Run 的 Judge Model；
- Template capability 不是 per-model Vision / Tool / Context 能力探测；
- Provider Proxy 尚未为所有 adapter 统一归一化 Token 与成本；
- 模型设置导出文件包含可恢复的明文 API Key，必须按敏感凭据备份处理。

### Knowledge Base 与 RAG

完整事实见 [[KNOWLEDGE_BASE_CURRENT_TRUTH]]。

当前已经成立：

- 支持多个知识库，并保留不可删除的默认知识库；
- Knowledge Base 可以保存名称、描述、persona、scenario、tags 和 chunking config；
- 桌面工作台支持知识库 CRUD、文档搜索筛选、启停、详情和删除；
- 当前上传只接受单个 Markdown / TXT，最大 100 MB；
- 添加向导支持 Chunk 配置、抽样预览和索引状态轮询；
- Document 使用 `processing / ready / failed` 表达索引状态；
- 索引通过默认 Embedding role 生成向量并写入按知识库、模型、配置和维度派生的 sqlite-vec 表；
- 检索同时使用向量召回与 Orama 中文词法召回，并通过 RRF 融合；
- Rerank 可选，未配置或调用失败时降级为检索顺序；
- RAG Graph 当前执行 rewrite、embed、retrieve、rerank / fallback、generate；
- Chat thread 可以绑定一个 knowledgeBaseId，并持久化最终 sources；
- Main Agent 可以把知识库 sources 累积为 Retrieval Evidence；
- `knowledge_query` MicroApp 可以将企业微信智能机器人接入指定知识库。

当前已知边界：

- 索引队列只存在于 backend 进程内，不是 durable job system；
- KnowledgeBase.embeddingModelConfigId 已持久化，但实际索引和查询仍使用全局默认 Embedding role；
- 切换 Embedding 模型或维度不会自动重建已有索引；
- 桌面“重建索引”入口当前只显示 pending message，没有完成后端调用闭环；
- 添加向导第二步当前同时要求 LLM 与 Embedding，虽然索引后端的最小模型依赖是 Embedding；
- 数据库维护 FTS5 表，但当前主词法 Runtime 使用 Orama Mandarin cache；
- Agent retrieve 当前调用完整 RAG runnable，可能产生一轮被丢弃的生成调用；
- 当前一个线程只绑定一个知识库；
- Knowledge Base 不是长期记忆，也不是任意文档解析器。

### Evaluation

完整事实见 [[EVALUATION_CURRENT_TRUTH]]。

当前已经成立：

- 评测中心和新建评测工作台都有真实桌面入口；
- 支持从现有 Knowledge Base 生成 Evaluation ZIP，或上传单个 ZIP；
- Dataset 会解析 manifest、evalset、documents 清单、配置、样本和校验结果；
- Run 使用 `queued / running / completed / failed`；
- Sample 支持 Repeat、并发 workers、Timeout、Attempt 级错误和来源预览；
- Dataset、Samples 和 Run 会写入 SQLite，并在 Backend 启动时 hydrate；
- 支持 `retrieve` 与 `retrieve-generate` 两种模式；
- Run 结果包含 Retrieval 命中、生成启发式分数、延迟、失败数、日志和 Sample 明细；
- 评测中心支持搜索、详情、Markdown 导出和已结束 Run 删除；
- Markdown 报告可以包含配置、指标、Sample、来源、日志、Mermaid 图和客户端加权概览。

当前必须按真实算法解释：

- `evaluation` role 只用于生成评测包样本，不承担 Run 裁判；
- 自动 ZIP 中 documents 是占位文件，不保存 Knowledge Base 原文快照；
- Gold Source 当前只按规范化 documentName 精确匹配；
- Faithfulness / Relevance / Completeness 是词项重合启发式，不是 LLM Judge；
- 当前 `mrr` 不是实际 rank 的 reciprocal mean，而是命中与 Recall 的近似；
- Source Hit Rate 当前实质与 Hit@K 同义；
- retrieve 模式当前仍经过完整 RAG Graph 和 Generate，再丢弃 answer；
- Markdown weighted score 只存在于客户端报告，不是 Runtime 指标合同。

当前已知边界：

- Run 调度使用进程内 `queueMicrotask`，不是 durable job system；
- Backend 在 queued / running 时重启后，Run 会保留状态但不会恢复执行，且当前删除 API 会拒绝删除；
- Timeout 不会取消底层 RAG / Provider 请求；
- 任一 Repeat 失败会令 Sample failed，任一 Sample failed 会令 Run failed；
- Dataset 没有列表、详情和删除入口，可能形成孤立记录；
- Run 和 Dataset schema 当前没有 userId，不是多租户隔离合同；
- Center 无分页、无 Run Compare、Baseline、Retry、Cancel 或 Release Gate；
- 指标分数用于回归和定位，不替代真实产品验收。

### Agent

完整事实见 [[AGENT_CURRENT_TRUTH]]。

当前已经成立：

- `AgentRun` 是产品运行真相；
- `AgentGraph` 是稳定门面；
- Pi Loop 是应用默认 Main Agent Runtime；
- LangGraph 是显式兼容与测试对照 Runtime；
- Main Planner 维护 global goal 与下一步；
- concrete tool 经过 Normalize / Policy / Harness / Evidence；
- bounded multi-step work package 可以通过 `delegate_task` 交给 Generic SubAgent；
- 任务型 Skill 可以把领域施工交给 Skill-owned SubAgent 或 deterministic Skill Flow；
- Parent 保留 approval、recovery、terminal contract 与最终交付；
- SubAgent 是单层、受控、task-local execution，不是开放式多 Agent 系统。

当前已知偏差：recoverable recovery exhausted 被 `dev` 实现为 terminal error，和 settled guarded-answer C contract 不一致；该问题尚未在本轮文档整理中修复。

### Harness / Tool / MCP

完整工具事实见 [[TOOL_CURRENT_TRUTH]]。

当前已经成立：

- Harness 是 registry、公共面、暴露、边界、审批、执行、结果和审计控制平面；
- 公共 Read 面是 `read_discover / grep / read_open / codebase_explore`；
- 公共 Edit 面是 `write_file / replace_block / delete_path / move_path`；
- Search 区分公共互联网 `web_search` 与本地 News Hub `news_search`；
- `terminal_session` 是完整 host shell / PTY runtime，不是强隔离 sandbox；
- Managed Browser、Attached Browser、Mail、GitHub、问策和 External MCP 可以按真实 availability 进入工具面；
- <=20 个公共工具全部暴露，>20 才做 ranking 并暴露前 20；
- Mira 以 MCP Host 为主，external MCP 必须 connected、discovered、显式 Agent Access、approval 后执行；
- `delegate_task` 属于 Agent Runtime，不是普通 Harness Tool；
- Skill-private Runtime 不暴露给 Main Planner，也不能凭声明获得可用性。

当前已知 Tool 偏差：settled exact-invocation 审批口径包含 `toolCallId`，但 core matcher 当前只使用 `toolId + inputHash`；该问题本轮只记录，未修改 Runtime。

MCP 市场目录以 SQLite 为读取真相，官方 Registry 只作为 backend 同步源。空目录只取得首个 100 条页面，本地市场目录硬上限也是 100 条，不继续遍历官方游标。之后按 6 小时间隔增量更新；增量请求使用带 5 分钟重叠的 `updated_since` 并处理 deleted 条目。列表、搜索、分类、transport 与可安装性筛选优先查询本地目录，本地搜索未命中时可按需向 Registry 补充结果。

市场目录不保存 Registry 原始条目 JSON，只保存展示、搜索和安装需要的规范化字段。超出 100 条时优先清理 deleted、不可安装和长期未更新的市场记录；该清理不影响独立保存的已安装 MCP。市场同步失败不会清空最后一次成功数据；同一 backend 进程只运行一个同步任务。自动同步失败后按 1、2、4 分钟逐步退避，最长等待 6 小时；失败状态下普通列表读取不立即重试，手动刷新和应用重启仍可重新尝试。Settings -> MCP 会显示同步中、失败和最后成功更新时间，刷新按钮请求后台更新，不直接等待 Registry 返回列表。

### Skill

- Skill 是渐进式披露的领域能力包；
- SkillContext、ExecutionProfile、ToolExposure、Runtime readiness 与 Approval 是独立真相源；
- Context-only Skill 可以增强 Main Planner；
- Task Skill 可以使用 forked SubAgent；
- Stateful Skill Flow 是可选确定性 controller；
- V1 禁止 nested SubAgent 与 recursive delegation。

### Forge / 淬行

截至 2026-09-06，Forge 已作为 Mira 内部一级工程执行域接入，而不是独立 control-plane：

- Mira Server 在 `server/src/forge/**` 拥有 Forge runtime lifecycle、persistence、startup reconcile、Main Thread、Builder dispatch、Review 和 API routes；
- Desktop 产品入口为 **淬行**（`/forge`），标准 UI 与 Terminal View 共用同一份 `ForgeWorkspaceSnapshot`、typed API 和 orchestration；
- Forge Project Task Source 与 Forge Runtime Truth 分离；Mira 工程 work-item contract / outcome 由 GitHub Issue 持有，repository-native Task Card 只在 Forge 注册项目显式选择对应 task source 时作为领域输入，runtime 只保存执行引用与证据；
- Dispatch 是显式动作，当前保持全局单 active Builder；绑定 source Main Thread 时必须属于同一 project；
- Builder 正常完成只把 runtime task 推进到 `reviewing`，不等于 Repository PASS；
- Review 继续按 concrete SHA 绑定，只有当前 SHA 与 reviewed SHA 一致时才能执行 integration；
- terminal Builder result 会以 dispatch identity 幂等写入显式相关 Main Thread；下一次用户 turn 可消费新到达的 bounded handoff，Builder prose 不覆盖 authoritative runtime state；
- 当前 Mira runtime 不依赖旧 `:47831` standalone Forge server，也不需要 Forge 独立 package / lockfile / Vite build。

旧 T010、T015-T018 与固定源 work ledger 只作为 Forge 迁移时期的实现/验收证据追溯；它们不拥有当前 Mira Organization 的 work-item 状态或结果。Forge 当前 authority 与 Task Source 边界以 `forge/FORGE_CURRENT_CONTRACT.md` 和 Organization governance 为准。

### MicroApps Hub 与 MicroAPP Runtime

完整事实见 [[MICROAPP_CURRENT_TRUTH]]。

当前必须区分：

```text
MicroApps Hub
!= Integration MicroAPP registry
!= Studio Runtime
!= Agent Tool / Skill access
```

当前已经成立：

- 设置页 MicroApps Hub 是宽产品入口，包含 Studio、领域 Runtime、Skill、Tool / MCP 集成和外部连接；
- strict `MicroAppDefinition` registry 当前有七种 definition；
- 只有 `knowledge_query` 完成统一 external AccessPoint invoke，并且只支持 `wecom.smart_robot`；
- Image Generation、Computer Use、TTS、News Hub、CodeGraph 与智识进化库都有各自 Studio / service，但统一 MicroApp invoke 仍为 Studio-only 或未实现；
- Mail Center、文枢、GitHub 和问策在产品中心有真实能力，但不属于当前七种 strict definition；
- Image Generation 已有任务、实时进度、Artifact、Provider / ComfyUI；
- Computer Use 已有 managed browser、持久任务与 Evidence、模型执行器、审批和 Browser tools；
- TTS 已有 Windows、Piper、GPT-SoVITS 与 API Provider；
- News Hub 与 Mail Center 分别通过 `news_search` 与 `mail_query` 进入 Agent 工具面；
- 文枢通过 Skill-owned execution 与 private Runtime 工作；
- GitHub 通过连接入口和四领域 Harness tools 工作；
- Notion、智识进化库等能力仍需按部分实现或实验状态单独说明。

产品入口、definition、领域 Runtime、Integration invoke 和 Agent access 必须逐层证明，不能互相代替。

## 当前不能这样宣传

以下说法不属于当前真相：

- “配置了 Provider 就一定可以聊天”；
- “模型目录同步成功就是完整健康检查”；
- “所有 OpenAI-compatible 服务行为完全一致”；
- “所有模型都天然支持 vision、image、tool 等全部能力”；
- “全局默认模型配置已经统一管理 Chat、Image 和 TTS”；
- “所有 Provider 都可以准确显示 Token 与成本”；
- “评测模型已经承担 LLM Judge”；
- “评测包包含冻结的完整知识库语料”；
- “Evaluation 的 MRR、Faithfulness 等就是标准学术实现”；
- “评测 Run 可以在 Backend 重启后自动恢复”；
- “评测分数可以直接作为上线 Gate 或专业正确性证明”；
- “知识库支持任意文档格式自动解析”；
- “上传成功就代表索引和检索已经可用”；
- “切换 Embedding 后会自动重建已有索引”；
- “知识库索引任务可以在重启后自动恢复”；
- “Rerank 失败会阻断错误回答”；
- “Knowledge Base 就是 Mira 的长期记忆”；
- “Mira 已经是完整自主软件工厂”；
- “已经是成熟开放式多 Agent 平台”；
- “已经有 Agent V2、DAG scheduler 或并发 Agent 编排”；
- “所有 Skill 和 SubAgent 都可以获得任意工具”；
- “所有微应用卡片都来自同一套 Runtime”；
- “MicroApp definition 启用就代表领域 Runtime ready”；
- “所有 Studio 都可以被企业接入点或 Agent 自动调用”；
- “所有微应用和 POC 都已可用于生产”；
- “已经完成通用长期记忆系统”；
- “已经完成强隔离 Sandbox”；
- “Terminal 只能在 workspace 内执行”；
- “CodeGraph 仍只是文档计划”；
- “external MCP 安装后自动获得 Agent Access”；
- “手机端、服务器端和网页端已经是正式交付形态”；
- “文档里写过的计划就是产品承诺”。

## 稳定迭代的判断标准

一个功能只有同时满足以下条件，才适合进入当前真相：

- 有真实产品入口；
- 有明确边界与失败语义；
- 有代码锚点；
- 有可重复验证；
- 有回归保护；
- 文档写清已实现和尚未实现；
- 不依赖施工线程口头结论。

Provider 还必须额外说明：

- 是 Template、Connection 还是具体模型；
- 模型是否只存在于同步缓存；
- 绑定的是哪个 role；
- 当前 Runtime 最终解析到什么；
- `connected` 是目录同步还是业务调用验证；
- 是否走 Provider Proxy、本地模型 Runtime 或 MicroApp Studio；
- 凭据与备份如何处理。

Knowledge Base 还必须额外说明：

- 上传是否只创建 Document，还是索引已经 ready；
- 文档是否 enabled；
- 使用哪份 Embedding 身份和维度；
- 当前实际词法 Runtime；
- Rerank 是 applied 还是 degraded；
- Sources 是否来自真实检索；
- 是 Chat、Agent 还是 Integration 调用路径；
- 是否存在重建和重启恢复合同。

Evaluation 还必须额外说明：

- Package 是否包含真实语料快照；
- Dataset 是否绑定当前存在的 Knowledge Base；
- Run 调度是否 durable；
- Metric label 对应的当前公式；
- 分数是否来自 LLM Judge、启发式还是人工；
- failed 是完整失败还是部分 Repeat 失败；
- 报告是 Runtime Artifact 还是客户端即时生成；
- 是否具备重启恢复、Cancel、Compare 与 Release Gate。

MicroApp 还必须额外说明：

- 是否只是一张产品入口卡片；
- 是否有 strict definition；
- 是否有真实领域 Runtime；
- 是否支持 Integration invoke；
- 是否通过 Tool 或 Skill 进入 Agent。

## 真相优先级

1. 当前代码与可重复验证；
2. current-contract / current-snapshot；
3. 工程共同记忆；
4. 历史 task / review / project-control evidence；
5. design / plan / research / POC；
6. historical / superseded / archive。

代码和 settled contract 冲突时，必须同时公开当前行为与目标合同，不能用其中一个偷偷抹掉另一个。

## 维护规则

- 产品能力变化时先更新对应 current-contract，再更新这页；
- 新功能验证前只能进入 GitHub work-item 流程、验证证据或方案与实验；
- 当前文档超过 90 天未核验应显示过期；
- 无状态、无核验信息的文档进入待核验；
- 已知实现偏差必须写明影响与修复状态。
