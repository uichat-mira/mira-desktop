# Computer Use 微应用 POC

> 历史设计快照（2026-07-06）。文中 Electron / Tauri 双壳讨论只记录当时的方案，DSK-011 已在 2026-10-31 退役 Tauri；当前桌面运行、原生桥接和发布仅以 Electron 为准。此文不作为当前实施指令。

Status: Historical
Owner: microapp / runtime / desktop
Last verified: 2026-07-06
Layer: raw-source
Module: MicroAPP
Feature: ComputerUse
Doc Type: design
Canonical: false
Related:
  - README.md
  - ../../architecture/README.md
  - ../../architecture/ipc-and-preload.md
  - ../../tooling-runtime/tools-protocol.md

## 单点真相范围

这页只回答一件事：

当前项目如果要做一个“调用 `computer-use` 帮用户操作界面”的微应用，第一版 POC 应该怎么收敛范围。

它覆盖：

- `computer_use` 这个 `MicroAPP` 的产品目标
- docs-only POC 的最小范围
- renderer / preload / backend / shell 的落点边界
- 为什么第一阶段更适合隔离浏览器或隔离执行面，而不是宿主桌面
- 批准、审计、回放和产物记录的最小契约
- 从文档进入实现时的切片顺序

它不覆盖：

- 任何本轮未批准的 runtime 实现
- 真实桌面输入注入和系统级自动化代码
- 长时录屏、远程协作和多租户调度系统
- 最终 UI 视觉稿

## Goal

这个 POC 的目标不是立刻做一个“万能桌面代理”，而是先验证四件事：

1. 当前桌面端架构能否安全承接一个高风险的 `computer-use` 微应用。
2. `MicroAPP` 是否可以把模型的界面操作能力收进受控业务工作流，而不是散落成一堆 native 调用。
3. 第一版是否能用最小链路做出“用户发出目标 -> 系统规划操作 -> 执行受控动作 -> 回放结果”的稳定闭环。
4. Electron、Tauri、backend 和前端之间，谁持有执行真相、审批真相和结果真相。

## 结论先说

建议把这次微应用正式命名为：

- `computer_use`

它是一个独立 `MicroAPP`，不是：

- chat 里一个随手调用的高危按钮
- renderer 直连原生自动化能力的快捷脚本
- Harness 里现成的 `browser_action` 历史类型别名
- Electron preload API
- Tauri capability 配置本身

它的最小产品闭环应该是：

```text
用户输入目标
  -> renderer 提交受控任务
  -> backend 生成可审计执行计划
  -> backend 触发隔离执行面动作
  -> backend 记录截图 / DOM 摘要 / 操作结果 / 失败原因
  -> renderer 展示过程回放与最终结果
```

当前建议先把它当成：

- 一个桌面内 `AccessPoint`

推荐命名：

- `desktop.computer_use_studio`

## 先说反对意见

如果你的预期是“先把宿主桌面代打跑起来，后面再补权限和审计”，我反对这么做。

原因不是保守，而是当前项目已有边界和 `computer-use` 的风险模型天然冲突：

- renderer 不能直接拿 Node 或原生权限。
- preload 只应该暴露最小必要面。
- backend 才是执行真相和审批真相的合适落点。
- `computer-use` 天生包含点击、输入、导航、外部发送、文件选择、可能的越权动作。

所以这个 POC 可以做，但不能写成“先糊一个桌面控制 demo 再说”。

## 为什么值得做

这个微应用的价值不只是“让模型会点鼠标”，而是它能很快验证一组当前项目还没有完全收稳的基础设施：

- 高风险动作的审批链
- 执行计划与真实执行对象的绑定
- trace / artifact / replay 的统一承载
- `MicroAPP` 和 Harness / MCP / shell 的边界
- Electron / Tauri 双壳下的最小权限暴露
- 聊天主链之外的受控工作流入口

如果这条链路打通，后续再扩：

- 网站操作
- 后台表单录入
- 文件上传
- 浏览器内多步任务
- 局部桌面操作

都会更有依据。

## 官方外部依据

当前这个 POC 的基本判断参考这些官方资料：

