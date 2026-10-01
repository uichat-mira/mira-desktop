---
title: Mira Mobile Host Protocol V1 (legacy host contract)
status: reference
doc_type: reference
canonical: false
last_verified: 2026-08-29
canonical_source: uichat-mira-mobile@dev:docs/remote-access/remote-connection-canonical-v1.md
canonical_source_branch: dev
superseded_by: uichat-mira-mobile@dev:docs/remote-access/remote-connection-canonical-v1.md
---

# Mira Mobile Host Protocol V1

> Remote transport and pairing selection are no longer defined here. The
> authoritative contract is the Mobile `dev` document at
> `uichat-mira-mobile@dev:docs/remote-access/remote-connection-canonical-v1.md`.
> **As of 2026-08-29, the former fixed V1 route allowlist is explicitly retired
> as a normative contract.** Runtime capability truth is the combination of the
> paired device scopes, the Host manifest, and the Remote Gateway's explicit
> method/path -> scope mapping. The protocol version remains `1`; the retired
> rule is the idea that one frozen route list permanently defines V1.

## 1. 目标

`uichat-mira-mobile` 通过 Direct（Tailscale）或 Mira Relay 访问 Mira Desktop Host。Transport 只负责可达性与转发；Mira 继续负责配对、设备凭证、用户归属、能力范围、工具审批、撤销和审计。

V1 不复制一套 Thread、Message、Workspace 或 Agent Runtime。完成配对后，设备凭证只被允许访问 Remote Gateway 明确映射到已批准 scope 的 canonical routes 或 Mobile-safe projection，由 Remote Gateway 在进入业务路由前完成设备认证与 scope 校验。

```text
Mobile
  ├─ Direct / Tailscale / HTTPS
  ├─ Relay / WSS
  ├─ Device Credential
  ▼
Remote Gateway
  ├─ verify credential
  ├─ resolve owner user
  ├─ check method + path + scope
  ▼
Canonical Mira Routes / safe projections
  ├─ Workspace / Thread / Message
  ├─ Persisted Chat Stream
  ├─ Agent Run
  ├─ Mobile-safe Tool Gateway projection
  └─ Artifact Read
```

## 2. 协议版本

当前协议版本：`1`。

配对成功后，mobile 可读取：

```http
GET /remote/v1/manifest
Authorization: Bearer <device credential>
```

返回协议版本、设备 ID、授权 scope、当前 Host 声明的可调用 route 和服务端时间。Mobile 不得根据桌面 UI、历史文档或旧版本固定 route 表猜测能力。

## 3. 配对流程

### 3.1 Desktop 创建挑战

```http
POST /remote/admin/pairing/challenges
Authorization: Bearer <desktop user jwt>
```

Host 在 Tailscale Direct 为 `ready` 或 Mira Relay 为 `connected` 时创建挑战；两者都可用时，二维码同时携带两个 endpoint。响应包含：

- `challengeId`
- 8 位一次性配对码
- `pairingUri`
- `expiresAt`

配对码不以明文持久化；挑战默认 5 分钟过期。

### 3.2 Mobile 领取挑战

```http
POST /remote/pairing/claim
Content-Type: application/json

{
  "challengeId": "...",
  "code": "ABCDEFGH",
  "deviceName": "K70",
  "platform": "android",
  "transport": "relay",
  "publicKey": "optional-device-public-key",
  "requestedScopes": ["threads:read", "messages:read", "messages:write"]
}
```

响应返回 `claimId` 与一次性 `pollToken`。Host 只保存 poll token 的哈希。

`transport` 可选值为 `relay` 或 `direct`，只记录 Mobile 实际选择的申请通道，供 Desktop 配对确认界面展示。它不参与认证、poll token、设备凭据、scope、审批或 endpoint 判定；旧 Mobile 不发送该字段时按“未知”展示。

### 3.3 Desktop 确认

Desktop 轮询当前 challenge；收到 claim 后显示设备名称、平台、公钥摘要和请求 scope。用户明确批准或拒绝：

```http
POST /remote/admin/pairing/claims/:claimId/approve
POST /remote/admin/pairing/claims/:claimId/reject
Authorization: Bearer <desktop user jwt>
```

批准时 Desktop 可缩减 scope，不能扩大到未定义 scope。

### 3.4 Mobile 领取凭证

```http
POST /remote/pairing/claims/:claimId/poll
Content-Type: application/json

{ "pollToken": "<one-time poll token>" }
```

