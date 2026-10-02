---
status: planned
owner: architecture / agent-runtime / harness / microapp
last_verified: 2026-10-03
layer: design
module: MiraNext
feature: AgentCapabilityMicroApp
Doc Type: engineering-draft
canonical: false
related:
  - ../CURRENT_PRODUCT_TRUTH.md
  - ../CHAT_CURRENT_TRUTH.md
  - ../AGENT_CURRENT_TRUTH.md
  - ../TOOL_CURRENT_TRUTH.md
  - ../MICROAPP_CURRENT_TRUTH.md
  - ../forge/FORGE_CURRENT_CONTRACT.md
  - ../remote-access/mobile-host-protocol-v1.md
  - ../harness/agentgraph-harness-protocol.md
  - ../knowledge-system/DOCUMENTATION_STANDARDS.md
---

# Mira Next 工程稿：Agent、Capability、MicroApp 与外部世界

> 本文把 2026-09-02 与 2026-09-08 两篇 Mira Next 产品草案收敛为可施工的工程路线。
>
> 它是 **Planning / engineering draft**，不是 Current Truth，不覆盖现有 canonical contract，也不授权一次性重写 Agent、Tool、MicroApp、Mobile 或 Forge。
>
> 本稿按当前 Desktop / Mobile owning contracts、当前代码与 Runtime 事实持续核验；具体实现状态以 owning Current Truth、代码和可重复运行证据为准，不把某个历史 commit 固化为长期设计前提。

产品草案来源：

- https://mira.tomz.io/blogs/product-journal/mira-next-draft-01-agent-tools-external-world
- https://mira.tomz.io/blogs/product-journal/mira-next-draft-02-capabilities-microapps-agent-work


## 1. 这次真正要解决什么

两篇草案讨论了 Chat 默认 Agent、Pi Loop、Structured Action、Tool discovery、触界、MCP、Workspace、Capability、MicroApp、Mobile、审批、看板、Forge、Memory 与 Insight。

Mira Next 的长期工程目标不是把这些能力一次性画成一张“大架构图”，而是建立少量稳定边界，让 Agent 能在不同工作上下文中逐步获得所需能力，同时保持 Tool、Policy、Evidence 与跨端合同可验证。

长期迁移主线：

```text
锁定当前真相与概念边界
  ↓
让模型决策进入 Runtime 的边界可靠
  ↓
确立 Thread-owned Workspace
  ↓
让 Chat 收敛到 Agent Runtime
  ↓
硬化 Universal Core Tools 与 Context Core
  ↓
建立 protocol-neutral Tool Core 与 progressive disclosure
  ↓
以 MCP 为外部扩展优先协议
  ↓
Browser / Search 形成基础外部世界能力
  ↓
MicroApp 成为真正的平台对象
  ↓
Remote Capability 对齐 Desktop / Mobile 已有协议
  ↓
最后再讨论通用持续工作对象与看板
```

设计原则：

> **工具面按 Agent 认知语义保持小而稳定；工作上下文按需增加次核心能力；外部世界通过渐进披露逐层展开。**

Mira Next 不作为一次 V2 rewrite 推进。每一步都必须能独立验证，并且不要求推翻前一步。

## 2. 文档与真相读取规则

这轮复核发现一个现实：Desktop 根级 current truth 文档并不是“全都旧了”，但不同文档的 freshness 不一致。

例如 `CURRENT_PRODUCT_TRUTH.md` frontmatter 仍写 `last_verified: 2026-07-31`，正文却已经包含 2026-09-06 Forge 状态；而 `forge/FORGE_CURRENT_CONTRACT.md` 已有 2026-09-05 的独立 current contract。Remote Mobile 的 Desktop 文档则明确把 canonical source 指向 Mobile 仓库。

因此 Mira Next 后续施工必须遵守：

```text
current code / config / runtime
  > owning domain current contract
  > root current truth projection
  > planning / historical docs
```

