# Forge API Current Contract

Status: Current  
Owner: Forge / Mira Server / Desktop  
Last verified: 2026-09-06

## Purpose

Forge / 淬行通过 Mira Server 的正式 HTTP contract 提供产品能力。

- Backend route namespace: `/forge/**`
- Development renderer: 通过现有 Vite proxy 请求 `/api/forge/**`
- Production renderer: 通过现有 `window.desktopApi.backendUrl` 机制请求 backend
- Forge 不启动第二 HTTP server
- Renderer 不直接访问 Node、filesystem、child_process、Forge persistence 或固定端口

## Stable Product Surface

### Metadata and runtime projection

- `GET /forge/meta`
- `GET /forge/runtime/summary`
- `GET /forge/inspector`
- `GET /forge/events`
- `GET /forge/dispatches`

这些接口只暴露 UI 所需的稳定产品投影。Runtime event data 会做深度、数量与字符串长度约束；provider metadata 仅保留 normalized optional fields。

### Projects and repository Task Source

- `GET /forge/projects`
- `POST /forge/projects`
- `GET /forge/projects/:projectId`
- `PATCH /forge/projects/:projectId`
- `GET /forge/projects/:projectId/task-source`
- `PATCH /forge/projects/:projectId/task-source`
- `GET /forge/projects/:projectId/tasks`
- `POST /forge/projects/:projectId/tasks`
- `GET /forge/projects/:projectId/tasks/:taskId`
- `PATCH /forge/projects/:projectId/tasks/:taskId`

Repository Work Ledger + Task Card 仍是 repository task truth。API 不建立第二 Task database。

### Batches and readiness

- `GET /forge/batches`
- `POST /forge/projects/:projectId/batches`
- `GET /forge/batches/:batchId`
- `GET /forge/batches/:batchId/readiness`

Runtime Task 通过 Batch 读取；不提供 generic runtime task status PATCH。

### Main Thread

- `GET /forge/threads`
- `POST /forge/threads`
- `GET /forge/threads/:threadId`
- `POST /forge/threads/:threadId/messages`
- `GET /forge/threads/:threadId/tasks`
- `POST /forge/threads/:threadId/tasks`
- `GET /forge/threads/:threadId/tasks/:taskId`
- `PATCH /forge/threads/:threadId/tasks/:taskId`
- `POST /forge/threads/:threadId/handoffs`

Main Thread 的 Task actions 继续经过 T004 repository task capability boundary；handoff 只表达显式引用，不自动启动 Builder。

### Builder dispatch

- `POST /forge/batches/:batchId/tasks/:taskId/dispatch`
- `POST /forge/dispatches/:dispatchId/cancel`

只暴露 T006 explicit dispatch / cancel contract。不存在自动 fallback、并行 Builder、auto push/merge/deploy API。

### Review and integration

- `GET /forge/reviews`
- `POST /forge/reviews`
- `POST /forge/reviews/:reviewId/result`
- `POST /forge/batches/:batchId/tasks/:taskId/integrate`

Review / integration 只调用 T007 guarded actions。API 不暴露 generic `review_passed` / `integrated` status patch。

## Auth and error handling

Forge routes 沿用 Mira Server 全局 authentication hook；`/forge/**` 不在 auth-exempt 列表中。

Desktop client 复用 `desktop/src/shared/lib/request.ts`：

- 自动使用现有 backend base URL
- 自动附加 session bearer token
- 统一解析 Mira success/error envelope
- 不在 Forge client 内重复 host / port / auth / error 逻辑

## Runtime ownership

Route 注册阶段不创建第二 runtime。

Default Forge route service 通过 T003 `initializeForgeRuntime()` 幂等入口取得同一个 singleton，并按需一次性 attach：

- T005 Main Thread runtime
- T006 Builder dispatch runtime
- T007 Review manager

这些 manager 继续受同一个 ForgeRuntime lifecycle 管理。
