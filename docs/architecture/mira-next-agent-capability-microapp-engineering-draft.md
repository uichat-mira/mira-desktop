---
status: planned
owner: architecture / agent-runtime / harness / microapp
last_verified: 2026-09-16
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
> 本稿核对基线：`mira-desktop dev@0e313cf4f2f1ffc791c47334f90439e1e25b077e`；Mobile 当前合同读取自 `mira-mobile@dev`；Organization AI policy revision `2026-09-16.2`。

产品草案来源：

- https://mira.tomz.io/blogs/product-journal/mira-next-draft-01-agent-tools-external-world
- https://mira.tomz.io/blogs/product-journal/mira-next-draft-02-capabilities-microapps-agent-work

## 1. 这次真正要解决什么

两篇草案讨论了 Chat 默认 Agent、Pi Loop、Structured Action、Tool discovery、触界、MCP、Conversation Workspace、Capability、MicroApp、Mobile、审批、看板、Forge、Memory 与 Insight。

如果直接把这些画成一张“大架构图”，会混淆三类东西：

1. 已经稳定并应保护的合同；
2. 已经存在但语义位置不对的实现；
3. 仍然只是产品方向、不能提前钉死的开放问题。

因此 Mira Next 不作为一次 V2 rewrite 推进，而是一条可独立验证的迁移链：

```text
先锁定当前真相与概念边界
  ↓
先让模型决策进入 Runtime 的边界可靠
  ↓
给默认 Agent Conversation 正确的工作目录语义
  ↓
再把 Chat 收敛到 Agent Runtime
  ↓
再解耦 Tool Core / MCP，并升级能力发现
  ↓
Browser / Search 形成基础外部世界能力
  ↓
MicroApp 成为真正的平台对象
  ↓
Remote Capability 对齐 Desktop / Mobile 已有协议
  ↓
最后再讨论通用持续工作对象与看板
```

第一原则是：

> 每一步都能独立验证，并且不需要推翻前一步。

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

### 3.4 Tool Exposure 仍以 20 个为阈值

```text
public eligible tools <= 20
  → 全部暴露

public eligible tools > 20
  → embedding recall
  → rerank
  → 前 20
```

`Core Tools + Deferred Catalog + Tool Search` 仍是目标，不是当前运行真相。

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

### 3.10 当前 ChatWorkspace 不是 Conversation Workdir

`ChatWorkspace` 是用户显式工作区，绑定持久 rootPath；Agent Thread 当前必须有 Workspace，没有显式选择时会复用或创建 `Mira BASE`。

这和“一条 Conversation 自己天然拥有的小目录”不是同一个对象。

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
- `ChatWorkspace != Conversation Workdir`；
- `Tool Core != MCP transport`；
- Platform MicroApp != Integration `MicroAppDefinition`；
- 产品草案只是输入，不是 current contract。

不改 Runtime。

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

### Phase 2 — Conversation Workdir

引入独立于 `ChatWorkspace` 的 Conversation Workdir：

```text
Thread / AgentRun
  ↓
Conversation Workdir
  ├─ user files
  ├─ downloads
  ├─ temp outputs
  ├─ scripts
  └─ final artifacts
```

原则：

- 每条 Agent Conversation 可天然拥有自己的目录；
- 不是用户必须创建的 Project；
- `ChatWorkspace` 继续表达用户显式工程根；
- Workdir 内部自由度不等于 host filesystem 全开放；
- 生命周期、清理、容量、Artifact 引用必须有合同。

这一步涉及文件权限边界，不能顺手放宽 Terminal 或任意绝对路径。

### Phase 3 — Chat 收敛到 Agent Runtime

前置：P1 typed decision、P2 Workdir、三条 Chat 行为回归基线。

分三步：

1. 建 Normal / RAG / Agent 行为等价矩阵；
2. 新 Conversation 默认进入 Agent Runtime，同时保留迁移期 compatibility route；
3. 真正稳定后再讨论 `agentEnabled`、独立 RAG route 与 KB thread-binding 的退役。

不删除 Knowledge Base，不把所有任务派 SubAgent。

### Phase 4 — Tool Core / MCP 解耦 + Deferred Discovery

目标结构：

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
  └─ domain runtime
```

原则：先抽核心类型 / alias / adapter，不以全仓重命名证明完成，不改变 Tool id、approval、trace、Evidence。

Discovery 从：

```text
>20 → embedding / rerank → top 20
```

演进为：

```text
Core Tools
+ Deferred Capability Catalog
+ Tool Search
+ progressive disclosure
```

Embedding / rerank 可以继续作为搜索后端；discovery result 永远不是 invocation。

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
P2 Conversation Workdir
      ↓
P3 Chat → Agent Runtime
      ↓
P4 Tool Core / MCP + Deferred Discovery
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

## 9. 第一批工程包

### Main — E01 Structured Decision Boundary

目标：

> 在不改变 AgentRun、Normalize、Policy、Tool、Evidence 既有合同的前提下，把 Planner provider output decoding 收敛到单一 typed decision adapter，并保留显式 compatibility codec。

这是最适合先施工的包：范围窄、不先改 Chat 产品行为，又直接为默认 Agent 稳定性打地基。

### Candidate — E02 Conversation Workdir Design + Storage Contract

目标：

> 定义并验证 Conversation Workdir 与 ChatWorkspace 的不同所有权、路径、生命周期、Artifact 引用与清理合同，为默认 Agent Conversation 提供可控执行空间。

先做 storage/path/ownership contract，不顺手放宽权限。

### Blocked — E03 Chat Default Agent

只有 E01 / E02 的必要合同成立后才开 route convergence。

不能采用“先把所有 Chat 切 Agent，再在线补 Agent 稳定性与文件权限”的施工顺序。

## 10. 后续每个 Work Item 必须回答

1. 它改哪一层：Product Capability、Discovery、Tool Core、Policy、MicroApp、Remote 还是 Work Object？
2. 它保留哪些 current contract？
3. 它明确替代什么真实 consumer / path？
4. 用什么证据证明完成？
5. 什么明确没有做？

新的工程 Work Item 进入 GitHub Issue；不恢复 repository-local master ledger。

## 11. 当前结论

两篇 Mira Next 草案可以进入工程阶段，但不是作为一个“大重构”。

当前判断：

- Pi Loop 和现有 Agent execution contract 是地基；
- Structured Decision 是默认 Agent 前最值得先处理的可靠性边界；
- Conversation Workdir 必须与 ChatWorkspace 分开；
- Chat → Agent 是明确目标，但必须做行为等价迁移；
- Tool / MCP 解耦有真实代码依据，应渐进迁移；
- Deferred Tool Search 应替代 embedding 作为唯一候选裁判，但永远不能直接获得 invocation authority；
- 触界已经足够真实，下一步是进入 Search Runtime；
- MicroApp 平台方向成立，但必须与当前 Integration MicroApp contract 分开；
- reusable capability approval 先研究并修清 exact approval identity；
- Mobile 双链路与本地 Agent 已成为当前合同事实，Remote Capability 应建立在现有 manifest + scope 上，而不是重做 Remote Host；
- Forge 已经是 Mira 内的真实专业流水线样本，未来只抽取被其他领域真正证明需要的通用 Work Object，而不是先造通用工作流引擎。

目标不是让 Mira 多长几层名词。

> 是把已经存在的 Agent、Tool、Browser、MCP、MicroApp、Mobile 和 Forge 放回各自负责的位置，并让它们通过少量稳定合同协作。