跨仓库协议以明确声明的 canonical owner 为准，不因为 Desktop 有一份镜像文档就形成第二真相。

旧 `docs/project-control/` 总 ledger / workboard 已在本分支归档；新工程不能重新用仓库 prose ledger 复制 GitHub Issue / Project / Organization fields 的职责。

## 3. 已核验的当前基线

### 3.1 Chat 仍然是三条执行路径

当前后端仍然存在：

```text
Normal Chat
RAG Chat
Agent Chat
```

`Thread.agentEnabled` 决定是否进入 Agent；非 Agent 且绑定 Knowledge Base 时进入独立 RAG 路由。

所以“Chat 默认就是 Agent”目前尚未成立。

### 3.2 Pi Loop 已经是应用默认 Runtime

当前主链是：

```text
AgentRun
  → AgentGraph stable facade
  → Pi Loop
  → Planner
  → direct action / governed delegation
  → Harness / Skill-private Runtime
  → Evidence
```

LangGraph 保留为显式兼容和回归对照 Runtime。

Mira Next 不重新发明 Agent 主循环。

### 3.3 Planner 仍依赖模型输出 JSON 文本

`server/src/agent/planner/parse.ts` 仍负责清理 think / code fence、抽取 JSON object candidate、`JSON.parse(...)`，再进入 validation / normalization。

当前 hardening 已经不少，但模型格式错误仍会直接进入运行可靠性问题。


### 3.4 Tool Exposure 当前仍依赖阈值式 ranking

当前 Runtime 仍存在：

```text
public eligible tools <= 20
  → 全部暴露

public eligible tools > 20
  → embedding recall
  → rerank
  → 前 20
```

这属于当前实现事实，不是 Mira Next 的长期 Tool Exposure 设计。

Mira Next 将 Tool Exposure 收敛到 **progressive disclosure**：少量稳定 Core Tool 可直接暴露；上下文相关能力按工作环境启用；大规模动态能力先暴露 namespace / capability summary，再按需展开具体 tool schema。

Embedding / rerank 可以作为某些 search backend 的可选实现，但不再作为 Tool Discovery 的基础前置，也不应成为 Desktop 安装包为了工具路由而必须携带的模型依赖。

### 3.5 已存在 Harness Capability Profile

当前 `HarnessCapabilityProfile` 已把 concrete tools 组织成 Workspace Lookup、Web Research、Browser、Terminal 等能力面。

它回答“怎样发现一组可执行工具”，不等于草案中的一级产品能力分类，也不等于授权模型。

### 3.6 Tool Core 仍被 MCP 命名反向定义一部分

Harness / Registry / Profile 核心类型仍大量使用：

```text
McpToolDefinition
McpCapabilityMetadata
McpInvocationRecord
McpArtifact
```

这不表示内部 Tool 必须由外部 MCP Server 提供，但说明 Tool Core 与 MCP protocol vocabulary 尚未完全解耦。

### 3.7 MicroApp 当前确实有两套不同语义

```text
产品层 MicroApps Hub
!=
Integration MicroAppDefinition
```

前者是宽产品入口；后者是 AccessPoint → business workflow binding contract。

草案中的“长期存在、有 UI、状态、数据、生命周期、可被 Agent 调用的小产品”还不是当前 `MicroAppDefinition`。

### 3.8 Attached Browser / 触界已经是真实能力

公开能力已有：

```text
browser_attached_look
browser_attached_browse
browser_attached_act
browser_attached_transfer
```

所以下一步重点是 Search routing、progressive discovery 与副作用治理，不是再造浏览器入口。

### 3.9 当前审批仍是 invocation-oriented

settled contract 以 frozen invocation 为对象，目标身份是：

```text
toolId + toolCallId + inputHash
```

当前实现仍存在 `toolCallId` 未进入 core grant match 的已知漂移。

reusable capability grant 不能直接覆盖这条债。


### 3.10 Workspace ownership 采用 Thread-owned Workspace

Mira Next 的长期 Workspace 心智固定为：

