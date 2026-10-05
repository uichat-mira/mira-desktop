# 外部 MCP Marketplace 接入

Status: Current
Owner: runtime
Last verified: 2026-07-31
Layer: raw-source
Module: MCP
Feature: ExternalMarketplace
Doc Type: current-contract

## 单点真相范围

这页只回答一件事：

UIChat Mira 怎样消费第三方 MCP server，以及市场目录怎样更新。

它覆盖：

- 外部 MCP server 的发现与安装记录
- transport 的归属与连接方式
- 权限、密钥、免责声明与审计边界
- MCP protocol capability 怎样投影进现有 harness runtime
- 后续怎样再接到 chat runtime

它不讨论“本项目怎样把自己的文档暴露给别的 AI 客户端”。那部分属于知识库侧 MCP，见：

- `knowledge-system/FULL_MCP_AND_INDEX_ARCHITECTURE.md`

相关概念：

- [[CONCEPT_MCP]]
- [[CONCEPT_RUNTIME]]
- [[AREA_MAP_RUNTIME]]

## 适合什么时候读

你在下面这些场景里应该先读这页：

- 想把 MCP marketplace server 接进本项目
- 想明确第三方 MCP server 的运行边界应该落在 renderer 还是 backend
- 想知道 Tool、MCP、marketplace、external server、builtin MCP 这些产品概念怎么区分
- 准备给 Settings -> MCP 扩市场、安装、连接、调试能力

## 当前事实

当前项目已经有内部 MCP / harness 基座，位于 `server/src/mcp`，并且已经具备：

- 内置 tool / resource 注册
- `GET /mcp/tools`
- `GET /mcp/resources`
- `POST /mcp/invocations`
- `POST /mcp/invocations/stream`
- invocation 事件缓冲
- 内置 `read`、`edit`、`web_search`、`terminal` 等能力
- renderer 里的 Settings -> Tools workbench

当前缺的不是 invocation 基础设施，而是“第三方 MCP server 生命周期管理”。

市场目录已经迁移为 SQLite 本地读取：Registry 请求只发生在 backend 同步任务中，renderer 的列表、搜索、分类和筛选不再直接等待外部 Registry。下面的合同已经由实现、路由测试、目录测试和前端测试验证。

## 市场目录与更新合同

### 数据源与读取边界

- 官方 Registry `https://registry.modelcontextprotocol.io/v0.1/servers` 是同步源，不是页面实时读取源；
- backend 负责访问 Registry，renderer 不直接连接外部 Registry；
- SQLite 中的本地市场目录是产品列表、搜索、分类和详情的唯一读取源；
- 已安装 external MCP server 记录与市场目录是两类数据，不合并生命周期，也不因市场条目删除而删除用户安装记录；
- 同步失败时保留最后一次成功目录，不用空结果覆盖本地数据。

### 首次同步

本地目录为空时，backend 启动一个全量同步任务：

1. 使用 `version=latest&limit=100` 请求 Registry；
2. 只读取首个 100 条页面，不继续请求 `nextCursor`；
3. 该页面在一个 SQLite transaction 中写入，完成后页面即可展示；
4. Registry 标记为 deleted 的条目退出默认列表。

页面不等待长时间上游请求。空目录可以先显示正在首次更新，更新完成后重新读取本地目录。

### 增量同步

- 常规自动更新间隔为 6 小时；
- 使用最后一次成功增量水位减去 5 分钟作为 `updated_since`，避免边界时间与时钟误差漏数据；
- 请求带 `include_deleted=true`，删除状态写入本地目录并从默认列表排除；
- 只有这一页增量结果成功写入后才推进成功水位；
- 每 7 天重新读取首个 100 条页面用于目录校正；
- 手动“更新市场”强制发起一次增量同步；需要全量修复时由 backend 显式选择 full 模式，不在 renderer 拼接 Registry 参数；
- Registry 单次请求超时为 10 秒。失败状态可观察，但不清空目录。
- 自动同步连续失败后按 1、2、4 分钟指数退避，最长等待 6 小时；失败状态下普通列表读取不触发立即重试；
- 手动“更新市场”跳过退避等待。backend 重启后允许对持久化的失败状态重新尝试一次；

### 并发与生命周期

- 同一进程同一时刻只允许一个市场同步任务；
- 自动更新、首次同步和手动更新复用同一个在途 Promise；
- 自动重试由 backend 的单个 timer 调度，成功后清零连续失败次数；
- 同步状态由 backend 持有并写入 SQLite；异常退出留下的 `syncing` 状态在下次启动时转换为失败状态；
- backend 不创建独立常驻端口或额外外部服务，仍使用现有 Fastify 与 SQLite 生命周期。

### 本地目录字段

本地记录至少保存：

- Registry source URL；
- server id、name、title、description、version、status；
- published / updated 时间；
- website / repository 链接；
- 规范化 transport 与 installable 信息；
- 分类 id、分类来源与分类规则版本；
- deleted 状态与最后同步时间。