- OpenAI Computer Use guide
  - [platform.openai.com/docs/guides/tools-computer-use](https://platform.openai.com/docs/guides/tools-computer-use)
- Electron Security
  - [electronjs.org/docs/latest/tutorial/security](https://www.electronjs.org/docs/latest/tutorial/security)
- Electron contextBridge / preload
  - [electronjs.org/docs/latest/api/context-bridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- Tauri capabilities
  - [v2.tauri.app/security/capabilities](https://v2.tauri.app/security/capabilities/)
- Tauri permissions
  - [v2.tauri.app/security/permissions](https://v2.tauri.app/security/permissions/)

这些资料对本项目最重要的共同点不是“怎么调用”，而是：

- `computer-use` 需要受控执行环境
- 高影响动作需要人类审批
- 桌面壳层必须最小化前端权限面

## POC 原则

第一版必须故意收窄。

POC 原则：

- 先抽“隔离执行面 + 审批 + 回放”，不先抽“全桌面自动化”
- 先做浏览器内闭环，不先做宿主桌面闭环
- 先做显式动作列表，不先做自由输入注入
- 先把执行真相收在 backend，不把原生能力散给 renderer
- 失败要可解释，不做静默 fallback
- 所有截图、日志、结构化结果都要可回放
- 所有可能造成外部发送、文件写入、账号操作的动作都必须经过审批

## 第一阶段建议

第一阶段推荐的不是“直接操作本机桌面”，而是：

- `isolated_browser_computer_use`

更接地气的说法就是：

- 在受控浏览器会话里做 `computer-use`

原因：

1. 浏览器会话比宿主桌面更容易隔离。
2. 页面状态、截图、DOM 摘要更容易记录和回放。
3. Electron 与 Tauri 都更容易围绕 Web 内容建立一致边界。
4. 宿主桌面涉及窗口焦点、系统权限、密码框、文件选择器、通知弹窗和跨应用副作用，第一版风险太高。

## 不建议第一阶段做什么

第一阶段不建议做：

- 控制宿主桌面任意窗口
- 键盘全局输入注入
- 处理系统级文件选择器
- 处理密码输入与凭据代填
- 自动点击未知原生弹窗
- 后台静默运行长时桌面代理

这些不是永远不能做，而是当前项目在审批、恢复、审计、权限持久化都没闭环前，不适合先上。

## POC Success Criteria

当且仅当下面这些目标成立时，才能认为第一版 POC 成功：

1. 用户能在桌面端输入一个明确目标，例如“打开某个站点并完成一段站内操作”。
2. renderer 请求链路遵守当前项目规则：开发态走 `/api/...`，生产态走 `window.desktopApi.backendUrl`。
3. backend 能把用户目标收成结构化执行计划，并明确哪些步骤需要审批。
4. backend 能在隔离浏览器或等价隔离执行面里执行最小动作集。
5. backend 能持续产出截图、状态、失败信息和最终结果摘要。
6. renderer 能展示执行过程、等待审批状态和最终结果。
7. 不要求 renderer 直接持有桌面自动化权限。
8. 不新增未审计的 fallback 分支。

## Scope

### In scope

- 一个独立 `MicroAPP` 定义：`computer_use`
- 一个桌面内入口：`desktop.computer_use_studio`
- 一个受控任务模型：
  - 目标输入
  - 计划生成
  - 审批等待
  - 执行回放
- 一个隔离执行面适配器
- 一组最小动作定义
- 一套截图 / 结果 / 审批记录 artifact 模型

### Out of scope

- 宿主桌面任意窗口自动化
- 系统级剪贴板与全局热键编排
- 账号凭据托管
- 多租户远程浏览器池
- 自动绕过验证码
- 企业级风控平台

## 推荐第一条垂直切片

建议第一条垂直切片只做：

- 单目标
- 单浏览器会话
- 单页面或单站点任务
- 单次人工审批
- 单页结果回放

推荐用户流程：

1. 打开 `Computer Use Studio`
2. 输入目标
3. 系统生成执行计划
4. 用户批准高风险步骤
5. 执行隔离浏览器动作
6. 页面里看到截图流、步骤状态和最终结果

先把这条链路做稳，比一开始堆“跨应用桌面代打、自动上传下载、复杂表单录入”更重要。

## 为什么底座先抽审批和回放，不先抽动作大全

`computer-use` 真正难的不是“有没有 click / type / scroll 这几个动作”，而是：

- 哪些动作需要审批
- 审批批准的是哪一个冻结执行对象
- 执行后如何证明它确实点了哪里、输入了什么
- 执行失败后如何恢复或终止
- 刷新或重进后如何回放历史

所以第一版底座不应该先做“大而全动作库”。

应该先做：

- 统一任务生命周期
- 审批状态机
- 可回放 artifact
- 冻结执行对象

## 与当前仓库的关系

### 1. `MicroAPP` 不是 Harness capability

`computer_use` 是业务工作流单元。

它未来可以内部调用：

- 浏览器控制能力
- 截图能力
- DOM 抽取能力
- 审批能力

但它本身不等于某个 tool id。

### 2. `browser_action` 历史类型不等于当前可直接复用

当前仓库里还保留了 `browser_action` 域定义和历史文档痕迹。

但 `tools-protocol.md` 当前真相已经明确：

- Harness 当前主内置能力域是 `read`、`edit`、`web_search`、`terminal`
- `browser_action` 不是 Harness 当前主能力域

所以如果未来真做 `computer_use`，不能偷懒直接把历史 `browser_action` 当“已设计完成”。

### 3. renderer 不能拿执行真相

根据当前架构与 preload 约束：

- renderer 负责展示和交互
- preload 只负责最小 native 信息暴露
- backend 持有执行真相

所以：

- renderer 不应直接调用 Electron `webContents` 控制
- renderer 不应直接访问 Tauri plugin 能力
- renderer 不应自己判断哪些动作可以绕过审批

## 技术栈分层

当前这条微应用的技术栈建议直接分四层，不要混写：

### 1. `MicroAPP` 层

- 标识：`computer_use`
- 入口：`desktop.computer_use_studio`
- 职责：
  - 接收用户目标
  - 展示执行计划
  - 展示审批状态
  - 展示截图流、步骤状态和最终结果

这一层是产品工作流层，不直接拥有浏览器控制实现。

### 2. 编排层

- 落点：`server`
- 职责：
  - 把用户目标收成结构化任务
  - 生成冻结执行计划
  - 判断哪些动作需要审批
  - 驱动任务生命周期
  - 把结果收成 artifact

这一层才是执行真相层。

### 3. 浏览器执行层

- 推荐选型：`Playwright`
- 第一阶段：`Chromium only`
- 职责：
  - 导航
  - 点击
  - 输入
  - 滚动
  - 等待条件
  - 截图

这一层是浏览器自动化引擎，不是产品工作流本体。

### 4. 壳层

- `Electron`
- `Tauri`

职责只包括：

- 承载桌面应用
- 提供最小 runtime 信息
- 不直接持有浏览器自动化业务逻辑

## 对 Codex 路线的借鉴

这个分层和当前 Codex 相关能力的拆法是一致的，只是我们不需要一上来做那么全：

- `computer use`
  - 更像高层能力和任务语义
- `Playwright`
  - 更像浏览器执行器
- `Chrome extension`
  - 更像复用用户现有浏览器状态的接入层
- `Browser use`
  - 更像产品化浏览器操作面

对本项目的直接启发是：

- 我们的 `computer_use` 微应用，不要直接等于 `Playwright`
- 也不要直接等于浏览器插件
- 第一阶段最稳的组合是：
  - `MicroAPP + server orchestration + Playwright`

如果后续真的需要复用用户自己的浏览器登录态，再考虑单开“浏览器扩展接入层”。

## 第一阶段技术选型结论

如果只看 MVP、可用性和包体控制，当前建议固定为：

- 前端入口：现有 `desktop` 微应用页面
- 后端编排：现有 `server` Fastify 体系
- 浏览器执行器：`Playwright`
- 浏览器范围：`Chromium only`
- 运行形态：受控浏览器会话
- 明确不做：
  - 浏览器插件主底座
  - 宿主桌面自动化
  - 多浏览器支持

这样做的原因：

1. 比插件路线更像单链路 MVP
2. 比宿主桌面路线更稳
3. 比多浏览器路线更容易控包体

## 浏览器运行时获取策略

如果第一阶段不把 Playwright 浏览器二进制直接打进安装包，推荐采用：

```text
1. 优先使用应用已管理的本地 Chromium
2. 否则尝试使用本机已安装的 Chrome / Edge
3. 都没有则下载受管 Chromium
4. 下载完成后登记本地元数据并复用
```

这里要特别明确：

- 不建议依赖“全局 Playwright 包”
- 不建议依赖用户本机全局 npm 环境
- 推荐内置的是 `playwright-core`
- 浏览器运行时按需获取

这样做的原因：

1. 安装包不会被 Chromium 直接撑大
2. 仍然可以保持浏览器执行层的版本可控
3. 比依赖用户全局 Node / npm 环境更稳

## 下载职责边界

浏览器运行时的下载、解压、校验和版本登记，推荐全部放在 `server`。

建议边界：

- `desktop`
  - 展示浏览器运行时是否可用
  - 展示下载进度
  - 触发“安装运行时”
- `server`
  - 检查受管 Chromium
  - 探测本机 Chrome / Edge
  - 下载浏览器 zip
  - 解压
  - 写入运行时元数据
  - 返回可用状态
- `Electron / Tauri`
  - 不负责下载流程本身
  - 只在必要时提供用户数据目录或等价路径信息

这条边界的目的，是避免：

- Electron 和 Tauri 各自维护一套下载逻辑
- 壳层直接拥有浏览器自动化运行时真相
- 前端页面绕过 backend 自己管理浏览器运行时

## 第一阶段推荐依赖策略

当前更适合的实现口径是：

- 打包内置 `playwright-core`
- 不默认内置 Chromium 二进制
- 运行时优先复用受管 Chromium
- 其次尝试本机已有浏览器
- 最后才按需下载 Chromium

如果后续为了演示稳定性，需要提供“一键可用”的体验，再单独评估：

- 是否增加“演示版内置 Chromium”构建口径
- 是否保留“轻量版按需下载”构建口径

但这属于后续打包策略，不属于当前 docs-only POC 批准范围。

## Electron / Tauri 边界

### Electron

Electron 侧只能做两类事：

- 提供最小 runtime 信息
- 提供受控容器或原生桥入口

不应该做：

- 在 renderer 中直接开启 Node 集成
- 把桌面自动化 API 散给业务组件
- 用 preload 临时拼一组“万能控制函数”

### Tauri

Tauri 侧也必须遵守同样原则：

- capability 和 permission 只开最小范围
- 原生命令不直接暴露给业务 UI
- 受控执行逻辑仍由 backend 真相层或明确桥接层统一管理

不应该做：

- 为了 POC 先把宽权限 capability 整包放开
- 让前端页面直接成为原生命令调用中心

## 推荐最小动作集

第一版建议动作只保留这些：

- `navigate`
- `click`
- `type`
- `scroll`
- `wait_for`
- `capture`
- `finish`

其中高风险动作建议单独标记：

- `type`
  - 可能输入敏感内容
- `click`
  - 可能触发提交、购买、发送
- `navigate`
  - 可能离开受控站点

## 任务生命周期建议

统一状态建议至少包括：

- `queued`
- `planning`
- `awaiting_approval`
- `running`
- `blocked`
- `succeeded`
- `failed`
- `cancelled`

这里故意加入 `planning` 和 `blocked`，因为 `computer-use` 比普通工具调用更依赖：

- 先冻结计划
- 再等待用户明确许可

## Artifact 建议

第一版至少产出这些 artifact：

- `plan`
- `approval_request`
- `screenshot`
- `action_log`
- `result_summary`
- `error_snapshot`

这样做的目的不是做审计官腔，而是避免后面只剩一句“模型说它做完了”。

## 风险分级建议

### 低风险

- 页面内滚动
- 读取截图
- 读取 DOM 摘要

### 中风险

- 页面导航
- 点击普通页面元素
- 在搜索框、普通文本框输入非敏感内容

### 高风险

- 提交按钮
- 外部发送
- 下载 / 上传
- 文件选择
- 登录态页面操作
- 可能造成资金、消息、数据写入的动作

第一阶段只建议覆盖低风险和部分中风险动作。

## 推荐实现切片

### Phase 0

docs-only POC

当前任务只到这里。

### Phase 1

隔离浏览器执行 POC

- 只做单站点
- 只做最小动作集
- 只做单次审批
- 只做截图回放

### Phase 2

与聊天主链或工作区面板联动

- 允许从聊天里发起任务
- 允许回看执行记录

### Phase 3

考虑是否需要受限宿主桌面动作

这个阶段必须先补：

- 审批持久化
- 恢复逻辑
- 跨壳一致性
- 更严格的权限模型

## 当前建议的最终口径

这次 POC 我不建议否掉。

但建议非常明确：

- 可以做
- 先做 docs-only POC
- 第一阶段先做隔离浏览器或隔离执行面
- 不建议把宿主桌面控制作为第一阶段目标
- 不要把历史 `browser_action` 误判为现成底座
- 不要把 renderer 变成原生自动化权限持有者

如果后续要进入实现，应该先单开新的高风险任务卡，不要直接把这篇文档当成默认批准。
