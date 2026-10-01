---
status: current
owner: chat / runtime
last_verified: 2026-10-01
layer: wiki
module: Chat
feature: ChatRuntimeTruth
doc_type: current-snapshot
canonical: true
related:
  - chat/README.md
  - uchat.md
  - chat/persistence-and-media.md
  - AGENT_CURRENT_TRUTH.md
  - KNOWLEDGE_BASE_CURRENT_TRUTH.md
  - PROVIDER_CURRENT_TRUTH.md
  - TOOL_CURRENT_TRUTH.md
  - archive/chat/README.md
---

# UIChat Mira Chat 当前真相

> 本页只记录 `dev` 当前可由代码和现有回归核对的 Thread、Message、UChat、普通对话、RAG、Agent、附件与媒体事实。它不把隐藏设计、不可达代码或未来长期记忆插槽写成已经交付的能力。

## 1. 结论先说

Mira 当前 Chat 由桌面 UChat、Thread / Message 持久化、请求上下文装配和三条后端执行路径共同组成：

```text
ChatWorkspace
→ Thread
→ Message Parts / Metadata
→ Request-only Thread Context
→ Normal Chat | RAG Chat | Agent Chat
→ SSE Events
→ UChat Runtime
→ Persisted Assistant Message
→ Optional TTS / Image Media
```

三条真实发送链：

```text
Normal Chat
→ global llm role

RAG Chat
→ bound Knowledge Base
→ RAG Pipeline

Agent Chat
→ AgentRun
→ Main Agent Runtime
```

这些状态不能互相替代：

```text
Thread 已创建
!= 已发送过消息

Role 已绑定
!= 绑定了独立模型

Thread.modelName 已保存
!= 本轮真的使用该模型

Knowledge Base 已绑定
!= 本轮一定进入 RAG

Stop 前端流
!= backend Provider / Agent 已停止

当前 UI 显示错误
!= 错误 Assistant 已持久化

编辑 / 重新生成
!= 保存了多个可切换分支
```

## 2. 核心对象

### 2.1 `ChatWorkspace`

Chat Workspace 保存数据库 id、userId、名称、rootPath、状态和时间戳。

`workspaceId` 是数据库 id，不是文件系统路径。实际路径在 `chat_workspaces.root_path`。

Agent Thread 可以显式绑定 ChatWorkspace，也可以保持 `workspaceId = null`。

- 有显式 `workspaceId`：Agent / Tool 使用对应 ChatWorkspace 的 `rootPath`；
- 没有显式 `workspaceId`：Agent 使用当前对话自己的私有执行 namespace，不自动绑定共享 `Mira BASE`；
- 私有 namespace 是 Runtime 内部执行空间，不进入 ChatWorkspace 列表、Picker 或侧栏分组。

未绑定 Agent 使用 deterministic private workspace root；`conversation-workdirs` 仅保留为兼容既有本地文件的磁盘目录名，不再存在独立 `Conversation Workdir` 数据库/runtime identity。AgentRun 只冻结 `workspaceRoot`，Artifact 只冻结创建时的 `sourceRootPath + sourceRelativePath`。

普通 Chat Thread 仍可以不绑定 Workspace。

### 2.2 `Thread`

Thread 是聊天配置与归属真相，保存：

```text
title
modelName
workspaceId
knowledgeBaseId
roleId
agentEnabled
ttsEnabled
imageEnabled
contextSummary
contextSummaryUpdatedAt
status
createdAt
updatedAt
```

字段真实作用：

| 字段 | 当前作用 |
| --- | --- |
| `workspaceId` | 用户显式选择的 ChatWorkspace；Agent 为 null 时改用对话私有执行 namespace |
| `knowledgeBaseId` | 非 Agent 时选择 RAG；Agent 时作为检索输入 |
| `roleId` | 注入 Role prompt；在 Normal / Agent persisted path 合并数值生成参数 |
| `agentEnabled` | 持久化 Thread 的执行路径选择；Desktop 新对话 draft 默认 `true`，历史 Thread 已持久化的 `false` 继续保留 legacy Normal/RAG compatibility |
| `ttsEnabled` | Assistant 成功后异步生成语音 |
| `imageEnabled` | 满足条件时 Assistant 成功后异步生成图片 |
| `contextSummary` | 作为 request-only system context 注入 |
| `modelName` | 当前持久化和显示；不驱动默认 Provider Resolution |

