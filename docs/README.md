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
  - CURRENT_PRODUCT_TRUTH.md
  - PROVIDER_CURRENT_TRUTH.md
  - KNOWLEDGE_BASE_CURRENT_TRUTH.md
  - EVALUATION_CURRENT_TRUTH.md
  - AGENT_CURRENT_TRUTH.md
  - TOOL_CURRENT_TRUTH.md
  - MICROAPP_CURRENT_TRUTH.md
  - ENGINEERING_MEMORY.md
  - VAULT_HOME.md
  - archive/README.md
  - knowledge-system/DOCUMENTATION_STANDARDS.md
---

# UIChat Mira 项目文档入口

这套文档站直接读取主仓库 `dev` 分支的 `docs/`。

它的首要职责不是展示“写了多少文档”，而是让人快速判断：

- 什么是当前真实能力；
- 什么仍在施工；
- 什么只是方案或 POC；
- 什么已经归档；
- 什么尚未核验；
- 当前代码是否偏离 settled contract。

> 工程工作项的合同与结果由 GitHub Issue 持有；GitHub Project `Status` 只表达粗粒度生命周期位置；Organization Issue Fields 持有 Priority、Effort、日期等结构化规划元数据。`docs/project-control/` 中保留的旧 task / review / ledger / workboard 主要是工程历史、实现与验证证据，不再是 Mira Organization 的当前 master ledger。

## 先读这九页

1. [[CURRENT_PRODUCT_TRUTH]]：产品能力、边界与稳定迭代阶段；
2. [[PROVIDER_CURRENT_TRUTH]]：首次模型配置、Provider Connection、角色绑定、运行解析与已知漂移；
3. [[KNOWLEDGE_BASE_CURRENT_TRUTH]]：知识库、入库、索引、混合检索、RAG 与接入边界；
4. [[EVALUATION_CURRENT_TRUTH]]：评测包、Dataset、Run、指标、报告与恢复边界；
5. [[AGENT_CURRENT_TRUTH]]：Agent、SubAgent、终止语义与已知漂移；
6. [[TOOL_CURRENT_TRUTH]]：Tool / Harness 公共面、暴露、审批、执行与降级；
7. [[MICROAPP_CURRENT_TRUTH]]：MicroApps Hub、Integration MicroAPP、Studio、Tool / Skill 接入与成熟度；
8. [[ENGINEERING_MEMORY]]：工程共同记忆和不可破坏的合同；
9. [[knowledge-system/DOCUMENTATION_STANDARDS]]：文档如何进入当前、施工、计划或历史区。

新安装首先阅读 [[provider/FIRST_MODEL_SETUP]]，不要先尝试一次配齐所有模型角色。

## 五类文档

### 当前真相

已经核验的 current-contract、current-snapshot、总纲和稳定参考。

当前真相必须：

- 明确 Owner；
- 有 Last verified；
- 有代码或验证依据；
- 区分 settled contract 与已知实现偏差。

`last_verified` 只代表正文事实/合同被真实核验过的时间，不能因为文件被编辑就自动刷新。只做 metadata / authority 检查时，可以记录 `freshness_audited`，但不能把它冒充完整技术核验。

### 施工与验证资料

仓库里仍可以存在 implementation notes、checklist、acceptance / regression evidence 等服务当前实现与验证的材料。

它们说明“施工或验证发生了什么”，不自动等于产品已经具备什么，也不拥有当前工程工作项的合同、结果或生命周期。新的 Mira Organization 工程工作项使用 GitHub Issue；Project `Status` 管理 `Todo / In Progress / Done` 投影。

### 方案与实验

design、plan、research、roadmap、draft、POC。

它们保留思路和决策输入，不能被首页、搜索或 Agent 当成当前事实优先使用。

### 历史归档

Historical、Archived、Superseded、Deprecated、Completed，以及 `archive/` 内容。

它们只用于追溯背景。

