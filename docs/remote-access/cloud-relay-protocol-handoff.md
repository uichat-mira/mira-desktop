# DSK-010 Round 3 — Hosted Relay protocol handoff (2026-10-26)

Status: **blocked on REL-001**. This document records observed code, **not** a frozen Cloud handshake protocol or production integration result.

## Source-of-truth inspection

- Desktop: `server/src/services/remote-relay-connector.service.ts` at this PR, plus `server/src/remote-relay/protocol.ts`. The independent opt-in Cloud connector currently generates an interim frame `{version:1,type:"hello",role:"host",relayId:ticket.room,token:ticket.token}`. It never sends the legacy `clientToken`. The frame and ack are **fixture assumptions only**.
- Cloud Auth: `packages/contracts/src/service-credential.ts`, `apps/api/src/service-credentials/service.ts`, `apps/api/src/service-credentials/relay-admission.ts`, `apps/api/src/hosts/host-presence.ts` in `uichat-mira/cloud-auth@dev`. JWT is EdDSA / `mira:cloud-auth` / `mira:cloud-relay-transport` / `relay:transport`, with `relay.room`, `relay.role` and issuer-controlled `sub`, `device_id`, `exp`. `createRelayRoom()` generates `room_` + 256-bit random base64url value. Issuance verifies device/session and account/room/role entitlement; issuance alone is **not Relay-side JWT verification**.
- Relay: `uichat-mira/uichat-mira-relay@dev:src/index.ts`, `handleHello` and `authenticateHost` (as inspected 2026-10-26). The current Worker/DO only knows legacy room Host/Client token hashes, with `token` length 32–512, and demands `clientToken` to provision a first Host; no JWKS/signature, `aud`, `iss`, Cloud room/account ownership or signed ticket expiry verification. The existing `hello_ack` only confirms legacy Relay authentication and cannot be accepted as evidence of official Cloud authorization.
- REL-001 [#2](https://github.com/uichat-mira/uichat-mira-relay/issues/2) remains open without a Cloud authentication PR in the inspected repository. **Do not turn a Desktop fake `hello_ack` into T3/T4 evidence.**

## Verified compatibility boundary

| Layer | Current evidence | Decision |
| --- | --- | --- |
| Cloud Auth Host room and ticket | Native DSK-009 T1/T2 + Cloud Auth contract | Ticket issuer and context match; Relay admission NOT proven |
| Private ticket delivery | DSK-010 Round 1 and Round 2 tests | Single child-process IPC; no renderer/HTTP credential surface |
| Host `hello` with Cloud ticket | Desktop synthetic socket fixture only | PROVISIONAL. REL-001 owns final wire contract |
| Legacy DO receives Cloud hello | Source shows token-hash + initial `clientToken` requirement | `HOST_AUTH_REQUIRED` / `CLIENT_TOKEN_REQUIRED` / `HOST_AUTH_FAILED` are old-protocol refusals, not successful Cloud admission |
| New-host admission, signature, room-role binding | Not implemented in Relay dev | **T3 blocked by REL-001** |
| Mobile ↔ official Relay ↔ Desktop; Tool Grant | Not yet end-to-end | **T4 belongs to DSK-006 + DSK-007 + MOB-080 + OPS-005** |

## Narrow Desktop behavior at this checkpoint

- An old Relay's **pre-ack** `CLIENT_TOKEN_REQUIRED` or `HOST_AUTH_REQUIRED` is recognized as `cloud_relay_protocol_unavailable`; `HOST_AUTH_FAILED` is `cloud_relay_admission_denied`. They are not swallowed, logged with raw remote messages, or retried indefinitely. Transient transport disconnections remain reconnectable with **new native tickets**.
- The legacy Connector and Tailscale behavior stay independent. The Cloud connector is default-disabled, requires an explicit trusted TLS endpoint and never downgrades to old Host/Client tokens.
- All inbound Cloud business requests continue to be refused with `CLOUD_GRANT_REQUIRED` until DSK-007 independently wires effective grants. Relay tickets cannot bypass the local business authority.
- Never claim final acceptance of DSK-010 until a Relay integration test demonstrates the **actual** verified official protocol. A fixture that emits `hello_ack` is not that evidence.

## Small external handoff required from REL-001

1. Publish authoritative Host/Client **Cloud** socket path, credential placement and `hello / hello_ack / error` envelope (including whether legacy `relayId` is still used).
2. Verify issuer, signature/JWKS, audience, scope, expiry, room/role and authoritative account/device↔room entitlement; reject foreign accounts/roles without changing Desktop business scopes. Disallow unauthenticated host takeover and accidental legacy token bootstrap on official rooms.
3. Provide a bounded T3 Worker/DO test fixture plus at least one valid Host join and negative rejection example, including key rotation and healthy-WebSocket-after-ticket-expiry behavior.
4. Once those are real, change only Desktop's Cloud hello/ack adapter and corresponding tests; run targeted cross-service smoke. Do not expand to DSK-007, Mobile, or the Relay Worker in this Desktop task.

The missing upstream contract is a *functional dependency*, not a reason to build speculative protocols or force desktop packaging tests.
