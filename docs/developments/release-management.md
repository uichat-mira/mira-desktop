# 版本管理

Status: Current
Owner: platform
Last verified: 2026-10-02
Layer: raw-source
Module: Develoments
Feature: ReleaseManagement
Doc Type: current-contract
Canonical: true
Related:
  - README.md
  - ../../CHANGELOG.md

## 当前规则

本项目当前采用统一版本号。

- 根目录 `package.json` 的 `version` 是唯一版本来源。
- 根目录 `CHANGELOG.md` 是当前产品更新日志的唯一真相源；`docs/CHANGELOG.md` 仅作历史归档。
- `electron/package.json`、`desktop/package.json`、`server/package.json`、`packages/core/package.json` 都应与根版本保持一致。
- Windows 打包产物目录会自动带上当前版本号和构建时间戳。
- GitHub Actions 的桌面构建和发布规则以 `../build/README.md` 为准；Windows 环境分支包由 `.github/workflows/build-desktop.yml` 负责，Intel macOS 环境分支包由独立 `.github/workflows/build-macos-intel.yml` 负责，`v*` 标签正式发布由 `.github/workflows/release-production.yml` 调用 Release Factory 与 Intel macOS reusable build 完成。

## 版本来源

当前版本号位于：

- `package.json`
- `electron/package.json`
- `desktop/package.json`
- `server/package.json`
- `packages/core/package.json`

运行时读取规则：

- 前端当前版本统一通过后端 `GET /app/meta` 获取。
- 后端应用元信息统一来自顶层 `package.json`。
- 开发和打包阶段都先生成 `server/app-meta.json`，运行时直接读取该产物；生成时仍以根目录 `package.json` 作为源数据。
- 不依赖 Electron 原生桥接，也不以 `server/package.json` 作为运行时来源。

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

这样做的目的：

- 能直接从目录名识别产物版本
- 同一版本多次打包时也不会互相覆盖
- 出问题时更容易按时间回溯构建结果

## Release 保留策略

`pnpm package:electron:win` 结束后，会自动清理旧的 `release/` 目录。

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

## 发布建议流程

1. 更新版本号
2. 运行 `pnpm check`
3. 运行 `pnpm build`
4. 按需运行目标桌面打包命令；不要为了普通代码变更重复完整打包
5. `prod` 分支构建只生成、验证并保存短期 Electron 安装包，不写入 R2 的公共 `latest`；唯一公共镜像写入者为正式 `v*` Tag 的 `.github/workflows/release-production.yml`。该工作流对 Windows Setup / macOS Intel DMG、blockmap、GitHub Release 与 R2 对象进行版本与文件大小一致性核对，且仅允许当前最新正式版本更新两个 latest 前缀。完整发布状态要求 Windows 与 macOS 均成功，任何一端失败都应显式阻断。

## 稳定 Tag 来源保护

正式的 `vX.Y.Z` Tag 必须指向已进入 `prod` Git 历史的提交，且 Tag 解析出的提交必须等于检出的 HEAD，事件 SHA 可以是该提交或带注释的 Tag 对象，根 `package.json` 版本必须匹配。发布工作流先检出完整历史、显式获取 `origin/prod`，通过 `scripts/release/verify-prod-tag-cli.mjs` 后，才启动 Release Factory 和 macOS Intel 构建。验证失败时不调用发布任务，不触及 GitHub Release 或 R2。

在 PR 上可使用 `node --test scripts/release/verify-prod-tag.test.mjs` 验证正反例。该工作流门禁不替代 GitHub Tag ruleset：Tag 所含的工作流本身也来自被标记的提交，仓库管理员仍应保护 `v*` Tag 的创建、改写及删除权限；历史 Tag 不应因本次门禁变更而重跑。未通过真实打包运行验收前不要打正式 Tag。

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

正式发布时仍建议先确认根目录版本号，再执行同步、检查和打包。
Electron 打包脚本会在开始前自动执行这一步。