市场目录不保存 Registry 原始条目 JSON。需要安装的信息必须在同步时规范化为明确字段，不能为方便调试无限复制上游 payload。

### 资源预算与淘汰

- 本地市场目录硬上限为 100 条；
- 单次 Registry 页面为 100 条，只读取一页；
- backend 不得在内存中累计完整 Registry；
- 超量时依次优先删除 deleted、不可安装、更新时间更旧的市场记录；
- 市场淘汰只作用于 `mcp_marketplace_servers`，不删除 `external_mcp_servers`；
- 本地名称搜索未命中时，可用官方 `search` 请求补充结果并纳入同一 100 条预算；
- 100 条是产品容量和数据库硬上限，不保留更大的隐藏后台目录。

分类是 Mira 的目录字段，不伪装成 Registry 官方分类。当前分类来源只允许：

- `publisher`：Registry 明确提供且通过映射表识别；
- `inferred`：按版本化规则从名称、描述、包与 transport 信息推断；
- `uncategorized`：没有足够证据。

分类规则变化必须提高规则版本，并在下一次全量同步中重算。

### 本地查询合同

`GET /mcp/marketplace/servers` 只查询 SQLite，支持：

- 名称、标题、描述、包标识的本地文本搜索；
- category；
- transport；
- installable；
- 稳定分页与确定性排序。

新增状态接口：

```text
GET  /mcp/marketplace/sync-status
POST /mcp/marketplace/sync
```

状态至少返回：

- `status`: `idle | syncing | failed`；
- 当前模式 `full | incremental`；
- `lastAttemptAt`；
- `lastSuccessfulSyncAt`；
- `lastFullSyncAt`；
- 最近更新数量；
- 脱敏后的最近错误；
- 下次允许自动同步时间。

renderer 的刷新按钮表示“请求更新市场”，不是直接绕过本地目录请求 Registry。同步期间页面继续读取并展示本地目录。

## 当前怎么用

当前阶段，这里的 MCP 不是聊天自动调工具系统，而是一个 external MCP server 接入工作台。

它的实际使用主线是：

1. 打开 `Settings -> MCP`
2. 在 `市场` 里浏览第三方 MCP server
3. 选择支持 `streamable-http` 或 `stdio` 的 server，执行安装
4. backend 保存 external MCP server record
5. 切到 `已安装`
6. 对目标 server 执行 `连接`
7. 对目标 server 执行 `Discover`
8. backend 把远端 MCP protocol tools 投影为本地 harness capability
9. 通过现有 `/mcp/invocations` 或 `/mcp/invocations/stream` 做手动调用

当前 MCP Agent 主线是：

`市场 -> 安装 -> 连接 -> Discover -> 用户授权 Agent 使用 -> Agent 语义选择 -> 审批 -> Harness 调用 -> Evidence -> 回答`

### 当前已经打通

- marketplace 浏览
- external MCP server 安装记录
- disclaimer 校验
- `streamable-http` transport
- `stdio` transport
- `connect`
- `Discover`
- projected capability 注册
- 手动 invocation
- 前端展示已安装 server、连接状态、Discover 结果与 projected capability id
- Agent Access 需要用户在 Settings -> MCP 中单独开启，不随安装、Connect 或 Discover 自动开启

### 当前还没打通

- chat_surface 自动暴露 MCP capability（默认持续屏蔽）
- Agent 通过候选结果选择 external capability；执行必须进入现有 Planner -> Normalize -> Policy -> ToolNode -> Harness -> Evidence 链路
- external MCP 首次执行进入现有 approval 流程，批准后只执行冻结的 pendingToolCall
- 执行前重新核验 server、Agent Access、Discover 条目和 Harness Registry；stdio / streamable-http session 失效时最多自动恢复一次
- 完整 secret 管理面板
- 非核心内置 MCP package 管理闭环

### Agent eligibility contract

`enabled` 表示 server 的运行开关，`agentEnabled` 表示用户是否允许 Agent 使用该 server；两者不是同一个状态。新安装和历史数据库迁移的 `agentEnabled` 都是 `false`。

Agent 候选只能通过后端单点 resolver 取得。resolver 同时要求 server 已启用、Agent Access 已开启、免责声明已接受、状态为 connected、transport 配置完整、Discover 结果非空，并确认 projected capability 仍存在于 Harness Registry。配置更新会清空 Discover 结果并移除投影；删除、禁用和撤销 Agent Access 立即使其退出资格集合。

启动恢复只注册满足最小 runtime 条件的已发现投影，不恢复 disabled、空 Discover、配置不完整或 stale projection。注册存在不代表 Agent 获得授权，Agent 必须继续经过 eligibility resolver。

### Agent 候选接线合同

Agent intent matcher 每轮从 `resolveAgentEligibleExternalMcpCapabilities()` 取得精确的 projected capability id，并将它们作为 `allowedExternalToolIds` 传给 Harness candidate resolver。`allowExternal` 只是 external 分支的显式开关，不能单独放开全部 external capability；allowlist 为空、包含未注册 id 或不包含某个已注册 external id 时，该 capability 都不会进入 exposure。

