---
status: current
priority: P0
owner: forge / server
last_verified: 2026-09-05
layer: project-control
module: Forge
feature: RuntimeLifecycle
doc_type: task-card
canonical: true
related:
  - docs/project-control/tasks/forge_T002-core-import-and-dependency-unification.md
task_state: DONE
---

# forge_T003 Forge Runtime Lifecycle and Persistence Ownership

## Target

让 Forge 成为 Mira Server 内部受管理 runtime，而不是 `127.0.0.1:47831` 上的第二个独立 control-plane 进程。

同时收口 Forge durable state 的所有权：保留旧 state schema 的行为语义和原子/串行 mutation 保障，但新运行态必须由 Mira 管理其存储生命周期。

## Must Read

- `AGENTS.md`
- `docs/architecture/README.md`
- `docs/forge/FORGE_CURRENT_CONTRACT.md`
- `server/src/index.ts`
- `server/src/db/index.ts`
- 源 Forge `server/store.mjs`、`server/index.mjs`、dispatch/main-thread reconcile 逻辑

## Allowed Changes

- `server/src/forge/**`
- `server/src/index.ts`（仅 Forge 初始化 / shutdown 接线）
- `server/src/config/**` 或现有配置入口（仅 Forge 必需项）
- 相关 server 测试
- 本任务卡状态 / 证据

## Forbidden Changes

- 新开 Forge HTTP server / 固定端口
- 新增 sidecar / child process 来承载 Forge Core
- 使用进程 cwd 作为未经验证的持久数据目录
- 把完整 Repository Task Card 正文复制进 Forge runtime state
- 在本卡强制重写成全新 SQLite schema，除非当前 Mira 已有明确可复用持久化合同且行为等价可证明
- 改 Desktop UI

## Required Behavior

- Mira Server 启动时创建唯一 Forge runtime。
- Mira Server 正常 shutdown 时显式关闭 Forge managers / provider-owned resources。
- 启动 reconcile 必须把丢失 supervision 的 active dispatch / main-thread turn 标成 interrupted/error，而不是假装继续运行。
- 新安装不再依赖独立 Forge server 或独立 dependency install。
- 若支持旧 `~/.mira-forge/state.json` 导入，只允许一次性、可观察、可失败的迁移；不得静默双写两个真相源。

## Data Root Decision

- Mira 已有稳定 backend data-root 链路：生产 Electron 将 `app.getPath("userData")/data` 注入 `UI_CHAT_DATABASE_DIR`；Server `setupDatabase()` 最终把实际 SQLite 文件写入绝对 `DATABASE_URL`。
- Forge 不直接读取 `process.cwd()` 作为持久化根。Forge runtime 仅在 Mira database 初始化之后，从**绝对 SQLite `DATABASE_URL` 的父目录**派生 `<backend-data-root>/forge/state.json`。
- 相对 `DATABASE_URL`、`:memory:`、非 SQLite durable URL 在 Forge 初始化时显式失败，不隐式 fallback 到 cwd。
- 本卡不自动导入旧 `~/.mira-forge/state.json`，也不双写旧/新 state。若后续需要旧数据迁移，必须另做一次性、可观察、可失败的迁移路径。
- 继续使用 schemaVersion 1 JSON runtime state，保留旧 Forge 原子 temp-file + rename 和串行 mutation 语义；本卡不顺手改成新的 SQLite schema。

## Construction Evidence

- Base: `dev@5453e473eec7b2399a2e3d33d06927ecd9d5ae1f`.
- 新增 `server/src/forge/runtime/**`：runtime state/schema、Mira-owned store、persistence path resolver、startup reconcile、runtime singleton/lifecycle resource registry。
- startup reconcile 覆盖：
  - 非 terminal dispatch → `interrupted`；
  - active Builder session → `disconnected`；
  - runtime task `building` → `interrupted`；
  - adapter → `offline`；
  - Main Thread `running` → `error` + durable interrupted status event。
- 已完成 Mira Server 接线：只有 `server/src/index.ts` 的 Forge initialize / `onClose` shutdown；没有 Forge route、固定端口、sidecar 或 child control-plane。
- runtime 支持 manager/resource 注册：初始化前注册会在 runtime initialize 时 reconcile；初始化后注册会立即 reconcile；shutdown 反向关闭全部已注册资源并 flush durable store。T005/T006 后续 manager 可直接挂入，不需要第二套生命周期。
- 新增定向测试：persistence reopen、serialized mutation、temp-file atomic write、schema-1 additive compatibility、absolute data-root guard、dispatch/Main Thread restart reconcile、terminal fact preservation、singleton、concurrent initialize idempotency、managed-resource shutdown。
- 旧 `127.0.0.1:47831` 和 `MIRA_FORGE_STATE_FILE` 均未进入新实现。

## Acceptance Criteria

1. Forge Runtime 生命周期由 Mira Server 拥有。
2. 无 `:47831` 第二服务依赖。
3. durable state 在刷新 / server restart 后可恢复非活动事实。
4. active process supervision 丢失时能可靠 reconcile。
5. shutdown 不遗留 Forge 自己启动的 provider 子进程。
6. persistence 路径与所有权有文档和测试，不产生第二套业务真相。

## Validation

- runtime lifecycle / reconcile 定向测试
- persistence reopen 测试
- server typecheck
- `pnpm check`（若修改 server bootstrap）
- `git diff --check`

## Review Readiness

- Branch Policy on PR #101 latest reviewed HEAD: PASS.
- Latest scope audit: only this task card, `server/src/forge/**`, and the allowed Forge lifecycle wiring in `server/src/index.ts`.
- Static hygiene: no conflict markers / trailing whitespace; earlier barrel literal-newline pollution and stale invalid type import were found by self-review and fixed before review readiness.
- Production Forge runtime contains no `process.cwd()`, `:47831`, `MIRA_FORGE_STATE_FILE`, or legacy `.mira-forge` dependency.
- Existing repository/CI `DATABASE_URL` usages inspected are absolute file paths; T003's relative-path rejection does not conflict with the repository's canonical startup/CI path contract.
- Current execution environment does not have a writable checkout with dependencies, so pre-merge full `pnpm check` / focused Vitest are not claimed. As with T002, merge is gated by code review/static contract inspection, then the real `dev` push `Check dev -> pnpm check` and Windows staged-server smoke are authoritative; any failure reopens T003 immediately.

- Final self-review: PASS。T003 满足 runtime ownership / persistence / restart reconcile / shutdown 边界；无独立 server、sidecar、旧 state 双写或 cwd-owned durable root。
- AI review 当前无 unresolved blocker；CodeRabbit 对早期 HEAD 报出的 barrel syntax 问题已在最新 code HEAD 修复。最终是否站稳以合并后 `dev` 的 `pnpm check` 与 Windows staged-server smoke 为准，失败立即重开 T003。

## Unknown / Human Decision

如果 Mira 当前不存在稳定、用户可写的 backend data-root 抽象，停止在路径决策点并报告；不得自行把 `process.cwd()` 当长期用户数据目录。
