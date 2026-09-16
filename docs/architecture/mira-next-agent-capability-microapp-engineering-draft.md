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
  - ../CHAT_CURRENT_TRUTH.md
  - ../AGENT_CURRENT_TRUTH.md
  - ../TOOL_CURRENT_TRUTH.md
  - ../MICROAPP_CURRENT_TRUTH.md
  - ../harness/agentgraph-harness-protocol.md
  - ../knowledge-system/DOCUMENTATION_STANDARDS.md
---

# Mira Next 工程稿：Agent、Capability、MicroApp 与外部世界

> 本文把 2026-09-02 与 2026-09-08 两篇 Mira Next 产品草案收敛为可施工的工程路线。
>
> 它是 **Planning / engineering draft**，不是 Current Truth，不覆盖现有 canonical contract，也不授权一次性重写 Agent、Tool、MicroApp、Mobile 或 Forge。
>
> 本稿核对基线：`mira-desktop dev@0e313cf4f2f1ffc791c47334f90439e1e25b077e`；Organization AI policy revision `2026-09-16.2`。

产品草案来源：

- https://mira.tomz.io/blogs/product-journal/mira-next-draft-01-agent-tools-external-world
- https://mira.tomz.io/blogs/product-journal/mira-next-draft-02-capabilities-microapps-agent-work

## 1. 这次真正要解决什么

两篇草案讨论了很多东西：Chat 默认 Agent、Pi Loop、Structured Action、Tool discovery、触界、MCP、Conversation Workspace、Capability、MicroApp、Mobile、审批、看板、Forge、Memory 与 Insight。

如果把这些直接写成一张“大架构图”，工程上会立刻出现两个问题：

1. 已经稳定的合同和真正需要重构的地方会混在一起；
2. 尚未定案的问题会因为进入 Schema 或类型名而被提前钉死。

所以 Mira Next 不作为一次 V2 rewrite 推进，而拆成一条有依赖关系的迁移链：

```text
先澄清概念与运行真相
  ↓
先把模型决策边界变可靠
  ↓
给默认 Agent Conversation 一个正确的工作空间语义
  ↓
再把 Chat 收敛到 Agent Runtime
  ↓
再解耦 Tool Core / MCP，并升级能力发现
  ↓
Browser / Search 形成基础外部世界能力
  ↓
MicroApp 成为真正的平台对象
  ↓
Remote Capability / Mobile 接入稳定合同
  ↓
最后再讨论持续工作对象、看板与 Forge 泛化
```

第一原则不是“架构漂亮”，而是：

> 每一步都能独立验证，并且不需要推翻前一步。

## 2. 已核验的当前基线

以下不是草案判断，而是当前 `dev` 已存在的现实或当前 canonical contract。

### 2.1 Chat 仍然是三条执行路径

当前后端仍然存在：

```text
Normal Chat
RAG Chat
Agent Chat
```

`Thread.agentEnabled` 决定是否进入 Agent；非 Agent 且绑定 Knowledge Base 时进入独立 RAG 路由。

因此“Chat 默认就是 Agent”目前尚未成立。

### 2.2 Pi Loop 已经是应用默认 Runtime

当前应用默认：

```text
AgentRun
  → AgentGraph stable facade
  → Pi Loop
  → Planner
  → direct action / governed delegation
  → Harness / Skill-private Runtime
  → Evidence
```

LangGraph 仍作为兼容、历史回归和显式对照 Runtime 存在。

因此 Mira Next **不需要重新发明 Agent 主循环**。要做的是继续减少历史双真相，而不是另建一条 V2 Graph。

### 2.3 Planner 仍依赖模型输出 JSON 文本

`server/src/agent/planner/parse.ts` 当前仍然会：

- 清理 think / code fence；
- 从文本中提取 JSON object candidate；
- `JSON.parse(...)`；
- 再进入 action validation / normalization。

当前已经做了大量 hardening，但模型输出格式本身仍然是运行可靠性的一部分。

### 2.4 Tool Exposure 仍以 20 个为阈值

当前规则：

```text
public eligible tools <= 20
  → 全部暴露

public eligible tools > 20
  → embedding recall
  → rerank
  → 前 20
```

因此“Core Tools + Deferred Catalog + Tool Search”目前还不是运行真相。

### 2.5 当前已经存在 `HarnessCapabilityProfile`

