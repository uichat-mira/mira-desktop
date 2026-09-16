---
status: current
owner: docs
last_verified: 2026-09-16
layer: schema
module: Docs
feature: DocsSystem
doc_type: current-contract
canonical: true
related:
  - ../README.md
  - ../CURRENT_PRODUCT_TRUTH.md
  - ../archive/README.md
  - ../project-control/README.md
---

# UIChat Mira 文档规范

这份规范定义 `docs/` 如何同时服务人类开发者、AI 工具和内置文档站。

目标不是让所有文档格式完全一致，而是让任何读者都能先判断：**这页可信到什么程度。**

> 工程工作项的合同与结果由 GitHub Issue 持有；GitHub Project `Status` 只表达 `Todo / In Progress / Done` 管理位置；Organization Issue Fields 持有 Priority、Effort、日期等结构化规划元数据。仓库文档可以保存实现说明、验证证据和历史决策，但不再维护第二套 master ledger / workboard 作为当前工程管理真相源。

## 1. 生命周期

每篇文档必须属于以下一类。

### Current：当前真相

适用于已经核验的：

- current-contract；
- current-snapshot；
- overview；
- reference；
- how-to / runbook。

要求：

- 有 Owner；
- 有 Last verified；
- 与代码或真实验证一致；
- 说明已经实现与尚未实现的边界。

### Active：施工与验证资料

适用于仍在当前实现或验证过程中、但**不拥有工程工作项合同/结果**的仓库材料，例如：

- implementation notes；
- checklist；
- acceptance / regression evidence；
- 临时验证记录；
- 与当前 GitHub Issue 明确关联的实现辅助文档。

Active 只表示“这份资料仍服务当前施工/验证”，不表示它是工作项 source of truth，也不能创建 repository-local lifecycle 与 GitHub Project `Status` 并行运行。

新的工程工作项应进入 GitHub Issue。除非某个领域 Runtime 明确把 ledger/card 定义为自身的业务输入协议，否则不要新建 master ledger / master workboard 来管理 Mira Organization 的工程任务。

### Planning：方案与实验

适用于：

- design；
- plan；
- roadmap；
- research；
- draft；
- POC / proposal。

Planning 页面必须避免使用“已经支持”“当前实现”为未验证能力背书。

### Historical：历史归档

适用于：

- Historical；
- Archived；
- Superseded；
- Deprecated；
- Retired；
- Completed；
- retrospective；
- `archive/` 下的内容。

历史材料不得覆盖当前契约。

### Unverified：待核验

缺少状态、类型或核验信息，且不能通过路径和文件名安全判断的文档进入待核验。

**待核验不是默认 Current。**

## 2. 推荐头部

优先使用 YAML frontmatter：

```md
---
status: current
owner: runtime
last_verified: 2026-07-30
freshness_audited: 2026-09-16
layer: raw-source
module: Agent
feature: Approval
doc_type: current-contract
canonical: true
related:
  - ../ENGINEERING_MEMORY.md
---
```

索引器仍兼容旧式头部：

```md
# 标题

Status: Current
Owner: runtime
Last verified: 2026-07-30
Layer: raw-source
Module: Agent
Feature: Approval
Doc Type: current-contract
Canonical: true
```

两种格式的语义必须一致。不要在同一页写出互相冲突的两套状态。

## 3. 字段语义

- `status`：Current / Active / Planned / Historical 等生命周期信号；
- `owner`：负责核验这页的工程域；
- `last_verified`：最后一次与代码、运行时或真实决策对**正文所声明事实/合同**进行核验的日期；不能用“文件被编辑”代替技术核验；
- `freshness_audited`：可选。最后一次只检查 freshness metadata、authority/source-of-truth 关系或文档身份的日期；它**不等于**正文技术事实已重新核验，因此不能自动覆盖 `last_verified`；
- `layer`：raw-source / wiki / schema；
- `module`：所属产品或工程模块；
- `feature`：模块内部功能域；
- `doc_type`：current-contract、overview、reference、checklist、design 等；
- `canonical`：是否为该主题的优先真相入口；
- `related`：需要一起阅读的文档。

## 4. 状态优先级

冲突时按以下规则：

1. Historical / Superseded / Deprecated 优先，不能因 `doc_type: current-contract` 重新变成当前；
2. 明确 Status 优先于文件名推断；
3. 路径位于 `archive/` 时固定为历史；
4. 没有状态时可以用 doc type 和文件名辅助分类；
5. 仍无法判断时进入待核验。

## 5. 核验健康度

Current 文档：

- 90 天内核验：已核验；
- 超过 90 天：核验过期；
- 没有日期：缺少核验信息；
- 日期无法解析：核验日期无效。

过期不等于一定错误，但不能继续无提示地占据当前真相入口。

`freshness_audited` 只说明文档身份、元数据或 authority 关系最近被检查过，不能让过期的 `last_verified` 重新变成“技术已核验”。如果一次工作只完成 metadata / governance audit，应保留原 `last_verified`，并清楚记录本轮 audit scope。

## 6. 内容结构

当前契约推荐顺序：

1. Purpose；
2. Current Truth / Current Contract；
3. Implemented；
4. Not Implemented；
5. Constraints；
6. Failure / Recovery；
7. Code Anchors；
8. Verification；
9. Related Docs。

计划与 POC 推荐顺序：

1. Problem；
2. Assumptions；
3. Proposed Direction；
4. Unknowns；
5. Validation Plan；
6. Exit / Archive Conditions。

## 7. 项目控制区与工程工作项

`docs/project-control/` 在 Organization 治理迁移后主要保留：

- 历史 task / task-card；
- evidence；
- review；
- decision；
- phase conclusion；
- archive snapshot；
- 为旧链接保留的 compatibility entry。

它是**工程历史与证据区**，不是当前 Mira Organization 的 work-item ledger，也不能代替 GitHub Issue / Project / Organization Issue Fields。

当前工程治理边界：

```text
GitHub Issue        = work-item contract + outcome
Project Status      = Todo / In Progress / Done 管理位置
Org Issue Fields    = Priority / Effort / dates 等结构化规划元数据
PR / Review / CI    = implementation + verification evidence
feat/dev/test/prod  = environment position
repo docs           = repository-specific current contract / reference / evidence
```

历史 project-control 材料仍应可追溯，不要求为了迁移而批量重写原始 task、review 或 evidence。旧 active path 若会持续冒充当前管理真相，应至少降级为 Historical / Superseded / compatibility entry，并指向正确 owner。

当稳定工程结论改变产品/runtime事实时，仍要在真实核验后回写对应 current-contract；不要把整个施工过程复制进当前真相页，也不要把 GitHub 已拥有的 Status、Priority、Effort、日期、assignee 等管理元数据复制进 prose。

某个领域 Runtime 可以拥有自己的 repository-native task-source / ledger / card 协议，但必须把它写成**领域输入协议**，不能因此覆盖 Mira Organization 的 GitHub work-item source of truth。

## 8. 归档

归档规则见 [[../archive/README]]。

能只改状态解决的问题，不为了目录整齐强行移动；会持续误导当前实现的旧页，必须至少做站点级归档。

## 9. 写作规则

- 先写结论，再写背景；
- 严格区分“已经实现”和“设计意图”；
- 避免“未来会”“理论上支持”混进当前能力列表；
- 当前契约尽量给代码锚点和验证方式；
- 同一概念只保留一个 Canonical 定义；
- 旧方案被替代时，明确写出替代页；
- 不用文档数量冒充知识质量。
