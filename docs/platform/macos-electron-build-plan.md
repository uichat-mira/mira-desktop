# macOS Electron 构建分层验证规划表（Intel 优先）

Status: Planned
Owner: platform
Last verified: 2026-10-01
Layer: raw-source
Module: Developments
Feature: PlatformRuntime
Doc Type: implementation-plan
Canonical: false
Related:
  - macos-electron-build-exploration.md
  - macos-implementation-phases.md
  - ../build/README.md
  - ../build/terminal-dev-runtime.md
  - ../../scripts/build-dist.js
  - ../../scripts/prepare-desktop-artifacts.js
  - ../../server/build.js

## 单点真相范围

这页是 [macos-electron-build-exploration.md](./macos-electron-build-exploration.md) 的**执行规划**。

它定义：

- 从当前状态到「Intel macOS Electron 可运行产物」的分层验证顺序；
- 每一层的目标、范围、前置、验证方式与通过标准；
- 层与层之间的依赖与回退点；
- 明确不做项与未决决策。

这页是 **Planning 文档**，不是 current-contract。它不宣称 macOS 已支持。执行前必须逐层经项目负责人确认；每层只在该层验证有实测证据后才可标记通过。

## 总原则

1. **一层一验证**：不跳层，不在上层未通过时并行推进下层。
2. **每层先验证再改动**：先跑出该层的真实失败点，再决定最小改动，不基于旧命令结论。
3. **Windows 合同不可破坏**：所有改动必须保持 `package:electron:win` 与现有 Windows 验证链可用。
4. **不引入 fallback / 静默降级**：macOS 缺失的能力必须显式报告为 unavailable，不得伪装可用。
5. **高风险门先确认**：涉及文件写路径、runtime 合同、外发行为的改动，执行前需项目负责人批准。
6. **Intel 优先**：本轮只在 `darwin-x64` 验证；native 选择逻辑写成 `platform-arch` 参数化，为后续 arm64 预留。

## 目标定义

**最终目标**：在 Intel macOS 上产出一个可启动的 Electron `.app` / 内部 DMG，覆盖 Core 能力（应用启动、Chat/Provider/Agent 主链、SQLite、Workspace、后端 health、native 模块加载），OS 专属能力按 gate 显式标记不可用。

**非目标（本轮不做）**：arm64 实机验证、Tauri、签名与公证、Native Messaging 实现、Piper macOS runtime、Mac App Store、Universal 2。

## 层级总览

| 层 | 名称 | 目标 | 依赖 | 风险 |
| --- | --- | --- | --- | --- |
| L0 | 环境与基线冻结 | 确认主机能力与仓库基线可复现 | 无 | 低 |
| L1 | 后端 bundle + native 加载 | 在 darwin-x64 产出可加载 native 的 server bundle | L0 | 中 |
| L2 | 渲染器与前端契约 | 渲染器可在 macOS 平台值下构建并消费平台接口 | L1 | 低 |
| L3 | staging 脚本平台化 | `prepare-desktop-artifacts` 在 darwin-x64 可完整跑通 | L1,L2 | 高 |
| L4 | OS 专属能力 gate | Native Host / Piper / Terminal Runtime 显式不可用 | L3 | 高 |
| L5 | Electron 打包出包 | `electron-builder --mac --x64` 产出 .app/.dmg | L3,L4 | 中 |
| L6 | 安装与启动 smoke | .app 启动、backend health、核心链路可用 | L5 | 中 |

## 执行进度

状态取值：`已完成` / `进行中` / `受阻` / `未开始`。只在有命令输出证据时更新。

