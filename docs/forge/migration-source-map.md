# Forge Migration Source Map

Status: Current
Owner: forge / architecture
Last verified: 2026-09-05
Source: `dangjingtao/mira-forge@6557b9ff552c4be3d3d1be2da0b24bb6d1344ed0`
Target: `dangjingtao/uichat-mira` `dev`

## Baseline Note

T001 派卡时总台账记录的目标观察点是 `uichat-mira dev@27be0eb`。

T001 实际施工前重新读取当前 `dev`，HEAD 已为 `684ea0d9e68fca9e5f4fcd9d302d3396a4c6131e`，并且已经存在 `desktop/src/features/forge/**` UI 壳。

因此：

- Forge **源基线继续固定**为 `6557b9f`；
- Mira `dev` 是移动目标分支；
- 当前 UI 壳作为 target fact 记录，不作为 T009 完成证据；
- 后续施工不得回退到旧 target SHA，也不得用移动中的 `mira-forge dev` 替代固定源 SHA。

## Migration Rules

迁移不是整仓复制。

每个源文件只能得到三类结论之一：

- **PORT**：保留行为合同，迁入 Mira 对应 domain；
- **REFERENCE**：只作为合同/测试/交互证据，不直接复制；
- **DO NOT MIGRATE**：旧独立产品外壳在 Mira 中终止。

## Root / Build Shell

| Source | Decision | Target / Reason |
| --- | --- | --- |
| `package.json` | DO NOT MIGRATE | 不建立 Forge 独立 package；需要的依赖由 Mira Server/Desktop 各自现有 package 管理 |
| `package-lock.json` | DO NOT MIGRATE | 不迁移第二 lockfile |
| `pnpm-lock.yaml` | DO NOT MIGRATE | 不迁移第二 lockfile；Mira lockfile 不手工编辑 |
| `pnpm-workspace.yaml` | DO NOT MIGRATE | 使用 Mira 现有 pnpm workspace |
| `vite.config.ts` | DO NOT MIGRATE | 不保留 Forge 独立 Vite 应用 |
| `index.html` | DO NOT MIGRATE | 使用 Mira Desktop renderer 入口 |
| `tsconfig.json` | REFERENCE | TypeScript 语义按 Mira Server/Desktop 当前配置重新落地，不建立独立 tsconfig 根工程 |
| root `README.md` / `AGENTS.md` | REFERENCE | 当前合同提炼到 `docs/forge/**`；Mira 全局规则仍由目标仓 `AGENTS.md` 管理 |

## Server Core

| Source | Decision | Mira Target |
| --- | --- | --- |
| `server/domain.mjs`, `domain.test.mjs` | PORT | `server/src/forge/domain/**` + focused tests |
| `server/dispatch-domain.mjs` | PORT | `server/src/forge/dispatch/**` |
| `server/dispatch-manager.mjs` | PORT | `server/src/forge/dispatch/**` / runtime supervision |
| `server/dispatch-manager.test.mjs`, `dispatch-serial.test.mjs`, `builder-dispatch.test.mjs` | PORT | `server/src/forge/dispatch/**/*.test.ts` |
| `server/builder-contract.mjs` | PORT | `server/src/forge/adapters/builder/**` or shared Forge contract |
| `server/opencode-adapter.mjs`, `piagent-adapter.mjs`, `codex-builder-adapter.mjs` | PORT | `server/src/forge/adapters/builder/**` |
| `server/opencode-adapter.test.mjs`, `piagent-adapter.test.mjs`, `codex-builder-adapter.test.mjs` | PORT | target Builder adapter `*.test.ts` |
| `server/readiness.mjs`, `readiness.test.mjs` | PORT | `server/src/forge/dispatch/**` / readiness tests |
| `server/project-task-actions.mjs`, `project-task-actions.test.mjs` | PORT | `server/src/forge/project/**` / `task-source/**` |
| `server/repo-task-source.mjs`, `repo-task-source.test.mjs` | PORT | `server/src/forge/task-source/**` |
| `server/main-thread-domain.mjs`, `main-thread-domain.test.mjs` | PORT | `server/src/forge/main-thread/**` |
| `server/main-thread-manager.mjs`, `main-thread-manager.test.mjs` | PORT | `server/src/forge/main-thread/**` |
| `server/main-thread-adapters.mjs`, `main-thread-adapters.test.mjs` | PORT | `server/src/forge/adapters/main-thread/**` |
| `server/codex-desktop-adapter.mjs`, `codex-desktop-adapter.test.mjs` | PORT | `server/src/forge/adapters/main-thread/**` |
| `server/t018-main-thread-result-context.test.mjs` | PORT | Main Thread / Builder Result Handoff regression tests |
| `server/store.mjs`, `store.test.mjs` | PORT | `server/src/forge/runtime/**`; preserve atomic/serialized mutation semantics, but persistence path/lifecycle must be Mira-owned |
| `server/acceptance.mjs` | REFERENCE | standalone acceptance runner 仅作行为证据，不保留旧 control-plane 假设 |
| `server/acceptance.test.mjs` | PORT | 将 integrated acceptance test semantics 迁到 Mira Forge 测试，去除 standalone server 假设 |
| `server/index.mjs` | DO NOT MIGRATE | route/domain behavior is re-expressed under `server/src/forge/routes/**` and registered from Mira `server/src/index.ts`; no second HTTP server |

## Legacy Web / Renderer

