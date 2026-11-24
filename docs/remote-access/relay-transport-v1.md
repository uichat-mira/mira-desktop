---
title: Mira Remote Relay Transport (PC implementation note)
status: current
doc_type: implementation-note
canonical: false
last_verified: 2026-11-24
canonical_source: uichat-mira-mobile@dev:docs/remote-access/remote-connection-canonical-v1.md
canonical_source_branch: dev
related:
  - cloud-relay-ticket-ipc-v0.md
  - relay-product-config-v1.md
  - dsk-007-cloud-grant-handoff.md
---

# Mira Remote Relay Transport

## Current truth (2026-11-24)

DSK-017 retired the Desktop's legacy paired/self-hosted Relay. Desktop now has
exactly two remote transports:

```text
Tailscale Direct   -> Mira Desktop Host (pairing + mira_device_* credential)
Official Cloud     -> Mira Cloud Relay (native Cloud account/ticket + Host Grant)
```

There is no user-configured/default/custom Relay endpoint, no persisted room or
host/client token, and no Relay-only pairing challenge. The old
`/remote/admin/relay/*` routes and `UI_CHAT_REMOTE_RELAY_*` inputs are removed.

### Tailscale Direct

- Desktop publishes its loopback Host through Tailscale Serve.
- Pairing challenges require `runtime.state === "ready"` and an access URL.
- `mira://pair?host=…&challenge=…&code=…&version=1` is the only pairing shape.
- Device credential, owner/scope, approval, poll and revocation semantics are
  unchanged.

### Official Mira Cloud Relay

- Activated only by a verified native Mira Cloud account through Electron's
  private child IPC (`mira:cloud-relay:host-ticket:v1`).
- Backend requests a fresh, short-lived Host ticket per socket generation.
- Admission, room binding and business authorization stay fail closed.
- Cloud requests require verified relay provenance and a Cloud Host Grant; a
  request without a Grant returns `CLOUD_GRANT_REQUIRED` and never reaches
  local business execution.
- `relay.tomz.io` and malformed/plaintext endpoints are rejected as
  `cloud_relay_endpoint_unavailable`; a Cloud ticket is never routed to a
  legacy Relay or to Tailscale.
- The only remaining manifest surface is `GET /remote/admin/cloud-relay/status`,
  which reports sanitized transport state and never the room, ticket, account
  or user credential.

### Shared frame engine

`server/src/remote-relay/protocol.ts` and the official Cloud connector still
implement the shared Relay V1 frame envelope (`hello`, `hello_ack`, `request`,
`response`, `chunk`, `complete`, `cancel`, `error`). Only the legacy
room-token admission and its connector instance were removed.

## Historical note

Before DSK-017, this document described a self-hosted Cloudflare Relay POC with
persisted relay identity, host/client tokens and a second Desktop connector.
That path is intentionally unsupported now. The historical text remains in git
history only; it is not a current configuration or compatibility contract.

## Verification

- `server/src/services/remote-relay-connector.service.test.ts` covers native
  ticket hello, Cloud Grant admission, cancellation, reconnect and fail-closed
  endpoint handling.
- `server/src/db/remote-relay-retirement.test.ts` covers idempotent retirement
  of the old settings table and preservation of Direct devices.
- `server/src/routes/remote-access.test.ts` proves the retired routes are gone
  and pairing requires a ready Direct URL.
- `desktop/src/features/RemoteAccess/*.test.tsx` prove the legacy UI is gone
  and pairing follows Tailscale readiness.
