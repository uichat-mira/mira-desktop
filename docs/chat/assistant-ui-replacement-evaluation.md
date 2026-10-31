---
status: planned
owner: chat
last_verified: 2026-10-31
layer: wiki
module: Chat
feature: UChatReplacement
doc_type: research
canonical: false
related:
  - ../uchat.md
  - README.md
  - ../CHAT_CURRENT_TRUTH.md
  - ../architecture/README.md
---

# assistant-ui 替代 uchat 的可行性评估

> 状态：**计划 / 研究**。本页是决策输入，不是当前合同，也不代表已经决定替换。任何替换实施都必须另开任务包并经项目所有者确认。

## 0. 结论摘要

1. **技术可行，但不建议当前整体替代 uchat。**
2. 运行时层可以换：assistant-ui 的 `ExternalStoreRuntime`（或 `LocalRuntime` + `ChatModelAdapter`）能承接 Mira 的 REST + SSE，但 uchat 的草稿、单 Run 锁、乐观状态对账、线性 edit 语义与 capabilities 需要在适配层重建。
3. UI 层替换是负收益：本项目聊天相关生产代码约 11,658 行、测试约 8,418 行 / 240 个用例，其中约 2,700 行是 Mira 专用（协议投影、媒体编排、Agent 审批、执行轨迹、Skill mention、Role / KB 绑定）。assistant-ui 提供的是通用聊天原语，换掉的恰是差异化部分。
4. 两个硬约束：其 styled 组件事实以 Tailwind v4 为基线（本项目为 Tailwind 3.4 + 自研 token 层）；官方没有 i18n 文案覆盖机制（本项目约 275 键/语言）。
5. 建议：维持 uchat；如需引入，只做隔离 Spike，不在主线替换。重新评估条件见 §8。

## 1. 评估版本与口径

### 1.1 用于对比的本地代码版本

| 项 | 值 |
| --- | --- |
| 产品 | UIChat Mira（`ui-chat-mira`） |
| 版本 | `0.105.0`（根 `package.json`） |
| 分支 / HEAD | `dev` / `1986ba704d6aa779080c47e45f388c1ad8599b52` |
| 评估日期 | 2026-10-31（Asia/Shanghai） |
| 对比代码范围 | `desktop/src/shared/uchat/**`、`desktop/src/features/chat/**`、`docs/uchat.md`、`desktop/package.json`、`desktop/tailwind.config.cjs`、`desktop/vitest.config.ts` |
| 规模（按 read 工具行数） | 生产 11,658 行 / 测试 8,418 行；35 个测试文件、240 个用例 |
| 工作区状态 | 未校验工作树是否 clean（评估环境 `pwsh` 不可用，无法执行 `git status`）；以读取到的工作区内容为准 |

分层规模：

| 区域 | 生产 LOC | 测试 LOC |
| --- | ---: | ---: |
| `shared/uchat/core` | 1,649 | 2,319 |
| `shared/uchat/ui` | 4,916（+10 CSS） | 3,721 |
| `features/chat/core` | 1,359 | 392 |
| `features/chat/adapters` | 337 | 501 |
| `features/chat/components` | 2,674 | 1,469 |
| `features/chat/i18n` | 723 | 16 |
| 合计 | **11,658** | **8,418** |

### 1.2 被评估对象版本

| 项 | 值 | 来源 |
| --- | --- | --- |
| `@assistant-ui/react` | **0.15.32**（评估当日 npm latest） | npm registry `…/latest` |
| `@assistant-ui/core` | **0.3.32** | npm / GitHub release |
| `assistant-stream` | **0.3.55** | GitHub release |
| GitHub `main` | `ff654d8156680b839774296ef644b57ab1078425`（2026-10-30T23:45:52Z） | GitHub API |
| 仓库状态 | 12,864 stars / 1,286 forks / 48 open issues；2026-10-31 仍有推送 | GitHub API |
| License | MIT | 仓库 / npm |
| 文档 / npm 元数据获取日 | 2026-10-31 | 本次评估 |

### 1.3 方法、证据与边界

- **只读评估**：未安装依赖、未构建、未运行测试、未改任何业务代码。
- **证据优先级**：上游 `.d.ts` / 源码 > 官方文档 > 仓库元数据；本地结论优先来自实际文件与行号。
- **未在本机验证的项**（见 §9）：Tailwind v4 兼容性、图片 URL 清洗行为、遥测零外联、React 18 运行时表现、Electron 内实际打包行为。
- 本地 LOC 为文件总行数，不是 `wc -l` 精确统计；误差不影响量级判断。

## 2. assistant-ui 是什么（与本项目相关的部分）

