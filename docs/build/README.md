# Build

Status: Current
Owner: build
Last verified: 2026-07-22
Layer: raw-source
Module: Build
Feature: Packaging
Doc Type: current-contract
Canonical: true
Related:
  - ../../README.md
  - local-model-packaging.md
  - terminal-dev-runtime.md
  - ../developments/release-management.md
  - ../platform/tauri.md
  - ../../scripts/build-dist.js
  - ../../scripts/prepare-desktop-artifacts.js
  - ../../scripts/build-tauri-dist.js
  - ../../scripts/prepare-tauri-assets.js

## 单点真相范围

这页是 Build 模块当前的主入口。

它统一说明：

- Electron / Tauri release 打包命令
- `.artifacts/` 中间产物如何生成
- 测试报告如何进入 release 包
- release 输出目录和保留策略
- 本地模型包和 WASM runtime 资源入包规则
- Piper Windows 运行时入包规则
- Terminal Dev Runtime 的固定版本、PATH、staging 与分层验证规则
- 当前平台兼容边界
- 后续改造方向

以后涉及构建、打包、release 产物、测试报告入包、平台构建兼容性的设计和结论，优先记录在 `docs/build/` 下。

## 当前命令

Electron Windows release：

```bash
pnpm package:electron:win
```

Tauri Windows release：

```bash
pnpm package:tauri:win
```

清理临时构建产物：

```bash
pnpm clean:artifacts
```

同步版本号：

```bash
pnpm version:sync
```

## GitHub Actions 发布流程

桌面构建分为两类入口：

- `.github/workflows/build-desktop.yml`：环境分支包。
- `.github/workflows/release-production.yml`：`v*` 标签正式发布；重型校验和打包由 `release-factory-v2.yml` 执行。

当前触发规则：

| 事件 | 行为 |
| --- | --- |
| Pull Request → `dev/test/prod` | 轻量检查，不执行完整桌面打包 |
| push → `dev` | 构建 Electron / Tauri 分支包，保存 Actions artifacts |
| push → `test` | 构建 Electron / Tauri 分支包，保存 Actions artifacts |
| push → `prod` | 构建 Electron / Tauri 分支包，保存 Actions artifacts，并同步 R2 `mira/latest/` |
| push → `v*` tag | Release Factory 完整校验与打包，创建 GitHub Release，并同步 R2 `mira/latest/` |

Windows 分支构建仍由 Electron 与 Tauri 两个独立 job 并行执行。GitHub Actions 只上传最终桌面安装文件，不上传 `win-unpacked`、调试配置或整个 release 目录：

| 平台 | 分支包 / Release 资产 |
| --- | --- |
| Electron | `*Setup*.exe`、对应 `.exe.blockmap` |
| Tauri | `msi/*.msi`、`nsis/*setup.exe` |
| GitHub 自动生成 | Source code (`.zip`、`.tar.gz`，仅 GitHub Release) |

Actions artifact 为短期构建产物；GitHub Release 保存标签版本历史。

### Cloudflare R2 当前版本分发

R2 作为当前版本分发源：

```text
mira/latest/
```

以下两种成功事件都会覆盖同一 `mira/latest/`：

1. `prod` 分支构建成功；
2. `v*` 标签正式发布成功。

因此 `mira/latest/` 表示**最近一次成功的 prod/tag 发布结果**，不承担历史版本保存职责。标签历史由 GitHub Release 保存。

R2 所需 GitHub Secrets 为：

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
```

R2 公开地址格式为 `${R2_PUBLIC_BASE_URL}/mira/latest/<asset-name>`。每次发布使用 `--delete` 同步并覆盖 `latest`，旧的 `mira/previous/` 会先清理。

## 本地模型资源

本地 embedding / rerank 模型包、`onnxruntime-web` WASM runtime、Electron / Tauri resources 复制、首启解压和 checksum 校验规则，见：

- `local-model-packaging.md`

## Piper 运行时资源

Piper 微应用当前按 Windows 首发处理，运行时由应用内置，不要求最终用户额外安装 `piper.exe`。

当前构建输入和 staging 规则：

```text
.local-runtimes/piper/windows-amd64/<version>/
  piper_windows_amd64.zip
  extracted/piper/
    piper.exe
    onnxruntime.dll
    piper_phonemize.dll
    espeak-ng-data/
    ...

.artifacts/micro-apps/tts/piper/
  piper.exe
  onnxruntime.dll
  piper_phonemize.dll
  espeak-ng-data/
  ...
