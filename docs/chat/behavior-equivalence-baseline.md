---
status: current
owner: chat / agent-runtime
last_verified: 2026-09-17
layer: characterization
module: Chat
feature: BehaviorEquivalenceBaseline
doc_type: regression-baseline
canonical: false
related:
  - ../CHAT_CURRENT_TRUTH.md
  - ../uchat.md
  - ../AGENT_CURRENT_TRUTH.md
  - ../remote-access/mobile-host-protocol-v1.md
  - ../architecture/mira-next-engineering-package-plan.md
---

# Chat Behavior Equivalence Baseline — E02 / #146

> 这份基线用于 Mira Next E02：在任何“新 Conversation 默认进入 Agent Runtime”施工之前，先把当前 Normal Chat、RAG Chat、Agent Chat 的真实行为、必须保持的用户/协议结果、允许继续不同的语义以及当前已知缺口写成可验证矩阵。
>
> 它不是新的 Chat 真相源。当前事实仍以代码/运行时、`CHAT_CURRENT_TRUTH.md`、`uchat.md`、`AGENT_CURRENT_TRUTH.md` 为准。本文只把这些事实整理成后续 E05A / E05B 可以执行的回归标准。

## 1. Baseline identity

Characterized against Desktop `dev` base commit:

```text
503afb45e4586b46cd1079ea7ad4137d22686f79
```

Relevant E01 decision-boundary acceptance is already present in this base. E02 本身不改变 Planner、Normalize、Policy、Tool、Evidence、Knowledge Base、Remote/Mobile 或 UChat 合同。

## 2. Classification

本文使用四种分类，避免把当前缺陷误写成未来必须保持的合同：

| 分类 | 含义 |
| --- | --- |
| `EQUIVALENT` | 后续默认 Agent 迁移必须保持同等的用户可见或协议可见结果；内部实现可以不同。 |
| `INTENTIONAL_DIFFERENCE` | 当前路径语义本来就不同，E02 不强行统一；后续迁移必须显式决定如何承接。 |
| `CURRENT_LIMITATION` | 当前真实存在，但不是应被冻结的目标行为；迁移不能拿它当“兼容要求”。 |
| `NOT_APPLICABLE` | 该能力只属于某条路径或某层，不要求其它路径伪造等价实现。 |

## 3. Current routing truth

当前 `POST /proxy/chat/default` 的核心分流是：

```text
agentEnabled = true
  -> persisted default stream
  -> AgentRun

agentEnabled = false
+ knowledgeBaseId
+ authenticated thread
+ extractable latest user text question
  -> RAG stream

otherwise
  -> persisted Normal Chat
```

关键事实：

- Agent 优先于独立 RAG route；绑定 KB 的 Agent Thread 把 `knowledgeBaseId` 交给 Agent 作为 retrieval input，而不是进入 legacy RAG branch。
- 绑定 KB 但最新输入无法形成文本问题时（例如只有附件/图片），RAG 条件不成立，当前会落回 Normal Chat。
- Normal Chat 当前不进入 Main Planner；现存 default chat tool loop 在当前正常路由中不可达。

## 4. Behavior equivalence matrix

### 4.1 Thread / Message lifecycle

| Behavior | Normal Chat | RAG Chat | Agent Chat | Classification | Migration requirement |
| --- | --- | --- | --- | --- | --- |
| Welcome 不预建空 Thread | UChat 首次真实发送才创建 | 同 Normal | 同 Normal | `EQUIVALENT` | 默认 Agent 后仍不得仅因打开 Welcome 制造空历史。 |
| 最新 User Message 先持久化 | 是 | 是 | 是 | `EQUIVALENT` | 发送失败、取消或等待状态不得导致用户输入凭空消失。 |
| 成功 Assistant 进入 Thread history | `finishReason=stop` 且非空时持久化 | RAG 成功后持久化 answer + RAG metadata | Agent 最终交付投影为 Assistant；运行真相另有 AgentRun | `EQUIVALENT` + Agent 扩展 | 后续默认 Agent 必须保持 canonical Thread/Message 可读；AgentRun 不能替代用户可见 Message。 |
| 历史 parent linkage | Desktop hydration 线性重建 | 同 | 同 | `EQUIVALENT` | 不得因为默认 Agent 切换而改变当前线性历史合同。 |
| Edit / Regenerate | 重写当前 timeline，删除旧 tail | 同一 UChat/Thread 合同 | 同一 UChat/Thread 合同 | `EQUIVALENT` | 不要求在 E05A 顺便实现持久化分支树。 |

