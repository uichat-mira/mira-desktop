---
status: planned
owner: agent-runtime
last_verified: 2026-10-17
layer: raw-source
module: Agent
feature: ManagedBrowser
doc_type: design
canonical: false
related:
  - ../TOOL_CURRENT_TRUTH.md
  - ../harness/README.md
  - ../tooling-runtime/tools-protocol.md
---

# Managed Browser v1 — Agent Tool 语义契约（已审定设计，待实现）

> **文档状态：已审定目标契约，不是现有可执行工具列表。** 工作项 [AGT-004 / #357](https://github.com/uichat-mira/mira-desktop/issues/357)；总边界 [#316](https://github.com/uichat-mira/mira-desktop/issues/316)。这份文档定义 **Mira-owned Playwright** 的首版目标工具语义、边界和验收点，作为 #359–#365 的后续实现依据；任何 Tool 施工仍需按各实施卡单独授权。当前真实 Tool 状态以源码及 `docs/TOOL_CURRENT_TRUTH.md` 为准。

## 1. 一句话结论

**一个 `browser` Capability，原生 Managed Playwright Runtime，多个语义明确的原子 Tool；沿用二期 Harness 渐进式披露与权限管线。** 不建立 Browser 专用 Planner；不为统一命名迁移触界；不把浏览器操作塞进 `web_search/web_fetch`。

```
用户意图 -> browser Capability (Mira-owned Managed Browser)
            -> 现有 Runtime Readiness / Agent Capability View
            -> 小型工具元数据 -> 按需展开单个 Tool schema
            -> Normalize -> Policy -> Approval -> Harness Invocation
            -> BrowserService / SessionManager / Playwright
            -> Tool Result / Artifact / Evidence
```

- **Capability** = 可操作交互网页；**Tool** = 单个具体动作；**Runtime** = Playwright 会话/页面；**MCP** = 可选对接协议，**不是** Managed Browser 的必经路径。
- **Managed session** 由 Mira 创建、限定、复用、超时回收；它不是用户正在使用的 Chrome，也不继承触界的页面、Cookie 或登录态。请求“我当前 Chrome 的网页”必须走明确的 Connected 能力，不能自动切换为 Managed。
- 触界现有 `browser_attached_*` / Chrome Extension / WebBridge / 剪藏 / 专家协作 **本期完全不变**；其 first-party MCP 化由后续独立工作负责。
- `web_search` / `web_fetch` 仍负责公开网页检索和读取；只有交互、动态页面状态、会话/UI 操作等需要时才选择 Browser。
- 基于 [#292](https://github.com/uichat-mira/mira-desktop/issues/292) 的 readiness 和 [#301](https://github.com/uichat-mira/mira-desktop/issues/301) 的 scoped progressive disclosure。不得另建 Tool Search、权限或披露预算；Runtime `ready` 只表示先决条件可用，不保证具体网页任务成功。

## 2. 真实实现基线（2026-10-17 / dev）

源码锚点：

- `server/src/mcp/tools/browser-tools.tool.ts`：当前同时注册原子 Browser Tool 与旧 `browser_observe / browser_act` 兼容 Tool。AGT-012 cutover 后，Main / Generic Agent 的 `agent_intent` 暴露只包含原子 Tool；旧两个 ID 仅为 Computer Use Studio / Debugger 的精确调用兼容保留，不再属于 Agent 可发现能力。`browser_assert` 保留为正式 v1 Tool。
- `server/src/microapps/computer-use/browser/service.ts`：自制可见 DOM 清单（不是完整 ARIA/Accessibility Snapshot），`data-cu-ref` 元素引用、snapshot 文本哈希、可见正文、全页截图 Artifact；BrowserService 有单会话动作排队和基础超时。
- `server/src/microapps/computer-use/session/manager.ts`：单页 Playwright session，支持启动/关闭、domain/scheme 检查；已有可选 `sessionTimeoutMs`，当前 Agent 自动创建时未配置有限空闲时长；**不存在**已完成的多标签选择契约。
- `server/src/microapps/computer-use/browser/types.ts`：`BrowserToolResult` 已包含 `ok / sessionId / invocationId / page / observation? / assertion? / artifacts / error?`。
- `server/src/harness/profiles/resolver.ts`：一级 `browser` Profile 继续拥有 Managed Browser 产品表面；`browser_computer_use` 仅作为旧持久化/分组输入的兼容身份读取，不投影进 Agent capability-search metadata。`browser_attached` 仍是独立 Profile。Profile 的 Tool ownership 与初始 schema disclosure 分离，避免分组选择时一次性展开整个 Browser catalog。
- `server/src/index.ts` + `server/src/harness/managed-browser-readiness.ts`：[#355 / AGT-003](https://github.com/uichat-mira/mira-desktop/issues/355) 已在 dev 将三个 Managed Browser Tool 接到同一个运行时的 Harness Readiness Resolver；该完成项**不**等于已经做过真实 Playwright 浏览器烟测。

**现有安全缺口，不能用“已有 snapshotHash”掩盖：** 当前 hash 来自 snapshot **字符串**，Ref 编号在重新观察时重新分配。即使文本看起来一样，旧元素也可能被替换；哈希匹配不等于 DOM 节点身份匹配。#359 必须给出浏览器支撑的验证证据，未通过前不能宣布新原子点击/填值已具备可靠 stale-ref 防护。导航 URL 的初始 allowlist 也不能自动证明后续重定向、脚本导航或弹窗始终在边界内。

## 3. v1 工具清单：P0 10 个，P1 2 个

**这是目标 ID，不是当前 registry 已支持的 ID。** P0 中 `browser_assert` 保留现有语义，是**按需测试工具**而非每一步强制验证。P1 的标签页能力单独验收；下载不捆绑在标签页卡里。下表“审批”是**设计预期**，与现行 `browser_act` 权限不同的地方必须单独评审才能生效。

| 阶段 | Tool ID | Agent 何时选它（与相邻工具的边界） | 最小 Agent 输入（目标 schema） | 结果要证明什么 | 来源 / 施工卡 | 审批预期 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | `browser_navigate` | **显式前往 URL**、首个页面启动；不是点某个链接 | `url: string`（受域名和 scheme 策略约束） | 实际最终 URL、标题、最新页面观察/错误 | 现有 `act.navigate` + SessionManager；[#360](https://github.com/uichat-mira/mira-desktop/issues/360) | 是，保留现有 act 网络动作门槛 |
| P0 | `browser_snapshot` | 为下一次操作**看清当前 DOM/元素**；不是抽取业务结构化表格 | `includeVisibleText?: boolean, maxSnapshotChars?: number` | 有限快照、可见文本、refs、`snapshotHash`、截断标记 | 现有 `observe`；**独立 Tool facade/schema/registry/readiness + snapshot/ref 安全**归 [#359](https://github.com/uichat-mira/mira-desktop/issues/359) | 否（仍经 Policy） |
| P0 | `browser_screenshot` | 需要视觉证据/布局时，独立于 DOM 快照 | `fullPage?: boolean`（默认 full-page；如果只支持全页，应拒绝未实现模式） | 图像 Artifact 的 URI/ID + 所属页面身份 | 现有 `observe(includeScreenshot)` 可复用；**独立 Tool facade/schema/registry/readiness**归 [#359](https://github.com/uichat-mira/mira-desktop/issues/359) | 否（仍经 Policy） |
| P0 | `browser_click` | 点**刚观察到的元素 ref**；不接受伪造 selector / 无关联坐标 | `pageUrl, snapshotHash, ref` | 实际动作结果、新页面状态或明确 stale 错误 | 现有 `act.click`，安全 ref 归 #359；[#361](https://github.com/uichat-mira/mira-desktop/issues/361) | 是 |
| P0 | `browser_fill` | 将表单控件**最终值设置**为指定文本；与逐字 `type` 不同 | `pageUrl, snapshotHash, ref, value: string` | 实际已填值/结果状态；不应 append 或默默更换目标 | Playwright PageLike 已有 `fill`，当前 `act` 只暴露 `type`；#361 | 是 |
| P0 | `browser_press_key` | 对观察到的输入/可操作控件发送键或组合键；不是 fill | `pageUrl, snapshotHash, ref, key` | 实际按键执行/作用后的页面状态 | 现有 `act.press`；[#362](https://github.com/uichat-mira/mira-desktop/issues/362) | 是（Enter 可能提交） |
| P0 | `browser_select_option` | 选择原生 `<select>` 项；不拿 fill 模拟 | `pageUrl, snapshotHash, ref, value` | 实际选中值；目标不是 select 时清晰失败 | 现有 `act.select`；#362 | 是 |
| P0 | `browser_scroll` | **移动当前页面视口**；不是导航、也不是等待 | `pageUrl, snapshotHash, x?: number, y?: number`（有限数值，至少有一个非零偏移） | 可观察视口变化/结果；无法滚动要如实说明 | 现有 `act.scroll`；#362 | 是（可能触发懒加载） |
| P0 | `browser_wait_for` | 等待**将来**的网页条件成立；不是当前状态断言 | `condition: {kind: "text", value} \| {kind: "url", value} \| {kind: "visible", ref, pageUrl, snapshotHash}, timeoutMs?`；visible 必须验证 Runtime 持有的稳定元素身份 | 条件满足才 `ok=true`；过期必须明确 `timeout` | 现有 `act.wait` 轮询文本/ref，目标条件需补齐；#360 | **是（v1 保守门槛）**：沿用当前 `browser_act.wait` 的审批要求；后续免审批提案需单独签核 |
| P0 | `browser_assert` | **现在**对标题、URL、文字、元素可见性、输入值作严格断言；不是等将来 | `assertion: {kind, expected?/ref?}`（保留现有 ID/联合；visible/value 的 ref 必须匹配 Runtime 绑定的最新观察身份） | `assertion.passed`；失败是显式失败，不是“执行成功” | **已存在** `browser_assert`；#365 验收 | 否 |
| P1 | `browser_tabs_list` | 需要理解**当前 Managed 会话**有哪些标签页 | 无业务参数 | 同会话 tab ID/URL/标题/选中项；不得列触界 Chrome 标签 | 目前仅单页引用；[#363](https://github.com/uichat-mira/mira-desktop/issues/363) | 否 |
| P1 | `browser_tab_select` | 在**同一 Managed 会话内部**明确切换 tab | `tabId`（由 list 获得） | 选中 tab 身份和新页面观察，旧 refs 失效 | 需要 SessionManager 多页面建模；#363 | **是（v1 保守门槛）**：待实现时必须复用同一 Harness 审批管线 |

### 使用意图示例

| 用户/任务要求 | 首选 Tool | 不应该用 |
| --- | --- | --- |
| “打开 example.com” | `browser_navigate` | `browser_click`（不存在被点击元素） |
| “这个按钮在哪里？我可以点哪个？” | `browser_snapshot`，必要时 `browser_screenshot` | `browser_extract`（尚未交付） |
| “点击结算” | `browser_snapshot` → `browser_click`（必须经过审批） | 直接猜 `ref` 或 URL |
| “把搜索框改成 Apple” | `browser_fill` | `browser_press_key` 连发字符，或 `type` 假装填值 |
| “按回车执行搜索” | `browser_press_key` | `browser_fill` |
| “等列表出现” | `browser_wait_for` | `browser_assert` 的即时检查 |
| “确认标题必须是订单页” | `browser_assert` | 无条件多次 `wait_for` |
| “在 Mira 打开的另一个标签中找文件” | `browser_tabs_list` → `browser_tab_select`（P1） | 触界标签管理工具 |

**观察工具单独交付责任**：[#359](https://github.com/uichat-mira/mira-desktop/issues/359) 负责实际定义/注册 `browser_snapshot`、`browser_screenshot`，并沿用现有 Playwright BrowserService、session 归属、Artifact 和 Readiness。无会话时应明确失败（首次导航初始化由 #360 负责），`browser_screenshot(fullPage=false)` 在底层尚不支持时必须拒绝，不能声称截取了当前视口。#364 只消费这两个真实 Tool 的 metadata 进行 `browser` Profile/披露映射，不负责代写 Tool 实现。

## 4. 输入、输出与风险的不变量

### 4.1 Session 和页面归属

- **不暴露**给模型 `sessionId`、Playwright Browser/Context 对象、可执行文件路径、Cookie、存储状态或本地 Artifact 根目录作为任意可设置的调用参数。`sessionId` 可以保留在当前受控 Tool 结果及 trace 内，不能让它变成跨 thread 复用授权凭据。
- 首次 `browser_navigate(url)` 在当前 Agent scope 下创建独立 Managed session；后续原子 Tool 使用 Harness 注入/解析的会话绑定。不允许因缺失 session 自动转去触界；无绑定时结构化 `session_unavailable`。
- 当前代码以 `threadId` 暂存 session 关联并做 headless 初始化。目标必须保持主/子 Agent scope 边界、空闲超时、停止清理及多会话隔离，具体由 #358 验收；本契约**不自行规定新的持久化设计**。
- 当前首个 URL 的 hostname 成为 allowlist 起点；后续明确导航必须受配置中的 schemes/domains 约束。**不允许为了跨站任务悄悄扩大 allowlist**。重定向、弹窗、自动导航、`file:` 等旁路需要独立安全验证；超出授权范围应阻断或报告，不得假定现有实现已完全覆盖。
- P1 `tabId` 必须只指向当前 session/context；切 tab 使旧快照和 refs 全部失效。关闭标签、创建标签、分组、下载都不在本次 P1 范围。

### 4.2 观察 → 交互 → 再观察

- Managed Browser 的元素 ref 以 **Playwright AI aria snapshot** 为唯一 DOM 身份来源。Runtime 使用 `page.ariaSnapshot({ mode: "ai" })` 生成 `[ref=e2]` / `[ref=f1e3]` 等临时引用，并只通过 `page.getByRef(ref)` 解析目标。Playwright 的 ref 解析针对该元素所在 frame 的**最新一次 AI snapshot**；被替换/卸载的原节点不会把旧 ref 转移给外观相同的 clone。
- `pageUrl` 与 `snapshotHash` 继续属于观察和审批证据：Agent 使用最新结果中的冻结参数发起动作，Runtime 验证它们仍对应当前接受的观察；但 **`snapshotHash` 只是 snapshot/text 的内容指纹，不是 DOM 节点身份或观察代次本身**。不能因为 hash 相同就认定两个 DOM 节点相同，也不再维护第二套 ElementHandle/ref 身份表来补强 hash。
- 元素 ref 是**临时引用**，不是稳定 CSS selector 或永久 ID。新的 AI snapshot 会刷新 Playwright 的 ref 映射；Playwright 1.64 在主 frame 进入新 document 时还会重新编号 frame sequence，使后续 AI ref 带新的 `f<seq>` 前缀，旧 injected-document 的 `aria-ref` 映射不会解析到新 document。因此 `click/type/press/select`、`assert.visible/value` 等 ref 操作必须使用 Runtime 当前接受的最新观察，并由 `getByRef()` 解析。若 ref 从未出现在该观察中，返回 `ref_not_found`；若已观察的原节点后来 detached/replaced/navigation 失效，返回 `stale_snapshot`，不得重绑到 selector、文本相似节点或 clone。
- `wait_for.visible(ref)` 有一个刻意的例外流程：先用 `pageUrl + snapshotHash + ref` 验证调用针对当前接受的观察，然后在等待期间**保持这份 Playwright AI snapshot 的 ref 映射不变，不重复采集 AI snapshot**。这样，同一个已观察节点可以暂时变成 `display:none` / `visibility:hidden` 后再次可见并满足等待；如果原节点 detached/replaced，`getByRef(ref)` 不再解析到它，等待立即以 stale 失败。等待成功后才重新 snapshot 并返回新的页面观察。
- `navigate`、`click` 可能改变页面或 tab；返回真实最新页面状态。随后如要再动作，必须依据新的观察和有效 ref，不准继续用旧 ref 批处理。URL/navigation 变化也会使基于旧观察的 visible wait stale。
- `wait_for` 是可中断、有上限的条件等待，**条件不提供或超时不算成功**；`wait_for.visible(ref)` 只支持来自有效观察的既有元素身份，不能拿旧 ref 等待尚未观察到的新元素（后者应先按文本/URL 条件等待再重新 snapshot）。`assert` 是即时断言，不是轮询，也不应成为每次浏览动作的强制尾巴。
- `snapshot` 不等于 `extract`：前者为下一步 Agent 交互提供页面证据，后者按用户字段要求提取表格/结构化记录。后者本期未交付，不得使用“observe”伪装结构化提取。
- `screenshot` 是图像证据（Artifact），不是让 Agent 猜 DOM ref；图片处理遵循现有 Tool Result / Artifact 安全边界。

### 4.3 返回值和错误

沿用现有 `BrowserToolResult` 骨架，不为 v1 新造第二套 Evidence 模型：

```ts
type BrowserToolResult = {
  ok: boolean;
  sessionId: string;       // 内部/审计标识，不是模型可任意指定的输入
  invocationId: string;
  page: { url: string; title: string; snapshotHash?: string };
  observation?: { snapshot?: string; visibleText?: string; truncated?: boolean };
  assertion?: { kind: "title" | "url" | "text" | "visible" | "value"; passed: boolean };
  artifacts: Array<{ id: string; kind: "screenshot" | "json"; title: string; uri: string }>;
  error?: { code: string; message: string; retryable: boolean };
};
```

目标契约要求区分以下可诊断语义，**不宣称当前实现已经有这些全部 error code**。请先区分 **BrowserToolResult（工具已执行后的业务/Runtime 结果）** 与 **Harness Invocation（执行前的资格、Policy 和 Approval 结果）**：

| 失败语义 | 最小行为 | Agent 下一步 |
| --- | --- | --- |
| `runtime_unavailable` / `session_unavailable` | 不假装启动/执行成功 | 报告无法使用；按 Runtime 指示恢复，不暗转触界 |
| `navigation_blocked` | scheme/domain/会话策略不允许，不能绕过 | 要求用户明确改变授权范围或停止 |
| `stale_snapshot` / `ref_not_found` | 交互前发现页面/元素不匹配，不产生目标动作 | 重新 snapshot 再决定 |
| `invalid_target` / `unsupported_operation` | 控件类型不支持，或请求了未实现模式 | 换可支持的手段或清晰报告 |
| `action_timeout` / `wait_timeout` | `ok=false`；不隐瞒潜在迟到副作用 | 重新观察真实页面，再决定是否重试 |
| `assertion_failed` | 断言未通过，不能当作已完成 | 如实汇报证据差异 |

**Harness 预执行/审批结果不属于 `BrowserToolResult.error.code`：** 

| Harness 状态 / 失败类别 | 现有权威层与语义 | Agent / UI 下一步 |
| --- | --- | --- |
| Runtime Readiness 不可用 | Harness Availability Gate 可阻止工具暴露或执行，因此**可能不存在任何 BrowserToolResult** | 呈现不可用原因，不伪造工具结果 |
| `policy_denied` | Harness/Tool Invocation 的 `failureCode` 等元信息，而非 BrowserService 的 `error.code` | 不执行动作；向用户解释策略拒绝 |
| 审批拒绝 | Harness Approval resolution 导致 Invocation 取消/拒绝；当前调用可呈 `cancelled`，不要求 BrowserService 返回 `approval_denied` | 不执行动作；显示真实审批决定 |

兼容迁移时优先复用现有错误码和 Harness Invocation 字段；确需更名/细化须给出映射表和回归测试。无论成功失败，Evidence 不应捏造“页面已经改变”。禁止将私密浏览器数据、原始凭据、截图二进制直接塞进普通日志/模型可见 metadata。

### 4.4 权限：与工具粒度绑定，而非按 Browser 全部放行

- 现有 `browser_observe` 和 `browser_assert` 是 `requiresApproval=false`，`browser_act` 一律 `requiresApproval=true`。v1 将 `click/fill/press/select/navigate/scroll` **保持保守审批**，不能因拆成新 ID 绕开审查；低风险只读 `snapshot/screenshot/tabs_list/assert` 仍受普通 Policy/Readiness 约束。
- **v1 审批决议**：`browser_wait_for` 即使是只读条件等待，也暂时沿用原 `browser_act.wait` 的 `requiresApproval=true`；`browser_tab_select` 也保守设置 `requiresApproval=true`。后续任何降低审批级别的改动必须另行风险评审和维护者签核；不得在原子 facade 接入时自行放宽。
- Approval 永远作用于**参数冻结后的具体 Tool 调用**；更换 `pageUrl / snapshotHash / ref / value` 必须重新评估授权，不能复用另一调用的批准。
- 网页点击可能提交订单/付款/发送信息，`fill` 可能触发自动保存；“只是浏览器动作”不等于无风险。目标工具不能自行承诺所有按钮都可自动提交。

## 5. 渐进式披露和命名迁移

目标暴露链为：

```
browser Capability（元信息：交互网页，Managed/Mira-owned）
  -> Runtime Readiness 先过滤不可用 Tool
  -> 当前 Agent scope 的 compact Tool metadata
  -> 确定性 exact / structural / lexical；模糊时再 Resolver
  -> 只将所选具体 Tool schema 披露给模型
  -> 现有 Policy / Approval / Harness
```

- 直接复用 `server/src/harness/capability-view.ts`、`capability-disclosure.ts`、`candidates-core/resolver.ts` 和现有注册机制，**不**将 10 个完整 Schema 无条件注入所有 Planner turn。
- 已知 Tool 允许直接 materialize schema，不强制 Tool Search。披露预算沿用 #301 的 **默认 8**；常规 Tool 调用不消耗披露预算。不同 Agent scope 的能力边界按二期契约执行。
- 新 Profile 使用一级 `browser`（Managed 为 provider/运行时语义）；不保留长期一级 `browser_computer_use`。AGT-012 起，该旧身份不再进入 Agent capability search，但仍可把旧持久化/分组输入解析到 canonical `browser`，直到相关历史状态迁移完成。
- `browser_observe / browser_act` 的实现和精确 ID 暂时只为 Computer Use Studio / Debugger 活跃消费者保留，并从 `agent_intent` 暴露中移除；它们不得再被 Main / Generic Agent 发现或执行。`browser_assert` 继续作为正式 v1 Tool。Studio/Debugger 迁移完成后删除旧 Tool 实现与专用 model loop。
- 新旧 facade **不能长期作为两套默认 Model-facing Tool** 并存。切换计划由 #364 控制，#365 验证新调用路径、历史消费者和移除条件；不可用“仅改 Tool description”冒充交付。

### 现状 → 目标映射

| 当前入口 | 目标 / 状态 | 实现所有者 |
| --- | --- | --- |
| `browser_observe`（URL 启动、快照、可选截图） | `browser_navigate` + `browser_snapshot` + `browser_screenshot`（拆分） | #360 负责导航；**#359 负责 snapshot/screenshot 两个 concrete Tool 的定义、schema、registry、readiness 与底层观察安全**；#364 负责 Profile/渐进式披露 |
| `browser_act.navigate` | `browser_navigate`（拆分） | #360 |
| `browser_act.click` | `browser_click`（拆分） | #359 + #361 |
| `browser_act.type` | `browser_fill` **不是等价替换**；`type` 暂缓、必要时保留旧调用能力直至迁移验证 | #361 / #365 |
| `browser_act.select` | `browser_select_option`（拆分） | #362 |
| `browser_act.press` | `browser_press_key`（拆分） | #362 |
| `browser_act.scroll` | `browser_scroll`（拆分） | #362 |
| `browser_act.wait` | `browser_wait_for`（拆分，目标条件更明确） | #360 |
| `browser_assert` | **保留原 ID 和当前断言联合语义** | #365 验收 |
| 当前 SessionManager 维护单个 `page` | `browser_tabs_list`、`browser_tab_select`（**P1 新能力，不是已有能力**） | #363 |
| `browser_computer_use` Profile | `browser` 一级 Capability + Managed Runtime 描述 | #364 / #365 |
| `browser_attached_*` | **不动**；触界增强能力作为未来独立 MCP 工作 | 后续独立决策 |

### 5.1 正式前端投影：扩展 → 能力（维护者明确纠正，2026-10-17）

- **正式产品入口**：`/extensions/capabilities`，实现于 `desktop/src/features/Extensions/Capabilities/index.tsx`、`components/CapabilitiesSidebar.tsx`、`hooks/useCapabilities.ts`。这里是 Browser Capability 的产品展示和验收操作入口；用户应先看到**Browser 能力 / Mira-owned Managed Browser / Ready-Unavailable**，再按需下钻查看具体工具与运行证据。沿用该页面已有的 Capability 分组、测试案例、Tool 调用反馈，不新造平行 Browser 工作台。
- **旧版兼容入口**：`/settings/tools` 的 `desktop/src/features/Settings/pages/Tools/**` 属于历史 Tool Workbench，**本期不安排新功能或 UI 改造**。现有 `/extensions/tools` 已重定向 `/extensions/capabilities`；不逆向迁回旧入口。
- **Browser 分组及 Readiness**：现有 `CapabilitiesSidebar` 依赖后端 `workbench.groupId` / Capability Profile 的 presentation metadata；后续由 #364 在 Harness/Profile 真相源头投影 `browser` 分组，不准在前端新增硬编码工具 ID → Browser 归属映射；Readiness 不得使用 UI 自造的“可用”状态。触界当前独立呈现，本阶段不迁移其 MCP/Session。
- **面向用户的 Browser Setup**：若需入口展示 Playwright 是否已安装、为何不可用以及经过授权的安装/修复动作，必须复用既有 Computer Use runtime API/Status，而不是在前端假定“工具存在=Browser Ready”；此类前端任务与 #364 的数据契约另行小卡验收。
- **Chat 反馈**：Agent 真实执行时，应沿用既有 Chat Tool invocation / Approval / Evidence / Artifact，提供 Browser 页面目标、动作进展、审批原因、失败恢复建议与截图查看；不以调试 JSON 或 `browser_*` 工具名串替代用户反馈。
- **Computer Use Studio**：`/settings/micro-apps/computer-use-studio` 现有调试器可继续供内部/工程验证，但**不是新 Browser Capability 的一等产品入口**；迁移或退役它属于独立决策，不能顺手在 #364 改造。
- 这部分是**前端投影设计边界**，不代表 UI 已实现。前端实施分别由 [#367 / DSK-001](https://github.com/uichat-mira/mira-desktop/issues/367)（能力页）和 [#368 / DSK-002](https://github.com/uichat-mira/mira-desktop/issues/368)（Chat 执行反馈）持有；两卡已建档但未授权施工。

## 6. 明确延期，不得报作 v1 完成

| 事项 | 原因 / 边界 |
| --- | --- |
| `browser_fill_form` 批量填写 | v1 先交付单字段 `fill`，之后根据真实调用成本评估批量工具；不能为求少调用先做复杂事务。 |
| `browser_type` 逐字输入 | 与 `fill` 不同；仅特殊输入控件需要时再增设，并避免破坏旧调用迁移。 |
| `browser_extract` / `browser_find` 结构化提取 | 不是同一次观察的别名；可在网页读取与数据产品层另行设计。 |
| 下载、上传、权限弹窗、保存文件 | 文件路径、外传和用户授权需独立风险/验收，**不**借 #363 标签卡偷渡。 |
| iframe、Shadow DOM 深度操作 | 当前自制 DOM 快照对复杂结构支持不完整；单独验证，不宣称可用。 |
| hover、drag、坐标点击、视觉 Computer Use 兜底 | 不属于当前首批稳定原子动作；不得以 DOM 无法定位为理由执行未授权 JS/evaluate。 |
| Tab 新建/关闭/分组、跨 Managed/Connected 会话切换 | 关闭、归属和副作用不同；P1 仅 `list/select`。 |
| Managed <-> 触界 Provider 自动切换 | 明确禁止隐式切换，触界本期不施工。 |
| 更广泛 OS/Desktop Computer Use 迁移 | 本项目只退役旧 **浏览器特有入口**，不删除独立 OS GUI 能力。 |

## 7. 实施分刀与验收清单（非授权）

| 卡 | 精确交付 | 验收信号 |
| --- | --- | --- |
| [#355 / AGT-003](https://github.com/uichat-mira/mira-desktop/issues/355) | Readiness（已合并 dev） | real readiness gate；单测支持，不冒充实机烟测 |
| [#358 / AGT-005](https://github.com/uichat-mira/mira-desktop/issues/358) | Session 超时/复用/清理 | 同 thread 复用、超时回收、活动任务不误杀 |
| [#359 / AGT-006](https://github.com/uichat-mira/mira-desktop/issues/359) | Snapshot + Screenshot **两个原子 Tool facade/schema/registration/readiness**，快照/ref/截图可靠性 | 真实 Tool 列表含两 ID；browser-backed DOM 替换旧 ref 拒绝、截图 Artifact、缺失会话/Runtime 拒绝 |
| [#360 / AGT-007](https://github.com/uichat-mira/mira-desktop/issues/360) | 导航与等待 | 正常/越界 URL、条件等待/超时 |
| [#361 / AGT-008](https://github.com/uichat-mira/mira-desktop/issues/361) | 点击与填值 | 真实 fixture 执行、最终值、stale/approval 拒绝 |
| [#362 / AGT-009](https://github.com/uichat-mira/mira-desktop/issues/362) | 按键、下拉、滚动 | 真实控件、失败可诊断 |
| [#363 / AGT-010](https://github.com/uichat-mira/mira-desktop/issues/363) | P1 Managed tabs list/select | 同 context 两标签，拒绝外部/失效 tab |
| [#364 / AGT-011](https://github.com/uichat-mira/mira-desktop/issues/364) | `browser` Profile + 二期披露集成 | 一个能力目录、按需选 schema、授权不扩张 |
| [#365 / AGT-012](https://github.com/uichat-mira/mira-desktop/issues/365) | 真实任务与旧入口切换 | Agent 实跑且不调用旧路径，旧入口再退役 |

### 维护者设计决议（2026-10-17）

1. **接受 P0 10 个 Tool ID 和 P1 2 个 Tool ID** 作为实现目标（其中 `browser_assert` 复用、`browser_screenshot` 必须独立）。工具是否真正可用以各施工卡的实际代码与证据为准。
2. **`browser_wait_for` v1 继续要求审批**。本期不借 Tool 拆分改变旧 `browser_act.wait` 的审批语义；免审批属于未来单独风险决议。
3. **`browser_tab_select` v1 继续要求审批**；上传/下载和新建/关闭标签仍延期。此处是设计约束，不代表已完成风险验证或真实 Runtime 测试。

**本文件只完成语义契约草案和源代码映射，不授权改动 Tool schemas、审批或删除旧 Computer Use 入口。**