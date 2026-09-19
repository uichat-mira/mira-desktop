---
title: Mira Remote Relay Transport V1 (PC implementation note)
status: current
doc_type: implementation-note
canonical: false
last_verified: 2026-08-26
canonical_source: uichat-mira-mobile@dev:docs/remote-access/remote-connection-canonical-v1.md
canonical_source_branch: dev
---

## Current Connection Reliability Truth (2026-09-05)

- A Relay WebSocket that stays idle for roughly 3-4 hours can be closed by an
  intermediary (Cloudflare edge, carrier NAT, router, or mobile network).
- The current Desktop host connector has reconnect logic but no application
  keepalive. This is a known reliability defect, not pairing behavior.
- The first remediation is a native WebSocket ping from Desktop every 30
  seconds while the host socket is open. It must be stopped on close, stop, and
  restart.
- Mobile must validate and recover its Relay connection when the app returns
  from background. JavaScript timers are not a guaranteed background keepalive.
- No business heartbeat frame is added to Relay V1 in this remediation; the
  native WebSocket control ping keeps the transport contract unchanged.
- Cloudflare end-to-end idle and background smoke remains required evidence;
  `/health` only proves the Worker HTTP route is reachable.

# Mira Remote Relay Transport V1

> **Normative source:** the Mobile `dev` branch document at
> `uichat-mira-mobile@dev:docs/remote-access/remote-connection-canonical-v1.md`.
> This PC note was synchronized on **2026-08-26**. When the two documents differ,
> the Mobile document is authoritative for transport selection and pairing
> semantics; this page only records PC implementation context and evidence.

## 1. 文档定位

本文定义 Mira Desktop 与 Mira Mobile 在现有 Tailscale 远程能力之外新增公网 Relay Transport 的 V1 设计。

目标不是替换 Tailscale，也不是建立 Mira Cloud Backend，而是在现有 Remote Host V1 之下增加一条低配置、可自动回退的公网转发链路。

当前结论：

- 保留 Tailscale 作为直连 / 私网传输方案。
- 新增 Relay Transport，首选 Cloudflare Workers + Durable Objects 做免费版 POC。
- Relay 只负责寻址、连接保持与字节/消息转发，不承载 Mira 业务逻辑。
- Desktop 始终是 Host；模型、数据库、Agent、知识库、文件与权限判定继续留在 Desktop。
- 现有 Remote Host V1、设备凭证、scope、manifest 与业务 API 尽量不改语义。

## 2. 当前实现基线

当前 `dev` 已经存在相对独立的远程应用层：

```text
Remote Host V1
  ├─ pairing
  ├─ mira_device_* credential
  ├─ remote scopes
  ├─ manifest
  ├─ threads/messages
  ├─ agent control
  └─ artifacts
```

主要代码位置：

```text
server/src/routes/remote-access.ts
server/src/services/remote-access-pairing.service.ts
server/src/services/remote-device-auth.service.ts
server/src/services/tailscale-remote-access.service.ts
server/src/db/repositories/tailscale-remote-access.repository.ts

desktop/src/shared/api/remoteAccess.ts

dangjingtao/uichat-mira-mobile:
src/protocol/remoteHostV1.ts
src/api/remoteMiraHost.ts
src/connectivity/tailscaleConnectivity.ts
```

当前 Direct Transport（Tailscale）的职责主要是：

```text
Mobile
  -> Tailscale VPN / MagicDNS
  -> Tailscale Serve HTTPS
  -> Desktop localhost Mira Server
```

应用层已经通过 `mira_device_*` credential 与 scope 做 Mira 自己的设备授权，因此新增 Relay 不应复制一套认证协议。

## 3. V1 设计原则

### 3.1 Relay 是 Transport，不是 Backend

Relay 不应：

- 存储聊天历史。
- 运行 Agent。
- 调模型。
- 读取 Desktop SQLite。
- 解释 thread/message/agent 业务含义。
- 决定 Mira 设备 scope。
- 成为业务真相来源。

Relay 只做：

- Host / Client 连接登记。
- Relay ID 寻址。
- 请求与响应转发。
- 流式 chunk 转发。
- 取消、断线、超时等传输状态传播。

