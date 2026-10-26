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
