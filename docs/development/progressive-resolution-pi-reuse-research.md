---
status: research
owner: agent-runtime / skill-runtime
last_verified: 2026-10-10
layer: research
module: Agent
feature: ProgressiveResolution
doc_type: research
canonical: false
related:
  - ../AGENT_CURRENT_TRUTH.md
  - ../TOOL_CURRENT_TRUTH.md
  - ../skill/README.md
  - ../skill/pi-skill-agent-execution.md
  - ../harness/agentgraph-harness-protocol.md
---

# #243 Progressive Resolution：Pi Tool / Skill 渐进披露复用调研

> 本文记录 #243 对 Progressive Resolution / Tool Search 的外部实现调研与 Mira 当前接入结论。它是决策输入，不是 current contract；在 #243 maintainer decision 和 production evidence 冻结前，不应据此修改 Harness authority、Tool invocation contract 或 Skill execution contract。

## 1. 结论摘要

本轮调研得到四个结论。

1. **Pi 已经对 Tool 和 Skill 分别实现成熟的渐进披露，但它们不是同一个 API。**
   - Tool：通过 `direct / codemode / deferred / hidden` exposure、active tool loadout 与 `tool_search` 控制 schema 何时进入模型。
   - Skill：启动时只给模型 `name + description + path`，任务需要时再读取完整 `SKILL.md`；Skill references / scripts / assets 再按需访问。

2. **Mira Main Agent 不能直接“打开 Pi 的 Tool Search 开关”。**
   Mira Main Planner 当前不是 `pi-coding-agent AgentSession` 的标准 tool-calling loop；它把当前 `ToolExposure` 的 metadata/schema 序列化进 Planner prompt，再输出 Mira 自己的 `use_tool` JSON。因此 Pi 的 `setActiveTools()` / coding-agent loadout 不能原样挂到 Main Planner。

3. **Mira SubAgent 比 Main 更接近 Pi 的原生 Tool disclosure seam。**
   Skill-owned / Generic Child 当前已经使用 `@earendil-works/pi-agent-core Agent`，并在启动时一次性把允许 Tool 的 `name + description + full inputSchema` 塞入 `initialState.tools`。因此 Child 是最自然的 progressive Tool exposure 接入点，但 Mira 当前只依赖 `pi-agent-core`，而 Pi 成熟的 registry / exposure / loadout / tool_search 主要位于 `pi-coding-agent`。

4. **推荐复用 Pi 的“可见性机制”，不要把 Mira 的治理交给 Pi。**
   Pi 可以负责“当前模型应该看到什么”；Mira 继续负责“这个能力是否真实可用、是否有权限、是否需要审批、能否执行、如何产出 Evidence”。

核心不变量：

```text
progressive visibility != authority

Pi-style disclosure
  -> what the model can see

Mira Harness / Skill Runtime
  -> what may actually execute
```

## 2. Pi 的 Tool 渐进披露

Pi Coding Agent 对 MCP / Tool 提供明确 exposure 语义：

| exposure | 模型可见性 | 典型用途 |
| --- | --- | --- |
| `direct` | 直接声明给模型 | 小型、高频 Tool 集 |
| `deferred` | 初始不声明；`tool_search` 命中后在后续 model call 声明 | 大型、希望直接调用的 Tool 集 |
| `codemode` | 不直接声明给模型；通过 code mode 的 `searchTools()/describeTool()` 间接访问 | 大型 MCP / 组合调用 |
| `hidden` | 注册但不可达 | 禁用 / 隐藏能力 |

Pi 的关键能力不是“搜索算法”，而是 **active tool loadout**：

```text
registered Tool
  != active Tool
  != declared Tool in current model request
```

`tool_search` 命中 deferred Tool 后，该 Tool 会被加入当前分支的 active/declaration 状态，在后续模型调用中真正携带 schema。Pi 会把该状态记录进 transcript / branch，使 resume / fork 能恢复一致的工具可见性。

这比“每轮重新算 Top N”更接近真正的 Progressive Disclosure：**disclosure 是 session/branch 状态，不只是一次 ranking 结果。**

### 2.1 对 Mira 的可复用部分

值得复用/适配：

- Tool Registry 与 exposure metadata；
- active tool loadout；
- deferred declaration；
- Tool Search 后的动态 schema activation；
- branch/transcript 中的 disclosure persistence；
- prompt/cache 友好的动态 declaration；
- direct / deferred / hidden 等显式 exposure policy。

不应交给 Pi：

- Harness registry readiness；
- Agent Access / provider authorization；
- Policy / Approval；
- invocation freeze；
- Evidence / Artifact；
- Main / Child authority boundary。

## 3. Pi 的 Skill 渐进披露

