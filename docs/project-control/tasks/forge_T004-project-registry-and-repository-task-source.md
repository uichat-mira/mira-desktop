---
status: current
priority: P0
owner: forge / server
last_verified: 2026-09-05
layer: project-control
module: Forge
feature: ProjectTaskSource
doc_type: task-card
canonical: true
related:
  - docs/project-control/tasks/forge_T003-runtime-lifecycle-and-persistence-ownership.md
task_state: DONE
---

# forge_T004 Project Registry and Repository Task Source

## Target

迁移并接通 Forge Project Registry 与 Repository-native Task Source，使淬行能够绑定真实本地仓库、读取 Ledger / Task Card，并在显式动作下创建或更新 Task Card。

## Must Read

- `AGENTS.md`
- `docs/forge/FORGE_CURRENT_CONTRACT.md`
- 源 Forge `docs/task-source-contract.md`
- 源 Forge `server/repo-task-source.mjs`
- 源 Forge `server/project-task-actions.mjs`
- Mira 当前 project-control task card / ledger 规范

## Allowed Changes

- `server/src/forge/project/**`
- `server/src/forge/task-source/**`
- `server/src/forge/**` 中直接相关共享 types / tests
- `docs/forge/**`（仅 Task Source current contract）
- 本任务卡状态 / 证据

## Forbidden Changes

- 建立第二套 Task Card 数据库
- 把任务正文复制进 Forge runtime persistence
- 自动修复 Ledger / Card drift
- 从任意 prose 猜依赖、状态或 Task ID
- 允许 taskLedger / taskDir 逃逸 registered project root
- 改 Mira 项目台账格式来迁就 Forge

## Required Behavior

保留并验证：

- Ledger 至少 `ID | Task | Status`
- Task ID 唯一
- 每个任务恰好匹配一张 Task Card
- realpath / workspace boundary
- 中文旧卡 `状态：` 等已接受兼容读取
- read side-effect free
- create/update 显式写入
- ledger/card 写入失败时不留下半成功状态
- drift 只 warning，不静默“修好”

## Construction Evidence

- Base: `dev@1741d5711867eada53bcb93f9b7a5db03904cc13`.
- 新增 `server/src/forge/task-source/**`：repository-native Markdown ledger/card inspect / resolve / explicit create / explicit update。
- 新增 `server/src/forge/project/**`：真实本地 root 注册、integration branch / task source 显式配置、project-level inspect / resolve / create / update / runtime batch binding。
- 没有引入旧 Forge `docs/workbench/**` 默认路径。目标项目未配置 task source 时明确失败；不把历史默认静默变成 Mira 新合同。
- 没有扩展 parser 去猜 Mira 自身 `project-control` frontmatter 语义，也没有修改 Mira 项目总台账格式。
- inspect 会验证 Ledger `ID | Task | Status`、全局 Task ID 唯一、每个 ledger task 恰好一张 card、heading identity、Status / 中文 `状态：` 兼容、realpath 边界。
- drift 仅形成 warning，不在读取时回写。
- create/update 仅在显式调用时写 repository；writer 保留原 Forge 的 card/ledger 双写回滚语义，并增加失败注入测试证明 ledger 写失败后 card 不留半成功状态。
- Runtime 仅保存 Project / Batch / Task identity 与执行状态；定向测试用正文 marker 验证 Task Card body 不进入 Forge runtime persistence。
- 未新增 route、Desktop、Main Thread provider、Builder provider、Reviewer、自动 dispatch / push / merge / deploy。

## Acceptance Criteria

1. 可注册真实本地项目并配置 integration branch / task source。
2. 可 inspect、resolve、create、update repository task。
3. 错 root、缺卡、重复卡、路径逃逸都明确失败。
4. Forge runtime 只保存 task reference / execution binding。
5. 项目自己的 Task Card 仍是需求 / 产品状态真相。

## Validation

- 临时仓库 Task Source fixture
- wrong-root / duplicate / escape / localized-card tests
- server typecheck
- `git diff --check`

