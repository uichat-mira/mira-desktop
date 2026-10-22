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
---

# Computer Use 前台手测指引

本文只记录前台黑盒验收方法。测试必须从 Chrome 中的 UI 入口开始，不能直接调用后端 API 代替前台验证。

当前 Studio 只提供 Managed Browser 运行时管理（状态、检测、安装、可执行文件路径），不再提供手动调试会话。网页任务由主 Agent / Generic Child 的原子 Browser Tool 路径承担。

## 一、测试前提

- 前台地址：`http://localhost:5757/#/chat`
- Computer Use Studio 地址：`http://localhost:5757/#/settings/micro-apps/computer-use-studio`

## 二、Studio 运行时管理手测

1. 打开 Computer Use Studio。
2. 确认页面请求 `GET /microapps/computer-use/runtime`。
3. 确认运行时状态、受管 Chromium / 系统浏览器检测结果和可执行文件路径真实展示。
4. 未安装时点击下载浏览器运行时，确认请求 `POST /microapps/computer-use/runtime/install`。
5. 确认页面没有手动调试会话、动作、断言或执行反馈面板。
6. 确认 `/microapps/computer-use/sessions*` 与 `/microapps/computer-use/debugger/status` 返回 404。

## 三、Agent 前台绑定前置

1. 在 `/#/chat` 创建一条新对话。
2. 点击当前线程输入框左侧的 `+`，打开 `Workspace`。
3. 点击 `Add to workspace`，选择同时显示 workspace 名称和根路径的条目。
4. 确认 `Agent` 按钮从禁用变为可点击后，才发送 Computer Use 相关请求。

## 四、Agent 发起 Computer Use 的判定

```text
Agent 前台绑定 -> Agent 按钮可用 -> 真实模型请求
  -> 原子 Managed Browser tools（browser_navigate / browser_snapshot / browser_fill / browser_click / browser_wait_for / browser_assert）
  -> 审批（如需要）-> observation / evidence / final result
```

如果只看到 Agent 普通回答、没有 `browser_*` invocation，不能判定 Computer Use Agent 链路通过；`browser_observe` 与 `browser_act` 不应再作为 Agent 可见工具出现。

## 五、证据目录

```text
.test-artifact/computer-use-acceptance/desktop/manual-blackbox/
```
