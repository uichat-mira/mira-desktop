---
status: planned
owner: architecture / engineering
last_verified: 2026-09-16
layer: design
module: MiraNext
feature: EngineeringPackages
Doc Type: engineering-draft
canonical: false
related:
  - mira-next-agent-capability-microapp-engineering-draft.md
  - ../CURRENT_PRODUCT_TRUTH.md
  - ../AGENT_CURRENT_TRUTH.md
  - ../TOOL_CURRENT_TRUTH.md
  - ../MICROAPP_CURRENT_TRUTH.md
  - ../forge/FORGE_CURRENT_CONTRACT.md
  - ../harness/agentgraph-harness-protocol.md
  - ../knowledge-system/DOCUMENTATION_STANDARDS.md
---

# Mira Next 工程包推进稿：小步施工、验收门与 Mobile 会师点

> 本文负责 **Mira Next 的工程包拆分、依赖顺序、Milestone Gate、验收方式与跨仓库会师点**。
>
> `mira-next-agent-capability-microapp-engineering-draft.md` 继续负责目标架构与概念边界；本文负责“怎么一步一步施工”。两者不互相替代。
>
> 本文不是工程工作项 ledger，不拥有 Issue 状态、Project 状态或版本发布结果。真正开工时，每个工程包仍进入 GitHub Issue，由 Issue 持有该包的具体合同与结果。

核对基线：

- Desktop planning branch：`feat/mira-next-engineering-draft@347907cf7b73e47a1fd664659d178254b23b301d`；
- Mira Organization AI policy revision：`2026-09-16.2`；
- Organization Testing Standard：T1 Unit / T2 Contract / T3 Runtime / T4 Environment E2E / T5 Production Smoke；
- Mobile：`uichat-mira/mira-mobile@dev`，Remote Host + Local Provider 双链路已经成立；
- Mobile canonical remote contract：`docs/remote-access/remote-connection-canonical-v1.md`；
- Mobile 已存在 `MobileAgentLoop`、`RemoteToolGatewayClient`、`DurableHostAgentRuntimeAdapter`，因此本稿不把“重造 Mobile Agent / Tool Gateway / Approval Runtime”列为 Mira Next 前置。

## 1. 这份稿解决什么

Mira Next 已经不缺方向，真正的风险是两种：

1. 为了追进度，一次把多个架构变化塞进一个大任务，留下长期兼容层和不可解释的中间状态；
2. 为了“把代码整理漂亮”，把已经稳定工作的 Runtime 作为重构对象，最后让代码更整齐、产品更不稳定。

因此本稿采用一个简单原则：

> **工程稿可以描述完整迁移方向；工程包必须小、可独立验证、可停止、可回退。下一包依赖上一包已经通过的 Acceptance Gate，而不是依赖“代码写过了”。**

## 2. 工程施工模型

每个工程包按下面五步设计：

```text
Protect
  ↓
Characterize
  ↓
Prepare
  ↓
Change
  ↓
Retire
```

### 2.1 Protect

先写清不能破坏什么：

- settled contract；
- public protocol / route / tool id；
- persistence semantics；
- approval / ownership / security boundary；
- 已经工作的用户行为。

如果保护项无法说明，包还没有 Ready。

### 2.2 Characterize

给当前行为留下足够证据：

- T1 单元行为；
- T2 合同；
- 必要的 T3 Runtime；
- 只有真正跨环境/设备时才升级到 T4。

Characterization 的目标不是冻结实现细节，而是保护下一步必须保持的行为和边界。

### 2.3 Prepare

只做**眼前变化真正需要**的 preparatory refactor。

允许：

> 为了引入 `DecisionAdapter`，先把 provider output decode 从 Planner node 分离。

不允许：

> 既然打开了 Agent 目录，顺便把文件、类型、命名、状态机一起重做。

### 2.4 Change

完成该包唯一的主要行为或合同变化。

一个包只承担一个主要变化；如果需要同时改变多个独立 truth owner，应继续拆包。