批准后，Host 只返回一次完整 device credential；返回后立即清除服务器中的可解密副本，只保留 SHA-256 哈希。mobile 必须把凭证保存到系统安全存储。

## 4. 设备凭证

凭证为 opaque bearer token：

```text
mira_device_<deviceId>.<random-secret>
```

Host 持久化：

- device ID
- owner user ID
- token hash
- device name / platform / optional public key
- scopes
- createdAt / lastSeenAt / revokedAt

Host 不持久化长期可解密凭证明文。撤销后下一次 HTTP 请求立即失败；后续 WebSocket Runtime 接入时，撤销事件还必须主动关闭存量连接。

## 5. Scope

当前 V1 定义以下 scope：

| Scope | 能力 |
| --- | --- |
| `threads:read` | 列出和读取当前用户 Thread；读取用于组织 Thread 的 Mobile-safe Workspace 元数据 |
| `messages:read` | 读取 Thread Message |
| `messages:write` | 当前 0.2.x 兼容的会话写能力：创建当前用户 Thread、删除单个当前用户 Thread、通过 persisted default chat stream 发送消息 |
| `agent:read` | 读取 Agent Run |
| `agent:approve` | 批准或拒绝 pending approval |
| `agent:control` | 取消 Agent Run |
| `tools:read` | 读取 Mobile-safe Agent tool projection |
| `tools:invoke` | 通过 Remote Gateway 调用一个已暴露工具 |
| `tools:approve` | 在 Mobile 批准或拒绝一个 awaiting-approval tool invocation |
| `tools:control` | 取消当前 owner user 的 tool invocation |
| `artifacts:read` | 读取已归属 Thread 的媒体 / Artifact |

默认批准 scope：

```text
threads:read
messages:read
messages:write
agent:read
agent:approve
agent:control
tools:read
tools:invoke
tools:approve
tools:control
artifacts:read
```

Workspace V1 不新增独立 scope。`GET /remote/v1/workspaces` 是 `threads:read` 下用于解析 `thread.workspaceId` 的只读元数据投影，不提供 Workspace 创建、编辑、删除能力。

`POST /threads` 与 `DELETE /threads/:id` 继续复用已有 `messages:write`，这是对已经完成 0.2.x 配对设备的显式兼容决定：新增 Thread 创建能力不要求用户仅为了新 route 重新配对。该兼容映射只覆盖创建当前 owner user 的 Thread、删除当前 owner user 的单个 Thread和现有聊天发送；它不放开 `PATCH /threads/:id`、archive / restore、`DELETE /threads/history` 或 Workspace 写能力。

后续若引入语义更准确的 `threads:write`，必须提供显式 scope 迁移方案，不能静默扩大旧设备权限。

## 6. Runtime capability contract（固定 V1 allowlist 已失效）

旧文档曾把一张固定 route 表称为 “Canonical route allowlist”。该规则自 2026-08-29 起失效：**静态文档中的 route 枚举不再是永久权限边界。**

当前能力判断必须同时满足：

1. Remote Gateway 对当前 `method + path` 有显式 scope 映射；
2. paired device 实际持有该 scope；
3. Host `/remote/v1/manifest` 声明当前 route，供 Mobile 做 capability discovery；
4. canonical route 本身继续执行 owner-user / business validation。

当前 Host snapshot 包含：

```text
GET    /remote/v1/manifest
GET    /remote/v1/workspaces
GET    /threads
GET    /threads/:id
POST   /threads
DELETE /threads/:id
GET    /threads/:id/messages
POST   /proxy/chat/default
GET    /agent/runs/:runId
POST   /agent/runs/:runId/approve
POST   /agent/runs/:runId/reject
POST   /agent/runs/:runId/cancel
GET    /remote/v1/tools
POST   /remote/v1/tool-invocations/stream
POST   /remote/v1/tool-invocations/:invocationId/approval
POST   /remote/v1/tool-invocations/:invocationId/cancel
GET    /threads/:id/media/:mediaId/content
```

这张列表只是**当前实现快照**，不是冻结 V1 的规范边界。增加或删除能力时必须同时更新 Gateway 映射、manifest、Mobile capability guard、测试和 canonical 文档。

`GET /remote/v1/workspaces` 返回当前用户的 active / archived ChatWorkspace，但只投影：

```text
id
name
isDefault
status
createdAt
updatedAt
```

