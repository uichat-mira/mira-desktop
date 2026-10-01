# macOS Electron 构建独立探索（Intel 优先）

Status: Planned
Owner: platform
Last verified: 2026-10-01
Layer: raw-source
Module: Developments
Feature: PlatformRuntime
Doc Type: research
Canonical: false
Related:
  - macos-implementation-phases.md
  - macos-electron-build-plan.md
  - ../build/README.md
  - ../build/terminal-dev-runtime.md
  - ../architecture/ipc-and-preload.md
  - ../../scripts/build-dist.js
  - ../../scripts/prepare-desktop-artifacts.js
  - ../../server/build.js

## 单点真相范围

这页是 [macos-implementation-phases.md](./macos-implementation-phases.md) 的**后续探索**。

它记录以下事实：

- 当前 `dev:electron:mac`、`smoke:*:mac`、`package:electron:mac` 是一组较早的 macOS 探索命令，不能作为当前构建路线的唯一依据；
- 本轮不参考旧命令结论，直接从当前代码重新推导 Electron-only 的 packaging 链；
- 在 Intel（`darwin-x64`）主机上以实测探针定位真实失败点；
- 给出 Intel 优先、后续可扩展 arm64 的构建路线候选。

这页是 **research / Planning 文档**，不是 current-contract。它不宣称 macOS 已支持，也不替代任何现有 Windows 合同。任何结论在落地前都必须经项目负责人确认。

## 背景与定位

- 本轮目标平台：**先后 Intel（`darwin-x64`）**；最终要同时支持 arm64 与 Intel。
- 本轮壳层：**只考虑 Electron**，Tauri 暂不考虑。
- 分支：`feat/MacOS-build`。
- 验证主机：macOS 15.7.9（24G830）、`x86_64`、Node v22.22.3、pnpm 9.12.0、electron-builder 24.13.3。
- 验证主机签名现状：仅有 iOS Developer/Distribution 证书，**无 Developer ID Application**；`notarytool` 可用。

## 探索方法

不采信旧 macOS 命令与旧文档结论，而是：

1. 从 `package:electron:*` 入口沿代码追踪真实执行链；
2. 对 `internal:prepare:desktop-artifacts` 的每个子步骤单独执行探针；
3. 记录**实际命令输出**作为失败点证据；
4. 核对 `pnpm-lock.yaml` 与 `node_modules` 中 darwin-x64 原生包是否就绪。

## 依赖链真相

`package:electron:mac` 实际执行链（依据 `scripts/build-dist.js`）：

```text
build-dist.js --mac
  -> pnpm version:sync
  -> pnpm internal:prepare:desktop-artifacts
       = node scripts/prepare-desktop-artifacts.js
         + pnpm prepare:vivliostyle-runtime
         + node scripts/stage-vivliostyle-runtime.mjs
  -> electron-builder --mac --projectDir=.artifacts/electron-app
  -> cleanup .artifacts / 旧 release
```

`prepare-desktop-artifacts.js` 内部顺序：

```text
mira-clipper-ext: prod                      -> 打包扩展（跨平台）
mira-clipper-ext: native:build              -> 编译 Native Host ①OS 阻塞
writeAppMetaJsons / generateDesktopIcons    -> 跨平台
prepare/archive:local-model-packs           -> 仅当配置了 LOCAL_MODEL_* 时
generateReleaseTestReports                  -> 纯 JS，跨平台
internal:build:desktop                      -> 纯 JS/TS，跨平台
internal:build:server                       -> esbuild + native 复制 ②架构阻塞
prepare:terminal-runtime                    -> ①OS 阻塞
smoke-staged-server-runtime                 -> 依赖上游产物
prepare:piper-runtime                       -> ①OS 阻塞
组装 .artifacts/electron-app                -> 复制脚本
```

注意：`build-dist.js` 当前只接受 `win|windows|mac|macos`（未知平台直接失败），并没有 macOS 专属的 `package:electron:mac` 根命令——现有命令只有 `package:electron:win`。这说明 macOS 打包入口本身也尚未正式建立。

## 实测失败点（探针证据）

以下均为在 Intel 主机上实际执行得到的输出，不是推断。

### ① Native Host 编译

```bash
pnpm --dir mira-clipper-ext run native:build
```

结果：失败。

```text
clang: error: unsupported option '-mconsole' for target 'x86_64-apple-darwin24.6.0'
Error: Command failed: gcc -O2 -s -static -mconsole -o .../MiraWebBridgeHost.exe .../launcher.c
```

根因：

- `mira-clipper-ext/scripts/build-native-host.mjs` 固定调用 `gcc ... -mconsole` 链接 `.exe`；
- `mira-clipper-ext/native-host/launcher.c` 顶部 `#include <windows.h>` 并使用 `WIN32_LEAN_AND_MEAN`、`MAX_PATH`、`\\` 路径。

### ② Terminal Dev Runtime

```bash
pnpm prepare:terminal-runtime
```

结果：失败。

```text
Error: Terminal Dev Runtime preparation requires win32/x64; current host is darwin/x64.
    at assertSupportedHost (scripts/prepare-terminal-runtime.mjs:31:11)
```

根因：

- `scripts/terminal-runtime.lock.json` 写死 `platform: win32`、`architecture: x64`，组件全为 Windows x64 archive；
- 准备脚本用 `powershell.exe` 下载与 `Expand-Archive` 解压，并查找 `node.exe` / `MinGit` / `uv.exe` / `rg.exe`。

### ③ Piper Runtime

```bash
pnpm prepare:piper-runtime
```

结果：失败。

```text
Error: Bundled Piper runtime preparation currently supports Windows only.
    at assertWindowsHost (scripts/prepare-piper-runtime.mjs:29:11)
```