### 2.5 Retire

只删除**被当前包证明已经不再需要**的旧路径。

Retire 不是 cleanup sprint，也不授权附近代码“顺便整理”。

任何 compatibility path 如果必须保留，创建时必须同时写：

```text
reason
known consumer / failure mode
removal condition
```

不能只写 `TODO remove later`。

## 3. Milestone Gate 与 Acceptance Gate

工程包内部可以有多个 Milestone，但只有最终 Acceptance Gate 能解锁依赖它的下一包。

推荐结构：

```text
M1 Protect / Characterize
  ↓ gate
M2 Prepare
  ↓ gate
M3 Change
  ↓ gate
M4 Final Acceptance
  ↓
ACCEPTED
  ↓
Unlock downstream package
```

### 3.1 Milestone 的意义

Milestone 是施工检查点，用来判断“是否有足够证据进入下一阶段”，不是第二套 GitHub Project Status。

Milestone 证据应记录在对应 Issue / PR / CI / test output 中，不建立新的 repository master ledger。

### 3.2 Final Acceptance 必须回答

每个工程包的最终 Gate 至少记录：

```text
Accepted against: <commit SHA>
Changed contract: <yes/no + owner>
Protected behavior: <evidence>
Verification: <T1/T2/T3/T4/T5 as applicable>
Compatibility left behind: <none / reason + removal condition>
Human runtime gate: <not-required / passed / pending>
Unlocks: <downstream package(s)>
```

代码完成、PR merge、CI green、Issue close 都不能单独替代上述 Acceptance 证据。

## 4. 手机端指挥下的验收原则

Mira 的施工不能默认维护者坐在电脑前手测。

每个包开工时必须把验收方式分成：

```text
Autonomous
Evidence Review
Human Runtime
```

### 4.1 Autonomous

优先设计成机器可以独立判定：

- type / lint / static checks；
- T1 / T2；
- 可重复 T3；
- fixture / snapshot / protocol evidence；
- API / runtime smoke。

### 4.2 Evidence Review

机器完成验证后，把关键证据压缩成手机可读的验收摘要：

- 关键 diff；
- 前后行为对照；
- 失败路径；
- 是否改变 settled contract；
- 哪些测试真实执行；
- 哪些未执行以及为什么。

### 4.3 Human Runtime

只有以下类别默认需要人工体验：

- UI 交互手感；
- Electron / OS 原生行为；
- Android / iOS 真机行为；
- 浏览器真实焦点 / 登录态；
- 拖放、系统权限、通知、分享等设备行为。

Human Runtime Gate 必须明确是否阻塞下一包：

```text
Engineering Gate: ACCEPTED
Human Runtime Gate: PENDING
Blocks next package: NO
```

或：

```text
Engineering Gate: ACCEPTED
Human Runtime Gate: PENDING
Blocks next package: YES
```

不能因为维护者当前只有手机，就把所有包永久停在“待人工验收”。

## 5. 近期工程包顺序

下面的编号表达施工依赖，不表达版本号。

### D00 — Mira Next 概念边界 ADR

性质：设计前置，不是 Runtime 工程包。

已经基本成立的边界：

- `CapabilityClass != HarnessCapabilityProfile != RiskSignature`；
- `ChatWorkspace != Conversation Workdir`；
- `Tool Core != MCP transport`；
- Platform MicroApp != Integration `MicroAppDefinition`；
- Product Capability / Discovery / Approval 是不同 concern。

验收：

- 术语在后续工程稿中使用一致；
- 不引入新的 Runtime 行为；
- 不为了统一术语做全仓重命名。

状态：本轮架构草案已经提供足够输入，后续只需按需补 ADR，不应阻塞 E01。

---

### E01 — Structured Decision Boundary

**优先级：第一主包。**

目标：

> 在不改变 `AgentRun / Normalize / Policy / Tool / Evidence` settled contract 的前提下，把 Planner provider output decode 收敛到 provider-neutral typed decision boundary；原 text-JSON 作为显式 compatibility codec，而不是隐含主协议。

