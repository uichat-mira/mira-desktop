---
status: current
owner: project-owner
last_verified: 2026-07-30
freshness_audited: 2026-09-16
layer: wiki
module: Project
feature: EngineeringMemory
Doc Type: current-snapshot
canonical: true
related:
  - CURRENT_PRODUCT_TRUTH.md
  - AGENT_CURRENT_TRUTH.md
  - TOOL_CURRENT_TRUTH.md
  - harness/agentgraph-harness-protocol.md
  - harness/README.md
  - skill/README.md
  - tooling-runtime/tools-protocol.md
  - forge/FORGE_CURRENT_CONTRACT.md
  - project-control/README.md
---

# UIChat Mira 工程共同记忆

> 这页记录当前工程必须共同遵守的主线、合同和阶段边界。具体实现细节以代码、真实验证和链接到的 current-contract 为准。
>
> 2026-09-16 只完成了 freshness / authority audit：清理 Organization 迁移后仍把 repository-local ledger / task card 当当前工程治理权威的表述，并未对本文全部 Runtime 技术事实重新验收。因此 `last_verified` 保留 2026-07-30。

## 1. 当前阶段

UIChat Mira 从 2026 年 8 月开始进入 **功能稳定迭代阶段**。

当前优先：

- 已有功能真实可用；
- 失败可诊断、可恢复、可停止；
- 回归测试覆盖关键合同；
- 前端状态与后台真实状态一致；
- 工具执行和 Evidence 可信；
- 文档与实现保持同一份真相；
- 新增能力小步、可验证、可回退。

当前不主动重开：

- Agent V2；
- DAG scheduler；
- 开放式多 Agent 编排；
- 并发工具执行主链；
- 长期记忆大系统；
- Harness 全面重写；
- 大型前端重设计。

## 2. 产品与工程定位

UIChat Mira 是本地优先、桌面优先、多 Provider 的个人 AI 工作台。

Chat、RAG、Agent、MCP、Skill、SubAgent 与微应用可以共存，但每项能力必须分别证明：

- 产品入口存在；
- 边界清楚；
- 失败语义明确；
- 有真实验证；
- 有回归保护；
- 文档没有把计划包装成现状。

## 3. Agent Runtime 当前真相

完整总真相见 [[AGENT_CURRENT_TRUTH]]。

`AgentGraph` 是稳定运行时门面，不等于底层图框架。

```text
AgentRun
  -> AgentGraph stable facade
  -> Pi Loop（应用默认）
  -> Main Planner
  -> direct action / governed delegation
  -> Evidence
  -> Planner or frozen delivery
  -> Generate
  -> Finalize
```

LangGraph 保留为显式兼容、历史测试和回归对照路径，不是应用默认主链。

## 4. 当前三类执行路径

### Main Agent direct

纯回答、检索或一个 concrete tool call 即可完成的简单动作由 Main Planner 直接处理。

### Generic delegation

边界明确、可独立验收的多步工作包可以通过 `delegate_task` 交给 Generic SubAgent。

- Child 拥有 task-local tool loop；
- Main Planner 保留 global goal 与最终验收；
- Child 不可再次委派；
- completed 后回 Main Planner。

### Skill-owned execution

任务型 primary Skill 可以把领域施工交给 Skill-owned SubAgent 或 deterministic Skill Flow。

- Parent 保留对话、审批、恢复、Evidence、终止与最终交付；
- Child 负责领域局部规划、工具循环、Runtime、Evidence 与 Artifact；
- completed 后冻结交付并直接 Generate，不让 Main Planner 重做施工；
- needs_input 由 Parent 提问；
- recoverable 返回受限恢复面；
- terminal failure 不进入 Generate。

当前 SubAgent 是受控、单层、任务局部的执行所有权转移，不是多 Agent 自治平台。

## 5. Agent 主线不变量

必须保护：

1. Main Planner 维护完整用户目标和全局完成判断；
2. 普通 concrete tool 由 Normalize 冻结 `pendingToolCall`；
3. Policy 只审批冻结后的 exact invocation；
4. Tool 只执行与 Policy 一致的调用；
5. Tool / Retrieve / Child result 不直接改写累计 Evidence；
6. Evidence 是累计证据的单一写入者；
7. 工具、检索或 Child observation 必须先进入 Evidence；
8. capability match、ranking 与 `selectedToolId` 不得成为 invocation；
9. waiting approval、terminal error、recovery exhausted 不得继续执行工具；
10. Generate 只依据 frozen finalization packet 引用的真实 Evidence；
11. Evidence answerable 不等于用户 global goal completed；
12. Generic Child completed 不等于 global completed；
13. Skill-owned Child completed 不得被 Main Planner 无意义重做；
14. observability 不得成为第二控制平面。

