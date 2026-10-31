# DSK-010 / Round 1 — Native Cloud Relay ticket IPC V0

Status: implementation contract for DSK-010, scoped to [#429](https://github.com/uichat-mira/mira-desktop/issues/429).

## Boundary and owner

- **Electron Main** is the only owner of the OS-encrypted Mira Cloud Session, Cloud Auth API calls, and `withRelayHostTicket` (delivered by DSK-009).
- **Bundled Node Backend** is a trusted local Host process and the only intended recipient of a **single-use, short-lived Host transport ticket**. It does not receive Cloud Session / PKCE / service signing keys.
- **Renderer / preload / Fastify HTTP routes / SQLite / local JWT** have **no access** to this IPC channel or its ticket. Never create an `/api`, `/remote`, `cloud-account:*` or renderer-callable method for the ticket.
- The trust boundary is between the Electron-owned child process and its parent, not an authentication system for arbitrary processes. A compromised local Backend process can use a ticket while it is valid; do not claim otherwise.

## Transport

Packaged Electron spawns the bundled Backend with Node's dedicated inherited IPC channel (`stdio: ["ignore", "pipe", "pipe", "ipc"]`) and attaches the native handler **only to that exact ChildProcess instance**. Messages use Node's `process.send` and ChildProcess `message` listeners. No TCP, localhost HTTP, named pipe listener, filesystem mailbox, bearer environment variable or renderer forwarding is added.

Development Backend is currently started independently by `electron/dev-launcher.cjs` (and may reuse an existing process). **Do not change the dev launcher as part of this round.** Where `process.send` is absent, the Cloud ticket provider returns `bridge_unavailable` explicitly; self-hosted Relay, Tailscale and local Desktop continue working. Round 2 integration must test the packaged-shaped injectable provider and report this dev limitation, not secretly use HTTP.

## Bounded protocol

All messages are structured objects with exact keys, channel `mira:cloud-relay:host-ticket:v1`, a randomly generated UUID `requestId` (never chosen by a renderer), and type:

| Direction | Type | Body |
| --- | --- | --- |
| Backend → Main | `request` | `{channel,type,requestId}` |
| Main → Backend | `result` | `{channel,type,requestId,ok:true,ticket}` or `{channel,type,requestId,ok:false,errorCode}` |
| Main → Backend | `revoked` | `{channel,type,reason:"signout"|"reauth"}` |

The positive ticket contains only `token`, `tokenType`, `audience`, `expiresAt`, `room`, `role` validated by DSK-009. `errorCode` is a fixed, bounded enum; never send raw exception text, `sessionToken`, account profile, credential response, URL containing credentials, or user-input request parameters.

### Lifetimes and failure behavior

1. Backend issues at most four outstanding requests; each has a 30-second deadline. Request IDs are unique, pending response IDs must match, and unsolicited/duplicate/malformed results are ignored. Timeout, unavailable process, IPC disconnect, malformed response and failed send reject closed.
2. Native service admits at most four outstanding requests from its single bound child. All other channels, shapes, IDs and duplicate requests are ignored or rejected with a non-secret error code. No arbitrary account, Host, room, role, audience, path or scope parameter may be requested.
3. Only the Electron controller may call Cloud Auth. Sign-out and a verified 401 invalidate the native controller's revision (DSK-009) and cause `revoked` to be sent to the attached Backend. In-flight Backend ticket requests reject, and Round 2 can subscribe to this event to tear down an already-established Cloud socket without affecting independent paths.
4. Child disconnect or parent disposal drops the native reply route. Never persist a ticket or copy it into log/error strings. A late response after timeout, revocation or disposal is ignored.
5. The obtained ticket is only an **admission credential to establish a Relay transport connection**. Round 1 does **not** open a WebSocket, expose remote business APIs, create a Cloud Grant, infer any Host Tool scope, or replace `mira_device_*`.

## Audit plan / handoff

- T1: exact message shape, bounded concurrency/timeout, correlation, forged/duplicate/late response rejection; no ticket or Cloud Session leakage to renderer/state/HTTP.
- T2: native 401/logout during simultaneous request, unavailable dev bridge, child exit, send failure, correct error redaction.
- Round 2 owns creation of the hosted socket using the injectable provider. It must not use the old self-hosted `hostToken/clientToken` for the hosted service.
- Round 3 and [REL-001](https://github.com/uichat-mira/uichat-mira-relay/issues/2) own the real official `hello` / `hello_ack` contract and server verification. Do not assert production end-to-end based on Round 1 tests alone.

## DSK-010 Round 2 — dedicated hosted connector (2026-10-26)

- First-round IPC is now consumed by the **Backend-only** `RemoteRelayConnectorService` in `kind:"cloud"` mode. The existing user-configured/default Relay is a separate service instance with its original room tokens and pairing semantics. Tailscale is unchanged.
- Official hosted transport is opt-in behind `UI_CHAT_CLOUD_RELAY_ENABLED=1` and a configured `UI_CHAT_CLOUD_RELAY_URL=https://…`. No production default URL is assumed while [REL-001](https://github.com/uichat-mira/uichat-mira-relay/issues/2) has not implemented ticket verification. Missing/invalid endpoint is a distinct misconfigured state; no path selects a legacy endpoint instead.
- For each socket generation, request a new native Host transport ticket over IPC, open `/v1/relay/{ticket.room}/socket` and send a **provisional** Host `hello` containing `relayId=room`, `token`, `role=host` and **no `clientToken`**. This merely reuses the current Relay V1 hello/ack envelope in deterministic fixture tests. **REL-001 owns the final cloud handshake contract; no live hosted compatibility claim is made here.**
- A healthy authenticated socket is kept alive by the existing WebSocket ping/keepalive; the short-lived connection-admission ticket does not schedule a disconnect. A reconnect begins with a fresh IPC request. Logout, 401/rejected session or parent IPC disconnection tears down the Cloud socket; the next attempt cannot use the old ticket.
- Until DSK-007 wires a verified Cloud Host Grant, **all** inbound Cloud `request` frames receive `CLOUD_GRANT_REQUIRED` and **never reach** local HTTP, Remote Gateway or tools. The native ticket is transport-only. This deliberate business lock will be removed only together with verified Host Grant handling in DSK-007.
- A read-only authenticated `GET /remote/admin/cloud-relay/status` reports sanitized transport state (no room, ticket, account or user credential). Legacy `/remote/admin/relay/*` continues to mean the independently configured Relay.
- Standalone development Backend without Electron parent IPC fails with `relay_ticket_bridge_unavailable`. This is a known Round 1 limitation, not license to add localhost secret endpoints.
- Connection/hello/ack details, production endpoint deployment and actual Relay service verification remain a **Round 3** dependency. Tests of this Round 2 connector use a fake socket and native ticket-provider fixture; do not mark end-to-end complete.

## DSK-010 Round 3 — REL-001 compatibility gate (2026-10-26)

**Repository evidence as of this review:**

| Source | Checked contract | Reality |
| --- | --- | --- |
| `uichat-mira/cloud-auth@dev`, `packages/contracts/src/service-credential.ts` | Relay admission ticket with issuer `mira:cloud-auth`, audience `mira:cloud-relay-transport`, `relay:transport`, room and `host` role | Implemented and scoped |
| `uichat-mira/cloud-auth@dev`, `apps/api/src/service-credentials/service.ts` / `relay-admission.ts` | Server-owned room/Host/device binding checked before issue | Implemented for ticket issuance |
| `uichat-mira/uichat-mira-relay@a41ada783cde4cd94e17d9beb9cf4e3108ac52e7`, `src/index.ts` | WebSocket Host `hello` accepts short-lived, JWT-signed Cloud ticket | **Not implemented**: legacy SHA-256 room token comparison; first Host `hello` requires a separate legacy `clientToken` |
| [REL-001 #2](https://github.com/uichat-mira/uichat-mira-relay/issues/2) | Hosted Cloud ticket verification, role/room/context binding, authenticated Host ack | **Open**, no implementation PR in `uichat-mira-relay` at time of review |

**Desktop fail-closed hardening:** The current legacy Relay sends `CLIENT_TOKEN_REQUIRED` **before** `hello_ack`. Desktop now classifies known legacy Host-hello errors as `cloud_relay_protocol_incompatible`, terminates that Cloud socket and suppresses automatic attempts to the same incompatible endpoint until an explicit connector restart. Generic hosted admission denial is classified `cloud_relay_admission_denied` rather than overwritten by WebSocket close reason. Mismatched room acknowledgements and handshake timeout retain distinct diagnostic codes. None of these errors may cause legacy Token or Tailscale fallback. Independent self-hosted protocol behavior remains untouched.

**Blocking for genuine T3:** After REL-001 lands, compare its actual outbound URL, Host `hello` and `hello_ack` fields, JWT verifier expectations (issuer, audience, EdDSA/JWKS, expiry, room/role, current entitlement) and rejection frames with this provisional Desktop shape, and make only the necessary contract edits. Require runtime/service fixture or staged hosted proof for a valid Host ticket, invalid/mismatched ticket cases, new ticket on reconnect, successful authenticated socket retained past ticket expiry, and no business forwarding before DSK-007 Grant. Verify no raw ticket logging.

**Not certified:** Current deterministic Desktop tests validate client behavior against fixtures and known *legacy* rejection frames, not a Cloud-enabled Relay runtime. They do **not** certify Relay-side JWT signature verification, issuer pinning, account/Host-room entitlement or production Mobile-to-Desktop E2E. Leave DSK-010/DSK-006 open until REL-001 delivers a trustworthy implementation and T3 evidence.

## DSK-006 — Native Cloud Host lifecycle (2026-11-01)

This section supersedes the earlier **opt-in** activation description for
Cloud Host users; earlier DSK-010 statements are retained as implementation
history, not current release guidance.

- **Activation belongs to a verified native Mira Cloud Account**, not the
  self-hosted Relay settings screen. Electron Main publishes a boolean
  `availability` message to its exact spawned Backend child when the account
  becomes `signed_in` with configured Host policy and a valid local-owner
  binding. The Backend independently requests a fresh ticket before each
  socket and never receives the Cloud Session or account identity.
- Electron marks only its spawned Backend process with non-secret
  `UI_CHAT_CLOUD_IPC_CHILD=1`. Other Node child/worker process channels
  (including Vitest) must never be sent this message.
- Backend first sends `state_request` to native over the existing
  `mira:cloud-relay:host-ticket:v1` IPC channel. This allows a restored
  Cloud Session to be recognized when Backend startup races the Electron
  notification. Both new messages have **exactly**
  `{channel,type}` or `{channel,type,available:boolean}`; neither contains
  account IDs, tokens, Host rooms or secret material.
- A non-ready Cloud state (sign-out, 401/rejected, setup incomplete,
  checking, unavailable or local owner unbound) stops the Cloud socket
  immediately and aborts pending Host work. Subsequent `signed_in` after
  verified restoration reacquires a new ticket. Backend must be listening
  before a Cloud socket is created. The independent self-hosted Relay and
  Tailscale paths are not started, stopped or reconfigured by this gate.
- **Operator endpoint remains a release precondition:** the platform must
  supply `UI_CHAT_CLOUD_RELAY_URL` pointing to a verified Cloud-only
  official TLS endpoint, with no user-visible per-account URL/room/token.
  The Client no longer requires a user or operator to flip an extra
  `UI_CHAT_CLOUD_RELAY_ENABLED=1` switch. A missing, plaintext or
  `relay.tomz.io` Legacy endpoint fails visibly as
  `cloud_relay_endpoint_unavailable`. An **operator-only emergency**
  `UI_CHAT_CLOUD_RELAY_ENABLED=0` can suspend official Cloud transport
  without affecting local/Tailscale/self-hosted connectivity.
- The isolated REL-005 `workers.dev` Worker is a **test service**, not
  automatically the final official production endpoint. Do not hard-code it
  as the product default or silently route to the Legacy production hostname.
  Release wiring of an official Cloud-only endpoint and genuine Desktop
  sign-in/restart/Host revoke T3 remain separate acceptance evidence.
- The development Backend started by `electron/dev-launcher.cjs` may lack
  the Electron-owned child IPC channel. In that mode no Cloud bearer
  is forwarded by another route: use a packaged-shaped owned-IPC harness
  for targeted validation, and report actual local dev mode as unsupported
  for native Cloud Host relay until its process model is explicitly changed.
