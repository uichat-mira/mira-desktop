# 文档系统收尾清单

Status: Current
Owner: docs
Last verified: 2026-06-27
Layer: schema
Module: Docs
Feature: DocsSystem
Doc Type: checklist

## 目的

把当前这一轮文档系统改造收成一条可以真正封箱的执行清单。

这份清单不再讨论抽象方向，而是只记录：

- 今天必须收掉哪些事
- 哪些事算本轮完成
- 哪些事明确留到下一轮

## 本轮收尾目标

本轮的目标不是把整套系统做成终局版，而是完成下面三件事：

1. 把分类规则定成稳定 schema
2. 让核心活跃文档按 schema 可被人和 AI 同时读懂
3. 让文档站开始按新规则展示，而不是继续让根目录兜底分类主导阅读
4. 让主线文档先进入 `Module + Feature` 可消费状态

## 收尾原则

- 先定规则，再调展示
- 先收核心文档，再谈全量覆盖
- `archive/` 默认继续隔离
- `专题文档` 不再作为长期正式分类，只允许作为待归并兜底

## Checklist

### A. 分类 schema 定版

- [x] 明确本轮继续沿用 `Layer / Module / Doc Type / Status`
- [x] 明确顶级 `Module` 改为 `Chat / ModelSetting / MCP / Tool / KnowledgeBase / Role / Docs / Develoments`
- [x] 正式引入 `Feature` 维度，并允许暂时为空
- [x] 明确 `Status` 的推荐词表和站点映射关系
- [x] 明确 `Doc Type` 到站点状态区块的映射关系
- [x] 明确哪些字段是当前强约束，哪些字段是下一轮再补
- [x] 明确状态维度的站点表达口径：先读这里 / 正在实施 / 规划中 / 历史归档
- [x] 明确模块维度只表达业务归属，不和状态维度混层
- [x] 明确 `专题文档` 在站点中降级为“待归类”而不是正式主入口
- [x] 明确“根目录散页允许存在，但不应主导阅读入口”的长期规则

细化说明：

- `Layer` 继续回答“它属于哪一层”
- `Module` 继续回答“它主要在讲谁”
- `Feature` 继续回答“它在该模块里具体是哪块功能”
- `Doc Type` 继续回答“它是什么角色的文档”
- `Status` 要开始更明确回答“它当前是现状、实施中、规划中还是历史”

当前强约束：

- `Layer`
- `Module`
- `Doc Type`
- `Status`

当前已正式引入、但允许逐批补齐：

- `Feature`

当前仍属增强字段：

- `Owner`
- `Last verified`
- `Canonical`
- `Related`

建议的站点映射先固定成：

- 先读这里：
  - `current-contract`
  - `overview`
  - `reference`
- 正在实施：
  - `checklist`
  - `implementation-notes` 中明确仍在 active 状态的页面
- 规划中：
  - `plan`
  - `draft`
  - 尚未成为现状的 `design`
- 历史归档：
  - `historical`
  - `archive/`

完成标准：

- schema 文档中能直接回答“人类怎么读、AI 怎么读、站点怎么分组”

### B. 全量文档元数据收口

- [x] 全量活跃文档补齐并统一 `Layer / Module / Feature / Doc Type / Status`
- [x] 全量历史文档明确进入 `historical` 口径或归档口径
- [x] 全量根目录文档逐篇判断主模块与文档角色
- [x] 全量文档清理词表外 `Status / Module / Doc Type`
- [ ] 核心真相页额外补强 `Owner / Last verified / Canonical / Related`

这一块不再按“只收核心页”理解，而是按“全库进入统一分类体系，但分批推进”执行。

#### Batch 1：核心阅读链路

目标：

- 先把最常被人和 AI 读到的页面彻底收稳

范围：

- [x] `docs/README.md`
- [x] `docs/VAULT_HOME.md`
- [x] `docs/WIKI_SYSTEM_SCHEMA.md`
- [x] `docs/knowledge-system/KNOWLEDGE_SYSTEM_INDEX.md`
- [x] `docs/knowledge-system/DOCUMENTATION_STANDARDS.md`
- [x] `docs/knowledge-system/DIRECTORY_AND_CLASSIFICATION_RULES.md`
- [x] `docs/knowledge-system/IMPLEMENTATION_ROADMAP.md`
- [x] `docs/architecture/README.md`
- [x] `docs/architecture/ipc-and-preload.md`
- [x] 原 Tauri 平台文档（DSK-011 已退役，Git 历史可查）
- [x] `docs/uchat.md`
- [x] `docs/uchat-internal-maintenance.md`

验收：

- 这些文档不再靠目录名让 AI 猜用途
- 文档站首页、搜索、单页状态提示都能稳定消费这些字段
- 主线入口页开始具备稳定 `Feature`