## Review Readiness

- PR #102 已建立，base=`dev`，head=`feature/forge-t004-project-task-source`。
- Branch Policy: PASS。
- CodeRabbit 已对最新 HEAD `1eb26a7b1e758fa5e00f7e01183140b425a7063e` 启动 review，但当前 status 仍为 `pending`；不得视为通过。
- Codex 已显式触发 latest-head review，但当前未返回正式 review 结果。
- 变更范围静态审计：仅本任务卡、`server/src/forge/project/**`、`server/src/forge/task-source/**` 与 Forge barrel；0 conflict marker、0 trailing whitespace、无旧 `:47831` / `.mira-forge` / `MIRA_FORGE_STATE_FILE` 依赖。
- 本卡定向 Vitest 已落代码但当前 PR workflow 不执行 server Vitest；在 AI Review 收口前不合并，合并后仍需以 `dev` 的真实 `pnpm check` / staged server smoke 作为最终整仓验证。

## Final Review Evidence

- PR #102 AI Review 已完成一轮有效整改：
  - Codex P1：同 project Task Source 并发写丢更新 → 已增加 per-realpath project write serialization + concurrent create regression。
  - Codex P1：partial update 静默修复 unrelated drift → 已改为只更新显式 ledger 字段 + drift regression。
  - Codex P1：fixture 使用 OS temp → 已迁到 repo root `.test-artifact/forge-t004-*`。
  - CodeRabbit：Project update stale snapshot lost update → 已把 fallback / source validation 移入 `store.mutate`，并补不同字段并发 update regression。
  - CodeRabbit：`String.replace` 的 `---
status: current
priority: P0
owner: forge / server
last_verified: 2026-09-05
layer: project-control
module: Forge
feature: ProjectTaskSource
doc_type: task-card
canonical: true
related:
  - docs/project-control/tasks/forge_T003-runtime-lifecycle-and-persistence-ownership.md
task_state: DONE
---

# forge_T004 Project Registry and Repository Task Source

## Target

迁移并接通 Forge Project Registry 与 Repository-native Task Source，使淬行能够绑定真实本地仓库、读取 Ledger / Task Card，并在显式动作下创建或更新 Task Card。

## Must Read

- `AGENTS.md`
- `docs/forge/FORGE_CURRENT_CONTRACT.md`
- 源 Forge `docs/task-source-contract.md`
- 源 Forge `server/repo-task-source.mjs`
- 源 Forge `server/project-task-actions.mjs`
- Mira 当前 project-control task card / ledger 规范

## Allowed Changes

- `server/src/forge/project/**`
- `server/src/forge/task-source/**`
- `server/src/forge/**` 中直接相关共享 types / tests
- `docs/forge/**`（仅 Task Source current contract）
- 本任务卡状态 / 证据

## Forbidden Changes

- 建立第二套 Task Card 数据库
- 把任务正文复制进 Forge runtime persistence
- 自动修复 Ledger / Card drift
- 从任意 prose 猜依赖、状态或 Task ID
- 允许 taskLedger / taskDir 逃逸 registered project root
- 改 Mira 项目台账格式来迁就 Forge

## Required Behavior

保留并验证：

- Ledger 至少 `ID | Task | Status`
- Task ID 唯一
- 每个任务恰好匹配一张 Task Card
- realpath / workspace boundary
- 中文旧卡 `状态：` 等已接受兼容读取
- read side-effect free
- create/update 显式写入
- ledger/card 写入失败时不留下半成功状态
- drift 只 warning，不静默“修好”

## Construction Evidence

- Base: `dev@1741d5711867eada53bcb93f9b7a5db03904cc13`.
- 新增 `server/src/forge/task-source/**`：repository-native Markdown ledger/card inspect / resolve / explicit create / explicit update。
- 新增 `server/src/forge/project/**`：真实本地 root 注册、integration branch / task source 显式配置、project-level inspect / resolve / create / update / runtime batch binding。
- 没有引入旧 Forge `docs/workbench/**` 默认路径。目标项目未配置 task source 时明确失败；不把历史默认静默变成 Mira 新合同。
- 没有扩展 parser 去猜 Mira 自身 `project-control` frontmatter 语义，也没有修改 Mira 项目总台账格式。
- inspect 会验证 Ledger `ID | Task | Status`、全局 Task ID 唯一、每个 ledger task 恰好一张 card、heading identity、Status / 中文 `状态：` 兼容、realpath 边界。
- drift 仅形成 warning，不在读取时回写。
- create/update 仅在显式调用时写 repository；writer 保留原 Forge 的 card/ledger 双写回滚语义，并增加失败注入测试证明 ledger 写失败后 card 不留半成功状态。
- Runtime 仅保存 Project / Batch / Task identity 与执行状态；定向测试用正文 marker 验证 Task Card body 不进入 Forge runtime persistence。
- 未新增 route、Desktop、Main Thread provider、Builder provider、Reviewer、自动 dispatch / push / merge / deploy。

## Acceptance Criteria

1. 可注册真实本地项目并配置 integration branch / task source。
2. 可 inspect、resolve、create、update repository task。
3. 错 root、缺卡、重复卡、路径逃逸都明确失败。
4. Forge runtime 只保存 task reference / execution binding。
5. 项目自己的 Task Card 仍是需求 / 产品状态真相。

## Validation

- 临时仓库 Task Source fixture
- wrong-root / duplicate / escape / localized-card tests
- server typecheck
- `git diff --check`

## Review Readiness

- PR #102 已建立，base=`dev`，head=`feature/forge-t004-project-task-source`。
- Branch Policy: PASS。
- CodeRabbit 已对最新 HEAD `1eb26a7b1e758fa5e00f7e01183140b425a7063e` 启动 review，但当前 status 仍为 `pending`；不得视为通过。
- Codex 已显式触发 latest-head review，但当前未返回正式 review 结果。
- 变更范围静态审计：仅本任务卡、`server/src/forge/project/**`、`server/src/forge/task-source/**` 与 Forge barrel；0 conflict marker、0 trailing whitespace、无旧 `:47831` / `.mira-forge` / `MIRA_FORGE_STATE_FILE` 依赖。
- 本卡定向 Vitest 已落代码但当前 PR workflow 不执行 server Vitest；在 AI Review 收口前不合并，合并后仍需以 `dev` 的真实 `pnpm check` / staged server smoke 作为最终整仓验证。

 substitution 会破坏 Task Card → 已改 replacement function，并补 literal-dollar regression。
  - CodeRabbit：rollback failure 掩盖原始 ledger failure → 已使用 `AggregateError` 保留原始错误与 rollback 错误，并补双失败 regression。
  - CodeRabbit：symlink escape 缺测试 → 已补 realpath symlink escape regression；Windows 平台不执行该平台特定用例。
  - CodeRabbit performance nit：重复 `readdir` / 串行 read 优化未整改。当前 T004 无 task-source 规模/latency acceptance，也无真实性能证据；避免在稳定化卡内扩大范围。
- Review threads: 0 unresolved。
- Latest code HEAD before task-card close: `de92b98d6a8cf4c50fb4f0dd65ace273c4ce5a69`。
- Static audit: changed files 0 conflict marker；整改后测试文件 trailing whitespace 已清理；无 `:47831` / legacy `.mira-forge` / second Task DB / Task Card body persistence。
- Branch Policy on code HEAD: PASS。
- Pre-merge repository workflow 仍不执行 Forge server Vitest，因此不伪造“定向 Vitest 已运行”。合并后以 `dev` 的真实 `pnpm check` 与 Windows staged-server smoke 作为整仓最终门禁；若失败立即重开 T004。
- Final self-review: PASS。T004 满足 Project Registry / repository-native Task Source / explicit writes / unique identity / realpath boundary / drift warning / rollback / repository truth vs runtime truth 边界，无 T005-T009 越界。

## Unknown / Human Decision

None.