### 待核验

缺少可信状态、文档类型或核验信息的页面。

待核验不是“默认当前”，而是明确不确定区。

## 当前模块入口

- [[dashboard/README]]：Mira 工作台天气 Widget 数据契约；
- [[PROVIDER_CURRENT_TRUTH]]：Provider、模型角色与调用总真相；
- [[provider/FIRST_MODEL_SETUP]]：第一次模型配置；
- [[provider/README]]：Provider 模块阅读入口；
- [[KNOWLEDGE_BASE_CURRENT_TRUTH]]：Knowledge Base、索引与 RAG 总真相；
- [[knowledge-base/README]]：Knowledge Base 模块阅读入口；
- [[knowledge-base/rag-runtime]]：RAG Runtime；
- [[EVALUATION_CURRENT_TRUTH]]：Evaluation 总真相；
- [[evaluation/README]]：Evaluation 模块阅读入口；
- [[evaluation/workbench]]：评测工作台与中心；
- [[evaluation/package-format]]：评测 ZIP 合同；
- [[evaluation/runtime]]：Run 生命周期；
- [[evaluation/metrics]]：指标算法语义；
- [[AGENT_CURRENT_TRUTH]]：Agent 总真相；
- [[TOOL_CURRENT_TRUTH]]：Tool / Harness 总真相；
- [[MICROAPP_CURRENT_TRUTH]]：MicroApp 总真相；
- [[harness/agentgraph-harness-protocol]]：AgentGraph、Harness、Evidence 与委派技术协议；
- [[harness/README]]：Harness 控制平面；
- [[tooling-runtime/README]]：Tool 模块阅读入口；
- [[tooling-runtime/tools-protocol]]：Tool 技术协议；
- [[skill/README]]：Skill 当前定义与 SubAgent 执行边界；
- [[skill/pi-skill-agent-execution]]：SubAgent 详细参考；
- [[development/agent-observability]]：Agent / SubAgent 观测与诊断；
- [[microapp/README]]：MicroApps Hub、Integration binding、Studio 与领域 Runtime 入口；
- [[chat/README]]：Chat 与 Agent UI 入口；
- [[platform/tauri]]：Tauri 平台路径；
- [[platform/macos-implementation-phases]]：macOS 支持缺口、改造进度与验收门槛（Proposed，不代表当前已支持）。

下面各模块中的 `project-control evidence` 均指旧 task / review / test / decision 等**历史或实现证据**。它可以帮助追溯某个结论怎样形成，但不拥有当前 GitHub work-item contract、Project lifecycle 或 Organization management metadata。

## Provider 文档引用规则

```text
current code + repeatable tests
  -> PROVIDER_CURRENT_TRUTH
  -> provider/FIRST_MODEL_SETUP（用户首次配置）
  -> provider/README
  -> architecture/provider-api-standards
  -> architecture/provider-proxy-api
  -> project-control evidence
  -> design / optimization note / historical
```

Provider 阅读必须区分：

```text
Provider Template
Provider Connection
ProviderModel Cache
Model Role Assignment
Provider Resolution
Protocol Adapter
Runtime Invocation
```

还必须区分：

```text
已保存模型绑定
!= 最近一次模型目录同步成功
!= 真实业务调用成功
```

## Knowledge Base 文档引用规则

```text
current code + repeatable tests
  -> KNOWLEDGE_BASE_CURRENT_TRUTH
  -> knowledge-base/README
  -> knowledge-base/api
  -> knowledge-base/backend-schema
  -> knowledge-base/rag-runtime
  -> Provider / Agent / Evaluation current contract
  -> project-control evidence
  -> design / historical
```

Knowledge Base 阅读必须区分：

```text
Knowledge Base
Document
Chunk
Vector Index
Lexical Index
RAG Runtime
Evaluation
Agent / Integration Access
```

还必须区分：

```text
上传请求成功
!= 文档索引 ready
!= 真实检索命中
!= 最终回答正确
```

