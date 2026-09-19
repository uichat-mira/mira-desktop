---
status: current
priority: P0
owner: forge / server
last_verified: 2026-09-05
layer: project-control
module: Forge
feature: MainThread
doc_type: task-card
canonical: true
related:
  - docs/project-control/tasks/forge_T004-project-registry-and-repository-task-source.md
task_state: DONE
---

# forge_T005 Main Thread Runtime and Provider Adapters

## Target

迁移 Forge Main Thread，使其成为“某个工程项目的长期总控线程”：负责讨论、只读检查、理解 Repository Task、显式产生 Task 写入 / Dispatch Handoff，但绝不直接成为 Builder。

## Must Read

- `AGENTS.md`
- `docs/forge/FORGE_CURRENT_CONTRACT.md`
- 源 Forge T015
- 源 Forge `server/main-thread-domain.mjs`
- `server/main-thread-manager.mjs`
- `server/main-thread-adapters.mjs`
- `server/codex-desktop-adapter.mjs`

## Allowed Changes

- `server/src/forge/main-thread/**`
- `server/src/forge/adapters/main-thread/**`
- `server/src/forge/**` 中直接相关 types / tests
- 本任务卡状态 / 证据

## Forbidden Changes

- 用 Mira 普通 Chat Thread ID 直接替代 Forge Main Thread
- Main Thread 获得 project file write 权限
- Main Thread 自动 Dispatch
- 把完整 Main Thread conversation 注入 Builder
- 把 PiAgent 擅自加入 Main Thread provider
- 抓取 Codex Desktop UI
- 修改 Mira Chat runtime / AgentGraph 来迁就 Forge

## Required Behavior

- 支持 OpenCode、Codex Desktop、Codex CLI 三种 Main Thread adapter。
- OpenCode main thread 保持 plan / read-oriented 权限。
- Codex main thread 保持 read-only sandbox 与 approval never。
- durable external thread ID 必须精确续接，不允许 provider 偷换线程。
- provider thinking / tool / artifact 映射到 bounded normalized events。
- 默认 provider turn timeout 维持当前已验证的 3,000,000ms，除非有新证据支持修改。
- Task inspect / resolve / create / update / handoff 全部通过 Forge capability boundary。

## Construction Evidence

- Base: `dev@271ce832e2f700412b0385971046aafd4e47d8c6`.
- 新增 `server/src/forge/main-thread/**`：
  - provider-neutral durable Main Thread domain；
  - Main Thread manager；
  - ForgeRuntime lifecycle attach helper；
  - durable reopen / continuation、wrong-thread、read-only violation、Task capability / explicit handoff、restart reconcile 回归。
- 新增 `server/src/forge/adapters/main-thread/**`：
  - OpenCode Main Thread adapter；
  - Codex CLI Main Thread adapter；
  - Codex Desktop app-server adapter；
  - 默认 adapter registry。
- 支持且仅支持 `opencode` / `codex-desktop` / `codex` 三种 Main Thread adapter；未引入 PiAgent Main Thread。
- OpenCode 固定 `--agent plan`，并注入 deny-by-default、read/glob/grep/list/lsp/webfetch/websearch allow 的 `OPENCODE_PERMISSION`。
- Codex CLI 固定 `--sandbox read-only --ask-for-approval never`。
- Codex Desktop 固定 thread-level `sandbox: read-only`、turn-level `sandboxPolicy: { type: "readOnly" }`、`approvalPolicy: never`。
- 三种 provider 默认 turn timeout 均保持固定源已验证的 `3_000_000ms`。
- durable external thread/session ID 继续精确续接；Codex / Codex Desktop 对 wrong-thread 明确失败，OpenCode 对 provider 报告的不同 session 明确失败。
- provider thinking / tool / artifact 进入 bounded normalized Main Thread events；provider file-change / edit-write 类事件按 read-only contract violation 失败。
- Main Thread Task inspect / resolve / create / update 全部复用 T004 project/task capability boundary；未直接读写第二套 task DB。
- 显式 handoff 只持久化 `projectId + taskId + taskRef + preferredBuilder` 引用，不创建 Dispatch、不启动 Builder。
- 未搬固定源后期的 `docs/workbench/**` 隐式 Task Source fallback；Mira T004 已冻结为显式 task source 配置，本卡继续遵守该合同。
- 未接 route / Desktop / Mira Chat / AgentGraph；未加入 Builder Result 回注、Reviewer 或自动 Dispatch。

