---
status: current
owner: chat / runtime / harness
last_verified: 2026-10-01
layer: wiki
module: Chat / Tool
feature: ChatWorkspace
doc_type: current-contract
canonical: true
related:
  - ../CHAT_CURRENT_TRUTH.md
  - README.md
  - ../TOOL_CURRENT_TRUTH.md
  - ../harness/README.md
  - ../../server/src/skills/development/miradocs/SKILL.md
  - ../../server/src/skills/development/miradocs/references/create-site.md
---

# Chat Workspace 与默认执行空间当前合同

> 本页统一 `ChatWorkspace`、`Mira BASE`、Agent effective workspace、private Agent workspace、Harness workspace root 和受管施工目录的语义。数据库对象、文件系统目录和一次任务的施工现场不是同一个东西。

## 1. 六个必须分开的对象

```text
ChatWorkspace
  用户可见、持久化的工作空间记录

Mira BASE
  默认 ChatWorkspace 的逻辑名称

Agent effective workspace root
  一个 AgentRun 唯一的执行根；创建 Run 时冻结进 runtimeInput.workspaceRoot

Private Agent workspace
  没有显式 ChatWorkspace 时，由 threadId/userId 确定的 Mira-managed 私有目录

Harness workspace root
  当前 Tool/Harness invocation 实际使用的根路径；Agent 执行时必须等于该 Run 的 effective workspace root

Task staging workspace
  某次建站、构建或其他施工任务使用的受管子目录
```

当前 Agent workspace resolution 只有一套所有权模型：

```text
thread.workspaceId exists
  -> ChatWorkspace.rootPath
  -> AgentRun.runtimeInput.workspaceRoot
  -> Harness workspace root

thread.workspaceId is null
  -> deterministic private Agent workspace
  -> <app-data>/conversation-workdirs/user-<userId>/<threadId>
  -> AgentRun.runtimeInput.workspaceRoot
  -> Harness workspace root
```

`conversation-workdirs` 这个目录段只为兼容既有本地文件而保留；它不再对应 `conversation_workdirs` 数据库记录，也不再产生 `workdirId`、`conversationWorkdir` 或第二套 resume identity。后续若迁移这个物理目录名，必须作为独立的数据迁移工作处理。

因此：

- 未显式选择 Workspace 的 Agent 不会自动绑定共享 `Mira BASE`；
- explicit Workspace 与 private Agent workspace 二选一，任一 AgentRun 只冻结一个 `workspaceRoot`；
- approval resume 复用 Run 创建时冻结的 `workspaceRoot`，不根据线程后来选择的 Workspace 重解释；
- Conversation Artifact 记录创建时的 `sourceRootPath + sourceRelativePath`，不会跟随线程后来切换 Workspace。

## 2. 内置默认空间

桌面应用内置的默认物理路径为操作系统 Documents 目录下：

```text
UIChat Mira/Default Workspace
```

Windows 典型路径：

```text
C:\Users\<user>\Documents\UIChat Mira\Default Workspace
```

打包后的 Electron 与 Tauri 都应由桌面启动器解析该路径，并通过：

```text
UI_CHAT_WORKSPACE_ROOT
```

传给 bundled backend。

Backend 在需要默认 ChatWorkspace 时，复用或创建数据库记录：

```text
name = Mira BASE
rootPath = UI_CHAT_WORKSPACE_ROOT
```

因此：

- `Default Workspace` 是内置物理目录名；
- `Mira BASE` 是默认数据库 Workspace 名；
- 两者通过 rootPath 绑定，不应混成同一个 UI / 文件系统概念。

## 3. 谁负责创建目录

### 3.1 内置默认目录

内置默认目录属于桌面宿主拥有的 bootstrap 资源。

```text
Electron / Tauri launcher
  -> resolve Documents/UIChat Mira/Default Workspace
  -> create directory recursively
  -> verify it is a directory
  -> start backend with UI_CHAT_WORKSPACE_ROOT
```

生产启动必须在 backend spawn 之前完成创建。目录创建失败时，桌面启动失败并展示明确路径错误；不能先启动 backend，再等待某次 Tool 调用碰巧创建。

开发 launcher 使用默认路径时遵守同一语义：先创建，再启动 server。显式提供 `UI_CHAT_WORKSPACE_ROOT` 时按自定义目录合同处理。

### 3.2 自定义 Workspace

用户选择、数据库保存或环境变量显式指定的自定义 Workspace 属于用户 / 部署者拥有的路径。

对自定义路径：

- 选择和读取只验证路径；
- 路径必须已经存在并且是目录；
- 路径不存在时返回明确 unavailable / not found；
- 不因读取 Workspace、创建 environment snapshot 或启动一次 Tool 而偷偷创建；
- 用户删除目录后，不得自动“复活”一个同名空目录；
- 新目录创建必须来自明确用户动作或经过审批的文件系统操作。

独立 server 部署若通过 `UI_CHAT_WORKSPACE_ROOT` 指定自定义根目录，由部署者预先创建并赋予权限；backend 不把任意环境变量路径当成可自动初始化的产品目录。

## 4. Harness snapshot 必须是纯读取

`getWorkspaceSelection()` 和 Harness environment snapshot 表达当前执行事实：

```text
rootPath
source = selected | configured | unset
```

它们不得产生文件系统副作用。

正确顺序：

```text
host / user explicitly establishes a workspace
→ selection records the path
→ snapshot reads the path
→ Tool validates and executes
```

错误顺序：

```text
snapshot reads a missing path
→ mkdir as hidden fallback
→ Tool unknowingly runs in a newly created empty directory
```

默认目录的 bootstrap 创建属于宿主启动职责，不能下沉到通用 Workspace getter。

## 5. 默认 Workspace 的数据库语义

