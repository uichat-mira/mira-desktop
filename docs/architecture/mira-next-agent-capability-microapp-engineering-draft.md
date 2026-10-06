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

当前 `HarnessCapabilityProfile` 已把 concrete tools 组织成 Workspace Lookup、Web Research、Browser、Terminal 等能力面。其中 **Web Research 是当前实现命名**；Mira Next 的目标 Capability 合同将其收口为更中性的 `web`，避免把多轮研究编排误塞进基础 Web 访问语义。

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

### 3.9 当前 Authorization 仍以 invocation approval 为核心

当前 settled contract 仍以 frozen invocation 为主要授权对象，目标身份是：

```text
toolId + toolCallId + inputHash
```

当前实现仍存在 `toolCallId` 未进入 core grant match 的已知漂移。

因此当前 Mira 还不能视为拥有完整的 Authorization Core：它已经有 Tool risk metadata、Policy gate、用户 Approval、Runtime boundary 与若干 domain ownership 检查，但这些机制仍以“一次 invocation 是否允许执行”为中心。

Mira Next 的目标不是删除 exact approval，而是把它纳入更大的授权模型：

> **Approval 是产生或确认 authority 的一种方式，不等同于 Permission / Authorization 本身。**

reusable / derived authority 不能直接覆盖当前 exact approval identity 的债；这由 Phase 7 Authorization Core 继续研究。


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
Authorization Core
  ├─ Policy
  ├─ Ownership
  ├─ Exact Approval
  ├─ Derived Authority
  └─ Reusable Grant
        ↓
Authorization Decision
  allow / ask / deny
  + authority source
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
2. `Planner → Normalize → Authorization Core → Tool → Evidence → Planner` 不被绕过；
3. capability match / tool search / MicroApp discovery 只能产出候选；
4. Authorization Core 是唯一副作用授权入口；Approval 只是其中一种 authority source，不与 Permission / Grant 混为一谈；
5. exact frozen invocation、未来明确定义的 derived authority / reusable grant 都必须经过同一 Authorization Core 判定；
6. Remote / MicroApp / Browser 不因入口变化绕过 ownership、Policy 或副作用治理；
7. Evidence 继续是 Planner 可使用的执行事实入口，并应能够解释一次执行为何被 allow / ask / deny。

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
  web
    -> web_search
    -> web_fetch

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

Universal Web 的 Capability 合同固定为：

```text
web
  -> web_search
  -> web_fetch
```

这里的 `web` 表示**访问公开 Web 信息**，不是一个自动研究工作流：

- 来源 / URL 尚未知时，披露并使用 `web_search` 做公开来源发现；
- 已知具体公开 URL 时，披露并使用 `web_fetch` 获取与提取内容；
- `news_search` 仍属于本地 News Hub，不与公开 Web 访问混同；
- 登录态、点击、表单、交互和必须由浏览器渲染的页面继续属于 Browser capability family；
- 多轮检索策略、交叉验证、来源综合、深度研究属于 Search Guide / Skill / Planner orchestration，可消费 `web`，但不进入 `web` Capability 本身。

渐进式披露应先判断 `web` 是否相关且当前 Runtime 是否可用，再披露具体 Tool facade；Capability 名称本身不得暗示默认选择 `web_search`。

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

#### 4.7 探索型能力必须 POC-first

Phase 4 中凡是仍涉及架构取舍、产品心智或能力边界的事项，不得直接从设计草案跳到生产实现。

典型对象包括：

- Context Core 如何被识别与激活；
- Git / LSP / diagnostics / semantic code search / code graph 如何组合成 Code / Work 能力面；
- 大规模 Tool / MCP catalog 如何做 progressive disclosure；
- namespace、tool group、schema resolver、model-native tool search 等发现机制如何取舍；
- 工程验收 UI 与最终产品 UI 的边界。

这类事项统一采用：

```text
Community / vendor research
  ↓
isolated POC
  ↓
representative task evidence
  ↓
maintainer discussion / decision
  ↓
freeze contract
  ↓
open implementation work item
```

POC 的职责是暴露事实、成本、失败模式与可选方案，不拥有最终产品或架构决定。不得因为某个 POC 已经能运行，就把其内部形状直接提升为 production contract。

社区 / 厂商 POC 至少应比较两个以上真实实现或公开方案，并优先选择可直接验证的开源代码、官方文档与可运行样例。需要比较的证据包括：

