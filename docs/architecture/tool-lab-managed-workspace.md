# Tool Lab Managed Workspace

Status: Current
Owner: runtime / tooling
Last verified: 2026-10-21
Layer: raw-source
Module: Tools
Feature: ToolLabManagedWorkspace
Doc Type: design
Canonical: true
Related:
  - README.md
  - multi-agent-execution-truth.md
  - ../../server/src/mcp/workspace.ts
  - ../../server/src/services/agent-workspace.service.ts
  - ../../server/src/mcp/tool-lab-workspace.ts
  - ../../server/src/mcp/tool-lab-fixtures.ts

## 目标

Tool Lab 需要能够真实执行 workspace-bound Tool，但普通用户不应该为了打开一个 Tool 验收页，先理解并手动配置 Workspace。

因此 Tool Lab 分成两个清晰的 Workspace 语义：

1. 普通 Tool Lab 上下文可读取当前有效 Workspace；没有 Workspace 时可以回退到 Mira 管理的安全 Workspace。
2. **验收 Case 只要声明需要 Workspace，就使用 managed workspace。** 测试 fixture 不得自动重置、删除或改写用户真实项目。
3. managed workspace 不写入全局 Workspace selection，不冒充用户项目。
4. 开发环境和打包生产环境使用同一套解析与安全规则；它们只因为 app-data/storage root 不同而落到不同物理目录。

## 非目标

这不是新的 Workspace 产品模型，也不是第二套 Workspace selector。

本设计不做：

- 不修改 `Settings → Tools` 的 Workspace 选择语义；
- 不把 Tool Lab managed workspace 写进全局 `selectedWorkspaceRoot`；
- 不让 renderer 自己传任意绝对路径作为 managed workspace；
- 不复用或伪造 Thread 来借用 Private Agent Workspace；
- 不让开发版与生产版共享同一个物理目录；
- 不因为 fallback 存在而吞掉一个已经显式配置但失效的 Workspace 错误。

## 路径与生命周期

managed workspace 位于当前 Mira 实例自己的 app-data/storage root 下：

```text
<Mira app-data/storage root>/
  tool-lab/
    workspace/
```

storage root 使用和现有本地持久化一致的解析顺序：

1. `UI_CHAT_DATABASE_DIR`
2. file-form `DATABASE_URL` 的父目录
3. SQLite 路径形式 `DATABASE_URL` 的父目录
4. `CONFIG.DATABASE_DIR`

因此开发态与生产态不需要条件分支。

首次需要 managed workspace 时由 backend 创建目录。目录创建和再次使用都必须验证：

- storage root 是真实目录；
- managed 路径每一级都不是 symbolic link / junction；
- canonical real path 仍位于 storage root 内；
- 最终目标是目录；
- 不允许 `..` 或绝对路径片段参与 managed path 组合。

## 有效 Workspace 决策

```text
get Tool Lab workspace
  |
  +-- active Workspace root exists
  |      -> use active root
  |
  +-- active selection is unset
         -> ensure managed Tool Lab workspace
         -> use managed root
```

如果已有显式/配置 Workspace，但它已经失效或不存在，普通 Tool Lab 上下文不应静默掩盖这个配置错误。

验收 Case 是另一条明确的安全路径：Case 配置通过 `workspace: "managed"` 声明自己消费 managed workspace，因此与当前用户项目解耦。

## Case / Fixture contract

后续 Tool 卡片通过数据注册验收 Case，不为单个 Case 新写 Tool Lab UI。

最小配置形态：

```ts
{
  id: "read-file-success",
  toolId: "read",
  args: {
    path: ".tool-lab-fixtures/read-file-success/input.txt"
  },
  workspace: "managed",
  fixture: "read-file-success",
  expectedObservation: "Completed ..."
}
```

规则：

- `workspace` 只有 `managed | none`；需要文件系统 / cwd 的验收 Case 使用 `managed`。
- `fixture` 是可选的稳定 ID；Case 不能提交任意 reset 脚本、shell 命令或绝对路径。
- backend Fixture Registry 按 ID 找到受控 resetter。
- 每次 Run 都先 reset fixture，再进入真实 Harness invocation。
- reset 失败时 fail closed：本次 invocation 不启动，并明确报告 fixture preparation failure。
- fixture reset 只允许操作 managed workspace 下的 `.tool-lab-fixtures/<fixture-id>/`。
- 一个 Case 的审批/恢复属于同一次 Run，不在 Y/N resume 前再次 reset。
- 这不是 workflow/steps DSL；Case 只声明依赖哪个 fixture，reset 实现由受控 Registry 提供。

