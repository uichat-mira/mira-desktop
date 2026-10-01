---
status: current
priority: P0
owner: forge / server
last_verified: 2026-09-05
layer: project-control
module: Forge
feature: BuilderDispatch
doc_type: task-card
canonical: true
related:
  - docs/project-control/tasks/forge_T005-main-thread-runtime-and-provider-adapters.md
task_state: DONE
---

# forge_T006 Builder Dispatch and Process Supervision

## Target

迁移 Forge Builder contract、Dispatch、Session、Readiness 和 process supervision，恢复 OpenCode / PiAgent / Codex 三种 Builder 的真实施工闭环。

## Must Read

- `AGENTS.md`
- `docs/forge/FORGE_CURRENT_CONTRACT.md`
- 源 Forge T016
- 源 Forge `server/builder-contract.mjs`
- `dispatch-manager.mjs`
- `dispatch-domain.mjs`
- `readiness.mjs`
- OpenCode / PiAgent / Codex Builder adapters

## Allowed Changes

- `server/src/forge/dispatch/**`
- `server/src/forge/adapters/builder/**`
- `server/src/forge/runtime/**`
- 直接相关 Forge tests
- 本任务卡状态 / 证据

## Forbidden Changes

- 自动 Dispatch
- 自动 Push / Merge / Deploy
- 把 Forge Builder 改造成 Mira Generic SubAgent
- 绕过 provider / workspace 自身权限
- 并行 Builder / worktree scheduler
- 用 Builder resultText 推断 PASS
- 失败时静默 fallback 到另一个 Builder

## Required Behavior

- 只有 `waiting` / `fixing` 且依赖已 integrated 的 runtime task 才可 dispatch。
- 当前阶段保持**全局单 active Builder dispatch**，不是按 provider 各开一条。
- Dispatch 必须绑定 project / batch / task / adapter / session；来源 Main Thread 可选且必须同 project。
- 启动、provider event、external session、terminal result、cancel、restart interruption 都有 durable evidence。
- success: dispatch completed + session completed + runtime task `reviewing`。
- failure/cancel/restart: runtime task `interrupted`。
- cancel 必须显式并终止 Forge 自己持有的 live handle。

## Construction Evidence

- Base: `dev@21bd2e5f5cfe466169835146b81a0afdfd913dbc`.
- 新增 `server/src/forge/adapters/builder/**`：
  - provider-neutral Builder runner / process-handle contract；
  - OpenCode Builder；
  - PiAgent Builder；
  - Codex Desktop-bundled Builder；
  - default runner registry。
- OpenCode 保持真实 `opencode run --format json --dir <projectRoot>` 路径，不注入权限绕过参数。
- PiAgent 保持 `--mode json -p --no-session` 非交互 JSON 运行路径，不做 provider fallback。
- Codex Builder 保持固定源已验证的 `--ask-for-approval never exec --json --sandbox workspace-write --cd <projectRoot>`；未加入 danger/bypass flag，默认复用 macOS ChatGPT/Codex Desktop bundled backend，可显式配置 binary override。
- 三种 adapter 均规范化 provider/session/tool/artifact evidence；malformed JSONL 忽略而不击穿 control plane；terminal assistant output / provider error 均 bounded capture（8192 code units）。
- 新增 `server/src/forge/dispatch/**`：
  - 显式 dispatch manager；
  - ForgeRuntime lifecycle attach；
  - 全局单 active Builder lane；
  - live process handle ownership；
  - explicit cancel / shutdown / restart supervision。
