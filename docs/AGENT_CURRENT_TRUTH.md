---
status: current
owner: agent-runtime
last_verified: 2026-07-30
layer: wiki
module: Agent
feature: AgentRuntime
doc_type: current-snapshot
canonical: true
related:
  - CURRENT_PRODUCT_TRUTH.md
  - ENGINEERING_MEMORY.md
  - harness/agentgraph-harness-protocol.md
  - harness/README.md
  - skill/README.md
  - skill/pi-skill-agent-execution.md
  - development/agent-observability.md
---

# UIChat Mira Agent 当前真相

> 这页记录 `dev` 分支当前真实存在的 Agent 主线、执行分工、终止语义和已知实现偏差。它不是 Agent V2 设计稿，也不授权重开已经稳定的运行时合同。

## 1. 先说结论

UIChat Mira 当前的 Agent 不是一个 LangGraph-first 图应用，也不是开放式多智能体系统。

它更准确地说是：

```text
Conversation / Skill Flow preparation
  -> AgentRun
  -> AgentGraph stable facade
  -> Pi Loop（应用默认）
  -> Main Planner 滚动决定下一步
  -> direct action / governed delegation
  -> Harness / Skill-private Runtime 执行
  -> Evidence
  -> Planner 或冻结交付
  -> Generate
  -> Finalize
```

`LangGraph` 仍保留为显式兼容、历史测试和回归对照运行时。它与 Pi Loop 共用稳定输入输出、节点语义和 execution trace，但不是应用默认主链。

## 2. 产品运行真相是 AgentRun

一次 Agent 请求首先创建并持久化 `AgentRun`。

`AgentRun` 保存：

- 用户目标；
- 运行时输入；
- running / waiting_user / waiting_approval / completed / failed 等状态；
- observations 与 Evidence；
- frozen `pendingToolCall`；
- exact approval；
- checkpoint；
- finalization packet；
- execution trace 与最终回答状态。

`AgentGraph` 是承载同一份运行时合同的稳定门面，不等于底层一定使用 LangGraph `StateGraph`。

代码入口：

- `server/src/agent/index.ts`
- `server/src/agent/runtime.ts`
- `server/src/agent/graph/index.ts`
- `server/src/agent/run-store.ts`
- `server/src/db/repositories/agent-run.repository.ts`

## 3. 当前运行时选择

| 条件 | 实际运行时 |
| --- | --- |
| 正常应用启动，未设置环境变量 | `pi_loop` |
| `MIRA_AGENT_RUNTIME=pi_loop` | `pi_loop` |
| `MIRA_AGENT_RUNTIME=langgraph` | LangGraph 兼容运行时 |
| 测试环境且未显式指定 | `pi_loop`（与开发、正式运行一致） |

Pi Loop 与 LangGraph 都通过：

```ts
agentGraph.run(input)
```

进入同一稳定门面。

## 4. Main Planner 当前职责

Main Planner 是 task-model 驱动的下一步决策器。

它负责：

- 维护完整用户目标；
- 维护 `currentTaskFrame` 与轻量 `planList`；
- 区分 evidence answerable 与 task completable；
- 选择直接回答、询问用户、检索、具体工具或委派工作包；
- 接受 SubAgent 返回的结构化 Evidence；
- 判断用户全局目标是否完成；
- 冻结最终 `finalizationPacket`。

允许的动作仍是：

- `answer`
- `ask_user`
- `retrieve`
- `use_tool`
- `error`

`planList` 只表达任务方向与完成状态，不保存工具结果、事实、Evidence 或推理。

Pi Loop 没有全局 iteration cap。`maxIterations = 0` 只保留兼容和诊断语义；schema replan 与 recoverable failure 仍有局部预算。

## 5. 当前有三类执行路径

### 5.1 Main Agent 直接路径

纯回答或一个具体调用即可完成的简单动作，由 Main Planner 直接处理：

```text
answer
  -> Generate
  -> Finalize

retrieve
  -> Retrieve
  -> Evidence
  -> Planner

use_tool(concrete tool)
  -> Normalize
  -> Policy
  -> Tool
  -> Evidence
  -> Planner
```

具体 Harness 工具执行必须从 frozen `pendingToolCall` 开始。

### 5.2 通用工作包委派：delegate_task

`delegate_task` 是 Main Planner 可见的 **运行时委派协议**，不是普通 Harness invocation。