## Acceptance Criteria

1. 一个 registered project 可以打开 durable Main Thread。
2. 刷新 / restart 后可继续已保存 thread state；active turn 丢失 supervision 时明确 error/interrupted。
3. Main Thread 能读真实 Task Source。
4. Task 写入和 handoff 都是显式动作。
5. provider reported file change 在 read-only Main Thread 中被视为合同违规。
6. 不与 Mira Chat persistence / semantics 混成同一对象。

## Validation

- provider adapter fake-process tests
- durable continuation tests
- wrong-thread / write-attempt tests
- server typecheck
- `git diff --check`

## Final Review Evidence

- PR #103，base=`dev`，feature branch=`feature/forge-t005-main-thread-runtime`。
- Branch Policy on code HEAD `946cdeb4476064e84584622f6173c298ed7430f6`: PASS。
- CodeRabbit 已启动 review 但当前仍为 pending；Codex 已触发 latest-head review但未返回正式 finding。按 owner 明确规则，外部 reviewer 无有效结论时允许自审收口，不让 review quota / pending 状态卡死主线。
- Self-review 重点核验：
  - Main Thread 仅支持 `opencode / codex-desktop / codex`，无 PiAgent；
  - OpenCode 固定 plan + deny-by-default read-oriented permission；
  - Codex CLI / Desktop 均固定 read-only + approval never；
  - 三 provider 默认 timeout 均为 `3_000_000ms`；
  - durable external thread/session identity 必须精确续接；
  - provider file-change / edit-write evidence 会触发 read-only contract violation；
  - Main Thread state / events 独立于 Mira Chat persistence；
  - Task inspect / resolve / create / update 全部复用 T004 capability boundary；
  - handoff 只持久化 repository task reference，不创建 Dispatch；
  - restart active turn 继续由 Forge runtime reconcile 为 error/interrupted；
  - adapter dispose 可挂入 T003 ForgeRuntime resource lifecycle。
- Scope audit：仅本任务卡、`server/src/forge/main-thread/**`、`server/src/forge/adapters/main-thread/**`、Forge barrel；代码中无 route、Builder dispatch、Mira Chat / AgentGraph 修改。
- Static hygiene：changed files 0 conflict marker、0 trailing whitespace。
- 新增 provider fake-process / durable continuation / wrong-thread / write-attempt / Task capability / explicit handoff regressions。当前 PR workflow 不执行 Forge Vitest，因此不伪造“定向 Vitest 已运行”；合并后以 `dev` 的 `pnpm check` 和 Windows staged-server smoke 为最终整仓门禁。
- Final self-review: PASS。若合并后任一真实门禁失败，立即重开 T005。

## Post-Merge Gate Failure — 2026-09-06

- PR #103 merge SHA `97bd347ae54fe8d3ef194efb8c7fc7ad10623530` 的 Windows staged-server smoke PASS，但 `Check dev -> Type check` FAIL；因此 T005 已按既定规则立即重开。
- 失败仅有两个 T005 自身 TypeScript blocker：
  1. `codex-desktop.ts` 对异步 notification callback 写入的 `terminal` 做 optional property access 时，被 TypeScript 控制流收窄为 `never`；改为先经 `asRecord(terminal)` 恢复运行时 record 边界，再读取 `params`，不改变协议行为。
  2. `main-thread/runtime.ts` 注册到 T003 `ForgeRuntimeManagedResource` 的 `reconcile` 必须是 `void | Promise<void>`，但 manager 返回 interrupted thread ID list；adapter 改为 await 后丢弃返回值，不改变 manager reconcile 结果本身。
- 修复分支：`fix/forge-t005-typecheck`。除上述两处类型适配与本卡状态/证据外不改功能合同。

- Typecheck remediation self-review: PASS。PR #104 仅包含两个已由 `dev` 失败日志精确定位的 T005 类型适配，以及本卡证据；Branch Policy PASS，0 unresolved review thread。外部 reviewer 未返回新 finding，按 owner fallback 规则由自审收口。
- 最终完成仍以 PR #104 合并后的 `dev -> pnpm check` 重新变绿为准；如仍失败再次重开。

## Unknown / Human Decision

None.
