# Terminal Dev Runtime 打包

Status: Current
Owner: runtime
Last verified: 2026-07-22
Layer: raw-source
Module: Build
Feature: TerminalDevRuntime
Doc Type: current-contract
Canonical: true
Related:
  - README.md
  - ../architecture/README.md
  - ../platform/tauri.md
  - ../../scripts/terminal-runtime.lock.json
  - ../../scripts/prepare-terminal-runtime.mjs
  - ../../scripts/terminal-runtime-staging.js

## 范围

Terminal Dev Runtime 只为现有 `terminal_session -> host_spawn / PTY -> Windows Job Object -> host runtime` 提供随包开发工具。它不改变终端工具合同、PTY 持久会话、进程树归属、workspace、approval、Harness、Planner 或 Agent Graph。

当前只维护 Windows x64 发行物。

## 固定组件

版本、下载 URL、许可证与 SHA-256 的单点真相位于 `scripts/terminal-runtime.lock.json`。构建不请求 `latest`：

| Component | Version | Distribution | License |
| --- | --- | --- | --- |
| Node | 24.22.1 | 官方 Windows x64 archive | MIT |
| npm / npx | 11.19.1 | Node archive 内置 | Artistic-2.0（npm 自身） |
| Git | 2.55.0.windows.3 | MinGit 64-bit | GPL-2.0-only 与随包组件许可证 |
| uv | 0.11.31 | 官方 Windows x64 archive | Apache-2.0 OR MIT |
| ripgrep | 15.2.0 | 官方 MSVC Windows x64 archive | Unlicense OR MIT |

选择标准 MinGit，不使用 Portable Git。当前 MinGit 保留 `git-remote-http(s)`、OpenSSL/curl DLL、CA bundle、OpenSSH、Git Credential Manager、worktree 与 Git 子命令依赖，不提供完整 Git Bash 桌面环境、GUI 或文档集合。

Python 不随安装包预装。`uv` 在用户需要时下载并管理 Python；这不改变未来 `python_session` 或 managed Python sandbox 合同。

## 准备、缓存与校验

```bash
pnpm prepare:terminal-runtime
```

流程：

1. 从锁文件读取固定 archive。
2. 复用 `.local-runtimes/terminal-dev/windows-x64/` 缓存。
3. 下载完成后校验 archive SHA-256；不匹配就删除并失败。
4. staging Node、npm/npx、MinGit、uv、ripgrep。
5. 执行实际 `--version` 校验。
6. 生成 executable SHA-256、`manifest.json` 和 `THIRD_PARTY_NOTICES.md`。

设置 `MIRA_TERMINAL_RUNTIME_OFFLINE=1` 后只允许使用已通过校验的缓存，不会联网。构建阶段不会下载 `latest`，应用运行时也不会下载 Git、uv 或 ripgrep。

## 目录结构

```text
resources/
  node-runtime/
    node.exe
    npm.cmd
    npx.cmd
    node_modules/npm/
    LICENSE
  terminal-runtime/
    manifest.json
    THIRD_PARTY_NOTICES.md
    bin/
      uv.exe
      rg.exe
    git/
      cmd/git.exe
      mingw64/
      usr/bin/ssh.exe
      LICENSE.txt
```

`scripts/terminal-runtime-staging.js` 是 Electron、Tauri 和 staged smoke 共用的复制与最终文件校验入口。Electron 把两棵 runtime 目录作为 `extraResources`；Tauri 把相同目录放入 `tauri/resources/`。两种壳层都把最终 resources 根目录通过 `UI_CHAT_DESKTOP_RESOURCES_ROOT` 传给 Backend。

`server/build.js` 将 `node-pty` 作为外置 native dependency 复制到 Backend bundle，只保留 Windows x64 runtime 文件并删除 PDB；构建结束立即执行一次 `require("node-pty")`。

## PATH 与失败行为

Backend 中的 `server/src/mcp/terminal/dev-runtime.ts` 统一构造：

```text
node-runtime
terminal-runtime/bin
terminal-runtime/git/cmd
terminal-runtime/git/mingw64/bin
terminal-runtime/git/usr/bin
system PATH
```