- Agent-facing tool surface；
- schema / context cost；
- discovery / disclosure path；
- degraded / unavailable behavior；
- latency / cache / token impact（可测时）；
- permission / approval boundary；
- 对现有 Mira Benchmark representative cases 的影响。

涉及产品心智、长期架构或新的用户可见交互时，POC 结束后必须回到维护者讨论；未经明确决策，不得继续开生产实现或以“先做出来再说”冻结方向。

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

### Phase 7 — Authorization Core / Approval & Grant Research

这一阶段不是“给某个 Tool 加一个 Allow always”或“减少几次确认框”，而是把 Mira 从当前的 **Invocation Approval Gate** 演进为真正的 **Authorization Core**。

目标不是把所有权限都统一成一个超级 DSL，而是建立少量稳定授权概念，让 Agent、Tool、Terminal、Browser、MicroApp、Remote / Mobile 在同一个 authority model 下回答：

> **谁，在什么上下文里，能对哪个真实资源执行什么动作，依据什么 authority，为什么现在允许 / 询问 / 拒绝？**

目标抽象：

```text
Subject
  user / thread / agent / device
        ↓
Resource / Target
  workspace / file / terminal-session / browser-session
  microapp / remote-host / external-target / credential
        ↓
Operation
  observe / read / execute / mutate / send / publish / stop
        ↓
Context + RiskSignature
  workspace / run / thread / device
  side-effect / irreversibility / credential / external transfer
        ↓
Authorization Core
  ├─ hard deny / ownership validation
  ├─ baseline policy
  ├─ exact approval
  ├─ derived resource authority
  └─ reusable grant
        ↓
Authorization Decision
  allow / ask / deny
  + authority source
        ↓
Runtime
```

这里必须明确：

- **Capability** 回答“有什么能力 / 当前应该暴露什么”；
- **Tool** 回答“模型具体调用什么动作”；
- **RiskSignature** 描述这次动作的风险输入；
- **Policy** 决定规则；
- **Ownership** 决定 subject 是否有资格控制目标 resource；
- **Approval** 是用户对具体请求作出授权决定的交互；
- **Grant / Derived Authority** 是已经存在、可复用或资源绑定的 authority；
- **Authorization Decision** 才是 Runtime 是否可以执行的最终治理结果。

因此 Approval ≠ Permission，Capability ≠ Grant，Tool visibility ≠ Authority。

当前方向继续保持：

```text
capability
+ scope
+ target class
+ side-effect boundary
+ credential boundary
+ expiry / session
→ governed grant
```

但这里的 `grant` 不能先验等同于“Capability 被永久授权”。Capability taxonomy 与 Approval taxonomy 仍然分离；真正需要研究的是：

> 除了 frozen exact invocation，Mira 还需要哪些一等、可验证、可撤销、有限作用域的授权对象？

#### 7.1 当前 Mira 真相：Approval 仍是 invocation-oriented

当前 canonical Approval 的核心仍是一次冻结调用：

```text
toolId
+ toolCallId
+ inputHash
→ exact invocation approval
```

当前实现中，core grant match 主要仍按 `toolId + inputHash` 消费，`toolCallId` identity 尚未完全进入 grant match；这属于已知 implementation drift，不能被 reusable grant 设计顺手掩盖。

因此 P7 的硬前置仍然是：

1. 先把 exact approval 的 identity / one-shot consumption 语义修清；
2. 再在同一个 Policy / Approval authority 中增加新的授权对象；
3. 不允许通过 Prompt、Tool 描述、sessionId bearer token 或另起一套 runtime 绕过现有 Policy。

P7 不是第二套权限系统。

#### 7.2 Terminal 是第一个 reference case，但不是 P7 owner

#236 暴露了第一个足够具体的产品痛点：

```text
用户批准启动 persistent process
        ↓
Continue output
Status
Stop
        ↓
每一步仍按新的 terminal invocation 再次审批
```

当前 exact approval 只能看见“这些 invocation 的参数不同”，看不见：

> Continue / Status / Stop 实际上是同一个已批准进程的生命周期操作。

这说明需要研究 **derived authority**，而不是给 Terminal 写特例。

更一般地，未来同一问题会出现在：

- persistent Terminal process；
- attached Browser session；
- MicroApp background service；
- Remote / Mobile capability；
- 已授权的外部资源或工作对象。