不需要 Workspace 的 Tool（例如 `web_search` / `web_fetch`）声明 `workspace: "none"` 且不绑定 fixture：它们的网络行为无法由文件 fixture 决定，因此确定性验收覆盖由受控 provider/transport doubles 的测试承担；Tool Lab Case 只保留人类 smoke 与确定性安全失败（例如私网 / 非 http(s) 目标被结构化拒绝），避免验收依赖任意实时公网可用性。

运行顺序：

```text
registered case
  -> resolve workspace mode
  -> reset fixture (optional)
  -> freeze managed workspace for invocation
  -> governed Harness invocation
  -> Approval / Result / Artifact / Evidence / Trace
```

## Invocation authority

managed workspace 是 backend 决策，不由 renderer 提交路径。

Tool Lab 调用现有 MCP/Harness invocation API 时只提交语义标记，不提交绝对执行路径：

```json
{
  "workspaceContext": "tool_lab_managed"
}
```

fixture-backed / workspace-bound acceptance Case 使用 `tool_lab_managed`；backend 自己解析 managed workspace 并构造真实 `ToolExecutionEnvironment`。普通 Tool Lab 上下文仍可使用 `tool_lab` 的 effective Workspace 语义。

这保持了以下边界：

- Tool Registry 不复制；
- Harness 不复制；
- Policy/Approval 不复制；
- Tool runtime 不复制；
- renderer 不获得“指定任意执行根”的能力。

## Browser run context

Managed Browser Tool 需要 `threadId` 才能把一次 Tool Lab run 的多个步骤绑定到同一个内部 Browser session。该绑定不能由客户端直接提交，因此 Tool Lab 增加一套专用于 Browser 的短期 run handle：

```text
POST /mcp/tool-lab/browser-runs          -> { handle, expiresAt, activeStep }
POST /mcp/tool-lab/browser-runs/status   -> { handle, expiresAt, activeStep }
POST /mcp/tool-lab/browser-runs/reset    -> { handle, reset: true }
```

- handle 由 backend 使用加密随机数生成，格式为 `blrun_` 前缀的不透明字符串；
- 每个 handle 只属于创建它的 authenticated user，并映射到一个独立命名空间的内部 `threadId`（包含 user 与 run 标识）；同一 run 复用同一 thread，不同 run 永不共用 thread；
- handle 默认 10 分钟固定 TTL；过期、reset、跨 user 或未知 handle 均按 not found 处理，不泄露其他 run 是否存在；
- 每个 user 最多 4 个 active run，全局最多 64 个；过期记录在下一次创建/访问时惰性清理；
- 同一 run 同一时间只允许一个活动步骤；第二个并发步骤返回受控 400；
- 步骤进入审批等待时保留 run 级 pending 标记，未决期间拒绝新的 Browser 步骤；reset 在 pending 期间仍可撤销该 run；
- 活动步骤期间拒绝 reset（返回可诊断的 400），等步骤结束后才允许 reset；过期 run 不再授权任何新调用；
- Managed Browser Tool 必须携带有效 handle。非 Browser Tool 携带 handle、Browser Tool 缺少 handle、客户端提交 `threadId`/`sessionId` 或 `args.sessionId` 均被拒绝；
- Tool Lab 路由只把 backend 解析出的内部 `threadId` 注入现有 Harness invocation，不新增第二套 SessionManager，也不改变原有 Policy/Approval 门槛；
- POST `/mcp/invocations` 与 GET `/mcp/invocations/:id` 的 Browser Lab 响应会投影掉内部 `threadId`；服务端保存的原 invocation 仍保留该字段，供后续审批恢复卡使用。

审批恢复（`resolveHarnessInvocationApproval`）只从服务端 original invocation 继承内部 `threadId`、`turnId`、`userId` 以及冻结的 toolId/args/inputHash，不接受客户端指定这些上下文。批准 Browser Lab 步骤前必须校验该内部 thread 仍属于同一 user、run 未过期且未 reset、并且正等待对应步骤的审批；任一项不满足即 fail closed，不执行页面操作。批准后复用原内部线程执行既定 Browser 工具，完成后同一 run 的下一步（例如 Snapshot）仍复用该线程；明确拒绝不执行页面操作，并结束该 run 的 pending 状态。审批响应与 invocation 响应一致，投影掉内部 `threadId`，服务端 original record 保留绑定。