```

构建命令：

```bash
pnpm prepare:piper-runtime
```

当前行为：

- 固定下载官方 `piper_windows_amd64.zip`
- 先复用 `.local-runtimes/` 持久缓存
- 再复制到 `.artifacts/micro-apps/tts/piper/`
- `prepare-desktop-artifacts` 会自动执行这一步
- Electron resources 和 Tauri resources 都会带上 `micro-apps/tts/piper/` 目录

服务端运行时解析顺序：

1. `UIC_TTS_PIPER_EXECUTABLE`，仅用于显式调试覆盖
2. `.local-runtimes/piper/.../piper.exe`
3. `.artifacts/micro-apps/tts/piper/piper.exe`
4. 打包后的 `resources/micro-apps/tts/piper/piper.exe`

业务含义：

- 用户只需要配置 Piper 语音包路径
- `piper.exe`、依赖 DLL 和 `espeak-ng-data` 由应用负责提供

当前支持边界：

- 当前内置 `Piper` 运行时稳定支持 `phoneme_type=espeak` 的语音包
- `phoneme_type=pinyin` 的中文语音包当前不在稳定支持范围内
- 这不是打包路径问题，而是当前运行时兼容性边界
- 具体样例和技术债说明见：
  - `../microapp/tts-studio-runtime-notes.md`
  - `../developments/defect-log.md`

## Terminal Dev Runtime

Node/npm/npx、MinGit、uv、ripgrep 的固定版本、checksum、共享 Electron/Tauri staging、终端 PATH 与低资源 smoke 规则见：

- `terminal-dev-runtime.md`

## Release 构建原则

Release 构建必须执行一次完整测试流程，并把这次完整测试生成的官方 JSON 报告随包发布。

这条规则的含义：

- release 包里的测试报告不能依赖开发过程中偶然留下的 `coverage/` 临时目录。
- client 和 server 都要有各自独立的官方报告目录。
- 日常开发时单独跑某个 test file，不应覆盖官方报告。
- dev 页面读取的是“最近一次完整测试留下的稳定报告”，不是“刚刚那次临时测试输出”。
- 如果完整测试连官方 JSON 都生成不出来，构建应直接失败。

当前实现采用两层产物：

1. `coverage/`

   Vitest 本次运行的临时输出，包含 HTML、lcov、`coverage-summary.json`、`coverage-final.json`、json reporter 输出等。

2. `test-report/`

   当前认可的官方稳定 JSON 报告目录，仅保存前端自定义渲染需要的 JSON 产物。

release 允许“测试有失败，但官方 JSON 已成功生成”这种情况继续打包；这样包内开发页仍然能准确展示失败用例。只有报告缺失或生成中断时才阻断构建。

## Electron Release 流程

入口脚本：

```text
scripts/build-dist.js
```

当前流程：

1. 读取根目录 `package.json` 的 `version`。
2. 生成 release 输出目录名：

   ```text
   release/v<version>_<YYYYMMDD>_<HHMMSS>/electron/
   ```

3. 清理旧的 `.artifacts/electron-app`。
4. 执行 `pnpm version:sync`，同步 workspace 和 Tauri 版本字段。
5. 执行 `pnpm internal:prepare:desktop-artifacts`。
6. 按目标平台解析 electron-builder flag。
7. 进入 `.artifacts/electron-app`，执行 `electron-builder --win` 或 `electron-builder --mac`。
8. 打包成功后清理 `.artifacts/`。
9. 按 `RELEASE_KEEP_COUNT` 清理旧 release 目录。

当前 Electron package 脚本只接受：

```text
win
windows
mac
macos
```

未知平台会直接失败，不再静默回退到 Windows 包。

Electron staged app 位于：

```text
.artifacts/electron-app/
```

主要内容：

```text
.artifacts/electron-app/
  main.cjs
  preload.cjs
  package.json
  electron-builder.yml
  runtime.config.cjs
  desktop/dist/
  backend/
  icons/
  node-runtime/
  terminal-runtime/