Role 的 prompt 会进入 request-only context，包括 RAG；但 Role LLM profile 的 temperature、topP、topK、maxTokens 等参数当前只传给 persisted Normal / Agent path，独立 RAG route 没有接收这组覆盖参数。

因此当前没有可靠的 per-thread model selection，也没有完全统一的 per-thread generation-parameter contract。

### 2.3 `Message`

Message 表保存：

```text
id
threadId
role
content
partsJson
metadata
createdAt
```

Canonical parts：

```text
text
image
file
data
```

`partsJson` 是富消息真相；`content` 同时承担兼容、标题种子和文本摘要用途。旧消息没有 parts 时，读取层会从 content 构造 text part。

Message 表没有 parentId、status、updatedAt、error 或 version column。

### 2.4 `AgentRun`

AgentRun 与 Message 分开：

- Thread / Message 保存用户可见对话；
- AgentRun 保存 goal、状态、approval、checkpoint、Evidence、trace 和 terminal information；
- Assistant Message 只投影 waiting 状态或最终交付。

Agent 合同见 [[AGENT_CURRENT_TRUTH]]。

## 3. UChat 分层与生命周期

当前 UChat 分为：

```text
shared/uchat/core
→ state, types and orchestration

shared/uchat/ui
→ thread, message, composer and trace rendering

desktop chat integration
→ REST, SSE, attachment, Agent and media adapters
```

Core 不认识 Mira route、Provider、Knowledge Base、Role、TTS、Image 或 Agent backend。

运行时由已登录应用会话持有：

- 普通路由切换不重建；
- Chat View 卸载不丢 Thread、Draft 或当前运行；
- Draft 按 Thread 保存；
- 同一 runtime 同时只允许一个发送；
- 切换 Thread 不改变后台运行归属；
- 登出或 sessionKey 变化时替换 runtime，并 abort 旧客户端发送。

### Welcome 状态

进入新对话时可以保持：

```text
activeThreadId = null
```

Desktop Welcome draft 的 `agentEnabled` 默认是 `true`；第一条真实发送才创建数据库 Thread，并把该 draft 选择写入新 Thread。重新进入“新对话”会恢复这个默认值。打开欢迎页本身仍不制造空历史。

已有 Thread 不跟随 Welcome 默认值重写；其执行路径继续由持久化的 `agentEnabled` 决定，因此历史 `agentEnabled=false` Thread 仍保留 Normal/RAG compatibility。

## 4. 三条发送路径

### 4.1 Normal Chat

条件：Agent 未启用，且未满足 RAG 路由。

```text
Persist latest User Message
→ prepend Role / Summary request context
→ resolve global llm role
→ generate text
→ stream SSE
→ persist non-empty Assistant on stop
→ title generation
→ optional media
```

普通 Chat 当前不经过 Main Planner，也不调用 Harness Tool。

代码存在 `executeDefaultChatToolLoop`，但当前调用固定传入 `agentEnabled: false`，函数立即返回；Agent=true 时调用方已经转入 Agent branch。这段 Normal Chat Tool Loop 当前不可达。

### 4.2 RAG Chat

进入条件：

- Thread 有 `knowledgeBaseId`；
- Agent 未启用；
- 已认证 Thread；
- 当前消息能提取最新 User 文本问题。

```text
Persist latest User Message
→ validate bound Knowledge Base
→ empty-KB fixed refusal or RAG Pipeline
→ stream answer / nodes / sources
→ persist Assistant + rag metadata
→ title generation
```

Assistant metadata 保存 question、topK、topN、sources 和 optional routeReason。

只上传文件或图片且没有文本问题时，RAG input 可能不成立，请求会退回 Normal Chat。

### 4.3 Agent Chat

条件：

```text
agentEnabled = true
```

```text
Persist latest User Message
→ collect request-only Thread context
→ create AgentRun
→ Main Agent Runtime
→ approval / resume / Evidence / finalization
→ project result into Assistant Message
```

Agent Thread 自动确保 Workspace。Knowledge Base 不走独立 RAG route，而作为 Agent 可用检索输入。

## 5. Request-only Thread Context

Thread context 不写成可见 system Message，而是在请求时临时生成 system messages。

当前顺序：

```text
Role
→ Context Summary
→ Memory Slot
→ Agent Execution Context
```

### Role

