---
status: current
owner: docs
last_verified: 2026-07-02
layer: project-control
module: ProjectControl
feature: Phase1Remediation
doc_type: workboard
canonical: true
related:
  - docs/project-control/README.md
  - docs/chat/agent-phase-1-global-review.md
  - docs/chat/agent-phase-1-code-review.md
---

# Agent Workboard

当前总控台账。

本页只做两件事：

- 把 Global Review 按严重性由高到低排成整改台账
- 把 Global Review 条目和原始评审点一一对齐，并标注出处

## Global Review Workboard

| ID | Severity | Topic | Current Judgment | Status | Primary Source | Raw Review Points |
| --- | --- | --- | --- | --- | --- | --- |
| `GR-P0-1` | `P0` | Agent 自动拼 `terminal command` 风险 | 当前主线风险已收口，危险自动终端路径已被结构化 workspace mutation 替代 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R15` `R16` `R19` |
| `GR-P0-2` | `P0` | 高风险工具审批粒度过粗 | 当前审批、resume 与 Harness 放行已统一到 invocation 级别，高风险授权模型已收口 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R11` `R13` `R14` `R19` |
| `GR-P0-3` | `P0` | 执行契约没有强冻结 | 当前执行层已只接受冻结调用对象，缺失 `pendingToolCall` 时会直接阻断 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R10` `R18` |
| `GR-P1-HIGH` | `P1-high` | `policyNode` 未显式处理 `deny` | 当前策略分支已显式区分 `allow / require_approval / deny`，隐性放行路径已清掉 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R12` |
| `GR-P1-1` | `P1` | Capability / Tool 分层重构 | 当前执行态已显式区分 capability/tool，tool-first 执行语义已在 graph、resume、trace、持久化中收口 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R03` `R07` `R08` `R09` `R28` `R29` `R30` |
| `GR-P1-2` | `P1` | Harness 输入契约与 schema 校验 | 当前高风险工具已具备统一 schema 校验与 workspace boundary contract，接口层手测已验证生效 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R16` `R17` `R18` `R19` |
| `GR-P1-3` | `P1` | 候选暴露与调用前守卫收口 | 当前主链已拆成“候选选择 -> 调用前守卫”；Harness 负责候选暴露，守卫节点只做 topN 与合法性校验 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R01` `R02` `R03` `R04` `R05` `R06` |
| `GR-P1-4` | `P1` | 工具结果证据链补全 | 当前已补 formal evidence payload，route/generate 已共享正式证据输入 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R20` `R21` `R22` `R23` `R29` |
| `GR-P2-1` | `P2` | 回看逻辑升级 | `routeStep` 已升级为 evidence-aware review；会基于 retrieval / tool evidence 决定 replan 还是 generate，并阻断空证据假回看 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R20` `R21` |
| `GR-P2-2` | `P2` | 工具路径与 RAG 路径组合 | 主链已支持 `retrieve -> review -> capabilitySelect -> tool/generate`，RAG 与工具证据可在同一轮回答中组合 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R23` |
| `GR-P2-3` | `P2` | 终态与可观测性增强 | `blockedReason / terminalReason` 已进入 graph output、assistant metadata 和前端消费类型，终态语义不再只停在中间 state | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R25` `R26` `R27` `R28` |
| `GR-P2-4` | `P2` | `evaluate` 节点语义升级 | `evaluate` 已从 answer presence check 升级为最小 grounded check，会拦截“无真实证据却声称已查看/已搜索”的回答 | `DONE` | [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md) | `R24` |

## Global Review To Raw Review Mapping

下面先给出本轮台账采用的 `R01-R30` 原始评审点索引，再给出 `Global Review` 条目与它们的对应关系。

### Raw Review Point Index

| Raw ID | Raw Review Point | Source Section | Citation |
| --- | --- | --- | --- |
| `R01` | `computeRuleScore` 只能做召回增强，不适合做强决策 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `computeRuleScore` | “`computeRuleScore` 可以作为召回增强，但不适合承担强决策。” |
| `R02` | `isWorkspaceIntentQuery` 是过强的 shortcut / gate | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `isWorkspaceIntentQuery` | “这不是普通 hint，而是一个强路由 gate。” |
| `R03` | `pickPreferredReadCandidate` 当前更像选 capability，不是真正选 tool | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `pickPreferredReadCandidate` | “当前更像是‘选 read capability’，不是‘选 read tool’。” |
| `R04` | `pickPreferredReadToolId` 是 read 域内轻量 router，但仍是关键词路由 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `pickPreferredReadToolId` | “它仍然是关键词路由。” |
| `R05` | `buildSelectionMessages` 对 task model 的候选输入结构不够稳 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `buildSelectionMessages` | “这个设计方向是对的……但这里有几个明显问题。” |
| `R06` | `parseTaskCapabilitySelection` 过宽松，`use_capability` 应强制带 `capabilityId` | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `parseTaskCapabilitySelection` | “`use_capability` 必须携带 `capabilityId`。” |
| `R07` | `routeAfterCapabilityIntent` 行为能跑，但 `capabilityId/toolId` 命名污染明显 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `routeAfterCapabilityIntent` | “当前实现依赖一个‘字段名叫 capabilityId，但实际存的是 toolId’的约定。” |
| `R08` | `lastToolExecution.capabilityId` 实际存 `toolId`，是领域命名债 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `lastToolExecution / toolNode writeback` | “不是行为 bug，是命名与领域模型不一致。” |
| `R09` | `policyNode` 中 `selectedCapabilityId` / `pendingToolCall.capabilityId` 继续被 `toolId` 污染 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `policyNode` | “这是和 `lastToolExecution.capabilityId` 同一类问题。” |
| `R10` | `pendingToolCall` 的冻结点在 `policyNode`，边界本身是对的 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `policyNode` | “`pendingToolCall` 的冻结点在 `policyNode`，这个设计是对的。” |
| `R11` | `policyNode` 预审批请求只带 `toolId`，不带 `args` | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `policyNode` | “审批请求目前看起来只带 `toolId`，不带 `args`。” |
| `R12` | `policyNode` 对 `deny` 的处理是危险写法 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `policyNode` | “policy 分支必须显式处理 `allow / require_approval / deny`。” |
| `R13` | 审批当前是 `tool-level approval`，不是 `invocation-level approval` | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `AgentApprovalRequest / approval state / resume` | “当前审批批准的是 `toolId`，不是一次具体调用。” |
| `R14` | `resume` 不复用已审批 `input`，审批对象和执行对象没有强绑定 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `AgentApprovalRequest / approval state / resume` | “审批对象和最终执行对象没有强绑定。” |
| `R15` | `buildCapabilityArgs` 在 Agent 层拼 `terminal` shell 命令 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `buildCapabilityArgs and helpers` | “`terminal_session` 不应该在 Agent 层拼 shell 命令。” |
| `R16` | `terminal` 相关参数和 workspace 边界校验过弱 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `buildCapabilityArgs and helpers` | “危险工具不应该在 `workspaceRoot` 缺失时继续构造命令。” |
| `R17` | Harness 当前没有通用 args schema 校验 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `toolNode / executeHarnessInvocation / executeInvocation / evaluateInvocationApproval` | “Harness 当前没有通用 args schema 校验。” |
| `R18` | `toolNode` 在缺 `pendingToolCall` 时会重新 `build args` | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `toolNode / executeHarnessInvocation / executeInvocation / evaluateInvocationApproval` | “`toolNode` 不应在缺 `pendingToolCall` 时重新 build args。” |
| `R19` | `terminal_session` 当前是“工具级审批 + 任意 command 执行”模型 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `terminal_session safety chain` | “`terminal_session` 当前是‘工具级审批 + 任意 command 执行’模型。” |
| `R20` | `routeStepNode` 不是智能下一步判断器，只是机械回看开关 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `routeStepNode / postToolReviewPending / continueIteration` | “`routeStepNode` 不是‘下一步智能判断器’。” |
| `R21` | `capabilityIntentNode` 回看时不直接消费工具结果 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `routeStepNode / postToolReviewPending / continueIteration` | “当前所谓‘工具结果回看’不是 `observation-aware review`。” |
| `R22` | `generateNode` 只消费 `lastToolExecution`，不消费完整 `observations` | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `generateNode` | “当前生成层只消费 `lastToolExecution`，不是消费完整 `observations`。” |
| `R23` | `retrieveNode` 暴露出工具路径与 RAG 路径基本互斥 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `retrieveNode` | “工具路径 和 RAG 路径 基本互斥。” |
| `R24` | `evaluateNode` 只是 completion guard，不是真正 verifier | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `evaluateNode` | “`evaluateNode` 当前只是 `completion guard`。” |
| `R25` | `AgentGraphOutput` 不保留 `blockedReason` | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `AgentGraphOutput / run writeback / message persistence` | “`blockedReason` 没进 `output`。” |
| `R26` | `waiting_approval` 走 `complete` 写回，状态机可读性差 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `AgentGraphOutput / run writeback / message persistence` | “`waiting_approval` 不是 `completed`，却走了 `complete` 方法。” |
| `R27` | `errorNode` 终态能工作，但 `blockedReason` 在最终输出层会丢失 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `errorNode + terminal state semantics` | “`blocked` 的原因在最终输出层会丢失。” |
| `R28` | `AgentNodeState / AgentRun` 不是清晰 capability-first，也不是清晰 tool-first | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `AgentNodeState / AgentGraphState / AgentRun domain model` | “当前 Agent state 不是清晰的 `capability-first`，也不是清晰的 `tool-first`。” |
| `R29` | state 无 reducer，导致 evidence 累积与消费模型不一致 | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `AgentNodeState / AgentGraphState / AgentRun domain model` | “`observations` 可以累积，但生成层不消费。” |
| `R30` | registry 本质是 `tool-first`，不是真正 `capability-first` | [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md) `registry / definition layer` | “当前底层 registry 是 `tool-first`，不是 `capability-first`。” |

### Mapping By Global Review Item

#### `GR-P0-1` Agent 自动拼 `terminal command` 风险

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“Agent 不该把自然语言直接翻译成 shell command。”
- 对应原始评审点：
  - `R15`：[buildCapabilityArgs and helpers](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`terminal_session` 不应该在 Agent 层拼 shell 命令。”
  - `R16`：[buildCapabilityArgs and helpers](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“危险工具不应该在 `workspaceRoot` 缺失时继续构造命令。”
  - `R19`：[terminal_session safety chain](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`terminal_session` 当前是‘工具级审批 + 任意 command 执行’模型。”

#### `GR-P0-2` 高风险工具审批粒度过粗

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“当前审批批准的是 `toolId`，不是某次具体 `invocation`。”
- 对应原始评审点：
  - `R11`：[policyNode](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“审批请求目前看起来只带 `toolId`，不带 `args`。”
  - `R13`：[AgentApprovalRequest / approval state / resume](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“当前审批批准的是 `toolId`，不是一次具体调用。”
  - `R14`：[AgentApprovalRequest / approval state / resume](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“审批对象和最终执行对象没有强绑定。”
  - `R19`：[terminal_session safety chain](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`terminal_session` 当前是‘工具级审批 + 任意 command 执行’模型。”

#### `GR-P0-3` 执行契约没有强冻结

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“`toolNode` 在缺少 `pendingToolCall` 时仍可能重新 `build args`。”
- 对应原始评审点：
  - `R10`：[policyNode](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`pendingToolCall` 的冻结点在 `policyNode`，这个设计是对的。”
  - `R18`：[toolNode / executeHarnessInvocation / executeInvocation / evaluateInvocationApproval](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`toolNode` 不应在缺 `pendingToolCall` 时重新 build args。”

#### `GR-P1-HIGH` `policyNode` 未显式处理 `deny`

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“这不是当前已知必现风险……但它属于本轮安全整改中应一并收掉的隐患。”
- 对应原始评审点：
  - `R12`：[policyNode](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“policy 分支必须显式处理 `allow / require_approval / deny`。”

#### `GR-P1-1` Capability / Tool 分层重构

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“当前底层 registry 是 `tool-first`，意图层又临时抽象出 capability profile，但 state、trace、审批、执行并没有把两层概念真正分开。”
- 对应原始评审点：
  - `R03`：[pickPreferredReadCandidate](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“当前更像是‘选 read capability’，不是‘选 read tool’。”
  - `R07`：[routeAfterCapabilityIntent](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“字段名叫 capabilityId，但实际存的是 toolId。”
  - `R08`：[lastToolExecution / toolNode writeback](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“不是行为 bug，是命名与领域模型不一致。”
  - `R09`：[policyNode](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`selectedCapabilityId` 实际存 `selectedToolId`。”
  - `R28`：[AgentNodeState / AgentGraphState / AgentRun domain model](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“当前 Agent state 不是清晰的 `capability-first`，也不是清晰的 `tool-first`。”
  - `R29`：[AgentNodeState / AgentGraphState / AgentRun domain model](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`observations` 可以累积，但生成层不消费。”
  - `R30`：[registry / definition layer](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“当前底层 registry 是 `tool-first`，不是 `capability-first`。”

#### `GR-P1-2` Harness 输入契约与 schema 校验

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“当前 Harness 更像‘对象形状检查 + 工具执行转发’，还不是严格的参数契约层。”
- 对应原始评审点：
  - `R16`：[buildCapabilityArgs and helpers](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“危险工具不应该在 `workspaceRoot` 缺失时继续构造命令。”
  - `R17`：[toolNode / executeHarnessInvocation / executeInvocation / evaluateInvocationApproval](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“Harness 当前没有通用 args schema 校验。”
  - `R18`：[toolNode / executeHarnessInvocation / executeInvocation / evaluateInvocationApproval](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`toolNode` 不应在缺 `pendingToolCall` 时重新 build args。”
  - `R19`：[terminal_session safety chain](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“command 内容不会被解析。”

#### `GR-P1-3` 候选暴露与调用前守卫收口

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“Agent 这一层不应继续承担第二套 embedding / task-model 主裁决……它更适合作为最后守卫机制。”
- 对应原始评审点：
  - `R01`：[computeRuleScore](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“可以作为召回增强，但不适合承担强决策。”
  - `R02`：[isWorkspaceIntentQuery](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“这不是普通 hint，而是一个强路由 gate。”
  - `R03`：[pickPreferredReadCandidate](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“当前更像是‘选 read capability’。”
  - `R04`：[pickPreferredReadToolId](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“它仍然是关键词路由。”
  - `R05`：[buildSelectionMessages](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“这个设计方向是对的……但这里有几个明显问题。”
  - `R06`：[parseTaskCapabilitySelection](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`use_capability` 必须携带 `capabilityId`。”

#### `GR-P1-4` 工具结果证据链补全

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“生成层主要消费 `lastToolExecution`，没有把完整 `observations` 变成正式 evidence payload。”
- 对应原始评审点：
  - `R20`：[routeStepNode / postToolReviewPending / continueIteration](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`routeStepNode` 不是‘下一步智能判断器’。”
  - `R21`：[routeStepNode / postToolReviewPending / continueIteration](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“当前所谓‘工具结果回看’不是 `observation-aware review`。”
  - `R22`：[generateNode](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“当前生成层只消费 `lastToolExecution`。”
  - `R23`：[retrieveNode](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“工具路径 和 RAG 路径 基本互斥。”
  - `R29`：[AgentNodeState / AgentGraphState / AgentRun domain model](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`observations` 可以累积，但生成层不消费。”

#### `GR-P2-1` 回看逻辑升级

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“当前系统有‘工具成功后再回看一次’的机制，但它还不是严格意义上的 observation-aware review。”
- 对应原始评审点：
  - `R20`：[routeStepNode / postToolReviewPending / continueIteration](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“只是‘工具成功后给一次回看机会’的机械开关。”
  - `R21`：[routeStepNode / postToolReviewPending / continueIteration](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“成功执行工具后，再拿原 query 跑一次 capability intent。”

#### `GR-P2-2` 工具路径与 RAG 路径组合

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“让 Agent 从‘有工具就不 RAG、没工具才 RAG’的分流结构，逐步走向更自然的组合式规划。”
- 对应原始评审点：
  - `R23`：[retrieveNode](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“当前 Agent 是‘先工具意图，没工具才 RAG’的分流结构。”

#### `GR-P2-3` 终态与可观测性增强

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“当前 `failed / blocked / waiting_approval / completed` 基本能工作，但终态原因表达不完整。”
- 对应原始评审点：
  - `R25`：[AgentGraphOutput / run writeback / message persistence](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`blockedReason` 没进 `output`。”
  - `R26`：[AgentGraphOutput / run writeback / message persistence](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`waiting_approval` 不是 `completed`，却走了 `complete` 方法。”
  - `R27`：[errorNode + terminal state semantics](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`blocked` 的原因在最终输出层会丢失。”
  - `R28`：[AgentNodeState / AgentGraphState / AgentRun domain model](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`UI / 日志 / metadata` 里 `capabilityId` 和 `toolId` 会混在一起。”

#### `GR-P2-4` `evaluate` 节点语义升级

- Global Review 定义出处：
  - [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)
  - 引述：“要么把 `evaluateNode` 收敛成名副其实的 final answer guard，要么补上 evidence-grounding 检查。”
- 对应原始评审点：
  - `R24`：[evaluateNode](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)  
    引述：“`evaluateNode` 当前只是 `completion guard`。”

## Notes

- 本页中的 `R01-R30` 是为了台账映射而做的显式拆分编号，不改变原始评审文档的章节结构。
- Global Review 主来源为 [agent-phase-1-global-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-global-review.md)。
- 原始评审事实主来源为 [agent-phase-1-code-review.md](D:/workspace/rag-demo/docs/chat/agent-phase-1-code-review.md)。

## Task Card Entry

| Global Review ID | Task Card | Priority | Task State | Review Summary |
| --- | --- | --- | --- | --- |
| `GR-P0-1` | [T-003-terminal-command-safety.md](D:/workspace/rag-demo/docs/project-control/tasks/T-003-terminal-command-safety.md) | `P0` | `DONE` | 已通过评审；高风险文件操作已切到 `workspace_mutation` 结构化受控路径 |
| `GR-P0-2` | [T-004-approval-invocation-level.md](D:/workspace/rag-demo/docs/project-control/tasks/T-004-approval-invocation-level.md) | `P0` | `DONE` | 已通过评审；审批对象、resume 与 Harness 放行已统一到 invocation 语义 |
| `GR-P0-3` | [T-002-toolnode-no-fallback.md](D:/workspace/rag-demo/docs/project-control/tasks/T-002-toolnode-no-fallback.md) | `P0` | `DONE` | 已通过评审；执行层缺少冻结调用对象时会阻断 |
| `GR-P1-HIGH` | [T-001-policy-deny.md](D:/workspace/rag-demo/docs/project-control/tasks/T-001-policy-deny.md) | `P1-high` | `DONE` | 已通过评审；`policyNode` 已显式处理 `allow / require_approval / deny` |
| `GR-P1-1` | [T-005-capability-tool-separation.md](D:/workspace/rag-demo/docs/project-control/tasks/T-005-capability-tool-separation.md) | `P1` | `DONE` | 已完成定向单测与手测；执行态 capability/tool 分层已收口 |
| `GR-P1-2` | [T-006-harness-schema-and-boundary.md](D:/workspace/rag-demo/docs/project-control/tasks/T-006-harness-schema-and-boundary.md) | `P1` | `DONE` | 已完成定向单测与真实接口手测；schema 与 workspace boundary contract 已生效 |
| `GR-P1-3` | [T-007-intent-shortcut-demotion.md](D:/workspace/rag-demo/docs/project-control/tasks/T-007-intent-shortcut-demotion.md) | `P1` | `DONE` | 已通过评审；workspace 规则已降级为 task-model 辅助提示 |
| `GR-P1-4` | [T-008-evidence-chain-completion.md](D:/workspace/rag-demo/docs/project-control/tasks/T-008-evidence-chain-completion.md) | `P1` | `DONE` | 已通过评审；formal evidence payload 已进入 route/generate 主链 |
| `Standalone` | [T-010-harness-candidate-ordering.md](D:/workspace/rag-demo/docs/project-control/tasks/T-010-harness-candidate-ordering.md) | `P1` | `DONE` | 评审已通过；Harness 候选排序缺陷修复与定向验证已验收 |
| `Standalone` | [T-011-sandbox-contract-direct-bench.md](D:/workspace/rag-demo/docs/project-control/tasks/T-011-sandbox-contract-direct-bench.md) | `P1` | `DONE` | 评审已通过；Sandbox direct bench、独立 bench contract、JSON runner 和 `not_implemented` 标记已验收 |
| `Standalone` | [T-012-l1-workspace-sandbox-runner.md](D:/workspace/rag-demo/docs/project-control/tasks/T-012-l1-workspace-sandbox-runner.md) | `P1` | `DONE` | Review 02 已通过；L1 Workspace Sandbox Runner 已具备 cwd workspace 锁、env 白名单、timeout/output 上限、direct result violations、Windows kill tree limitation 标记、sandbox unavailable 时隐藏 terminal_session |
| `Standalone` | [T-013-sandbox-artifact-output-contract.md](D:/workspace/rag-demo/docs/project-control/tasks/T-013-sandbox-artifact-output-contract.md) | `P1` | `DONE` | 已通过评审；Sandbox artifact/output 合同已验收，包含 artifact 注册、stdout/stderr 编码回传、binary 检测与 direct bench 覆盖 |

## Technical Debt

| Debt ID | Related Task | Status | Summary |
| --- | --- | --- | --- |
| `TD-T003-01` | [T-003-terminal-command-safety.md](D:/workspace/rag-demo/docs/project-control/tasks/T-003-terminal-command-safety.md) | `CLOSED` | `workspace_mutation` 已落地，T-003 评审通过后该历史债务关闭 |
| `TD-BUILD-001` | [T-009-test-report-json-consolidation.md](D:/workspace/rag-demo/docs/project-control/tasks/T-009-test-report-json-consolidation.md) | `OPEN` | 当前前后端 `coverage-report.json` 已达约 `11 MB / 10.8 MB`，且官方报告与 backend 静态目录存在重复拷贝；后续应改为脚本合并单一测试报告 JSON 载荷 |

## Recent Verification Notes

- `2026-07-05`：已完成 `T-013` 定向验证：
  - `pnpm --filter @ui-chat-mira/server test -- src/sandbox/executor.test.ts src/harness/sandbox/index.test.ts`
  - 结果：通过，`31 passed`
  - `pnpm --filter @ui-chat-mira/server bench:sandbox:direct D:\workspace\rag-demo`
  - 结果：通过
  - `pnpm --filter @ui-chat-mira/server exec tsc --noEmit -p tsconfig.json`
  - 结果：通过
  - `pnpm check`
  - 结果：通过
- `2026-07-05`：已完成 `T-012` 定向验证：
  - `pnpm --filter @ui-chat-mira/server test -- src/harness/exposure.test.ts src/mcp/tools/terminal-session.tool.test.ts src/harness/sandbox.test.ts src/harness/sandbox/index.test.ts src/sandbox/executor.test.ts`
  - 结果：通过，`78 passed`
  - `pnpm --filter @ui-chat-mira/server bench:sandbox:direct D:\workspace\rag-demo`
  - 结果：通过，JSON summary 为 `total=8`、`passed=7`、`failed=0`、`notImplemented=1`
  - `pnpm --filter @ui-chat-mira/server exec tsc --noEmit -p tsconfig.json`
  - 结果：通过
  - `pnpm check`
  - 结果：通过
- `2026-07-05`：已完成 `T-011` 定向验证：
  - `pnpm --filter @ui-chat-mira/server exec vitest run src/harness/sandbox.test.ts src/harness/sandbox/index.test.ts src/sandbox/executor.test.ts`
  - 结果：通过，`19 passed`
  - `pnpm --filter @ui-chat-mira/server bench:sandbox:direct D:\workspace\rag-demo`
  - 结果：通过，JSON summary 为 `total=8`、`passed=7`、`failed=0`、`notImplemented=1`
  - `pnpm --filter @ui-chat-mira/server exec tsc --noEmit -p tsconfig.json`
  - 结果：通过
  - `pnpm check`
  - 结果：通过
  - `pnpm package:electron:win`
  - 结果：失败，失败点在仓内既有 desktop/server 测试与 `better-sqlite3` 清理问题，不在 `T-011` 修改范围内
- `2026-07-05`：已完成 `T-010` 定向验证：
  - `pnpm --filter @ui-chat-mira/server exec vitest run src/harness/tool-candidates.test.ts src/harness/capability-diagnostics.test.ts src/harness/exposure.test.ts`
  - 结果：通过，`15 passed`
  - `pnpm --filter @ui-chat-mira/server exec tsc --noEmit -p tsconfig.json`
  - 结果：通过
  - `pnpm package:electron:win`
  - 结果：通过
  - 打包后健康检查：以 `release/v0.7.1_20260705_204516/electron/win-unpacked/resources/node-runtime/node.exe` 启动 `resources/server/server.cjs`，`curl http://127.0.0.1:8787/health` 返回 `success: true`
  - `pnpm check`
  - 结果：失败，原因是仓内既有 `server typecheck` 崩溃：`RangeError: Maximum call stack size exceeded`