### 4.2 Streaming / finish

| Behavior | Normal Chat | RAG Chat | Agent Chat | Classification | Migration requirement |
| --- | --- | --- | --- | --- | --- |
| 文本增量进入 canonical Assistant | persisted chat SSE | RAG SSE answer chunks | persisted chat SSE 包裹 Agent final delivery | `EQUIVALENT` | 用户仍应看到连续 Assistant 文本流/最终文本，而不是只看到 AgentRun 状态。 |
| Execution / diagnostic nodes | request-context execution nodes 可出现 | RAG nodes / sources 可出现 | Agent execution nodes / tool trace 可出现 | `INTENTIONAL_DIFFERENCE` | 额外节点可以不同，但不得破坏 canonical text/message projection。 |
| 成功 finish reason | persisted Assistant 只在 `stop` + non-empty 下写入 | 成功 RAG 最终落 Assistant | Agent 最终交付仍经 persisted stream；AgentRun 另有 completed/waiting/failed 状态 | `EQUIVALENT` at Message layer; `INTENTIONAL_DIFFERENCE` at Run layer | E05A 回归必须同时看 Message finish 与 AgentRun terminal/waiting state，不能二选一。 |
| Title generation 阻塞主流 | 不阻塞；异步生成/回退标题 | RAG 自有 title flow | 不阻塞；与 Normal 共用 persisted path | `EQUIVALENT` | 标题失败不能让主回答失败或延迟 stream finish。 |

### 4.3 Cancellation

| Behavior | Normal Chat | RAG Chat | Agent Chat | Classification | Migration requirement |
| --- | --- | --- | --- | --- | --- |
| Desktop Stop 的用户可见行为 | abort Fetch、移除 optimistic Assistant、runStatus=`cancelled`、reconcile Thread | 同一 UChat 行为 | 同一 UChat 行为 | `EQUIVALENT` | 默认 Agent 后必须至少保持这一用户可见 Stop/reconcile 语义。 |
| Stop 是否证明 backend work 已取消 | 否 | 否 | 否；Agent/Tool 也没有由 UChat Abort 自动证明全部停止 | `CURRENT_LIMITATION` | 不得把“当前不保证 backend cancellation”写成未来必须保持的合同；若以后增强应另开任务。 |
| Remote Agent cancel | N/A | N/A | Remote manifest 暴露 `POST /agent/runs/:runId/cancel` | `NOT_APPLICABLE` / Agent-specific | E05A 不得破坏 Remote 对 Host AgentRun 的显式 cancel authority。 |

### 4.4 Error behavior

| Behavior | Normal Chat | RAG Chat | Agent Chat | Classification | Migration requirement |
| --- | --- | --- | --- | --- | --- |
| User Message 在失败后保留 | 通常保留 | 通常保留 | 保留 | `EQUIVALENT` | 默认 Agent 不得因失败删除已经持久化的用户输入。 |
| Error Assistant 是否 durable | 多数只是当前 UChat 内存；刷新后可能消失 | 同类限制 | Agent failure 细节主要在 AgentRun；不等于 durable visible error Message | `CURRENT_LIMITATION` | 不冻结“错误不持久化”为兼容目标；E05A 只需确保没有比当前更差并正确暴露 AgentRun canonical state。 |
| Terminal / waiting 状态 | 无 AgentRun | 无 AgentRun | `waiting_user` / `waiting_approval` / `completed` / `failed` 等由 AgentRun 持有 | `INTENTIONAL_DIFFERENCE` | 后续默认 Agent 必须把运行态与 Message history 分层保留，不能把等待审批伪造成普通 completed message。 |