Milestones：

**M1 — Characterization**

- direct answer；
- ask_user；
- retrieve；
- concrete tool；
- invalid model decision；
- text-JSON compatibility provider。

Gate：现有必须保持的 Planner 行为都有可重复证据。

**M2 — Decision Adapter seam**

- provider output 进入单一 typed decision adapter；
- text-JSON codec 独立；
- model 不拥有 approval / checkpoint / Evidence authority。

Gate：不改变 Normalize / Policy / Tool / Evidence 行为。

**M3 — Native structured provider path**

- 至少目标 provider 使用其真实支持的 structured / tool / schema 路径；
- 不支持者继续显式走 compatibility codec；
- provider 差异通过 adapter/capability 表达，不按 URL 猜厂商。

**M4 — Final Acceptance**

- 上述关键行为全部通过；
- 没有已知 Planner consumer 绕过 Decision Boundary；
- compatibility path 有明确 consumer 与 removal condition；
- relevant T1/T2/T3 + repository `pnpm check`（代码施工时）通过。

Acceptance mode：**Autonomous + Evidence Review**。

Unlocks：E05A 的 Structured Decision 前置。

---

### E02 — Chat Behavior Baseline / Equivalence Matrix

**性质：轻量合同包；优先于 Chat 路由迁移。**

目标：

> 把当前 Normal Chat / RAG Chat / Agent Chat 中必须保持的用户行为写成可验证矩阵，而不是直接先改默认 route。

至少覆盖：

- message history；
- streaming；
- cancel；
- error；
- attachments / media；
- knowledge-base binding / RAG evidence；
- model/provider selection；
- thread metadata；
- finish reason；
- title / summary 等已有真实 consumer；
- remote/mobile 消费到的 canonical message / run state。

Milestones：

**M1**：列出现有三条路径真实差异，不把目标行为冒充现状。

**M2**：能自动化的行为进入 T1/T2/T3；只能体验判定的行为单独标注。

**M3 — Final Acceptance**：矩阵足以成为 E05A/E05B 的回归与退役依据。

Acceptance mode：**Autonomous + Evidence Review**，少量 UI 项可 Human Runtime non-blocking。

Unlocks：E05A、E05B。

---

### E03 — Conversation Workdir

**优先级：第二个主要基础包。**

目标：

> 为 Agent Conversation 建立独立于 `ChatWorkspace` 的受控执行目录，并形成可验证的 ownership / path / lifecycle / artifact contract。

Milestones：

**M1 — Ownership / Path Contract**

- Conversation Workdir 与 ChatWorkspace 所有权分开；
- path 生成、定位、恢复规则明确；
- 不把 Workdir 解释成 host filesystem 全开放。

**M2 — Lifecycle / Storage**

- 创建；
- reload / recovery；
- cleanup；
- quota / bounded temp behavior；
- failure semantics。

**M3 — Artifact integration**

- Workdir 中的最终产物通过稳定 Artifact reference 离开执行空间；
- 临时文件与最终 Artifact 分开；
- Artifact 不依赖 UI 本地路径猜测。

**M4 — Boundary Acceptance**

- path escape / absolute-path / workspace-boundary tests；
- 不顺手放宽 Terminal、Edit、Host filesystem policy；
- relevant T1/T2/T3 + `pnpm check` 通过。

Acceptance mode：**Autonomous + Evidence Review**。

Unlocks：E05A；同时允许 M01 开始跨端 Artifact 会师。

---

### M01 — Remote Artifact Handoff

**性质：Desktop + Mobile 跨仓库工程包。**

它不是 E03 的本地前置；它是“Conversation Workdir 产物真正能回到手机”的跨端前置。

当前事实：Mobile protocol 已有 `artifacts:read` scope 与 `manifest.routes.artifacts` 槽位；Mobile Local Agent / Remote Tool Gateway 已存在，因此不需要重造 Agent loop。

