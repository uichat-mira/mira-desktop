---
status: current
owner: agent-runtime
last_verified: 2026-07-30
layer: wiki
module: Agent
feature: AgentGraphProtocol
doc_type: current-contract
canonical: true
related:
  - ../AGENT_CURRENT_TRUTH.md
  - ../ENGINEERING_MEMORY.md
  - README.md
  - ../skill/README.md
  - ../skill/pi-skill-agent-execution.md
  - ../development/agent-observability.md
  - ../tooling-runtime/tools-protocol.md
---

# AgentGraph 与 Harness 当前协议

> 这页定义 AgentGraph 稳定门面、Main Planner、Harness、Evidence、Approval 与 SubAgent 之间的技术合同。整体事实先读 [[AGENT_CURRENT_TRUTH]]。

## 1. Runtime 关系

`AgentGraph` 是稳定运行时门面，不等于 LangGraph 本身。

```text
AgentRun
  -> agentGraph.run(...)
  -> Pi Loop（应用默认）
     或 LangGraph（显式兼容 / 测试对照）
```

| 条件 | 实际运行时 |
| --- | --- |
| 正常应用未设置环境变量 | `pi_loop` |
| `MIRA_AGENT_RUNTIME=pi_loop` | `pi_loop` |
| `MIRA_AGENT_RUNTIME=langgraph` | LangGraph 兼容运行时 |
| 测试环境未显式指定 | LangGraph，保留历史测试行为 |

两种运行时共用 AgentRun、input / output、checkpoint、语义步骤、execution node、Planner、Harness、Evidence 与 Generate。

## 2. Main Agent 普通闭环

```text
Planner
  -> Normalize
  -> Policy
  -> Tool
  -> Evidence
  -> Planner
```

```text
Planner
  -> Retrieve
  -> Evidence
  -> Planner
```

```text
Planner(answer / ask_user)
  -> Generate
  -> Finalize
```

## 3. 当前两类委派路径

### Generic Task SubAgent

Main Planner 可以输出：

```text
use_tool(delegate_task)
```

`delegate_task` 是 Planner-only runtime protocol，不是普通 Harness invocation。

```text
Main Planner
  -> delegate_task(goal, acceptanceCriteria)
  -> Generic SubAgent
  -> child-local plan / act / observe / recover
  -> structured observation
  -> Evidence
  -> Main Planner acceptance
```

合同：

- 只委派一个边界清楚、可独立验收的工作包；
- Child 只拥有 task-local execution；
- Main Planner 保留 global goal、依赖、验收与最终回答；
- Child 只看见当前实际可用且允许的 concrete tools；
- `delegate_task` 不进入 Child 工具面，V1 禁止递归委派；
- completed / insufficient / recoverable 返回 Main Planner；
- needs_input 由 Parent 提问；
- approval 由 Parent 保存 exact invocation 与 checkpoint；
- terminal child failure 进入 error path。

### Skill-owned SubAgent

任务型 primary Skill 可以声明 `execution.context = fork`，把领域施工交给 forked SubAgent。

```text
SkillContext + ExecutionProfile
  -> Skill-owned SubAgent
  -> Skill-scoped tools / private runtime
  -> Evidence / Artifact / Requirement
  -> Parent governance
```

- Generic Child completed：回 Main Planner 判断全局目标；
- Skill-owned Child completed：冻结 Parent finalization packet，直接 Generate；
- Stateful Skill Flow 可以作为该 Skill 的确定性 SubAgent controller；
- needs_input 由 Parent 确定性交付；
- recoverable 返回受限恢复面；
- terminal failure 不进入 Generate。

## 4. Planner 合同

Planner 是 task-model 驱动的下一步决策器。

允许动作：

- `answer`
- `ask_user`
- `retrieve`
- `use_tool`
- `error`

Planner 读取：

- 用户目标；
- `currentTaskFrame`；
- bounded conversation history；
- `state.toolExposure`；
- observations 与 Evidence；
- semantic action ledger；
- recovery context；
- pending approval；
- active Skill directive。

Planner 必须区分 evidence answerable 与 task completable。

`answer` 必须提供 `completionProof`，并冻结为 `finalizationPacket`。

`planList` 只有 `{ id, text, done }`，不能保存工具结果、Evidence、推理或回答。

Pi Loop 没有全局 iteration cap；schema replan 与 recoverable failure 有局部预算。

## 5. Tool Exposure 与 delegate_task

`state.toolExposure` 是 Main Planner 可见 concrete tools 的运行时真相。

```text
eligible concrete tools
  -> <= 20：全部暴露
  -> > 20：capability profile / embedding / rerank
  -> concrete tool expansion
  -> 去重
  -> 前 20
```

当前没有 `minScore` 淘汰和核心工具固定名额。Recall 与 rerank 只服务上下文压缩，不直接决定 invocation。

`delegate_task` 由 Agent Runtime 额外加入 Planner surface：

- 不来自 Harness ranking；
- 不对应外部 invocation；
- 不进入 Main Agent 普通 Normalize / Policy / ToolNode；
- 只启动受控 Child execution；
- Child concrete tool 仍受 binding、Policy、approval 与环境约束。

Generic Child 的 capability ceiling 来自 Parent 的 authority + readiness envelope（Harness 在 disclosure 收窄前的 eligible 集合），而不是 Parent 当前可见 / disclosed 的 Tool 快照。Parent 当前可见集合只是 context：