```

最终 Electron 包中：

```text
resources/app.asar
resources/server
resources/node-runtime
resources/terminal-runtime
resources/runtime.config.cjs
```

后端由 Electron main process 启动：

```text
resources/node-runtime/node.exe resources/server/server.cjs
```

## 触界浏览器扩展产物

浏览器扩展的产品名为“触界”，包含“见行”和“剪藏”两项能力。开发版和生产版分别通过以下命令生成：

```bash
pnpm --dir mira-clipper-ext dev
pnpm --dir mira-clipper-ext dev:extension
pnpm --dir mira-clipper-ext prod
```

`dev` 保持 Windows 开发流程：先构建 `MiraWebBridgeHost.exe`，再打包开发版扩展。`dev:extension` 只打包开发版 CRX，不构建 Native Host；它仍要求有效的开发签名密钥。macOS Electron Core 开发命令不自动执行扩展打包，Native Messaging 在对应平台实现完成前保持明确不可用。

`pnpm dev:electron:mac` 会在启动前执行 `scripts/prepare-electron-macos-dev.mjs`。该脚本只在 Darwin 上为 npm 下载的 `Electron.app` 补本机 ad-hoc 开发签名，用于通过本地 Gatekeeper 执行检查；它不会进入 release payload，也不能替代正式包的 Developer ID 签名、公证与 staple。

随后执行的 `scripts/prepare-node-pty-macos-dev.mjs` 只恢复当前 `darwin-${arch}` node-pty `spawn-helper` 的执行位，用于修复上游 npm 包权限缺失导致的 `posix_spawnp failed`。它不读取或修改 `win32-*` 预构建目录；正式 macOS payload 仍需在 staging 阶段独立验证文件模式。

macOS 开发态 smoke：

```bash
pnpm smoke:electron:chat:mac
pnpm smoke:terminal:mac
```

Electron Chat smoke 使用 `.test-artifact/` 下的隔离数据库、Workspace 和附件目录，并为 backend 与 Vite 分配动态端口。它验证真实 Electron 登录、Chat Composer、普通附件 Draft、鉴权上传与落盘，不要求配置外部 LLM，也不把 Provider 回复计入本项证据。Terminal smoke 单独验证 POSIX 临时命令、持久 PTY 会话复用与进程组清理。

桌面端打包和用户下载统一使用 `Chujie.crx`，ZIP 产物使用 `Chujie.zip`。Electron、Tauri 和 shared desktop artifacts 必须引用相同文件名。

改名不改变扩展身份：签名密钥路径、Chrome 扩展 ID、Native Host 注册名和 `MiraWebBridgeHost.exe` 文件名保持稳定，确保已有安装可以继续升级和连接。

## Shared Desktop Artifacts 流程

入口脚本：

```text
scripts/prepare-desktop-artifacts.js
```

当前流程：

1. 生成应用元信息：

   ```text
   server/app-meta.json
   .artifacts/server-bundle/app-meta.json
   ```

2. 强制生成 client/server 官方测试报告 JSON。
3. 构建 renderer：

   ```bash
   pnpm internal:build:desktop
   ```

4. 构建 backend bundle：

   ```bash
   pnpm internal:build:server
   ```

5. 构建 docs site：

   ```bash
   pnpm docs:build
   ```

6. 把前端官方测试报告复制进 backend bundle：

   ```text
   .artifacts/server-bundle/client-coverage/test-report.json
   .artifacts/server-bundle/client-coverage/coverage-report.json
   ```

7. 把服务端官方测试报告复制进 backend bundle：

   ```text
   .artifacts/server-bundle/server-coverage/test-report.json
   .artifacts/server-bundle/server-coverage/coverage-report.json
   ```

8. 复制 docs site：

   ```text
   .artifacts/server-bundle/docs-site/
   ```

9. 准备并复制 renderer dist、icons、runtime config、固定 Node/npm/npx 和 Terminal Dev Runtime。
10. 组装 `.artifacts/electron-app`。

## Backend Bundle 流程

入口脚本：

```text
server/build.js
```

输出目录：

```text
.artifacts/server-bundle/
```

当前内容：

```text
.artifacts/server-bundle/
  server.cjs
  app-meta.json
  package.json
  tools/
  static/
  node_modules/
  client-coverage/test-report.json
  client-coverage/coverage-report.json
  server-coverage/test-report.json
  server-coverage/coverage-report.json
  docs-site/