- **分层**：core runtime（`LocalRuntime` 拥有状态 / `ExternalStoreRuntime` 状态归宿主）→ 协议适配（AI SDK、DataStream、AssistantTransport、LangGraph、Mastra 等）→ React primitives。
- **UI 交付**：npm 包只导出 headless primitives；带样式的 `Thread` / `Composer` / `ThreadList` 通过 `npx assistant-ui init` **复制源码进仓库**（shadcn registry），绑定宿主自己的语义 token，不随 npm 升级。
- **数据模型**（`@assistant-ui/core` `types/message.ts`）：`text`、`reasoning`、`image{image}`、`file{data,mimeType,filename}`、`source`、`data{name,data}`、`tool-call{toolCallId,toolName,args,result,approval,interrupt}`、`generative-ui`。`data` part 与 uchat 的 execution node 可以对应。
- **能力按回调开启**：`useExternalStoreRuntime` 必填仅 `onNew`；`setMessages` 开启分支，`onEdit` 开启编辑，`onReload` 开启重新生成，`adapters.attachments` 开启附件（含上传进度）。
- **传输**：`AssistantChatTransport` 只接受 AI SDK UI message stream 帧格式（`x-vercel-ai-ui-message-stream`）；任意自定义 SSE 需要自行解析成快照（ExternalStore）或在 `ChatModelAdapter.run` 内解析（LocalRuntime）。
- **版本节奏**：0.x，同日多包发布；`unstable_` API 可在 patch 版本改变语义；无 1.0 semver 承诺；ESM-only；硬依赖含 `assistant-cloud`、`assistant-stream`、`radix-ui`、`zustand`、`zod`。

## 3. 能力对照

| 能力 | uchat（本地证据） | assistant-ui | 结论 |
| --- | --- | --- | --- |
| Thread 列表 / hydration | `loadThreads` / `selectThread`，轻摘要 + 按需 hydration（`core/runtime.ts`） | ThreadList primitives + 适配器；分页 `loadMore` | 可映射，加载策略需重写 |
| 每 Thread 草稿 | `composerDrafts` + `__welcome__` 键（`core/store.ts`） | 单 runtime 单 composer；`backgroundThreads` 才有隔离 | **不直接支持** |
| 乐观发送 + 对账 | 先插 user/assistant，完成后 `refreshThread + loadThreads`，保留 runtime-only data part / toolTrace / 错误气泡（`core/runtime.ts:90-178`） | `isOptimistic`、`activeRunId`，不承诺同等合并语义 | **需自建** |
| SSE | 9 种 `ChatRunEvent`；SSE 事件 `text-delta` / `data-rag-sources` / `data-rag-node` / `data-execution-node` / `data-tool-event` / `error` / `finish`（`features/chat/core/protocol.ts:308-380`） | 自定义 SSE 不能直喂 | 适配层 |
| Stop | `AbortController` + 移除乐观 assistant | `onCancel` / `cancelRun` | 可 |
| Edit / Regenerate | 同 id 写回 + 截断尾 + 后端删旧 tail（线性替换） | `onEdit` / `onReload`，模型是分支树 | 语义不同 |
| 分支 / 版本 | 明确不支持 | BranchPicker + `setMessages` | 能力过剩，需关闭 |
| 附件上传 | 三态 + `POST /attachments` | Attachment adapter（`add/remove/send`，含 progress） | 可映射 |
| Tool trace | 消息级 `toolTrace[]` 独立渲染（`UChatToolTrace.tsx`） | `tool-call` part 内联渲染 | 结构不同 |
| 执行轨迹 / RAG 来源 | `data` part + 935 行 trace/parser + 两个抽屉 | 无对应概念，需以 `data` part 自渲染 | **必须自建** |
| Agent 审批 | 后端 AgentRun checkpoint + `AGENT_RUN_UPDATED_EVENT` + 内联审批 UI（`features/chat/components/UChatThread.tsx:518-550`） | `approval` / `interrupt` 为工具级原语 | **不匹配** |
| TTS / 生图 | `chatMediaOrchestration.ts` 挂 `afterSendSuccess`，含轮询与持久化 | 只有 speech / dictation adapter | **必须自建** |
| Skill / Toolkit mention | 503 行组件 + `runOptions.requestedToolGroupIds` | 无 | **必须自建** |
| i18n | 约 275 键/语言，12 个文件消费 | 官方无 locale / 文案覆盖 API（截至评估日） | 替换即重写 |
| Markdown / Mermaid | streamdown 2.5 + mermaid 11 + katex | 需另装 `react-markdown` 注册项 | 可替但换栈 |
| 长线程虚拟化 | 未做 | 不自带，需 `@tanstack/react-virtual` 自拼 | 无净收益 |