目标：

```text
Host Tool / Agent / Workdir
  → Artifact
  → Remote-safe artifact projection
  → device scope + manifest
  → Mobile fetch / consume
  → Mobile user / Local Agent usable reference
```

Milestones：

**M1 — Host artifact projection contract**

- identity；
- metadata；
- ownership；
- content access；
- expiry / persistence；
- error semantics；
- scope / route authority。

**M2 — Mobile consumer**

- protocol parser / adapter；
- capability check；
- fetch；
- error / revoked / unavailable behavior。

**M3 — Cross-repo handoff**

- 至少一个真实 Host execution 产生 Artifact；
- Mobile 能得到可用 reference，而不是仅有 text summary；
- Local Agent 能在需要时把 Artifact reference 继续用于对话。

**M4 — Acceptance**

- Desktop/Mobile T2 contract 对齐；
- 两端各自 T3 通过；
- 实际跨端链路需要时做 T4；
- Android/iOS 保存/分享等 OS UX 如果进入范围，再增加 Human Runtime Gate。

Acceptance mode：**Autonomous + Evidence Review + Cross-repo T4 when promoted**。

Unlocks：跨端 Workdir / Tool / Browser / MicroApp Artifact 交付声明。

---

### E04 — Search Runtime & Attached Browser Routing

**性质：中等包，可与 E03/E05 前后错开，不依赖 MicroApp。**

目标：

> 不新增与 `web_search` 抢语义的“Chrome Search Tool”；由 Search Runtime 根据 Search Guide / task context 在 Tavily、SearXNG、Attached Browser 之间路由。

边界：

- Search API 负责快速 recall；
- Attached Browser 负责登录态、站内搜索、正文核验、无 API 页面；
- observe/read 尽量低摩擦；
- submit/send/upload/purchase/destructive action 继续经过既有治理；
- routing/discovery 不获得 invocation authority。

Milestones：

**M1**：现有 search/browser behavior characterization。

**M2**：routing seam，不改变公开 Tool 语义。

**M3**：Chrome/Attached Browser search path 进入统一 Runtime。

**M4**：公开搜索、登录态核验、fallback/error、side-effect boundary 验收。

Acceptance mode：**Autonomous + Evidence Review**；真实登录态/浏览器焦点可追加 Human Runtime non-blocking 或按任务设 blocking。

Unlocks：更可靠的外部世界能力；不阻塞 E05A。

---

### E05A — New Conversation Default Agent

**性质：产品行为迁移包。**

Hard prerequisites：

- E01 ACCEPTED；
- E02 ACCEPTED；
- E03 ACCEPTED。

目标：

> 新 Conversation 默认进入 Agent Runtime，同时保留明确的迁移期 compatibility path；不在同一包删除旧 route。

Milestones：

**M1 — Compatibility seam**

- 新旧行为入口可明确区分；
- rollback path 明确；
- 不用 silent fallback 隐藏错误。

**M2 — New default**

- 新 Conversation 默认 Agent；
- Normal/RAG 既有行为由 Agent Runtime 或兼容边界保持；
- KB 不被删除；
- 不把所有任务强制派给 SubAgent。

**M3 — Desktop regression**

按 E02 等价矩阵验证。

**M4 — Mobile Remote Compatibility Gate**

利用 Mobile 已有能力验证：

- paired device 可以进入/读取相关 Thread；
- Host AgentRun 可观察；
- waiting approval 可正确呈现；
- approve/reject/cancel 仍由 Host authoritative contract 驱动；
- background/foreground 后 canonical state replay 可恢复；
- terminal result 最终回到 canonical message / run truth。

这里不要求先实现 M01/M02，也不重造 Mobile Agent。

**M5 — Final Acceptance**

Desktop + Remote consumer 的关键回归通过；compatibility path 的保留理由与退役条件明确。

Acceptance mode：**Autonomous + Evidence Review**；必要真机行为在 `test` promotion 时走 T4/Human Runtime。

Unlocks：E05B。