```

`server.cjs` 由 esbuild 打包。`better-sqlite3`、`sqlite-vec` 和 `node-pty` 等 native 包不进入 bundle，而是复制到 `node_modules/`。

当前 native module 复制逻辑是 Windows-first：

- `better-sqlite3`
- `sqlite-vec`
- `sqlite-vec-windows-x64`
- `node-pty`（只保留 Windows x64 runtime，构建时执行加载校验）
- `bindings`
- `file-uri-to-path`

如果未来支持 macOS / Linux release，需要把平台 native 包选择从硬编码改为按目标平台解析。

## 测试报告入包规则

开发页当前读取以下静态文件：

```text
/client-coverage/test-report.json
/client-coverage/coverage-report.json
/server-coverage/test-report.json
/server-coverage/coverage-report.json
```

Fastify 后端会在启动时检测并暴露这些目录：

```text
client-coverage -> GET /client-coverage/
server-coverage -> GET /server-coverage/
```

Release 包内这些文件位于：

```text
resources/server/client-coverage/test-report.json
resources/server/client-coverage/coverage-report.json
resources/server/server-coverage/test-report.json
resources/server/server-coverage/coverage-report.json
```

当前 release 规则：

1. 构建前清理 client/server coverage 目录。
2. 强制运行 client tests with coverage。
3. 强制运行 server tests with coverage。
4. 从这次完整运行生成 client/server 官方 `test-report.json` 和 `coverage-report.json`。
5. 校验以下文件都存在：

   ```text
   desktop/test-report/test-report.json
   desktop/test-report/coverage-report.json
   server/test-report/test-report.json
   server/test-report/coverage-report.json
   ```

6. 再复制官方测试报告进入 `.artifacts/server-bundle/`。

实现入口：

```text
scripts/generate-test-report.js
```

当前脚本职责：

- 清理 `desktop/coverage` 和 `server/coverage`
- 运行 client/server 完整测试并生成 coverage 临时产物
- 从 Vitest json reporter 生成官方 `test-report.json`
- 从 `coverage-summary.json` + `coverage-final.json` 生成官方 `coverage-report.json`
- 把官方 JSON 写入 `desktop/test-report` 与 `server/test-report`
- 校验官方报告完整性

## 官方测试报告目录

前端：

```text
desktop/test-report/
  test-report.json
  coverage-report.json
```

服务端：

```text
server/test-report/
  test-report.json
  coverage-report.json
