---
status: current
owner: chat
last_verified: 2026-10-01
layer: raw-source
module: Chat
feature: UChat
doc_type: current-contract
canonical: true
related:
  - CHAT_CURRENT_TRUTH.md
  - chat/README.md
  - chat/persistence-and-media.md
  - uchat-internal-maintenance.md
  - chat/uchat-application-state-lifecycle-design.md
---

# UChat 当前合同

> UChat 是桌面端聊天状态与交互的主运行时。它不是完整 Chat backend，也不重新定义 Provider、RAG、AgentRun、Harness 或持久化数据库。

## 1. 分层

当前 UChat 分为三层：

```text
shared/uchat/core
→ protocol-agnostic state, types and orchestration

shared/uchat/ui
→ thread, message, composer and trace rendering

desktop chat integration
→ Mira REST, SSE, attachment, Agent and media adapters
```

边界：

- core 不依赖 React 页面、Fastify route 或 Provider code；
- ui 不直接请求 backend；
- integration 负责把 Mira Thread / Message / SSE 投影成 canonical UChat 对象；
- backend 继续持有 Thread、Message、AgentRun、Knowledge Base 与 Tool 真相。

## 2. Canonical Thread

UChat Thread 包含：

- id / title；
- createdAt / updatedAt；
- messages；
- metadata。

桌面 adapter 把 backend Thread 字段放入 metadata：

```text
workspaceId
modelName
knowledgeBaseId
roleId
agentEnabled
ttsEnabled
imageEnabled
contextSummary
contextSummaryUpdatedAt
status
messageCount
lastMessage
```

UChat 不解释这些字段的业务真实性。它只保存并传递。实际语义见 [[CHAT_CURRENT_TRUTH]]。

## 3. Canonical Message

Canonical Message 包含：

- id / threadId；
- role；
- parts；
- parentId；
- status；
- optional toolTrace / metadata / errorMessage。

Parts：

```text
text
image
file
data
```

`data` part 当前用于 execution node 等运行时展示信息。

### 持久化边界

Backend Message 表没有 `parent_id`。桌面 hydration 时按返回数组顺序重建线性 parentId。

因此 UChat 的 parentId 是当前运行时和编辑操作需要的 canonical linkage，不代表 backend 已持久化完整分支树。

## 4. 应用级 Runtime 生命周期

UChat runtime 由已登录应用会话持有：

- 同一 `sessionKey` 内路由切换不重建；
- Chat View 卸载不清空 Thread、Draft 或当前 Run；
- 登出或身份变化时替换 runtime；
- 替换 runtime 时停止旧客户端发送；
- 页面和设置不应订阅完整消息数组，只读取所需 slice。

## 5. Thread 加载

### 列表

`loadThreads` 只加载轻量摘要，用于 Sidebar。

### Hydration

首次选择 Thread 时读取完整历史；之后复用已 hydration 的内存对象。

发送完成后，runtime 会重新读取：

```text
Thread detail
+ Thread list
```

用于把乐观状态收敛到 backend title、metadata 和持久化 Message。

## 6. Welcome 与 Thread 创建

进入“新对话”时：

```text
activeThreadId = null
composer draft exists
draft agentEnabled = true
no database Thread yet
```

第一次发送时才通过 Repository 创建 Thread，并把当前 draft metadata（包括默认的 `agentEnabled=true`）交给 Desktop Repository。Sidebar 的“新对话”会 reset draft，并恢复同一个 Agent 默认值。

这避免在用户只打开 Welcome 页面时制造空历史记录。已有 Thread hydration 后继续使用自己的持久化 metadata；Welcome 默认值不会改写历史 Thread。

## 7. Composer

Composer state 按 Thread 保存：

```text
text
attachments[]
```

切换 Thread 时：

- 当前 Draft 保存在该 Thread key 下；
- 目标 Thread 恢复自己的 Draft；
- Welcome Draft 使用独立 key。

当前同一 Runtime 只允许一个发送任务。其他 Thread 可以编辑 Draft，但发送继续禁用。

## 8. 附件上传

Attachment Driver 负责：

```text
File
→ /attachments
→ canonical image or file part
```

Core 只管理：

```text
idle
uploading
uploaded
error
```

