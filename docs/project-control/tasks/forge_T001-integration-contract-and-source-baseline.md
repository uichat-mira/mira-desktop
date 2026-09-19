---
status: current
priority: P0
owner: forge / architecture
last_verified: 2026-09-05
layer: project-control
module: Forge
feature: IntegrationBaseline
doc_type: task-card
canonical: true
related:
  - AGENTS.md
  - docs/project-control/project-control-ledger.md
  - docs/architecture/README.md
task_state: DONE
---

# forge_T001 Forge Integration Contract and Source Baseline

## Target

冻结“淬行（Forge）并入 Mira”的迁移合同和源代码基线，避免后续施工把 Forge 重写成任务管理页、第二套 Agent Runtime 或独立 sidecar。

源基线固定为：`dangjingtao/mira-forge` `dev@6557b9ff552c4be3d3d1be2da0b24bb6d1344ed0`。迁移目标为 `dangjingtao/uichat-mira` `dev`。

本卡只建立迁移真相与文件映射，不实现业务代码。

## Verified Context

- 对外中文名统一为“淬行”；内部工程名继续使用 `forge`。
- Forge 必须进入 `uichat-mira` 单仓，不再作为独立产品仓长期演进。
- Forge 不允许保留自己的 `package.json`、lockfile、workspace 或独立依赖安装体系。
- Forge 外部产品界面必须使用 Mira Desktop 现有设计体系；OpenDesign 设计文件是后续外部 UI 的视觉输入。
- 原仿 TUI 界面允许保留为内部 / expert / debug surface，但不得因此保留第二套前端工程。
- Forge 的核心模型必须保留：Project、Main Thread、Repository Task、Batch / Runtime Task、Dispatch、Session、Review、Runtime Event、Builder Result Handoff。
- Repository Task Truth 与 Forge Runtime Truth 必须继续分离。
- Main Thread 不是 Builder；Builder 成功退出只进入 `reviewing`，不能制造 PASS。
- 当前 Forge T018 仍为 REVIEW，迁移不得把未完成验收偷偷升级为 PASS。

## Allowed Changes

- `docs/forge/**`
- `docs/project-control/tasks/forge_T001-integration-contract-and-source-baseline.md`
- `docs/project-control/project-control-ledger.md`（仅本任务状态 / 证据）

## Forbidden Changes

- `server/**`
- `desktop/**`
- `electron/**`
- `tauri/**`
- `package.json`
- `pnpm-lock.yaml`
- 修改旧 Forge 仓库
- 重新设计 Forge 状态机

## Required Output

至少形成：

- `docs/forge/README.md`：淬行 / Forge 产品与工程边界；
- `docs/forge/FORGE_CURRENT_CONTRACT.md`：当前必须保留的不变量；
- `docs/forge/migration-source-map.md`：源仓文件到 Mira 目标模块的迁移映射；
- 明确列出旧 Forge 中“不迁移”的独立 Web/Vite/package/runtime 外壳。

## Acceptance Criteria

1. 源基线 SHA、目标仓库、目标分支明确。
2. 单仓、单依赖体系、Mira Server 一级 domain、Desktop UI 归一化四项边界写入 current contract。
3. 两套真相、Main Thread / Builder 分离、explicit dispatch、SHA-bound review、builder_result handoff 被列为不可丢失合同。
4. 迁移映射覆盖旧 Forge `server/**`、`src/**`、docs 和测试的去向 / 不迁移结论。
5. 不把 V2 历史计划当作当前施工真相；以源代码、T015-T018、work ledger 为准。

## Validation

- 文档链接与路径检查
- `git diff --check`
- 人工核对源基线与迁移映射

## Delivery Evidence

- 固定源基线已按 `dangjingtao/mira-forge@6557b9ff552c4be3d3d1be2da0b24bb6d1344ed0` 重新读取。
- 源 Work Ledger 已确认当前状态：T015/T016/T017 = PASS，T018 = REVIEW。
- 已新增 `docs/forge/README.md`，明确淬行 / Forge 产品、runtime、truth 和 Desktop 边界。
- 已新增 `docs/forge/FORGE_CURRENT_CONTRACT.md`，冻结单仓单依赖、两套真相、Main Thread / Builder 分离、explicit dispatch、SHA-bound review、builder_result handoff 等不可丢失合同。
- 已新增 `docs/forge/migration-source-map.md`，覆盖旧 Forge root/build shell、`server/**`、`src/**`、docs、scripts 与测试的 PORT / REFERENCE / DO NOT MIGRATE 去向。
- T001 施工前目标 `uichat-mira dev` 已重新核对为 `684ea0d9e68fca9e5f4fcd9d302d3396a4c6131e`；此前 `27be0eb` 只保留为派卡时历史 target observation。
- 当前目标分支已有 `desktop/src/features/forge/**` UI 壳；合同明确它不是 T009 完成证据，也不得反向覆盖 Forge domain truth。
- 本卡未修改 `server/**`、`desktop/**`、`electron/**`、`tauri/**`、package 或 lockfile。
- 递归 source-map 覆盖核对：固定源基线 `server/**`、`src/**`、`docs/**`、`scripts/**` 共 103 个文件全部有明确分类，0 missing。
- 相对当前 `dev` 的 compare 仅包含 5 个 T001 允许的文档文件：3 个 `docs/forge/**` 新文件、T001 卡、总台账。
- changed-file whitespace/conflict audit：trailing whitespace = 0，conflict markers = 0，space-before-tab 风险 = 0。
- 当前执行环境通过 GitHub connector 修改远端分支，无法取得本地 checkout 直接执行 shell 版 `git diff --check`；已执行等价的 changed-file whitespace audit，并将该限制显式保留给评审。
- AI review 核真：修正 current-contract metadata，使 docs index 可识别为 current / canonical。
- AI review 核真：migration source-map 的 Decision 列已严格收敛为 `PORT / REFERENCE / DO NOT MIGRATE` 三值，迁移语义说明保留在 Target / Reason。
- AI review 核真：Builder Result Handoff 的 bounded 语义按固定源代码冻结为 `resultText 16_384`、`error 4_096` JavaScript UTF-16 code units（trim 后 slice 截断）；未擅自发明 byte-based 新合同。
- AI review 对 `docs/README.md` 的入口建议未在 T001 执行：该路径不在 Allowed Changes，且修正 metadata 后 Forge contract 已可由 docs-site 自动索引；显式入口整理可另开 docs 范围任务。

- Final review: PASS；AI review 有效问题已整改或按 task scope 明确处置，当前 PR 无 unresolved review thread，Branch Policy 通过，diff 仍仅限 T001 允许文档范围。

## Unknown / Human Decision

None.

## Handoff

后续任务必须先读本卡产出的 `FORGE_CURRENT_CONTRACT.md`。如果迁移过程中发现源仓当前代码与固定基线存在会改变方向的冲突，先报告，不得自行换用移动中的 Forge `dev` HEAD。
