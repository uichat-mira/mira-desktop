---
status: historical
owner: agent-runtime
last_verified: 2026-07-18
layer: project-control-history
module: ProjectControl
feature: AgentNodesWorkboard
doc_type: historical-workboard
canonical: false
superseded_by:
  - ../harness/agentgraph-harness-protocol.md
related:
  - project-control-ledger.md
  - tasks/agent_node_T001-next-action-planner-node.md
  - tasks/agent_node_T043-coverage-driven-blackbox-regression-suite.md
---

> Archived on 2026-09-19 from `dev@b2403eda97665868844b05ccda1d6e75851e30fc`. Historical evidence only; not a current work-item, policy, or acceptance source.

# AgentNodes Workboard（历史任务台账）

> 本页已归档，不再作为 AgentGraph 当前实现或任务状态的 authoritative 来源。

当前实现真相：

- [AgentGraph 与 Harness 当前协议](../harness/agentgraph-harness-protocol.md)
- [Agent Observability](../development/agent-observability.md)
- [UIChat Mira 工程记忆](../ENGINEERING_MEMORY.md)

## 为什么归档

本 Workboard 最初用于把 Agent V1 / V1.5 的节点治理拆成独立任务：

- Planner
- Normalize
- Policy
- ToolNode
- Evidence
- Generate
- Approval Resume
- Observability
- Planner task coverage

这些任务后来经过多轮施工、评审、整改与合并。旧表格中仍存在大量 `TODO / READY_FOR_REVIEW`、placeholder 和 LangGraph-first 描述，继续维护会导致：

1. 历史任务状态被误读为当前代码状态。
2. 施工线程根据旧 node 列表重建已经退役的执行入口。

因此，本页不再继续滚动更新。

## 当前需要保护的结果

```text
AgentRun
  -> AgentGraph 稳定门面
  -> Pi Loop（默认）
  -> Planner
  -> Normalize
  -> Policy
  -> Tool / Retrieve
  -> Evidence
  -> Planner
  -> Generate
  -> Finalize
```

当前硬边界：

1. Planner 只输出 `nextAction`。
2. Normalize 只冻结 `pendingToolCall`。
3. Policy 只审批 frozen 调用。
4. Tool 只执行 frozen 调用。
5. Tool / Retrieve 结果必须进入 Evidence。
6. Evidence 后回 Planner。
7. `selectedToolId` 与 capability selector 不得驱动执行。
8. Approval resume 必须恢复 exact input hash 与 checkpoint。
9. Generate 必须基于真实 Harness / retrieval 结果。
10. 应用默认编排器是 Pi Loop，LangGraph 只作兼容对照。

## 历史任务卡如何使用

`docs/project-control/tasks/agent_node_T*.md` 仍保留，用于：

- 查询某次缺陷的原因与整改过程
- 查看当时的验收证据
- 理解合同为何形成
- 追溯特定 regression guard

但不得：

- 用单张旧任务卡覆盖 current contract
- 因旧卡仍写 `TODO` 就判断生产代码未实现
- 从旧 task card 恢复 `capabilityIntent.selectedToolIds -> execution`
- 把历史 placeholder 节点重新塞回 Pi Loop
- 把 V1.5 稳定化工作扩成 Agent V2

## 当前项目控制入口

新 AgentGraph 工作应先判断：

1. 是否违反 current contract。
2. 是否是独立缺陷，而不是架构重写机会。
3. 是否需要新任务卡。
4. 是否会影响 Planner -> Normalize -> Policy -> Tool -> Evidence -> Planner 主线。

正式状态以：

- 当前代码
- canonical current contract
- `project-control-ledger.md` 中最新条目
- 对应 PR / commit / test evidence

为准。

旧 Workboard 的完整表格仍可通过 Git 历史查看。