---

### E05B — Legacy Chat Route Retirement

**性质：退役包，不与 E05A 合并。**

Hard prerequisites：

- E05A ACCEPTED；
- E02 中对应行为已由新路径覆盖；
- Mobile compatibility evidence 不再依赖待删除 route；
- 已知 consumer 清单为零或均完成迁移。

目标：

- 退役真正无 consumer 的 `agentEnabled` / 独立 RAG / legacy route 等具体旧路径；
- 每次只删除已证明 superseded 的部分；
- 不以“代码更干净”为理由扩大删除范围。

Acceptance：

- 删除前后行为矩阵保持；
- 无已知 consumer；
- rollback anchor 明确；
- relevant T1/T2/T3 通过。

Acceptance mode：**Autonomous + Evidence Review**。

Unlocks：Chat route convergence 完成声明。

---

### E06 — Protocol-neutral Tool Core

**性质：中偏重结构包。**

目标：

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

- 先抽 core type / alias / adapter；
- 不以全仓重命名证明完成；
- 不改变 Tool id、approval、trace、Evidence；
- MCP 是 adapter/transport，不再反向定义内部 Core；
- Remote Tool contract 不应因内部类型重命名而破坏。

Milestones：

**M1**：真实 MCP-named core dependencies 清单。

**M2**：最小 neutral seam。

**M3**：真实 consumer 迁移，不全仓机械 rename。

**M4**：旧 core type 只在有明确 consumer 时保留 compatibility，并写 removal condition。

Acceptance mode：**Autonomous + Evidence Review**。

Unlocks：E07；M02 的稳定 Host projection 基础。

---

### E07 — Deferred Capability / Tool Discovery

**性质：重包；与 E06 分开。**

目标：

```text
Core Tools
+ Deferred Capability Catalog
+ Tool Search
+ progressive disclosure
```

替代“`>20` 后 embedding/rerank top-20 是唯一候选裁判”的单一路径，但 embedding/rerank 仍可作为 search backend。

不可破坏：

- discovery result 只是 candidate；
- invocation 必须继续经过 Planner → Normalize → Policy → Tool → Evidence；
- capability match 不获得 approval authority。

Milestones：

**M1**：当前 exposure / recall / rerank characterization。

**M2**：Deferred Catalog + query contract。

**M3**：progressive disclosure consumer。

**M4**：大型 tool set、无结果、错误候选、approval boundary 回归。

Acceptance mode：**Autonomous + Evidence Review**。

Unlocks：M02 的 progressive Mobile capability consumption；E08 的 MicroApp service-intent discovery。

---

### M02 — Remote Capability Projection / Mobile Local Agent Integration

**性质：Desktop + Mobile 跨仓库工程方向；不等 MicroApp。**

当前 Mobile 已经具备：

- Local Provider / BYOK runtime；
- Mobile Agent Loop；
- Remote Tool list/invoke/cancel；
- remote approval；
- durable Host AgentRun observe/control；
- runtime manifest + device scope capability discovery。

因此 Mira Next 不重新设计 Remote Host，也不把 MCP / Host credential 下发给 Mobile。

目标：

```text
Host internal
  Native Tool / MCP / Browser / Domain Runtime / later MicroApp
        ↓
product-level capability projection
        ↓
existing manifest + device scope
        ↓
Mobile capability discovery
        ↓
Mobile Local Agent
        ↓
canonical Host invocation / Policy / Harness
        ↓
Evidence / Artifact
```

Milestones：

**M1 — Capability descriptor contract**

可在 E06 后开始：

- identity；
- description / service intent；
- input contract；
- availability；
- scope / risk projection；
- invocation target；
- Artifact / Evidence return shape。

不泄漏内部 MCP server config、Host path、provider secret。

**M2 — Manifest projection**

- 不另建与 `/remote/v1/manifest` 平行的静态 registry；
- device scope + manifest + canonical route ownership 继续是 authority。

**M3 — Mobile parser / registry**