它现在负责把 concrete tools 组织成便于发现 / Workbench 展示的能力组，例如：

- Workspace Lookup；
- Web Research；
- Browser Computer Use；
- Attached Browser；
- Terminal Execution。

这个对象回答的是“哪些 Tool 共同表达一个可发现能力面”，并不等于草案里讨论的：

```text
感知 / 获取 / 变更 / 执行 / 外联
```

也不等于授权边界。

### 2.6 Tool Core 仍有明显 MCP 命名与类型耦合

当前内部 Harness、Profile 与 Registry 仍大量围绕：

```text
McpToolDefinition
McpCapabilityMetadata
McpInvocationRecord
McpArtifact
```

组织。

这不等于“内部 Tool 必须通过外部 MCP Server 才能运行”，但说明 Mira 的内部 Tool Core 仍然被 MCP 命名和核心类型结构反向定义了一部分。

因此第二篇草案提出的“Tool 是 Mira 自己的执行单位，MCP 只是互操作协议之一”具有真实的工程整改对象。

### 2.7 MicroApp 当前确实同时指两件不同的东西

当前：

```text
产品层 MicroApps Hub
!=
server/src/microapps/runtime.ts 的 Integration MicroAppDefinition
```

前者混合 Studio、Integration、Tool、Skill、授权与配置入口；后者实际上是一套 Integration AccessPoint → business workflow binding contract。

当前 `MicroAppDefinition` 也不是“独立可执行小产品”的平台 Manifest。

因此 MicroApp 不是简单补几个字段，而需要先解决语义迁移。

### 2.8 Attached Browser / 触界已经是真实能力

当前公开能力已经包括：

```text
browser_attached_look
browser_attached_browse
browser_attached_act
browser_attached_transfer
```

所以 Mira Next 对 Browser 的工作重点不应该是重新造一个浏览器入口，而应是：

- 搜索如何路由到真实浏览器；
- Browser 能力怎样进入统一发现；
- 读取与副作用怎样继续保持治理边界。

### 2.9 当前审批仍是 invocation-oriented

当前 settled contract 以 frozen invocation 为审批对象；文档目标口径是：

```text
toolId + toolCallId + inputHash
```

当前实现仍存在 `toolCallId` 未进入 core grant match 的已知漂移。

草案中的“首次授权后同边界持续使用”尚未实现，也不能直接替换 exact invocation approval。

### 2.10 当前 Workspace 不是草案中的 Conversation Workdir

当前 `ChatWorkspace` 是一个可持久绑定 rootPath 的工作区对象。

Agent Thread 必须绑定 Workspace；没有显式选择时，会复用或创建 `Mira BASE`。

这和草案里的：

> 每条 Agent Conversation 天然拥有一块自己的小文件夹

不是同一个概念。

因此不能直接把现有 `ChatWorkspace` 改名后当成 Conversation Workspace。

## 3. Mira Next 的目标分层

目标不是替换当前稳定执行链，而是在它上面补清楚缺失的语义层。

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

必须保留的当前硬边界：

1. `AgentRun` 继续是 Agent 产品运行状态真相；
2. `Planner → Normalize → Policy → Tool → Evidence → Planner` 不因 Mira Next 被绕过；
3. capability match、tool search、MicroApp discovery 只能决定“候选”，不能直接变成 invocation；
4. Policy 只能对真实 frozen invocation 或明确的新授权合同作判断；
5. Remote / MicroApp / Browser 不得因为换了入口而绕过副作用治理；
6. Evidence 继续是 Planner 可使用的执行事实入口。

## 4. 先把三个叫“Capability”的东西拆开

目前最容易制造下一轮混乱的词就是 Capability。

工程上必须至少区分三层。

### 4.1 Product Capability：Mira 能做什么

这是产品与 Agent 理解层。

草案先保留：

```text
行动能力
├─ 感知
├─ 获取
├─ 变更
├─ 执行
└─ 外联
```

其中“获取”可以继续包含看 / 读 / 搜，“变更”包含增 / 改 / 删。

这层不拥有 Tool id，也不拥有审批结果。

工程命名在真正落类型前暂用：

```text
CapabilityClass
```

避免和现有 `HarnessCapabilityProfile` 混为一谈。

### 4.2 Harness Capability Profile：怎样发现可执行能力

当前 `HarnessCapabilityProfile` 可以继续存在。

它负责：