当前状态：

- [x] Batch 1 已完成

#### Batch 2：各 area 入口页

目标：

- 把每个稳定业务域的入口页补齐并定成主阅读点

范围：

- [x] `docs/knowledge-base/README.md`
- [x] `docs/evaluation/README.md`
- [x] `docs/provider/README.md`
- [x] `docs/role/README.md`
- [x] `docs/architecture/README.md`
- [x] 原 Tauri 平台文档（DSK-011 已退役，Git 历史可查）
- [x] `docs/tooling-runtime/README.md` 或等价入口页
- [x] `docs/maps/AREA_MAP_CHAT.md`
- [x] `docs/maps/AREA_MAP_RUNTIME.md`
- [x] `docs/maps/AREA_MAP_KNOWLEDGE_BASE.md`

验收：

- 每个主模块都有明确入口
- 文档站“按模块阅读”不再依赖根目录散页充当入口

#### Batch 3：根目录散页与待归类页

目标：

- 持续缩小根目录兜底区，让“待归类”只剩真正未决页

动作：

- [x] 对根目录兜底页逐篇判断主模块
- [x] 对根目录兜底页逐篇判断 `plan / checklist / draft / historical / reference`
- [x] 识别哪些页应该迁移进稳定目录
- [x] 识别哪些页虽然暂时留根目录，但逻辑上已经不该算“专题”

验收：

- `UNCATEGORIZED_TRACKER.md` 中的页面数量持续下降
- 文档站中的“待归类”只剩少量治理中页面

#### Batch 4：规划 / 缺陷 / 接入类文档

目标：

- 把最容易污染默认阅读和 AI 默认判断的工作流类文档收干净

范围：

- [x] `planning` 相关页面
- [x] `bugfix` 相关页面
- [x] `checklist / poc / plan / draft` 类页面
- [x] 第三方接入与企业集成相关页面

验收：

- “规划中 / 正在实施 / 历史归档” 三个状态入口的信号足够稳定
- 不再混入大量本应属于当前契约入口的页面

当前状态：

- [x] Batch 4 已完成

#### Batch 5：全库扫尾

目标：

- 对全库做最后一轮一致性清理

动作：

- [x] 扫全库词表外 `Status`
- [x] 扫全库词表外 `Module`
- [x] 扫全库词表外 `Doc Type`
- [x] 扫缺头部字段的活跃文档
- [ ] 扫错误或模糊的历史状态标注
- [x] 已完成一轮历史状态模糊页清理

验收：

- 全量活跃文档都进入统一元数据体系
- 词表漂移不再成为文档站和 AI 读取噪音来源

### C. 文档站表达改造

- [x] 首页保留“核心目录层”
- [x] 首页增加按状态阅读的入口
- [x] 首页保留按模块阅读的入口
- [x] 首页把“专题入口”降为补充区，不再承担主导航职责
- [x] 左侧导航改成按规则分组，而不是完全按路径兜底
- [x] 在左侧显式提供“状态入口”和“模块入口”
- [x] 在左侧开始提供“按功能”阅读入口
- [x] 把“待归类”从首页扩展到导航层可见
- [x] 让单篇页更明确展示该文档属于哪个状态区块
- [x] 首页开始显式展示 `Module + Feature` 关系

首页层面要达成：

- [x] 人类能先看到“核心目录层”
- [x] 人类能看到“按状态阅读”
- [x] 人类能看到“按模块阅读”
- [x] 根目录散页不再伪装成正式主入口

导航层面后续要达成：

- [ ] 不再默认把“按路径树”当成唯一导航
- [ ] 保留路径树作为补充视图，而不是唯一主视图
- [x] 首页、左侧导航、单页元数据三处已开始统一消费 `Module + Feature`

完成标准：

- 人类第一次进入站点时，能直接回答：
  - 先读什么
  - 什么是现状
  - 什么在实施中
  - 什么只是规划
  - 这个文档属于哪个业务模块

### D. 本轮明确不做

- [x] 不做 raw / wiki / schema 三层物理总搬迁
- [x] 不做语义检索
- [x] 不做知识图谱主入口
- [x] 不追求一次收完全库
- [x] 不做无约束自动写回
- [x] 做受控文档写回

补充说明：

- 本轮目标是先把“分类规则 + 站点表达”收稳
- 不是把知识系统所有高级能力一起做完
- 文档整理 AI 仍然应当可以在受控边界内直接修正文档

### E. 受控写回原则