它不修改全局 PATH、不写注册表，也不需要管理员权限。即使调用者提供命令级 PATH override，Mira runtime 仍在该 PATH 前面。

运行时读取 manifest，并以 executable SHA-256 检查 bundled 命令。组件状态分为 `bundled`、`system`、`unavailable`，同时写入子进程环境变量 `UI_CHAT_TERMINAL_RUNTIME_COMPONENTS`。bundled 文件缺失或校验失败时，对应共享 PATH 目录会被整体移除，避免 shell 继续命中损坏文件；系统 PATH 仍可提供对应命令，两者都没有时状态为 `unavailable`。`rg` capability 探测与实际内容搜索都使用同一解析结果和 executable path。

现有 `grep` 与 read content locate 共用内部 ripgrep provider：优先 `bundled-ripgrep`，bundled 缺失或完整性校验失败时由 Terminal Dev Runtime resolver 选择 `system-ripgrep`，两者都不可用或执行失败时使用 `node-content-scan`。实际 provider 会写入搜索结果 artifact metadata；这不会新增 Planner-facing Tool，也不改变现有 grep/read Tool Contract。

Electron 在 bundled Node 缺失时保留现有 Electron-as-Node fallback。Tauri 先使用 bundled Node，再查找系统 `node.exe`，都不存在时返回明确错误。

## 分层验证

日常低资源验证：

```bash
pnpm smoke:terminal-runtime
```

它准备 runtime、构建 Backend bundle、构造 `.test-artifact/terminal-dev-runtime-staged/resources/`，并验证 bundled 命令来源、版本、Git helper、staged `node-pty`、真实 ephemeral/persistent `terminal_session`、Job Object 与 Backend `/health`。

完整 staged 开发流：

```bash
pnpm smoke:terminal-runtime:staged
```

它额外验证 HTTPS clone、Git status/diff/log/add/commit/branch/checkout/switch/fetch/pull/push/worktree、rg 搜索、npm install/build、uv Python install/venv/pip/run，以及 managed Python 脚本。

完整 Electron/Tauri Installer 只在 Release Gate、CI 或人工明确批准后执行：

```bash
pnpm package:electron:win
pnpm package:tauri:win
```

## 2026-07-22 体积记录

MiB 使用 `1 MiB = 1,048,576 bytes`。Installer 增量没有通过完整 Installer build 实测；下表的压缩增量来自固定 archive 大小，以及 Node-only 与 Node-with-npm 的同算法压缩差值。

| Component | Download MiB | Staged / installed MiB | Estimated installer increment MiB |
| --- | ---: | ---: | ---: |
| Node core | 34.03 | 83.10 | 0（复用原有 node-runtime） |
| npm / npx | shared | 10.67 | 3.73 |
| MinGit | 36.99 | 89.53 | 36.99 |
| uv | 24.47 | 72.65 | 24.47 |
| ripgrep | 1.71 | 4.02 | 1.71 |
| Total new installer estimate | — | — | 66.90 |

`node-runtime + terminal-runtime` 的总 staged 体积是 259.98 MiB。相对旧流程只复制本机构建 Node executable，预计 installed 增量约 178.71 MiB。压缩后的 Installer 增量估计 66.90 MiB，低于约 80 MiB 的目标；最终数值仍以 CI/人工完整 Installer build 为准。

## 已知验证边界

- 2026-07-22 本机已通过 quick 与 full staged smoke。
- GitHub HTTPS 曾出现连接重置，同一 bundled MinGit 重试成功；通过用户临时提供的本机 SOCKS5 代理再次完成 GitHub shallow clone。最终可重复 smoke 使用小型公开 GitLab 仓库，避免单站点可达性影响 Runtime 判断。
- 完整 Electron Installer 与 Tauri Installer 未在本机执行。
- 源码态 `terminal_session` 在 Windows Job Object 清理后，`node-pty` 的 console-list helper 可能向 stderr 输出一次非致命 `AttachConsole failed`；命令结果、Job Object 模式、session registry 清理和进程退出均成功。该现象涉及现有终端清理语义，本任务没有修改 Job Object 或 PTY 合同。
