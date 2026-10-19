# 连接器页面整合 Implementation Plan

Status: Completed
Owner: desktop
Last verified: 2026-10-19
Layer: raw-source
Module: MCP
Feature: Connectors
Doc Type: plan
Canonical: false

> 执行时使用 `superpowers:executing-plans`，按任务逐项推进。未勾选项不代表已经实现。

**Goal:** 将侧边栏 MCP 改为“连接器”，统一承接内置功能入口、外部 MCP 管理和市场发现。

**Architecture:** 迁移现有设置页 MCP 业务内容至 Extensions/Connectors，使用应用级页面布局。保留现有后端 API、配置、连接、发现与 Agent Access 合同。

**Tech Stack:** React、TypeScript、React Router、现有共享 UI、Vitest、pnpm workspace。

**Spec:** 本文“已确认设计”，来源为项目所有者在当前对话中确认并要求实施的方案。

## 已确认设计（首轮记录）

本节是首轮方案记录；当前有效 UI 方案以文末“后续调整：四视图与自定义 MCP 配置”为准。

- 两个页签：“我的连接器／市场”，默认“我的连接器”；通过 URL 的 `tab=marketplace` 直达市场，其他值按主页处理。
- 我的连接器使用卡片，提供“全部／内置／外部 MCP”筛选及搜索；两个页签分别保留搜索条件。
- 七个内置入口：知识库、GitHub、Notion、邮件中心、观澜、触界、CodeGraph。跳转已有页面，移除原型连接状态；触界对应 `jian-xing`。
- 外部 MCP 卡片显示真实名称、描述、连接状态、能力数量及 Agent Access；连接成功和 Agent 授权分别展示。
- 管理抽屉承接配置、连接、发现能力、Agent Access、删除和能力列表。按服务器 ID 读取最新数据；删除成功关闭抽屉。
- 市场保留现有搜索、分类、接入方式筛选、分页、同步提示和详情抽屉。按服务器 ID 判断已接入，显示“管理”而不是重复接入。
- 接入成功切回主页，清除阻挡条目展示的筛选并打开其管理抽屉；失败保留市场上下文并显示错误。

## Global Constraints

- 允许改动：连接器前端、路由、导航、中英文文案、相关测试与文档。
- 不扩展内置服务统一状态、授权或手动接入能力；不改变后端 API、数据库、权限规则、审批与执行语义。
- 复用共享 UI 和语义 token；不修改共享 UI 组件合同。
- 新主路由 `/extensions/connectors`；旧 `/extensions/mcp` 跳转主页，旧 `/settings/mcp` 跳转新市场页签。
- 设置导航移除重复 MCP 市场入口，能力页管理链接更新；中文“连接器”、英文“Connectors”，技术详情保留 MCP 用语。
- 当前产品事实文档在实现验收后才更新入口说明。

## Review Focus

- 列表刷新失败时保留已知数据和错误提示，不伪造连接状态。
- 接入失败保留市场页签与搜索，重复点击不创建重复接入请求。
- 已连接但未获 Agent Access 不应显示为已授权。
- 管理抽屉刷新、配置及删除后不保留旧服务器快照。
- 路由前进后退、未知页签及旧链接均进入正确视图；抽屉上方配置弹窗可操作。

### Task 1: 迁移真实 MCP 页面内容

**Files:** `desktop/src/features/Settings/pages/Mcp/**` → `desktop/src/features/Extensions/Connectors/**`。

- [x] 迁移数据加载、市场面板、配置弹窗、详情抽屉和管理操作，去掉设置页面外壳。
- [x] 迁移现有 MCP 测试，保留安装、配置、发现、授权和市场筛选的行为断言。
- [x] 使用应用级页面布局，按职责拆分卡片目录与管理抽屉。

### Task 2: 实现连接器主页与管理抽屉

- [x] 将原型卡片改为七个真实功能入口，完成卡片、筛选和搜索。
- [x] 将真实 MCP 数据接入卡片及管理抽屉，分别展示连接与 Agent Access 状态。
- [x] 完成接入成功定位、已接入判断、失败提示、重复提交保护、数据刷新与删除关闭。
- [x] 验证市场和主页分别保留搜索条件，刷新失败显示可重试错误。