上传成功但发送前移除的远端文件，目前没有由 UChat 调用的删除 API。Core 注释明确把远端清理留作后续 backend capability。

## 9. 发送生命周期

### 9.1 乐观状态

发送开始时，runtime 先追加：

```text
User Message: complete
Assistant Message: streaming
```

然后调用 Run Driver。

### 9.2 SSE 映射

Desktop Run Driver 当前映射：

- `text-delta` → `message:part`；
- RAG sources → `message:metadata`；
- execution node / rag node → data part；
- tool event → `message:tool`；
- error → `run:error`；
- finish → `message:finish`；
- stream close → `run:finish`。

### 9.3 成功

成功后：

1. Assistant status 变为 complete；
2. 执行 afterSendSuccess；
3. 可能启动 TTS / Image 后处理；
4. 重新读取 Thread 和列表。

### 9.4 流错误

若 backend 通过 SSE 返回 error：

- 当前 Assistant 变为 error；
- UChat 尝试重新读取 backend；
- 若 backend 没有持久化错误 Assistant，当前错误气泡可能只存在于本次内存状态。

### 9.5 Transport 异常

若 Fetch / Driver 直接抛错：

- 移除乐观 Assistant；
- 保留 User Message；
- 尝试重新读取 backend；
- 继续向调用者抛出原始错误。

## 10. Stop

`cancelSend` 当前：

```text
AbortController.abort()
→ remove optimistic Assistant
→ runStatus = cancelled
→ reconcile Thread
```

这是客户端 transport cancellation。UChat 不保证 backend Provider、RAG、Agent 或 Tool 已停止。

## 11. Edit 与 Regenerate

### Regenerate

- 目标必须是 Assistant；
- 找到前一个 User；
- 本地历史截断到该 User；
- 使用同一 User id 重新发送。

### Edit User

- 更新原 User Message id 和 parts；
- 本地裁掉后续消息；
- Repository 写回；
- 重新发送。

Backend 随后删除旧 tail，因此当前语义是替换线性时间线，不是保留多个版本。

## 12. Runtime State 合并

发送后 backend truth 与当前 runtime state 合并时，会尽量保留：

- runtime-only data parts；
- toolTrace；
- streamed error；
- 尚未持久化但有内容的 Assistant tail。

这用于避免 refresh 立即抹掉 execution node 或当前错误展示，但不改变 backend persistence 真相。

## 13. Slots 与扩展

### Thread Slots

UChat 提供：

- message content；
- message actions；
- ComposerTools；
- optional composer suggestion；
- optional editor replacement。

### Message Extensions

Desktop integration 使用扩展渲染：

- TTS；
- Image；
- media status / retry / preview。

UChat core 不直接调用 TTS 或 Image API。

### Agent UI

Agent mode control、approval 和 Agent message status 由 UChat 提供稳定 UI 合同，但 AgentRun、Planner 与 checkpoint 仍属于 backend Agent Runtime。

## 14. 当前能力与非目标

UChat 当前已经成立：

- app-level runtime；
- Thread list / hydration；
- per-thread drafts；
- attachments；
- optimistic streaming；
- SSE event mapping；
- edit / regenerate；
- rename / archive / delete；
- execution trace；
- Agent UI control；
- application media extensions。

UChat 当前不承诺：

- backend Message 分支树；
- 多个并发 Run；
- Stop 取消全部 backend work；
- 所有错误永久持久化；
- 自动清理 uploaded-but-unsent attachment；
- Provider / Knowledge Base / Agent 的业务选择；
- 通用长期记忆；
- 跨设备同步。

## 15. 代码锚点

- `desktop/src/shared/uchat/core/runtime.ts`；
- `desktop/src/shared/uchat/core/store.ts`；
- `desktop/src/shared/uchat/core/types.ts`；
- `desktop/src/shared/uchat/ui/`；
- `desktop/src/features/chat/core/protocol.ts`；
- `desktop/src/features/chat/core/runtime.tsx`；
- `desktop/src/features/chat/core/runtimePolicies.ts`；
- `desktop/src/features/chat/components/UChatThread.tsx`；
- `desktop/src/features/chat/adapters/chatMediaOrchestration.ts`。
