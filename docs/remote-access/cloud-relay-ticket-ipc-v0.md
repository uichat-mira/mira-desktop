# DSK-010 / Round 1 — Native Cloud Relay ticket IPC V0

Status: implementation contract for DSK-010, scoped to [#429](https://github.com/uichat-mira/mira-desktop/issues/429); the DSK-016 section updates standard Dev ownership.

## Boundary and owner

- **Electron Main** is the only owner of the OS-encrypted Mira Cloud Session, Cloud Auth API calls, and `withRelayHostTicket` (delivered by DSK-009).
- **Bundled Node Backend** is a trusted local Host process and the only intended recipient of a **single-use, short-lived Host transport ticket**. It does not receive Cloud Session / PKCE / service signing keys.
- **Renderer / preload / Fastify HTTP routes / SQLite / local JWT** have **no access** to this IPC channel or its ticket. Never create an `/api`, `/remote`, `cloud-account:*` or renderer-callable method for the ticket.
- The trust boundary is between the Electron-owned child process and its parent, not an authentication system for arbitrary processes. A compromised local Backend process can use a ticket while it is valid; do not claim otherwise.

## Transport

Packaged Electron spawns the bundled Backend with Node's dedicated inherited IPC channel (`stdio: ["ignore", "pipe", "pipe", "ipc"]`) and attaches the native handler **only to that exact ChildProcess instance**. Messages use Node's `process.send` and ChildProcess `message` listeners. No TCP, localhost HTTP, named pipe listener, filesystem mailbox, bearer environment variable or renderer forwarding is added.

Development now uses the same ownership model through the standard
`pnpm dev:electron:win` / `pnpm dev:electron:mac` entrypoints (see DSK-016 below).
`electron/dev-launcher.cjs` starts only Vite; Electron Main spawns the source
Backend with this same inherited IPC channel and attaches the native handler to
that exact ChildProcess. A Backend launched any other way has no
`process.send`; the Cloud ticket provider then returns `bridge_unavailable`
explicitly while Tailscale Direct and local Desktop continue working. There is
no HTTP or renderer credential fallback. The self-hosted Relay mentioned in the
historical sections was retired by DSK-017.

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
- A read-only authenticated `GET /remote/admin/cloud-relay/status` reports sanitized transport state (no room, ticket, account or user credential). The legacy `/remote/admin/relay/*` routes were later removed by DSK-017 (see below).
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

- **Activation belongs to a verified native Mira Cloud Account**, not a
  user-configured Relay settings screen. Electron Main publishes a boolean
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
- **Official endpoint is application-owned:** both development and
  packaged runtimes default to the approved Cloud-only endpoint
  `https://cloud-relay.tomz.io` (normalized to `wss://cloud-relay.tomz.io`)
  without any local `.env` value. The Client does not require a user or
  operator to flip an extra `UI_CHAT_CLOUD_RELAY_ENABLED=1` switch, and no
  user-visible per-account URL/room/token exists. A valid, TLS-only
  `UI_CHAT_CLOUD_RELAY_URL` may remain as an **operator-only override** for
  controlled deployment/testing, never as an account setting. An explicitly
  malformed, plaintext or `relay.tomz.io` Legacy override fails visibly as
  `cloud_relay_endpoint_unavailable`; it never falls back to the default or
  routes a Cloud ticket to Legacy Relay. An **operator-only emergency**
  `UI_CHAT_CLOUD_RELAY_ENABLED=0` can suspend official Cloud transport
  without affecting local/Tailscale/self-hosted connectivity.
- The isolated REL-005 `workers.dev` Worker is a **test service**, not
  automatically the final official production endpoint. Do not hard-code it
  as the product default or silently route to the Legacy production hostname.
  Release wiring of an official Cloud-only endpoint and genuine Desktop
  sign-in/restart/Host revoke T3 remain separate acceptance evidence.
- The standard development entrypoints (`pnpm dev:electron:win` /
  `pnpm dev:electron:mac`) keep the Vite renderer in HMR mode and skip the
  independent Backend launcher. Electron Main starts the source Backend
  directly with the workspace Node executable and `tsx`, attaches the same
  private ticket and Host Grant IPC bridges, and marks only that exact child
  with `UI_CHAT_CLOUD_IPC_CHILD=1`.
- The standard dev launch refuses to start when the configured Backend port is
  already occupied; it never reuses an independently started Backend. Backend
  source changes are applied by an Electron Main restart loop that preserves
  the private IPC relationship; `tsx watch` is not used because its
  intermediate supervisor cannot receive Electron's child IPC channel.
- `dev:electron:win:cloud-pilot` / `dev:electron:mac:cloud-pilot` remain only
  as compatibility aliases for the standard commands. No development flow
  requires `UI_CHAT_CLOUD_PILOT`.
- Both development and packaged runtimes resolve the same application-owned
  official Cloud endpoint with no local `.env` requirement. An operator-only
  `UI_CHAT_CLOUD_RELAY_URL` may override it for controlled testing; it never
  defaults to the isolated REL-005 Worker or a Legacy Relay hostname.

## DSK-015 — official Cloud-only endpoint default (2026-11-19)

This section closes the remaining endpoint-configuration gap in
[#481](https://github.com/uichat-mira/mira-desktop/issues/481); it does not
change the DSK-010 transport contract.

- `resolveCloudRelayConnectorConfig()` owns the default in
  `server/src/services/remote-relay-connector.service.ts`: an absent or blank
  `UI_CHAT_CLOUD_RELAY_URL` resolves to
  `wss://cloud-relay.tomz.io` in every runtime. The value is bundled into
  `server.cjs`, so a packaged Host does not need a developer-local `.env`.
- An explicit operator-only `UI_CHAT_CLOUD_RELAY_URL` remains available for
  controlled deployment/testing. Because Cloud admission is always TLS-only,
  the override must be `https://` or `wss://`; malformed URLs, embedded
  credentials, paths, query strings, fragments, plaintext protocols and the
  Legacy `relay.tomz.io` host all resolve to `null` and fail as
  `cloud_relay_endpoint_unavailable`. An invalid override never falls back to
  the official default.
- The operator-only emergency switch `UI_CHAT_CLOUD_RELAY_ENABLED=0` still
  disables Cloud transport without affecting Local, Tailscale Direct or the
  independent self-hosted Relay. No renderer, account UI or ordinary user
  configuration gains endpoint selection or credential visibility.

## DSK-016 — standard Dev uses the packaged IPC ownership model (2026-11-19)

This section closes the development/runtime parity gap in
[#482](https://github.com/uichat-mira/mira-desktop/issues/482); it does not
change the DSK-005 / DSK-007 / DSK-010 credential or transport contracts.

- `electron/dev-launcher.cjs` now starts only the Vite renderer. It refuses to
  continue when the configured Backend port is already listening, so a healthy
  but independently owned Backend can never be mistaken for an IPC-attached
  Host. The renderer port remains independently allocated when the configured
  Vite port is occupied.
- `electron/main.cjs` spawns the source Backend with the workspace Node
  executable and `tsx` only when the launcher supplies the ownership marker.
  The child keeps `stdio: ["ignore", "pipe", "pipe", "ipc"]`,
  `UI_CHAT_CLOUD_IPC_CHILD=1` and `UI_CHAT_ALLOW_BACKEND_REUSE=0`; Main verifies
  the child IPC channel before attaching the ticket and Host Grant bridges.
  Missing ownership or a missing IPC channel fails closed instead of falling
  back to an independent Backend.
- `tsx watch` is deliberately not used: its intermediate supervisor would own
  Electron's IPC channel instead of the actual Backend. Instead, Main watches
  `server/src` runtime source changes (debounced, excluding tests and build
  output), stops the old child, starts a new one and reattaches both private
  bridges. Vite HMR remains unchanged. A failed restart leaves Cloud Host
  unavailable until a later successful restart.
- Electron Main remains the sole owner of the Cloud Account Session and the
  Relay ticket / Host Grant acquisition boundary. Dev adds no Renderer, HTTP,
  SQLite or log access to those secrets, and Local / Tailscale Direct /
  self-hosted Relay paths remain independent.
- Direct Electron launches or harnesses that manage their own Backend still
  work but have no owned IPC channel; Cloud Host stays unavailable there with
  the existing explicit bridge failure. Only the standard
  `pnpm dev:electron:win` / `pnpm dev:electron:mac` entrypoints provide
  Cloud-capable development.

## DSK-017 — Legacy paired/self-hosted Relay retired (2026-11-24)

DSK-017 removes the independent self-hosted Relay that earlier sections
retained beside the official Cloud path:

- No user-configured/default/custom endpoint, persisted relay identity or
  host/client token remains. The old `remote_relay_settings` table is dropped
  by an idempotent startup migration.
- No `/remote/admin/relay/config` or `/remote/admin/relay/status` route and no
  Relay controls in Remote Access settings remain.
- Pairing is Tailscale Direct only; a challenge requires a ready Direct URL and
  the QR contains no `relay`, `relayId` or `relayToken` fields.
- `RemoteRelayConnectorService` is now Cloud-only. Its native-ticket hello,
  fail-closed endpoint handling, provenance/Grant admission and shared Relay V1
  frame engine are unchanged.
- `relay.tomz.io` remains only as a blocked legacy hostname so a Cloud ticket
  can never be routed there.
- Cloud account session, Cloud ticket IPC and Host Grant contracts are
  unchanged.

## DSK-018 — Direct admission follows the native Cloud login mode (2026-11-24)

- A second private child IPC channel (`mira:cloud-session:state:v1`) projects
  only the native Cloud lifecycle as `signed_out`, `signed_in`, `restoring` or
  `unknown`. It carries no account, token, Host room or scope.
- Only `signed_out` permits Tailscale Direct pairing and paired-device
  admission. `signed_in`, `restoring`, `unknown`, a missing bridge and a
  disconnected bridge all fail closed at the Backend authentication boundary.
  This supersedes the earlier DSK-010 note that a standalone Backend keeps
  Tailscale Direct working: Direct now requires native proof of sign-out.
- Local Desktop JWT, official Cloud ticket/Grant eligibility, lease renewal and
  Relay protocol behavior are unchanged. Existing paired device records are
  retained; no re-pairing is required after sign-out.
