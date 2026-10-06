---
status: current
owner: runtime
last_verified: 2026-10-06
layer: wiki
module: Tool
feature: ToolRuntime
Doc Type: current-snapshot
canonical: true
related:
  - AGENT_CURRENT_TRUTH.md
  - harness/README.md
  - harness/agentgraph-harness-protocol.md
  - tooling-runtime/README.md
  - tooling-runtime/tools-protocol.md
  - skill/README.md
---

# UIChat Mira Tool 当前真相

> 这页记录 `dev` 分支当前真实存在的 Tool / Harness 工具面、暴露规则、审批、执行、结果与降级语义。它不重新设计 Agent Graph，也不把历史整改计划包装成现状。

## 1. 先说结论

Mira 当前的 Tool 系统不是一张固定的“四类工具清单”，也不是由 Harness 猜测任务阶段后只给 Planner 几个工具。

更准确的运行关系是：

```text
built-in registry + dynamic capability registration
  -> public-surface classification
  -> explicit availability gates
  -> Tool Exposure
       <= 20：全部暴露
       > 20：embedding / rerank 后暴露前 20
  -> Main Planner 或受控 Child 选择 concrete tool
  -> Normalize 冻结 pendingToolCall
  -> Policy / Approval
  -> Harness Invocation
  -> pending tool result / retrieval result
  -> Evidence
```

Harness 是 concrete tool 的控制平面，不是 Planner、SubAgent 编排器或最终回答器。

## 2. Registry 与 Public Surface 必须分开

`server/src/harness/runtime.ts` 注册当前可执行内置能力。历史 Evidence 可以继续读取旧 summary，但不会为了旧调用保留第二套 File Mutation runtime。

**注册存在不等于 Planner 可见。**

当前 exposure policy 会隐藏 Universal Read 的内部 / 兼容 primitive，例如：

- `read_discover`
- `read_open`
- `read_list`
- `read_locate`
- `read_extract`
- `read_slice`

这些 Read 对象可以继续服务已验证的 Skill / runtime consumer，但不是当前 canonical Universal Read 公共 Planner 工具。旧本地 mutation id 不再注册，因此不需要靠 exposure policy 隐藏。

动态注册还包括：

- Managed Computer Use browser tools；
- Attached Browser tools；
- `codebase_explore`；
- 已连接且符合条件的 external MCP projected tools；
- 其他运行时按真实服务状态注册或过滤的能力。

因此，任何工具文档都必须同时回答：

1. registry 中是否存在；
2. 是否属于公共 surface；
3. 当前环境是否可用；
4. 是否进入本轮 Tool Exposure；
5. 本次 exact invocation 是否获准执行。

## 3. 当前公共 Read 面

Phase 2 canonical Universal Read 已收敛为：

```text
read
list
glob
grep
```

当前真实 Agent exposure 中：

- canonical Universal Read 只暴露 `read / list / glob / grep`；
- `codebase_explore`：独立 Code / Work Context 能力，不属于 Universal Read；
- `read_discover / read_open / read_list / read_locate / read_extract / read_slice`：兼容实现，当前不进入新的 Agent exposure；是否删除取决于已验证的 Skill / runtime / persisted consumer。

### `read`

已知文件读取：

- 输入保持简单：`path / offset? / limit?`；
- `offset` 表示跳过多少行，返回的人类行号仍从 1 开始；
- 单次输出有限，但通过 `nextOffset` 可以继续读取，不把单次上限当成文件能力上限；
- 常见 UTF BOM / UTF-16 文本按明确编码读取；
- 二进制返回 structured unsupported；
- DOCX / XLSX / PPTX / PDF 不由 generic `read` 解析，返回 Office/WenShu Skill routing outcome；
- 图片通过同一个 `read` 返回，不新增 `read_image`；
- 图片实现以 Gemini CLI `read_file` 为单一参考基线：SVG 继续按文本读取，其他 `image/*` 文件在 20 MB 单文件上限内以 MIME + base64 的 model-facing image block 进入 Harness；
- base64 不进入 structured result、Evidence、普通 invocation 读取或日志；Harness 仅把图片作为当前模型调用所需的内容传递；
- 图片 payload 不是 durable Evidence；若 backend 重启或 retention 后 payload 已不可用，Planner 必须重新 `read` 该图片，Generate 不允许仅凭旧的“已读图片”元数据完成回答；
- Planner 与 Generate 把需要的 Tool 图片投影到 Mira 已有的 latest-user image message path，Provider 继续使用既有图片适配，不由 `read` 了解 provider wire format。