```text
Thread
  ↓ owns
Workspace
  ├─ user files
  ├─ downloads
  ├─ temp / intermediate outputs
  ├─ scripts
  └─ final artifacts
```

一个 Thread 只拥有一个持续、可恢复、相对隔离的 Workspace。AgentRun 是一次执行，Workspace 是 Thread 持续拥有的施工空间。

如果实现需要 cache、temporary staging、internal metadata 等区域，它们只能作为 Workspace 内部实现细节存在，不再形成与 Workspace 平行的第二套用户可感知根目录语义。

Workspace 的相对隔离不等于 host filesystem 全开放；文件、Terminal、Artifact 与外部 transfer 仍受各自 Policy / Approval / Runtime boundary 约束。

### 3.11 Mobile 已经正式形成双链路

Mobile 当前根合同已经明确：

```text
Remote Host path
+
Local Provider / BYOK path
```

并且已经承认 Mobile 自己存在前台 Agent Loop。与此同时：

- Host 侧持久 AgentRun / Harness / Tool 执行仍由 Host 掌握；
- Mobile Tool Gateway 当前仍以远程执行为主；
- Mobile 不伪造 Host approval / tool result / server state；
- Local Provider Key 留在设备侧，不下发 Host 凭据。

因此“Mobile 有自己的大脑、Desktop 提供环境身体”已经不再只是产品草案，它已有仓库合同基础；真正未完成的是稳定的 Remote Capability 表达与跨端能力边界。

### 3.12 Remote capability discovery 已不是固定 route allowlist

Mobile canonical Remote V1 已明确：能力可用必须同时满足：

```text
Host Gateway method/path → scope mapping
+ device 持有该 scope
+ /remote/v1/manifest 声明 route
+ canonical Host route 继续做 owner/data boundary validation
```

所以未来 Desktop Capability Host 不应另起一套静态能力清单；应演进现有 manifest / scope / canonical route 体系。

### 3.13 Forge 已经是 Mira 内部一级工程域

Forge / 淬行已经并入 Mira Server 和 Desktop，而不是等待未来才整合：

- `server/src/forge/**` 拥有 runtime lifecycle / persistence / dispatch / review；
- Desktop `/forge` 已有产品入口；
- 独立 `:47831` control-plane 不再是产品依赖；
- Repository Task Truth 与 Forge Runtime Truth 被明确分开；
- Dispatch、Builder、Review、Handoff 已形成专业工程流水线。

它现在可以作为“持续工作如何落地”的真实专业样本，但不能被直接抽象成所有 Agent 的通用状态机。

## 4. Mira Next 的目标分层

```text
User / Conversation
        ↓
Agent Runtime
        ↓
Capability Discovery
  “现在能完成什么”
        ↓
Planner Decision
  “下一步做什么”
        ↓
Normalize
  冻结 exact invocation
        ↓
Policy / Approval
        ↓
Execution Adapter
 ├─ Native Tool
 ├─ MCP Adapter
 ├─ Browser Runtime
 ├─ MicroApp Service
 └─ Remote Capability
        ↓
Evidence / Artifact
        ↓
Planner / Generate
        ↓
(optional later) Work Object / Board
```

必须保留：

1. `AgentRun` 继续是 Host Agent 产品运行真相；
2. `Planner → Normalize → Policy → Tool → Evidence → Planner` 不被绕过；
3. capability match / tool search / MicroApp discovery 只能产出候选；
4. Policy 只审批真实 frozen invocation 或未来明确定义的新授权对象；
5. Remote / MicroApp / Browser 不因入口变化绕过副作用治理；
6. Evidence 继续是 Planner 可使用的执行事实入口。

## 5. 三种 Capability 必须分开

### 5.1 Product Capability / CapabilityClass

产品与 Agent 理解层暂用：

```text
行动能力
├─ 感知
├─ 获取
├─ 变更
├─ 执行
└─ 外联
```

它回答 Mira 能做什么，不拥有 Tool id 或审批结果。