## Evaluation 文档引用规则

```text
current code + repeatable tests
  -> EVALUATION_CURRENT_TRUTH
  -> evaluation/README
  -> evaluation/workbench
  -> evaluation/package-format
  -> evaluation/runtime
  -> evaluation/metrics
  -> Knowledge Base / Provider current contract
  -> project-control evidence
  -> historical
```

Evaluation 阅读必须区分：

```text
Evaluation Package
Evaluation Dataset
Evaluation Run
Sample Result
Attempt
Metric Summary
Client-side Report
```

还必须区分：

```text
评测模型
!= Judge Model

评测包
!= Frozen Knowledge Base Snapshot

Run 已持久化
!= Run 可重启恢复

Metric Label
!= Current Formula
!= Standard Benchmark
!= Release Gate
```

任何指标说明必须以 [[evaluation/metrics]] 中的当前代码公式为准，不能仅凭名称推断标准实现。

## Agent 文档引用规则

```text
current code + repeatable tests
  -> AGENT_CURRENT_TRUTH
  -> agentgraph-harness current contract
  -> Skill / observability current reference
  -> GitHub Issue contract / PR-review-CI evidence（当前工作）
  -> project-control historical task / checklist / review evidence
  -> design / plan / historical
```

## Tool 文档引用规则

```text
current code + repeatable tests
  -> TOOL_CURRENT_TRUTH
  -> harness current overview / Agent-Harness protocol
  -> tooling-runtime/tools-protocol
  -> capability detail / runbook
  -> project-control evidence
  -> design / plan / historical
```

## MicroApp 文档引用规则

```text
current code + repeatable tests
  -> MICROAPP_CURRENT_TRUTH
  -> microapp/README
  -> concrete runtime contract / current notes / smoke guide
  -> project-control evidence
  -> proposal / POC / historical
```

MicroApp 阅读必须另外区分：

```text
产品入口
共享 definition
领域 Runtime
Integration invoke
Agent Tool / Skill access
```

其中任一层成立都不能替代其余层。

发现代码与 settled contract 不一致时，必须写清：

- 目标合同；
- 当前实现；
- 用户影响；
- 修复是否完成。

不得把实现回归包装成新合同，也不得用目标合同假装代码已经正确。

## 工程工作区

[[VAULT_HOME]] 是 Obsidian / 工程资料工作区入口。

它包含地图、概念、实现与验证资料、决策和历史项目控制材料，因此不等于产品真相首页。进入工作区后仍要遵守生命周期标记和当前 Organization source-of-truth 边界。

## 文档站规则

- YAML frontmatter 与旧式 `Status:` 头部都可识别；
- 状态冲突时 Historical / Superseded 优先于 current doc type；
- 缺状态不会自动进入“先读这里”；
- 当前文档超过 90 天未核验会被标记；
- `freshness_audited` 只表示 freshness / authority / identity 被审计，不等于正文技术事实重新核验；
- `project-control/` 在 Organization 迁移后主要是历史 task、review、decision、phase conclusion、验证证据和旧路径兼容区，不是当前工程 master ledger；
- GitHub Issue / Project Status / Organization Issue Fields / PR-review-CI 各自拥有工作合同、生命周期、规划元数据和实现验证证据，不复制成第二套 prose 管理系统；
- 文档路径不代表可信度，生命周期与验证证据才代表可信度；
- Current 文档发现实现漂移时，必须显式记录，而不是静默改写合同。

## 归档

归档规则见 [[archive/README]]。

- Provider 历史：[[archive/provider/README]]；
- Knowledge Base 历史：[[archive/knowledge-base/README]]；
- Evaluation 历史：[[archive/evaluation/README]]；
- Agent 历史：[[archive/agent/README]]；
- Tool 历史：[[archive/tool/README]]；
- MicroApp 历史：[[archive/microapp/README]]。