- `2026-07-02`：已完成真实前端审批链路手测：
  - 在线程 `Codex Resume Trace Handtest` 中，以 Agent 模式发送 `请删除 codex-handtest-resume-trace.txt`
  - 命中 `waiting_approval`
  - 点击 `批准` 后，运行继续推进到完成态
  - 页面显示完整 `9 / 9` 步执行链，而不是停留在审批等待
  - 刷新线程后，后续 execution trace 仍然保留，不会回退成旧的审批态
  - 文件系统验证目标文件已删除
- 结论：`approve -> resume -> 执行 -> 组织回答 -> 刷新后 trace 可读` 这条一期主链已做实
- `2026-07-02`：已完成守卫链路收口验证：
  - 后端执行路径已拆成 `候选选择 -> 调用前守卫 -> 审批策略 -> 工具选择`
  - `toolGuardNode` 不再自行调用 embedding / diagnostics，只消费上游候选并做本地合法性检查
  - 单测：`pnpm --filter @ui-chat-mira/server exec vitest run src/agent/graph.test.ts`
  - 类型检查：`pnpm --filter @ui-chat-mira/server exec tsc --noEmit -p tsconfig.json`
  - 浏览器手测：在线程 `读取当前工作空间文件列表` 中，以 Agent 模式发送 `请列出当前工作空间根目录第一层文件。测试ID: GUARD-HANDTEST-0702-C`
  - 页面可见步骤：`候选选择 -> 调用前守卫 -> 审批策略 -> 工具选择 -> 下一步判断 -> 候选选择 -> 调用前守卫 -> 组织最终回答 -> 检查结果`
- `2026-07-02`：已完成 `T-005` 定向验证：
  - `pnpm --filter @ui-chat-mira/server exec vitest run src/agent/graph.test.ts src/agent/resume.test.ts src/agent/persistence.test.ts src/agent/routes.test.ts`
  - 结果：`31 passed`
  - 手测：真实线程 execution trace/details 已以 `toolId` 为执行主语写回
- `2026-07-02`：已完成 `T-006` 定向验证：
  - `pnpm --filter @ui-chat-mira/server exec vitest run src/mcp/core/invocations.test.ts src/mcp/core/schema.test.ts src/mcp/tools/terminal-session.tool.test.ts src/mcp/tools/read-open.tool.test.ts src/mcp/tools/read-list.tool.test.ts src/mcp/tools/read.tool.test.ts src/mcp/tools/read-locate.tool.test.ts src/mcp/tools/edit-file.tool.test.ts src/mcp/tools/workspace-mutation.tool.test.ts`
  - 结果：`49 passed`
  - `pnpm check`
  - 结果：通过
  - 手测：真实 `POST /mcp/invocations` 已验证 schema 缺参报错、workspace 越界给出明确审批原因、合法工作区内请求进入正常审批