```

这两个目录是开发页和 release 包共同复用的稳定报告源。

### `test-report.json`

用于承载测试结果本体，至少包含：

- 顶层 summary
- suite 列表
- case 级 pass / fail / pending / todo
- duration
- failure messages

### `coverage-report.json`

用于承载覆盖率本体，至少包含：

- overall summary
- file 级 summary
- statement / function / branch / line 命中数据
- 前端自定义渲染所需的原始 map / hits 信息

这份 JSON 不等于 HTML 报告，但它包含了前端自定义渲染出 Vitest/Istanbul 视图所需的核心结构。

### 当前体积债务

当前官方测试报告 JSON 已能满足开发页渲染和 release 入包，但体积明显偏大。

2026-07-02 本地实测：

- `desktop/test-report/coverage-report.json` 约 `11 MB`
- `server/test-report/coverage-report.json` 约 `10.8 MB`

同时，当前还会额外复制一份到：

- `server/client-coverage/`
- `server/server-coverage/`

这意味着测试报告链路目前存在两类可见债务：

1. 单个 `coverage-report.json` 体积过大，已进入 10MB 级别。
2. 官方报告目录与 backend 静态目录各保留一份，存在重复文件拷贝。

当前阶段先保留现状，原因是：

- 现在这份 JSON 结构已经能稳定支撑前端自定义测试报告页。
- 先保证“完整测试 -> 生成稳定 JSON -> 开发页复用 -> release 入包”主链稳定，比立即压缩结构更重要。

后续优化方向已明确：

- 用脚本把前后端测试报告合并成单一 JSON 载荷，而不是继续分散成多份平行静态文件。
- 合并时同步处理重复字段、共享 metadata、scope 分区和可选裁剪策略。
- 目标是减少磁盘重复拷贝、降低打包体积，并为后续前端按需加载打基础。

在该债务落地前，不要把这批 `test-report.json / coverage-report.json` 视为普通脏产物删除。

如果某次完整测试在失败退出前没有产出 coverage artifacts，脚本仍会生成一个 `coverage-report.json` 占位文件，并显式标记覆盖率明细当前不可用；这样开发页和 release 包至少还能稳定展示该次测试结果本体。

## Dev 同步规则

入口脚本：

```text
scripts/generate-dev-coverage.js
```

规则如下：

1. 默认优先复用已有的 `desktop/test-report` 和 `server/test-report`。
2. 如果官方报告缺失，则自动补跑一次完整测试并生成它们。
3. 只把官方 JSON 同步到：

   ```text
   server/client-coverage/
   server/server-coverage/
   ```

4. 日常单独执行 `vitest` 不会修改官方报告目录，除非显式运行：

   ```bash
   node scripts/generate-dev-coverage.js --test
   ```

5. `pnpm dev:electron:win` 启动前只会同步官方报告，因此开发页看到的是上一次完整测试留下的稳定轨迹。

## Vitest 失败时的覆盖率策略

当前 desktop / server 的 Vitest 配置都显式开启了：

```text
coverage.reportOnFailure = true
coverage.reporter 包含 json 与 json-summary
```

这意味着：

- 测试失败时仍应尽量保留 `coverage-final.json` 与 `coverage-summary.json`
- `scripts/generate-test-report.js` 会优先把这两份 coverage 原始文件转换成官方 `coverage-report.json`
- 如果某次运行仍然没有 coverage 明细落盘，脚本才会写入一个“coverage 不可用”的占位 JSON，而不是让前端或打包流程直接断掉

## Tauri Release 流程

入口脚本：

```text
scripts/build-tauri-dist.js
```

当前流程：

0. 确认当前平台是 Windows。非 Windows 平台直接失败。
1. 读取根目录 `package.json` 的 `version`。
2. 生成 release 输出目录名：

   ```text
   release/v<version>_<YYYYMMDD>_<HHMMSS>/tauri/
   ```

3. 执行 `pnpm version:sync`。
4. 清理 Tauri 旧 bundle cache：

   ```text
   tauri/target/release/bundle/
   ```

5. 执行：

   ```bash
   cross-env CARGO_BUILD_JOBS=1 CARGO_INCREMENTAL=0 pnpm tauri build --config tauri/tauri.conf.json
   ```

6. 把 Tauri bundle 输出复制到 release 目录。
7. 清理 `.artifacts/`。
8. 按 `RELEASE_KEEP_COUNT` 清理旧 release 目录。

本地需要验证 Tauri 壳层与完整资源打包、但服务端测试报告生成暂时不可用时，可显式运行：

```bash
pnpm package:tauri:win:notest
```

该命令仅跳过前端和服务端的发布测试报告生成，仍会执行前端、后端、文档、Node runtime、Terminal Dev Runtime、Piper runtime 和 Tauri bundle 构建。正式发布仍应使用 `pnpm package:tauri:win`，并先处理测试失败。

Tauri 在构建前通过 `beforeBuildCommand` 或相关准备链路复用：

```text
scripts/prepare-tauri-assets.js
```

该脚本会调用：

```bash
pnpm internal:prepare:desktop-artifacts
```

然后把共享 backend bundle 和 Node runtime 复制到：

```text
tauri/resources/server/
tauri/resources/node-runtime/
tauri/resources/terminal-runtime/
tauri/resources/runtime.config.cjs
```

Tauri 当前同样是 Windows-only release。生产态 Rust 代码当前查找：

```text
resources/node-runtime/node.exe
```

## Release 输出和保留策略

release 输出根目录：

```text
release/
```

Electron：

```text
release/v<version>_<YYYYMMDD>_<HHMMSS>/electron/
```

Tauri：

```text
release/v<version>_<YYYYMMDD>_<HHMMSS>/tauri/
```

默认只保留最近 `3` 个 release 目录。

覆盖保留数量：

```bash
RELEASE_KEEP_COUNT=5 pnpm package:electron:win
```

PowerShell：

```powershell
$env:RELEASE_KEEP_COUNT=5
pnpm package:electron:win
```

旧目录被 Windows 锁定时，清理应跳过该目录，不让 release 构建失败。

## 当前平台边界

当前 release 构建按 Windows 桌面环境维护。

已知 Windows-first 假设：

- Electron backend runtime 默认使用 `node.exe`。
- Tauri backend runtime 默认使用 `node.exe`。
- server bundle 固定复制 `sqlite-vec-windows-x64`。
- 根命令只暴露 `package:electron:win` 和 `package:tauri:win`。
- `build-dist.js` 当前只接受 `win/windows/mac/macos`，未知平台会失败。
- `build-tauri-dist.js` 当前只允许在 Windows 上执行。

在完成 macOS / Linux 适配前，非 Windows release 应被视为未支持，不要静默产出不完整包。

## 改造优先级

### P0：Release 测试报告链路

状态：已落地第一版。

当前入口：

```text
scripts/generate-test-report.js
```

后续可继续补充：

- 报告生成耗时统计
- 输出 `.artifacts/reports` 作为 Electron / Tauri 连续打包时的共享缓存
- 更清晰的失败摘要输出

### P1：Artifact 分层

目标：

- `reports`：测试报告生成与校验
- `stage`：准备 renderer/server/docs/runtime inputs
- `package`：Electron/Tauri 调用各自打包器
- `release-output`：时间戳目录、保留策略、清理

这样可以减少 Electron/Tauri 脚本里的重复逻辑。

### P2：平台显式化

目标：

- Windows 构建继续稳定
- 未支持的平台显式失败
- 未来支持 macOS / Linux 时再加入平台 native module 解析、Node runtime 命名和 Tauri resource 路径规则

## 相关文档

- `../developments/release-management.md`
- `../platform/tauri.md`
- `../platform/tauri-setup.md`