### 5.2 HarnessCapabilityProfile

当前对象继续用于：

- 把 concrete tools 组织成可理解能力面；
- Workbench / Tool Search / progressive disclosure；
- preferred / supporting tools。

它不是权限授权对象。

### 5.3 RiskSignature

风险审批使用另一组维度：

```text
side effect
scope
resource / target class
workspace boundary
external transfer
irreversibility
credential use
```

Capability taxonomy 与 Approval taxonomy 分离。

## 6. 工程路线


### Phase 0 — 名词与当前真相锁定

固定：

- `CapabilityClass / HarnessCapabilityProfile / RiskSignature`；
- 一个 Thread 一个 Workspace；
- Agent-facing primitive 的原子性按语义而不是底层实现步骤定义；
- `Tool Core != MCP transport`；
- Platform MicroApp != Integration `MicroAppDefinition`；
- 产品草案只是输入，不是 current contract。

不为了统一术语做全仓重命名，也不把实现细节提升为 Agent-facing contract。

### Phase 1 — Structured Decision Boundary

目标：

```text
Model Provider
  ↓
Planner Decision Adapter
  ↓
typed decision
  ↓
validation / normalization
  ↓
Runtime state transition
```

约束：

- 优先使用 Provider 原生 structured output / tool-call / schema；
- 不假定所有 Provider 同协议；
- text-JSON 保留为显式 compatibility codec；
- 模型不得提交 approval、checkpoint、Evidence authority；
- `AgentNextAction` 保持最小决策对象。

至少覆盖 direct answer / retrieve / concrete tool / ask_user / invalid decision / compatibility provider。


### Phase 2 — Thread-owned Workspace

目标：

```text
Thread
  ↓
Workspace
  ├─ user files
  ├─ downloads
  ├─ temp / intermediate outputs
  ├─ scripts
  └─ final artifacts
```

原则：

- 每个 Thread 拥有一个持续、可恢复、相对隔离的 Workspace；
- Agent 的读取、写入、下载、脚本、中间产物与最终产物共享同一 Workspace ownership；
- Workspace 内部可以有实现级 temporary / staging 区，但不形成第二套平行根目录；
- path generation、lookup/recovery、cleanup、quota、Artifact reference 与 failure semantics 必须有明确合同；
- Workspace 内部自由度不等于 host filesystem 全开放；
- 不顺手放宽 Terminal、Edit、absolute path 或 external transfer 的既有治理边界。

这一步只解决 Workspace ownership 与生命周期，不把 Tool 设计、Artifact protocol 或权限模型混成同一个大包。

### Phase 3 — Chat 收敛到 Agent Runtime

前置：P1 typed decision、P2 Workdir、三条 Chat 行为回归基线。

分三步：

1. 建 Normal / RAG / Agent 行为等价矩阵；
2. 新 Conversation 默认进入 Agent Runtime，同时保留迁移期 compatibility route；
3. 真正稳定后再讨论 `agentEnabled`、独立 RAG route 与 KB thread-binding 的退役。

不删除 Knowledge Base，不把所有任务派 SubAgent。


### Phase 4 — Tool Foundation Hardening + Progressive Disclosure

这一阶段负责硬化 Agent 的工具面，不以“把所有能力都包成 MCP”作为目标。

#### 4.1 Agent-facing primitive：语义原子，而不是机械原子

Agent-facing Tool 的“原子性”按模型决策语义定义：

```text
read
write
edit
glob
grep
read_image

bash
job_list
job_output
job_kill

web_search
web_fetch
```

这是一版目标基线，不要求所有底层实现一一对应独立模块。

例如：

```text
Agent sees: read(path, offset, limit)

Runtime may use:
- native fs
- sandbox file API
- remote filesystem adapter
- shell-backed implementation
```

`bash` 既可以是 Agent-facing primitive，也可以作为其他 primitive 的 execution backend。不能因为某个动作可由 shell 实现，就迫使 Agent 每次通过 shell 重新发明 `read / grep / glob` 的语义、错误、权限与 trace。