external capability 与 internal capability 共用同一套 exposure、topK、minScore、embedding、rerank、task model 和 Tool Guard 链路。候选文档包含 capability id、title、description、tags、有限长度的 input schema 摘要和 server display name；不会把完整 schema、headers、env 或 token 放进模型上下文。`chat_surface` 不使用该 Agent allowlist，仍默认隐藏 external capability。

### Agent Invocation Contract

external capability 不在 Planner 或 Agent 节点内直接调用 MCP `tools/call`。ToolNode 只执行 Policy 已批准的冻结调用，Harness Registry 中的 projected capability 才是唯一执行入口。普通 MCP 网络、session、timeout、JSON-RPC 或非法结果失败进入现有 recoverable tool failure 合同；恢复耗尽后生成受保护的失败回答，Graph 保持 completed / stop，除非命中既有 terminal 条件。

Evidence 记录 projected capability id、external server id、远端 tool 名称、调用状态、结果或错误摘要和 recovery 是否发生。bearer token、secret、custom headers 敏感值和环境变量不会写入 Evidence、trace、日志或最终回答。

## 产品概念边界

产品形态上，`Tool` 和 `MCP` 是两个概念。

- `Tool` 是项目内部核心能力。哪怕底层 schema、事件、harness 实现借用了 MCP 标准，它在产品上仍然是 Tool。
- `MCP` 是非核心能力接入域，包含外部 marketplace MCP server，以及后续 app 自带但非核心的内置 MCP 包。
- MCP 协议里的 tool/resource 只是协议 capability，不自动等于产品里的 `Tool`。

因此 UI 上也要分开：

- Settings -> Tools：内部核心 Tool 工作台
- Settings -> MCP：MCP 市场、第三方 MCP server、未来非核心内置 MCP 包

## 核心定位

外部 MCP server 必须由 backend harness 托管，不能放到 renderer 直接跑。

原因很简单：

- renderer 不能直接持有 Node API
- 外部 server 可能涉及进程拉起、网络访问、密钥与审批状态
- 所有 capability 执行都应该复用现有 invocation 生命周期
- harness 应该继续做统一的进度、产物、失败与完成状态观察者

renderer 可以做：

- 浏览 marketplace
- 安装、启用、禁用、测试 external server
- 查看发现到的 MCP protocol tool / resource
- 编辑配置与密钥

renderer 不该做：

- 直接连接 MCP transport
- 自己保存第三方 server secret 真值
- 绕过 harness 直接执行 MCP capability

## 信任边界

### `tool`

项目内置、处于本项目信任边界内的内部核心 Tool。

例如：

- `read`
- `web_search`
- `terminal_session`

### `builtin-mcp`

后续由 app 自带、但不属于内部核心 Tool 的非核心内置 MCP 包。

它归 Settings -> MCP 管理，不归 Settings -> Tools 管理。

### `external-mcp`

用户安装或连接的第三方 MCP server，以及它暴露出来的 tool / resource。

### `marketplace`

发现元数据来源，不等于信任边界本身。

也就是说：

- marketplace 只能告诉我们“这里有个 server”
- 它不能直接等同于“这个 server 可以安全执行”

## 范围

### 本页覆盖范围

- 浏览 marketplace MCP server 元数据
- 持久化已安装 / 已配置的 external server 记录
- 通过批准的 transport 连接 external server
- 发现 MCP protocol tools / resources
- 把 MCP protocol capability 投影进当前 harness registry
- 通过现有 invocation API 与 SSE 事件模型执行 MCP capability
- 在 backend 内部保存 secret
- 对高风险操作展示风险信息并接入审批

### 第一阶段明确不做

- 普通 chat 流程里的自动 tool calling
- OAuth 账号绑定流程
- 从不受信任包元数据静默自动安装
- transport 之间的静默兼容 fallback
- 未经用户明确确认就执行任意 marketplace code

## 外部来源

第一优先的 marketplace 来源建议是官方 MCP registry：

```text
https://registry.modelcontextprotocol.io/v0/servers
```

但要明确：

- registry 提供的是发现元数据
- 不是执行策略真相
- 不是安全白名单

已安装 server 记录至少要保存这些可审计字段：

- registry source URL
- server id 或 package name
- server version
- transport type
- install command 或 remote URL
- declared capabilities
- last fetched time

## Transport 模型

外部 transport 必须显式建模，不做模糊字符串兜底。

推荐枚举：

```ts
type ExternalMcpTransportKind = "stdio" | "streamable-http";
```

### `stdio`

由 backend 启动并持有子进程。

要求：

- 显式 `command`、`args`、`env`
- 首次启动前必须有用户确认
- 打包态要单独评估兼容性
- 要有 timeout 与进程清理
- 必要时把 stdout / stderr 送进 invocation 事件流

### `streamable-http`

由 backend 连接远端 MCP endpoint。

要求：

- 显式 endpoint URL
- 可选 auth header 或 token reference
- 按 MCP transport 指南处理 headers / origin
- 清晰标注 network-access 风险
- 不允许 renderer 直接连

