# Mira Remote Relay

Transport-only Cloudflare Relay POC for Mira Remote Host V1.

## Boundary

This service is not Mira Cloud Backend. It does not run models, read Desktop databases, interpret Remote Host business routes, or authorize `mira_device_*` scopes.

It only owns:

- Relay room addressing
- Host / Client WebSocket registration
- Relay connection-token verification
- `request / response / chunk / complete / cancel / error` forwarding

Business authorization stays on Mira Desktop.

## Cloudflare shape

```text
Worker
  -> /health
  -> /v1/relay/:relayId/socket
       -> SQLite-backed Durable Object
       -> Hibernation WebSockets
```

Each `relayId` maps to one Durable Object room. A room accepts one active Desktop Host and multiple Clients.

The room persists only SHA-256 hashes of the Host and Client relay tokens. Request and response bodies are never written to Durable Object storage.

## POC deploy

This directory is intentionally excluded from the root pnpm workspace so the existing application lockfile does not gain Cloudflare deployment-only dependencies.

Use a compatible Wrangler installation from this directory:

```bash
wrangler deploy
```

`wrangler.jsonc` declares a SQLite-backed Durable Object migration (`RelayRoom`).

After deploy, verify:

```bash
curl https://<worker-host>/health
```

Expected shape:

```json
{
  "ok": true,
  "service": "mira-remote-relay",
  "protocolVersion": 1
}
```

## Desktop integration status

DSK-017 retired the Desktop's legacy paired/self-hosted Relay. Mira Desktop no
longer reads `UI_CHAT_REMOTE_RELAY_*`, generates room identity/tokens, or starts
a connector for this service. Official Cloud Relay uses its own account ticket,
Host Grant and shared frame protocol instead.

This standalone Worker remains in the repository as historical protocol source
only. Deploying it does not connect a current Desktop Host.

## Frame contract

All frames are JSON and carry `version: 1`.

Client to Host:

```text
request
cancel
```

Host to Client:

```text
response
chunk
complete
error
```

The Relay rewrites request IDs internally to bind replies to the originating client connection, then restores the client's original request ID on the way back.

## POC limits

- Max Relay JSON frame: 2 MiB characters.
- Max active requests per Client connection: 32.
- Desktop request body limit: 1 MiB decoded.
- Desktop cumulative response limit: 16 MiB.
- Desktop streaming chunk size: 48 KiB before base64 encoding.

These limits intentionally keep Relay V1 out of large-file transfer territory.

## Security notes

- Desktop always connects outbound; no public Desktop bind is introduced.
- Desktop maps Relay requests only to the existing localhost Mira backend.
- Transport-level Host / Forwarded / proxy headers are stripped before local forwarding.
- Mira `Authorization` is forwarded so the existing Desktop device-token scope checks remain authoritative.
- This POC does not yet include account-level public Relay abuse control or quotas. Do not expose it as a shared public production service before that layer is designed.

## Verification

Repository-level verification target:

```bash
pnpm check
pnpm --filter @ui-chat-mira/server test -- remote-relay-connector.service.test.ts
```

Cloudflare smoke remains separate because it requires a deployed Worker endpoint.
