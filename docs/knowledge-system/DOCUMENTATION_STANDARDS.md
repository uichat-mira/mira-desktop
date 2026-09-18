---
status: current
owner: docs
last_verified: 2026-09-19
layer: schema
module: Docs
feature: DocsSystem
doc_type: current-contract
canonical: true
related:
  - ../README.md
  - ../CURRENT_PRODUCT_TRUTH.md
  - ../archive/README.md
---

# UIChat Mira 文档规范

这份规范定义 `docs/` 如何同时服务人类开发者、AI 工具和内置文档站。

目标不是让所有文档格式完全一致，而是让任何读者都能先判断：**这页可信到什么程度。**

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

### Active：施工与验证

适用于：

- checklist；
- workboard；
- ledger；
- implementation notes；
- acceptance / regression；
- active task card。

Active 表示“正在推进”，不表示“已经成为产品能力”。

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
- `last_verified`：最后一次与代码或真实决策核对的日期；
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

## 7. 项目控制区

`docs/project-control/` 现在只作为历史工程证据与决策归档：

- historical task cards；
- evidence；
- review；
- decision；
- archived workboard / ledger；
- archive snapshot。

它不是当前项目管理系统，也不能代替 current-contract。新的工程 work item 进入 GitHub Issue / Project，不再维护 repository-local master ledger 或 workboard。

历史任务收口后，稳定结论回写对应 current-contract；施工过程保留为证据，不复制成第二套当前真相。

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