## 4. 关键差异

### 4.1 消息模型

- uchat：`{ type: 'text' | 'image' | 'file' | 'data' }` + 消息级 `toolTrace` + `metadata` + 线性 `parentId`（`shared/uchat/core/types.ts`）。
- assistant-ui：`image` 字段是 `image`（不是 `source`）、`file` 用 `data`、`data` 为 `{name,data}`；`tool-call` 是 part 而非消息级数组；assistant 不允许任意 part，system 只能一个 text part。
- 影响：`image` / `file` / `data` 可转换；`toolTrace` 需要拆成多个 tool-call part 或放 `metadata.custom` 自渲染；分支语义需从线性链另建。

### 4.2 运行时语义

- uchat：单 runtime 单 Run（`activeRunThreadId`，`regenerate` / `editUserMessage` 显式拒绝并发）；切线程不重建 runtime；错误气泡可能仅存内存；发送后对账以 backend truth 收敛。
- assistant-ui：一个 runtime 一个线程状态 + 一个 `isRunning` / `activeRunId`；跨线程并发需 `RemoteThreadListRuntime` + `backgroundThreads`；默认切换线程会卸载 hook 并结束 Run；`onRefetchThread` 语义与我们的 reconcile 不同。
- 影响：替换后必须重新定义"切线程是否中断发送""错误是否可见""刷新后 trace 是否保留"等当前已固化行为。

### 4.3 审批与工具

- uchat 的审批属于后端 AgentRun checkpoint，前端通过 `AGENT_RUN_UPDATED_EVENT` 同步并调用 approve / reject。
- assistant-ui 的审批是工具调用 part 上的 `approval` / `interrupt`，由运行时分发 `onRespondToToolApproval`。
- 映射需要后端 SSE 产出工具级 part 形态，属于**协议级改动**，超出 UI 替换范围，需单独设计并确认。

### 4.4 UI 交付与设计系统

- 本项目设计系统：`desktop/src/shared/ui` + Tailwind 3.4 + 186 行 `--chat-*` 自定义 token（`desktop/tailwind.config.cjs:124-199`）+ Radix Themes；气泡、滚动条、字号均为定制。
- assistant-ui 的 styled 组件以 Tailwind v4 为事实基线（registry 含 `tw-shimmer`，使用 v4-only 工具类），且不使用 Radix Themes；复制进来意味着 v4 升级或全量重写样式。
- 只借 primitives 可以绕开 Tailwind 版本，但样式、无障碍、滚动行为全部回到自己实现，等于放弃其模板价值。

### 4.5 生态与维护风险

- 0.x、高频发布、`unstable_` 可在 patch 变语义 → 只能 pin 精确版本并自建升级验收。
- ESM-only；依赖 `assistant-cloud`（即使不用云，也随包安装）。
- 文档与示例变化极快，不能当契约；以 `.d.ts` 为准。
- 官方 Electron 指南存在（绝对 URL + CORS/CSP，或 `protocol.handle`），说明其认可 Electron 场景。

## 5. 候选路线

| 路线 | 内容 | 主要成本 | 主要风险 | 结论 |
| --- | --- | --- | --- | --- |
| A 全量替换 | 换 runtime + UI，后端改 AI SDK UI message stream | 约 1.1 万行生产代码 + 240 用例重写；Tailwind v4；i18n 重建；估算 6–10 人周量级 | 产品语义（trace / 审批 / 媒体）丢失；回归面大 | 不建议 |
| B 混合 | 保留 uchat core / drivers，用 `useExternalStoreRuntime` + primitives 渲染 | 适配层 300–500 行起；重写 `UChatThreadView`（1,514 行）；双状态同步；估算 3–6 周到等价 | 切线程 / 单 Run / 对账语义需重新验证；长期跟 0.x 升级 | 仅在确定换 UI 时考虑 |
| C 维持 | 保留 uchat，把 assistant-ui 当参考实现；新入口可试点 | 0 | 无 | **当前推荐** |

> 估算为工程判断，不是实测；不包含产品回归、视觉走查与发版验证。

## 6. 风险清单

