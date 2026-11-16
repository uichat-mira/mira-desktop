# Wiki System Schema

Status: Current
Owner: docs
Last verified: 2026-06-25
Layer: schema
Module: Docs
Feature: DocsSystem
Doc Type: current-contract
Canonical: true
Related:
  - knowledge-system/DOCUMENTATION_STANDARDS.md
  - knowledge-system/DIRECTORY_AND_CLASSIFICATION_RULES.md
  - knowledge-system/KNOWLEDGE_SYSTEM_INDEX.md
  - knowledge-system/OPERATING_MODEL.md

## 单点真相范围

这篇文档定义当前项目文档系统的上位 schema。

它明确三类主层和一个受控执行层：

- Raw sources
- Wiki
- Schema
- Project control

本 schema 参考：

- [karpathy/442a6bf555914893e9891c11519de94f](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

目标不是把所有 markdown 都做成同一种东西，而是让文档系统像一个可长期维护的 LLM Wiki：

- 原始资料保真
- Wiki 层持续整理
- Schema 层定义维护规则

## 适合什么时候读

这些场景先读这篇：

- 准备新增一篇文档
- 想判断某份材料该进 raw sources 还是 wiki
- 想让 AI 按稳定规则 ingest 新资料
- 想知道文档站和知识库消费哪一层

## 四类层定义

### 1. Raw sources

Raw sources 是原始资料层。

这一层放的是：

- 真实接口文档
- 架构说明
- 设计草稿
- bugfix 记录
- checklist
- changelog
- 评审记录
- 任何仍然作为事实来源的原始材料

这一层的原则：

- 是 source of truth
- 默认不可被 AI 随意改写成总结腔
- 只允许做归档、索引、引用、标注
- 不要求它们长得统一，但要求它们可追溯

这一层适合回答：

- 事实是什么
- 设计原文怎么写
- 某次决策当时到底说了什么

### 2. Wiki

Wiki 是 LLM 维护的知识层。

这一层放的是：

- 模块总览
- 概念页
- 比较页
- 综述页
- 阅读路径
- 交叉引用
- 结构化 synthesis

这一层的原则：

- 由 LLM 生成、更新和维护
- 面向人类可读，也面向 AI 可持续消费
- 可以重写，但要保留和 raw sources 的溯源关系
- 允许把多份 source 合成为一篇更好读的知识页

这一层适合回答：

- 这个模块是什么
- 这里相关的概念有哪些
- 从哪里开始读最省脑子
- 几份原始资料合起来能得到什么判断

### 3. Schema

Schema 是维护规则层。

这一层不是内容本身，而是告诉 LLM：

- wiki 该怎么长
- 新资料该怎么 ingest
- 哪些文档能改，哪些只能引用
- 哪些场景要生成新 wiki 页
- 哪些场景只更新已有页
- 哪些结论应该标成 historical

这一层的原则：

- 是整套系统的纪律来源
- 负责约束写法、分类、工作流和维护边界
- 应同时被人和 LLM 维护
- 要比单篇文档更稳定

这一层适合回答：

- 新资料进来时怎么处理
- AI 回答问题时优先读哪层
- LLM 什么时候该写 wiki，什么时候不该动 source

### 4. Project control

Project control 是任务控制层。

这一层不是通用知识页，也不是原始事实层。

这一层放的是：

- active workboard
- task cards
- review evidence
- accepted decisions
- phase archive snapshots

这一层的原则：

- 只服务当前执行与验收
- 强调任务边界、证据、阻塞和归档
- 不承担产品说明、架构说明或通用知识沉淀
- 不让 AI 线程记忆替代 project status truth

这一层适合回答：

- 现在到底在做哪个任务包
- 哪些文件允许改，哪些不能改
- 任务当前卡在哪
- 证据是否足够支撑 DONE
- 哪些阶段内容已经归档

## 各层关系

推荐的处理顺序是：

1. 先读 raw sources
2. 再维护 wiki
3. 再由 schema 约束整个流程
4. 进入具体执行时再读 project control

也就是说：

- raw sources 提供事实
- wiki 提供整理后的知识
- schema 提供维护秩序
- project control 提供当前执行约束

## 核心边界

### Raw sources 不做什么

- 不承担整库导航
- 不承担概念总结
- 不承担大规模 synthesis
- 不承担长期阅读路径维护

### Wiki 不做什么

- 不冒充原始事实
- 不抹掉自己的来源
- 不和 raw sources 混成一层

### Schema 不做什么

- 不写具体业务事实
- 不替代 source
- 不替代 wiki 页面本身

### Project control 不做什么

- 不承担通用知识库角色
- 不替代架构总纲或产品说明
- 不替代源码相邻实现文档
- 不把 review 直接当 task card

## 推荐目录模型

当前可先按逻辑层组织，后续再决定是否物理搬目录。

推荐逻辑目录：

```text
docs/
  sources/
  wiki/
  schema/
  project-control/
```

如果暂时不搬目录，也至少要在元数据里明确：

- `layer: raw-source`
- `layer: wiki`
- `layer: schema`
- `layer: project-control`

## 推荐元数据

每篇文档至少应尽量能回答这几个问题：

- 属于哪个模块
- 属于哪个功能点
- 属于哪一层
- 属于哪种文档角色
- 是否可由 LLM 直接维护
- 是否是当前真相

### 活跃文档最小要求

所有仍在活跃维护区的文档，建议至少明确补齐这四项：

- `Layer`
- `Module`
- `Feature`
- `Doc Type`
- `Status`

如果一篇文档还承担事实依据或索引用途，最好再补：

- `Owner`
- `Last verified`
- `Canonical`
- `Derived from`
- `Related`

### Module 判定优先级

当一篇文档可能跨多个主题时，不要平均分配模块。优先按下面顺序选主模块：

1. 这篇文档主要服务哪个稳定产品域
2. 这篇文档主要描述哪条运行链路或契约
3. 这篇文档主要由哪个团队/责任域维护
4. 如果仍然说不清，才暂归 `Develoments` 或 `Docs`

建议的主模块口径如下：

| Module | 主要含义 | 典型文档 |
| --- | --- | --- |
| `Chat` | 聊天产品域、线程、消息、会话体验 | `uchat.md`、`chat/chat-system-practices.md` |
| `ModelSetting` | 模型配置、provider 接线、模型能力与接口约束 | `provider/README.md`、`architecture/model-config-api.md` |
| `MCP` | 外部 MCP 接入、MCP 市场、MCP 资源与能力暴露 | `external-mcp-marketplace.md`、`CONCEPT_MCP.md` |
| `Tool` | 内置工具、tool runtime、read/edit/terminal 等工具能力 | `tooling-runtime/tools-protocol.md`、`tooling-runtime/harness-runtime-design.md` |
| `SKILL` | 助手内部复用的工作动作、skill 与 memory 的桥接层、skill-driven memory 设计 | `skill/README.md`、`skill/skill-memory-poc.md` |
| `KnowledgeBase` | 知识库内容、导入、检索、workspace | `knowledge-base/api.md`、`knowledge-base/markdown-workspace-mode.md` |
| `Role` | 角色系统、persona、role API | `role/README.md`、`role/role-api.md` |
| `MicroAPP` | 微应用模块、接入点绑定的业务工作流、跨平台复用的集成业务能力 | `microapp/README.md`、`integrations/wecom-microapp-interface-design.md` |
| `Docs` | 文档系统、schema、索引、AI 阅读规则、知识系统治理 | `WIKI_SYSTEM_SCHEMA.md`、`knowledge-system/DOCUMENTATION_STANDARDS.md`、`knowledge-system/KNOWLEDGE_SYSTEM_INDEX.md` |
| `Develoments` | 开发支撑域：runtime、platform、evaluation、规划、bugfix、架构与工程约束 | `architecture/README.md`、`build/README.md`、`developments/release-management.md` |

### 重叠文档怎么收

如果一篇文档明显跨模块：

- 只给一个 `Module` 作为主归属
- 其他相关模块放进 `Related`
- 不要为了“看起来都沾一点”而写多个主模块

判断规则很简单：

- 文档回答“它主要在讲谁”，那是 `Module`
- 文档回答“它具体落在哪个功能点”，那是 `Feature`
- 文档回答“它是啥性质的页”，那是 `Doc Type`
- 文档回答“它属于哪层”，那是 `Layer`

### Feature 规则

`Feature` 是 `Module` 下面的二级维度。

它回答的问题不是“这篇属于哪个大模块”，而是：

- 这篇文档主要落在哪个具体功能点
- AI 在同一模块内应该把它和哪些页视作同一簇

当前规则先定成：

- `Feature` 正式存在
- `Feature` 暂时允许为空
- 没有稳定功能点名称时，不要硬填
- 一旦某个功能点已经在项目中稳定存在，后续同类文档应尽量复用同一个 `Feature`

例如：

- `Module: Chat`，`Feature: Thread`
- `Module: Chat`，`Feature: ToolIntegration`
- `Module: KnowledgeBase`，`Feature: MarkdownWorkspace`
- `Module: MCP`，`Feature: ExternalMarketplace`
- `Module: Docs`，`Feature: DocsSystem`

## Allowed Values

为了避免不同文档各自发明命名，当前 schema 先固定一版推荐值表。

### Allowed `Layer`

- `raw-source`
- `wiki`
- `schema`
- `project-control`

### Allowed `Module`

当前项目先固定这些模块值：

- `Chat`
- `ModelSetting`
- `MCP`
- `Tool`
- `SKILL`
- `KnowledgeBase`
- `Role`
- `MicroAPP`
- `Docs`
- `Develoments`
- `ProjectControl`

说明：

- 这是当前稳定的顶级功能模块骨架
- 旧的 `docs-system` 现在应统一并入 `Docs`
- 旧的 `runtime / platform / evaluation / planning / bugfix` 先统一并入 `Develoments`
- 旧的 `provider` 先统一并入 `ModelSetting`
- 旧的 `tooling-runtime` 不再作为长期顶级模块，而是按内容主语拆进 `Tool` 或 `MCP`
- `SKILL` 用于承接“助手内部复用的工作动作”这类文档，不再把它混进 `Tool`、`MicroAPP` 或 `MCP`
- 版本、请求封装、i18n、工程规范、缺陷与路线类正文，优先下沉到 `developments/`

### Allowed `Doc Type`

当前项目先固定这些文档角色：

- `current-contract`
- `reference`
- `overview`
- `design`
- `plan`
- `checklist`
- `draft`
- `implementation-notes`
- `historical`
- `how-to`
- `index`
- `workboard`
- `task-card`
- `review`
- `decision`
- `archive-snapshot`

### Allowed `Status`

当前项目先固定这些状态值：

- `current`
- `active`
- `planned`
- `historical`

说明：

- `Status` 是文档生命周期状态，不是任务执行状态
- `project-control/tasks/` 中的任务推进状态不要塞进 `Status`
- 任务推进状态单独使用 `task_state`

### Allowed `Task State`

当前 `project-control` 任务卡和 workboard 先固定这些任务状态值：

- `TODO`
- `IN_PROGRESS`
- `BLOCKED`
- `READY_FOR_REVIEW`
- `DONE`
- `DROPPED`

站点和 AI 的默认理解口径如下：

| Status | 默认含义 | 典型站点分组 |
| --- | --- | --- |
| `current` | 当前有效事实、当前有效契约 | 先读这里 |
| `active` | 正在推进、仍在执行中的内容 | 正在实施 |
| `planned` | 已确认方向，但尚未成为现状 | 规划中 |
| `historical` | 历史材料、过期方案、仅供背景回看 | 历史归档 |

说明：

- `Doc Type` 回答“这篇是什么角色的页”
- `Status` 回答“它当前处于什么生命周期”
- `Task State` 回答“任务现在推进到哪一步”
- 不要再把 `planned / active / historical` 混进模块判断里

### `Doc Type` 到站点状态区块的推荐映射

为了让人类阅读入口和 AI 默认读取顺序保持一致，推荐先用下面这套映射：

| Doc Type | 默认落点 |
| --- | --- |
| `current-contract` | 先读这里 |
| `overview` | 先读这里 |
| `reference` | 先读这里 |
| `checklist` | 正在实施 |
| `plan` | 规划中 |
| `draft` | 规划中 |
| `design` | 如果尚未落地则归规划中；如果已成当前契约，则由 `Status` 决定 |
| `historical` | 历史归档 |
| `index` | 先读这里 |
| `workboard` | 正在实施 |
| `task-card` | 正在实施 |
| `review` | 先按 `Status` 判断；在 project control 中通常作为实施证据 |
| `decision` | 先按 `Status` 判断；当前有效决定通常进入先读这里或正在实施入口 |
| `archive-snapshot` | 历史归档 |

如果 `Doc Type` 和 `Status` 冲突，优先按下面顺序判断：

1. `historical` 永远优先进入历史归档
2. `active` 可以把 `checklist / implementation-notes` 推进到正在实施
3. `planned` 可以把 `plan / draft / design` 推进到规划中
4. `current` 可以把 `current-contract / overview / reference` 推进到先读这里

一句话规则：

- `Module` 回答“这篇在讲谁”
- `Feature` 回答“它在这个模块里具体是哪一块”
- `Doc Type` 回答“这篇是干什么的”
- `Layer` 回答“它属于哪一层”

推荐字段：

```yaml
layer: raw-source | wiki | schema | project-control
module: Chat | ModelSetting | MCP | Tool | SKILL | KnowledgeBase | Role | MicroAPP | Docs | Develoments | ProjectControl
feature: <optional feature slug or name>
doc_type: current-contract | reference | overview | design | plan | checklist | draft | implementation-notes | historical | how-to | index | workboard | task-card | review | decision | archive-snapshot
status: current | planned | active | historical
task_state: TODO | IN_PROGRESS | BLOCKED | READY_FOR_REVIEW | DONE | DROPPED
owner: runtime
llm_editable: true | false
canonical: true | false
derived_from: [...]
related: [...]
```

## 工作流

### Ingest

新资料进来时：

1. 判断它属于 raw source、wiki 还是 schema
2. 记录 module 和 doc_type
3. 标注是否需要新建 wiki 页
4. 标注是否影响已有页面

记录 `Module` 时，优先按当前顶级功能模块写，不再把 `planning`、`bugfix`、`platform` 这类工程域直接当成长期顶级模块。

记录 `Feature` 时：

- 有稳定功能点就写
- 没有就留空
- 不要为了“字段完整”发明一次性名字

如果新增的是 `project-control` 文件，还要额外判断：

1. 它是不是 current execution control material
2. 它应该进 `workboard`、`task-card`、`review`、`decision` 还是 `archive-snapshot`
3. 它是否会和现有 active workboard 争夺当前真相

### Maintain

维护 wiki 时：

- 用 raw sources 作为依据
- 用 schema 作为规则
- 不要让 wiki 反过来替代 source

维护 `project-control` 时：

- 用 active task scope 和 review evidence 作为依据
- 用 schema 约束 task card、workboard、decision、archive 的职责
- 不要把 project-control 膨胀成通用知识目录

### Controlled Writeback

这套系统不应把“AI 写回”整体禁止掉。

更合理的规则是：

- 允许受控写回
- 禁止无依据改写

具体口径如下：

#### AI 应该直接写回什么

- schema 层文档
- wiki 层文档
- project-control 层中的 workboard、task card、review、decision、archive snapshot
- 入口页、索引页、概念页
- 活跃文档的元数据头部
- 分类明显错误的文档归属
- 待归类治理页

#### AI 不应直接改写什么

- raw-source 的事实正文，如果没有明确依据
- 仍作为 source of truth 的设计原文
- 只能通过猜测才能得出的实现结论
- 未经 owner 确认就重写 task scope、acceptance criteria 或 forbidden area

#### AI 遇到错误时的默认动作

如果 AI 发现：

- `Layer / Module / Doc Type / Status` 明显错误
- 文档应该归进别的模块
- 某页本应 historical 却仍被当 current
- 某页已经是 canonical 入口却没有被入口系统表达出来

默认不应该只是提示，而应该直接在受控范围内修正。

一句话：

- AI 不是只能读
- AI 是这套文档系统的整理者
- 但它必须在 schema 约束下写回，而不是无约束改写原始事实

### Answer

AI 回答问题时：

- 优先读 wiki 的总览和概念页
- 必要时回 raw sources 核对
- 进入具体执行前读 project control
- 不把历史材料误当成当前事实

## 判定规则

如果一篇文档主要在做事实记录，它更像 raw source。  
如果一篇文档主要在做知识整理，它更像 wiki。  
如果一篇文档主要在约束维护流程，它更像 schema。  
如果一篇文档主要在约束当前任务、证据和归档，它更像 project control。  

一句话记忆：

- source 负责“原来是什么”
- wiki 负责“现在怎么理解”
- schema 负责“以后怎么维护”

## 相关文档

- `knowledge-system/DOCUMENTATION_STANDARDS.md`
- `knowledge-system/DIRECTORY_AND_CLASSIFICATION_RULES.md`
- `knowledge-system/KNOWLEDGE_SYSTEM_INDEX.md`
- `knowledge-system/KNOWLEDGE_SYSTEM_FULL_PLAN.md`