### Task 3: 收口导航与文档

**Files:** `desktop/src/app/routes/**`、`desktop/src/app/Layouts/AppNavigationRail*`、中英文 i18n、能力页管理链接，以及相关产品文档。

- [x] 更新侧边栏名称、图标语义与选中态，增加新路由及旧地址跳转。
- [x] 移除设置重复导航项，更新内部管理链接与中英文文案。
- [x] 实现验收后更新产品文档入口说明，不将未验证视觉效果写成已验收。

## 验证与完成条件

- 七个内置入口正确，页面没有原型状态；新旧路由、刷新、前进后退与未知页签恢复正确。
- 覆盖接入成功与失败、配置成功与失败、连接、发现、Agent Access、删除、刷新失败和抽屉数据同步。
- 已接入条目不重复安装，不支持的 transport 保持禁用；市场搜索、分页、筛选及同步提示保持原有行为。
- 检查浅色、深色、窄窗口，以及抽屉内配置弹窗的层级和关闭行为。
- 运行相关前端测试和 `pnpm --dir desktop typecheck`，记录实际结果；只有有证据时才勾选。

## 实施记录

- 2026-10-19：根据当前对话已确认方案建立计划，开始前工作区为干净的 `feat/ui-improvements`。


## 验证记录（2026-10-19）

### 变更证据

- `desktop/src/features/Extensions/Connectors/index.tsx`：真实 MCP 页面控制逻辑、URL 页签、独立搜索、安装和管理状态。
- `components/ConnectorCatalog.tsx`：七个内置入口与外部 MCP 真实卡片；`components/McpManagementDrawer.tsx`：按 ID 获取新数据的管理抽屉。
- 市场组件保留现有查询、分页、transport 与同步提示；已接入条目进入管理，接入请求有重复提交保护；同一查询刷新失败保留已有列表。
- 新路由、旧地址跳转、侧栏和能力页管理链接均已更新；中英文入口文案同步完成。
- 原型 MCP 页面及设置页实现已退出，真实实现归属 Extensions/Connectors。

### 自动验证

- 定向测试：7 个文件，88 项通过。包含连接器 25 项、能力页 17 项、导航 9 项、布局 3 项、独立路由 9 项、设置路由 18 项、能力映射 7 项。
- `pnpm --dir desktop typecheck`：通过。
- `git diff --check`：通过。
- 首轮完整 `pnpm --dir desktop test`：230 个文件通过、2 个文件失败；1289 项通过、4 项失败，另有 3 项未处理的 AbortSignal 异常。该轮之后新增/修正的连接器用例已包含在最终 88 项定向测试中，没有宣称完整测试集全部通过。

完整测试失败均位于未改动的测试文件，表现为 Node Request 与 jsdom AbortSignal 类型不兼容，以及对应跳转未完成：

1. `src/app/ChatApplicationStateBoundary.test.tsx`：`keeps the application chat state boundary mounted across workspace routes`。
2. `src/app/route-guards/routeGuards.test.tsx`：`redirects anonymous users to login`。
3. 同文件：`redirects authenticated users away from guest-only routes`。
4. 同文件：`redirects catch-all routes to the configured destination`。

### 浏览器验证

使用 `.test-artifact/connectors` 下隔离的前端入口和 API fixture，启动真实 Chrome 验证：

- 1280px 浅色、390px 浅色和深色页面，以及深色管理抽屉已检查截图。
- 窄窗口搜索、指南和抽屉内各操作按钮均在可见边界内，无水平页面溢出。
- 市场中已接入条目可进入管理抽屉。
- 配置弹窗可在管理抽屉上方编辑；保存被拒绝时保留弹窗和错误；取消后管理抽屉仍存在。
- 浏览器没有页面脚本异常。

测试日志、fixture 与截图保存在忽略目录 `.test-artifact/connectors/`；未放入业务源码。未调用真实外部 MCP 服务，未进行 Electron/Tauri 打包验收。

### 执行决策