- 把多个 concrete tools 组织成一个可理解能力面；
- Tool Search / Workbench / progressive disclosure；
- 声明 preferred / supporting tools。

它不是风险授权模型。

### 4.3 Risk Signature：这一动作风险是什么

审批需要另一组维度，例如：

```text
side effect
scope
resource / target class
workspace boundary
external transfer
irreversibility
credential use
```

它不能从“获取 / 变更 / 执行”几个词直接推导。

因此未来 Capability Taxonomy 与 Approval Taxonomy 分离。

## 5. 工程路线

以下阶段按依赖排序。它们不是一次性任务包，也不表示应该同时开工。

---

## Phase 0 — 名词与当前真相锁定

### 目标

让后续实现不再用同一个词指三个不同对象。

### 要做

- 固定 `CapabilityClass / HarnessCapabilityProfile / RiskSignature` 的职责边界；
- 固定 `ChatWorkspace != Conversation Workdir`；
- 固定 `Tool Core != MCP transport`；
- 固定“平台 MicroApp”与当前 Integration `MicroAppDefinition` 是两套语义；
- 把两篇产品草案标记为产品输入，而不是 current contract。

### 不做

- 不改 Runtime；
- 不改审批；
- 不删 LangGraph；
- 不迁移数据库。

### 退出条件

任何下一阶段任务都可以明确写出自己改的是哪一层，不再依赖“Capability / MicroApp / Workspace”三个模糊词自行解释。

---

## Phase 1 — Structured Decision Boundary

### 问题

当前 Planner 已经只负责 `nextAction`，但进入 Runtime 的最后一公里仍依赖模型正确输出一段 JSON 文本。

Mira Next 不应该把 Parser hardening 无限做下去。

### 目标

建立 provider-neutral 的 Planner Decision boundary：

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

模型只提交当前决策；Runtime 自己持有 task state、approval、checkpoint、Evidence 和 execution history。

### 设计约束

- 优先使用 Provider 原生 structured output / tool-call / schema 能力，但不假设所有 Provider 都支持同一种协议；
- 保留 text-JSON compatibility codec 作为明确兼容层，而不是把它继续散落在 Planner Runtime 里；
- Parser / sanitizer 不得承担 Runtime state recovery；
- 不允许模型直接提交 approval、checkpoint、Evidence id 分配或其他 Runtime authority；
- `AgentNextAction` 继续是最小决策对象，不扩成“整轮运行状态 JSON”。

### 验收证据

至少证明：

1. direct answer；
2. retrieve；
3. concrete tool；
4. ask_user；
5. invalid structured decision；
6. provider 不支持 structured output 时的 compatibility path；

都能进入同一 typed decision validation boundary。

### 非目标

本阶段不改 Chat 三路，不改 Tool discovery，不改 SubAgent ownership。

---

## Phase 2 — Conversation Workdir

### 问题

默认 Agent 如果直接覆盖所有 Chat，而仍要求每个 Thread 绑定现有 `ChatWorkspace`，会把“用户项目目录”和“每条对话自己的工作位置”混为一谈。

### 目标

引入独立于 `ChatWorkspace` 的 Conversation Workdir：

```text
Thread / AgentRun
  ↓
Conversation Workdir
  ├─ user-provided files
  ├─ downloads
  ├─ temp outputs
  ├─ scripts
  └─ final artifacts
```

### 核心原则

- 每条 Agent Conversation 可以天然拥有自己的目录；
- 它不是用户必须手工创建的 Project / Workspace；
- `ChatWorkspace` 继续表达用户显式选择的工程 / 文件根；
- Workdir 内相对自由，不自动等于可以访问 Workdir 外部；
- 引用外部 Workspace、用户目录或系统路径仍进入现有 Policy / Approval；
- Workdir 的生命周期、清理、容量、Artifact 引用必须有明确合同。

### 重要限制

这一步会碰文件访问与审批边界，属于高风险设计。

先完成 storage/path/ownership contract，再决定是否减少 Workdir 内部普通文件操作审批；不能因为有了 Workdir 就顺手放宽 Terminal 或任意 host path。

### 验收证据

- 两条 Conversation 不共享工作目录；
- 删除 Conversation / 清理缓存时行为可预测；
- Artifact 可以稳定回到消息或任务；
- 显式 Workspace 与 Conversation Workdir 不互相覆盖；
- traversal / absolute path / symlink 等边界有测试。