### 4.5 Attachments / media

| Behavior | Normal Chat | RAG Chat | Agent Chat | Classification | Migration requirement |
| --- | --- | --- | --- | --- | --- |
| Canonical Message parts | `text/image/file/data` | 同一 Thread/Message parts | 同 | `EQUIVALENT` | 默认 Agent 不得要求新的历史消息格式才能读取旧附件。 |
| File text extraction | 最新 User File part 在生成前解析注入 | RAG route 仍要求可提取文本 question 才成立 | Agent 接收 canonical messages；具体读取/工具行为由 Agent 合同决定 | `INTENTIONAL_DIFFERENCE` | 不得把“有文件”自动等同于“进入 RAG”；也不得在 E02 重做文件语义。 |
| KB + attachment-only send | 当前 RAG input 可能为空，落回 Normal | 不进入 RAG | 若 Agent enabled 则走 Agent | `CURRENT_LIMITATION` / routing truth | 这是当前 characterization，不是未来默认 Agent 必须模拟的回退设计。 |
| TTS / Image post-processing | 成功 Assistant 后按 Thread 开关异步执行 | TTS 可用；自动 image 受 `no knowledgeBaseId` 等条件限制 | 成功 Assistant 仍走 Chat media lifecycle | `INTENTIONAL_DIFFERENCE` | 默认 Agent 后不能让文本回答完成依赖媒体任务成功。 |
| Attachment GC | uploaded-but-unsent / 普通 image 可能残留 | 同 | 同 | `CURRENT_LIMITATION` | 不属于 E02/E05A 等价目标。 |

### 4.6 Knowledge Base / RAG evidence

| Behavior | Normal Chat | RAG Chat | Agent Chat | Classification | Migration requirement |
| --- | --- | --- | --- | --- | --- |
| KB 决定执行路径 | 无 KB 或 RAG 条件不成立时进入 | `knowledgeBaseId` + 非 Agent + 文本 question | KB 不走独立 RAG route；作为 Agent retrieval input | `INTENTIONAL_DIFFERENCE` | E05A 必须保住“绑定 KB 仍可被 Agent 使用”的产品能力，但不要求复刻 legacy RAG 内部 pipeline。 |
| RAG source metadata | 无 | Assistant metadata 保存 question/topK/topN/sources/routeReason 等 | Agent 证据进入 Agent Evidence/Run；最终 Message 不应伪造 legacy RAG metadata | `INTENTIONAL_DIFFERENCE` | 后续需要定义用户可见引用如何从 Agent Evidence 投影，但 E02 不改变格式。 |
| 删除 KB 级联 Thread | 当前 schema 存在高严重度 CASCADE 缺陷 | 受影响 | 绑定 KB 的 Agent Thread 同样受数据库关系影响 | `CURRENT_LIMITATION` | 绝不能作为默认 Agent migration 的兼容要求。 |

### 4.7 Role / Summary / Provider selection

| Behavior | Normal Chat | RAG Chat | Agent Chat | Classification | Migration requirement |
| --- | --- | --- | --- | --- | --- |
| Role prompt | request-only context 注入 | request-only context 注入 | request-only context 注入 | `EQUIVALENT` | 默认 Agent 后继续尊重 Thread 绑定 Role prompt。 |
| Context Summary | request-only system context | 同 | 同 | `EQUIVALENT` | Summary 仍不可伪装成可见历史 Message。 |
| Role LLM numeric profile | 传入 persisted Normal path | 当前未统一传入独立 RAG route | 传入 persisted Agent path | `CURRENT_LIMITATION` | 不把当前 RAG 参数缺口冻结为未来合同；E02 不修它。 |
| `Thread.modelName` | 持久化/展示字段；默认 Provider 仍由 global `llm` role resolve | 不形成可靠 per-thread model contract | 同样不构成独立 Provider binding | `CURRENT_LIMITATION` | E05A 不得假称已有 per-thread model selection；若未来实现另开合同。 |
| Provider-native Planner decision | N/A | N/A | 由 E01 typed decision boundary + provider adapter 负责 | `NOT_APPLICABLE` | E02 不回退或旁路 E01。 |

