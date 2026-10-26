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

## Required second-slice trusted producer and consumer (same DSK-007 card)

1. The Electron main process must retrieve the runtime grant snapshot from
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

## Evidence boundary

The included Vitest tests are **T1 only**; no T2/T3/T4, real sign-in,
Gateway invocation, live revocation, Relay connection or production use has
been claimed. No branch promotion is authorized.
