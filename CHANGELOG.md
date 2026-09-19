# 更新日志

> 当前产品更新日志的唯一真相源。`docs/CHANGELOG.md` 仅保留为历史归档，不再记录当前版本变化。

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
