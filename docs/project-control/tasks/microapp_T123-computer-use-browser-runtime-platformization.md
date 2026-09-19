---
status: current
priority: P1
owner: microapp / runtime
last_verified: 2026-09-08
layer: project-control
module: MicroAPP
feature: ComputerUse
doc_type: task-card
canonical: true
related:
  - docs/project-control/tasks/microapp_T118-computer-use-runtime-and-managed-browser.md
  - docs/project-control/decisions/TD-T118-01-computer-use-browser-runtime-platform-gap.md
  - docs/developments/defect-log.md
  - docs/platform/macos-implementation-phases.md
task_state: READY_FOR_REVIEW
---

# microapp_T123 Computer Use Browser Runtime Platformization

## Target

修复 macOS 下 Computer Use 浏览器运行时不可用：托管 Chromium 配置按平台分发（win64 / mac-arm64），系统浏览器探测支持 darwin，托管运行时元数据与当前平台做一致性校验。Windows 行为保持不变。

背景：2026-09-08 在 darwin-arm64 实机确认浏览器会话创建失败，根因是 T118 建立的运行时合同为 Windows-only，共三处平台缺口（详见缺陷台账 2026-09-08 条目与 TD-T118-01）。

## Allowed Changes

- `server/src/microapps/computer-use/runtime/**`
- `server/src/microapps/computer-use/__tests__/runtime*.test.ts`
- `.test-artifact/computer-use/runtime/**`
- 本机 `server/.artifacts/computer-use/runtime/managed/**`（仅清理错误安装的 win64 运行时）
- `docs/project-control/tasks/microapp_T123-computer-use-browser-runtime-platformization.md`

## Forbidden Changes

- `server/src/microapps/computer-use/executor/**`
- `server/src/microapps/computer-use/session/**`
- `server/src/microapps/computer-use/core/**`
- `server/src/microapps/computer-use/browser/**`
- `server/src/mcp/**`
- `server/src/agent/**`
- `desktop/**`、`electron/**`、`tauri/**`
- DB schema 和通用任务持久化

## Contract

### 托管 Chromium 配置

- `ManagedChromiumConfig` 增加平台标识；托管版本 `152.0.7948.0` 跨平台保持一致
- `win32` → win64 包：版本、URL、SHA-256、可执行文件相对路径与 T118 完全一致，不改动
- `darwin` + `arm64` → mac-arm64 包：SHA-256 必须来自真实下载计算，禁止猜测值
- 其他平台（darwin x64 / linux）没有托管包配置：`resolveRuntime()` 跳过 managed 分支，`installManagedRuntime()` 返回明确错误，不允许静默兜底

### 系统浏览器探测

- `createDefaultSystemBrowserPaths()` 按平台返回候选：
  - win32：现有 chrome.exe / msedge.exe 候选，不变
  - darwin：`/Applications/Google Chrome.app`、`/Applications/Microsoft Edge.app`
  - 其他平台：空列表
- 运行时选择顺序不变：managed 优先，system 其次，均无 → `not_installed`

### 托管运行时元数据校验

- `inspectManagedRuntime()` 额外校验记录的 executablePath 与当前平台配置的 `executableRelativePath` 一致
- 跨平台错误记录（例如 macOS 上的 win64 记录）判为无效，runtime 回落到 system / not_installed，不得判 ready

### macOS 解压

- mac 包解压时恢复 zip 条目的 unix 权限，并确保最终 executablePath 可执行（至少 0o755），否则安装结果不可用

## Acceptance Criteria

1. Windows：现有 win64 托管运行时记录仍被接受（重复复用不破坏），系统浏览器探测结果不变。
2. darwin arm64：无托管运行时时，`resolveRuntime()` 返回本机系统 Chrome（strategy=system）；安装 mac-arm64 托管包后返回 managed。
3. darwin arm64：错误安装的 win64 托管记录被 `inspectManagedRuntime()` 判无效，不得返回 ready-managed。
4. darwin x64 / linux：`resolveRuntime()` 返回 `not_installed` 及明确原因；`installManagedRuntime()` 报明确错误，无静默兜底。
5. mac-arm64 托管包安装后 executablePath 具备可执行权限，可被 playwright-core 启动。
6. 以上行为均有定向测试；测试产物只写入 `.test-artifact/computer-use/runtime/**`。

## Verification

- `pnpm exec vitest run src/microapps/computer-use/__tests__/runtime*.test.ts`
  - workdir: `server`
- `pnpm typecheck`
  - workdir: `server`
- macOS 实机：`resolveRuntime()` 解析到系统 Chrome，并通过 `playwright-core` 真实启动成功

## Verification Results

2026-09-08 在 `darwin-arm64` 实机完成验证：

- 定向测试：`runtime.manager.test.ts` 16 项全部通过（含平台配置固定值、darwin 系统浏览器路径、跨平台记录拒绝、无托管配置平台 install 报错、非 Windows 解压权限恢复、win32 不应用 unix mode）
- `pnpm typecheck`（server）通过
- 实机三链路验证（生产代码路径：真实 loader + 真实 `ComputerUseRuntimeManager`）：
  - 真实 `server/.artifacts` 目录：2026-08-29 错误安装的 win64 记录被判无效，`resolveRuntime()` 回落系统 Chrome（strategy=system）
  - mac-arm64 托管包安装：官方包 sha256 校验通过，主程序与 framework helper 权限均恢复 0o755
  - `playwright-core` 真实 headless 启动成功：托管 Google Chrome for Testing 152.0.7948.0 与系统 Chrome 152.0.7977.82
- 本机错误安装的 win64 托管运行时（`server/.artifacts/computer-use/runtime/managed/`）已清理；验证用一次性脚本与下载产物已从 `.test-artifact/` 删除

### Changed Files

- `server/src/microapps/computer-use/runtime/types.ts`：`ManagedChromiumConfig` 增加平台标识；`MANAGED_CHROMIUM_CONFIGS` 固定 win64 / mac-arm64 双平台配置（mac sha256 来自真实下载计算）；新增 `resolveManagedChromiumConfig()`；`BrowserRuntimeManagerOptions` 增加 `platform` / `arch`
- `server/src/microapps/computer-use/runtime/manager.ts`：构造器按 platform/arch 解析托管配置（无配置平台显式 undefined）；`createDefaultSystemBrowserPaths()` 平台分支化（darwin 探测 `/Applications` Chrome/Edge）；`inspectManagedRuntime()` 按当前平台 `executableRelativePath` 精确校验，跨平台记录判无效；`resolveRuntime()` / `installManagedRuntime()` 在无托管配置平台给出明确原因与错误；解压恢复 zip unix 权限并对非 Windows 主程序 chmod 0o755
- `server/src/microapps/computer-use/__tests__/runtime.manager.test.ts`：fixture 增加 platform；新增/更新 6 组平台化用例

### Deferred

- darwin x64 / linux 托管包配置：按 TD-T118-01 保持显式缺失，待平台需求出现再立项
- Windows 侧只做了合同级回归（配置值与探测路径不变 + 测试覆盖），未做 Windows 实机复测（本机为 macOS）
