# 淬行 / Forge

Status: Current
Owner: forge / architecture
Last verified: 2026-09-05
Layer: product-runtime
Module: Forge
Canonical: true

## Purpose

淬行（Forge）是 UIChat Mira 内的工程执行控制域。

它保留 Forge 已验证的工程闭环：

```text
Project
  -> Main Thread
  -> Repository Task
  -> explicit Dispatch
  -> Builder
  -> Review / Fix
  -> Builder Result Handoff
```

淬行不是第二套 Agent Runtime，不是独立 sidecar，也不是另一个任务管理 SaaS。

## Source Baseline

迁移源固定为：

- repository: `dangjingtao/mira-forge`
- branch at freeze time: `dev`
- immutable source SHA: `6557b9ff552c4be3d3d1be2da0b24bb6d1344ed0`

迁移目标是：

- repository: `dangjingtao/uichat-mira`
- target branch: `dev`

T001 实际施工时，目标分支已前进到 `684ea0d9e68fca9e5f4fcd9d302d3396a4c6131e`。这个 SHA 只是本次目标观察点，不替代固定的 Forge 源基线。

## Product Boundary

### Repository Task Truth

项目自己的 Ledger / Task Card 是需求、任务状态和验收真相。

Forge 可以读取、resolve、显式创建或更新 Task Card，但不得把 Task Card 正文复制成第二套任务数据库。

### Forge Runtime Truth

Forge 只拥有执行期事实，例如：

- Batch / Runtime Task
- Dispatch
- Session
- Review
- Runtime Event
- Main Thread runtime
- Builder Result Handoff

Repository Task 状态与 Forge Runtime 状态是两套相关但独立的状态机。

### Main Thread

Main Thread 是项目长期总控线程：

- 讨论和理解项目；
- 只读检查；
- 读取 Repository Task；
- 显式创建 / 更新 Task Card；
- 显式产生 Dispatch Handoff。

Main Thread 不是 Builder，不直接获得 Builder 的施工职责。

### Builder

Builder 通过统一 Builder contract 执行真实工程任务。

当前固定支持的产品级 Builder 选择来自源基线：

- OpenCode
- PiAgent
- Codex

当前阶段维持全局单 active Builder dispatch。增加 provider 不等于增加并发写通道。

Builder 成功退出只说明施工执行完成；Runtime Task 进入 `reviewing`，不能制造 Repository Task `PASS`。

## Runtime Ownership

迁移后 Forge 必须成为 Mira Backend 的一级 domain：

- server implementation: `server/src/forge/**`
- lifecycle owner: Mira Server
- route owner: Mira Server
- persistence lifecycle: Mira Server 管理
- renderer/native boundary: 沿用 Mira 现有 backend / preload / desktop contract

不保留独立 `127.0.0.1:47831` control-plane 作为产品运行时依赖。

## Desktop Ownership

对外产品名使用“淬行”，内部代码继续使用 `forge`。

外部产品界面必须落在 Mira Desktop：

- feature: `desktop/src/features/forge/**`
- API client target: `desktop/src/shared/api/forge/**`
- shared UI / token: 使用 Mira Desktop 现有体系
- visual input: owner 提供的 OpenDesign 设计文件

旧 Forge 的 React/Vite Web 工程不迁移为第二套前端工程。

当前 `dev` 已存在一层 `desktop/src/features/forge/**` UI 壳。它早于 T001 正式迁移合同完成，仅视为现有目标代码事实，不作为 T009 完成证据，也不得反向覆盖 Forge domain truth。

## Current Acceptance Truth

固定源基线的 authoritative work ledger 记录：

- T015 Main Thread Runtime: PASS
- T016 Builder Thread Adapters: PASS
- T017 Compact Mira Web UI: PASS
- T018 Live Runtime Surface: REVIEW

T018 仍缺一条真实 Builder product-loop 的最终观察性 smoke，因此迁移不得把它升级为 PASS。

## What Does Not Migrate

以下旧 Forge 外壳不作为独立产品结构迁移：

- root `package.json`
- root `package-lock.json`
- root `pnpm-lock.yaml`
- root `pnpm-workspace.yaml`
- root `vite.config.ts`
- root `index.html`
- 独立 Web/Vite bootstrap
- 独立 `server/index.mjs` control-plane bootstrap
- 独立 dev startup script
- 独立固定端口与独立 dependency install

其中可复用的行为合同、domain 逻辑、adapter 逻辑和测试语义按 `migration-source-map.md` 迁入 Mira 对应模块。

## Reading Order

后续 Forge 任务至少先读：

1. `FORGE_CURRENT_CONTRACT.md`
2. `migration-source-map.md`
3. 对应 `docs/project-control/tasks/forge_T00x-*.md`
4. Mira `AGENTS.md` 与相关架构文档

历史 `docs/v2-plan.md` 只作为历史计划参考，不是当前迁移施工真相。