### 3.2 Desktop 主动出站

公网 Relay 不主动连接 Desktop。

Desktop 开启 Mira Relay 后主动建立长连接：

```text
Mira Desktop
    |
    | WSS outbound
    v
Public Relay
```

这样不要求用户：

- 配置公网 IP。
- 开放路由器端口。
- 配置 NAT。
- 部署 Nginx。
- 安装额外服务端运行环境。

### 3.3 Tailscale 与 Relay 共存

V1 不删除现有 Tailscale 实现。

```text
                    ┌─ Tailscale Direct
Remote Transport ───┤
                    └─ Mira Relay
```

两种 Transport 必须共用同一套 Remote Host V1 身份与业务权限。

## 4. 目标架构

```text
Mira Mobile
    |
    | RemoteTransport
    |
    ├──────── Tailscale Direct ────────> Mira Desktop Host
    |
    └──────── Relay Transport
                  |
                  | WSS / request frames
                  v
          Cloudflare Worker
                  |
           Durable Object
                  |
                  | WSS
                  v
        Desktop Relay Connector
                  |
                  | localhost HTTP/SSE
                  v
          Mira Desktop Server
```

V1 中 Cloudflare 仅作为 Relay 实现候选。

协议设计应避免把客户端永久锁死在 Cloudflare：未来允许用兼容协议替换为其他 Relay 服务。

## 5. 触发模型

### 5.1 Desktop 触发

用户在 Desktop 开启：

```text
远程连接
  Mira Relay   [开启]
```

Desktop Relay Connector 自动：

1. 获取或生成本机 Relay identity。
2. 主动连接固定 Relay 地址。
3. 完成 Host hello / authentication。
4. 保持 WSS 长连接。
5. 断线后按退避策略自动重连。

不要求用户手动执行“连接 Cloudflare”。

### 5.2 Mobile 触发

Mobile 正常执行 Remote Host 操作时触发传输：

```text
listThreads()
getMessages()
sendMessage()
getAgentRun()
approveAgentRun()
...
```

若选中 Tailscale，则沿用当前 HTTP + SSE 直连。

若选中 Relay，则由 RelayTransport 将同一业务请求包装为 Relay frame。

用户不需要先点“唤醒 Relay”。

### 5.3 Relay 触发

Relay 采用事件驱动：

- Host WSS 连接建立时登记 Host。
- Mobile 请求到达时转发给对应 Host。
- Host response/chunk 到达时转发给对应 Mobile 请求。
- 无业务消息时不做应用层轮询。

Cloudflare POC 优先验证 Durable Objects WebSocket Hibernation，以避免空闲连接持续运行应用逻辑。

## 6. Transport 抽象

Mobile 当前 `RemoteMiraHostClient` 已允许注入 JSON 与 SSE Transport，这是新增 Relay 的主要切入点。

V1 建议逐步收敛为：

```ts
interface RemoteTransport {
  request<T>(input: RemoteRequest<T>): Promise<T>;
  stream<T>(input: RemoteStreamRequest<T>): Promise<RemoteStream<T>>;
  probe(): Promise<RemoteTransportState>;
}
```

实现：

```text
DirectRemoteTransport
  -> HTTP / SSE
  -> Tailscale Serve URL

RelayRemoteTransport
  -> WSS Relay Frames
  -> Cloudflare Relay
```

Remote Host V1 client 不应知道 Cloudflare Durable Object 的实现细节。

## 7. Endpoint 与设备身份

当前 Mobile 设备凭证核心为：

```text
hostUrl
credential
deviceId
scopes
```

随着多 Transport 引入，长期建议提升为：

```ts
{
  deviceId,
  credential,
  scopes,
  endpoints: [
    {
      type: "tailscale",
      url: "https://desktop.example.ts.net"
    },
    {
      type: "relay",
      relayId: "..."
    }
  ]
}
```

核心原则：

> 一个 Mira 配对身份，可以拥有多个可达 Endpoint。

不要因为增加 Relay 再生成一套完全独立的业务 credential。

## 8. 配对流程实现对齐

PC 当前实现已按 canonical 合同解析可选 endpoint：

