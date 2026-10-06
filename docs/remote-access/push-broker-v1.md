---
status: current
owner: remote-runtime
last_verified: 2026-10-06
layer: protocol
module: RemoteAccess
feature: PushBrokerV1
doc_type: current-contract
canonical: true
related:
  - relay-transport-v1.md
  - mobile-host-protocol-v1.md
---

# Push Broker V1

Push Broker 是 Mira-owned 的独立后台消息投递服务边界。它不是 Remote Relay 的扩展。

## 边界

```text
Remote Relay: transport-only
Push Broker: installation identity / Host authorization / event ingest / provider delivery
Desktop Host: canonical message truth / outbox / signing identity
Mobile: installation key / provider token registration / explicit Host approval
```

`packages/remote-relay` 的 room、relay token、TOFU 与请求转发合同不参与 Broker 授权。
`mira_device_*` 也不是 Broker credential。

## #267 当前合同

`packages/push-broker` 当前实现 Broker foundation：

- 一个 SQLite-backed Durable Object 对应一个 `installationId`；
- Mobile installation 使用 Ed25519 keypair；
- register / refresh / revoke 由 installation 私钥签名；
- raw APNs/FCM provider token 只进入 Broker，并使用 `BROKER_STORAGE_KEY` 做 AES-256-GCM application-level encryption 后落盘；
- Host binding 的唯一授权来源是 installation 对 Host key + source scope + nonce 的显式签名批准；
- Broker 返回随机 256-bit `deliveryToken`，持久化只保存 SHA-256；
- Host event ingest 同时校验 `deliveryToken`、Host Ed25519 signature 与 `sourceScope`；
- `(installationId,eventId)` 幂等由 installation Durable Object 内的 event primary key 保证；
- event schema 是严格 allowlist，不接受 Assistant 正文、prompt、tool output 或任意扩展 payload。

## API

所有 mutation endpoint 使用 `POST`：

- `/v1/installations/:installationId/register`
- `/v1/installations/:installationId/refresh`
- `/v1/installations/:installationId/revoke`
- `/v1/installations/:installationId/bindings/approve`
- `/v1/installations/:installationId/bindings/revoke`
- `/v1/installations/:installationId/events`

`/events` 使用 `Authorization: Bearer <deliveryToken>`。

## 密钥与签名格式

- installation / Host public key：Ed25519 raw 32 bytes，base64url 编码；
- signature：Ed25519 64 bytes，base64url 编码；
- request signing payload：`src/contracts.ts` 的 canonical JSON；
- object key 词典序；array 保持顺序；`sourceScope` 在验签前归一为排序去重。

Broker 不持有 installation 或 Host 私钥。`BROKER_STORAGE_KEY` 仅通过 Worker secret 注入。

## Replay / rotation / revoke

- signed register/refresh/revoke 请求使用短时 `issuedAt` + nonce；
- Host binding 使用一次性 `bindingNonce` + 短 TTL；
- nonce 持久化后不可重复；
- 同一 `hostId` 再批准新 `hostPublicKey` 会覆盖 binding，旧 delivery token 立即失效；
- binding revoke 后旧 token 失效；
- installation revoke 会清除 provider-token ciphertext、撤销所有 binding，并取消 pending event。

## Event ingest

v1 只接收 `assistant-message` / `final_transition_first_seen` 事件。

Broker ingest 只确认“这个 installation 已授权的 Host 对这个 source 发来了一个合规事件”。
canonical eligibility 的产生属于 #268；FCM/APNs provider dispatch 属于 #269。

## Secret / privacy

- API response 永不回传 provider token；
- persistence 不保存 raw provider token 或 raw delivery token；
- 服务不记录 request body、authorization header、signature 或 secret；
- event schema 不允许消息正文。

## Verification

- `pnpm check:push-broker`：Broker TypeScript contract；
- `pnpm test:push-broker`：HTTP service-level contract tests，覆盖签名、refresh、nonce replay、scope、Host key rotation/revoke、installation revoke、event dedupe 与 payload allowlist；
- `pnpm check` 会包含以上两项。

真实 FCM/APNs、Mobile 真机通知与 Host canonical outbox 不属于 #267 acceptance。