`Mira BASE` 仍是内置默认 ChatWorkspace 的数据库记录，可用于现有 Workspace 列表和显式选择语义；它不再是 Agent 未选择 Workspace 时的自动 fallback。

Agent Thread 的执行根按以下顺序解析：

```text
explicit thread.workspaceId
→ ChatWorkspace.rootPath

no explicit thread.workspaceId
→ private per-conversation effective workspace
```

因此启用 Agent、发送 Agent 消息或清除显式 Workspace 都不会仅因为 Agent 模式而把 `Mira BASE.id` 自动写回 Thread。

数据库 ChatWorkspace 记录存在只证明某个显式 Workspace 路径配置已经绑定，不证明：

- 物理目录一定存在；
- 目录可写；
- 当前任务已经拥有独立施工现场；
- 目录中已有项目或仓库。

物理路径有效性必须由启动 / 选择合同和具体 Tool 执行共同验证。

## 6. 受管内部目录

Mira 可以在自己拥有的内置默认空间下保留内部目录：

```text
<workspaceRoot>/.mira/
```

`.mira` 不作为普通项目根目录宣传给用户，也不允许任务把内部索引、缓存、临时构建和用户项目文件混在 Workspace 根层。

建议用途：

```text
.mira/
  staging/
  cache/
  indexes/
```

具体子系统只能使用自己声明的子目录，并遵守清理、恢复和可观测性合同。

## 7. MiraDocs GitHub 建站施工目录

GitHub 建站需要同时使用：

```text
GitHub remote operations
+ local install / typecheck / build verification
```

因此 GitHub 模式不能直接把 `Mira BASE` 根目录当成站点目录。它使用受管 task staging workspace：

```text
<workspaceRoot>/.mira/staging/miradocs/<owner>/<repo>/<taskKey>/
```

其中：

- `taskKey` 在任务首次进入本地施工时生成一次；
- exact staging path 必须进入 SubAgent checkpoint / working state，恢复时复用；
- 同一任务失败后保留现场，不从头重新初始化；
- 不同仓库或并发任务不能共享同一目录；
- 写远程前后都要回读 GitHub 状态；
- 本地 build 成功只证明 staging 内容可构建，不等于远程分支、PR、Actions 或 Pages 成功。

本地模式使用用户明确的 `target.localPath`，不强制迁入 `.mira/staging`。

## 8. Private Agent Workspace 当前合同

#174 / #175 之后，Agent 不再维护独立的 Conversation Workdir 领域身份：

- 未绑定 ChatWorkspace 的 Thread 使用 deterministic private root：`<app-data>/conversation-workdirs/user-<userId>/<threadId>`；
- 该路径由 `threadId + userId` 直接决定，不需要额外数据库 identity；
- 一个 AgentRun 只持有 `runtimeInput.workspaceRoot`；不存在第二个 `conversationWorkdir` snapshot；
- approval resume 必须使用同一 Run 冻结的 `workspaceRoot`；
- private root 继续执行 realpath containment、symlink / junction、Windows 大小写与 quota 校验；
- Thread hard delete / history cleanup 只清理该 Thread 的 deterministic private root，不删除或重解释用户 ChatWorkspace；
- explicit Workspace 始终由 `ChatWorkspace.rootPath` 负责；private root 不投影成 Workspace row、picker 项或 sidebar group；
- 新 Conversation Artifact 以 `sourceRootPath + sourceRelativePath` 固化创建时来源；
- 历史 Workdir-backed Artifact 在数据库初始化时把旧 `workdir_id` 迁移成稳定 `source_root_path`，随后旧 `conversation_workdirs` 表被移除；
- 历史 AgentRun JSON 在初始化时迁移到 `workspaceRoot / workspaceOutputs`，旧 `conversationWorkdir / conversationWorkdirOutputs` 字段被删除；
- 临时执行文件不会因为迁移而自动升级成 final Artifact。

兼容项只剩一个：磁盘目录段仍叫 `conversation-workdirs`，原因是避免无授权地搬动既有用户文件；当前消费者是 private Agent workspace 的物理存储；移除条件是另一个明确的数据迁移能够安全搬迁全部既有目录并验证 reload/read-back。

## 9. 当前实现缺陷与本次整改边界

截至 `dev` 的已确认缺陷：

1. Electron / Tauri 生产启动器计算并传递默认路径，但没有在 backend spawn 前显式创建 `Default Workspace`。
2. Terminal 消费 Harness snapshot 时会把该路径当成真实 cwd，首次使用可能报 `terminal cwd does not exist`。
3. 在通用 `getWorkspaceSelection()` 中隐式 mkdir 虽能掩盖默认目录缺失，却会误伤自定义 Workspace 语义，因此不是可接受修复。
4. MiraDocs GitHub 路由声明了远程 GitHub 能力和本地构建完成标准，但此前没有定义独立 staging path。

本次整改只应：

- 在 Electron / Tauri 及对应 dev launcher 中创建宿主拥有的默认目录；
- 保持 Workspace selection / snapshot 纯读取；
- 对自定义缺失路径明确失败；
- 为 MiraDocs GitHub 模式建立受管 staging 合同；
- 不改变 Agent Graph、Policy、审批指纹或 Terminal 的 host runtime 能力。

## 10. 验收标准

- 全新安装首次启动后，默认物理目录在 backend 启动前存在；
- `Mira BASE.rootPath` 与宿主传入路径一致；
- 删除自定义 Workspace 后，读取或执行不会创建同名空目录；
- Terminal 在默认空间运行不再出现首次 cwd missing；
- GitHub 建站的本地文件位于 task staging，而不是 Workspace 根目录；
- staging 路径可在 approval / failure / resume / trace 中核验；
- GitHub、构建、PR、Actions、Pages 的完成状态仍分别回读，不互相冒充。