---

## Phase 3 — Chat 收敛到 Agent Runtime

### 前置

- Phase 1 typed decision boundary 已稳定；
- Phase 2 已解决普通 Conversation 的工作位置语义；
- Normal / RAG / Agent 三路关键行为已有回归基线。

### 目标

产品上逐步实现：

```text
User Chat
  ↓
Agent Runtime
  ↓
Planner
  ├─ direct answer
  ├─ retrieve knowledge
  ├─ use tool
  ├─ delegate bounded work
  └─ ask user
```

### 迁移顺序

#### 3A. Backend convergence

先让 Agent Runtime 能等价承接普通回答与知识检索，不立刻删除旧 route。

要求保住：

- SSE 事件与 UChat 行为；
- Message persistence；
- title generation；
- Role / summary request context；
- TTS / image 后处理；
- cancel / error / retry；
- Knowledge Base source / Evidence 投影。

#### 3B. Default route

在回归通过后，让新 Conversation 默认使用 Agent Runtime。

保留 feature switch / compatibility route 一段迁移期，用于回归对照，不把旧路继续当第二套产品真相。

#### 3C. Product cleanup

确认真实使用与迁移完成后，再讨论：

- `agentEnabled` 是否退役；
- Chat 是否取消“模式”概念；
- KB 是否从 Thread 主路由绑定收缩为 Agent 可调用知识能力。

### 非目标

- 不在这一阶段删除 Knowledge Base；
- 不把每个任务都派 SubAgent；
- 不改变 Parent / Child ownership；
- 不因为统一 Chat 而把所有 Tool 永久暴露给 Planner。

---

## Phase 4 — Tool Core 与 MCP 解耦 + Deferred Discovery

这一阶段有两个相关但必须分别验收的目标。

### 4A. Tool Core 解耦

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

迁移原则：

- 先抽核心类型，再做兼容 alias / adapter；
- 不用全仓重命名证明“完成”；
- 不改变现有 Tool id、approval、trace、Evidence 语义；
- External MCP 继续通过 canonical projected id 进入 Harness；
- 内部 Tool 不再为了“是 Tool”而依赖 MCP 命名空间。

### 4B. Deferred Tool Discovery

目标从：

```text
>20 → embedding / rerank → top 20
```

逐步变成：

```text
Core Tools
+ Deferred Capability Catalog
+ Tool Search
+ progressive disclosure
```

Embedding / rerank 可以继续是 Tool Search backend，但不再是唯一裁判。

### 必须保持

Tool Search 的结果只是候选：

```text
discovery result
!= invocation
```

真正调用仍必须经过 Planner decision → Normalize → Policy → Harness。

---

## Phase 5 — Browser / Search Runtime

### 目标

不新增第二个和 `web_search` 抢语义的“Chrome Search Tool”，而形成：

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

### 原则

- Planner 先表达“搜索 Web”意图，不负责指定私有 key / endpoint / Chrome selector；
- Runtime 根据 availability、认证态、查询性质和 Search Guide 选执行通道；
- 公开搜索 API 适合快速 recall；
- Attached Browser 适合登录态、站内搜索、正文核验和无 API 网站；
- Browser read / observe 保持低摩擦；
- submit / send / upload / purchase / destructive action 继续进入明确治理。

### 不做

不会因为 Browser 变强就立刻删除：

- mail；
- GitHub；
- enterprise integration；
- 稳定 API connector。

Browser 是 Web 世界的基础能力，不是所有外部系统的唯一协议。

---

## Phase 6 — MicroApp Platform V0

### 先解决语义迁移

当前 Integration `MicroAppDefinition` 已有真实业务含义，不能原地扩成“独立小程序平台”后让旧调用悄悄变义。

工程上先明确：

```text
Legacy Integration MicroApp contract
!=
New MicroApp Platform contract
```

最终是否重命名旧类型、保留 compatibility alias，需要单独任务决定。

### V0 最小平台合同

MicroApp 至少需要声明：

```text
identity
version
entry / UI
lifecycle
execution mode: foreground | background | both
data directory
service intents
permission declaration
artifact I/O
health / availability
```

它是长期存在的小产品，不从属于某一条 Conversation。

### Agent 看到什么

Agent 不直接吃微应用内部几十个 tools。

MicroApp 向平台声明 service / intent，例如：

```text
整理录音
分析表格
编辑图片
生成演示文稿
```