Pi Skill 采用另一条路径。

启动时：

```text
all discovered Skills
  -> name
  -> description
  -> path
```

完整 `SKILL.md` 不进入初始上下文。

任务命中时：

```text
Skill summary
  -> model decides it is relevant
  -> read SKILL.md
  -> full Skill instructions enter context
  -> references / scripts / assets are read only when needed
```

这意味着 Pi 的 Skill progressive disclosure 是 **summary-first / body-later / resource-on-demand**，而不是把 Skill 当成一个 deferred function schema。

这条设计与 Mira 当前 `SkillContext` 很接近，但 Mira 仍有一个明显差异：

```text
Mira current:
Skill match
  -> primary
  -> immediately load primary.body
  -> list resources
  -> selectively preload disclosedResources
```

即：

- Mira 的 **resource** 已经具备部分渐进披露；
- Mira 的 **Skill body** 目前仍然是 primary 命中后立即加载。

当前代码证据：

- `server/src/skills/context/provider.ts`
  - `loader.loadContent(manifest)` 在 primary match 后立即执行；
  - `resources` 与 `disclosedResources` 已分离；
  - resource disclosure 有独立字符预算。
- `server/src/skills/context/types.ts`
  - `resources` 与 `disclosedResources` 已是不同字段。

因此 Mira 不需要重做 Skill 系统，只需把：

```text
primary selected
-> body eager
```

进一步拆成：

```text
Skill summary
-> resolved primary
-> body disclosure
-> resource catalog
-> resource disclosure
```

## 4. Pi Agent Core 与 Pi Coding Agent 的边界

这是本轮最重要的实现边界。

### 4.1 Mira 当前依赖

`server/package.json` 当前：

```text
@earendil-works/pi-agent-core 1.0.2
@earendil-works/pi-ai         1.0.2
```

没有依赖 `@earendil-works/pi-coding-agent`。

### 4.2 成熟 Progressive Tool Exposure 在哪里

Pi 的成熟能力主要位于 Coding Agent 层：

```text
pi-coding-agent
  -> AgentSession
  -> Tool Registry
  -> exposure
  -> prepare/loadout
  -> active tools
  -> tool_search / codemode
  -> pi-agent-core Agent
```

`pi-agent-core` 本身提供的是 Agent/tool loop 基础能力；它允许 `agent.state.tools` 变化，但不等于完整提供 Coding Agent 的 Tool Registry、deferred exposure、search policy 和 branch persistence。

因此不应把“我们已经使用 pi-agent-core”误写成“我们已经具备 Pi 的 tool_search/deferred runtime”。

## 5. Mira Main Agent 当前接入差异

Mira Main Planner 当前不是 Pi AgentSession。

主路径仍然是：

```text
prepareContext
  -> state.toolExposure
  -> Planner prompt includes allowed Tool metadata + schema
  -> model emits Mira nextAction JSON
       answer / retrieve / use_tool / ask_user / error
  -> Normalize
  -> Policy
  -> Approval
  -> Harness
  -> Evidence
```

`server/src/agent/planner/prompt.ts` 中的 `summarizeToolSchemas()` 当前会把已暴露 Tool 的：

- `toolId`
- `description`
- domain/source
- risk/boundaries
- `inputSchema`

写入 Planner 输入。

所以 Main 想使用 Pi 的 Progressive Tool Exposure，推荐做法不是把 Main Planner 替换成 Pi Coding Agent，而是增加一个独立的 visibility/loadout seam：

```text
Mira authorized capability space
  -> Progressive Resolution / Pi-style loadout
  -> currently disclosed Tool schemas
  -> state.toolExposure
  -> existing Main Planner
  -> existing Mira Normalize / Policy / Harness / Evidence
```

即：

> **Pi-style loadout 决定 Tool schema 是否进入 `toolExposure`；Mira Planner/Harness 合同保持不变。**

## 6. Mira SubAgent 当前工具暴露

Child 的现状与 Main 不同。

`server/src/skills/agent/pi-core.ts` 当前构建：

```ts
const tools: AgentTool<any>[] = [createStateReportingTool(...)];

tools.push(...input.tools.map(binding => toPiTool(...)));

const agent = new Agent({
  initialState: {
    systemPrompt,
    model,
    tools,
  }
});
```

而 `toPiTool()` 直接把：

```text
binding.id          -> name
binding.label       -> label
binding.description -> description
binding.inputSchema -> parameters
```

一次性声明给模型。

因此当前 Child 是 **full-schema eager exposure**，不是 progressive disclosure。

### 6.1 Generic Child

Generic Child 当前使用：

```text
Main current ToolExposure snapshot
  - delegate_task
  -> child allowedTools
  -> full schema eager exposure
```