因此 Terminal 应作为 P7 的第一道 reference case，用来验证通用授权模型，而不是产生一个 Terminal-only Approval subsystem。

#### 7.3 社区实现对比：不要只抄 “Allow always”

2026-10 调研至少比较了 Codex、OpenCode 与 Gemini CLI。

**OpenCode**

OpenCode 将 Permission 建模为：

```text
action
+ resource
→ allow | ask | deny
```

用户可以选择 Allow once 或 Allow always；后者把 Tool 提议的 pattern 保存为后续规则，例如：

```text
shell: git status * → allow
```

其优点是简单、可配置，适合重复执行同一类未来命令；缺点是它本质上是 **pattern-based future action grant**，对“已经存在的这个具体进程”过宽。

参考：

- https://opencode.ai/v2/docs/permissions
- https://opencode.ai/v2/docs/policies/

**Gemini CLI**

Gemini CLI 继续以 shell command confirmation / policy rule 为主，但已经把 background shell 作为独立生命周期对象管理：

- background process 可持续存在；
- `/shells` 可查看和管理长任务；
- UI 可查看日志并 kill background shell；
- shell policy 可按 commandPrefix / commandRegex / allow-deny-ask 治理。

这说明成熟实现已经开始把“启动命令”与“管理已存在的后台执行”区分开，但其主授权模型仍然偏 command-centric。

参考：

- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/tutorials/shell-commands.md
- https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md

**Codex**

Codex 当前实现更接近 Mira P7 的目标：

- 长进程 entry 会保留启动时的 permission context；
- 对 existing terminal 的空输入 poll / 观察，不等同于再次执行新命令；
- 对已有终端写入 stdin，会依据 retained launch permissions 与 **当前 Policy** 再判断是否需要 review；
- Policy / sandbox 发生 drift 时，不假装旧进程自动获得新限制；必要时要求新开 terminal；
- 已存在进程的后续控制仍围绕同一个 process identity，而不是把一次 approval 扩大成全局 Terminal trust。

参考源码：

- https://github.com/openai/codex/blob/main/codex-rs/core/src/unified_exec/stdin_approval.rs
- https://github.com/openai/codex/blob/main/codex-rs/core/src/unified_exec/process_state.rs

P7 应吸收的不是 Codex 的具体类型，而是原则：

> **retain launch authority, bind it to the real resource, and re-evaluate only when the follow-up operation can widen or reuse side-effect authority.**

#### 7.4 候选授权对象：Exact、Derived、Reusable 必须分开

P7 至少要区分三种不同语义，不要全部塞回 `approvedInvocations[]`：

```text
Exact Invocation Approval
  用户批准这一次 frozen invocation

Derived Resource Authority
  某次已批准动作创建了真实 resource，
  Host 派生出仅适用于该 resource 生命周期的有限操作权

Reusable Rule / Grant
  用户明确允许未来一类 action + resource pattern
```

例如：

```text
Exact:
  terminal(command="pnpm dev", cwd="app", sessionMode="persistent")

Derived:
  terminal-session:<sessionId>
    observe-output
    inspect-status
    stop

Reusable:
  shell "git status *"
  read "~/trusted-reference/*"
```

三者来源、审计语义、撤销方式和风险都不同。

尤其不能把 Derived Resource Authority 伪装成旧的 exact approval，因为那会让未来 Trace / Evidence 无法回答：

> 这次为什么没有再次询问用户？

#### 7.5 Terminal reference contract：生命周期权限不等于新执行权限

P7 的第一版 reference contract 可研究：

| Terminal 后续动作 | 默认授权方向 | 原因 |
| --- | --- | --- |
| continue / observe buffered output | derived allow | 只观察已批准进程 |
| inspect status | derived allow | 只观察生命周期 |
| stop process tree | derived allow | 收缩 / 终止已批准副作用 |
| interrupt / cancel | derived allow 候选 | 通常属于收缩副作用 |
| new command on existing PTY | exact / re-review | 执行了新的代码或副作用 |
| arbitrary stdin | re-evaluate | 可能等价于新命令或新外部行为 |
| restart | exact approval | 新进程 |
| changed cwd / env / credential context | exact / re-review | execution authority 发生变化 |
| control another owner's session | hard deny | 不是补一次 approval 可以修复的 ownership 问题 |

因此“批准 persistent Terminal”不应推导出：