Host 本机 `rootPath` 永远不进入该 Remote response。Mobile 通过 `id` 与 Thread 的 `workspaceId` 关联，不维护另一套 Project / Workspace 真相源。

未被 Remote Gateway 显式映射的 route 继续返回 `403`，即使 owner user 是管理员也不例外。

`POST /threads` 复用 canonical Thread route 与 `threadService.createThread()`；Remote Gateway 不复制创建逻辑，owner user 来自 device credential 映射，Mobile body 不能指定 user。

`POST /proxy/chat/default` 继续使用现有 persisted stream contract，因此 mobile 与 desktop 共享同一个 User Message 持久化、RAG / Agent 分支、Assistant Message、审批和 SSE 事件真相。

## 7. 重连语义

V1 不伪造尚未存在的 durable event journal。重连采用 canonical state replay：

1. 重新读取 `/remote/v1/manifest`，确认凭证和 scope 仍有效。
2. 重新读取 Workspace、Thread 与 Message。
3. 若最后一条 Assistant metadata 含 `agent.runId`，读取对应 Agent Run。
4. 只有 Agent Run 仍处于 `waiting_approval` 且 approval ID 未变化时，才允许显示原审批操作。
5. mobile 为每次发送生成稳定 `messageId`，重连后不得以新 ID 重发同一 User Message。

`eventCursor` 与主动撤销存量 WebSocket 属于 V2；在 durable journal 落地前，文档和 UI 不得宣称支持无损事件续传。

## 8. 安全边界

- 配对 public endpoints 只接受一次性 challenge / poll token，不接受通用业务调用。
- 配对码、poll token 与 device credential 均使用 timing-safe 哈希比较。
- Desktop 必须显示真实请求设备与 scope，不能自动批准。
- 同处 Tailnet 不等于通过 Mira 应用授权。
- Device credential 不能直接调用账号设置、Provider、Knowledge Base 写操作、任意本地进程接口或任何未被 Remote Gateway 显式映射到已批准 scope 的 route。Terminal 等 Harness 工具只有在进入 Mobile-safe Tool Gateway exposure、设备持有对应 `tools:*` scope、并满足 exact invocation Policy/approval 时才能通过 Gateway 间接执行；Mobile 不获得 Terminal route 或 Host shell credential。
- Thread 创建 / 删除仍经过 owner user 约束；paired device 不能在 body 中切换用户，也不能操作其他用户 Thread。
- Workspace Remote projection 不返回 `rootPath`，不允许 Workspace 写操作。
- Agent 审批仍使用现有 exact invocation 与 checkpoint；Remote Gateway 不改变 Harness 合同。

## 9. V1 验收

- 未启用或不可访问的 Tailscale Serve 不能创建配对挑战。
- 错误或过期配对码不能 claim。
- 一个 challenge 只允许一个 claim。
- 未经 Desktop 批准，mobile 永远拿不到 device credential。
- device credential 只返回一次，数据库只保存哈希。
- 撤销设备后，manifest 和 canonical route 均返回未授权。
- scope 不足返回 `403`，而不是把请求转交业务路由。
- `threads:read` 设备可读取 Mobile-safe Workspace 列表并通过 `workspaceId` 与 Thread 稳定关联。
- `messages:write` 设备在 manifest 声明 `POST /threads` 时可创建当前 owner user 的 canonical Thread，无需重新配对；没有该 scope 时创建返回 `403`。
- `messages:write` 设备可删除当前 owner user 的单个 Thread；没有该 scope 时 `DELETE /threads/:id` 返回 `403`。
- `PATCH /threads/:id`、archive / restore、bulk history cleanup 与 Workspace 写能力仍拒绝。
- Workspace 列表包含 active / archived 状态且不返回 `rootPath`。
- mobile 使用 device credential 调用 persisted default chat stream 时，仍按 owner user 的 Thread 权限和 Agent 审批合同执行。
- `tools:read` 只返回当前 Agent exposure 的 Mobile-safe tool projection，不返回 MCP secret、stdio command 或私有 endpoint。
- `tools:invoke` 只能执行当前 exposure 中的 canonical tool；需要审批时返回 awaiting-approval，而不是静默执行。
- `tools:approve` 必须校验 invocation owner、toolId 和原始 args inputHash；参数变化后旧批准无效。
- `tools:control` 只能取消当前 owner user 的 invocation。
- 旧 paired device 不静默获得新增 `tools:*` scope；缺少工具 scope 不影响其已有 Thread/Message 能力。
