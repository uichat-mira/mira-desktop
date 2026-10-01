---
status: current
priority: P0
owner: forge / integration
last_verified: 2026-09-06
layer: project-control
module: Forge
feature: CutoverAcceptance
doc_type: task-card
canonical: true
related:
  - docs/project-control/tasks/forge_T009-desktop-cuixing-product-surface.md
task_state: READY_FOR_REVIEW
---

# forge_T010 End-to-End Cutover and Legacy Retirement

## Target

完成淬行在 Mira 内的真实产品闭环验收，并切断对独立 `mira-forge` 工程、端口、依赖和前端构建的运行时依赖。

这是迁移收口卡，不负责补做前面漏掉的大功能。

## Must Read

- `AGENTS.md`
- `docs/forge/FORGE_CURRENT_CONTRACT.md`
- forge_T001-T009 及其 Evidence
- Mira packaging / runtime docs
- 源 Forge T018 当前验收要求

## Allowed Changes

- Forge 迁移后模块的验收修正（仅真实 integration defect）
- Forge / Mira 集成 smoke tests
- packaging / runtime config 中仅 Forge 必需改动
- `docs/forge/**`
- `docs/CURRENT_PRODUCT_TRUTH.md`
- `docs/ENGINEERING_MEMORY.md`
- 本任务卡 / 总台账状态与证据

## Forbidden Changes

- 为通过 smoke 引入 hardcoded 本地路径
- 临时 mock / silent fallback 进入生产主链
- 自动 Reviewer / parallel Builder / worktree scheduler
- 自动 Push / Merge / Deploy
- 把未观察到的真实产品链写成 PASS
- 因迁移失败重新恢复独立 Forge server 作为兜底

## Required Product Smoke

至少一条真实链：

```text
Register / select real project
  -> Main Thread reads real task source
  -> resolve exact Task Card
  -> explicit Dispatch
  -> real Builder starts
  -> Runtime Summary / Inspector shows authoritative state
  -> Builder terminal
  -> runtime task becomes reviewing
  -> related Main Thread receives one builder_result
  -> next Main Thread turn uses the result
```

同时验证：

- cancel / interrupted 可观察；
- refresh / Mira Server restart 后 durable state 可重建；
- no second Forge HTTP server；
- no Forge standalone dependency install；
- packaged Desktop 能找到并使用同一 Forge runtime。

## Legacy Retirement

迁移验收通过后：

- `uichat-mira` 成为 Forge 唯一 active source of truth；
- 独立 `mira-forge` 不再参与 build / release / runtime / active development；
- 旧仓如需保留，只能作为 historical / archived reference，并明确指向 Mira 新位置；
- 是否物理删除旧 GitHub repository 不由施工线程擅自执行。

## Acceptance Criteria

1. 上述真实 Builder product-loop 有可检查 evidence。
2. `pnpm check` 通过。
3. 涉及 packaging/runtime 的目标平台 package build 通过。
4. 未出现第二 lockfile / workspace / Forge package。
5. 未出现 `:47831` 运行时依赖。
6. T018 对应真实链路能力在 Mira 中重新验收，不继承旧仓未完成结论。
7. current truth / engineering memory 已更新到淬行合并后的真实状态。

## Validation

- focused Forge tests
- server + desktop typecheck
- `pnpm check`
- packaging build（按当前目标平台）
- real product-loop smoke
- `git diff --check`

## Unknown / Human Decision

旧 `mira-forge` GitHub repository 最终选择 Archive 还是 Delete 属于 owner 仓库治理动作；本卡只要求其退出 active product source-of-truth。


## Construction Evidence

### Current Mira chain audit

2026-09-06 对当前 `dev` 重新核对真实实现，没有为 T010 改写主状态机：

- Desktop `useForgeWorkspace.dispatchTask()` 会先取得当前 project 的 Main Thread，并把其 `thread.id` 作为 `sourceThreadId` 传入显式 Dispatch；
- Server Dispatch manager 拒绝 cross-project `sourceThreadId`；
- Builder terminal success 写入 `dispatch=completed` / session completed / runtime task `reviewing`，failure/cancel/restart 写入对应 terminal/interrupted truth；
- terminal Dispatch 通过 `appendBuilderResultHandoff` 向显式相关 Main Thread 写入 durable handoff，identity 包含 project/batch/task/taskRef/dispatch/session/adapter；
- Main Thread 下一次 user turn 通过 `getPendingBuilderResults` 把新 handoff 作为 bounded Forge context 注入 provider prompt，明确 runtime state authoritative、result prose explanatory；
- Forge Runtime startup reconcile 对 lost supervision 不做伪恢复；
- `server/src/index.ts` 注册 Forge routes，并由同一个 Mira Server lifecycle initialize / shutdown Forge runtime；
- Desktop typed client 继续使用 Mira 现有 request / backend URL contract，不连接第二 Forge HTTP server。