### `list`

已知目录的直接子项观察：

- 不递归；
- 目录优先、稳定排序；
- `offset / limit / nextOffset` 分页；
- 默认应用 workspace ignore 规则；
- `includeIgnored=true` 可显式查看默认忽略项，但不会扩大 workspace/symlink authority。

### `glob`

按文件路径 glob pattern 找文件：

- 例如 `**/*.tsx`、`src/**/index.*`、`**/package.json`；
- 不搜索文件正文；
- `path` 只限定搜索起点，不改变 workspace authority；
- `offset / limit / nextOffset` 分页；
- 默认 ignore 可由 `includeIgnored=true` 显式覆盖；
- 不跟随 symlink 目录越界。

### `grep`

按正文搜索并返回匹配位置：

- `pattern` 默认是正则；`literal=true` 时按字面文本；
- omitted `caseSensitive` 使用 smart-case，显式 true/false 可覆盖；
- `include` 使用 glob 筛选候选文件；
- `context` 可返回有限上下文行；
- `offset / limit / nextOffset` 支持继续取后续匹配；
- `includeIgnored=true` 可显式搜索默认忽略项；
- provider 顺序是 bundled ripgrep → system ripgrep → deterministic async Node fallback；
- timeout / AbortSignal cancellation 适用于整个 provider/fallback deadline；
- no-match 是成功空结果，不等于 runtime/provider failure。

四个 Tool 的选择原则是：

```text
read   known file      -> contents
list   known directory -> direct children
glob   path pattern    -> matching file paths
grep   content query   -> matching content locations
```

它们追求首选意图清晰，不追求为了“绝对互斥”而削弱能力。

### `read_discover`

当前仅作为兼容实现保留，已退出新的 Agent exposure。新 Planner / Skill / consumer 不再以它承载目录观察或路径发现；对应新语义分别使用 `list` / `glob` / `grep`。

### `codebase_explore`

用于代码架构、关系、调用链和影响面探索：

- 原生 CodeGraph 命令留在 wrapper 内；
- 候选会回到当前 workspace 做 source verification；
- 已核验 excerpt 可以进入 retrieval Evidence；
- provider 不可用时工具仍存在，并返回结构化 degraded / fallback signal。

它不是 Universal Read，也不是第二个 Planner。

## 4. 当前公共 Edit 面

Planner 当前直接看到四个 canonical File Mutation 动作：

```text
Edit
├─ write
├─ edit
├─ delete
└─ move
```

四个动作统一进入 `server/src/mcp/file-mutation/` 下的 File Mutation Runtime，不存在第二套本地写 runtime。

### `write`

- 新建文件；
- 只有显式 `overwrite=true` 才整文件覆盖；
- `content` 是完整目标内容；
- 创建父目录；
- 不承担局部 patch；
- 覆盖既有文本时保留已识别的 BOM / encoding / dominant line ending。

### `edit`

- 面向已存在文本文件；
- 一次接受多个 `edits[]`；
- exact match 优先；
- 只允许有限、可解释的 whitespace / line-ending / 常见 Unicode quote-space-dash 容差；
- 0 次或多次匹配都失败；
- 所有 edit 在 commit 前一起验证，重叠 edit 失败；
- 不做 fuzzy distance、regex 猜测、AST 或 LLM repair。

### `delete`

- 删除文件或目录；
- 非空目录需要显式 `recursive=true`；
- final symlink / junction mutation target 被拒绝；
- 不把失败伪装成成功。

### `move`

