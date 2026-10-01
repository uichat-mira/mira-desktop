# 更新日志

> 当前产品更新日志的唯一真相源。官网可以做面向用户的公开投影，但版本事实与最终发布说明以本文件和 GitHub Release 为准。

## Unreleased - since 0.101.0

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