## 数据模型

推荐的 backend record：

```ts
type ExternalMcpServerRecord = {
  id: string;
  source: "registry" | "manual";
  registryUrl?: string;
  packageName?: string;
  displayName: string;
  description?: string;
  version?: string;
  transport: ExternalMcpTransportConfig;
  status: "configured" | "connected" | "disabled" | "failed";
  enabled: boolean;
  agentEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt?: string;
  lastError?: string;
};

type ExternalMcpTransportConfig =
  | {
      kind: "stdio";
      command: string;
      args: string[];
      envSecretRefs?: Record<string, string>;
    }
  | {
      kind: "streamable-http";
      url: string;
      authSecretRef?: string;
    };
```

推荐的已发现 tool record：

```ts
type ExternalMcpDiscoveredCapability = {
  id: string;
  serverId: string;
  externalName: string;
  projectedCapabilityId: string;
  title: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  risk: McpCapabilityMetadata;
  lastDiscoveredAt: string;
};
```

## MCP Capability 投影规则

MCP capability id 不能和内部核心 Tool id 冲突。

内置 capability 继续保留稳定 id，例如：

- `read`
- `read_locate`
- `web_search`
- `terminal_session`

第三方 MCP protocol capability 统一使用投影命名。

推荐格式：

```text
mcp:<server-id>:<capability-kind>:<capability-name>
```

规则：

- 当前真实已落地的投影只有 tool，因此现网格式是 `mcp:<serverId>:tool:<toolName>`

- 保留外部 MCP capability schema
- 每次 invocation 都挂上 `serverId`
- 未知副作用默认按“需要审批”处理
- 远端 MCP capability 默认视为 `networkAccess: true`
- `stdio` MCP capability 默认视为 `sideEffect: process`
- 不做静默降级到内部核心 Tool 的 fallback
- renderer 页面直接展示 projected id，方便排查、审批和 trace 对齐

## API 面

第一轮建议路由：

```text
GET    /mcp/marketplace/servers
POST   /mcp/external/servers
GET    /mcp/external/servers
GET    /mcp/external/servers/:id
PATCH  /mcp/external/servers/:id
POST   /mcp/external/servers/:id/connect
POST   /mcp/external/servers/:id/disconnect
POST   /mcp/external/servers/:id/discover
DELETE /mcp/external/servers/:id
```

注意：

- 这些都是 backend route
- 不包含开发态专用 `/api` 前缀

## Secret 处理

renderer local storage 不能作为 external MCP secret 的主存储。

`.env` 也不适合作为用户驱动的 marketplace server 主存储，因为它不适合：

- UI 安装 / 删除
- token 轮换
- 每个 server 各自的 credential
- 打包桌面端的持久状态

MVP 决策建议：

- external server record 放 SQLite
- secret material 放 SQLite 加密字段
- API 返回只给脱敏元数据，例如 `hasSecret`
- invocation 时只在 backend 执行上下文里解析 secret
- 删除 server 时同步删 secret 记录

建议表：

```text
external_mcp_servers
external_mcp_server_secrets
```

如果以后迁移到 Windows Credential Manager 或其他 OS keychain，也应该保留稳定的 `secretRef`，避免 transport / config 模型再次重构。

## 配置表单策略

不能把 external MCP server 的配置问题简化成“给一个 token 输入框”。

现实里一个 server 可能同时需要：

- endpoint URL
- auth token / API key / custom headers
- workspace / tenant / org / project
- region / mode / provider
- server 自己额外要求的业务字段

而且这些字段不一定都能从 marketplace、MCP 包或 server 自描述里自动拿全。

### 市面上成熟产品的共性

当前主流产品基本都收敛到同一个判断：

- 不假设可以从 MCP 包里自动提取完整安装表单
- 先接入 server 定义，再逐步补配置
- secret 和非 secret 字段分开
- 允许工作区级、用户级、环境变量级配置叠加
- 给高级用户保留 headers / env / raw config 兜底入口

也就是说，成熟产品做的是：

`server definition + known config + secret inputs + advanced config + validation loop`

而不是：

`自动生成一次性完美表单`

### 本项目应该怎样落

这里推荐把 external MCP 配置理解成多来源合成的“已知配置草案”。

来源通常有四层：

1. 项目内置 preset / adapter
2. marketplace 元数据
3. server 自身可发现的声明
4. 用户手工补充

因此 backend 不应该承诺“返回完整 schema”，只能承诺：

- 返回当前已知的配置字段
- 标注这些字段来自哪里
- 标注这份 schema 是否可能不完整
- 允许用户继续补充高级配置

推荐模型：

```ts
type ExternalMcpConfigField = {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "select" | "boolean" | "number" | "json";
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
};

type ExternalMcpConfigSchemaResolution = {
  fields: ExternalMcpConfigField[];
  completeness: "known-partial" | "known-good" | "unknown";
  sources: Array<"preset" | "marketplace" | "server-self-describe" | "manual">;
  notes?: string[];
};
```

