---
status: current
owner: runtime
last_verified: 2026-07-30
layer: wiki
module: Harness
feature: Overview
Doc Type: overview
canonical: true
related:
  - ../AGENT_CURRENT_TRUTH.md
  - ../TOOL_CURRENT_TRUTH.md
  - agentgraph-harness-protocol.md
  - ../skill/README.md
  - ../tooling-runtime/tools-protocol.md
---

# Harness 模块

> Harness 是 concrete tool 的控制平面，不是 Agent 的大脑，也不是 SubAgent 编排器。完整工具面先读 [[TOOL_CURRENT_TRUTH]]。

## 推荐入口

- [[TOOL_CURRENT_TRUTH]]：当前公共工具面、动态能力、暴露、审批与降级；
- [[AGENT_CURRENT_TRUTH]]：Tool 如何进入 Main / Child execution；
- [[harness/agentgraph-harness-protocol]]：Agent concrete invocation 与 Evidence；
- [[tooling-runtime/tools-protocol]]：definition / exposure / invocation 技术协议。

## 1. Harness 负责什么

Harness 负责：

- capability / tool registry；
- public surface classification；
- eligible tool surface；
- Tool Exposure；
- schema 与 metadata；
- risk / approval boundary；
- workspace boundary；
- invocation；
- external MCP projection；
- event / trace / artifact / audit；
- result 到 bounded `llmContent` 的统一投影。

Harness 不负责：

- 用户目标分解；
- 多步任务下一步决策；
- Generic / Skill SubAgent task-local planning；
- 工具参数生成；
- 用户目标完成判断；
- 最终自然语言回答；
- Skill-private Runtime 的领域实现。

## 2. 四层合同

### Registry

保存 definition 与 implementation。注册存在不等于 Planner 可见。

### Public Surface / Availability

先排除内部 primitive 和兼容 wrapper，再应用事实 availability：

- authenticated user；
- connection；
- runtime readiness；
- external MCP Agent Access；
- implementation 是否仍在 registry。

### Tool Exposure

`state.toolExposure` 是 Main Planner 当前可见 concrete tools 的运行时真相：

- id；
- title / description；
- input schema；
- domain / source；
- tags；
- side effect / approval / workspace metadata。

Tool Exposure 只提供可选面，不产生 invocation。

### Invocation

普通 Main Planner tool 必须经过 Normalize 冻结：

```ts
executeHarnessInvocation({
  toolId,
  args,
  inputHash,
  approvedInvocations,
  environment,
})
```

## 3. 普通 concrete tool 路径

```text
Main Planner
  -> nextAction.use_tool(concrete tool)
  -> Normalize
  -> Policy
  -> Harness Invocation
  -> pending tool / retrieval result
  -> Evidence
  -> Main Planner
```

| Agent 步骤 | Harness 角色 |
| --- | --- |
| Prepare Context | 解析 registry、public surface、availability 与 exposure |
| Planner | 提供 concrete definitions，不代替选择 |
| Normalize | schema、path normalization、冻结 call、计算 inputHash |
| Policy | side effect、workspace 与 approval |
| Tool | 执行与 frozen call 一致的 invocation |
| Evidence | 接收真实 result / `llmContent` |
| Generate | 只消费已引用 Evidence，不调用 Harness |

## 4. Tool Exposure 当前规则

```text
public eligible tools <= 20
  -> 全部暴露
  -> 不运行 ranking

public eligible tools > 20
  -> capability profile
  -> embedding / rerank
  -> toolId 去重
  -> 前 20
```

当前事实：

- caller `topK / maxTools / minScore` 不能缩小 <=20 工具集；
- >20 时没有 score threshold 淘汰；
- ranking 失败按 registry 顺序回退前 20；
- 没有 Browser-only、Terminal-needed 或 task-phase 暴露规则；
- Main Planner 不二次改写 Harness ranking。

Recall / rerank 只服务上下文预算，不是授权或执行决定。

