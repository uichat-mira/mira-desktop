# DSK-007 · Cloud Host Grant secure adapter handoff

Status: **implementation started, not accepted**. Branch: `feat/dsk-007-cloud-host-grant`.

## Current scope

This first slice adds deterministic, fail-closed T1 evaluation of the **existing** OPS-020
`GET /v1/hosts/:hostId/grants` contract without modifying Cloud Auth, Mobile,
Relay Worker, local Tailscale pairing, Remote Gateway routes, or Harness.

It validates complete snapshots (account/Host identity, revision, validity
window, known Remote V1 scopes, explicit Mobile grant rows, status, policy
ceiling), drops malformed/replayed evidence, denies wrong owner/device/scope,
and models bounded TTL and replacement on Portal scope changes.

The adapter is **not wired to live request admission yet**, intentionally:
neither HTTP headers nor the existing Relay V1 `request` frame prove the
requesting Mobile's Cloud device identity. Merely setting `mobileDeviceId`
on a client frame would be spoofable. In particular, a Cloud Relay transport
ticket is *not* a business credential; the current Cloud Relay connector
returns `CLOUD_GRANT_REQUIRED` until this is solved.

## 2026-10-31 native IPC implementation (PR #443)

- Electron native Cloud Account now requests `GET /v1/hosts/{hostId}/grants`
  using its encrypted Cloud Session and Chromium `net.fetch`, requiring
  a signed-in configured Host and binding the response to its recorded Host
  and account. Concurrent logout/re-auth discards a superseded response.
- Private Electron-spawned Backend child IPC channel
  `mira:cloud-host-grant:snapshot:v1` sends only a bounded JSON snapshot,
  never the Cloud Session or Relay ticket. It explicitly rejects malformed
  envelopes, duplicate request IDs, expired waits and canceled work. Backend
  consumer intentionally returns **untrusted** JSON until bound by the current
  local Host owner and checked with `parseCloudHostGrantSnapshot`.
- The existing grant evaluator now pins its local owner binding; rejects
  impossible calendar dates and equal-revision policy changes; allows a
  verified grant holder to read the canonical manifest while continuing to
  reject Cloud push pairing bootstrap.
- Native, backend IPC and grant evaluator regression checks are part of the
  fast test gate. **No active Gateway or Harness request is enabled by this PR.**

Remaining: the Backend must bind the native snapshot to the authenticated
active local Host owner, implement bounded sync/invalidations, and enforce
the current Relay-service-attested per-request Mobile identity at canonical
routes and exact-call Harness. Cloud Relay's `dev` now stamps
`relayProvenance` after REL-001 PR #21. DSK-007 must never replace that
attestation with Client-controlled HTTP headers.

## 2026-10-31 official Relay provenance consumption (Desktop PR #446)

REL-001 [PR #21](https://github.com/uichat-mira/uichat-mira-relay/pull/21)
merged to Relay `dev` as `f33129b81583e566f873bae457ba0de5cf2fcd03`. Cloud-only
WebSocket admission persists the verified Client account/device/room binding and
authoritatively overwrites the Client's top-level `relayProvenance` in Host
`request` and `cancel` frames. Desktop now has a strict, room- and
connection-scoped parser for these fields. Invalid/missing proof fails closed;
Legacy transport does not acquire Cloud caller identity. This verifies the
**ingress protocol shape**, not a business permission or local owner binding.

**Cloud business requests still return `CLOUD_GRANT_REQUIRED`.** The
`CloudHostGrantIpcClient` is not yet bound to an authenticated local Desktop
user or the Remote V1/Harness route execution context. Do not infer a local
owner from a Cloud account or a request header. Grant freshness, per-route
scope and exact-call Harness checks must be proved before enabling execution.

## Required second-slice trusted producer and consumer (same DSK-007 card)

1. **Implemented in PR #443:** The Electron main process retrieves the runtime grant snapshot from
   Cloud Auth over authenticated TLS using its encrypted Desktop Cloud Session.
   Extend a **private Electron child IPC**, never renderer HTTP, with exact
   account/Host binding, no Cloud Session/raw token leakage and bounded updates.
2. The Backend must bind the snapshot to the correct active Desktop-local
   owner, never equating Cloud identity to an arbitrary local user. Signed-out,
   revoked, corrupt, expired or unavailable proof fails closed.
3. **Before enabling Cloud requests**, establish a verified per-request Mobile
   device identity from the official Relay admission/forwarding contract.
   Existing `server/src/remote-relay/protocol.ts` currently has no trusted
   Mobile identity on `RelayRequestFrame`. This requires verification against
   REL-001's actual service-authenticated forwarding behavior. No caller-
   supplied `Authorization`, `mobileDeviceId` or room/role string may bypass
   it. Do not alter REL-001 within DSK-007.
4. Only after the ingress identity is verified should the canonical
   Remote Gateway route/SSE/Harness chain consume the effective grant, with
   current local scope/owner checks still applied. Existing `mira_device_*`
   + no-cloud Tailscale remain separate.
5. Run T2 route/Harness negative-path and T3 Node backend + native IPC tests,
   then real Cloud/Relay/Mobile T4 under OPS-005. Unit tests alone are not
   integration acceptance.

## Historical Relay identity gap (2026-10-29, resolved in Relay PR #21)

- `uichat-mira-relay/src/cloud-relay-verifier.ts` derives a trusted
  `CloudRelayTicketIdentity` with `accountId`, `deviceId`, `room` and
  `role` from the Cloud Auth-signed ticket.
- `src/cloud-room-admission.ts` currently awaits
  `verifyCloudTicket(...)` but **discards its returned identity**.
  `src/room-state.ts` stores no attested account or device identity.
- `src/room-forwarding.ts` sends `{ ...frame, requestId: ... }` to the
  Host, so extra client-provided request fields cannot be treated as a
  server assertion. The Desktop `RelayRequestFrame` has no trusted Mobile
  identity field.

The **Relay owner (REL-001), not DSK-007**, must first define and verify a
service-stamped per-request identity contract. Its source must be the
verified Client WebSocket admission, never a Client `request` field.
The Relay must remove/overwrite spoofed identity fields; preserve isolation
between multiple Mobile sockets sharing a room; and verify host replacement,
cancel, disconnect, and Legacy separation in the real Worker/DO runtime.

Only then may DSK-007's Cloud-only ingress adapter accept that assertion
from the explicitly configured authenticated official Relay transport,
intersect the matching Mobile's current effective Host Grant with the
active Desktop-local owner, and preserve Gateway/Harness exact-call checks.
Until that cross-repo contract and T2/T3 tests exist,
`CLOUD_GRANT_REQUIRED` must remain the only Cloud business response.

## Revision-watermark regression (2026-10-29)

The grant cache now retains the highest accepted Host grant revision after
a malformed response or rollback attempt clears the usable snapshot.
Repeated stale snapshots cannot resurrect an older scope. The explicit
`clear()` API resets the cache watermark; wiring it to native logout and
local-owner teardown is still pending. This is T1 hardening only; it does
not assert that Native IPC or Relay ingress exists.

## Evidence boundary

The included Vitest tests are **T1 only**; no T2/T3/T4, real sign-in,
Gateway invocation, live revocation, Relay connection or production use has
been claimed. No branch promotion is authorized.
