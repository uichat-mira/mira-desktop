---
status: current
owner: agent-runtime / skill-runtime
last_verified: 2026-07-30
layer: raw-source
module: Agent
feature: SubAgentExecution
doc_type: reference
canonical: true
related:
  - ../AGENT_CURRENT_TRUTH.md
  - README.md
  - ../harness/agentgraph-harness-protocol.md
  - ../../server/src/agent/nodes/forked-skill-agent.ts
  - ../../server/src/agent/nodes/generic-task-subagent.ts
---

# SubAgent 与 Skill 执行当前参考

> 本页记录当前已经落地的 task-local SubAgent execution。它不再是 Candidate / Pilot，也不代表 Mira 已经成为开放式多 Agent 系统。

## 1. 当前存在两类 SubAgent

### Generic Task SubAgent

由 Main Planner 选择 `delegate_task`：

```text
Main Planner
  -> delegate_task(goal, acceptanceCriteria)
  -> mira.generic-task SubAgent
  -> local tool loop
  -> structured Evidence
  -> Main Planner acceptance
```

用于：

- 一个边界明确的多步工作包；
- 需要连续工具调用；
- 需要执行后验证；
- 需要局部 repair / retry；
- 可以独立写出验收条件。

不用于：

- 纯回答；
- 一个普通工具调用即可完成的动作；
- 模糊且无法定义 acceptance criteria 的任务；
- 再委派给另一个 SubAgent。

### Skill-owned SubAgent

由命中的 primary Skill execution profile 触发：

```text
SkillContext + ExecutionProfile
  -> forked SubAgent
  -> Skill-scoped tools / private runtime
  -> Evidence / Artifact / Requirement
  -> Parent delivery
```

适合：

- DOCX / PDF / PPTX / XLSX 等专业文档任务；
- 有明确领域规则与 completion contract 的任务；
- 需要 Skill-private Runtime；
- Main Planner 不应自己拼解释器、脚本路径和运行参数的任务。

## 2. 单层执行合同

当前最多一层 Child execution：

```text
Main Agent
  -> one SubAgent
```

Child 不获得：

- `delegate_task`；
- nested SubAgent；
- 任意全局工具；
- 未声明的 MCP；
- 自动权限；
- 自由扩展用户 global goal 的权力。

当前不是：

```text
Agent A <-> Agent B <-> Agent C
```

而是：

```text
Parent governance
  -> bounded task-local ownership
  -> structured return
```

## 3. 执行所有权

Main Agent owns：

- global goal；
- task decomposition；
- dependency and acceptance；
- Skill routing；
- Policy / Approval；
- terminal contract；
- user interaction；
- final answer and delivery。

SubAgent owns：

- delegated local goal；
- local plan；
- concrete tool loop；
- observation；
- task-local repair；
- evidence coverage；
- artifact construction；
- task-local terminal judgment。

Main Planner 不应在 Child completed 后重新施工同一工作包。

## 4. ExecutionProfile

每个 discovered Skill 可以解析为一个 SubAgent execution profile：

```ts
{
  skillId,
  mode: "forked-agent",
  engine: "pi-agent-core",
  allowedHarnessToolIds,
  runtimeBindings,
  workspaceBound
}
```

Profile 是 requirement envelope，不是 permission grant。

真实可用能力还取决于：

- Harness registry；
- current exposure / binding；
- runtime adapter readiness；
- workspace；
- Policy；
- approval。

## 5. Child 工具面

Generic Child：

```text
actual Main exposed concrete tools
- delegate_task
```

Skill-owned Child：

```text
Skill allowed Harness tools
+ managed Skill-private runtime bindings
```

两者都不能凭 prompt 发明工具。

## 6. Skill-private Runtime

当前已登记的 managed bindings 包括：

- `office_document`：ready；
- `office_pdf`：ready；
- `office_presentation`：ready；
- `office_spreadsheet`：ready；
- `wenshu_xlsx_xml_runtime`：pending。

Private Runtime 的正确调用是：

```text
SubAgent semantic runtime action
  -> RuntimeBinding
  -> Mira-managed launcher / adapter
  -> deterministic result
```

禁止由模型决定：

- Python executable；
- `python -m`；
- `PYTHONPATH`；
- pip / conda；
- 任意脚本拼接；
- 通过 `terminal` 伪造文枢 Runtime。

## 7. Result contract

Child 统一返回：

```ts
status:
  | "completed"
  | "insufficient_evidence"
  | "needs_input"
  | "failed"

evidence
artifacts
requirements
missingEvidence
recoverable
trace
checkpoint
```

### Generic Child

- completed：提交 Evidence，回 Main Planner；
- needs_input：Parent ask_user；
- recoverable / insufficient：回 Main Planner；
- terminal failure：Main Agent error。

### Skill-owned Child

- completed：提交 Evidence，冻结 Parent finalization packet，直接 Generate；
- needs_input：Parent 确定性交付结构化问题；
- recoverable / insufficient：回 Parent，恢复工具面收窄到 active Skill profile；
- terminal failure：Main Agent failed，Generate 不运行。

## 8. Stateful Skill Flow

Stateful Skill 不再被描述为“Main Planner逐步推进的可选表格”。

当前模型：

```text
Skill Flow / Reducer
= deterministic SubAgent controller
```

它可以维护：

- session；
- phase；
- round；
- structured requirements；
- interruption；
- deliveryReady；
- flowCompleted。

Flow completed 后由 Parent 冻结交付；Flow interrupted 后由 Parent 收集用户输入并继续同一会话。

不要在 Flow 上再叠第二个自由 Pi Child loop。

## 9. Approval checkpoint

SubAgent approval 必须有：

- toolId；
- toolCallId；
- inputHash；
- input；
- serialized transcript checkpoint。

Parent 恢复前验证：

- checkpoint Skill id；
- pending invocation；
- frozen call；
- approved invocation。

任何不一致都会阻断恢复，不会从最初目标重新启动。

## 10. Evidence 与 Artifact

Child 的结果首先转换成 Parent observation，再由 Evidence 统一提交。

Artifact record、tool calls、requirements、missing evidence 和 bounded trace 都进入结构化 observation。

completed 不允许只凭自然语言 summary；必须由 Child runtime result 与 Evidence / Artifact 支持。

## 11. Trace

Parent execution trace 当前可以包含：

- `agent-generic-task-subagent`；
- `agent-forked-skill-agent`；
- `subagent-trace:*`；
- `subagent-working-state:*`；
- Child tool events；
- approval required；
- resumed from approval；
- artifacts / requirements / missing evidence；
- terminal status。

持久化 `origin: skill_agent` 是兼容字段，不应继续作为产品术语。

## 12. Code anchors

- `server/src/agent/delegation/contract.ts`
- `server/src/agent/nodes/generic-task-subagent.ts`
- `server/src/agent/nodes/forked-skill-agent.ts`
- `server/src/agent/nodes/prepare-context-with-delegation.ts`
- `server/src/agent/nodes/prepare-context-with-forked-skill.ts`
- `server/src/skills/agent/profiles.ts`
- `server/src/skills/agent/subagent-runtime.ts`
- `server/src/agent/pi-loop/index.ts`
- `server/src/agent/graph/build-graph.ts`

## 13. 当前边界

- 一个 Parent run 同一层只控制一个 active Child execution；
- V1 不允许 recursive delegation；
- Child 不决定用户 global completion；
- Child 不扩大工具权限；
- Private Runtime 不暴露给 Main Planner；
- observability 不反向控制 Child；
- completed Skill Artifact 不由 Main Planner 重做；
- 这套能力属于 Agent V1.5 稳定化，不是 Agent V2。