它用于一个边界清楚、可独立验收、通常需要多次顺序工具调用、执行后验证或局部恢复的工作包。

```text
Main Planner
  -> use_tool(delegate_task)
  -> Generic Task SubAgent
  -> child-local plan / act / observe / recover
  -> structured observation / Evidence
  -> Main Planner acceptance
  -> next decision
```

当前硬边界：

- 委派参数必须包含完整 `goal` 与 1–8 条 `acceptanceCriteria`；
- Child 只拥有这个局部工作包；
- Child 只看见当前实际暴露且允许的工具；
- `delegate_task` 不进入 Child 工具面，V1 禁止递归委派；
- Child 的 concrete tool 调用仍受工具绑定、Policy、approval 与运行环境约束；
- Child completed 只表示局部工作包完成；
- 用户全局目标是否完成仍由 Main Planner 判断；
- needs_input 由 Parent 向用户提问；
- approval 由 Parent 持有并恢复 exact checkpoint；
- terminal child failure 进入 Main Agent terminal failure。

代码入口：

- `server/src/agent/delegation/contract.ts`
- `server/src/agent/nodes/generic-task-subagent.ts`
- `server/src/agent/nodes/prepare-context-with-delegation.ts`

### 5.3 Skill-owned SubAgent

命中的任务型 Skill 可以声明 `execution.context = fork`，把领域施工交给一个隔离的 SubAgent。

```text
Skill match / continuation
  -> SkillContext + ExecutionProfile
  -> forked SubAgent
  -> Skill-scoped Harness tools
  -> optional Skill-private Runtime
  -> Evidence / Artifact / Requirement
  -> Parent governance and delivery
```

Parent 保留：

- 用户对话；
- 全局目标；
- Policy 与审批；
- 恢复和终止治理；
- Evidence 接收；
- 最终 Generate 与交付。

Skill-owned SubAgent 负责：

- 领域任务的局部规划；
- 工具循环；
- 结果观察与局部修复；
- 专业 Runtime 调用；
- Artifact 构造；
- task-local completion。

当前返回边界：

| SubAgent 结果 | Parent 行为 |
| --- | --- |
| `completed` | Evidence 提交后冻结 Parent finalization packet，直接进入 Generate，不让 Main Planner重做施工 |
| `needs_input` | Parent 按结构化 requirement 向用户提问，不重新解释领域施工 |
| `insufficient_evidence` / recoverable failure | 回 Parent 恢复，但工具面收窄到 active Skill 声明的能力 |
| approval required | 保存 transcript checkpoint 与 exact invocation，由 Parent 等待审批 |
| terminal failure | Main Agent failed，Generate 不运行 |

Stateful Skill 可以使用确定性的 Flow / Reducer 作为该 Skill 的单一 SubAgent controller；不会在它上面再叠加第二条自由模型循环。

Skill-private Runtime 不等于全局 Harness Tool。它不能凭 Skill 声明自动获得可用性或权限，也不能绕过 Parent 治理、审批和可观测合同。

代码入口：

- `server/src/agent/nodes/prepare-context-with-forked-skill.ts`
- `server/src/agent/nodes/forked-skill-agent.ts`
- `server/src/skills/agent/profiles.ts`
- `server/src/skills/agent/subagent-runtime.ts`

## 6. 不可破坏的具体工具调用合同

对普通 concrete tool invocation：

1. Planner 只输出 `nextAction.use_tool`；
2. Normalize 校验 schema 并冻结 `pendingToolCall`；
3. Policy 只判断 frozen invocation；
4. Tool 只执行与 Policy 一致的 `toolId / toolCallId / inputHash`；
5. Tool / Retrieve 先产生 pending facts；
6. Evidence 是累计证据的单一写入者；
7. Evidence 完成后才允许回 Planner 或进入冻结交付；
8. `selectedToolId` 只服务 UI、trace、diagnostics 与兼容读取；
9. capability match、embedding、rerank 或 UI 选中状态不得成为 invocation；
10. Generate 只能消费 finalization packet 引用到的真实 Evidence。

## 7. Approval 与 Resume

审批授权绑定：

- `toolId`
- `toolCallId`
- `inputHash`

命令、参数、cwd、env、timeout 或目标资源变化后，必须重新判断。

恢复流程使用持久化 checkpoint 和原 frozen invocation，不根据审批消息重新猜参数。

SubAgent approval 额外保存 transcript checkpoint。只有当前被冻结的 invocation 可以回放，旧批准不能变成可复用权限。