Core Tool hardening 至少要固定：

- input / output schema；
- deterministic failure semantics；
- timeout / cancellation；
- truncation / pagination；
- permission / approval boundary；
- cross-platform behavior；
- trace / evidence projection。

#### 4.2 Universal Core 与 Context Core 分层

不是所有常用能力都应永久塞进 Universal Core。

```text
Universal Core
  filesystem primitives
  process execution
  basic web access

Context Core
  activated by current work context
```

Code / Work Workspace 是第一类明确的 Context Core。进入代码工作上下文后，应优先具备：

- Git：status / diff / history / blame / branch / commit 等 repository state；
- Language Intelligence / LSP：definition / references / implementation / symbols；
- diagnostics；
- semantic code search / workspace index；
- code graph / dependency graph infrastructure。

其中 code graph 可以是 LSP、AST、semantic index、static analysis 等多种实现的组合，不要求暴露一个巨大的 `code_graph` 万能接口。Agent-facing surface 应优先保持“查定义、找引用、诊断、代码搜索”等可理解动作。

Context Core 不可用时可以降级到 Universal Core，例如 `grep + read + bash`，但降级不应成为放弃代码语义能力的默认路径。

#### 4.3 Protocol-neutral Tool Core

内部稳定合同保持 protocol-neutral：

```text
Mira Tool Core
  ├─ ToolDefinition
  ├─ ToolInvocation
  ├─ ToolArtifact
  ├─ ToolEvidence
  └─ ToolRuntime

Adapters
  ├─ Native Tool
  ├─ MCP
  ├─ Browser
  ├─ Remote Capability
  └─ Domain Runtime
```

原则：

- 内部 Core 不由 MCP vocabulary 反向定义；
- MCP 是外部扩展 / integration 的优先协议，而不是所有基础工具的内部实现要求；
- Native Core Tool 不需要为了“协议统一”先绕一层 MCP；
- 外部能力如果已经天然适合 MCP，优先接 MCP，不轻易自造第二套插件协议；
- Tool id、approval、trace、Evidence 的治理边界不因 adapter 类型改变。

#### 4.4 Progressive Disclosure 是默认暴露范式

Tool Exposure 从一次性 ranking 演进为逐层展开：

```text
Universal Core
  → eager full schema

Context Core
  → context-activated

Dynamic Domains
  → namespace / capability summary

Relevant Domain
  → tool group / tool metadata

Selected Tool
  → full schema
```

Agent 决定“还需要看什么”，Runtime 负责按治理边界展开，而不是先把整个世界压成一个 top-K 工具列表。

对于大型 MCP server、企业 connector 或未来 MicroApp：

- discovered != exposed；
- exposed != authorized；
- discovery result 永远不是 invocation；
- namespace / tool-group / tool schema 可以多级披露；
- 加载、卸载与 cache 策略属于 Runtime，不改变 Tool 合同。

#### 4.5 Tool Discovery 不再强依赖向量模型

Embedding / rerank 可以继续用于：

- Knowledge retrieval；
- semantic code search；
- 某些超大 catalog 的可选 search backend；
- 其他明确需要语义检索的领域能力。

但它们不再是 Tool Discovery 的基础依赖。

Mira Desktop 不应仅为了 Tool Routing 而强制打包 embedding model、reranker model、对应 tokenizer / runtime 与常驻缓存。Tool Discovery 的最小可行路径可以只依赖：

```text
current context
+ user goal
+ namespace / capability descriptions
+ progressive disclosure
```

如果某一级 catalog 仍然过大，可以再使用 keyword / FTS / model-native tool search / semantic retrieval 等可替换策略，但这些策略不进入核心 Tool contract。

#### 4.6 Benchmark 反哺 Tool Hardening

Agent Core Benchmark 负责暴露 Tool choice、tool competition、recovery、delegation 与 boundary failure 的真实问题；Tool Hardening 根据可重复证据调整工具语义与暴露面。