### 渐进式配置，而不是一次填完

更现实的交互主线应该是：

1. 用户安装 server
2. 系统展示“当前已知字段”
3. 用户填写
4. backend 尝试 `connect`
5. 如果失败：
   - 展示错误
   - 保留现有配置
   - 允许继续补字段
   - 必要时进入高级配置

这意味着配置系统必须支持：

- schema 不完整
- connect 后再修
- secret 与普通字段分开保存
- raw headers / raw JSON 作为高级兜底

### MVP 建议

第一轮不必一步做到全能动态表单，但方向要对。

建议先支持三层：

1. 基础配置
   - endpoint
   - transport
   - display name
   - timeout

2. 已知字段表单
   - text
   - password
   - boolean
   - select
   - json

3. 高级配置
   - custom headers
   - extra env / secret refs
   - raw config JSON

这样可以覆盖大多数 `streamable-http` server，同时不假装我们能自动知道全部业务字段。

## Marketplace Source 策略

marketplace 来源不应和 UI 语言强绑定。

正确关系是：

- 语言影响文案
- source 决定元数据来源
- 二者可以影响默认值，但不是同一个设置

推荐模型：

- 默认 source：官方 MCP registry
- 国内友好 source：镜像、自托管 curated registry、静态 JSON
- MVP 可先支持 runtime / env override，例如 `MCP_REGISTRY_URL`
- 后续再补 UI source selector

未来可补：

```text
GET /mcp/marketplace/sources
PUT /mcp/marketplace/source
GET /mcp/marketplace/servers?source=official
```

## 权限与免责声明

外部 MCP capability 默认应走显式风险审查。

审批输入至少包括：

- server identity
- transport kind
- tool name
- declared schema
- side effect metadata
- network / process / local-write 标记
- 涉及的 workspace 或 root scope

默认策略建议：

- 只读元数据浏览不需要审批
- 第一次连接 external server 需要审批
- 启动 `stdio` server 需要审批
- 本地写、进程、网络类 tool 在执行前需要审批
- 风险元数据不明时默认需要审批

### MVP 免责声明模型

MVP 不一定马上做完整 per-tool approval，但至少要有 third-party server 安装 / 启用免责声明。

建议：

- 内部核心 Tool 不走 MCP 安装免责声明
- app 自带但非核心的内置 MCP 包归 Settings -> MCP 管理，按 MCP 产品策略决定是否需要额外提示
- user-installed / user-connected third-party server 必须接受一次免责声明
- invocation-time approval 先预留策略接口
- disclaimer acceptance 必须可持久化、可审计

可持久化结构：

```ts
type ExternalMcpDisclaimerAcceptance = {
  serverId: string;
  acceptedAt: string;
  acceptedVersion?: string;
  disclaimerTextHash: string;
};
```

如果免责声明文本或 server version 发生重要变化，可以要求重新确认。

## 与 Chat Runtime 的关系

第一阶段不要改普通 chat 主链。

后续真要接入 chat tool calling，流程应该是：

1. provider 提出 tool call
2. backend 把目标 id 映射到内部核心 Tool 或已投影 MCP capability
3. harness 检查审批与执行策略
4. 如果需要审批，run 进入 approval-wait
5. 已批准的 invocation 发出 trace 与 artifact
6. tool result 通过 provider proxy adapter 回写到模型上下文
7. 最终 assistant 输出以 `uchat` 的 canonical message parts 持久化

也就是说，真正动 chat 之前，还要同步设计这些页面：

- `../provider/README.md`
- `uchat.md`
- `../tooling-runtime/harness-runtime-design.md`

## UI 放置建议

第一阶段放在 `Settings -> MCP`，不要挂在 `Settings -> Tools` 下面。

建议视图：

- `Marketplace`
- 已安装 / 已连接 MCP server
- 未来非核心内置 MCP 包
- connection status
- discovered MCP protocol tools / resources
- manual invocation test panel
- per-server secret / config editor
- risk / disclaimer display

页面边界：

- `Settings -> Tools`
  - 按五大内置域分组：`read`、`edit`、`web_search`、`terminal`、`browser_action`
  - 只承载内部核心 Tool 工作台
- `Settings -> MCP`
  - 关注 MCP server 浏览、风险审查、安装前评估
  - 后续承载已连接 MCP server、非核心内置 MCP 包、discovered capability 与 projected id

这样可以保持产品概念清楚，即使底层都复用同一套 harness / invocation 基座。

## 当前复盘

这一轮 MCP 接入已经暴露出一些足够稳定的经验，后续设计和实现应直接复用，不要再从头试错。

### 1. 先分清产品边界，再谈接入

`Tool` 和 `MCP` 必须继续分开。

- `Tool` 是项目内部核心能力
- `MCP` 是非核心能力接入域
- MCP 协议里的 tool / resource 不自动等于产品里的 `Tool`

如果这层边界不先立住，后续 UI、权限、审批、chat 接入都会混乱。