```text
create pairing challenge
        |
        v
resolve pairing endpoints
  ├─ tailscale endpoint (optional)
  └─ relay endpoint     (optional)
        |
        v
mira://pair
```

只要 Direct ready 或 Relay connected 任一成立即可创建 challenge；两者同时成立时，二维码同时携带两套 endpoint。实现层不得把“可配对”定义为“Tailscale 必须 ready”。

配对 URI 继续兼容 `version=1`。Mobile 负责按 canonical 选择策略完成 preflight 与 claim，PC 只记录实际 claim transport，不在审批阶段重新选路。

## 9. Relay Frame V1

Relay 不理解 Mira 业务，仅理解传输 frame。

建议最小类型：

```text
hello
hello_ack
request
response
chunk
complete
cancel
error
```

示例：

```json
{
  "version": 1,
  "type": "request",
  "requestId": "req_xxx",
  "method": "GET",
  "path": "/threads",
  "headers": {
    "authorization": "Bearer mira_device_..."
  }
}
```

Desktop Connector 收到后请求本地 Mira Server：

```text
http://127.0.0.1:<MIRA_PORT>/threads
```

普通 JSON 响应映射为：

```text
response -> complete
```

流式聊天映射为：

```text
response headers
chunk
chunk
chunk
complete
```

取消操作映射为：

```text
Mobile cancel
  -> Relay
  -> Desktop AbortController
```

## 10. SSE 与流式响应

当前 Mobile 发送消息使用：

```text
POST /proxy/chat/default
-> SSE
```

Relay 不需要实现或解析 Mira SSE 语义。

Desktop Connector 只需要把本地 HTTP/SSE 响应转换为通用 Relay `chunk` frame，Mobile RelayTransport 再还原为当前 Remote Host client 所需的流事件。

禁止在 Relay 中判断：

- `text-delta`
- `tool-event`
- `finish`
- Agent 状态

这些都属于 Mira Remote Host V1，而不是 Relay。

## 11. Transport 选择策略（以 Mobile canonical 为准）

用户层默认提供：

```text
远程连接模式：自动
```

配对阶段与日常业务请求采用不同的选择约束。配对阶段优先 Relay：

```text
已有 Relay endpoint
  -> Relay /health preflight
  -> ready: 只通过 Relay 提交 claim
  -> Relay transport failure: 在 claim 前尝试 Direct

无 Relay endpoint
  -> Direct
```

`claim` 是一次性副作用。Transport 回退只允许发生在 claim 发送前；claim 已发出但响应不确定时，不得跨 Transport 自动重发。

配对完成后的日常业务请求仍采用：

```text
已有 Tailscale endpoint
  -> probe
  -> ready: 使用 Direct
  -> unavailable: 尝试 Relay

无 Tailscale endpoint
  -> Relay
```

可保留高级手动选项：

```text
自动
Tailscale
Mira Relay
```

自动切换不得：

- 删除设备 credential。
- 把网络不可达误判为设备撤销。
- 因 Transport 切换重新创建业务身份。

401 / 403 才进入 Mira 授权失效判断。

## 12. Relay 安全边界

### 12.1 业务授权仍由 Desktop 决定

现有 `mira_device_*` credential 与 scope 校验继续发生在 Desktop Mira Server。

Relay 不应成为业务授权真相来源。

### 12.2 Relay 自己仍需要连接级鉴权

“Relay 不做业务鉴权”不等于“Relay 完全匿名”。

Relay 至少需要防止：

- 任意客户端枚举 Relay ID。
- 未授权客户端冒充 Desktop Host。
- 未授权 Mobile 向任意 Host 建立转发会话。
- 连接洪泛与明显滥用。

Relay connection credential 与 Mira `mira_device_*` credential 应概念分离。

### 12.3 不长期存储业务正文

Relay V1 不持久化：

- prompt。
- assistant response。
- 文件正文。
- conversation history。

日志只允许保留最小运行信息，例如：

```text
requestId
host relay id
frame type
status
latency
size
error code
```

不得默认记录请求正文。

## 13. 文件与大载荷

V1 Relay 优先保证：