### 4.8 Thread metadata and Remote/Mobile projection

| Behavior | Desktop canonical truth | Remote/Mobile-visible truth | Classification | Migration requirement |
| --- | --- | --- | --- | --- |
| Thread metadata | `modelName/workspaceId/knowledgeBaseId/roleId/agentEnabled/status/...` | Remote workspace thread projection保留 `modelName/workspaceId/knowledgeBaseId/roleId/agentEnabled/status` + counts/timestamps | `EQUIVALENT` | E05A 不能通过改默认执行路径而悄悄破坏这些已有 projection。 |
| Message history | `/threads/:id/messages` | Remote manifest 明确暴露该 canonical route | `EQUIVALENT` | Mobile 继续从 canonical Message history 恢复对话。 |
| Chat send | `POST /proxy/chat/default` | Remote manifest 暴露同一路由 | `EQUIVALENT` | 默认 Agent 切换发生在 Host truth owner；Mobile 不应被迫改成另一套私有发送协议。 |
| AgentRun read/control | AgentRun 是运行/审批/checkpoint/Evidence 真相 | Remote manifest 暴露 read + approve/reject/cancel | `INTENTIONAL_DIFFERENCE` | Message 与 AgentRun 两层都必须保留；不能用其中一层替代另一层。 |
| reconnect | Desktop canonical state | Remote manifest：`canonical-state-replay`, `eventCursor=false` | `EQUIVALENT` protocol requirement | E05A 后 Mobile background/foreground 恢复必须仍可通过 canonical replay 收敛。 |

## 5. Regression evidence map

E02 不为了“显得有测试”重复造平行 harness。当前已有测试若已经直接证明行为，就作为 characterization evidence；只有未来发现关键行为没有最低充分证据时才新增测试。

| Area | Layer | Existing deterministic evidence | What it protects |
| --- | --- | --- | --- |
| Default/RAG/Agent routing | T3 Runtime | `server/src/routes/proxy-provider/chat.routes.test.ts` | non-RAG -> persisted Normal；KB -> RAG；KB + Agent -> AgentRun；Agent enabled -> `createAndRunAgent`。 |
| RAG route predicate | T1 Unit | `shouldUseThreadRag` tests in `chat.routes.test.ts` | KB、text question、thread/auth 条件。 |
| Agent completed Message projection | T3 Runtime | `chat.routes.test.ts` — completed Agent metadata/message persistence cases | Agent answer persists once with `status/runId/traceId` metadata. |
| Stream finish independent of title generation | T3 Runtime | `chat.routes.test.ts` async title case | text/end/finish/[DONE] 不等待 title task。 |
| RAG metadata | T1/T3 | `server/src/routes/proxy-provider/rag-message-metadata.test.ts`, `server/src/routes/chat-rag.test.ts` | RAG source/question metadata projection and route behavior. |
| UChat send/hydration/error/cancel lifecycle | T1/T3 renderer runtime | `desktop/src/shared/uchat/core/runtime.test.ts` | optimistic message lifecycle、reconcile、run state、runtime ownership。 |
| Canonical protocol mapping | T1/T2 | `desktop/src/features/chat/core/protocol.test.ts` | backend Thread/Message/SSE -> UChat canonical objects/events。 |
| Thread persistence/metadata | T2/T3 | `server/src/services/thread.service.test.ts`, `server/src/routes/thread/threads.routes.test.ts` | Thread fields、Message history、summary/metadata persistence contracts。 |
| Attachment upload boundary | T3 | `server/src/routes/attachments.test.ts` | upload/validation/storage route contract。 |
| Remote thread projection | T2/T3 | `server/src/routes/thread/workspace-thread-page.routes.test.ts` | remote-safe Thread list projection/pagination。 |
| Remote manifest/scopes | T2/T3 | `server/src/routes/remote-access.test.ts`, `server/src/services/remote-device-auth.service.test.ts` | Message/Agent routes、scope boundaries、canonical replay declaration。 |
| Agent approval/run lifecycle | T3 | `server/src/routes/proxy-provider/chat-agent-approval.smoke.test.ts` + Agent route/runtime regressions | waiting approval、resume/control 与 canonical AgentRun state。 |