### 2. 真正的复杂度在生命周期，不在协议名词

外部 MCP 接入最麻烦的不是 `initialize`、`tools/list` 这些协议方法本身，而是完整生命周期：

- 市场发现
- 安装记录
- transport 差异
- 配置补全
- secret 存储
- connect / discover
- capability 投影
- 审批与执行
- 后续接入 chat runtime

因此实现顺序必须按生命周期推进，不能因为协议打通就误判为“整体完成”。

### 3. “进程启动了”不等于“stdio MCP 可用”

这轮 `slideshot-mcp` 的排查已经证明：

- 子进程能启动
- banner 能输出
- 不代表 `initialize` 已经成功

stdio MCP 是否真正可用，必须以：

- 能正确发送 `initialize`
- 能正确收到 `initialize result`
- 能继续完成 `notifications/initialized`
- 能跑 `tools/list`

作为判断标准，而不是只看进程是否拉起。

### 4. stdio transport 必须紧跟当前官方规范

本轮实际故障之一来自 stdio framing 与官方 MCP 当前规范不一致。

经验结论：

- 本项目的 stdio client 实现必须持续对齐官方 MCP transport 规范
- 不要把过时 framing 当成默认真相
- 每次升级 protocol / SDK / 上游 MCP server 之后，都要复测至少一条真实 stdio server

推荐保留一条已验证的 stdio 样例作为回归基线，例如：

- `slideshot-mcp`

### 5. marketplace 元数据只能当线索，不能当执行真相

官方 registry 或其他 marketplace 只能告诉我们：

- 有哪些 server
- 基础 transport / package 元数据
- 文档和仓库入口

但它不能直接保证：

- 安装参数完整
- 配置字段完整
- server 一定能运行
- 风险一定可接受

所以 marketplace 层永远只是“发现来源”，不是“执行真相”。

### 6. 外部 MCP 配置天然是不完整的

成熟产品的共同点已经很清楚：

- 不假设可以自动拿到完美表单
- 先给 known config
- 再让用户补字段
- connect 失败后继续修

因此本项目对 external MCP config 的正确理解应该是：

`已知配置草案 + 高级兜底入口 + 验证回路`

而不是“安装时一次填完全部必需字段”。

### 7. 严格性应该压在 backend / runtime，而不是压在第一屏体验

经验上应该区分三层：

1. 浏览 / 安装：尽量轻
2. 连接 / 启用：开始做风险确认
3. 执行 / chat 调用：严格执行 approval、secret、审计策略

也就是说：

- 产品体验可以轻
- 运行时策略必须严

不要把所有严格性都提前到安装和浏览阶段。

### 8. chat 接入必须晚于 lifecycle 闭环

如果 external MCP 还没有稳定完成：

- install
- connect
- discover
- projection
- error reporting

就急着接进 chat runtime，问题只会被埋得更深。

正确顺序仍然应该是：

`市场 -> 已安装 server -> discovered capability -> projected capability -> chat runtime`

### 9. 多 MCP 共存是必需的，但不必过早做重调度

从产品形态看，多个 MCP server 共存是刚需。

但要区分三层：

- 多个已安装：必须支持
- 多个已连接：应该支持
- 多个 MCP capability 自动协同与竞争调度：先不要做重

chat 早期更适合消费“已启用 + 已投影”的统一能力池，而不是直接暴露复杂的多 server 竞争模型。

### 10. 当前阶段已经进入“运行时形态正确性”阶段

本轮工作最大的价值不只是页面做出来了，而是已经从“界面像不像”进入到“运行时形态是否正确”。

这意味着后续评估 MCP 工作是否完成，不能只看：

- 页面是否能展示
- 市场是否能搜到
- 按钮是否能点

还要看：

- transport 是否真正可用
- projected capability 是否稳定
- secret / approval / trace 是否站得住
- chat runtime 将来是否能无缝消费

这个判断应作为后续 Phase 2 / Phase 3 的设计基线。

## 与 Tool 文档的分工

这页只维护 MCP 产品边界和外部 server 生命周期，不重复写工具协议总纲。

协议真相请优先看：

- `../tooling-runtime/README.md`
- `../tooling-runtime/tools-protocol.md`
- `../tooling-runtime/harness-runtime-design.md`

如果这里和 Tool 侧口径冲突，以运行时真相页为准，然后回头修这页的产品表述。

## 打包注意事项

Electron 打包态通过内置 Node runtime 跑 backend。

要在打包态支持 `stdio` external server，至少要验证：

- backend 能正常拉起子进程
- command lookup 不依赖开发机 PATH
- app 退出时能清理 server 进程
- 不会隐式依赖 `resources/server/node_modules` 之外的原生模块

如果这些条件不满足，就应该：

- 暂时禁用 `stdio` marketplace server
- 或明确标成 dev-only

## 分阶段计划

## Delivery Checklist

### 已完成