- [ ] AI 可以直接修 schema、wiki、索引入口和活跃文档元数据
- [ ] AI 不应无依据改写 raw-source 的事实正文
- [ ] AI 发现分类错误、状态错误、入口错误时应直接修正
- [ ] AI 做写回时要优先保留溯源关系，不把 source 改写成总结腔
- [ ] AI 写回的重点是：
  - 元数据补齐
  - 分类修正
  - 入口页整理
  - 待归类收缩
  - wiki 层综述和概念页维护

## 今日建议顺序

1. 更新 schema 规则文档
2. 更新文档站首页分组口径
3. 重新生成索引
4. 左侧导航按状态/模块继续改造
5. 记录剩余待归类文档
6. 明确下一轮优先级

## 剩余待完成

### 1. 规则层剩余项

- [x] 给 `Status` 固定推荐值表
- [x] 把 `Doc Type -> 状态区块` 映射写成更明确规则
- [x] 判断需要从 `Module` 进一步演化到 `Module + Feature`
- [ ] 在新顶级 `Module` 下继续沉淀二级功能树与 feature 口径

### 2. 文档层剩余项

- [x] 完成 Batch 1：核心阅读链路
- [x] 完成 Batch 2：各 area 入口页
- [x] 完成 Batch 3：根目录散页与待归类页第一轮物理收口
- [x] 完成 Batch 4：规划 / 缺陷 / 接入类文档
- [ ] 完成 Batch 5：全库扫尾

当前已推进：

- [x] Batch 1 第一批核心阅读链路页已补 `Canonical / Related`
- [x] 第一批关键规划/接入类页面的 `Status` 统一收回推荐词表
- [x] 第一批偏第三方接入页面的 `Module` 收回稳定主模块
- [x] 文档站待归类逻辑开始排除已经有稳定模块的根目录页
- [x] 继续清理词表外 `Status / Module` 残留
- [x] 新增 `UNCATEGORIZED_TRACKER.md` 作为待归类治理页
- [x] 顶级 `Module` 骨架收口到 `Chat / ModelSetting / MCP / Tool / KnowledgeBase / Role / Docs / Develoments`
- [x] `Feature` 已接入 schema、索引器、docs-site 类型和单页展示
- [x] 主线入口文档已开始补 `Feature`
- [x] 全库 markdown 已补齐 `Feature` 头部字段
- [x] 企业接入 / wecom / lark / third-party 专题线已收口到稳定 `Feature`
- [x] Chat 主线第一批已补 `UChat / ToolIntegration`
- [x] KnowledgeBase 主线第一批已补 `Overview / KnowledgeBaseAPI / BackendSchema / MarkdownWorkspace`
- [x] Role 主线第一批已补 `Overview / RoleAPI / RolePage / ChatIntegration / PromptInjection / RagIntegration / ToolIntegration / Migration / Recovery`
- [x] ModelSetting 主线第一批已补 `ProviderIntegration / ProviderStandards / ProviderProxy / ModelConfig`
- [x] Tool 主线第一批已补 `HarnessRuntime / ReadSkill / ToolsProtocol / ToolsEcosystem / ToolRuntime / PromptManager / TerminalCapability`
- [x] MCP 主线第一批已补 `ExternalMarketplace`
- [x] Docs 主线第一批已补 `DocsSystem`
- [x] Develoments 主线第一批已补 `RuntimeArchitecture / NativeBridge / ApiContract / RagNode / RagFlow / EvaluationWorkbench / PlatformRuntime / Concepts / ReleaseManagement / RequestWrapper / EngineeringStandards / FrontendI18n`
- [x] 历史跳转页、archive 页与 assets 页已补齐最小 `Feature`
- [x] 第一批企业接入专题页已物理迁入 `docs/integrations/`
- [x] 第一批开发支撑正文已物理迁入 `docs/developments/`

### 3. 站点层剩余项

- [x] 左侧导航按规则重分组
- [x] 搜索结果增加更明确的状态提示
- [x] 单页增加“属于哪个阅读区块”的提示
- [x] 单页与搜索结果开始支持 `Feature`
- [x] 待归类文档做单独聚合页

### 4. AI 接入前置项

- [ ] 让索引器输出更完整的 `status / docType / module / feature` 聚合信息
- [x] 索引器已输出基础 `module / feature` 聚合信息
- [x] 默认读取优先级已开始按 current / canonical / non-historical 倾斜
- [x] historical 内容已开始默认降噪

## 本轮完成后应达到的状态

- 文档系统已经有稳定分类骨架
- 文档站已经开始表达这套骨架
- 后续新增业务模块时，不需要推翻整个站点结构

## 下一轮再做

- 把“待归类”进一步压缩
- 继续补核心模块文档
- 继续补核心真相页的 `Owner / Last verified / Canonical / Related`
- 判断企业接入 / third-party / wecom / lark 是否单独沉淀 feature 族
- 让索引器和站点更深消费 `Doc Type / Status`
- 设计文档问答接入层