- 移动或重命名文件 / 目录；
- 默认不覆盖目标，覆盖必须显式 `overwrite=true`；
- 支持 case-only rename；
- 不采用 delete-destination-first；
- `EXDEV` 不偷偷降级为 copy+delete，而是安全失败并保留 source / destination。

四个公开 Edit 工具都声明：

- `sideEffect = local-write`；
- `requiresApproval = true`；
- `workspaceBound = true`。

Approval 只授权 frozen exact invocation；它不会扩大 workspace authority。结果统一进入 Result / Artifact / `file_mutation` Evidence。旧 `write_file / replace_block / delete_path / move_path / edit_file / workspace_mutation` 已退出本地可执行 registry；旧 `edit_file / workspace_mutation` Evidence shape 仅用于读取历史持久化 run。

## 5. Search 不是一个含糊入口

当前至少有两个不同的数据源合同：

### `web_search`

- 搜索当前公共互联网；
- provider 在受信任 runtime config 中选择；
- 当前支持 Tavily / SearXNG；
- 模型只提供 `queries`（1–4 条查询，去重非空字符串）与 `maxResults`；
- Runtime 对所有 query 并发 fan-out，结果按 URL 归一化去重合并；
- `maxResults` 是最终 merged 结果总上限，默认 4，限幅 1–10；
- 当前 provider 任一 query 出现真实 provider failure 时，整批 queries 按既有计划尝试下一可用 provider；
- provider 批次都失败时返回结构化错误；
- `sideEffect = network`，但 definition 当前 `requiresApproval = false`。

`apiKey`、`baseUrl` 和 provider 不是 LLM 参数。

### `web_fetch`

- 抓取并提取已知公网 `http` / `https` URL 的可读正文；
- 模型只提供 `url`；
- 仅允许公网 http/https 目标：内网 / loopback / link-local / 云元数据地址、非 http(s) 协议以及携带凭据的 URL 都会被拒绝；
- 直连走 SSRF-safe 的 guarded transport；代理（SOCKS）路径在请求前重新校验目标，并对每个 redirect hop 重新校验；
- 具备 timeout、caller cancellation 与响应体大小上限；
- transport 返回有界原始字节；提取层按 `Content-Type` / charset（含 BOM 与 HTML meta 声明）用 `iconv-lite` 解码，不假定 UTF-8；
- HTML 经 `jsdom → @mozilla/readability → turndown` 转为主正文 Markdown；`text/*`、JSON、XML 作为可靠文本输出；
- 返回 `url` / `finalUrl` / `status` / `contentType` / `byteLength` / `truncated` / `kind`，以及 `title` / `content`（`html` / `text`）或 `reason`（非成功 outcome）；
- 明确依赖 JS、登录或 anti-bot challenge 的页面优先返回结构化 `browser_required`，即使页面同时包含大段文本；
- 无上述浏览器证据且无法获得可信正文时（如静态短页面）返回结构化 `unsupported`，既不返回整页导航 / 脚本垃圾，也不误报 `browser_required`；
- 不支持的二进制内容返回结构化 `unsupported`；PDF / 文档暂不解析，返回 `unsupported`（deferred），不新建第二套文档解析器；
- transport 结构化失败可区分 `blocked` / `http` / `network` / `timeout` / `cancelled`，caller cancel 的最终语义是 `cancelled`；
- provider、proxy、parser 与安全实现细节不进入模型可见契约；
- `sideEffect = network`，definition 当前 `requiresApproval = false`。

`web_fetch` 不会因为页面依赖 JavaScript 或登录状态而自动升级为浏览器自动化；Attached / Managed Browser 仍是独立能力面。

### `news_search`

- 查询本地 News Hub 已收集缓存；
- 使用关键词、向量、融合与 rerank；
- 不等于实时公网搜索；
- 默认 4 条，限幅 1–10；
- `sideEffect = none`，不需要审批。

不得再根据用户措辞把 `web_search` 偷换成 `news_search`，反之亦然。

## 6. Terminal 是完整 Host Runtime

当前唯一 Terminal 工具是：

