# 架构总览

Status: Current
Owner: runtime
Last verified: 2026-11-24
Layer: raw-source
Module: Develoments
Feature: RuntimeArchitecture
Doc Type: overview
Canonical: true
Related:
  - ipc-and-preload.md
  - api-response-spec.md
  - model-config-api.md
  - context-budget-runtime.md
  - chat-agent-fast-review-2026-06-27.md
  - mcp-marketplace-agent-integration.md
  - multi-agent-execution-truth.md

## 单点真相范围

这页文档统一说明：

- 桌面端运行时边界
- 请求与网络契约
- backend host / port 的归属规则
- 打包后的进程模型

相关概念：

- [[CONCEPT_RUNTIME]]
- [[CONCEPT_PLATFORM]]
- [[CONCEPT_MCP]]
- [[AREA_MAP_RUNTIME]]

## 技术栈

| 层 | 当前技术 |
| --- | --- |
| Renderer | React + Vite + TypeScript |
| Desktop shell | Electron main + preload |
| Backend | Fastify bundled Node service |
| Database | SQLite (`better-sqlite3`) |
| Workspace | pnpm workspace |

## 运行时边界

当前项目是一个“桌面壳层 + 本地 backend”的结构。

- renderer 负责 UI 与用户交互
- preload 负责暴露少量 native / runtime 信息
- backend 负责模型代理、线程、知识库、评测和工具运行时

renderer 不应直接持有 native 或 Node 级能力真相。

## 请求契约

当前统一遵守这些规则：

- 开发态 renderer 请求使用 `/api/...`
- `/api` 只是 Vite proxy 前缀
- backend route 本身不带 `/api`
- 生产态 renderer 通过 `window.desktopApi.backendUrl` 访问 backend
- backend host / port 统一来自 `runtime.config.cjs`

## 进程模型

### 开发态

标准开发入口（`pnpm dev:electron:win` / `pnpm dev:electron:mac`）只有一个进程模型：

```text
renderer (Vite dev server) -- /api proxy --> Fastify backend
desktop shell
  └─ Electron Main -- private child IPC --> Node + tsx source Backend
```

Electron Main 是唯一启动 Backend 的进程，因此 Dev 与 packaged runtime 使用同一套
Cloud Relay Ticket / Host Grant 私有 IPC 边界。`electron/dev-launcher.cjs` 只启动
Vite 并等待其就绪，不再独立启动或复用 Backend；若配置的 Backend 端口已被占用，
标准开发启动直接失败，绝不复用无法接收私有 IPC 的独立进程。

Backend 源码热重载由 Main 负责：直接执行 `node <tsx>/cli.mjs src/index.ts`，
刻意不使用 `tsx watch`，因为 watcher 会插入一个无法继承 Electron child IPC 的
中间进程。Main 监听 `server/src` 的运行时代码变更（防抖并排除测试与构建产物），
终止旧子进程后启动新进程，并重新挂载 Ticket / Host Grant bridge。Vite renderer
仍由 Vite HMR 更新。若配置的 Vite 端口被其它 IPv4 服务占用，则分配独立的开发
端口而不复用未知服务；Electron 使用与 Vite 一致的 `127.0.0.1` renderer 地址，
避免 Windows 上 `localhost` 优先解析到另一个项目的 IPv6 loopback 服务。

直接通过其它方式启动 Electron、或由测试 harness 自行管理 Backend 时，该 Backend
没有 Electron-owned IPC channel，Cloud Host 会按既有契约失败关闭；只有标准
`pnpm dev:electron:<platform>` 入口提供 Cloud-capable development。
`dev:electron:*:cloud-pilot` 仅保留为指向标准命令的兼容别名。

官方 Cloud Relay 的 Backend WebSocket 仅在 Mira「通用」已配置 SOCKS5
Host/Port 时使用独立的 `socks5h` 代理连接（DNS 在代理侧解析）；未配置则保持原有直连，
已配置但代理失败时只报告 Cloud 传输不可用，不静默切换直连、Legacy Relay 或 Tailscale。
该代理不接管 macOS 系统网络、Electron Cloud OAuth、Backend 本机 HTTP 健康检查，
也不改变独立自建 Relay 的 WebSocket 连接策略。

本地 renderer 开发服务默认监听 `http://127.0.0.1:5757`。端口统一来自
`runtime.config.cjs`，需要覆盖时使用 `UI_CHAT_DESKTOP_PORT`，Electron 和 Vite 不分别维护端口常量。

### 打包态

```text
Electron desktop application (Windows EXE / macOS .app)
  ├─ Electron main process
  ├─ preload bridge
  └─ bundled Node backend (platform-native Node executable)
       └─ terminal -> platform-specific runtime / PATH resolution
```


Electron 使用平台原生的 `node-runtime/` staging 输入（Windows 为 `node.exe`，macOS 为 `node`），独立于 Electron 内嵌 Node。Windows 另有 `terminal-runtime/` 完整工具链；macOS 的终端能力与未提供的 bundled 组件按平台合同处理。桌面壳层只把 resources 根目录传给 Backend；终端 PATH 的组件校验、优先顺序和 system fallback 由 Backend 统一处理，不进入 renderer 或 preload 合同。详见 `../build/terminal-dev-runtime.md`。

## 当前稳定边界

- backend 是业务契约与运行时真相的主要落点
- preload 只暴露最小必要面
- renderer 不直接分支操作 host / port / native runtime
- 桌面壳层之间共享尽可能多的构建输入
- 模型调用前的上下文预算与审计应由 backend runtime 统一处理
- Main Agent、forked Skill Agent、private Runtime、审批恢复和 Parent recovery 的当前合同见 `multi-agent-execution-truth.md`

当前构建链支持 Windows x64、macOS Intel x64 与 Apple Silicon arm64，三平台 dev 安装包均已构建成功。Windows 保持既有正式发行基线；macOS DMG 尚未完成 Developer ID 签名、公证及当前候选包的干净机安装启动验收，不等同于已完成正式发行。构建与发布合同以 [Build](../build/README.md) 为准。Electron 开发态对 renderer 暴露宿主
`process.platform`，已验证 `win32` 与 `darwin`。

工作空间根目录由 backend 按宿主平台校验：Windows 接受盘符绝对路径或
UNC 路径，POSIX 宿主接受以 `/` 开头的绝对路径。renderer 使用同一
`desktopRuntime.platform` 合同做提交前校验，backend 保留最终校验责任。

## 适合什么时候读

这些场景建议先读这页：

- 改请求链路
- 改 backend host / port 来源
- 改 preload 暴露面
- 改 Electron 打包边界

涉及 Main Agent / Skill Agent 的任务局部执行所有权、私有 Runtime、approval checkpoint resume 或多 Agent 产品表述时，先读 `multi-agent-execution-truth.md`。

## 相关文档

- `ipc-and-preload.md`
- `api-response-spec.md`
- `model-config-api.md`
- `context-budget-runtime.md`
- `chat-agent-fast-review-2026-06-27.md`
- `mcp-marketplace-agent-integration.md`
- `multi-agent-execution-truth.md`
