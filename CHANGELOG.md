# 更新日志

> 当前产品更新日志的唯一真相源。官网可以做面向用户的公开投影，但版本事实与最终发布说明以本文件和 GitHub Release 为准。

## 0.106.0 - 2026-11-01（发布候选，正式发布待验收）

本版候选将 Mira Desktop 统一到 Electron 桌面壳，保留 Browser Preview。以下为已合入的源码范围；是否正式发布以对应版本的 Windows 安装运行、云端互通验收和 GitHub Release 结果为准。

- **Electron 成为唯一 Desktop 壳**：退役 Tauri Rust 壳、依赖、双壳 UI 分支及未来版本的 Tauri 构建/下载路径；历史 Release 不做追溯删除。
- **Windows / macOS 构建**：保留 Windows Electron NSIS 安装包及 blockmap、macOS Intel DMG 及 blockmap。macOS Intel DMG 仍未签名、公证，不宣称通过 Gatekeeper 正式分发要求。
- **云账号与远程桌面协作**：纳入 Desktop Cloud Account、OAuth/Relay、Host grant 的现有集成改动；真实打包态 OAuth 恢复与 Mobile → Relay → Desktop 端到端调用须单独验收，CI 通过不代表互通已经通过。
- **发布安全**：GitHub Release / Cloudflare R2 的公开最新包由稳定 Tag 发布链负责，Windows 和 macOS 分别验证并镜像；新增 Tag 必须指向 `prod` 历史的前置校验，Tag 管理权限仍需独立保护。
- **单实例修正**：第二实例未获得运行锁时不再继续初始化窗口、Backend 和 OAuth 回调监听，避免抢占主实例。

**发布前检查**：Windows 安装运行与 Backend `/health`、单实例和 OAuth 会话恢复、真实跨端授权调用、版本号一致性及 `v*` Tag 保护。通过前只作为候选安装包，不覆盖 R2 正式 `latest`。

## 0.105.0 - 2026-10-22

本版汇集自 v0.104.0 后在 `dev` 上完成、并由维护者于 2026-10-22 确认验收的桌面端改动。

- **连接器入口**：将 MCP 管理收敛至「扩展 / 连接器」，提供连接器目录、已安装服务管理、自定义配置与相关引导界面。
- **Browser 能力与执行呈现**：增强 Browser 任务旅程、工具执行轨迹及其可观测性，补充对应测试。
- **能力工作台**：改进 Capabilities 测试与交互；整合导航组件及中英文界面文案。
- **工具与调试界面**：收敛旧 Computer Use 调试界面、API 层及相关说明，保留真实执行证据边界。
- **发布范围**：本次说明概括主要桌面端变化；具体合入范围以 dev → test 发布 PR、CI 和最终标签为准。

## 0.104.0 - 2026-10-13

Mira Next 二期维护者 Sign-off 后的正式发布版本；本次继续以实际 Agent 任务完成和受治理工具执行为交付准则。

- **Agent 能力发现进入渐进式运行时**：引入按 Agent 范围隔离的 Capability View，Generic Child 可以在自己的权限上限内发现能力；工具由元数据逐步披露完整 Schema，避免把披露视为真正调用。
- **工具搜索与可用性治理**：将 Tool Search / Progressive Resolution 接入生产路径，结合结构化匹配与有界语义检索；配置缺失、运行时不可用或超出授权的能力不应冒充可执行工具，Web Search 配置可从能力界面维护。
- **Skills 与 Resources 渐进可见**：主 Planner 可以看到紧凑 Skill 摘要并选择激活；Skill 执行保持现有 Child 和权限范围，Skill/Resource 内容按需进入上下文。
- **子 Agent 连续执行与恢复**：持久化渐进披露/解析预算、跟踪与恢复状态；Generic / Skill Child 的委派路径进一步对齐；仅披露 Schema 而未执行的工具不再机械阻断完成声明，Child 可在原会话重新判断是否需要调用，主 Planner 仍负责全局任务验收。
- **能力工作台与工程可观测性**：改进 Capabilities 工具状态、可用性与回归覆盖；工程审查器获得只读上下文能力，相关修改不改变其合并权限。
- **验收证据**：维护者在 Mac `dev` 上完成两个文件读取比较的真人烟测，观察到一次 Generic Child 委派、两次真实读取及正确结论（100、160，差值 60）。这证明该场景通过，不代表所有模型/任务的端到端成功率已经充分验证。

**已知问题（不在本次发版中修补）**