- 复用本次对话已建立的干净 `feat/ui-improvements` 工作区；没有另外创建 worktree。
- 保留现有 MCP 领域翻译键，新增 `app.connectors` 承接新的产品文案，避免迁移时重写全部领域消息。
- 无 loader 的相关路由测试使用 MemoryRouter，避免 Node Request 与 jsdom AbortSignal 混用；未修改未涉及的聊天/鉴权测试，也未向产品代码添加环境兼容分支。
- 独立审阅指出的市场刷新丢失数据、内置搜索误报无结果两项问题，均先观察回归测试失败，再修正并通过最终定向测试。

### 尚未覆盖

- 真实服务的网络、凭据、Connect、Discover 与 Agent 实际调用未做现场联调；本次复用其现有后端契约。
- 完整前端测试集的上述环境失败仍需独立处理。


## 后续调整：单层目录与技能页布局（2026-10-19，已被下一版取代）

Status: Superseded by the four-view/custom MCP revision below

本节取代前文的两页签 UI 设计，沿用此前后端、接入与权限合同。

- [x] 合为“全部／内置／外部／已接入”四个快捷视图，默认全部；外部按 ID 合并安装记录和市场结果，保留市场之外的安装记录。
- [x] 取消外层大边框与第二层分类；参照技能页的轻量工具栏和双列卡片。整卡进入内置页面、管理抽屉或市场详情。
- [x] 搜索统一，回车提交、可清除，切换视图保留条件；只有全部和外部查询市场。
- [x] 市场分类/Transport/可接入筛选收进菜单，仅在外部生效，离开后不影响其他视图。
- [x] 接入后保留视图和搜索并打开管理；删除后有市场元数据则恢复为可接入卡片。
- [x] URL 使用 view=all|builtin|external|installed；未知值默认全部，旧 tab=marketplace 和 /settings/mcp 定位外部。
- [x] 验证去重、独立状态、已下架记录、筛选/搜索/分页/刷新失败、浏览器历史、浅深色与窄窗口。

后端 API、数据库和审批规则不变。分类未知的安装记录不假归类；读取安装记录失败时不把市场条目推定为未接入。


### 后续调整的实现与验证证据

- `Connectors/catalog.ts`：定义 ConnectorView、URL 解析和外部条目按 ID 合并投影，安装记录优先，市场之外的安装记录保留，已提交关键词本地筛选安装记录，未知分类不被假归类。
- `Connectors/components/ConnectorCatalog.tsx`：统一整卡交互和双列/单列布局；取消原卡片的管理按钮、技术详情堆叠和双层分类。
- `Connectors/components/ConnectorFilters.tsx`：外部专用分类、接入方式、可接入菜单；其他视图不应用其条件，返回外部恢复选择。
- `Connectors/index.tsx`：统一搜索、回车提交、清除、按视图加载市场、失败保留结果、加载更多、安装状态读取保护，以及保留视图/搜索的接入后管理。沿用原配置、连接、发现、Agent Access 和删除流程；移除被替代的 McpMarketplacePanel。
- `settingsRoutes.tsx` 与相关路由测试：旧设置地址定位 `?view=external`；旧 extensions/mcp 仍跳转全部，旧 tab=marketplace 由 URL 解析处理。
- 中英文文案与指南、CURRENT_PRODUCT_TRUTH 和 external-mcp-marketplace 已按单层视图更新。

最终定向验证（2026-10-19）：

- 8 个测试文件，119 项通过：连接器页面 39、目录/URL 投影 17、能力页 17、导航 9、布局 3、独立路由 9、设置路由 18、能力映射 7。
- `pnpm --dir desktop typecheck` 通过；`git diff --check` 通过。
- 使用隔离 API fixture 的真实 Chrome：1280px/390px、浅色/深色、统一市场卡片、已接入去重、整卡管理、未接入详情、不支持接入方式禁用、真实筛选菜单、抽屉上方配置弹窗编辑/错误/取消，均通过；无页面脚本异常和页面水平溢出。
- 独立审阅发现同步轮询的旧回调可能覆盖新搜索；另自查发现等待同步响应的旧刷新也有同类问题。两者均先通过失败用例复现，再加入请求上下文和生命周期校验，回归用例及最终定向测试通过，复审确认解决。刷新增加进行中保护。
- 另覆盖空市场页仍有 nextCursor 时继续加载、重复回车提交、分页失败保留数据/游标、删除后恢复市场卡片等边界。