Role resolver 把 description、worldview、persona、scenario、example dialogues、style 和 constraints 拼成 system prompt。

Normal / Agent persisted path 另外读取 Role LLM profile 的数值参数。RAG route 当前只收到 Role prompt，没有收到该 profile 参数覆盖。

Role 不绑定独立 Provider，也不覆盖全局 `llm` Connection / model id。

### Context Summary

Summary：

- 用户手工生成、编辑、保存或清空；
- 持久化在 Thread；
- 每轮作为 request-only system context；
- 不显示为聊天历史；
- 当前没有 token threshold 自动生成或滚动更新合同。

### Memory Slot

代码有 `memoryContext` resolver，但 Thread schema、ThreadResponse 和桌面更新合同没有持久化来源。

它是未来接入点，不是已交付长期记忆。

### Agent Execution Context

Agent context 还包含 platform、shell、workspace root、cwd 和可用 Tool ids。这些属于执行环境，不是可见历史。

## 6. 消息持久化

### 6.1 发送开始

UChat 先在内存追加 optimistic User 和 streaming Assistant。

Backend 收到 persistent Chat 请求后先写最新 User Message，再执行模型、RAG 或 Agent。

### 6.2 Assistant 成功

只有：

```text
finishReason = stop
+ answer.trim() is not empty
```

才写 Assistant Message。

成功后 desktop 重新读取 Thread，使乐观状态收敛到 backend truth。

### 6.3 失败

Normal / RAG stream error 时：

- User 通常已持久化；
- Assistant error 多数只在当前 UChat 内存；
- backend 不写空 Assistant error Message；
- 刷新后错误气泡可能消失，只剩 User。

Agent failure 的细节可能在 AgentRun 中，但不等于进入可见 Message。

### 6.4 Stop

Stop 当前：

- abort desktop Fetch；
- 移除本地 streaming Assistant；
- runtime status = cancelled；
- 重新读取 persisted Thread。

客户端 AbortSignal 没有形成 backend Provider / RAG / Agent / Tool 的统一 cancellation token。Stop 不证明底层工作停止。

User 已先持久化，因此取消后通常仍保留 User Message。

## 7. Edit、Regenerate 与线性时间线

UChat 支持 regenerate Assistant 和 edit User then resend。

Backend 根据 parent / lineage 找到锚点，删除锚点之后的旧 Message、附件和媒体，再更新或复用 User，生成新 Assistant tail。

重新加载时 desktop 按数据库数组顺序重建线性 parentId。

当前真实语义：

```text
rewrite current timeline
```

不是持久化多个分支并切换版本。内部曾有分支 / 版本思路，但当前 DB 与 UI 合同没有开放。

## 8. 附件

### 上传

当前 Chat Attachment：

- 单文件；
- 最大 8 MB；
- 支持常见图片；
- 支持文本、Markdown、CSV、JSON、YAML、代码、日志、PDF、DOCX、PPTX、XLSX 等白名单；
- 保存到本地 attachment storage；
- 非图片在上传阶段先执行结构化解析验证。

### 请求注入

生成前，本地 Reader 只重新解析最新 User Message 的 File parts：

```text
[文件: name]
[类型: mime]
parsed text
[文件结束: name]
```

历史文件不会每轮自动重新提取全文。

Image part 保持图片输入协议；具体模型能否理解图片由 concrete Provider / model 决定。

### 清理缺口

- 上传完成但未发送或从 Composer 移除：没有 attachment delete API，文件残留；
- Message / Thread 删除 helper 只处理 File part，不处理普通 Image attachment；
- 没有统一 asset reference table、引用计数或周期 GC。

## 9. TTS 与图片后处理

`ttsEnabled` / `imageEnabled` 是 Assistant 成功后的 desktop media lifecycle，不是模型原生输入能力。

### TTS

```text
Assistant persisted
→ resolve TTS capability
→ synthesize audio
→ attach ChatMedia
```

### Image

自动图片条件：

```text
imageEnabled = true
+ roleId exists
+ no knowledgeBaseId
```

Assistant text 作为 prompt，调用 Image Generation Runtime，再绑定 Artifact。

媒体任务异步执行。文本回答成功不等于媒体成功；失败状态写入 Message metadata。

## 10. 删除行为

### Thread

删除 Thread 会清理生成 ChatMedia、清理 File attachments、删除 Thread，并级联 Messages。普通 Image attachment 可能残留。