```text
terminal:* = allow
```

而应更接近：

```text
subject:
  user / thread

resource:
  terminal-session:<id>

derived operations:
  observe
  status
  stop

source:
  launch approval / invocation
```

#### 7.6 Resource ownership 是 reusable / derived grant 的硬前置

当前 Mira Terminal 已有稳定 `sessionId`，但当前 `TerminalSessionRecord` 主要保存：

- command / cwd / shell；
- runtime / process-tree metadata；
- createdAt；
- PTY process。

它还不是完整的授权资源记录；当前没有把 `userId / threadId / launchInvocationId / launch authority snapshot` 作为 Terminal session ownership contract。

因此在 P7 之前不能把：

```text
knows sessionId
→ may control session
```

当成授权模型。

否则随机 `sessionId` 会事实上退化成 bearer token。

P7 应先定义 resource ownership 至少需要哪些 Host-owned identity：

```text
resourceId
owner user
origin thread / run where relevant
launch invocation identity
authority snapshot / fingerprint
resource lifecycle state
```

具体字段名不在本工程稿冻结；这里冻结的是 **resource-bound grant 必须基于真实 ownership，而不是只基于 opaque id**。

#### 7.7 Scope 不应只有一种：Agent authority 与 Human owner control 可不同

Thread-owned Workspace 已经确立，但授权 scope 不能机械地全部等于 thread。

需要研究至少：

```text
user
thread
workspace
run
device
resource
credential
external target
```

一个重要候选规则是：

```text
Agent derived authority:
  user + thread + resource scoped

Human owner control:
  user + resource scoped
```

例如 Agent 不应在新 Thread 自动继承旧 Thread 的 Terminal 控制权；但用户自己的后台任务管理 UI 应仍能 Stop 自己启动的失控进程。

这类差异应由 Policy / ownership contract 表达，不要靠 UI 特判。

#### 7.8 Policy drift：旧资源不会因为新 Policy 自动变安全

Derived authority 必须考虑启动后的 Policy 变化。

例如一个 Terminal session 启动时拥有 network + workspace write，而用户随后把 Policy 收紧为 read-only / no-network：

- observe / status / stop 可以继续基于 resource lifecycle authority；
- 向旧进程注入新的 command / stdin 时必须重新比较 current Policy 与 launch authority；
- 如果当前限制无法 retroactively 施加到已有资源，不应通过一次新 approval 假装旧进程已经符合新 sandbox；
- 必要时应要求创建一个符合当前 Policy 的新 resource。

这一原则应推广到 Browser、Remote、MicroApp background service，而不是 Terminal 独有。

#### 7.9 Grant 不能覆盖 hard deny，也不能形成第二个 authority source

候选 Policy 顺序应保持单一治理入口，概念上接近：

```text
hard deny / ownership validation
        ↓
exact invocation approval
        ↓
derived resource authority
        ↓
reusable rule / grant
        ↓
ask user
```

具体优先级仍需 P7 研究验证，但至少必须满足：

- configured / organization hard deny 不能被 reusable grant 覆盖；
- ownership failure 不能通过“再问一次用户”变成允许；
- derived grant 不能创造原 resource 没有的能力；
- Prompt / Agent memory / Skill 文本不能成为 grant；
- Remote client 不能自行声明 Host grant；
- 所有 allow 路径仍由 canonical Policy 决定。

#### 7.10 生命周期、撤销与持久化要按授权对象分别设计

不要把所有 grant 都做成同一种 TTL。

**Derived Resource Authority**

资源本身就是天然生命周期：

```text
resource created
  ↓
derived authority active
  ↓
resource exit / stop / revoke / cleanup
  ↓
derived authority disappears
```

如果 process 不跨 Host restart 存活，其 derived grant 也没有理由单独跨 restart 存活。

**Reusable Grant**

才需要单独研究：

- current session；
- thread；
- workspace / project；
- explicit expiry；
- durable user setting；
- revoke / inspect UI。

不要为了统一而给 process lifecycle grant 强塞一个“30 分钟 TTL”。

#### 7.11 Trace / Evidence 必须解释“为什么这次没有再问”

P7 不是只改弹窗体验。

对任何非 exact approval 的自动放行，Trace / Evidence 至少应能够投影：

```text
authorization kind
source approval / grant
subject
resource / target
allowed operation
scope
policy evaluation result
expiry / lifecycle
revocation state where relevant
```