- Mobile 只展示/消费 Host 明确发布且 device scope 已批准的能力；
- protocol error / stale manifest / revoked scope 行为明确。

**M4 — Local Agent consumption**

E07 ACCEPTED 后完成 progressive discovery；在此之前允许使用 bounded current projection 做兼容验证，但不能把它宣称为最终 discovery architecture。

**M5 — Invocation / approval / cancellation**

- actual execution 仍在 Host/Harness；
- Mobile 不伪造 approval / tool result / durable Run；
- credential boundary 不变。

**M6 — Evidence / Artifact handoff**

- text result 可用；
-需要 Artifact 的场景依赖 M01；
- Local Agent 能根据真实结果继续推理。

**M7 — Cross-repo Acceptance**

- Desktop/Mobile T2 对齐；
- 两端 T3；
- 真实 Direct/Relay path 在 test promotion 或协议高风险变化时做 T4；
- Android/iOS 差异按 Mobile policy 明确记录。

Acceptance mode：**Autonomous + Evidence Review + Cross-repo T4 where required**。

Unlocks：真正的“Mobile 有本地大脑，Desktop 提供受治理环境能力”；为后续 Remote MicroApp service 打地基。

---

### E08 — MicroApp Platform V0

**性质：重包，晚于基础能力层。**

Hard prerequisites：

- E06 ACCEPTED；
- E07 ACCEPTED。

M02 不是 Platform V0 的硬前置，但它应作为 service-intent / remote projection 的真实输入，避免只凭想象设计平台。

V0 最小合同：

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

原则：

- Legacy Integration MicroApp contract 与 Platform contract 分开；
- Agent 看 service / intent，不直接看到微应用内部几十个 Tool；
- Registry + relevant candidate search + progressive disclosure；
- V0 不建立 App A → App B 硬依赖；
- 跨应用协作优先通过 Agent / Work orchestration；
- `MicroApp == Plugin System` 继续不定案。

Acceptance 至少需要一个真实 MicroApp consumer，不接受只有 Manifest/Registry 没有真实运行对象的“平台完成”。

Acceptance mode：**Autonomous + Evidence Review**；具体 UI 可有 Human Runtime Gate。

---

## 6. 暂不进入主施工链

### R01 — Reusable Capability Grant Research

先修 exact approval identity drift，再研究 reusable grant。

研究对象：

```text
capability
+ scope
+ target class
+ side-effect boundary
+ credential boundary
+ expiry / session
→ reusable grant
```

它不能提前覆盖 destructive delete、external publish/send、credential disclosure、payment、broad filesystem escape、remote mutation 等 exact confirmation 边界。

### R02 — Generic Work Object / Board

Forge 是真实专业样本，但不把 Builder / SHA Review / Branch / Repository Task 抽成所有 Agent 通用状态机。

只有其他领域出现第二个、第三个真实持续工作 consumer 后，再提取薄 Work Object。

### R03 — Memory / Context / Insight

另开产品与数据治理讨论，不混进上述主施工链。

### R04 — Agent Factory / Generic Plugin / BPMN

不阻塞默认 Agent、Remote Capability 或 MicroApp V0。

## 7. 依赖图

```text
D00 Concept Boundaries
  ├──────────────→ E04 Search / Browser
  ↓
E01 Structured Decision
  ├──────────────┐
  ↓              │
E02 Chat Baseline│
  ↓              │
E03 Workdir      │
  ├→ M01 Remote Artifact Handoff
  ↓              │
E05A Default Agent
  ↓
E05B Legacy Route Retirement

E05A 稳定后再进入较重 Tool 结构迁移：

E06 Protocol-neutral Tool Core
  ↓
E07 Deferred Discovery
  ├──────────────→ E08 MicroApp Platform V0
  ↓
M02 Remote Capability Projection

M02 contract work 可在 E06 后启动；
M02 progressive discovery milestone 等 E07；
M02 artifact milestone 在需要非文本产物时依赖 M01。
```