### Chat Workspace

默认 `Mira BASE` 不可删除。

删除其他 Workspace 时，service 先硬删除所有绑定它的 active Threads；archived Threads 依赖外键 SET NULL 解绑。这是破坏性行为，不是单纯移除入口。

## 11. 已知实现缺陷与漂移

### 11.1 High：删除 Knowledge Base 会级联删除绑定 Thread

当前：

```text
threads.knowledge_base_id
REFERENCES knowledge_bases(id)
ON DELETE CASCADE
```

Knowledge Base service 删除非默认 KB 时直接删除 row，SQLite foreign keys 已开启。

结果：

```text
Delete Knowledge Base
→ delete bound Threads
→ cascade delete Messages
```

这是高严重度数据删除缺陷，不是目标合同。目标应为 `SET NULL`，或在 service 中显式解绑并保留历史 Thread。

### 11.2 Normal Chat Tool Loop 不可达

存在实现文件，但当前路由条件使其不会执行。不能宣传普通 Chat 已支持 Harness Tool Calling。

### 11.3 `Thread.modelName` 不驱动默认 Chat

默认 route 仍通过全局 `llm` role 做 Provider Resolution。

### 11.4 Branch lineage 不持久化为树

Message 表没有 parentId。Edit / Regenerate 删除旧 tail，旧版本不可恢复。

### 11.5 Stop 不保证 backend 停止

Desktop abort 只停止当前 HTTP stream consumption；没有统一 backend cancellation contract。

### 11.6 Error Assistant 不完整持久化

Normal / RAG error 通常只存在当前 UChat state，刷新后可能只剩 User。

### 11.7 Attachment storage 缺少完整 GC

Uploaded-but-unsent 和普通 Image attachment 可能成为孤儿文件。

### 11.8 Memory resolver 是空插槽

没有当前 Thread persistence source，不能据此声称长期记忆已接入 Chat。

### 11.9 Role 参数未统一进入 RAG

Role prompt 进入 RAG request context，但 Role LLM profile 的数值参数只传入 persisted Normal / Agent path。当前三条路径的 Role 参数语义并不完全一致。

## 12. 当前非目标

Mira 当前没有承诺：

- 一个统一 route 完成 Normal、RAG 和 Agent 的全部行为；
- 普通 Chat 自主调用 Harness Tool；
- Thread modelName 是独立模型绑定；
- Role 数值参数在三条路径完全一致；
- Edit / Regenerate 保留多分支历史；
- Stop 取消所有 backend work；
- 所有失败永久显示在时间线；
- 所有附件有引用计数和自动 GC；
- Summary 自动持续更新；
- Chat 已接入通用长期记忆；
- 任意模型都理解图片或文件；
- 删除 Knowledge Base 会保留对话——当前实现存在相反缺陷；
- Chat Workspace 是强隔离 Sandbox；
- TTS / Image 开关代表 Provider 原生多模态能力。

## 13. 代码与验证锚点

主要实现：

- `desktop/src/shared/uchat/core/runtime.ts`；
- `desktop/src/features/chat/core/protocol.ts`；
- `desktop/src/features/chat/adapters/chatMediaOrchestration.ts`；
- `desktop/src/features/chat/components/UChatThread.tsx`；
- `server/src/routes/proxy-provider/chat.routes.ts`；
- `server/src/routes/proxy-provider/rag-thread.ts`；
- `server/src/routes/proxy-provider/message-persistence.ts`；
- `server/src/routes/proxy-provider/chat-tool-loop.ts`；
- `server/src/services/thread.service.ts`；
- `server/src/services/chat-file-context.service.ts`；
- `server/src/services/shared-nodes/thread-request-context.node.ts`；
- `server/src/db/thread.db.ts`；
- `server/src/routes/attachments.ts`。

主要回归：

- `desktop/src/shared/uchat/core/runtime.test.ts`；
- `desktop/src/features/chat/core/protocol.test.ts`；
- `desktop/src/features/chat/adapters/chatMediaOrchestration.test.ts`；
- `desktop/src/shared/api/__tests__/thread.test.ts`；
- `server/src/services/thread.service.test.ts`；
- `server/src/routes/thread/threads.routes.test.ts`；
- `server/src/routes/proxy-provider/chat.routes.test.ts`；
- `server/src/services/provider-proxy.service/index.test.ts`。
