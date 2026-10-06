---
status: current
owner: runtime
last_verified: 2026-07-30
layer: wiki
module: Tool
feature: Overview
Doc Type: overview
canonical: true
related:
  - ../TOOL_CURRENT_TRUTH.md
  - ../harness/README.md
  - ../harness/agentgraph-harness-protocol.md
  - tools-protocol.md
  - ../AGENT_CURRENT_TRUTH.md
---

# Tool 运行时总览

> 这页是 Tool 模块的阅读入口。当前工具面、暴露、审批和 CodeGraph 状态以 [[TOOL_CURRENT_TRUTH]] 为准。

## 推荐阅读顺序

1. [[TOOL_CURRENT_TRUTH]]：当前公共工具面、动态能力、暴露规则、审批与已知漂移；
2. [[harness/README]]：Harness 控制平面；
3. [[harness/agentgraph-harness-protocol]]：Main Agent concrete invocation 与 Evidence；
4. `tools-protocol.md`：工具 definition、exposure、invocation、event、artifact 技术协议；
5. [[AGENT_CURRENT_TRUTH]]：工具如何进入 Agent / SubAgent 主线；
6. [[skill/README]]：SkillContext、ExecutionProfile 与 private Runtime 边界。

## 当前 Tool 结构

```text
Registry
  -> public surface / explicit availability
  -> Tool Exposure
  -> Planner or governed Child chooses concrete tool
  -> Normalize
  -> Policy / Approval
  -> Harness Invocation
  -> Result / Artifact / Trace
  -> Evidence
```

必须分开：

- **Registry**：运行时知道哪些 implementation；
- **Public Surface**：哪些 implementation 可以成为 Planner 工具；
- **Availability**：连接、用户、Runtime 或配置是否真实成立；
- **Tool Exposure**：本轮 Planner 看到什么；
- **Invocation**：本次 frozen args 是否可以执行；
- **Evidence**：执行结果是否进入累计事实。

注册存在不等于 Planner 可见，Skill match 也不等于工具可用。

## 当前核心公共面

### Read

- `read_discover`
- `grep`
- `read_open`
- `codebase_explore`

旧 `read_list / read_locate / read_extract / read_slice / read` 是内部 primitive 或兼容面，不进入当前 Agent exposure。

### Edit

- `write`
- `edit`
- `delete`
- `move`

四个 canonical File Mutation 工具统一经过 File Mutation Runtime，并要求 exact invocation 审批。旧 `write_file / replace_block / delete_path / move_path / edit_file / workspace_mutation` 已退出本地可执行 registry；只保留旧 Evidence summary 的历史读取兼容。

### Search

- `web_search`：公共互联网，Tavily / SearXNG 由受信任配置选择；
- `news_search`：本地 News Hub 缓存，不是实时公网搜索。

### Terminal

- `terminal`

这是完整 host shell / PTY runtime，不是 command sandbox，也不是第三方集成容器。

## 当前扩展能力

当前 registry / dynamic registration 还包括：

- Managed Computer Use：`browser_observe / browser_act / browser_assert`；
- Attached Browser：`browser_attached_look / browse / act / transfer`；
- Mail：`mail_query`；
- GitHub：`github_repository / issue / pull_request / actions`；
- External Expert：`ask_external_expert`，仅连接真实可用时暴露；
- External MCP：`mcp:<serverId>:tool:<toolName>`，需要连接、discovery 和 Agent Access；
- WenShu / Office private runtime：只进入 Skill-owned execution，不进入普通 Main Tool Exposure。

## Tool Exposure

```text
public eligible tools <= 20
  -> expose all
  -> skip ranking

public eligible tools > 20
  -> embedding / rerank
  -> expose top 20
```

- caller `topK / maxTools / minScore` 不能缩小小工具集；
- 没有 score threshold 淘汰；
- ranking 失败使用确定性前 20；
- 用户选择的工具包只提供 ranking preference，不改变 canonical exposure；
- capability match、selectedToolId、UI 选中状态都不是 invocation。

## Approval

公开 Edit、Terminal、Browser act/transfer 与 External MCP 具有明确审批要求。

GitHub 远程写、Mail force sync 等还会按具体 operation 动态要求审批。

当前 core matcher 实际使用 `toolId + inputHash`，而 settled exact-invocation 目标还包含 `toolCallId`。这是已知实现漂移，详见 [[TOOL_CURRENT_TRUTH]]。

## CodeGraph 当前状态

`codebase_explore` 已经是当前公共 Read 工具，不再是 docs-only plan：

- 常驻稳定工具 id；
- provider / runtime 由 CodeGraph Studio 配置；
- Agent workspace 拥有实际 runtime context；
- 原生结果必须经过 workspace source verification；
- 不可用时返回 structured degraded / fallback signal。

旧的 benchmark、spike、wrapper 与 implementation plan 已转入历史归档，保留它们用于解释演进。

## 历史与施工资料

- `project-control/tasks/`：施工卡；
- `project-control/reviews/`：评审；
- `project-control/testEvidence/`：测试证据；
- `archive/tool/`：旧矩阵、整改台账、六月设计和 CodeGraph 实现前方案。

施工记录可以解释为什么这样做，但不能覆盖当前代码和 [[TOOL_CURRENT_TRUTH]]。