## 5. Tool Group 不改变 Exposure

用户选择的工具包：

- 给 ranking query 增加偏好；
- 写入 available / unavailable trace；
- 不扩大或缩小 canonical exposure；
- 不产生 invocation。

SkillContext 同样不扩大 Main Tool Exposure。

## 6. 不得恢复的旧执行入口

以下对象不能变成 invocation：

- capability id / match；
- preferredToolId；
- `capabilityIntent.selectedToolIds`；
- `selectedToolId`；
- ranking score；
- query keyword rule；
- UI 选中状态；
- Tool Group；
- Skill match。

真实执行只能来自 frozen concrete invocation 或受控 Child runtime binding。

## 7. `delegate_task` 不是 Harness Tool

`delegate_task` 属于 Agent Runtime：

- 不来自 Harness ranking；
- 不对应外部 provider invocation；
- 不进入 Main Agent 普通 Normalize / Policy / ToolNode；
- 启动受控 Generic SubAgent；
- V1 不允许 Child 再次委派。

Child 内真实 concrete tool 仍受 binding、Policy、approval、workspace、environment 与 Evidence contract 治理。

## 8. Skill-private Runtime 不是第二个 Harness

Office document / PDF / presentation / spreadsheet 等 private Runtime：

- 不暴露给 Main Planner；
- 不注册成普通全局 Tool；
- 不参与 Main Tool Exposure ranking；
- 由 Skill execution profile 与 managed adapter 解析；
- readiness、workspace、approval 和 audit 必须真实成立；
- pending binding 不得伪装 ready。

## 9. Approval 当前事实

### Static metadata

Definition 可以声明 `requiresApproval`。当前公开 Edit、Terminal、Browser act/transfer 与 External MCP 有明确静态审批要求。

### Dynamic requirement

GitHub remote write、Mail force sync 等可以按具体 operation 在执行时额外要求审批。

### Exact invocation 漂移

settled 目标仍是：

```text
toolId + toolCallId + inputHash
```

截至 2026-07-30，core `ApprovedInvocation` 实际匹配：

```text
toolId + inputHash
```

pending request 和 frozen call 保存 `toolCallId`，批准在执行尝试后 one-shot 消费，但 `toolCallId` 尚未进入 grant match。这是已知实现漂移，不是合同改版。

## 10. Workspace 与 Terminal

普通 Read / Edit file tools 使用严格 workspace path normalization。

`terminal` 是 host shell / PTY runtime：

- 支持完整命令、Node、Python、Git、包管理器和长任务；
- `cwd` 可以是 workspace-relative、父级或绝对路径；
- workspace 外执行仍需要 exact approval；
- host cwd 不被偷偷改写。

旧 command sandbox 已退出主链。释放执行能力不等于绕过 approval、process ownership 或 cleanup。

## 11. External MCP

External MCP projected tool 必须：

- server enabled / connected；
- disclaimer accepted；
- discovery 成功；
- transport 配置有效；
- 用户开启 Agent Access；
- canonical implementation 仍在 registry；
- id 使用 `mcp:<serverId>:tool:<toolName>`；
- concrete invocation 经过 approval；
- result 进入 Evidence。

## 12. Result、Evidence 与 Generate

Completed invocation 可投影：

- structured result；
- bounded `llmContent`；
- truncation metadata；
- event；
- artifact；
- trace。

ToolNode 产生 pending execution / retrieval，Evidence 统一累计。

Generate：

- 不调用 Harness；
- 不选择工具；
- 不重新判断完成；
- 只消费 finalization packet 引用的 Evidence；
- 阻断内部 tool protocol leak。

## 13. 当前判断

Harness 当前是：

> **Registry、公共面、暴露、边界、审批、执行、结果和审计的控制平面。**

Main Planner 决定全局下一步；SubAgent 决定被委派工作包的局部下一步；Harness 保证 concrete tool execution 可信。