## 6. Planner 与完成判断

Planner 是 task-model 驱动的下一步决策器，不是静态步骤播放器。

它持续区分：

- 当前证据能否解释局部问题；
- 用户请求是否整体完成；
- 剩余工作是否适合 direct tool；
- 是否应委派一个完整工作包；
- 是否需要用户输入、审批或恢复。

`planList` 是轻量方向，不是事实仓库。工具结果、Evidence、推理和回答不能塞进计划项代替状态。

Pi Loop 没有全局 iteration cap；局部 schema replan 与 recoverable failure 有预算。

## 7. Approval 与恢复

### Settled exact invocation

目标合同绑定：

- `toolId`；
- `toolCallId`；
- `inputHash`。

命令、参数、cwd、env、timeout 或目标资源变化后必须重新判断。

恢复必须使用 checkpoint 和 frozen invocation，不重新根据用户文字猜参数。

SubAgent approval 还必须保存 transcript checkpoint。旧批准不能变成可复用权限。

### 当前 core 实现漂移

截至 2026-07-30，core `ApprovedInvocation` 实际匹配 `toolId + inputHash`；pending request 和 frozen call 虽然保存 `toolCallId`，但它尚未参与 grant match。批准在执行尝试后 one-shot 消费。

这是 exact-invocation identity 漂移，不是合同改版。完整说明见 [[TOOL_CURRENT_TRUTH]]。

### Settled C contract

- recoverable 失败进入 Evidence 并可以恢复；
- 恢复耗尽后进入 guarded answer；
- Graph completed，Chat finish reason stop；
- terminal failure Graph failed，finish reason error；
- terminal failure 不进入 Generate。

### 当前 dev 已知漂移

截至 2026-07-30，Planner 在 recovery exhausted 时直接返回 `error`，导致 Graph failed 且跳过 Generate。

这是高优先级实现漂移，不是 C contract 改版。不得用当前错误行为覆盖 settled contract。

## 8. Harness 当前定位

完整工具事实见 [[TOOL_CURRENT_TRUTH]]。

Harness 是 concrete tool 的控制平面，不是 Agent 的大脑。

Harness 负责：

- registry 与 public surface；
- availability 与 Tool Exposure；
- schema 与 metadata；
- risk / approval；
- workspace boundary；
- invocation；
- external MCP projection；
- event / trace / artifact / audit；
- result 到 bounded `llmContent` 的投影。

Harness 不负责：

- Main global planning；
- Generic / Skill Child local planning；
- 用户目标完成判断；
- 最终回答。

`delegate_task` 属于 Agent Runtime，不是 Harness Tool；Child 的 concrete tools 仍必须受治理。

Skill-private Runtime 不暴露给 Main Planner，也不能绕过 Parent 治理。

## 9. Tool 公共面

### Read

```text
read_discover
grep
read_open
codebase_explore
```

旧 `read / read_list / read_locate / read_extract / read_slice` 是内部 primitive 或兼容面，不进入当前 Agent exposure。

### Edit

```text
write_file
replace_block
delete_path
move_path
```

四个公开 Edit 工具都要求审批。旧 `edit_file / workspace_mutation` 只保留兼容。

### Search

- `web_search`：公共互联网，Tavily / SearXNG；
- `news_search`：本地 News Hub 缓存。

### Terminal

`terminal_session` 是完整 host shell / PTY runtime：

- 支持 Node、Python、Git、包管理器、脚本和长任务；
- workspace 外 `cwd` 可以在 exact approval 后执行；
- 当前不是强隔离 sandbox；
- 不能退化成通用业务集成容器。

### 扩展能力

Managed Browser、Attached Browser、Mail、GitHub、External Expert 与 External MCP 可以按真实 availability 进入 public surface。

## 10. Tool Exposure 不变量

```text
public eligible tools <= 20
  -> expose all
  -> skip ranking

public eligible tools > 20
  -> embedding / rerank
  -> expose top 20
```

必须保护：

- caller `topK / maxTools / minScore` 不能缩小 <=20 工具集；
- >20 没有 score threshold 淘汰；
- ranking 失败确定性回退前 20；
- Tool Group 只提供偏好，不改变 exposure；
- SkillContext 不扩大 Tool Exposure；
- capability match、ranking、selectedToolId 与 UI 选中状态都不是 invocation；
- risk 由 execution-time Policy / Approval 处理，不能靠假装工具不存在处理。

## 11. Tool 执行不变量