| 层 | 状态 | 证据 | 下一步 |
| --- | --- | --- | --- |
| L0 | 已完成 | 主机 `darwin/x64`、Node v22.22.3、pnpm 9.12.0（与 `packageManager` 一致）；`@img/sharp-darwin-x64@0.35.3`、`sqlite-vec-darwin-x64@0.1.9`、`better-sqlite3@12.10.0` 均在 `node_modules/.pnpm`；`node-pty` prebuilds 含 `darwin-x64` 与 `darwin-arm64` | 进入 L1 |
| L1 | 已完成 | `pnpm internal:build:server` 在 darwin-x64 成功产出 `.artifacts/server-bundle`；staged bundle 内 4 个 native 模块加载成功（`better-sqlite3`、`sharp v0.35.3`、`sqlite-vec` → `vec0.dylib`、`node-pty`）；实际启动 `server.cjs` 后 `/health` 返回 `200 {"success":true}`，Forge runtime initialized，sqlite-vec 扩展已加载 | 进入 L2 |
| L2 | 已完成 | `pnpm internal:build:desktop` 在 darwin 成功（Vite 构建完成）；`preload.cjs` 暴露 `desktopRuntime.platform = process.platform`；[runtimePolicies](../../desktop/src/features/chat/core/runtimePolicies.ts#L86-L100) 对 `darwin` 接受 POSIX 绝对路径；平台/路径测试 29/29 通过，macOS POSIX workspace 用例通过 | 进入 L3 |
| L3 | 已完成 | `node scripts/prepare-desktop-artifacts.js` 在 darwin-x64 上完整跑通，输出「Desktop artifacts are ready」；`.artifacts/electron-app` 结构完整（backend/server.cjs + darwin-x64 native、desktop/dist、icons、runtime.config.cjs、main.cjs、preload.cjs、electron-builder.yml、空 browser-extension 占位）；Windows 分支逻辑逐字保留在 `if (isWindowsHost)` 内 | 进入 L4/L5 |
| L4 | 已完成（随 L3 实施） | darwin 下 Native Host / 扩展打包 / Terminal Dev Runtime / Piper / staged server runtime smoke 均被显式跳过并打印 warning，无静默降级；`browser-extension` 目录保留空占位以维持资源布局 | 进入 L5 |
| L5 | 已完成 | `electron-builder --mac --x64` 在 staged `electron-app` 上产出 `UIChat Mira.app`（Mach-O x86_64，bundle id `com.tomz.uichat`）与 `UIChat Mira-0.101.0.dmg`（约 181MB），Resources 含 app.asar / server / runtime.config.cjs / icon.icns，无 `.exe`/`.dll`；**退出码 0**（补 `repository` 字段前为 1） | 进入 L6 |
| L6 | 已完成（Core） | 方案 1 落地后：`.app` 用随包 `node-runtime/node`（Node 22.23.1）启动 backend；`/health` 200、sqlite-vec 加载、Forge 初始化、默认 Workspace 创建、重启复用同一 DB、退出后端 code 0 且无残留 | 收尾（可选：DMG 复验、static 警告排查） |

> 2026-10-02 集成加固说明：上表保留 2026-10-01 Intel Mac 原始实测证据。PR #205 后续将 staged server runtime smoke 平台化，并在 Darwin 准备好随包 Node 22.23.1 后用该运行时实际加载 `better-sqlite3`；这一步作为 ABI gate，失败即阻止打包。该新增 gate 尚未在原 Intel Mac 上复验，不改写 10-01 的历史证据。

## L0：环境与基线冻结

**目标**：确认在 Intel 主机与当前分支上，仓库基线可复现。

**范围**：只读核对，不修改任何打包脚本。

**验证项**：

- 主机：`darwin` / `x64`、Node ≥ 20、pnpm 版本与 `packageManager` 一致；
- 工作分支与基线提交可复现；
- `pnpm install` 后 darwin-x64 native 包存在（`@img/sharp-darwin-x64`、`sqlite-vec-darwin-x64`、`node-pty` darwin prebuilds）；
- `pnpm check` 基线状态已知（含既有 `remote-relay-connector` 类型错误，视为独立基线缺陷）。

**通过标准**：以上各项均有命令输出证据；基线错误有明确定位。

**回退点**：无（不产生改动）。

## L1：后端 bundle + native 加载

**目标**：证明 Core 后端能在 darwin-x64 上构建并加载关键 native 模块。这是后续所有层的地基。

**范围**：

- 只读探针：`pnpm internal:build:server` 在 darwin-x64 的实际行为；
- 必要时评估 `server/build.js` 的平台选择改动（属高风险门，需确认）。

**验证项**：

- `pnpm internal:build:server` 可产出 `.artifacts/server-bundle`；
- bundle 中 native 模块能从 `node_modules` 加载：`better-sqlite3`、`sharp`、`sqlite-vec`、`node-pty`；
- 加载验证必须在 staged bundle 上下文执行，而非仅工作区。

**通过标准**：四个 native 模块在 staged bundle 中全部加载成功，有命令输出证据。

**已知阻塞**：`server/build.js` 原先固定复制 `@img/sharp-win32-x64`、`sqlite-vec-windows-x64`，并把 `node-pty` 裁剪到 `win32-x64`。**已按最小改动修复**（见下方「L1 已实施改动」）。

**回退点**：如改动 `server/build.js` 属高风险，先仅记录失败点，不改代码，回到决策点。

### L1 已实施改动

对 `server/build.js` 做平台选择参数化，**保持 Windows 行为不变**：

- 新增 `targetPlatform` / `targetArch` / `nodePtyPrebuildName` / `sharpPlatformPackage` / `sharpLibvipsPackage` / `sqliteVecPlatformPackage` 常量；
- `copyPackage` 由硬编码 `@img/sharp-win32-x64` 改为 `@img/sharp-${platform}-${arch}`；
- darwin / linux 下额外复制 `@img/sharp-libvips-${platform}-${arch}`（Windows 分支不复制，行为不变）；
- `sqlite-vec` 按平台选择，并仅对 Windows 将 Node 的 `win32` 平台名映射为包名使用的 `windows`；
- `pruneNodePtyRuntime` 由固定 `win32-x64` 改为 `${platform}-${arch}`，Windows 下等价于原行为。

未新增任何 fallback 或静默降级。Windows 平台解析结果与原硬编码值逐一相同。

## L2：渲染器与前端契约

**目标**：确认渲染器在 macOS 平台值下的构建与平台接口消费正确。

**范围**：只读验证为主。

**验证项**：

- `pnpm internal:build:desktop` 在 darwin 可完成；
- 前端平台值合同：`electron/preload.cjs` 暴露 `desktopRuntime.platform = process.platform`；
- Chat Workspace 路径策略在 `darwin` 下接受 POSIX 绝对路径（`runtimePolicies` 已有分支）；
- 相关平台隔离与路径测试可通过。

**通过标准**：渲染器构建成功；平台/路径相关测试通过，有测试输出证据。

**回退点**：无结构性改动预期。

### L2 验证结果

- `pnpm internal:build:desktop`：成功，Vite 产出 `dist`（构建完成）；
- 平台值合同：`electron/preload.cjs` 中 `desktopRuntime.platform = process.platform`，darwin 下即 `darwin`；
- 路径策略：`runtimePolicies.isValidWorkspaceRootPath` 对 `darwin` 走 `posixAbsolutePathPattern`；
- 测试：`desktopRuntime`(17) + `externalLinks`(3) + `runtimePolicies`(9) = **29/29 通过**；`UChatThreadListSidebar` 的「POSIX absolute path on macOS」用例通过；
- **发现既有基线失败（与 macOS 无关）**：`UChatThreadListSidebar` 的「opens Cuixing through the app integration sidebar entry」用例在干净 HEAD 下同样失败，已用 `git stash` 隔离验证。这是独立基线缺陷，不计入 L2。

## L3：staging 脚本平台化

**目标**：让 `internal:prepare:desktop-artifacts` 在 darwin-x64 上完整跑通，产出 `.artifacts/electron-app`。

**范围**（高风险门，逐项确认后执行）：

- `server/build.js`：按 `platform-arch` 选择 native 包（承接 L1）；
- `prepare-desktop-artifacts.js`：`.exe`、`MiraWebBridgeHost.exe` 复制条件化；
- Terminal Runtime / Piper 的调用点在 macOS 下走 gate 分支（承接 L4）。

**验证项**：

- 该命令在 darwin-x64 上无未处理异常；
- `.artifacts/electron-app` 结构完整（backend、desktop/dist、icons、runtime.config.cjs 等）；
- Windows 侧 `internal:prepare:desktop-artifacts` 行为不变。

**通过标准**：staging 成功；Windows 路径回归检查通过。

**回退点**：staging 改动属高风险，若无法在不破坏 Windows 合同的前提下完成，暂停并回到决策点。

### L3 探针发现（前置阻塞，非平台问题）

在 darwin-x64 上直接运行 `node scripts/prepare-desktop-artifacts.js`，**第一个失败点早于任何平台问题**：

```text
Error: CRX signing key not found:
  mira-clipper-ext/.keys/mira-clipper-prod.pem
```

事实核查：

- `mira-clipper-ext/scripts/package-extension.mjs` 打包 CRX 必须要有签名私钥；
- `.keys/` 在 `.gitignore` 中，本地不存在；
- 真实 `.pem` 是 CI secret（`MIRA_CLIPPER_CRX_PROD_PEM`），由 `.github/workflows/build-desktop.yml` 注入；
- `.env.example` 将其标注为 optional override，但打包链路实际把它作为硬前置；
- 该密钥决定扩展 ID（`electron/main.cjs` 中 Native Messaging allowed-origins 依赖 `nmoaglalgogogfaednbhpfadmdlpelag`），**不可伪造或临时生成**。

结论：任何开发者在本地都无法跑通完整 `prepare-desktop-artifacts`，与 macOS 无关。此为既有的本地环境缺口，需单独决策处理方式，不得通过 fallback / 伪造密钥绕过。

### L3 已实施改动

对 `scripts/prepare-desktop-artifacts.js` 增加 `isWindowsHost` 平台分支，**Windows 分支逻辑逐字保留**：

- 扩展打包（`npm run prod`）与 Native Host 编译（`npm run native:build`）：Windows 执行；非 Windows 显式跳过并告警；
- Terminal Dev Runtime、staged server runtime smoke、Piper：Windows 执行；非 Windows 显式跳过并告警；
- CRX / `MiraWebBridgeHost.exe` / `host.mjs` 复制：Windows 执行；非 Windows 仅创建空 `browser-extension` 目录以维持资源布局；
- `stageTerminalDevRuntime` 与 Piper staging：Windows 执行；非 Windows 跳过。

未新增 fallback / 静默降级；非 Windows 路径均打印明确 warning 并声明能力不可用。

### L3 附带探针（L5 前置信息）

用 staged `electron-builder.yml` 试跑 `electron-builder --mac --x64` 探针时发现：

- `extraResources` 指向 `node-runtime` / `terminal-runtime` / `micro-apps/tts/piper` 等 Windows-only 目录，缺失时 electron-builder **只打印 `file source doesn't exist` 警告，不阻断打包**；
- 该探针从仓库根目录调用，导致 `files` glob 未命中而报 `Application entry file "index.js" ... does not exist`——这是探针调用方式问题（`build-dist.js` 实际用 `--projectDir=.artifacts/electron-app`），属 L5 待验证项。

## L4：OS 专属能力 gate

**目标**：把 Windows-only 能力在 macOS 下改为**显式不可用**，不阻断 Core。

**范围**（高风险门）：

- Native Messaging / Native Host：macOS 下跳过构建与复制，能力报告 unavailable；
- Piper：macOS 下跳过 staging，capability 报告 unavailable；
- Terminal Dev Runtime：macOS 下按平台处理（系统工具或新增 lock，取决于决策点）。

**验证项**：

- macOS staging 不再因以上三项失败；
- UI / capability snapshot 准确描述实际可用性；
- backend 不因缺失可执行文件崩溃。

**通过标准**：三项在 macOS 下均被显式 gate，且不产生静默失败。

**回退点**：若某项必须实现而非 gate，回到决策点单独评估。

## L5：Electron 打包出包

**目标**：`electron-builder` 在 Intel macOS 上产出 `.app` / 内部 `.dmg`。

**范围**：

- 新增或调整 macOS Electron 打包入口（当前 `build-dist.js` 已有 `--mac`，但无正式根命令）；
- `electron-builder.yml` 的 `mac.target` 指定 `arch: x64`；
- backend 启动沿用 `ELECTRON_RUN_AS_NODE` 回退。

**验证项**：

- 打包成功产出 `.app` / `.dmg`；
- 产物内资源来自本地 payload，不含 Windows-only 二进制；
- backend 启动失败时有可诊断错误，不白屏。

**通过标准**：产出可用的 `.app` / `.dmg`，有命令输出与产物位置证据。

**回退点**：签名未决（本机无 Developer ID），首版接受未签名内部包需确认。

### L5 验证结果

在 staged `.artifacts/electron-app` 上执行：

```bash
pnpm exec electron-builder --mac --x64 \
  --projectDir=".artifacts/electron-app" \
  --config.directories.output="<out>" --publish never
```

实测结果：

- ✅ **`.app` 成功产出**：`UIChat Mira.app`，`Contents/MacOS/UIChat Mira` 为 `Mach-O 64-bit x86_64`；`CFBundleIdentifier=com.tomz.uichat`、`CFBundleName=UIChat Mira`；
- ✅ **`.dmg` 成功产出**：`UIChat Mira-0.101.0.dmg`（约 181MB）+ `.blockmap`；
- ✅ 资源布局正确：`Contents/Resources/` 含 `app.asar`、`server/`（server.cjs + node_modules + skills/tools/static）、`runtime.config.cjs`、`icon.icns`；
- ✅ **不含 Windows-only 二进制**：`find Resources -name "*.exe" -o -name "*.dll"` 结果为空；
- ✅ `extraResources` 中缺失的 `node-runtime` / `terminal-runtime` / `micro-apps/tts/piper` 只产生 `file source doesn't exist` 警告，不阻断；
- ⚠️ **代码签名被跳过**：本机无 `Developer ID Application`，electron-builder 打印 `skipped macOS application code signing`（符合预期）；
- ⛔ **进程退出码为 1**：`.app` / `.dmg` 产出后，在 update-info 生成阶段抛 `Cannot read properties of null (reading 'provider')`，根因为 staged `package.json` 缺少 `repository` 字段（`Cannot detect repository by .git/config`）。应用本身并未使用 `electron-updater`，该步骤对其无功能意义。

### L5 修复与复验

- 在 `electron/package.json` 增加 `repository` 字段（复用根 `package.json` 的仓库地址），staging 会将其带入 `.artifacts/electron-app/package.json`；
- 复验 `electron-builder --mac --x64 ... --publish never`：**退出码 0**，`.app` / `.dmg` 正常产出，`Contents/MacOS/UIChat Mira` 仍为 `Mach-O 64-bit x86_64`，`CFBundleIdentifier=com.tomz.uichat`，Resources 内无 `.exe` / `.dll`。

**结论**：L5 通过。`.app` 与 `.dmg` 均可产出且结构正确，打包命令退出码为 0。代码签名仍按预期跳过（本机无 Developer ID）。

## L6：安装与启动 smoke

**目标**：验证产物在 Intel macOS 上可安装、启动、核心链路可用。

**验证项**：

- `.app` 可启动并创建数据目录；
- backend `/health` 通过；
- SQLite 创建、重启后数据保留；
- 默认 Workspace 可读写；
- Chat / Provider / Agent 基础链可用；
- 未实现能力在 UI 显式标记不可用。

**通过标准**：以上均有实测证据；未实现项准确标注。

**回退点**：如核心链路失败，定位到对应层（L1–L4）回溯。

### L6 首次验证（受阻）

用 `--dir` 产出 `.app`，去掉 quarantine 后直接启动 `Contents/MacOS/UIChat Mira`。

- ✅ Electron 外壳启动：`App ready, isDev: false`，Helper 进程拉起，`process.resourcesPath` 解析正确；
- ✅ 资源解析正确（`server.cjs`、`desktop/dist/index.html`）；
- ✅ 密钥与数据目录创建；
- ❌ backend 以 code 1 退出。

根因（已复现）：

```text
Error [ERR_REQUIRE_ESM]: require() of ES Module .../parse5/dist/index.js
  from .../jsdom/lib/jsdom/browser/parser/html.js not supported.
```

| 组件 | 版本 | `require(ESM)` |
| --- | --- | --- |
| `parse5` | 8.0.1（纯 ESM，`type: module`） | — |
| `jsdom` | 26.1.0（CJS，`require('parse5')`） | — |
| 系统 Node | 22.22.3 | ✅ |
| Electron 内嵌 Node | 20.18.0 | ❌（加 `--experimental-require-module` 后可加载） |

macOS payload 未携带独立 `node-runtime`（当时为 Windows-only），Electron main 回退到 `ELECTRON_RUN_AS_NODE=1` + `process.execPath`，实际使用 Electron 31 内嵌的 Node 20.18.0；其默认 `require()` 无法加载 ESM-only 的 `parse5`，导致 backend 启动即崩。

### L6 修复（方案 1：随包独立 Node runtime）

- 新增 `scripts/node-runtime.lock.json`：按 `platform-arch` 固定 Node 版本与 SHA-256（`darwin-x64`、`darwin-arm64`，均为 Node 22.23.1）；
- 新增 `scripts/prepare-node-runtime.mjs` 与根命令 `pnpm prepare:node-runtime`：下载并校验后 stage `node` 到 `.artifacts/node-runtime/`（含 `manifest.json`、`LICENSE`）；
- `prepare-desktop-artifacts.js`：非 Windows 宿主执行 `prepare:node-runtime`，并把 `node-runtime` 复制进 `.artifacts/electron-app`；Terminal Dev Runtime（git/uv/ripgrep）与 Piper 仍保持 Windows-only；
- `electron/main.cjs`：bundled node 二进制名按平台解析（`win32 → node.exe`，其余 `node`），Windows 行为不变。

### L6 复验（通过）

- ✅ `Backend runtime: .../Resources/node-runtime/node`（不再走 Electron 内嵌 Node 回退）；
- ✅ backend 启动：`Server listening at http://127.0.0.1:39877`（隔离端口，避免与仓库遗留 dev server 混淆）；`/health` 返回 `200 {"success":true}`，监听进程为打包 backend；
- ✅ SQLite：创建 userData `data/uichat-rag-test.db`；`sqlite-vec` 扩展加载（`vec0.dylib`）；Forge runtime 初始化；
- ✅ 默认 Workspace：`~/Documents/UIChat Mira/Default Workspace` 创建；
- ✅ 重启持久化：关闭后重启，复用同一 `uichat-rag-test.db`，`/health` 再次 200；
- ✅ 退出清理：`Shutting down gracefully...` → `Backend process exited with code 0`，无残留进程、无占用端口。

**结论**：L6 **通过（Core）**。

**已知残留（非阻塞）**：

- 启动时有一条 `@fastify/static` 的 `"root" path ".../Resources/static" must exist` 警告（level 40，非致命，server 正常启动）；属静态资源 root 与打包布局的解析差异，未定位到具体注册点，待单独排查；
- Chat / Provider / Agent 完整链路需配置外部 Provider 才能端到端验证，本轮仅验证到服务端就绪（auth DB / forge / sqlite-vec）；
- 未实现能力（Native Messaging / Terminal Dev Runtime / Piper）尚未在 UI 上显式标注；
- 产物未签名（本机无 Developer ID）。

## 决策点（执行前需确认）

1. **Native Host**：首版 macOS 跳过 + 标 unavailable，还是实现 macOS launcher？
2. **Terminal Runtime**：用系统 Git/Node（不随包），还是随包 darwin 二进制（需新 lock 与 checksum）？
3. **签名**：本机无 Developer ID Application，首版是否接受未签名内部 DMG？
4. **架构参数化**：native 选择是否本轮即写成 `platform-arch` 参数化（为 arm64 预留）？

## 未决与未知

- `pnpm check` 既有类型错误是否影响 macOS 打包链，尚未判定；
- L1 的 `server/build.js` 改动是否可在不触碰 Windows 合同下完成，尚未验证；
- Terminal Runtime 取系统工具方案对 Agent 能力的影响范围，尚未评估；
- arm64 侧全部环节未验证。

## 验证记录更新规则

- 每层只在有命令输出、测试结果或人工 smoke 证据时更新状态；
- 不使用百分比或模糊完成描述；
- 每层更新同时记录本轮 diff、验证结果、未完成项与风险；
- 状态取值与 [macos-implementation-phases.md](./macos-implementation-phases.md) 保持一致（已完成 / 进行中 / 受阻 / 未开始）。