平台维护：

```text
MicroApp Registry
  ↓
relevant candidate search
  ↓
progressive disclosure
  ↓
Agent
```

### 应用之间怎么协作

V0 不建立 App A → App B 的硬依赖网。

跨应用协作优先：

```text
MicroApp A
  ↓
Agent / Work orchestration
  ↓
MicroApp B
```

### MicroApp 自主性

MicroApp 可以拥有自己的内部 Runtime，甚至内部 Agent，但：

- 这不自动获得 Mira Host 权限；
- 平台权限声明不等于运行时授权已经通过；
- 对外副作用仍需符合 Host 的边界合同；
- 是否允许独立进程、Shell、网络、文件系统，要在 V0 之后单独设计隔离模型。

### Plugin System 暂不定名

本阶段明确不决定：

```text
MicroApp == Plugin System ?
```

Skill、MCP、Connector、Headless Provider 等反例仍然存在。

不要因为 Manifest 已经很像插件就提前把一级产品 taxonomy 钉死。

---

## Phase 7 — Capability Grant / Approval Research

这一阶段先研究，后施工。

### 目标方向

从无限重复的单次审批，研究是否可以形成：

```text
capability
+ scope
+ target class
+ side-effect boundary
+ credential boundary
+ expiry / session
→ reusable grant
```

### 但必须保留 exact invocation

以下类型即使存在 capability grant，也可能继续强确认：

- destructive delete；
- external send / publish；
- credential disclosure；
- purchase / payment；
- broad filesystem escape；
- remote resource mutation；
- irreversible or difficult-to-recover action。

### 前置问题

在设计 reusable grant 前，先修清当前 exact approval contract 与实现中 `toolCallId` match 的漂移。

不能在已有 identity drift 上再叠第二套授权语义。

---

## Phase 8 — Desktop Remote Capability Contract / Mobile

产品草案里的长期方向是：

```text
Mobile Agent / Client
  ↓
Remote Capability Contract
  ↓
Desktop Host
  ├─ Workspace
  ├─ Browser
  ├─ Knowledge
  ├─ Tool Runtime
  └─ MicroApps
```

但当前存在一个必须先显式解决的跨仓库合同冲突：

`mira-mobile` 当前根级 `AGENTS.md` 仍然规定：

- Host 负责 Agent Loop / Planner / Harness / Tool / Approval；
- Mobile 不复制 Agent 执行系统。

这和产品草案以及近期 BYOK / mobile-local runtime 方向并不一致。

因此本工程稿不把“Mobile 自带完整 Agent Runtime”写成已经接受的工程事实。

### 正确顺序

1. 先确定 Mobile 产品边界是否正式改变；
2. 若改变，先更新 mobile repository contract；
3. 再定义 Remote Capability protocol；
4. Desktop 发布 capability descriptors，不暴露内部 MCP / Tool implementation detail；
5. Desktop 对远端调用继续持有自己的 Policy / Approval authority；
6. Mobile 不伪造 Host approval 或 availability。

这必须作为独立跨仓库任务，不夹在 Desktop Tool refactor 中顺手实现。

---

## Phase 9 — Work Object / Board / Forge Reference

第二篇草案提出：Agent 的持续工作不能最后只剩在 Conversation History。

这个判断保留，但不从 Forge 直接抽一个“通用工作流引擎”。

### 最小抽象候选

未来先研究一个薄的 Work Object：

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

它只负责让持续工作“可重新找到、可继续管理、可交接”。

### Forge 的角色

Forge 当前只作为专业化样本参考：

```text
工作对象
→ 状态流转
→ Agent / 能力接力
→ 产物落板
```

不会把以下工程领域结构强行升格成所有 Agent 的通用合同：

- Builder；
- SHA Review；
- Branch；
- Repository Task；
- 工程专用 Handoff。

## 6. 明确不进入这一轮主工程的内容

以下内容重要，但不和这条主迁移链捆绑：

### Memory / Context / Insight

认知能力方向保留，但需要独立的数据来源、隐私、主动性、错误纠正和生命周期设计。

它不能因为“Agent 默认化”就顺手塞进 Planner prompt。

### Agent Definition / Agent Factory

不同 Agent 共享统一 Runtime、允许人格 / Skill / Tool exposure 差异，这个方向成立。

但用户自定义 Agent Definition UI 不作为 Chat 默认 Agent 的前置。