## 8. Generate 与完成判断

`answer` 是 Main Planner 的终止动作，必须带可验证的 `completionProof`。

Generate：

- 不再决定任务是否完成；
- 不重新选择工具；
- 只组织 frozen finalization packet 引用的 Evidence；
- 对 `ask_user` 使用确定性交付，不调用回答模型；
- 无法解析 Evidence ref 时失败；
- 检测到内部工具协议泄漏时阻断交付。

Finalize / Evaluate 只检查 Planner 终止决定是否成功交付，不重新做语义完成判断。

## 9. 终止状态合同

| 情况 | 目标合同 |
| --- | --- |
| 正常回答 | Graph `completed`，回答已交付 |
| 需要用户输入 | Graph `waiting_user`，交付确定性问题 |
| 等待审批 | Graph `waiting_approval`，保存 frozen invocation 与 checkpoint |
| terminal failure | Graph `failed`，Generate 不运行 |
| recoverable failure 仍有预算 | 失败事实进入 Evidence，回 Planner 恢复 |
| recoverable failure 恢复耗尽 | 进入 guarded answer，Graph `completed`，明确报告未完成项与失败影响 |

### dev 已知实现漂移：恢复耗尽被升级为 terminal error

截至 2026-07-30，`dev` 当前实现与上表最后一条不一致：

- `getRecoveryExhaustedPlannerConclusion(...)` 直接返回 `nextAction.type = error`；
- Planner 写入 `errorMessage / blockedReason`；
- Pi Loop 进入 error path；
- `mapGraphStateToOutput(...)` 因 `errorMessage` 输出 `status = failed`；
- Generate 不运行；
- 当前测试明确断言该行为。

代码与测试锚点：

- `server/src/agent/planner/node.ts`
- `server/src/agent/__tests__/next-action-planner.test.ts`
- `server/src/agent/pi-loop/index.ts`
- `server/src/agent/graph/output.ts`

判断：这是 **高优先级合同漂移**，不是新的 C contract。文档不得把当前偏差包装成目标合同已经改变；运行时修复应在独立任务中完成并增加回归验证。

## 10. Tool Exposure 与委派协议必须分开

`state.toolExposure` 是 Main Planner 可见 concrete tools 的运行时真相源。

Harness 候选解析、embedding 和 rerank 只服务工具面压缩，不直接决定 invocation。

`delegate_task` 是运行时额外加入的 Planner-only protocol surface：

- 它不来自 Harness capability ranking；
- 它不代表一个外部工具；
- 它不经过 Main Agent 的普通 Normalize / Policy / ToolNode；
- 它启动受控 Child execution；
- Child 内每个真实 concrete tool 调用仍必须走其受治理执行路径。

不要把 `delegate_task` 写成能够绕过 Harness 或 Policy 的万能工具。

## 11. Observability 当前真相

产品 execution trace 可以看到：

- Prepare Context；
- Planner 公开 `reason`；
- generic task SubAgent；
- Skill-owned SubAgent；
- SubAgent working state 与 task-local trace；
- concrete tool / retrieval / Evidence；
- approval / resume；
- Generate / Finalize；
- completed / waiting / failed。

SubAgent trace 会投影到 Parent run，但 observability 失败不能成为第二控制平面，也不能改变执行语义。

Phoenix / OpenTelemetry 默认关闭，只用于开发诊断。

## 12. 当前明确没有

当前主线不是：

- Agent V2；
- 开放式多 Agent 自治平台；
- nested SubAgent；
- Agent 间自由通信；
- 并发工具 fan-out；
- DAG scheduler；
- 通用 durable workflow engine；
- 自动 sandbox 快照与回滚；
- 长期记忆大系统。

当前 SubAgent 是 **受控、单层、任务局部的执行所有权转移**，不是无限扩张的 Agent 社会。

## 13. 文档引用规则

Agent 相关说明按以下优先级判断：

1. 当前代码与可重复测试；
2. 本页；
3. `harness/agentgraph-harness-protocol.md`；
4. `skill/README.md` 与 SubAgent 当前参考；
5. observability runbook；
6. project-control 施工与验收记录；
7. design、plan、pilot 和历史材料。

发现代码与 settled contract 不一致时，必须同时记录：

- 目标合同；
- 当前实现行为；
- 偏差影响；
- 修复是否已经验证。

不能选择其中一边，把另一边悄悄抹掉。