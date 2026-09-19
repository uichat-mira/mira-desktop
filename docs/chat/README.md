---
status: current
owner: chat
last_verified: 2026-08-01
layer: wiki
module: Chat
feature: Overview
doc_type: overview
canonical: true
related:
  - ../CHAT_CURRENT_TRUTH.md
  - workspace.md
  - behavior-equivalence-baseline.md
  - ../uchat.md
  - persistence-and-media.md
  - ../AGENT_CURRENT_TRUTH.md
  - ../KNOWLEDGE_BASE_CURRENT_TRUTH.md
  - ../PROVIDER_CURRENT_TRUTH.md
  - ../TOOL_CURRENT_TRUTH.md
  - ../archive/chat/README.md
---

# Chat 模块总览

> Chat 的第一真相入口是 [[CHAT_CURRENT_TRUTH]]。本页只负责阅读导航，不用 Agent 文档代写普通 Chat、RAG、Thread 或 Message 合同。

## 先读这里

1. [[CHAT_CURRENT_TRUTH]]：Thread、Message、三条发送链、持久化与已知缺陷；
2. [[chat/workspace]]：ChatWorkspace、`Mira BASE`、默认物理目录、Harness root 与受管 staging 合同；
3. [[chat/behavior-equivalence-baseline]]：E02 / #146 的 Normal、RAG、Agent 行为等价矩阵与回归证据；
4. [[uchat]]：桌面 UChat core / ui / integration 合同；
5. [[chat/persistence-and-media]]：消息落库、编辑重跑、附件、TTS、图片与删除行为；
6. [[AGENT_CURRENT_TRUTH]]：AgentRun、审批、恢复与终止语义；
7. [[KNOWLEDGE_BASE_CURRENT_TRUTH]]：Knowledge Base 与 RAG；
8. [[PROVIDER_CURRENT_TRUTH]]：模型角色与调用解析；
9. [[TOOL_CURRENT_TRUTH]]：Harness Tool 公共面与审批。

## 当前对象链

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

必须分开：

- `ChatWorkspace`：数据库中的工作空间记录，保存 rootPath；
- `Mira BASE`：默认 ChatWorkspace 的逻辑名称；
- Harness workspace root：Agent / Tool 的默认物理执行根；
- Task staging workspace：建站、构建等任务的受管子目录；
- `Thread`：聊天配置与归属真相；
- `Message`：用户可见历史与 canonical parts；
- `Request Context`：Role、Summary 等请求时临时 system context；
- `AgentRun`：Agent 的运行、审批、Evidence 与 checkpoint 真相；
- `ChatMedia`：成功 Assistant 后附加的音频或图片结果。

默认空间的目录创建、自定义路径缺失语义和 MiraDocs staging 以 [[chat/workspace]] 为准。

## 三条真实发送链

### Normal Chat

```text
User Message
→ request-only Role / Summary context
→ global llm role
→ Assistant Message
```

普通 Chat 当前不经过 Main Planner，也不调用 Harness Tool。

### RAG Chat

```text
Bound Knowledge Base
+ non-Agent text question
→ RAG Pipeline
→ Answer + Sources
```

RAG 是独立路径，不等于“普通 Chat 额外拼一段知识文本”。

### Agent Chat

```text
agentEnabled = true
→ AgentRun
→ Main Agent Runtime
→ Evidence / Approval / Finalization
→ Assistant delivery
```

Agent 详细行为必须回到 [[AGENT_CURRENT_TRUTH]]，不能由 Chat UI 文档重新定义。

## Thread 当前保存什么

Thread 当前持久化：

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
status
```

其中：

- `workspaceId` 选择数据库 ChatWorkspace；实际路径来自对应 `rootPath`；
- `knowledgeBaseId` 决定非 Agent RAG 路由，或作为 Agent 检索输入；
- `roleId` 注入 Role prompt；
- `agentEnabled` 选择 Agent 路径；
- `ttsEnabled / imageEnabled` 控制成功回答后的媒体任务；
- `contextSummary` 作为不可见 request-only context；
- `modelName` 当前不驱动默认 Chat Provider Resolution。

## Message 当前保存什么

Message 当前保存：

- role；
- content；
- canonical `partsJson`；
- metadata；
- createdAt。

Canonical parts：

```text
text
image
file
data
```

数据库没有 `parent_id`。编辑与重新生成会裁掉旧尾部并重写当前时间线，不保存可切换分支树。

## UChat 当前责任

UChat 负责：

- Thread 列表和按需 hydration；
- 每个 Thread 的 Composer Draft；
- 附件上传状态；
- 乐观 User / Assistant 消息；
- SSE 文本、Tool Event、Execution Node 和 metadata 映射；
- 单一进行中发送；
- 前端停止、失败展示与发送后对账；
- 消息正文、Trace、审批与媒体扩展渲染。

UChat 不负责：

- 选择 Provider Connection；
- 决定 RAG、Agent 的后端合同；
- 创建默认物理 Workspace 目录；
- 执行 Tool；
- 持有 AgentRun；
- 保存 Knowledge Base；
- 保证客户端 Stop 取消后台工作；
- 把 memory resolver 空插槽变成长期记忆。

## 当前最重要的缺陷

### High：删除 Knowledge Base 会删除绑定对话

当前外键是：

```text
threads.knowledge_base_id
ON DELETE CASCADE
```

删除非默认 Knowledge Base 会连带删除绑定 Thread，再级联删除 Messages。

这是高严重度数据删除缺陷，不是目标合同。完整原因与影响见 [[CHAT_CURRENT_TRUTH]]。

其他已知漂移：

- 生产 launcher 传入默认 Workspace 路径前未明确创建物理目录；
- MiraDocs GitHub 模式此前没有独立 task staging 合同；
- Normal Chat Tool Loop 当前不可达；
- `Thread.modelName` 不驱动默认 Chat；
- Stop 不保证后台工作停止；
- 普通 Chat / RAG 错误 Assistant 不完整持久化；
- 附件 storage 缺少完整 GC；
- Memory resolver 还没有 Thread persistence source。

默认空间相关缺陷与整改边界见 [[chat/workspace]]。

## 历史与施工资料

旧总纲已经保存到 [[archive/chat/README]]。

施工 checklist、设计稿、UChat governance 与 Agent UI 记录可以解释演进，但不能覆盖：

```text
current code
→ CHAT_CURRENT_TRUTH
→ Chat Workspace current contract
→ UChat current contract
→ persistence and media reference
```