- [x] 确认产品边界：`Tool` 和 `MCP` 分离，`Settings -> MCP` 作为独立产品域
- [x] 完成 MCP 市场浏览 MVP：独立页面、市场拉取、基础文档与文案
- [x] 市场列表支持按可安装性、远程服务和本地包进行本地筛选
- [x] 市场条目支持打开详情抽屉，查看 Registry 已返回的版本、维护时间、链接和 transport 信息
- [x] 完成 Phase 1 后端：external MCP server record、`streamable-http` connect/discover、capability projection、手动 invocation
- [x] MCP Agent Job Release Complete：市场安装、连接、Discover、用户授权 Agent、语义选择、审批、Harness 调用、Evidence 和回答已完成

当前 Agent 调用主链路：

```text
市场 → 安装 → 连接 → Discover → 用户授权 Agent 使用
→ Agent 语义选择 → 审批 → Harness 调用 → Evidence → 回答
```

本期仍不包含：OAuth、MCP resources、MCP prompts、server 自动更新、自动安装、自动 Discover、每工具细粒度权限和多 MCP 编排。

我已完成的自动化测试：

- [x] marketplace response normalization
- [x] invalid registry payload handling
- [x] marketplace transport/installable filter
- [x] marketplace metadata details drawer
- [x] external server 创建、connect、discover、projection、manual invocation 路由链路
- [x] disclaimer 未接受时拒绝安装 external MCP server

需要你手测的项目：

- [ ] 打开 `Settings -> MCP`，确认市场页入口、文案和 Tool/MCP 产品边界符合预期
- [ ] 验证市场筛选与详情抽屉在真实 Registry 数据下的可读性
- [ ] 确认当前 MCP 页面没有再混进 `Settings -> Tools`

当前已完成项的验收标准：

- [x] 产品形态上 `Tool` 与 `MCP` 明确分离，页面入口与文档表述一致
- [x] 后端可以接入一个 `streamable-http` external MCP server，并完成 connect/discover/invocation 最小闭环
- [x] third-party external MCP server 在安装前必须接受一次免责声明

### 当前可复现手测用例

以下用例基于 2026-06-27 已接通的 `Settings -> MCP` 页面整理，后续回归优先复用，不要再靠口头回忆。

#### 用例 A：Remote HTTP MCP 安装与连接

目标：

- 验证 marketplace 搜索
- 验证 `remote / Remote HTTP` 条目安装
- 验证已安装页的 connect / discover 基本闭环

市场搜索词：

- `tandem`

预期命中的 registry 条目：

- `ac.tandem/docs-mcp`

预期 transport：

- `Remote HTTP`
- endpoint: `https://tandem.ac/mcp`

手测步骤：

1. 打开 `Settings -> MCP`
2. 切到 `市场`
3. 搜索 `tandem`
4. 确认列表中出现 `ac.tandem/docs-mcp`
5. 确认 transport 显示为 `remote`
6. 点击安装
7. 切到 `已安装`
8. 确认卡片中能看到：
   - `Docs`
   - `GitHub`
   - `Endpoint: https://tandem.ac/mcp`
9. 点击 `连接`
10. 点击 `Discover`

通过标准：

- 能成功安装到 `已安装`
- `连接` 后不出现持续失败状态
- `Discover` 后能看到 discovered tools 数量或结果变化
- 已安装卡片中的 server 信息与 marketplace 条目一致

已知说明：

- 我们已直接验证过 `https://tandem.ac/mcp` 的 `initialize` 与 `tools/list` 可正常返回
- 如果这里失败，优先怀疑本地配置状态或应用侧错误透传，而不是先怀疑这条 remote 本身失效

#### 用例 B：npm MCP 条目识别与安装参数

目标：

- 验证 marketplace 对官方 registry npm 包字段的解析
- 验证 npm 条目不再被误判成 `unknown`
- 验证安装时自动填充 `npx` 启动参数

市场搜索词：

- `pare npm`

预期命中的 registry 条目：

- `io.github.Dave-London/npm`

预期 package 信息：

- npm 包名：`@paretools/npm`
- transport：`npm package`
- 安装后默认 launcher：
  - command: `npx`
  - args: `["-y", "@paretools/npm"]`

手测步骤：

1. 打开 `Settings -> MCP`
2. 切到 `市场`
3. 搜索 `pare npm`
4. 确认 `io.github.Dave-London/npm` 不再显示为 `unknown`
5. 确认该条目可安装，而不是 `暂不支持`
6. 安装后切到 `已安装`
7. 打开 `配置`
8. 确认配置表单按 `stdio` 渲染
9. 确认页面能看到 package / launcher 信息
10. 确认默认值为：
    - `Command = npx`
    - `Args JSON = ["-y","@paretools/npm"]` 或等价格式

通过标准：

- npm 条目可安装
- transport 展示正确
- 已安装配置页默认 launcher 正确
- 不再出现 `Transport unknown · @paretools/npm`

回归背景：

- 官方 MCP registry 当前很多条目返回 `registryType`
- 我们已经兼容 `registry_type` 与 `registryType`

#### 用例 C：本地目录立即读取与后台同步

目标：