这在 #243 进入生产后会产生明显问题：

如果 Main 已改成 progressive exposure，委派时 Main 只恰好披露了少数 Tool，那么 Generic Child 会把“Parent 当前已经翻开的牌”误当成自己完整的能力边界。

正确语义应改为：

```text
Parent authority envelope
  + discoverable capability space
  -> Generic Child local Progressive Resolution
  -> task-local schema disclosure
```

Child 不应因为 Parent 尚未 disclose 某个 Tool 就永久失去该能力；但 Child 也绝不能越过 Parent authority envelope。

### 6.2 Skill-owned Child

Skill-owned Child 的 scope 更明确：

```text
Skill ExecutionProfile
  -> allowed Harness capabilities
  + managed private runtime bindings
  -> child-local progressive disclosure
```

这里 progressive disclosure 只改变“何时给模型 schema”，不能扩大：

- `allowedHarnessToolIds`
- `runtimeBindings`
- workspace boundary
- approval requirement
- runtime readiness。

## 7. Skill ExecutionProfile 不应交给 Pi

Mira Skill 不等于普通 `SKILL.md`。

Mira Skill 还有：

```text
execution.allowedTools
runtimeBindings
workspaceBound
Skill-owned SubAgent
Skill-private Runtime
Approval
Evidence / Artifact
```

因此应该明确分层：

```text
Skill body / resources
  -> model-visible context
  -> may be progressively disclosed

ExecutionProfile / authority
  -> runtime-only governance
  -> never granted by disclosure
```

不能做成：

```text
model discovers Skill
  -> Skill says it owns Tool X
  -> Tool X becomes authorized
```

正确关系始终是：

```text
Skill declaration
  ∩ runtime registration
  ∩ current authority/binding
  ∩ readiness
  ∩ policy/approval
  -> executable capability
```

## 8. 推荐统一抽象：Progressive Resolution，而不是 Tool Search

#243 不应收敛成一个 `searchTools()` 功能。

推荐建立一层薄的 Mira `ResolutionSession`：

```text
ResolutionSession
  -> discover
  -> resolve
  -> disclose
  -> budget
  -> trace
```

不同对象使用相同状态机，但由不同 resolver 实现：

| 对象 | 初始可见 | 进一步披露 | Runtime authority |
| --- | --- | --- | --- |
| Capability | id / summary / domain | members | Harness |
| Tool | name / short description | metadata -> full schema | Harness |
| Skill | name / description | full body | Skill Runtime |
| Resource | uri / metadata | content | active Skill scope |
| Private Runtime | 不作为普通上下文目录 | semantic action schema（如需） | managed RuntimeBinding |

共享的是 **visibility state**，不是业务实现。

建议状态：

```text
known
discoverable
resolved
disclosed(metadata)
disclosed(full)
unavailable
not_authorized
budget_exhausted
```

## 9. Main / Generic Child / Skill Child 的统一模型

最终建议：

```text
                  Mira Resolution Layer
                           |
             +-------------+-------------+
             |                           |
         Skill / Resource              Tool
             |                           |
      summary -> body             direct / deferred
      -> resource                -> search / disclose
             |                           |
             +-------------+-------------+
                           |
                  Agent-visible context
                           |
        +------------------+------------------+
        |                  |                  |
      Main           Generic Child       Skill Child
        |                  |                  |
 global authority    parent envelope      skill profile
        +------------------+------------------+
                           |
                    Mira Harness / Runtime
                           |
                  Policy / Approval / Evidence
```

### Main

Scope：

```text
global authorized capability space
```

Progressive Resolution 生成当前 `state.toolExposure`。

### Generic Child

Scope：

```text
Parent-authorized authority envelope
```

Child 自己运行 task-local ResolutionSession；不继承“Parent 当前已经披露的 Tool 列表”作为能力上限。

### Skill Child

Scope：

```text
Skill ExecutionProfile envelope
```

在该 envelope 内渐进发现 Tool / Runtime action / Resource。

## 10. Resolver 与搜索算法

Progressive Resolution 不应绑定某一种搜索算法。

Tool Search 可以是：

```text
exact / structural narrowing
-> lexical / BM25
-> optional small-model semantic resolver
-> optional embedding
```

但这些都应隐藏在 Resolver 后面。

当前 #243 POC 已证明：Progressive Resolution 可以在没有 embedding/rerank 的情况下工作；现有实验中的 lexical resolver 只是 POC，不应直接冻结为 production search policy。

推荐原则：

> **能沿结构确定目标就直接 disclose；目标仍不确定时才 Search。**

即：

```text
known exact Tool
  -> disclose schema

known small capability scope
  -> disclose candidate metadata

unknown Tool / large dynamic scope
  -> Tool Search

search result resolved
  -> disclose schema
```