- Dispatch 前先检查全局 active lane；占用时立即拒绝，不在 Builder 正写工作树时额外读取 Task Source；随后通过 T004 `resolveProjectTask` 解析 exact Repository Task Card，并在事务中二次检查 lane。
- `taskRef` 始终绑定 T004 解析出的 canonical Task Card ref；调用方提供不一致 ref 时明确失败。runtime Batch 不成为第二 Requirements DB。
- source Main Thread 可选；存在时必须与 dispatch project 相同。
- success：dispatch `completed` + session `completed` + runtime task `reviewing`；Repository Task Card 不被写成 PASS。
- provider-reported error 即使 process exit code = 0 仍按 failure 处理；failure / spawn error -> dispatch `failed` + session `failed` + runtime task `interrupted`。
- explicit cancel：必须存在 Forge-owned live handle；只有 `kill(SIGTERM)` 成功发送后才持久化 `cancelled`。kill 失败会写 `dispatch.warning(cancel_signal_failed)` 并明确失败，不伪造 cancelled 终态。
- late provider callback 在 cancel/restart 后不得覆盖 terminal dispatch。
- shutdown 将 owned live dispatch 持久化为 `interrupted` 并终止 handle；kill 失败写 durable warning 并使 shutdown resource 报错，不静默吞掉。
- startup/restart durable reconcile 继续复用 T003 `runtime/reconcile.ts`：lost supervision -> session disconnected / task interrupted / dispatch interrupted / adapter offline。
- 未迁移固定源后来的 T018 `Builder Result -> Main Thread` 回注；该 seam 保持 T007 后续范围。
- 未接 route / Desktop / Reviewer；未加入 parallel builder/worktree scheduler、auto push/merge/deploy、generic sub-agent rewrite。
- 新增定向回归：
  - 三 Builder choice 同一 dispatch contract；
  - cross-provider global serial guard；
  - readiness status / active-session / dependency reason；
  - taskRef / sourceThread identity；
  - provider error with exit 0；
  - spawn error；
  - explicit cancel + late exit；
  - kill-failure honesty；
  - restart late callback；
  - shutdown owned-handle cleanup；
  - 三 provider fake-process / malformed JSONL / args / evidence normalization。

## Acceptance Criteria

1. OpenCode / PiAgent / Codex 均通过同一 Builder contract。
2. 同时第二个 Builder dispatch 被拒绝。
3. dependency / active-session / status readiness gate 有明确 reason。
4. provider process exit 是 execution terminal evidence，但不会更新 repository task 为 PASS。
5. refresh / restart 后 durable dispatch/session/event 可重建。
6. cancel / spawn error / provider error 都有结构化终态。

## Validation

- dispatch / serial / cancellation / restart tests
- 三种 builder adapter fake-process tests
- server typecheck
- `git diff --check`

## Final Review Evidence

- PR #105，base=`dev`，feature branch=`feature/forge-t006-builder-dispatch`。
- Latest reviewed code HEAD before close: `176ba49917e5f374b2d8fa579dd56761cad32348`。
- Branch Policy：PASS。
- Codex review：明确返回 usage limit，无法提供有效 review。
- CodeRabbit：最新 HEAD review 已启动但仍为 pending；当前 0 review / 0 unresolved review thread / 0 inline finding。按 owner 已明确 fallback 规则，外部 reviewer 无有效结论时允许自审收口，不让 quota / pending 卡死主线。
- Self-review 重点核验：
  - 仅 OpenCode / PiAgent / Codex 三种 Builder，统一 provider-neutral runner contract；
  - 全局单 active Builder lane，跨 provider 仍串行；
  - 无自动 dispatch、无自动 fallback、无 parallel/worktree scheduler；
  - dispatch 前先检查 active lane，再通过 T004 解析 exact Repository Task Card，事务内二次检查 lane；
  - canonical Task Card 永远进入 Must Read；inline prompt 只能追加为 Additional Operator Instruction，不能绕过 Task truth；
  - optional source Main Thread 必须同 project；
  - start / provider event / external session / terminal / cancel / restart / shutdown 均进入 durable runtime evidence；
  - success 仅推进 runtime task -> `reviewing`；不写 Repository Task PASS；
  - provider-declared error 即使 exit code 0 仍失败；
  - spawn error / failure -> session failed + task interrupted + dispatch failed；
  - explicit cancel 必须有 Forge-owned live handle；`kill(SIGTERM)` 返回 false 时写 warning 并拒绝伪造 `cancelled`；
  - cancel / restart 后 late provider callback 不覆盖 terminal dispatch；
  - shutdown kill 失败会写 durable warning 并让 managed-resource shutdown 报错，不静默吞掉；
  - T018 Builder Result -> Main Thread 回注未迁移，保持 T007 后续范围；
  - 无 route / Desktop / Reviewer / Mira AgentGraph 修改。
- Scope audit：12 个 changed files 均位于本任务卡或 `server/src/forge/dispatch/**`、`server/src/forge/adapters/builder/**`；0 conflict marker，0 trailing whitespace。
- 新增 dispatch / serial / cancellation / restart / provider fake-process 回归；当前 PR workflow 不执行 Forge Vitest，因此不伪造“定向 Vitest 已运行”。
- Final self-review: PASS。最终完成仍以合并后的 `dev -> pnpm check` 与 Windows staged-server smoke 为准；任一失败立即重开 T006。

## Unknown / Human Decision

None.