- 验证市场列表只读取 SQLite 本地目录
- 验证相同时间触发的自动更新和手动更新复用同一个同步任务
- 验证官方 registry 抖动时，已返回的市场页不整页报废

前提：

- 先完成一次市场全量同步，让 SQLite 中存在本地目录

建议搜索词：

- `tandem`
- 或空搜索直接加载市场首页

手测步骤：

1. 正常进入 `Settings -> MCP -> 市场`
2. 成功看到一批列表结果
3. 再次进入市场或点击 `刷新`
4. 观察页面是否继续显示本地目录和“正在后台更新”状态
5. 观察同步完成后，列表与最后更新时间是否更新

通过标准：

- 本地目录读取不等待上游响应
- 后台同步失败不影响已经返回的列表
- 同一进程并发触发只运行一个同步任务
- 空目录会触发首次全量同步，并能通过状态看到进度或失败
- 搜索、分类、transport 与可安装性筛选都作用于完整本地目录

实现说明：

- Registry 单次同步请求超时为 `10s`
- 自动增量间隔为 `6h`，增量水位向前重叠 `5min`
- 每 `7d` 执行一次全量校正
- 同步结果与状态持久化在 SQLite
- 同步失败保留最后一次成功目录

### 进行中

- [ ] 完成 Phase 1 前端：`Settings -> MCP` 接 external server API，展示已安装/已连接 server、discover 结果与 projected capability id

我会补的自动化测试：

- [ ] external server 列表渲染
- [ ] connect/discover 动作状态
- [ ] projected capability id 展示
- [ ] 错误态、空态、刷新态

需要你手测的项目：

- [ ] 从 MCP 页面能看到已安装 server、连接状态、discover 结果
- [ ] projected capability id 的呈现方式符合你的产品预期
- [ ] 状态流和按钮命名符合你的使用习惯

验收标准：

- [ ] `Settings -> MCP` 不只浏览 marketplace，还能展示真实 external MCP server 生命周期状态
- [ ] 用户能清楚区分 marketplace server、installed server、discovered capability、projected capability id
- [ ] 页面刷新后已安装/已发现状态仍能正确恢复

### 待做

- [ ] 完成 Phase 1 前端交互：从 marketplace 发起安装，安装时弹一次第三方免责确认
- [ ] 完成 Phase 1 测试补齐：前端 external server 状态流、connect/discover 动作、错误态与空态
- [ ] 完成 Phase 2 后端：secret 存储、脱敏返回、server config 更新接口
- [ ] 完成 Phase 2 后端：approval record 与高风险 capability denial
- [ ] 完成 Phase 2 前端：secret/config 编辑、风险展示、approval 状态展示
- [ ] 完成 Phase 2 测试补齐：secret 不回流、approval denial、生效边界
- [ ] 完成 Phase 3 设计收口：provider/chat runtime 与 MCP capability 调用协议对齐
- [ ] 完成 Phase 3 实现：chat tool calling、approval-wait、`uchat` trace 持久化
- [ ] 完成后续扩展：非核心内置 MCP 包管理、marketplace source 切换、`stdio` transport

后续每项都需要补三类内容：

- [ ] 我负责的自动化测试
- [ ] 需要你手测的项目
- [ ] 明确的验收标准

### Phase 1：Marketplace + 手动 Invocation

交付：

- marketplace metadata fetch
- manual external server records
- 先支持一种 transport，优先 `streamable-http`
- MCP capability 投影进 harness registry
- 通过 `/mcp/invocations/stream` 手动调试
- registry parsing、projection、invocation routing 的测试
- external server 安装 / 启用免责声明

完成条件：

一个已配置的 external MCP server 能在 Settings -> MCP 里展示 projected MCP capability，并能通过 backend SSE invocation flow 手动调用。

### Phase 2：Secret 与 Approval 加固

交付：

- backend-owned secret storage
- 脱敏 server config response
- approval records
- UI 风险展示
- invocation denial tests

完成条件：

敏感 MCP capability 在没有审批状态时不能运行，且 secret 不会回流到 renderer response。

### Phase 3：Chat Tool Calling

交付：

- provider capability definition projection
- backend chat tool-call loop
- approval-wait 事件语义
- `uchat` canonical invocation trace parts
- assistant message 上的 durable invocation reference

完成条件：

一次 chat run 可以调用已批准的 MCP capability，持久化 invocation trace，并在刷新后回放。

## 测试要求

每个实现阶段都必须同改同测。

最低 backend 测试：

- marketplace response normalization
- invalid registry payload handling
- external server config validation
- MCP capability id projection 与 collision handling
- connect / discover failure reporting
- external MCP capability invocation lifecycle events
- high-risk MCP capability approval denial

最低 renderer 测试：

- external server list rendering
- 脱敏 secret 展示
- connect / discover 动作状态
- MCP 页面能展示 projected MCP capability id

手动验证：

```bash
pnpm check
pnpm package:electron:win
```

涉及打包影响时，还要按 `runtime.config.cjs` 里的 host / port 检查打包后 backend health。
