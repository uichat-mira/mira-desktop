---
status: historical
priority: P1
owner: docs
last_verified: 2026-07-06
layer: project-control
module: MicroAPP
feature: ComputerUse
doc_type: task-card
canonical: false
related:
  - docs/project-control/project-control-ledger.md
  - docs/microapp/README.md
  - docs/microapp/computer-use-microapp-poc.md
  - docs/architecture/README.md
  - docs/architecture/ipc-and-preload.md
task_state: READY_FOR_REVIEW
---

# microapp_T002 Computer Use POC Docs Foundation

> 历史任务合同（2026-07-06），保留原验收文字作为施工证据。文中的 Electron/Tauri 双壳及 `tauri/**` 限制仅反映当时的代码边界；2026-10-31 DSK-011 已退役 Tauri。后续开发应遵守当前 Electron-only runtime 与 `AGENTS.md`，不要据此重引入 Tauri。

## Target

把“调用 `computer-use` 的微应用”先整理成一组 docs-only POC 文档，明确它在当前项目里的产品定位、执行边界、审批门槛和第一阶段最小闭环。

本任务只做文档基础建设，不实现 renderer、backend、preload、桌面控制、浏览器控制、数据库或打包逻辑。

## Allowed Changes

- `docs/microapp/**`
- `docs/project-control/tasks/microapp_T002-computer-use-poc-docs-foundation.md`
- `docs/project-control/project-control-ledger.md`

## Forbidden Changes

- `desktop/**`
- `server/**`
- `electron/**`
- `tauri/**`
- `scripts/**`
- `runtime.config.cjs`
- DB schema
- 打包链
- `computer-use` / 浏览器控制 / 桌面控制实现代码
- 任何 secret 存储实现

## Acceptance Criteria

1. 正式 POC 文档已明确 `computer_use` 的目标、范围、运行时边界和最小闭环。
2. 文档明确区分 `MicroAPP`、模型工具调用、隔离执行面、宿主桌面控制、Electron/Tauri 壳层和 backend 执行器，不把它们混成一个概念。
3. 文档明确 renderer 不直连原生桌面控制能力，所有高风险动作都必须经过 backend 真相层、审批链和执行回放链。
4. 文档明确第一阶段推荐“隔离浏览器 / 隔离执行面”POC，不建议直接控制宿主桌面。
5. 文档明确 Electron 与 Tauri 的边界：renderer 不持有 Node 或原生权限真相，preload / Tauri capability 只暴露最小必要面。
6. `docs/microapp/README.md` 已把 `computer_use` 挂到当前 `MicroAPP` 候选清单里，并能链接到 POC 文档。
7. `docs/project-control/project-control-ledger.md` 已登记该任务和当前状态。
8. 不修改 forbidden area。

## Verification

- `git diff -- docs/microapp docs/project-control/tasks/microapp_T002-computer-use-poc-docs-foundation.md docs/project-control/project-control-ledger.md`
  - workdir: `D:/workspace/rag-demo`
  - purpose: 核对文档变更范围与内容
- `git diff --name-only`
  - workdir: `D:/workspace/rag-demo`
  - purpose: 检查是否误触 forbidden area
- `git status --short`
  - workdir: `D:/workspace/rag-demo`
  - purpose: 检查新增文件和修改文件是否都落在允许范围内

本任务是 docs-only，不跑 `pnpm check`：

- 原因：本轮没有修改 runtime、类型、构建、打包或任何可执行代码；验收目标是文档边界、任务登记和 POC 范围，不是实现验证。

## Evidence

- Changed files:
  - `docs/microapp/README.md`
  - `docs/microapp/computer-use-microapp-poc.md`
  - `docs/project-control/tasks/microapp_T002-computer-use-poc-docs-foundation.md`
  - `docs/project-control/project-control-ledger.md`

- Diff summary:
  - 为 `computer_use` 建立 docs-only POC 任务卡和项目总台账登记
  - 新增 `computer_use` 微应用 POC 文档，明确产品定位、隔离执行面优先、审批边界和 Electron / Tauri 运行时约束
  - 把 `computer_use` 挂入 `MicroAPP` 候选清单，避免成为孤立设计文档

## Unfinished / Risks

- 当前只完成 docs-only POC，没有批准任何桌面自动化、浏览器自动化、审批持久化、录屏、截图、输入注入或远端执行实现。
- `computer-use` 涉及外部数据发送、宿主机控制和高影响操作，后续如果进入实现，属于需要再次确认的高风险边界。
- 当前文档建议第一阶段先做隔离浏览器或隔离执行面，不等于项目 owner 已批准未来直接控制宿主桌面。

## Review Outcome

- 当前状态：`READY_FOR_REVIEW`
- 待评审范围：docs-only POC 基础建设
- 明确未批准：runtime / DB / UI / preload / provider / desktop automation 实现