- [#347](https://github.com/uichat-mira/mira-desktop/issues/347)：自定义 OpenAI 兼容连接被错误标记为 `volcengine`；后续计划将 LLM 接入架构逐步收敛到 OpenAI 与 Claude 协议，尚未实施。
- Planner 文本 JSON 兼容路径在特定真实模型调用下可能生成不完整决策并中止 AgentRun；目前保留严格的无效输出拒绝，不通过自动补括号制造成功。进一步调查服务商响应与原生结构化能力。
- 其它更大范围的 Progressive Resolution 验收矩阵继续单独追踪（[#311](https://github.com/uichat-mira/mira-desktop/issues/311)）。

## 0.103.0 - 2026-10-07

- **Mira Next 二期基础工具体系**：Pi Agent Core 升级至 1.0.2；Tool Core 中立化，统一 ToolResult 与 Harness Evidence 合同，接入外部 MCP 适配。
- **核心文件与执行能力**：Universal Read、File Mutation、Terminal 与 Web 工具形成可治理的通用能力基础，包含跨平台运行时及 apply_patch 工具语义。
- **扩展入口与能力验收界面**：新增「扩展」导航，整合能力、Skills 和 MCP 原型入口，Tool Lab 形成可观察的工具验收工作台。
- **跨端通知基础设施**：Host Push Broker、通知 outbox，以及 FCM/APNs 投递链路纳入工程基线；移动端完整接收体验仍需独立验收。
- **Agent Benchmark 与发布工程**：建立 Core Benchmark 用例、运行与记录链路，并推进 Review、Tool 合同和跨平台打包验证。

## 0.102.0 - 2026-10-02

- **应用导航重构**：新增全局 Navigation Rail，把知识库、评测、开发、关于、远程访问与 Forge 等能力从聊天侧栏/设置页中拆成独立工作区；统一页面骨架、页边距与嵌套路由状态，配对弹窗等细节同步收紧。
- **新对话默认进入 Agent Runtime**：Desktop 新建对话不再要求手动打开 Agent；主发送按钮回归普通“发送”语义，历史非 Agent 路径明确标记为“兼容 Chat”。既有 Thread 的 `agentEnabled` 状态不做迁移，兼容路径仍保留。
- **Agent Workspace 所有权收敛**：无显式 Workspace 的 Agent 对话获得稳定的私有 per-conversation workspace；显式 ChatWorkspace 继续优先。Conversation Workdir 作为独立运行时/持久化身份已退出主合同，AgentRun 只冻结并持久化 `workspaceRoot`，Artifact 也改为从冻结 source root 注册与读回。旧磁盘目录名仅保留为数据兼容，不再代表运行时所有权。
- **Agent / SubAgent 稳定性继续收口**：Planner 对一次无效文本 decision 增加有限修复；OpenAI-compatible Provider 的 SubAgent tool schema 会投影为合法 object root；approval resume 复用被冻结的 workspace root；可恢复的 SubAgent 失败不再让仍在运行的 Parent Agent 提前掉回普通发送状态。
- **Windows 与跨平台 Runtime 更可靠**：补齐 PowerShell sandbox 的退出码、stdio 收尾、环境变量与非交互进程终止语义；服务器全量测试新增 Linux + Windows CI，并修正跨平台路径、Office/PDF 外部工具探测与宿主 Python 等差异。
- **工程质量门加强**：Mira AI Review 切到隔离 OpenCode runner，并把 provider/routing 放进受信配置；接入 SonarQube Cloud Quality Gate，CodeRabbit review 范围按 Desktop 路径收敛。
- **Intel macOS Electron 进入可发布链路**：在真实 darwin-x64 上完成 Electron app/DMG、Node 22 bundled runtime、后端 health、SQLite/sqlite-vec/Forge 与重启持久化验证；GitHub Actions 新增独立 Intel Mac workflow，`v*` Release 可附加 DMG，并独立同步 R2 `mira/macos-intel/latest/`。当前 Intel DMG 仍未签名/公证，canonical macOS target 仍保持 darwin-arm64。

## 0.101.0 - 2026-09-19

- 完成 Mira Next 第一阶段 Agent 基础工程：结构化 Planner decision、Chat 行为基线与 Conversation Workdir 合同正式进入稳定基线。
- Conversation Workdir 增加稳定 Artifact reference、显式 final output 注册、持久化、重载与 Host read-back；temporary 输出保持执行期本地语义。
- 收紧 Artifact 持久化路径边界：绝对路径、遍历、非规范 persisted identity、失效 Workdir 与 symlink/junction escape 均按合同 fail closed。
- 保持 ChatWorkspace、Terminal、Edit、approval、tool cwd、MCP/Sandbox/MicroApp Artifact 所有权边界不变，为后续默认 Agent 与跨设备 Artifact handoff 提供已验收依赖。

## 0.99.0 - 2026-07-26

- 新增 GitHub 微应用，支持设备授权、账号或组织安装范围管理，以及已授权仓库浏览。
- 增加 GitHub 仓库、Issue、Pull Request 与 Actions 的只读工具包，并在执行前校验 installation 权限边界。
- GitHub 网络请求接入 Mira 代理设置，授权轮询可处理短暂网络故障，并在终止错误发生时停止重试。

## 0.98.0 - 2026-07-22

- 桌面 CI 同时发布 Electron Setup、Electron blockmap、Tauri MSI 与 Tauri NSIS 安装产物。

## 0.7.1 - 2026-06-20

- 新增共享确认弹窗 `ConfirmDialog`，支持默认、警告、危险三种语气与加载态、错误反馈。
- `Modal` 升级为命令式 API（`Modal.show` / `Modal.confirm` / `Modal.close` / `Modal.destroy`），支持多弹窗堆叠、ESC 关闭、遮罩点击关闭与 body 滚动锁定。
- 知识库页面接入新的弹窗能力：新增 `KnowledgeBaseEditorForm`，新建/编辑知识库统一为弹窗表单；文档重建索引、删除、批量删除及知识库删除均接入二次确认。
- 评测中心页面单条/批量删除评测记录接入 `Modal.confirm` 二次确认。
- 更新 `COMPONENTS.md` 与 `ui-design-guidelines-tailwind.md`，补充 `Modal` 与 `ConfirmDialog` 的使用约定。

## 0.6.0 - 2026-06-19

- 重构聊天界面与线程体验，补充欢迎态、消息展示壳层和执行轨迹相关能力。
- 增加附件处理、RAG 来源展示与多 Provider 配置链路，覆盖前后端接口与服务实现。
- 更新品牌资源、设置页与文档索引，统一本次发布的产品说明与视觉素材。