否则未来无法区分：

- Tool 本来就低风险；
- 用户 exact 批准；
- 命中 reusable rule；
- 命中 derived resource authority；
- Policy 配置直接 allow。

授权可解释性本身是审计合同。

#### 7.12 P7 的 reference cases 不应只测 Terminal

Terminal 是第一道题，但 P7 至少应使用以下代表性案例检查模型是否真的通用：

1. **Terminal persistent process**
   - start exact approval；
   - observe/status/stop derived；
   - new command re-review；
   - ownership mismatch deny；
   - Policy drift。

2. **Attached Browser session**
   - observe 低摩擦；
   - navigation / act 依据 target 和 side-effect 重新判断；
   - submit / upload / purchase 不因 session 已批准而自动放行。

3. **MicroApp background service**
   - service lifecycle 与 service intent 分离；
   - background existence 不代表 mutation / external send 被持续授权。

4. **Remote / Mobile**
   - paired device / capability scope 是前置身份与连接权限，不等于具体 Host mutation grant；
   - Mobile 不可伪造 Host approval、resource ownership 或 derived grant。

5. **External mutation / credential-bearing action**
   - publish/send/payment/credential disclosure 等即使有 reusable grant，也可能继续要求 exact confirmation。

#### 7.13 研究门槛与明确非目标

P7 在进入 production implementation 前至少回答：

1. exact approval 的 `toolCallId` identity drift 是否已修清；
2. Mira 的授权对象 taxonomy 是什么；
3. resource ownership 的 canonical owner 在哪里；
4. derived authority 如何与 current Policy / Policy drift 比较；
5. 哪些操作属于 observation / lifecycle reduction，哪些属于新 side effect；
6. grant scope 如何表达 user / thread / workspace / resource / device / credential；
7. grant 如何 revoke / expire / inspect；
8. Trace / Evidence 如何解释自动 allow；
9. Agent、MicroApp、Remote 是否都走同一个 Policy authority；
10. 哪些高风险操作永远或默认继续 exact confirmation。

明确不做：

- 不做全局 `Terminal approved forever`；
- 不把 opaque sessionId 当 bearer authorization；
- 不用 shell command parser 反向定义所有资源权限；
- 不让 saved grant 覆盖 hard deny；
- 不因为 Capability 被发现 / exposed 就获得 authority；
- 不把 P7 变成第二套 Harness 或第二套 Policy runtime。

destructive delete、external publish/send、credential disclosure、payment、broad filesystem escape、remote mutation 等高风险动作，即使未来存在 reusable grant，也可能继续要求 exact confirmation。

P7 可在 P2 后开始调研，但在 MicroApp / Remote 高权限能力开放前，应完成对应的 reusable / derived authority 合同。

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

P7 Authorization Core
  ├─ 可在 P2 后启动研究与 contract hardening
  ├─ Terminal / Browser 作为首批 resource-bound reference cases
  └─ 在 MicroApp / Remote 高权限开放前完成对应 authority contract

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
7. 任何 Tool 设计变化都要保护 Authorization Core / Policy / Approval / Evidence / Trace 边界，不得把 Tool metadata、Prompt 或 Runtime 特例升级成第二套权限系统。

## 10. 后续每个 Work Item 必须回答

1. 它改哪一层：Product Capability、Discovery、Tool Core、Authorization Core、MicroApp、Remote 还是 Work Object？
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
- Browser / Search、MicroApp、Remote Capability 都通过同一套 Tool / Authorization Core / Evidence 治理边界接入；
- Mira Next 将当前 invocation-oriented Approval Gate 演进为 Authorization Core：统一表达 subject、resource、operation、scope、risk、ownership 与 authority source；
- exact approval 继续保留，但只是 authority source 之一；derived resource authority 与 reusable grant 只能在同一 canonical Authorization Core 中生效；
- capability discovery 只能决定“看见什么候选”，不能直接获得任何 invocation / resource authority；
- Forge 继续作为专业持续工作流水线样本，只抽取被多个真实领域证明需要的通用对象。

目标不是让 Mira 多长几层名词，而是让 Agent 在恰当的时刻看见恰当的工具面，并让这些能力通过少量稳定合同协作。

> **少量稳定核心，按上下文增强，按需披露外部世界；发现不等于授权，协议不反向绑架内部设计。**
