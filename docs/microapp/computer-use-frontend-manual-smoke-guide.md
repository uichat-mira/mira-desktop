---
status: current
owner: microapp / chat / runtime / desktop
last_verified: 2026-10-19
layer: wiki
module: MicroAPP
feature: ComputerUse
doc_type: runbook
canonical: true
related:
  - docs/chat/agent-frontend-workspace-smoke-method.md
  - docs/project-control/tasks/microapp_T122-computer-use-integration-and-acceptance.md
---

# Computer Use 前台手测指引

本文只记录前台黑盒验收方法。测试必须从 Chrome 中的 UI 入口开始，不能直接调用后端 API 代替前台验证。

## 一、测试前提

- 前台地址：`http://localhost:5757/#/chat`
- Computer Use Debugger 地址：`http://localhost:5757/#/settings/micro-apps/computer-use-studio`
- 测试站点：`https://example.com`
- Allowed Domains：`example.com`
- Runtime：优先选择 `Managed Chromium`
- 记录 Network 请求、页面反馈、invocation ID、artifact ID 和截图证据

本页的手动调试会话不需要模型；Main / Generic Agent 的 Managed Browser 能力由 Agent 主链承担，与本页手动调试入口相互独立。

## 二、Agent 前台绑定前置

Computer Use 如果由 Agent 发起，先按 Agent 前台手测指引完成线程绑定：

1. 在 `/#/chat` 创建一条新对话。
2. 点击当前线程输入框左侧的 `+`。
3. 打开 `Workspace`。
4. 点击 `Add to workspace`。
5. 选择同时显示 workspace 名称和根路径的目标条目。
6. 确认 `Agent` 按钮从禁用变为可点击。
7. 只有 Agent 按钮可点击后，才发送 Computer Use 相关请求。

只选左侧 workspace、只看线程分组或直接调用 API，都不能证明 Agent 已经绑定目标 workspace。

## 三、Debugger 手测主流程

1. 打开 Computer Use Debugger。
2. 确认页面先请求 `GET /microapps/computer-use/debugger/status`。
3. 配置 Runtime、URL、Allowed Domains、审批策略。
4. 点击 `New Session`，确认 session 为 ready。
5. 点击 `Inspect`，确认出现 URL、标题、snapshot、snapshot hash、visible text、截图和 `browser_observe` invocation。
6. 选择动作并填写 ref 或 value，点击 `Execute`。
7. 对 `write_actions` 策略，确认先进入 awaiting approval；点击 `Approve` 后才允许执行。
8. 使用 `Assert` 验证标题、URL、文本、可见性或值。
9. 检查 Feedback 中的 invocation、trace、artifact、evidence 和 result。
10. 点击 `Stop`，确认 session 停止且不能继续执行动作。

完整请求序列应为：

```text
GET  /microapps/computer-use/debugger/status
POST /microapps/computer-use/sessions
POST /microapps/computer-use/sessions/:id/observe
POST /microapps/computer-use/sessions/:id/action
POST /microapps/computer-use/sessions/:id/approval
POST /microapps/computer-use/sessions/:id/assert
GET  /microapps/computer-use/sessions/:id/artifacts/:artifactId/content
POST /microapps/computer-use/sessions/:id/stop
```

## 四、黑盒结果判定

每个用例必须记录：

- 用例 ID
- 前置条件
- 前台操作
- 实际 Network 请求
- 页面显示的状态
- invocation / trace / artifact / evidence 标识
- `PASS`、`FAIL` 或 `SKIPPED`
- 失败时记录阻塞层和实际错误

通过条件不是“按钮点了以后页面有变化”，而是页面状态、网络请求和证据三者一致。例如 Action 显示 succeeded 时，必须同时有成功 invocation，且浏览器确实执行了对应动作。

## 五、Agent 发起 Computer Use 的单独判定

Agent 前台绑定成功只证明线程获得了 workspace，不等于 Computer Use 已经接入 Agent 主链。还必须观察：

```text
Agent 前台绑定
  -> Agent 按钮可用
  -> 真实模型请求
  -> 原子 Managed Browser tools（browser_navigate / browser_snapshot / browser_fill / browser_click / browser_wait_for / browser_assert）
  -> 审批（如需要）
  -> observation / evidence / final result
```

如果只看到 Agent 普通回答、没有 `browser_*` invocation，不能判定 Computer Use Agent 链路通过。

当前版本如果 Agent 聊天没有触发 Managed Browser tool，相关用例应记为 `FAIL`，并记录为 Agent 接入缺陷；不能改记为 `SKIPPED`。只有真实 provider 未配置这一外部条件，才记为 `SKIPPED`。

## 六、必须执行的失败场景

- Runtime 不可用：New Session 后显示明确阻塞原因。
- 浏览器启动失败：不进入 ready，不生成成功证据。
- stale snapshot：使用旧 hash 执行动作，必须失败且不执行。
- 无效 ref：必须失败且不生成成功 artifact。
- 域名越界：禁止导航并保留失败 invocation。
- 审批拒绝：浏览器不执行动作，Feedback 保留拒绝原因。
- Assert 失败：显示 expected / actual，不能显示为成功。
- session 丢失或停止：动作、Assert、审批按钮不可继续使用。
- Reset：清除旧 session、snapshot、artifact、approval 和 feedback。

## 七、证据目录

本轮前台黑盒证据统一放在：

```text
.test-artifact/computer-use-acceptance/desktop/manual-blackbox/
```

截图、Network 摘要和结果记录必须与用例 ID 对应。Agent 主链的真实模型 smoke 如果因 provider 未配置而无法执行，应明确记录为 `SKIPPED`；不得把 Studio 已退役的 Model Run 当作替代验收入口。