日志与截图位于忽略目录 `.test-artifact/connectors-flat/`：`focused-final.log`、`typecheck-final.log`、`visual-final.log`、`visual-result.json` 以及页面/抽屉截图。首次完整前端测试的 4 个既有环境失败仍记录在上文；本次调整只复跑相关测试，没有宣称全量测试通过。未做真实外部服务联调或桌面打包。

## 后续调整：四视图与自定义 MCP 配置（2026-10-19）

Status: Completed

本节取代上一版“全部／内置／外部／已接入”设计；后端 API、数据库、审批与 MCP runtime 合同不变。

- 四个互斥视图为“已接入／内部／外部／自定义”，默认已接入。`view=installed|internal|external|custom` 保存视图；旧 `view=builtin` 映射内部、`view=all` 映射已接入；旧 `tab=marketplace` 和 `/settings/mcp` 定位外部，旧 `/extensions/mcp` 定位已接入。
- 已接入只展示真实安装记录，包含停用、失败、手动及市场来源记录；内部展示七个既有入口；外部只展示未接入市场服务，按 server ID 排除安装记录。首次安装记录读取失败时外部不展示可接入卡片，显示错误并提供重试。
- 搜索在四视图间保留；内部、已接入和自定义本地筛选，外部使用现有市场查询。市场分类、Transport 与可接入筛选只在外部生效。安装成功切换已接入，保留搜索并打开管理抽屉。
- 自定义通过本地/云端模式维护两份 JSON 编辑内容。单次 JSON 可包含多个同模式服务；本地验证 command/args/env，云端验证 HTTP(S) url/headers。格式化和确认均校验，错误不清空输入。
- 自定义确认只创建当前页面内存草稿，按模式和服务名更新，不保存浏览器存储、不调用后端或启动 MCP；草稿可以再次编辑和移除。

### 验收记录

- [x] 四视图状态、默认值、旧 view alias 和外部市场未接入筛选已有单元测试。
- [x] 自定义 JSON 解析、字段校验、格式化及草稿更新/移除已有单元测试。
- [x] 自定义界面测试覆盖模式间内容保留、错误输入保留及多服务提交；页面集成测试确认草稿增删不调用 MCP mutation API。
- [x] 已接入/市场状态隔离、首次安装记录读取失败、搜索、筛选、安装后跳转、分页、失败重试及浏览器历史由连接器页面测试覆盖。
- [x] 完成最新 UI 的浅/深色、宽/窄屏真实浏览器检查。
- [x] 完成最终定向测试、TypeScript 检查和 diff 检查并记录输出。

### 实施与验证结果

- 四视图、URL alias、市场按 ID 排除已接入、安装失败保护和接入后切换行为已落在 `desktop/src/features/Extensions/Connectors/index.tsx` 与 `catalog.ts`。
- 自定义 MCP 的 JSON 校验/格式化和会话草稿操作位于 `customDrafts.ts`；配置弹窗、行号编辑区和卡片分别位于 `components/CustomMcpConfigModalContent.tsx`、`components/CustomDraftCatalog.tsx`。
- 路由、中英文文案及 `CURRENT_PRODUCT_TRUTH.md`、`architecture/external-mcp-marketplace.md` 已同步更新。没有改动后端 API、数据库或 MCP runtime。
- 定向测试 10 个文件、142 项通过：连接器页面 40、目录/URL 20、自定义草稿 16、配置弹窗 3、导航 9、布局 3、能力页 17、能力映射 7、独立路由 9、设置路由 18。
- `pnpm --dir desktop typecheck` 通过；`git diff --check` 通过。
- 隔离 API fixture 的真实 Chrome 检查通过：1280px、390px、320px；浅色和深色；四视图默认与 ID 去重；外部详情及不支持接入；管理抽屉中的配置弹窗；本地/云端内容切换、格式化、提交、草稿编辑；无窄屏横向溢出、工具栏裁切或页面脚本异常。
- 真实 MCP 服务联调和 Electron/Tauri 打包未做；全量前端测试未在本版本重跑。之前记录的全量环境异常参见本计划前文。

浏览器脚本、结果和截图保存在忽略目录 `.test-artifact/connectors-flat/`，结果摘要为 `visual-result.json`。
