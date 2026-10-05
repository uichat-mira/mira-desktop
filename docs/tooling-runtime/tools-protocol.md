---
status: current
owner: runtime
last_verified: 2026-07-30
layer: raw-source
module: Tool
feature: ToolsProtocol
Doc Type: current-contract
canonical: true
related:
  - ../TOOL_CURRENT_TRUTH.md
  - README.md
  - ../harness/README.md
  - ../harness/agentgraph-harness-protocol.md
---

# 工具协议（Tools Protocol）

> 本页定义当前 Tool definition、public exposure、concrete invocation、approval、event、artifact 与 external MCP projection 协议。具体工具清单和当前实现偏差见 [[TOOL_CURRENT_TRUTH]]。

## 1. 分层模型

```text
Capability Implementation
  -> Registry
  -> Public Surface Classification
  -> Availability Gate
  -> Tool Exposure
  -> Frozen Invocation
  -> Policy / Approval
  -> Execution
  -> Result / Artifact / Trace
  -> Evidence
```

这些层不能互相替代。

### Capability Implementation

至少包含：

- stable id；
- title / description；
- domain / source；
- input schema；
- optional output schema；
- tags；
- capability metadata；
- execute handler。

### Registry

Registry 保存 definition 与 implementation。

Registry 中存在不代表：

- 是公共 Planner tool；
- 当前连接可用；
- 本轮进入 exposure；
- 本次 invocation 已获批准。

### Public Surface

当前会隐藏内部 / 兼容工具：

```text
read
read_list
read_locate
read_extract
read_slice
edit_file
workspace_mutation
```

### Availability Gate

只使用事实条件，例如：

- authenticated user 是否存在；
- External Expert 连接是否存在；
- External MCP 是否 connected / discovered / Agent Access enabled；
- managed runtime 是否可解析；
- tool implementation 是否仍在 registry。

Availability 不根据“模型看起来用不用得到”做语义删减。

## 2. Tool Exposure

`state.toolExposure` 是 Main Planner 本轮可见 concrete tools 的真相源。

它包含：

- exposed tool ids；
- title / description；
- input schema；
- domain / source；
- tags；
- side effect / approval / workspace metadata。

### 小工具集

```text
publicToolCount <= 20
  -> expose all
  -> do not run ranking
```

调用方传入的 `topK / maxTools / minScore` 不得缩小工具面。

### 大工具集

```text
publicToolCount > 20
  -> capability profile
  -> embedding recall
  -> rerank
  -> toolId dedupe
  -> expose top 20
```

- 没有 `minScore` 额外淘汰；
- embedding / rerank 不可用时按 registry 顺序确定性返回前 20；
- ranking 只是上下文预算，不是授权、Policy 或 task phase 决策。

### Tool Group Preference

用户选择工具包时：

- 只给 ranking query 增加偏好；
- 记录 available / unavailable；
- 写入 trace；
- 不直接修改 exposure；
- 不产生 invocation。

## 3. Definition 与 Exposure Schema

同一工具可以提供：

- 完整 workbench schema；
- `agent_intent` 专用 schema。

例如 Managed Browser 在 Agent exposure 中隐藏 `sessionId`，由 runtime 按 thread 创建或复用会话。

Exposure schema 必须：

- 保留 concrete action 所需参数；
- 移除模型不应生成的 provider config / secret / internal session state；
- 不通过自然语言猜测补造缺失参数。

## 4. 命名协议

### Internal Tool

使用短、稳定、领域无歧义的 id，例如：

```text
read
grep
write_file
web_search
terminal_session
browser_observe
github_repository
```

当前 Universal Read 的公开 known-target reader 是 `read`。历史 `read_open` 仅作为迁移期兼容入口保留，不进入新的 Agent exposure；待已验证的 persisted/runtime consumer 迁移完成后删除。

### External MCP Projected Tool

canonical id：

```text
mcp:<serverId>:tool:<toolName>
```

投影 definition：

- `source = external`；
- `domain = external_mcp`；
- `sideEffect = network`；
- `requiresApproval = true`；
- 保留远端 input / output schema；
- 不允许旧 `external:*` id 或 provider 私有命令穿透。

## 5. Concrete Invocation

普通 Main Agent tool call 必须由 Planner 从 exposure 中选择。

### Normalize

Normalize：

1. 校验 `toolId` 属于本轮 exposure；
2. 要求 args 是 plain object；
3. 对普通 workspace-bound file args 做机械归一化；
4. 使用 definition schema 校验；
5. 冻结 `pendingToolCall`；
6. 计算完整 args 的 SHA-256 `inputHash`；
7. 保存 `toolCallId`。

Normalize 不：

- 根据 selectedToolId 换工具；
- 根据描述重写 operation；
- 猜缺失路径或参数；
- 把 capability profile 变成 invocation。

### Policy

Policy 只评估 frozen call 与 frozen definition：

- tool id；
- input hash；
- capability metadata；
- workspace boundary；
- approved invocation；
- operation-specific requirement。

### Tool

ToolNode 只执行：