```text
terminal
```

兼容边界：旧 `terminal_session` 仅作为 persisted approval/run 的隐藏兼容 ID 保留，不进入新的 Agent Tool Exposure；待受支持的旧 checkpoint 不再可能引用该 ID 后删除。

它支持：

- shell / process 执行；
- Node、Python、Git、包管理器与脚本；
- ephemeral / persistent session；
- PTY；
- stdout / stderr 或 merged stream；
- timeout / cancel / abort；
- attach 已有 session；
- 长任务、watcher、dev server 与 REPL；
- Windows Job Object / taskkill fallback；
- POSIX process group。

Persistent 输出当前采用有界返回 + continuation：

- 单次结果默认最多返回 8 MiB，最大可请求 64 MiB；
- 未返回的 persistent 输出不会因为本轮结果截断而丢失，而是写入受 session 生命周期管理的临时 spool；
- 返回 `continuationId / nextOutputOffset / outputBytesAvailable`，后续调用同一个 `terminal` 且只提供 continuation 参数即可继续读取，不会向 PTY 写入新命令；
- observation timeout 只结束本轮等待，collector 继续接收该 persistent command 的后续输出；命令完成后 continuation 可以读取最终剩余日志与 exit code；
- cursor 使用 UTF-8 byte offset，并由 runtime 返回稳定的 `nextOutputOffset`，避免分页切断多字节字符；
- session 被移除时，对应 spool 会一并清理。

Persistent session 控制仍然通过同一个 `terminal` Tool 完成：

- `operation: "status" + sessionId` 只观察最新 persistent work 状态，不向 PTY 写入命令；
- 状态为 `running / completed / failed / cancelled`，其中完成/失败由实际 exit code 驱动；
- `operation: "stop" + sessionId` 停止该 session 所拥有的进程树；
- stop 会等待现有 Windows Job Object / taskkill tree 或 POSIX process group cleanup 完成后，才返回 `state: "cancelled"` 与 `cleanupCompleted: true`；
- stop 不创建第二套进程 runtime，也不引入 `job_*` Tool；
- unknown / stale `sessionId` 明确失败，不静默退化成新 session。

Tool Lab 当前把 #236 的验收路径直接暴露出来：

- Terminal 注册短命令成功、短命令失败、持久任务、失效会话四个固定 acceptance case；
- approval-bound 调用在 Tool Lab 内使用现有 Approval API 显式批准/拒绝，不绕过治理；
- persistent 结果出现 session 后，可直接 Continue output、Inspect status、Stop；
- Continue 使用 runtime 返回的 continuation cursor，不会执行第二条命令；
- 状态与 session identity 会同时显示在 Terminal package / execution stream 中，便于真人验收。

它不是 generic integration container，但也不是已经退役的 command sandbox。

### Terminal 与 workspace 的真实边界

`terminal` 仍声明：

- `requiresApproval = true`；
- `workspaceBound = true`；
- `sideEffect = process`；
- `longRunning = true`。

但当前 `cwd` 合同允许：

- workspace 相对路径；
- 父级路径；
- 绝对路径；

前提是经过本次 invocation 的审批与运行时校验。Terminal 的 host-process `cwd` 不会像普通文件工具一样被强制改写成 workspace-relative。

所以不能再写成“Terminal 只能在 workspace 内执行”或“当前已具备强隔离 sandbox”。

## 7. Browser 有两套不同能力面

### Managed Computer Use Browser

由服务启动时动态注册：

```text
browser_observe
browser_act
browser_assert
```

- `browser_observe`：创建或复用托管会话，读取页面 snapshot / text / screenshot；不需要审批；
- `browser_act`：基于最新 `pageUrl + snapshotHash` 执行一次结构化动作；需要审批；
- `browser_assert`：验证 title / url / text / visible / value；不需要审批；
- Agent exposure schema 隐藏 `sessionId`，运行时按 thread 管理会话。

### Attached Browser

通过当前用户已连接的 WebBridge / 触界浏览器：

