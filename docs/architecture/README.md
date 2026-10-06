# 架构总览

Status: Current
Owner: runtime
Last verified: 2026-07-25
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
  - ../platform/tauri.md

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
| Desktop shell | Electron main + preload，另有 Tauri 壳层 |
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

```text
renderer (Vite dev server) -- /api proxy --> Fastify backend
desktop shell --------------------------------^
```

本地 renderer 开发服务默认监听 `http://127.0.0.1:5757`。端口统一来自
`runtime.config.cjs`，需要覆盖时使用 `UI_CHAT_DESKTOP_PORT`，Electron、
Tauri 和 Vite 不分别维护端口常量。

### 打包态

```text
UIChat.exe
  ├─ Electron main process
  ├─ preload bridge
  └─ bundled Node backend
       └─ terminal -> bundled Terminal Dev Runtime + system PATH fallback
```

Tauri 形态下同样复用前端构建产物和 backend bundle，只是壳层实现不同。

Electron 和 Tauri 还共享同一批 `node-runtime/` 与 `terminal-runtime/` staging 输入。桌面壳层只把 resources 根目录传给 Backend；终端 PATH 的组件校验、优先顺序和 system fallback 由 Backend 统一处理，不进入 renderer 或 preload 合同。详见 `../build/terminal-dev-runtime.md`。

## 当前稳定边界

- backend 是业务契约与运行时真相的主要落点
- preload 只暴露最小必要面
- renderer 不直接分支操作 host / port / native runtime
- 桌面壳层之间共享尽可能多的构建输入
- 模型调用前的上下文预算与审计应由 backend runtime 统一处理
- Main Agent、forked Skill Agent、private Runtime、审批恢复和 Parent recovery 的当前合同见 `multi-agent-execution-truth.md`

当前正式打包仍以 Windows 为基线。Electron 开发态对 renderer 暴露宿主
`process.platform`，已验证 `win32` 与 `darwin`；Tauri 当前仍只按
Windows 合同提供 `win32`，macOS 平台值对齐尚未进入实现。

工作空间根目录由 backend 按宿主平台校验：Windows 接受盘符绝对路径或
UNC 路径，POSIX 宿主接受以 `/` 开头的绝对路径。renderer 使用同一
`desktopRuntime.platform` 合同做提交前校验，backend 保留最终校验责任。

## 适合什么时候读

这些场景建议先读这页：

- 改请求链路
- 改 backend host / port 来源
- 改 preload 暴露面
- 改 Electron / Tauri 打包边界

涉及 Main Agent / Skill Agent 的任务局部执行所有权、私有 Runtime、approval checkpoint resume 或多 Agent 产品表述时，先读 `multi-agent-execution-truth.md`。

## 相关文档

- `ipc-and-preload.md`
- `api-response-spec.md`
- `model-config-api.md`
- `context-budget-runtime.md`
- `chat-agent-fast-review-2026-06-27.md`
- `mcp-marketplace-agent-integration.md`
- `multi-agent-execution-truth.md`
- `../platform/tauri.md`