关键点：

- E04 不必等 E06/E07 才开始；现有 Attached Browser 已是真实能力。
- M01 不阻塞 Desktop Workdir 本体，只阻塞跨端 Artifact 声明。
- M02 不等 E08；Remote Capability 有现有 Remote V1 + Mobile Agent/Tool Gateway 地基。
- E08 不反过来成为 Mobile 本地 Agent 的基础设施前置。

## 8. 候选版本列车

版本号是多个 **已 Accepted 工程包** 的发布/集成集合，不是工程包本身，也不是进度状态。

当前只作为候选规划：

### v0.1 — Agent 基础可靠性

- E01 Structured Decision；
- E02 Chat Behavior Baseline；
- E03 Conversation Workdir。

目标：默认 Agent 迁移前的三个地基均可被下游依赖。

### v0.2 — 默认 Agent 与外部世界

- E04 Search / Attached Browser Routing；
- E05A New Conversation Default Agent；
- 满足退役条件时才包含 E05B。

目标：用户开始主要通过 Agent Runtime 使用 Chat 与外部世界，但不以“删光旧代码”为版本目标。

### v0.3 — 能力边界与跨端闭环

- E06 Protocol-neutral Tool Core；
- E07 Deferred Discovery；
- M01 Remote Artifact Handoff；
- M02 Remote Capability Projection。

目标：Mobile Local Agent 与 Desktop Host 能力形成稳定、受治理、可携带 Artifact 的闭环。

### v0.4 — MicroApp 平台化

- E08 MicroApp Platform V0；
- 至少一个真实 MicroApp consumer。

目标：MicroApp 从入口/Integration binding 演进为真实平台对象，而不是只有 Registry/Manifest 的抽象平台。

`v1.0` 不在本稿承诺日期。至少应观察到：

- Chat 默认 Agent 稳定；
- Remote capability 跨端闭环稳定；
- Tool/MCP 边界清楚；
- MicroApp V0 有真实 consumer；
- compatibility liabilities 有明确剩余清单和退出条件。

## 9. 每个新 Issue 的工程包模板

真正开包时，Issue 至少回答：

```text
Goal

Why now

Protected contracts

Allowed scope

Forbidden scope

Milestones
- M1 ...
- M2 ...
- M3 ...
- Final Acceptance

Acceptance mode
- Autonomous
- Evidence Review
- Human Runtime (blocking? yes/no)

Required evidence
- T1 ...
- T2 ...
- T3 ...
- T4/T5 if applicable

Compatibility introduced
- none
or
- reason
- consumer
- removal condition

Unlocks
- downstream package(s)

Explicit non-goals
```

如果一个 Issue 无法写清 `Protected contracts`、`Final Acceptance` 和 `Unlocks`，它还不适合进入施工。

## 10. 当前施工建议

当前不要同时开很多包。

现实节奏按：

```text
1 个 Main
+ 最多 1 个 Candidate / contract-prep
```

近期建议：

```text
Main      E01 Structured Decision Boundary
Candidate E02 Chat Behavior Baseline
Prepare   E03 Conversation Workdir contract（只做必要调查/合同输入）
```

E01 ACCEPTED 后，再根据 E02/E03 的证据决定是否进入 E05A；不因为路线图已经写了后续包就自动开工。

## 11. 结束条件

这条路线成功的标志不是 Mira Next 的所有名词都落成类、表、Registry 或页面。

成功的标志是：

- 每个变化都有清楚的 owner；
- 每个工程包都有能决定 PASS/FAIL 的里程碑；
- 下一包只建立在已 Accepted 的地基上；
- 兼容路径知道自己为什么存在、什么时候死亡；
- Mobile 与 Desktop 只在真正跨端的合同上相互前置；
- 没有为了“未来也许会用”预付一整个平台的复杂度；
- 没有为了“代码更漂亮”破坏已经工作的 Runtime。

> **小步改变，保护行为；有目的地重构，及时地退役；验收通过，再走下一步。**