```text
browser_attached_look
browser_attached_browse
browser_attached_act
browser_attached_transfer
```

- `look`：观察当前页、tabs、文本与 refs；不需要审批；
- `browse`：导航、切换、滚动、等待等；当前不需要审批；
- `act`：点击、填充、选择、按键等；需要审批；
- `transfer`：上传显式内存文件或下载；需要审批；
- 需要可信 authenticated user context。

Managed Browser 和 Attached Browser 不能混写成同一个 session contract。

## 8. Mail、GitHub 与问策

### `mail_query`

- 查询当前 authenticated user 的邮件缓存、过滤条件、正文与分页；
- definition 当前 `requiresApproval = false`；
- `sync=none` 只查缓存；
- `sync=if-stale` 按条件同步；
- `sync=force` 会在工具执行内部要求 explicit approval；
- 返回内容会限幅并排除敏感字段。

这说明 **静态 metadata 不是所有动态审批条件的完整表达**。工具内部仍可针对具体 operation 抛出 approval requirement。

### GitHub

当前只暴露四个领域工具：

```text
github_repository
github_issue
github_pull_request
github_actions
```

每个工具用 `operation` 表达领域内动作。definition 通常保持网络工具可调用，远程写操作由 operation 级 `requireRemoteWriteApproval(...)` 要求审批，并执行 read-back 验证。

不得重新拆成几十个 GitHub 原子工具，也不得绕过 installation repository scope。

### `ask_external_expert`

- 只有当前用户已经建立问策连接时才进入 exposure；
- provider、conversation 和连接由内部服务管理；
- 外部专家返回的是 Evidence；
- 外部专家不能执行 Mira 工具；
- 当前 definition 不需要审批。

## 9. External MCP

External MCP 支持：

- `streamable-http`；
- `stdio`；
- discovery；
- session；
- persisted config；
- one recovery attempt for stale sessions；
- secret redaction。

投影工具 canonical id：

```text
mcp:<serverId>:tool:<toolName>
```

进入 Agent exposure 必须同时满足：

- server enabled；
- connected；
- disclaimer accepted；
- transport 配置有效；
- 已发现工具；
- 用户显式开启 Agent Access；
- canonical projected implementation 仍在 registry。

External MCP projected tool：

- `source = external`；
- `domain = external_mcp`；
- `sideEffect = network`；
- `requiresApproval = true`；
- 不允许 provider 私有命令或旧 id 穿透。

## 10. WenShu / Skill-private Runtime 不属于普通 Tool Exposure

Office document / PDF / presentation / spreadsheet runtime 当前可以由 WenShu / Skill execution profile 使用，但：

- 不恢复成 Main Planner 的普通全局工具；
- 不参与 Main Tool Exposure ranking；
- readiness 由 managed binding / runtime pack 真实解析；
- approval 与 workspace 仍必须由 Parent 治理；
- Skill 声明不等于 Runtime ready。

SkillContext 也不会扩大 Main Planner 的 canonical Tool Exposure。

## 11. Tool Exposure 当前规则

先做 public-surface classification 与 explicit availability gate，再做上下文预算。

```text
public eligible tools <= 20
  -> 全部暴露
  -> 不运行 embedding / rerank
  -> caller topK / maxTools / minScore 不得缩小

public eligible tools > 20
  -> embedding recall
  -> rerank
  -> toolId 去重
  -> 暴露前 20
```

当前没有：

- `minScore` 淘汰；
- 核心工具固定名额；
- Browser-only exposure；
- Terminal-needed heuristic；
- task phase semantic censorship。

ranking infrastructure 失败时，按 registry 顺序确定性暴露前 20。

### 用户选择的工具包

`requestedToolGroupIds` 当前只：

- 为 ranking query 增加偏好；
- 投影 available / unavailable 状态；
- 写入 trace。

它不会直接扩大、缩小或替换 Tool Exposure，也不会成为 invocation。

## 12. Concrete Invocation 合同

普通 Main Agent concrete tool 必须经过：