- origin 是 Planner 或受控 runtime binding；
- Policy 为 allow；
- Policy toolId / inputHash 与 frozen call 一致；
- schema 再次验证成功；
- environment 与 user / thread / workspace 上下文真实存在。

## 6. Workspace 与 Path

### 普通文件工具

Read / Edit file args 走严格 workspace path normalization：

- workspace root 内解析；
- 阻断非法绝对路径、URI 与逃逸；
- 需要时检查 symlink / target boundary；
- workspace 外目标按 definition 与 approval policy 处理。

### Terminal

`terminal_session.cwd` 是 host-process cwd：

- 相对 workspace 路径可用；
- 父级与绝对路径可在审批后使用；
- normalization 不应偷偷改写用户审批过的 cwd；
- Terminal 仍然需要 approval、process ownership 和 cleanup。

不得把 Terminal 的边界套回普通 file tool，也不得反过来放松文件工具。

## 7. Approval 协议

### Metadata Approval

Definition 可声明：

- `requiresApproval`；
- side effect；
- workspace boundary arg keys；
- network / process / long-running metadata。

当前静态审批例子：

- public Edit；
- `terminal_session`；
- `browser_act`；
- `browser_attached_act`；
- `browser_attached_transfer`；
- External MCP projected tools。

### Dynamic Approval

具体 operation 仍可提出额外要求：

- GitHub remote write；
- `mail_query sync=force`；
- 未来其他 operation-specific side effect。

所以 `requiresApproval=false` 不代表所有 operation 永远免审。

### Exact Invocation

settled 目标：

```text
toolId + toolCallId + inputHash
```

当前 core matcher 实际使用：

```text
toolId + inputHash
```

pending request 和 frozen call 保留 `toolCallId`，批准在执行尝试后 one-shot 消费，但 `toolCallId` 尚未进入 grant match。该差异属于已知实现漂移，不在本轮文档更新中修改。

## 8. Invocation Event

统一事件包括：

```text
invocation:start
invocation:progress
invocation:artifact
invocation:result
invocation:error
invocation:finish
invocation:approval_required
```

Tool-specific stdout、stderr、search progress、browser artifact 等必须放进统一 invocation 观察链，而不是形成第二套执行状态机。

## 9. Result、LLM Projection 与 Artifact

Completed invocation 可以产生：

- structured result；
- bounded `llmContent`；
- included / original chars；
- truncated metadata；
- artifact；
- trace spans。

Failed invocation 不生成成功的 LLM projection。

Artifact 可包括：

- text / code；
- search-results；
- table；
- terminal-log；
- image / screenshot；
- JSON；
- domain-specific result。

Artifact 不能包含 secret、token、未经裁剪的敏感配置或不必要的私人正文。

## 10. Evidence Handoff

Harness 不直接决定用户任务完成。

```text
Invocation result
  -> ToolNode pending execution / retrieval
  -> Evidence node
  -> Planner acceptance
  -> Generate
```

- 普通 tools 形成 tool execution Evidence；
- `codebase_explore` 的 verified chunks 形成 retrieval Evidence；
- Child tool result 仍必须通过其受治理 Evidence 路径；
- Generate 不重新调用 Tool。

## 11. Failure Contract

Tool failure 至少区分：

### Terminal / policy class

- approval mismatch；
- policy denied；
- schema invalid；
- workspace escape；
- cancelled。

这些不能被当作普通可重试 runtime error。

### Recoverable runtime class

- tool runtime failed；
- command exit nonzero；
- timeout；
- unknown runtime failure。

它们进入失败事实与 recovery budget，由 Agent 合同决定下一步。

Tool 协议不擅自修改 Agent 的 settled recovery-exhausted C contract。

## 12. 特殊能力边界

### `delegate_task`

属于 Agent Runtime 委派协议：

- 不来自 Harness ranking；
- 不走普通 Main Normalize / Policy / ToolNode；
- Child concrete tools 仍走受治理执行；
- V1 不允许 Child 递归委派。

### Skill-private Runtime

- 不进入普通 Main Tool Exposure；
- 不参与全局 ranking；
- execution profile 只声明需求；
- readiness / approval / workspace / audit 必须真实成立。

### CodeGraph

- public tool 是 `codebase_explore`；
- native query / explore / affected 留在 provider wrapper；
- candidate 先核验 source；
- provider unavailable 返回 degraded signal，不伪造结果。

## 13. 当前代码锚点

- `server/src/harness/runtime.ts`
- `server/src/harness/registry.ts`
- `server/src/harness/exposure-core/filters.ts`
- `server/src/harness/candidates-core/resolver.ts`
- `server/src/harness/profiles/resolver.ts`
- `server/src/harness/invocations.ts`
- `server/src/mcp/core/invocations.ts`
- `server/src/mcp/core/permissions.ts`
- `server/src/mcp/workspace-path-args.ts`
- `server/src/agent/nodes/prepare-context.ts`
- `server/src/agent/nodes/tool-call-normalize.ts`
- `server/src/agent/nodes/policy-node.ts`
- `server/src/agent/nodes/tool-node.ts`

具体工具 definition 以 `server/src/mcp/tools/**` 与 managed runtime 目录为准。