## 11. 与 Pi 的推荐复用边界

### 推荐复用

优先调查并复用/适配 Pi Coding Agent：

- Tool exposure semantics；
- Tool Registry / loadout；
- deferred activation；
- active tool state；
- tool_search / codemode 的 discovery contract；
- branch/resume/fork 下的 disclosure persistence；
- provider/cache 友好的动态 schema declaration。

Skill 层借鉴/适配：

- summary-first；
- body-later；
- resource-on-demand；
- custom ResourceLoader / Skill discovery seam。

### 不建议直接复用

不要让 `pi-coding-agent AgentSession` 直接取代：

- Mira Main Planner；
- Mira Harness；
- Mira approval；
- Mira Evidence；
- Mira Skill ExecutionProfile；
- Mira Skill-private Runtime；
- Mira Generic / Skill Child ownership contract。

## 12. 推荐实施顺序

#243 后续建议按以下顺序推进。

### A. 先冻结抽象

定义通用 `ResolutionSession` 的：

- state；
- budget；
- disclosure levels；
- trace；
- authority envelope 输入；
- resolver interface。

不要先把 BM25、embedding 或某个模型写死进 contract。

### B. Child POC

优先在 Child 验证：

```text
eager core
+ deferred catalog
+ task-local search/disclose
-> dynamic model-visible tools
```

原因：Child 已经是真正的 `pi-agent-core Agent`，接入 seam 最小。

### C. Main adapter

让同一 Resolution state 输出：

```text
current disclosed schemas
-> state.toolExposure
-> existing Planner prompt
```

不替换 Planner。

### D. Skill body/resource 接入

把当前：

```text
primary match -> body eager
```

调整为：

```text
Skill summary -> resolve primary -> disclose body
```

并继续沿用现有：

```text
resources != disclosedResources
```

设计。

### E. 最后才决定生产 Search policy

用真实 benchmark 比较：

- current production Top20；
- progressive + deterministic/BM25；
- progressive + small Resolver；
- 必要时 optional embedding。

不要在没有 production evidence 前冻结 Tool Search 阈值。

## 13. 明确不做

#243 不应：

- 把 SkillContext 当成 permission grant；
- 让 Resolver 直接执行 Tool；
- 让 Tool Search 绕过 Harness；
- 因为引入 Pi 而把 Main Planner 改成 pi-coding-agent；
- 让 Generic Child 的能力上限等于 Parent 当前已披露 Tool 集；
- 让 Child recursive delegation；
- 把 embedding 设成 Progressive Resolution 必选基础设施；
- 把 Tool Search 当成 Progressive Resolution 的唯一入口。

## 14. 决策建议

当前推荐方向：

> **采用 Mira-owned Progressive Resolution contract，复用 Pi 成熟的 Tool visibility/loadout 机制与 Skill disclosure pattern；Mira 继续拥有 authority、execution、approval、Evidence。**

更短的工程不变量：

> **Pi/Mira Resolution 决定“看什么”；Agent 决定“想做什么”；Harness/Skill Runtime 决定“能不能做”。**

这条边界同时适用于 Main、Generic Child、Skill Child。

## 15. 外部参考

调研核对时间：2026-10-10。

- Pi Skills：启动只广告 Skill name / description / path，完整 instructions 按需加载  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md
- Pi MCP / Tool Exposure：direct / deferred / codemode / hidden 与 tool_search  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md
- Pi SDK：ResourceLoader / custom Skills / AgentSession 接入  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- Pi AgentSession：active Tool loadout 与 callable/deferred Tool 管理  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts
- Pi Agent Core：底层 Agent Tool state 可变，但不等价于 Coding Agent 的完整 Progressive Tool Runtime  
  https://github.com/earendil-works/pi/blob/main/packages/agent/README.md
- Pi v1.0.4 release（2026-10-05）：Tool loadout / MCP exposure 仍在持续修正和稳定  
  https://github.com/earendil-works/pi/releases/tag/v1.0.4

## 16. Mira 当前代码锚点

- `server/package.json`
- `server/src/agent/planner/prompt.ts`
- `server/src/agent/pi-loop/index.ts`
- `server/src/agent/delegation/contract.ts`
- `server/src/agent/nodes/generic-task-subagent.ts`
- `server/src/agent/nodes/forked-skill-agent.ts`
- `server/src/skills/context/provider.ts`
- `server/src/skills/context/types.ts`
- `server/src/skills/agent/profiles.ts`
- `server/src/skills/agent/subagent-runtime.ts`
- `server/src/skills/agent/pi-core.ts`
- `server/src/skills/agent/tool-adapters.ts`
