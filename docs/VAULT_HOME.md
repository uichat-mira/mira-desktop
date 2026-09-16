---
status: current
owner: docs
last_verified: 2026-09-16
layer: wiki
module: Docs
feature: EngineeringVault
doc_type: overview
canonical: true
related:
  - README.md
  - CURRENT_PRODUCT_TRUTH.md
  - ENGINEERING_MEMORY.md
  - project-control/README.md
---

# UIChat Mira Engineering Vault

这是给 Obsidian、工程检索和长期维护使用的工作区入口。

**Vault 不是产品真相首页。** 它会同时收录当前契约、施工记录、研究、POC、决策和历史材料。阅读任何页面前，先看生命周期与核验状态。

## 当前事实入口

- [[CURRENT_PRODUCT_TRUTH]]
- [[ENGINEERING_MEMORY]]
- [[README]]
- [[harness/agentgraph-harness-protocol]]

## 模块地图

- [[maps/AREA_MAP_RUNTIME]]
- [[maps/AREA_MAP_CHAT]]
- [[maps/AREA_MAP_ROLE]]
- [[maps/AREA_MAP_KNOWLEDGE_BASE]]
- [[maps/AREA_MAP_PLATFORM]]

## 核心模块

- [[skill/README]]
- [[tooling-runtime/README]]
- [[provider/README]]
- [[knowledge-base/README]]
- [[evaluation/README]]
- [[microapp/README]]
- [[platform/tauri]]

## 工程工作项与历史证据

当前 Mira Organization 工程工作项的合同与结果由 GitHub Issue 持有，GitHub Project `Status` 只表达 `Todo / In Progress / Done` 管理位置。Vault 不维护第二套 master ledger / workboard。

- [[project-control/README]]：组织化之前的 task、review、decision、phase conclusion 与验证证据索引，以及旧路径兼容入口；
- [[developments/defect-log]]：缺陷与排障资料；是否仍代表当前行为必须回到代码、current contract 或对应 GitHub Issue 核验。

`project-control/` 中保留下来的旧 ledger / task-card / workboard 可以继续作为工程历史和实现证据被引用，但不能覆盖当前 GitHub work-item contract、Project lifecycle 或 current-contract。

## 知识系统

- [[knowledge-system/KNOWLEDGE_SYSTEM_INDEX]]
- [[knowledge-system/DOCUMENTATION_STANDARDS]]
- [[knowledge-system/AI_READING_SCOPE]]

## 历史与方案

- [[archive/README]]

历史、计划和 POC 会继续保留，但默认不进入当前事实入口。