上述是代码路径审计，不等于真实 provider product-loop 已观察 PASS。

### T010 regression gates

本卡新增：

- `scripts/check-forge-cutover.mjs`
  - 纳入根 `pnpm check`；
  - 检查 integrated Forge runtime roots；
  - 阻断 Forge 内第二 package / lockfile / workspace / Vite root；
  - 阻断 runtime surface 的 `47831` / `MIRA_FORGE_STATE_FILE` / `.mira-forge`；
  - 阻断把 standalone `mira-forge/` source tree 嵌回主仓。
- `scripts/smoke-staged-server-runtime.mjs`
  - 在既有 Windows staged Node/native smoke 上增加 packaged `server.cjs` Forge cutover 检查；
  - 要求 bundle 包含 `/forge/meta` 和 Mira-owned Forge initialization；
  - 要求 bundle 不包含旧 control-plane / state-root marker。
- `docs/forge/cutover-smoke.md`
  - 固定最终 real product-loop、cancel、restart、package evidence 记录格式；
  - 明确旧 Forge T018 仍停留在 REVIEW，不能继承不存在的 PASS。

### Source T018 revalidation

重新读取固定源后期 T018 合同及 PR #24/#25/#26/#27。源仓最终真实缺口是：在修复 Codex Desktop single-writer continuation 后，仍缺一条真实 local Builder observational smoke，尤其是 terminal Builder result -> Main Thread -> next Main Thread turn。

因此 Mira T010 继续要求真实复测，不继承旧仓自动测试或 T016 smoke。

## Automated Cutover Evidence

Current integrated implementation commit:

`1ed6bbe33072ef5be42e973d5929e273a2450568`

GitHub Actions on 2026-09-06:

- **Build Desktop Apps / Check dev** — PASS
  - run id: `34031409151`
  - job id: `101481484853`
  - checkout SHA: `1ed6bbe33072ef5be42e973d5929e273a2450568`
  - executed root `pnpm check`
  - log evidence: `Forge cutover check passed: integrated runtime roots are present and no standalone Forge package/control-plane markers were found.`
  - Desktop / Server / workspace typecheck completed successfully.
- **Windows Native Runtime Smoke / Staged server runtime** — PASS
  - run id: `34031409141`
  - job id: `101481484803`
  - log evidence: `Staged server Forge cutover smoke passed.`
  - log evidence: `Staged server native runtime smoke passed.`
  - therefore current staged `server.cjs` contains integrated Forge and excludes the legacy `:47831` / independent state-root markers checked by the smoke.

These runs establish Acceptance Criteria 2, 4 and 5 for the merged implementation, plus the staged backend portion of packaging/runtime validation. They do **not** establish a full Electron package build or real provider product-loop.

## Legacy Retirement Evidence

Standalone source repository `dangjingtao/mira-forge` is no longer presented as the active Forge product source:

- legacy `dev` README: PR #28 merged, commit `92c9112da5f9899624fd8e5728540a54fba46149`;
- default `main` README: PR #29 merged, commit `a15d1eda2d2d051bbf064af5f5ca9bbde7698bc5`;
- both landing surfaces now mark the repository **Historical** and point active development to `dangjingtao/uichat-mira`;
- the old standalone server / `:47831` / package / Vite instructions are explicitly retained only as historical implementation evidence;
- repository Archive/Delete was not performed and remains the owner governance decision recorded by this card.

This closes the non-destructive source-of-truth retirement requirement without rewriting or deleting the frozen migration evidence.

## Remaining Acceptance Evidence

以下在当前 GitHub 施工环境尚未观察，因此**不得写 PASS**：

- 当前 Mira Desktop 上真实 provider Builder 完整成功链；
- builder_result 后的下一次 Main Thread provider turn 确实使用该 handoff；
- 真实 cancel / interrupted UI 观察；
- Mira Server restart 后的产品级 reconstruction 观察；
- 当前 T010 HEAD 的 Windows Electron package build。

`dev` 的 `Check dev` 与 `Windows Native Runtime Smoke` 已取得 PASS；真实 provider / full package evidence 继续按 `docs/forge/cutover-smoke.md` 补齐。

T010 当前为 `READY_FOR_REVIEW`，不是 `DONE`。