### 5.1 Evidence rule for E05A / E05B

后续迁移不得只引用“测试文件存在”。真正 Acceptance 时必须：

1. 针对实际迁移后的 candidate 重新运行相关 T1/T2/T3；
2. 用本矩阵逐项判断行为是 preserved、intentionally changed 还是仍受 current limitation 约束；
3. 任何 intentional change 必须由对应 E05 Issue 明确拥有，不能在 implementation diff 里偷偷发生；
4. Remote/Mobile projection 必须按 canonical Thread/Message + AgentRun 两层验证。

## 6. Human Runtime checks

E02 是 characterization 包，没有用户行为变更，因此下面的体验项不阻塞 E02 Engineering Gate；它们在 E05A promotion 时按实际变更面决定是否升级为 T4/Human Runtime blocking。

| Check | E02 gate | Later migration relevance |
| --- | --- | --- |
| streamed text 的视觉连续性、execution node 插入手感 | non-blocking | E05A 若改 stream projection，应在 test promotion 人工体验。 |
| Stop 按钮即时反馈 / optimistic Assistant 消失体验 | non-blocking | E05A 若改 run/cancel wiring，应人工确认。 |
| file/image attachment composer 与消息渲染 | non-blocking | 仅当 migration 改 attachment/message projection 时升级。 |
| TTS / generated image playback/rendering | non-blocking | 仅当 media lifecycle 受影响时升级。 |
| Mobile background/foreground 后的真实设备恢复手感 | non-blocking for E02 | E05A Mobile Remote Compatibility Gate 需要时进入 T4/Human Runtime。 |

## 7. Explicit non-regression rules for later default-Agent migration

E05A / E05B 使用本基线时至少必须满足：

1. 用户仍通过 canonical Thread / Message 读取历史；AgentRun 不能替代 Message history。
2. 已持久化 User Message 在失败、等待、取消后不得无故丢失。
3. 新默认 Agent 必须继续接受现有 canonical `text/image/file/data` Message parts。
4. 绑定 KB 的 Conversation 仍必须有可验证的知识检索能力，但不要求继续走 legacy RAG pipeline。
5. Role prompt 与 Context Summary 继续进入请求上下文；不得因为路由统一而消失。
6. Remote/Mobile 继续使用 canonical Host routes；不得另造仅 Desktop UI 知道的隐藏 Agent state。
7. Mobile reconnect 仍能通过 canonical state replay 收敛 Thread/Message/AgentRun。
8. waiting approval / approve / reject / cancel 仍由 Host authoritative AgentRun contract 持有。
9. Title、media 等后处理不得变成回答完成的阻塞前置。
10. 当前缺陷（backend cancellation 不完整、error Assistant 不 durable、KB CASCADE、Role numeric params 未统一、`Thread.modelName` 不驱动 provider 等）不得被误写成“必须兼容”。

## 8. E02 acceptance checklist

- [x] 三条当前路径按实际 route/runtime 映射，不从 Mira Next 目标架构反推现状。
- [x] 关键行为按 `EQUIVALENT / INTENTIONAL_DIFFERENCE / CURRENT_LIMITATION / NOT_APPLICABLE` 分类。
- [x] 现有 T1/T2/T3 regression evidence 映射到矩阵关键面。
- [x] Remote/Mobile canonical Thread/Message、AgentRun 与 replay expectations 被纳入。
- [x] Human Runtime-only checks 已列出，并明确 E02 阶段 non-blocking。
- [x] 矩阵明确禁止把当前已知缺陷当作 default-Agent migration 的兼容标准。

> 以上 checklist 只说明 baseline 文档已覆盖 Issue 要求的判断面，不等于 #146 已被接受或关闭。最终 Acceptance 仍必须依据 Issue 权限、PR/CI 与当前 candidate evidence 单独作出。