1. Planner 输出已暴露的 `toolId + args`；
2. Normalize 归一化 workspace 参数；
3. schema validation；
4. 冻结 `pendingToolCall`；
5. 计算 SHA-256 `inputHash`；
6. Policy 读取 frozen definition 与 frozen call；
7. Harness 再次 schema validation；
8. Tool 只执行与 Policy 一致的 invocation；
9. invocation 事件、artifact、result 与 trace 被持久化；
10. ToolNode 产生 pending execution / retrieval；
11. Evidence 统一累计。

以下对象都不能直接执行：

- capability match；
- ranking result；
- preferredToolId；
- selectedToolId；
- UI 选中状态；
- tool group；
- Skill match。

`delegate_task` 也不是普通 Harness Tool；它属于 Agent Runtime 的委派协议。

## 13. Approval 当前真相与已知漂移

### Settled exact-invocation 目标

Agent 当前合同要求审批与 frozen invocation / checkpoint 对齐，文档长期口径使用：

```text
toolId + toolCallId + inputHash
```

参数、命令、cwd、env、timeout 或目标资源变化后必须重新审批。

### 当前代码实际匹配

截至 2026-07-30，核心 `ApprovedInvocation` 实际只包含并匹配：

```text
toolId + inputHash
```

当前实现同时具备：

- pending approval request 保存 `toolCallId`；
- frozen `pendingToolCall` 保存 `toolCallId`；
- `inputHash` 覆盖完整归一化 args；
- ToolNode 在执行尝试后一次性消费匹配批准。

但 `toolCallId` 还没有进入 core approval grant match。

判断：这是 **settled contract 与当前实现之间的审批身份漂移**。本轮只记录，不修改 Runtime，也不得把二元匹配悄悄包装成新合同。

### 动态审批

`requiresApproval` metadata 不是唯一来源：

- GitHub 远程写操作；
- `mail_query sync=force`；
- 其他 operation-specific runtime requirement；

可以在具体 invocation 中提出额外审批。

因此不能简单写成“network 一律审批”或“metadata false 就永远不审批”。

## 14. Result、Artifact、Trace 与 Evidence

Harness invocation 统一产生：

- start / progress / artifact / result / error / finish event；
- invocation status；
- input hash；
- structured result；
- bounded `llmContent`；
- truncation metadata；
- trace spans；
- artifacts。

`executeHarnessInvocation(...)` 只在 completed invocation 上生成 LLM projection。

Tool result 不是自动的用户答案：

```text
Harness result
  -> ToolNode pending execution / retrieval
  -> Evidence
  -> Planner acceptance / completion decision
  -> Generate
```

CodeGraph verified retrieval 会走 retrieval Evidence；普通工具、Mail、GitHub、Browser、External MCP 等走 tool execution Evidence。

## 15. 当前明确没有

当前不能这样描述 Tool 系统：

- Planner 公共 Read 面仍是六个 `read_*` primitive；
- grep 只是隐藏在 `read_locate` 里的实现；
- 公共 Edit 只有一个 `edit_file` wrapper；
- 删除、移动仍未实现；
- Harness 会按任务语义隐藏“看起来用不到”的公开工具；
- Tool Group 可以直接改变 invocation；
- 所有 network 调用都静态要求审批；
- Terminal 被严格限制在 workspace 内；
- 当前已经有强隔离 sandbox；
- CodeGraph 仍停留在 docs-only plan；
- External MCP 安装后自动获得 Agent Access；
- `delegate_task` 是 Harness Tool；
- Skill-private Runtime 是第二个 Harness。

## 16. 文档引用顺序

Tool 相关说明按以下优先级判断：

1. 当前代码与可重复测试；
2. 本页；
3. `harness/README.md`；
4. `harness/agentgraph-harness-protocol.md`；
5. `tooling-runtime/tools-protocol.md`；
6. 当前能力细节或 runbook；
7. `project-control` 任务、评审和测试证据；
8. design、plan、ledger 与历史归档。

发现文档和代码不一致时，必须同时写明：

- settled contract；
- 当前实现；
- 影响；
- 是否已经修复与验证。