### LangGraph 删除

Mira Next 的目标是单一产品运行真相，不是为了架构洁癖立刻删除 compatibility runtime。

删除必须等价于确认：

- 无真实 consumer；
- 历史回归已有替代；
- 不再承担必要对照。

### 通用 Plugin System 命名

继续保留开放问题。

### 通用 Workflow Engine

不因为 Forge 有流水线，就提前为所有 Agent 造 BPMN。

## 7. 依赖图

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
  └─ 在 MicroApp / Remote 高权限开放前必须完成对应合同

P9 Work Object / Board
  └─ 不阻塞 P1-P6
```

## 8. 第一批真正建议开工的工程包

工程稿虽然覆盖九个阶段，但第一批不应该把它们全部转成 Issue。

### Main — E01 Structured Decision Boundary

这是当前最适合作为第一个施工包的项目。

原因：

- 范围可以限制在 Planner decision adapter / parse / validation boundary；
- 不先改变 Chat 产品行为；
- 它直接解决默认 Agent 之前最基础的稳定性债；
- 后续 Normal Chat 收敛、Tool Search、Remote Agent 都会依赖稳定决策协议。

建议任务目标：

> 在不改变 AgentRun、Normalize、Policy、Tool、Evidence 既有合同的前提下，把 Planner 的 provider output decoding 收敛到单一 typed decision adapter，并保留显式 compatibility codec。

### Candidate — E02 Conversation Workdir Design + Storage Contract

先做设计与最小持久化验证，不立即放宽权限。

建议任务目标：

> 定义并验证 Conversation Workdir 与 ChatWorkspace 的不同所有权、路径、生命周期、Artifact 引用与清理合同，为默认 Agent Conversation 提供可控执行空间。

### Blocked — E03 Chat Default Agent

只有 E01 与 E02 的必要合同成立后，才开 Chat route convergence。

这避免最危险的一种施工方式：

> 先把所有 Chat 切到 Agent，再一边线上运行一边补 Agent 稳定性和 Workspace 权限。

## 9. 每个后续任务卡都必须回答的五个问题

Mira Next 后续任何实现任务至少要写清：

1. **它改哪一个层级？** Product Capability、Discovery、Tool Core、Policy、MicroApp、Remote 还是 Work Object？
2. **它保留哪些 current contract？** 特别是 AgentRun、Normalize、Policy、Evidence、Workspace 与审批。
3. **它替代什么？** 如果没有明确旧 consumer，不得用“未来统一”作为删除理由。
4. **用什么证据证明完成？** unit / integration / black-box / packaged / cross-repo protocol。
5. **什么没有做？** 把延后项写出来，避免下一张任务卡从沉默中“继承”不存在的合同。

## 10. 工程稿当前结论

两篇 Mira Next 草案可以进入工程阶段，但不是作为一个“大重构”。

当前更合适的工程判断是：

- Pi Loop 和现有 Agent execution contract 保留，它们是地基，不是待推翻对象；
- Structured Decision 是默认 Agent 前最值得先处理的可靠性边界；
- Conversation Workdir 必须和现有 ChatWorkspace 分开定义，否则默认 Agent 会把产品 Workspace 与任务临时空间混在一起；
- Chat 收敛到 Agent 是明确目标，但必须做行为等价迁移，不是删 toggle 即完成；
- Tool 与 MCP 的解耦有真实代码依据，但应从核心类型 / adapter 边界渐进迁移；
- Deferred Tool Search 应替代 embedding 作为“唯一裁判”，但 discovery 永远不能直接获得 invocation authority；
- 触界已经足够真实，下一步应该把 Chrome Search 纳入 Search Runtime，而不是再造一套平行网络工具；
- MicroApp 平台方向成立，但必须和当前 Integration MicroApp contract 分开迁移，不能原地偷换语义；
- reusable capability approval 必须先做安全研究，并修清当前 exact approval identity 漂移；
- Mobile Remote Capability 必须先解决跨仓库产品合同冲突；
- 看板 / Forge 泛化属于更后面的持续工作层，不阻塞前六阶段。

这条路线的目标不是让 Mira 看起来拥有更多层。

恰恰相反：

> 是把已经存在的 Agent、Tool、Browser、MCP、MicroApp、Mobile 和 Forge 放回各自应该负责的位置，然后让它们通过少量稳定合同协作。
