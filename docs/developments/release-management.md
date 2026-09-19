# 版本管理

Status: Current
Owner: platform
Last verified: 2026-06-26
Layer: raw-source
Module: Develoments
Feature: ReleaseManagement
Doc Type: current-contract
Canonical: true
Related:
  - README.md
  - ../platform/tauri.md
  - ../../CHANGELOG.md

## 当前规则

本项目当前采用统一版本号。

- 根目录 `package.json` 的 `version` 是唯一版本来源。
- 根目录 `CHANGELOG.md` 是当前产品更新日志的唯一真相源；`docs/CHANGELOG.md` 仅作历史归档。
- `electron/package.json`、`desktop/package.json`、`server/package.json`、`packages/core/package.json`、`tauri/tauri.conf.json` 和 `tauri/Cargo.toml` 都应与根版本保持一致。
- Windows 打包产物目录会自动带上当前版本号和构建时间戳。
- GitHub Actions 的桌面构建和发布规则以 `../build/README.md` 为准；环境分支包由 `.github/workflows/build-desktop.yml` 负责，`v*` 标签正式发布由 `.github/workflows/release-production.yml` 调用 Release Factory 完成。

## 版本来源

当前版本号位于：

- `package.json`
- `electron/package.json`
- `desktop/package.json`
- `server/package.json`
- `packages/core/package.json`
- `tauri/tauri.conf.json`
- `tauri/Cargo.toml`

运行时读取规则：

- 前端当前版本统一通过后端 `GET /app/meta` 获取。
- 后端应用元信息统一来自顶层 `package.json`。
- 开发和打包阶段都先生成 `server/app-meta.json`，运行时直接读取该产物；生成时仍以根目录 `package.json` 作为源数据。
- 不依赖 Electron / Tauri 原生桥接，也不以 `server/package.json` 作为运行时来源。

如果准备发布新版本，只需要更新根目录 `package.json` 的版本号，再执行同步、检查和打包。

## 打包产物命名

`pnpm package:electron:win` 会生成如下目录：

```text
release/v<version>_<YYYYMMDD>_<HHMMSS>/electron/
```

例如：

```text
release/v0.1.0_20260608_064451/electron/
```

`pnpm package:tauri:win` 会生成如下目录：

```text
release/v<version>_<YYYYMMDD>_<HHMMSS>/tauri/
```

这样做的目的：

- 能直接从目录名识别产物版本
- 同一版本多次打包时也不会互相覆盖
- 出问题时更容易按时间回溯构建结果

## Release 保留策略

`pnpm package:electron:win` 结束后，会自动清理旧的 `release/` 目录。

`pnpm package:tauri:win` 也遵循同样的清理规则。

默认行为：

- 只保留最近 `3` 份 release 目录
- 更旧的 release 目录会自动删除
- 如果某个旧目录被 Windows 锁定，清理会跳过它，不会让打包失败

可以通过环境变量覆盖保留数量：

```bash
RELEASE_KEEP_COUNT=5 pnpm package:electron:win
```

Windows `cmd` 示例：

```cmd
set RELEASE_KEEP_COUNT=5 && pnpm package:electron:win
```

PowerShell 示例：

```powershell
$env:RELEASE_KEEP_COUNT=5
pnpm package:electron:win
```

如果不设置，默认值是 `3`。

## 当前可用命令

开发与验证：

```bash
pnpm dev
pnpm build
pnpm check
```

Windows 打包：

```bash
pnpm package:electron:win
```

Tauri Windows 打包：

```bash
pnpm package:tauri:win
```

仅验证 Tauri 壳层和资源打包、需要显式跳过发布测试报告时：

```bash
pnpm package:tauri:win:notest
```

免测试命令不会跳过前端、后端、文档和运行时资源构建，不作为正式发布测试通过的替代。

## 发布建议流程

1. 更新版本号
2. 运行 `pnpm check`
3. 运行 `pnpm build`
4. 按需运行目标桌面打包命令；不要为了普通代码变更重复完整打包
5. `prod` 分支构建成功后把分支安装包同步到 R2 `mira/latest/`；`v*` 标签由 `.github/workflows/release-production.yml` 触发正式 Release Factory，生成 GitHub Release，并同样同步 R2 `mira/latest/`

## 说明

当前提供了可用的辅助脚本：

```bash
pnpm version:sync
```

它会把根目录 `package.json` 中的版本号同步到：

- `electron/package.json`
- `desktop/package.json`
- `server/package.json`
- `packages/core/package.json`
- `tauri/tauri.conf.json`
- `tauri/Cargo.toml`

正式发布时仍建议先确认根目录版本号，再执行同步、检查和打包。
两个桌面打包脚本也会在开始前自动执行这一步。