## Tool Lab Browser journey

Tool Lab 的 Browser 验收入口是一条固定顺序、有限步骤的真实旅程，而不是静态 Ref/Hash 示例：

```text
create / reset Browser Lab run handle
  -> browser_navigate (Approval)
  -> browser_snapshot (real pageUrl / snapshotHash / ref)
  -> browser_click (Approval; uses only the accepted snapshot facts)
  -> browser_snapshot (re-observe the changed page)
  -> browser_assert (real final page fact)
```

- Journey 只声明起始 URL、快照上限、快照中要查找的角色/名称以及最终断言；Step 的 `pageUrl`、`snapshotHash` 与 `ref` 全部来自同一次 run 的 Snapshot Result，不由客户端手填。
- Navigate 与 Click 仍经过既有 Harness Approval。待批时旅程暂停；拒绝后立即终止，不执行后续 Snapshot/Click/Assert。
- Click 后不沿用 Click Result 中的 Hash，而是强制重新 Snapshot，再使用新的页面事实进行 Assert。
- 每一步在 UI 中显示 Invocation Id、审批结果、`result.ok`、session、页面事实、Ref、断言结果和结构化错误；`ok=false`、`session_unavailable`、stale 或 `navigation_blocked` 都按失败终止，不显示成功。
- Run 完成或失败后客户端尝试 reset 对应 handle；重试会先 reset 旧 handle 再创建新 handle，不复用旧页面、审批或其他用户会话。
- 当前 journey 使用 Selenium 维护的公开 web-form 自动化页面作为稳定受控页面，不修改导航 allowlist 或授予本地文件导航特权；自动化测试使用本地 HTTP fixture 验证同一 Approval/Session 主链。

## Approval / resume

审批前后的 Workspace 必须是同一个执行根。

因此 invocation runtime 在首次执行时保存**内部 Workspace snapshot**：

```text
invocation id -> { rootPath, source }
```

这个 snapshot：

- 不进入 Tool Result；
- 不作为 renderer 可写字段；
- 不保存 provider secret / toolConfig；
- 只用于受治理的 approval replay/resume；
- 与 invocation 生命周期一起清理。

这样即使用户在等待审批期间修改了全局 Workspace，已批准的 Tool 仍会在最初被冻结的 Workspace 上继续执行。

## Tool Lab bootstrap 内容

managed workspace 初始化一个很小的 `README.md`，只用于证明这是一个真实、可读、安全的 Workspace。

正式 acceptance Case 不依赖这个 bootstrap 文件作为测试前置条件；需要固定内容时由自己的 fixture 在 `.tool-lab-fixtures/<fixture-id>/` 下建立并在每次 Run 前恢复。

它不是项目模板，不承载用户配置，也不应成为业务数据源。

## UI 语义

Tool Lab UI 不需要要求用户先选择 Workspace。

- workspace-bound acceptance Case 使用 managed workspace，不修改真实项目。
- 不需要 Workspace 的 Case 声明 `workspace: "none"`。
- managed workspace 的物理路径不是主界面信息；必要时只在诊断/Source 级别暴露。
- Settings 中原有 Workspace 选择保持用户可控，但不会成为 fixture reset 的目标。

## 验收

最低验证：

- 未选择 Workspace 时，Tool Lab workspace endpoint 返回 `managed` 且目录真实存在；
- managed root 位于当前 app-data/storage root 内；
- symlink/junction 路径被拒绝；
- 普通 Workspace selection 行为保持不变；fixture reset 即使存在显式 Workspace 也只操作 managed root；
- 同一 fixture 被上一次 Run 改脏后，再次 Run 前能恢复到相同基线；
- fixture reset 失败时不启动 invocation；
- Tool Lab read smoke 在 managed workspace 可完成；
- approval replay 使用首次 invocation 的 Workspace snapshot，审批恢复前不重复 reset；
- 普通 `/mcp/workspace` 与 Settings Workspace 行为不变；
- 开发与生产代码路径无环境分支。