根因：固定下载 `piper_windows_amd64.zip`，非 `win32` 直接抛错。

### ④ 原生模块（好消息）

实测结果，darwin-x64 原生包**已经就绪**：

```text
node_modules/.pnpm/@img+sharp-darwin-x64@0.35.3
node_modules/.pnpm/sqlite-vec-darwin-x64@0.1.9
node-pty 包内含 prebuilds/darwin-x64 与 darwin-arm64
```

`pnpm-lock.yaml` 亦已包含 `@img/sharp-darwin-x64`、`sqlite-vec-darwin-x64`、`@img/sharp-darwin-arm64`、`sqlite-vec-darwin-arm64`。

`sqlite-vec` 的 `optionalDependencies` 声明了全部平台：

```json
{
  "sqlite-vec-darwin-x64": "0.1.9",
  "sqlite-vec-darwin-arm64": "0.1.9",
  "sqlite-vec-windows-x64": "0.1.9",
  "sqlite-vec-linux-x64": "0.1.9",
  "sqlite-vec-linux-arm64": "0.1.9"
}
```

结论：Intel 场景下 native 侧是「**选择**而非获取」的问题。`server/build.js` 已存在 `...(sqliteVecPackage?.optionalDependencies ?? {})` 的动态展开锚点。

### ⑤ 已跨平台、无需改的环节

- `scripts/prepare-vivliostyle-runtime.mjs` 已按 `process.platform` 分支（`vivliostyle.cmd` vs `vivliostyle`）；
- `electron-builder.yml` 已声明 `mac.target: dmg` + `icons/icon.icns`；
- `electron/main.cjs` 使用 `process.resourcesPath`，并在无 bundled node 时以 `ELECTRON_RUN_AS_NODE=1` + `process.execPath` 启动 backend，天然适配 `.app/Contents/Resources`；
- `electron/preload.cjs` 暴露 `desktopRuntime.platform = process.platform`。

## 阻塞分类（按性质，不按旧文档分期）

| 类别 | 含义 | 代表项 |
| --- | --- | --- |
| ① 仅 OS 相关 | Windows 二进制 / 注册表 / PowerShell | Native Host `.exe`、Piper、Terminal Runtime |
| ② 仅架构相关 | native 包按平台选择 | `sharp` / `sqlite-vec` / `node-pty` 的 staging 选择 |
| ③ 无需改 | 渲染器 / 后端 bundle / Vivliostyle / builder 配置 | `internal:build:desktop`、`.app` 资源结构 |

## 候选构建路线（Intel 优先，待确认）

思路：**不改动 Windows 合同**，通过「平台解析 + 能力 gate」让 macOS 链独立走通。

### 第 1 层：staging 脚本平台化（②）

- `server/build.js`：按 `process.platform` / `process.arch` 选择 `@img/sharp-${platform}-${arch}` 与 `sqlite-vec-${platform}-${arch}`；
- `server/build.js` 的 `pruneNodePtyRuntime`：从固定 `win32-x64` 改为 `darwin-${arch}`；
- Intel 场景下这些包已安装，改动属「选择」逻辑。

### 第 2 层：OS 阻塞项按平台分流（①）

- Native Host：`darwin` 下跳过或改用 macOS launcher（二选一，见决策点）；
- Terminal Runtime：为 `darwin-x64` 新增 lock 条目，下载逻辑去 PowerShell 化；
- Piper：`darwin` 下生成显式 `unavailable` capability 并跳过 staging；
- `prepare-desktop-artifacts.js` 中 `.exe`、`MiraWebBridgeHost.exe` 的复制改条件化。

### 第 3 层：按 arch 出包（③ + 收尾）

- `electron-builder.yml` 的 `mac.target` 指定 `arch: x64`；
- `build-dist.js` 的 `--mac` 增加 `--x64`；
- backend 启动沿用已存在的 `ELECTRON_RUN_AS_NODE` 回退。

## 未决决策点（需项目负责人确认）

以下均属 AGENTS.md 的高风险门（文件写路径 / runtime 合同 / 外发），不能在未确认前落地：

1. **Native Host**：首版 macOS 是「跳过 + 显式标 unavailable」，还是实现 macOS launcher（需写入 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`）？
2. **Terminal Runtime**：macOS 用系统 Git/Node（不随包），还是随包 darwin 二进制（需新 lock 与 checksum）？
3. **签名**：本机无 Developer ID Application，首版是否接受未签名内部 DMG？
4. **架构范围确认**：本轮先只做 Intel，但 native 选择逻辑应写成 `platform-arch` 参数化，以便后续直接补 arm64。

## 建议的验证出入点

先做一个最小可验证切片，证明「渲染器 + 后端 + native 模块」Core 链能在 Intel mac 打包并启动，把 OS 专属能力先 gate 掉：

```text
pnpm internal:build:server   # 在 darwin-x64 上产出 bundle
  -> 加载 sharp / sqlite-vec / node-pty 的 darwin-x64 binding
  -> 启动 backend，/health 通过
  -> electron-builder --mac --x64 产出 .app / .dmg
```

该切片不改产品行为，仅验证第 1 层的可行性。

## 未执行项

- 未运行完整 `package:electron:mac`（会触发已知失败的前置链）；
- 未单独运行 `internal:build:desktop` / `internal:build:server`（列为待验证）；
- 未验证 `.app` 在干净机的安装与启动；
- 未验证 arm64 侧任何环节。

## 与既有文档的关系

- 阻塞项、分期与验收门槛以 [macos-implementation-phases.md](./macos-implementation-phases.md) 为准；
- 本页只补充「以当前代码重新推导 + Intel 实测」的探索结论，旧 macOS 命令的结论不在此页复用；
- 稳定结论落地后应回写对应 current-contract，本页可作为研究证据保留。