Benchmark 不规定唯一 Tool trajectory，也不为了方便评分反向绑定某个具体平台工具名。

### Phase 5 — Browser / Search Runtime

不新增和 `web_search` 抢语义的 Chrome Search Tool。

目标：

```text
Search Guide
  ↓
Search Runtime
  ├─ Tavily
  ├─ SearXNG
  └─ Chrome Search
       ↓
  Attached Browser Runtime
```

公开 Search API 负责快速 recall；Attached Browser 负责登录态、站内搜索、正文核验、无 API 页面。

Browser read / observe 尽量低摩擦；submit / send / upload / purchase / destructive action 继续治理。

### Phase 6 — MicroApp Platform V0

先明确：

```text
Legacy Integration MicroApp contract
!=
New MicroApp Platform contract
```

V0 最小 Manifest / Contract：

```text
identity
version
entry / UI
lifecycle
foreground | background | both
data directory
service intents
permission declaration
artifact I/O
health / availability
```

Agent 看到的是 service / intent，而不是微应用内部几十个 Tool。

```text
MicroApp Registry
  ↓
relevant candidate search
  ↓
progressive disclosure
  ↓
Agent
```

V0 不建立 App A → App B 的硬依赖；跨应用协作优先通过 Agent / Work orchestration。

`MicroApp == Plugin System` 继续不定案。

### Phase 7 — Capability Grant / Approval Research

研究：

```text
capability
+ scope
+ target class
+ side-effect boundary
+ credential boundary
+ expiry / session
→ reusable grant
```

但 destructive delete、external publish/send、credential disclosure、payment、broad filesystem escape、remote mutation 等可能仍需 exact confirmation。

前置：先修清当前 exact approval 的 `toolCallId` identity drift。

### Phase 8 — Remote Capability Contract / Mobile

这里不再存在“Mobile 是否允许本地 Agent Runtime”的合同冲突；当前 Mobile 根合同已经接受双链路和 Mobile Agent Loop。

工程目标因此更具体：

```text
Mobile Local Agent
  ↓
Remote Capability Discovery
  ↓
existing Remote manifest + device scopes
  ↓
Desktop Host canonical routes / capability adapter
  ↓
Harness / Domain Runtime
```

关键约束：

1. 不另造一套和 Remote V1 manifest 平行的静态 capability registry；
2. Mobile 只发现 Host 明确发布且 device scope 已批准的能力；
3. Desktop 可以向 Mobile 暴露 product-level capability descriptor，而不泄漏内部 MCP / concrete Tool 结构；
4. Remote 请求最终仍进入 Desktop 自己的 canonical route / Policy / Harness / domain authority；
5. Host approval、tool result、Artifact 与 durable AgentRun 状态不能由 Mobile 伪造；
6. Local Provider credential 与 Host credential 不跨边界搬运；
7. capability protocol 的破坏性变化必须按跨仓库 contract 迁移。

这是一项跨仓库工程，但已有协议地基，不需要从零设计 Remote Host。

### Phase 9 — Work Object / Board / Forge Reference

持续工作不能永远只埋在 Conversation History。

未来先研究薄 Work Object：

```text
Work Object
├─ goal / title
├─ owner / agent
├─ status
├─ source conversation
├─ artifacts
├─ pending user action
└─ timestamps
```

Forge / 淬行已经是真实的专业化流水线样本：

```text
工作对象
→ 状态流转
→ Agent / 能力接力
→ 产物 / Handoff
```

但不把 Builder、SHA Review、Branch、Repository Task、工程 Handoff 强行提升为所有 Agent 的通用合同。

## 7. 明确不进入这一轮主工程

- Memory / Context / Insight：单独讨论数据来源、隐私、主动性、纠错和生命周期；
- Agent Factory：用户自定义 Agent Definition 不阻塞默认 Agent；
- LangGraph 立即删除：等确认无 consumer 且回归已有替代；
- 通用 Plugin System 命名；
- 通用 BPMN / Workflow Engine。