```text
Parent authority + readiness envelope
  -> Generic Child scoped Capability View
  -> Child task-local visible / disclosed set
```

因此 Parent 的 ranked disclosure 漏掉的 runtime-ready Tool，只要在授权 envelope 内，仍可对 Child discoverable；envelope 之外（含未注册、未授权、runtime-unavailable）的 Tool 仍不可用；`delegate_task` 不进入 Child 面，V1 不引入递归委派。

## 6. Concrete Tool 不变量

1. Planner 只提出 concrete `nextAction.use_tool`；
2. Normalize 校验 schema 并冻结 `pendingToolCall`；
3. Policy 只判断 frozen invocation；
4. Tool 只执行与 Policy 一致的 invocation；
5. Tool / Retrieve 不直接写累计 Evidence；
6. Evidence 是累计证据的单一写入者；
7. Tool / Retrieve 后必须先进入 Evidence；
8. `selectedToolId` 只服务 UI、trace、diagnostics 与兼容读取；
9. capability match、ranking、UI 状态不得成为执行入口；
10. Generate 只消费 finalization packet 引用的 Evidence。

## 7. frozen pendingToolCall

普通 concrete call 至少冻结：

- tool call id；
- `toolId`；
- `args`；
- `inputHash`；
- `reason`；
- source / status；
- tool metadata。

Normalize 后不得再根据用户文字、capability intent 或旧 `selectedToolId` 重建参数。

SubAgent approval 的 frozen call 还保存：

- `origin: skill_agent` 兼容标记；
- `skillId`；
- transcript checkpoint；
- checkpoint pending invocation。

## 8. Policy、Approval 与 Resume

审批绑定：

- `toolId`
- `toolCallId`
- `inputHash`

命令、参数、cwd、env、timeout 或目标资源变化后必须重新判断。

等待审批时持久化 task frame、observations、Evidence、retrievals、last execution、iteration、frozen call，以及适用的 SubAgent transcript checkpoint。

恢复入口先校验 exact invocation，再执行 Policy 或恢复同一 Child。旧批准不能变成可复用权限。

## 9. Harness 职责

Harness 负责：

- capability / tool registry；
- eligible concrete tool surface；
- schema 与 metadata；
- risk / approval；
- workspace boundary；
- invocation；
- external MCP projection；
- trace / audit；
- result 到 `llmContent` 的投影。

Harness 不负责：

- global task planning；
- SubAgent local planning；
- 工具参数生成；
- 用户目标完成判断；
- 最终回答。

Skill-private Runtime 不是第二个 Harness。它由 execution profile 与 managed adapter 提供，但仍受 Parent 治理、可用性、审批、workspace 与审计约束。

## 10. Evidence 与 Generate

Tool / Retrieve / SubAgent 先产生 pending execution 或 structured observation，再由 Evidence 统一写入。

Generate：

- 只接受 `ask_user`，或 `answer + finalizationPacket`；
- `ask_user` 确定性交付，不调用回答模型；
- `answer` 只物化 packet 引用的 Evidence；
- 不重新判断完成；
- 不发起工具调用；
- 无法解析 Evidence ref 或发现内部协议泄漏时失败。

Evaluate 只检查终止决定是否成功交付。

## 11. 失败与终止合同

### Recoverable

```text
failed fact
  -> Evidence
  -> Planner recovery
  -> recovery exhausted
  -> guarded answer
  -> Graph completed
```

### Terminal

```text
terminal fact / runtime error
  -> Graph failed
  -> Generate does not run
```

### 当前 dev 偏差

截至 2026-07-30，Planner 在 recovery exhausted 时直接返回 `error`，导致 Graph failed 且 Generate 不运行。

该行为已被测试锁定，但与 settled recoverable C contract 不一致。它是高优先级实现漂移，不是新的目标合同。详见 [[AGENT_CURRENT_TRUTH]] 的“dev 已知实现漂移”章节。

## 12. Workspace、Terminal 与 External MCP

Read / Edit 继续遵守 workspace boundary。

`terminal_session` 使用 Host Runtime：full shell、Python / Node / Git、persistent PTY、watcher / dev server / REPL、Windows Job Object / taskkill fallback 与 POSIX process group。旧 command sandbox 已退出主执行链，`requiresApproval` 仍保留。

External MCP 必须成为 eligible capability、投影为 concrete tool、进入受治理 surface、形成 exact invocation、经过 Policy / Approval，并把结果写入 Evidence。

## 13. CodeGraph

Planner 只看见 `codebase_explore`。

```text
CodeGraph
  -> scoped search_text
  -> workspace_inventory
  -> read_file_slice
```

CodeGraph 是受控代码理解入口，不是第二个 Planner；候选和 verified excerpts 不能穿透成 capability invocation。

## 14. Trace 与 UI

产品 trace 展示：

- Planner public reason；
- direct tool / retrieval / Evidence；
- Generic SubAgent；
- Skill-owned SubAgent；
- Child working state / task-local trace；
- approval / resume；
- Generate / Finalize；
- waiting / failed / completed。

Observability 失败不能改变执行语义。最终 UI 状态必须服从 AgentRun 当前状态。

## 15. 当前明确没有

当前主线不是 Agent V2、开放式多 Agent、nested SubAgent、DAG scheduler、并发工具 fan-out、通用 durable workflow、长期记忆系统或自动 sandbox snapshot / rollback。

当前是有状态、可审批、可恢复、Evidence 驱动的顺序决策系统，并增加受控的 task-local execution delegation。