| Source | Decision | Mira Target |
| --- | --- | --- |
| `src/App.tsx` | REFERENCE | `desktop/src/features/forge/**`; do not copy old app shell |
| `src/MainThreadPanel.tsx` | REFERENCE | Mira Forge Main Thread surface |
| `src/FirstRunCheck.tsx` | REFERENCE | only retain machine-check behavior if still required by integrated product; not a separate app surface |
| `src/ShortcutFeedback.tsx` | REFERENCE | keyboard affordance may be reimplemented through Mira shared UI |
| `src/main-thread-focus.ts` | REFERENCE | 仅作为 Main Thread focus 行为参考；T009 若确认仍需该 helper，再在 Mira Desktop 内重新实现 |
| `src/main.tsx` | DO NOT MIGRATE | Mira renderer already owns bootstrap |
| `src/workbench/**` | REFERENCE | `desktop/src/features/forge/**`; runtime summary/inspector/event log/task context reimplemented against typed Mira API |
| `src/workbench/live-runtime-model.js` + `.d.ts` | PORT | typed projection/model under Forge Desktop feature/API contract |
| `src/styles/**` | DO NOT MIGRATE | interaction/state semantics may be referenced; visual implementation must use Mira tokens/shared UI |
| old Web/Vite shell | DO NOT MIGRATE | no iframe, no second frontend project |

当前 target `dev` 已有 `desktop/src/features/forge/**`。后续 T009 应在这一目标目录上按 OpenDesign + Mira UI contract 收口，而不是把旧 `src/**` 整体覆盖进去。

## Source Documentation

| Source | Decision | Target |
| --- | --- | --- |
| `docs/architecture.md` | REFERENCE | `docs/forge/FORGE_CURRENT_CONTRACT.md` + Mira architecture docs |
| `docs/task-source-contract.md` | PORT | 保留 repository truth / runtime truth、路径边界、identity、显式写入等规范到 Forge current docs / implementation tests |
| `docs/tui-interaction.md` | REFERENCE | keyboard-first / focus behavior输入，不保留独立 TUI app |
| `docs/frontend-style-contract.md` | REFERENCE | Mira Desktop design system 优先 |
| `docs/user-guide.zh-CN.md` | REFERENCE | 产品语义来源；后续在 Mira 文档体系重写 |
| `docs/v1-status.md` | REFERENCE | 不作为当前状态真相 |
| `docs/v2-plan.md` | REFERENCE | 不作为迁移施工真相 |
| `docs/workbench/00-work-ledger.md` | REFERENCE | T015-T018 当前状态来源之一 |
| `docs/workbench/01-second-wave.md`, `02-third-wave.md` | REFERENCE | 仅用于理解已验证路径 |
| `docs/workbench/tasks/T001-T018*.md` | REFERENCE | 当前迁移重点读取 T015-T018；早期卡用于行为来源追踪，不直接复制成 Mira 项目卡 |

## Scripts / Smoke / Test Support

| Source | Decision | Target |
| --- | --- | --- |
| `scripts/dev.mjs` | DO NOT MIGRATE | 使用 Mira 根工程 dev startup |
| `scripts/fake-opencode.mjs` | PORT | 仅迁移为 Forge test-support 等价物，不能进入生产 fallback |
| `scripts/builder-adapter-smoke.mjs` | PORT | 迁为 integrated Forge provider diagnostic，不保留 standalone startup 假设 |
| `scripts/dispatch-smoke.mjs` | PORT | Forge dispatch integration test |
| `scripts/readiness-smoke.mjs` | PORT | Forge readiness integration test |
| `scripts/smoke.mjs` | REFERENCE | 仅提取验收场景；T010 重新构造 integrated product-loop smoke，不复制 standalone control-plane runner |
| `scripts/frontend-style-contract.test.mjs` | DO NOT MIGRATE | T009 使用 Mira shared UI / design guidelines 验证 |
| `scripts/live-runtime-model.test.mjs` | PORT | Forge Desktop runtime projection regression |

## Test Migration Rule

源仓所有 `server/*.test.mjs` 的**行为语义**必须被覆盖，但测试框架和文件布局不要求原样复制。

迁移测试至少继续保护：

- state transition guards；
- Repository Task Truth / Runtime Truth 分离；
- Task Source unique identity / realpath boundary；
- dispatch readiness；
- global serial Builder safety；
- provider adapter normalization；
- cancellation / failure / restart interruption；
- exact provider thread resume；
- SHA-bound review invalidation；
- Builder success -> `reviewing` only；
- builder_result identity + idempotency；
- next Main Thread turn consumes bounded new result context once；
- no duplicate handoff on polling/refresh；
- no auto dispatch / push / merge / deploy。

## Task-by-Task Destination

| Mira Task | Main Migration Slice |
| --- | --- |
| T001 | current contract + source map |
| T002 | domain/core import + dependency unification |
| T003 | runtime lifecycle + persistence ownership |
| T004 | project registry + repository Task Source |
| T005 | Main Thread + provider adapters |
| T006 | Builder dispatch + process supervision |
| T007 | Review guards + Builder Result Handoff |
| T008 | Mira Server routes + Desktop typed API |
| T009 | OpenDesign-driven Mira Desktop product surface |
| T010 | integrated product-loop smoke + standalone Forge retirement |

## Explicitly Not Migrated

迁移完成后不得继续依赖：

```text
mira-forge/package.json
mira-forge/package-lock.json
mira-forge/pnpm-lock.yaml
mira-forge/pnpm-workspace.yaml
mira-forge/vite.config.ts
mira-forge/index.html
mira-forge/src/main.tsx
mira-forge/scripts/dev.mjs
mira-forge/server/index.mjs as a standalone server
127.0.0.1:47831 as a second product control plane
~/.mira-forge/state.json as an independently-owned live truth source
```

如果后续任务需要其中任一项继续作为运行时必需条件，应停止并报告，这意味着迁移边界已经被破坏。