1. Planner 只选择本轮 exposed concrete tool；
2. Normalize 校验 plain args 与 schema；
3. workspace file args 机械归一化；
4. frozen `pendingToolCall` 保存 tool id、args、toolCallId 与 inputHash；
5. Policy 只读取 frozen call；
6. Harness 再次验证 schema；
7. ToolNode 只执行 Policy allow 且 hash 一致的 invocation；
8. execution attempt 后 one-shot 消费批准；
9. result / artifact / trace 进入统一 invocation；
10. Evidence 是累计写入者；
11. Generate 不调用 Tool。

## 12. External MCP

External MCP projected id：

```text
mcp:<serverId>:tool:<toolName>
```

进入 Agent 必须：

- enabled；
- connected；
- disclaimer accepted；
- discovery 成功；
- transport 配置有效；
- 用户显式 Agent Access；
- concrete invocation 经过 approval。

安装或连接不等于自动获得 Agent 权限。

## 13. CodeGraph

Planner 只看见 `codebase_explore`。

当前事实：

- 工具稳定注册；
- CodeGraph Studio 提供 provider/runtime config；
- 当前 Agent workspace 拥有实际 runtime context；
- 原生 query / explore / affected 留在 wrapper；
- candidate 必须回 workspace source verification；
- verified excerpts 才进入 retrieval Evidence；
- provider 不可用时返回 structured degraded / fallback signal。

当前 fallback 认知动作是：

```text
codebase_explore
  -> grep / read_discover
  -> read_open
```

CodeGraph 是代码理解加速器，不是第二个 Planner。

## 14. Skill 与 SubAgent

Skill 本体是渐进式披露的领域能力包，不等于 Tool、权限或 Runtime。

必须分开：

- SkillContext；
- ExecutionProfile；
- ToolExposure；
- Runtime readiness；
- Policy / Approval。

Context-only Skill 可以只增强 Main Planner。

Task Skill 可以使用 forked SubAgent。Stateful Skill Flow 是可选确定性 controller，不是所有 Skill 的默认状态机。

V1 禁止 nested SubAgent 与 recursive `delegate_task`。

## 15. Forge / 淬行工程不变量

Forge 已并入 Mira 主仓和 Mira Server 生命周期。后续工程必须继续保护：

1. `server/src/forge/**` 是 Forge runtime domain，不恢复第二 HTTP server、sidecar 或 `:47831` control plane；
2. 不建立 Forge 独立 package / lockfile / pnpm workspace / Vite app；
3. Forge Project Task Source 与 Forge Runtime Truth 分离：当注册 project 使用 repository-native Ledger / Task Card adapter 时，它们只是 Forge domain 的 task-source 输入；对 `uichat-mira/mira-desktop` 的工程工作，GitHub Issue 仍持有 work-item contract / outcome。Forge runtime 只保存 execution identity / state / evidence；
4. Main Thread 负责 discussion / inspection / planning，不是 Builder；
5. Dispatch 必须显式，source Main Thread 只能绑定同 project，当前仍是全局单 active Builder；
6. Builder terminal success = runtime `reviewing`，不是 Review PASS；
7. Review PASS 必须绑定当前 concrete SHA；旧 PASS 在 SHA 变化后失效；
8. terminal Builder result 以 dispatch identity 幂等回到显式相关 Main Thread，下一次用户 turn 只消费新 handoff，不注入 Builder 完整 conversation history；
9. restart 不伪造 process resume；丢失 supervision 的 active dispatch / thread 必须 reconcile 为 interrupted / error；
10. Desktop 标准 UI 与 Terminal View 只是同一 Forge product surface 的两种呈现，必须共用同一 typed API 和 orchestration。

旧 T010 cutover card、T015-T018 与固定源 work ledger 继续作为迁移时期的实现/验收证据被追溯；它们不再拥有 Mira Organization 当前 GitHub work-item 状态或结果。Forge 当前 authority 边界以 [[forge/FORGE_CURRENT_CONTRACT]] 为准。

## 16. 文档与工程治理真相合同

文档站必须区分：

- 当前真相；
- 施工与验证资料；
- 方案与实验；
- 历史归档；
- 待核验。

工程治理还必须区分：

```text
GitHub Issue        = work-item contract + outcome
Project Status      = Todo / In Progress / Done 管理位置
Org Issue Fields    = Priority / Effort / dates 等结构化规划元数据
PR / Review / CI    = implementation + verification evidence
feat/dev/test/prod  = environment position
project-control     = 组织化之前的 task/review/decision/test 等历史与实现证据
```

当代码与 settled contract 冲突时，必须同时记录：

- 目标合同；
- 当前行为；
- 影响；
- 修复状态。

不能只选一边，让另一边消失；也不能让历史 ledger / workboard 重新成为第二套当前工程管理系统。