1. **Tailwind v4 门槛**：styled 组件需 v4；primitives 不受版本约束但样式自写。
2. **i18n 空白**：无 locale API，文案硬编码在复制组件内。
3. **图片 URL 清洗（待 Spike 验证）**：AI SDK 转换链路据称只接受 `data:` / `https:` / `blob:`，本地 `http://127.0.0.1` 图片可能被丢弃；ExternalStore 自渲染可绕过，需实测。
4. **遥测 / 云**：`assistant-cloud` 为硬依赖；`cloud.telemetry` 默认开启（run 报告、事件、部分消息）。不配置 `AssistantCloud` 时未发现上报路径，但**未做逐行审计与断网验证**，本地优先场景必须验收。
5. **0.x 与 ESM**：pin 版本；Vite 可用，主进程 / 脚本 `require` 不可用。
6. **模型差异**：字段名、part 约束、toolTrace 结构、system 消息限制。
7. **行为差异**：分支 vs 线性；切线程可能中断 Run；错误持久化与对账语义不承诺。
8. **测试环境**：vitest 全局 `node` + 逐文件 jsdom、`fileParallelism: false`；240 用例是安全网，不是迁移的免费保障。
9. **影响半径溢出 chat**：4 个非 chat feature（Settings/Tools、Personas、Role Preview、Extensions/Capabilities）复用 uchat UI，`shared/utils/prompt-injection` 复用 core 类型。
10. **历史信号**：后端仍保留 `metadata.assistantUi` 兼容字段与 canonical 清理服务，说明此前有过同类 UI 投影层并留下存量数据兼容；如迁移需处理存量 metadata。

## 7. 若引入：最小验证清单（Spike DoD）

只在隔离分支 / 临时 demo 中做，不动主线：

1. `useExternalStoreRuntime` + 现有 Mira SSE，单线程只读渲染历史（含 image / file / data part）。
2. 发送 → 流式 → 取消 → 重新 hydration 对账；验证不串线程、不丢 data part。
3. `toolTrace` 与 execution trace 以自定义 part 渲染，交互与现状等价。
4. 附件上传（进度 / 失败 / 移除）。
5. Tailwind 3.4 + 自定义 token 下 primitives 样式可控、暗色主题正常。
6. i18n（至少 zh-CN 全量文案）与 React 18.3 测试通过。
7. Electron 内断网 + 本地图片 URL 实测：零外联、图片可见。

任一项失败即回到"维持"路线。

## 8. 建议与决策触发条件

**建议：维持 uchat。**

- 收益错位：assistant-ui 的长处是通用聊天 UX；本项目差异化在通用库没有的执行轨迹、RAG、审批、媒体与 i18n。
- 成本不对称：替换需重写 1.1 万行生产代码与 240 个用例，并长期承担 0.x 与 Tailwind v4 成本。
- 风险不对称：本地优先应用对图片 URL、遥测、离线行为敏感，引入即增加验收面。

**重新评估条件（满足其一再启动 B 路线）：**

1. 产品决定收敛到标准 Agent 聊天体验，愿意放弃自研 trace / 审批 / 媒体形态；
2. 需要 React Native / Ink 多端一致，其多平台原语成为硬需求；
3. 自研聊天 UI 的维护成本（bug / 无障碍 / 滚动）持续超过替换成本；
4. 需要 MCP App / generative UI 等新交互，且社区实现明显领先。

## 9. 待验证问题

- Tailwind v4 是否只影响复制组件；v3 项目能否长期只消费 primitives。
- 图片 part 的 URL 限制是否只存在于 AI SDK 转换链；ExternalStore 路径是否完全绕过。
- 不配置 AssistantCloud 时是否存在其它上报路径（建议断网抓包）。
- 切换线程 / 重挂 hook 时 Run 的确切结束语义。
- React 18.3 + Vite 5 + Electron 45 的实际运行表现（官方主测 React 19）。
- 多线程并发 Run 与当前"单 Run"产品约束的兼容方案。

## 10. 参考

上游：

- https://www.assistant-ui.com/docs
- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/runtimes/custom/local-runtime
- https://www.assistant-ui.com/docs/runtimes/custom/data-stream
- https://www.assistant-ui.com/docs/guides/electron
- https://github.com/assistant-ui/assistant-ui（`packages/core/src/runtimes/external-store/external-store-adapter.ts`、`packages/core/src/types/message.ts`、`packages/core/src/adapters/attachment.ts`）

本地：

- `docs/uchat.md`
- `desktop/src/shared/uchat/core/types.ts`
- `desktop/src/shared/uchat/core/runtime.ts`
- `desktop/src/shared/uchat/core/store.ts`
- `desktop/src/features/chat/core/protocol.ts`
- `desktop/src/features/chat/core/runtime.tsx`
- `desktop/src/features/chat/adapters/chatMediaOrchestration.ts`
- `desktop/src/shared/uchat/ui/UChatThreadView.tsx`
- `desktop/src/shared/uchat/ui/UChatThreadSlots.ts`
