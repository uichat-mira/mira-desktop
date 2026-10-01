---
status: current
owner: project-owner
last_verified: 2026-09-08
layer: project-control
module: MicroAPP
feature: ComputerUse
doc_type: decision
canonical: true
related:
  - docs/project-control/tasks/microapp_T118-computer-use-runtime-and-managed-browser.md
  - docs/project-control/tasks/microapp_T123-computer-use-browser-runtime-platformization.md
  - docs/developments/defect-log.md
  - docs/platform/macos-implementation-phases.md
  - server/src/microapps/computer-use/runtime/types.ts
  - server/src/microapps/computer-use/runtime/manager.ts
---

# TD-T118-01 Computer Use Browser Runtime Platform Gap

## Decision

把 T118 建立的"单一固定 win64 托管 Chromium 包"合同演进为"按平台分发的固定托管 Chromium 配置 + 托管元数据平台一致性校验 + darwin 系统浏览器探测"。Windows 合同（版本、URL、SHA-256、可执行文件相对路径）保持不变。

## Reason

2026-09-08 在 darwin-arm64 实机确认：macOS 上 Computer Use 浏览器会话创建必然失败，且运行时层三处全部缺平台概念：

- `DEFAULT_MANAGED_CHROMIUM_CONFIG` 只固定 win64 包；在 macOS 上执行安装会得到无法执行的 `chrome.exe`（实测为 PE32+ Windows 二进制）
- `inspectManagedRuntime()` 只校验来源、版本、SHA-256 与路径边界，不校验平台一致性，导致本机 2026-08-29 错误安装的 win64 记录被判 ready
- `createDefaultSystemBrowserPaths()` 只探测 Windows 路径，macOS 已安装的系统 Chrome 永远不可见

实测证据：

- `playwright-core@1.61.1` 模块加载正常，模块层无缺陷
- 用托管记录启动：`browserType.launch: Failed to launch: spawn .../chrome-win64/chrome.exe EACCES`

## Affected Areas

- `server/src/microapps/computer-use/runtime/**`（配置、探测、安装、校验）
- Computer Use 浏览器会话创建、browser tools、Debugger 的 macOS 可用性
- macOS 平台化总计划中 managed runtime 的平台矩阵（与 Terminal Runtime / Piper 同类平台缺口）

## Rejected Alternatives

- 给 macOS 加静默 fallback（例如偷偷改用 Playwright 自带 Chromium）：违反无兜底原则，且本机自带 Chromium 版本与当前 playwright-core 不匹配，只会把失败推迟一层
- 在 UI / session 层捕获 EACCES 后换浏览器重试：在错误层级修补，掩盖运行时合同缺陷
- 把 mac 托管包 SHA-256 写成猜测值：不可接受，校验值必须来自真实下载计算

## Follow-up

- darwin x64 / linux 托管包配置在平台需求出现前保持显式缺失，不伪装支持
- 后续托管 Chromium 版本升级必须对全部已支持平台一起重新固化版本、URL、相对路径与 SHA-256
- 本机错误安装的 win64 托管运行时在 T123 验收后清理