## 8. 依赖图

```text
P0 Terminology / Truth
      ↓
P1 Structured Decision Boundary
      ↓
P2 Thread-owned Workspace
      ↓
P3 Chat → Agent Runtime
      ↓
P4 Tool Foundation Hardening
   ├─ Universal Core
   ├─ Code / Work Context Core
   ├─ protocol-neutral Tool Core
   └─ progressive disclosure
      ├──────────────→ P5 Browser / Search
      ↓
P6 MicroApp Platform V0
      ↓
P8 Remote Capability / Mobile

P7 Approval Research
  ├─ 可在 P2 后启动调研
  └─ 在 MicroApp / Remote 高权限开放前完成对应合同

P9 Work Object / Board
  └─ 不阻塞 P1-P6
```

MCP 属于 P4 之后的外部扩展优先协议，不是 P4 之前的基础工具前置；Code / Work Context Core 也不依赖 MCP 才能成立。


## 9. 工程推进约束

Mira Next 的长期设计稿不维护“当前第一批 / 下一批任务”或具体版本的阶段性修复记录；这些状态由 GitHub Issue / Project 持有。

工程推进只保留以下长期约束：

1. 先通过 Benchmark、current truth 与可重复 Runtime evidence 看见真实问题，再硬化 Tool contract；
2. Universal Core 的新增必须证明它是跨任务高频、低语义、可组合的 Agent primitive；
3. Context Core 的新增必须有明确上下文触发条件和降级路径；
4. Dynamic Tool 默认走 progressive disclosure，不把完整 catalog 一次性塞给 Planner；
5. MCP 优先解决外部扩展与互操作，不反向决定 Mira 内部基础工具颗粒度；
6. 为 Tool Discovery 增加 heavyweight retrieval infrastructure 前，必须证明简单分层披露不足；
7. 任何 Tool 设计变化都要保护 Policy / Approval / Evidence / trace 边界。

## 10. 后续每个 Work Item 必须回答

1. 它改哪一层：Product Capability、Discovery、Tool Core、Policy、MicroApp、Remote 还是 Work Object？
2. 它保留哪些 current contract？
3. 它明确替代什么真实 consumer / path？
4. 用什么证据证明完成？
5. 什么明确没有做？

新的工程 Work Item 进入 GitHub Issue；不恢复 repository-local master ledger。


## 11. 长期设计结论

Mira Next 的稳定方向是：

- Pi Loop 和现有 Agent execution contract 继续作为运行地基；
- Structured Decision 收敛模型输出进入 Runtime 的边界；
- 一个 Thread 一个 Workspace，Workspace 是持续施工空间；
- Chat 逐步收敛到 Agent Runtime，但不以一次性删除旧路径为目标；
- Agent-facing primitive 按语义原子设计，不按底层执行步骤拆分；
- Universal Core 保持少量、稳定、可组合；
- Code / Work 等高价值工作上下文拥有自己的 Context Core，例如 Git、Language Intelligence、diagnostics 与 code search；
- Tool Exposure 默认采用 progressive disclosure；
- Embedding / rerank 是可选检索实现，不再是 Tool Discovery 或 Desktop 打包的必需依赖；
- Mira 内部 Tool Core 保持 protocol-neutral，MCP 作为外部扩展 / integration 的优先协议；
- Browser / Search、MicroApp、Remote Capability 都通过同一套 Tool / Policy / Evidence 治理边界接入；
- capability discovery 只能决定“看见什么候选”，不能直接获得 invocation authority；
- Forge 继续作为专业持续工作流水线样本，只抽取被多个真实领域证明需要的通用对象。

目标不是让 Mira 多长几层名词，而是让 Agent 在恰当的时刻看见恰当的工具面，并让这些能力通过少量稳定合同协作。

> **少量稳定核心，按上下文增强，按需披露外部世界；发现不等于授权，协议不反向绑架内部设计。**