- JSON API。
- Chat stream。
- Agent 状态与控制。
- 小型 artifact / metadata 请求。

大文件与超大二进制不应在 V1 里无约束透传。

需要单独定义：

- frame 最大尺寸。
- 单请求最大累计字节数。
- 上传 / 下载超时。
- backpressure。

如果后续大文件成为高频需求，再评估分块传输或独立对象存储通道。

## 14. Cloudflare Free POC 边界

首个公网 Relay 实现目标：

```text
Cloudflare Workers
+ Durable Objects
+ WebSocket Hibernation
```

约束：

- V1 必须以免费计划可运行作为设计目标。
- 不把付费 Workers 能力作为基础依赖。
- 不要求 VPS、Docker、Nginx、数据库运维。
- 不引入 KV / D1 / R2，除非 POC 证明是协议正确性所必需。
- Cloudflare 当前具体免费额度和限制必须在实现 POC 时重新核验，文档不把易变化的配额写成长期协议合同。

如果 Free 方案无法满足基本长连接 Relay，优先更换 Relay 实现，不修改 Remote Host V1 业务协议。

## 15. Desktop UI 方向

当前“`Tailscale 远程连接`”页面长期应提升为：

```text
远程连接

Mira Relay
● 已连接
零配置公网转发

Tailscale
● 已连接
私人网络直连

已配对设备
...
```

这不是 V1 POC 的前置要求，但 UI 名称不应长期让产品概念等同于 Tailscale。

## 16. 实施顺序

### Phase A - 契约与 POC

只验证：

```text
Desktop WSS -> Relay
Mobile -> Relay -> Desktop
GET /health
GET /remote/v1/manifest
普通 JSON request/response
```

不改聊天 UI。

### Phase B - RemoteTransport 接入

- Mobile 抽出 Direct / Relay Transport。
- Desktop 增加 Relay Connector。
- 保留当前 Tailscale 逻辑。
- 同一 credential 可从两条 Transport 请求 Desktop。

### Phase C - Streaming

验证：

```text
POST /proxy/chat/default
chunk forwarding
cancel
reconnect
```

### Phase D - Pairing 与自动选路

- pairing endpoint 来源去 Tailscale 硬编码。
- 同一设备保存多个 endpoint。
- 自动 Direct -> Relay fallback。

### Phase E - UI 收敛

把产品概念从“Tailscale 远程连接”提升为“远程连接”。

## 17. V1 验收条件

Relay POC 至少满足：

- Desktop 不开放公网端口即可主动上线 Relay。
- Mobile 在未安装 / 未连接 Tailscale 时可以通过 Relay 到达 Desktop。
- Tailscale 原路径保持可用，行为不回归。
- `/remote/v1/manifest` 可通过 Relay 使用原有 device credential 验证。
- `/threads` 可通过 Relay 正常读取。
- `/proxy/chat/default` 可以流式返回且不要求 Relay 理解 Mira 业务事件。
- Mobile 取消流式请求后 Desktop 本地请求能被终止。
- Relay 断线不删除 Mira device credential。
- Desktop 撤销 device 后，Relay 请求与 Tailscale 请求都同样返回未授权。
- Relay 不持久化业务正文。
- Free 版 Cloudflare POC 能完成基本双端长连接与转发。

## 18. 非目标

V1 不做：

- Mira 云端账户体系。
- 云端聊天历史同步。
- 云端 Agent Runtime。
- 云端模型代理。
- Desktop 数据库同步到公网。
- 替换 Tailscale。
- WebRTC P2P。
- 大文件专用传输协议。
- 多 Host 调度中心。

## 19. 最终边界

本方案长期保持以下关系：

```text
             Remote Host V1
      pairing / auth / scopes / API
                    |
           RemoteTransport
          /               \
 Tailscale Direct       Mira Relay
                            |
                    Relay implementation
                    (Cloudflare first)
```

核心原则：

> Tailscale 是一种 Transport，Relay 也是一种 Transport；Mira Remote Host V1 才是远程能力本身。

新增 Relay 的目的只有一个：在不牺牲现有本地 Host 架构的前提下，让 Mira Mobile 与 Mira Desktop 的远程互通变得足够简单。
