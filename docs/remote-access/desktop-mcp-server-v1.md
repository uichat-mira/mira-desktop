---
title: Mira Desktop MCP Server V1
status: current
doc_type: current-contract
canonical: true
owner: runtime
last_verified: 2026-11-24
layer: architecture
module: Remote Access
feature: DesktopMCP
related:
  - mobile-host-protocol-v1.md
  - relay-transport-v1.md
  - remote-thread-workspace-v1.md
  - ../TOOL_CURRENT_TRUTH.md
---

# Mira Desktop MCP Server V1

## 1. Purpose and decision

This is the canonical Desktop-side contract for exposing the existing Tool
Core/Harness capability surface to authorized Mobile clients through a standard
MCP Server.

It implements the Desktop B1 outlet under the maintainer decision D11 in
[`uichat-mira/mira-mobile@dev:docs/mobile-0.4.0-product-decisions-and-research.md`](https://github.com/uichat-mira/mira-mobile/blob/dev/docs/mobile-0.4.0-product-decisions-and-research.md)
and the Phase 3 product boundary in
[#315](https://github.com/uichat-mira/mira-desktop/issues/315).

This is one protocol outlet over the existing execution authority. It is not a
second Tool Registry, execution engine, permission model, or remote identity
system. Remote V1 continues to own device/Cloud admission, Thread/Message,
Agent Run, exact-call approval recovery, and Artifact access.

```text
Tailscale Direct device credential ─┐
Official Cloud Host Grant ──────────┼─> POST /mcp
                                    │     tools/list / tools/call
                                    │     resources/list / resources/read
                                    ▼
                         existing Remote tool catalog
                         (core admission + readiness)
                                    ▼
                    existing Harness Policy / Approval / invocation
```

There is no separate public listener, no Desktop-JWT-only MCP access, and no
legacy paired Relay fallback.

## 2. One service instance identity

| Field | Value |
| --- | --- |
| Stable service id | `mira-desktop` |
| MCP `serverInfo.name` | `mira-desktop` |
| Capability resource URI | `mira://service/mira-desktop/capabilities` |
| Capability schema | `mira.service-capabilities/v1` |
| Capability manifest version | `1.0.0` |
| Negotiated MCP protocol | `2025-06-18` |

The same service identity is returned through Tailscale Direct and the official
Cloud Relay. Transport provenance does not create a second service id or a
second tool catalog.

`serverInfo.version` and the manifest `service.mcp.serverVersion` use the
current Desktop application version. They are not a separate MCP product
version.

## 3. Protocol surface

Endpoint:

```http
POST /mcp
Authorization: Bearer <remote credential>
Content-Type: application/json
Accept: application/json, text/event-stream
```

Implemented JSON-RPC methods:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- notifications, including `notifications/initialized`, return HTTP `202` with
  no response body

The server is stateless over HTTP. It does not issue `Mcp-Session-Id`, does not
open a GET SSE stream, and does not implement a DELETE session endpoint. A
successful request returns one `application/json` JSON-RPC response. Clients
must not claim SSE stream support against this slice.

The requested protocol version is echoed only when it is supported; otherwise
the server returns `2025-06-18`. Requests carrying an unsupported
`MCP-Protocol-Version` header receive HTTP `400`.

The request body is bounded to 1 MiB.

## 4. Eligibility is the shared core admission projection

MCP and Remote V1 both consume `resolveRemoteToolCatalog()` from
`server/src/services/remote-tool-gateway.service.ts`. The catalog is built from:

1. the initialized Harness registry;
2. the authored **core** capability profiles that also define the Desktop
   capability surface's `核心` groups;
3. the existing `agent_intent` exposure with `editFacade: "all"` for runtime
   readiness, sandbox availability, and legacy-alias blocking;
4. the existing exact Tool Core ids, descriptions, and `inputSchema` values.

Core is a property of authored Harness capability profiles
(`server/src/harness/profiles/resolver.ts`), not a second MCP-only allowlist.
The current core profiles are:

| Core capability | Tools |
| --- | --- |
| `workspace_lookup` | `glob`, `grep`, `list`, `read` |
| `workspace_edit` | `write`, `edit`, `move`, `delete`, `apply_patch` |
| `web` | `web_search`, `web_fetch` |
| `browser` | `browser_navigate`, `browser_snapshot`, `browser_screenshot`, `browser_click`, `browser_fill`, `browser_press_key`, `browser_select_option`, `browser_scroll`, `browser_wait_for`, `browser_assert`, `browser_tabs_list`, `browser_tab_select` |
| `terminal_execution` | `terminal` |

Only Tools that are both in a core profile and currently registered create this
projection. Acceptance placeholders are not core Tools. A registered Tool that
is outside these profiles (for example GitHub, Mail, News, External Expert,
Attached Browser, CodeGraph, or an external MCP capability) does not become
remotely available merely because it was registered or granted Agent access.

The same core mark is projected as `coreCapability` on
`GET /mcp/tools`, which is what the Desktop capability page uses to label a
group `核心`. The page may still show an acceptance-case placeholder for an
unregistered Tool, but that placeholder is not core and cannot enter the MCP
catalog.

A core Tool is not excluded by a second product filter. If it is registered,
authorized, and ready, it appears in `tools/list`. If readiness blocks it, the
exact reason is available through `describeRemoteToolAdmission()` in
`remote-tool-gateway.service.ts`; the Tool stays absent from `tools/list` rather
than being advertised as callable.

`tools/list` exposes the exact eligible Tool Core ids, descriptions, and
`inputSchema` values from that projection. Name aliases are deterministic and
collision-checked; a collision fails closed instead of binding one MCP name to a
different tool. `tools/call` resolves the alias back to the canonical id and the
existing invocation path revalidates the same core availability.

Ungrouped Tools inside the core scope remain real `tools/list` entries. They are
not invented into a semantic capability group.

### UI marking and runtime authority

The capability page's `核心` marking and the remote catalog read the same core
projection. That mark is product admission scope only:

- it is not execution authority, a scope grant, or a readiness override;
- Policy, exact-call approval, workspace boundaries, runtime readiness, device
  identity, and Cloud Host Grant enforcement remain authoritative;
- Direct and official Relay use the same service identity and the same catalog.

## 5. Optional semantic capability resource

`resources/list` advertises
`mira://service/mira-desktop/capabilities` only when at least one authored
semantic capability group exists in the current eligible catalog.

`resources/read` returns JSON with the following stable envelope:

```json
{
  "schema": "mira.service-capabilities/v1",
  "version": "1.0.0",
  "service": {
    "id": "mira-desktop",
    "name": "Mira Desktop",
    "description": "...",
    "documentation": "https://github.com/uichat-mira/mira-desktop/blob/dev/docs/remote-access/desktop-mcp-server-v1.md",
    "mcp": {
      "serverName": "mira-desktop",
      "serverVersion": "<desktop application version>",
      "sdk": "mira-desktop/fastify-jsonrpc@1",
      "protocolVersions": ["2025-06-18"]
    }
  },
  "capabilities": [
    {
      "id": "mira-desktop.workspace_lookup",
      "title": "Workspace Lookup",
      "description": "...",
      "access": "read",
      "requiredScopes": ["tools:read", "tools:invoke"],
      "confirmation": "none",
      "tools": ["glob", "grep", "list", "read"]
    }
  ],
  "fallback": {
    "unknownSchema": "...",
    "unclassifiedTools": "..."
  }
}
```

Capability groups come only from authored Harness capability profiles. Their
`tools` values reference names that are also present in the same authorized
`tools/list`; there are no fabricated groups or schemas. One-to-one fallback
profiles are not published as product capabilities.

The resource is discovery metadata only:

- `access` and `confirmation` are conservative hints, not permissions;
- `requiredScopes` is a requirement, not a grant;
- readiness and the live `tools/list` remain authoritative for current
  availability;
- missing, unknown-version, or unclassified resources degrade to the real flat
  `tools/list`.

## 6. Authentication, scopes, and transport binding

| Operation | Required authority |
| --- | --- |
| `POST /mcp` | valid paired Direct device token, or official Cloud Host Grant |
| `initialize`, `ping`, `tools/list`, `resources/*` | `tools:read` |
| `tools/call` | `tools:read` + `tools:invoke` |
| approval of a pending call | existing Remote V1 route, `tools:approve` |
| cancellation of a pending/running call | existing Remote V1 route, `tools:control` |

Direct requests use the existing `mira_device_<deviceId>.<secret>` credential.
The existing DSK-018 rule remains: Direct is denied while this Desktop is signed
in to Mira Cloud.

Official Cloud requests use the existing native Cloud ticket/Host Grant and the
Backend-issued one-shot internal capability. Relay requests never forward a
Desktop JWT or a paired-device credential as their business authority. Direct
and Cloud credentials are never interchangeable.

### Direct example

```bash
curl -sS https://<desktop-tailnet-host>/mcp \
  -H 'Authorization: Bearer mira_device_<id>.<secret>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mira-mobile","version":"1"}}}'
```

```bash
curl -sS https://<desktop-tailnet-host>/mcp \
  -H 'Authorization: Bearer mira_device_<id>.<secret>' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

```bash
curl -sS https://<desktop-tailnet-host>/mcp \
  -H 'Authorization: Bearer mira_device_<id>.<secret>' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read","arguments":{"path":"README.md"}}}'
```

### Official Cloud example

Mobile uses the official Relay endpoint/connection it already has. The Desktop
receives the Relay request and creates its own short-lived internal authority;
the Mobile never supplies the `x-mira-cloud-internal-request` header. The
JSON-RPC body and `/mcp` path are unchanged.

Do not send a Direct header through Cloud or a Cloud capability to Tailscale.
The transport admission layer rejects that interchange.

### Cloud thread workspace context

Official Cloud MCP `tools/call` for a workspace-bound Tool
(`read`, `write`, `edit`, `terminal`, and the other core workspace Tools) must
send:

```http
X-Mira-Thread-Id: <desktop thread id>
```

The account, Host, and device identity are taken from the verified Cloud Host
Grant, never from this header. The first allowed workspace-bound call lazily
creates one stable per-thread workspace; discovery, awaiting approval, and
rejected calls do not. Direct callers keep their previous selected-workspace
behavior and do not consume this contract.

Approval resumes the exact original thread target and identity. Explicit thread
end uses the Remote V1 routes described in
[`remote-thread-workspace-v1.md`](remote-thread-workspace-v1.md):

```http
GET  /remote/v1/threads/<threadId>/workspace
POST /remote/v1/threads/<threadId>/end
```

Transport disconnect, one-turn completion, backgrounding, and app close are not
thread end.

## 7. Result and approval recovery semantics

The MCP result `content` is the existing bounded Harness LLM projection text.
`structuredContent` carries the invocation projection:

- `completed`: `{ invocationId, toolId, status: "completed" }`, `isError: false`;
- `awaiting_approval`: `isError: true` plus
  `{ invocationId, toolId, status: "awaiting_approval", approval }`;
- `failed` / `cancelled`: `isError: true` plus the bounded error projection.

Cloud thread lifecycle failures are returned as JSON-RPC error `-32010` with a
stable `data.code` (`thread_context_required`, `thread_not_found`,
`thread_ended`, `workspace_unavailable`, or `workspace_changed`). See the
thread workspace contract for the full table.

An awaiting result is not retried automatically. The client resolves the
original exact invocation through the existing Remote V1 route:

```http
POST /remote/v1/tool-invocations/<invocationId>/approval
```

The existing binding remains authoritative: same owner, same `toolId`, and the
same argument `inputHash`; changed arguments invalidate the approval. This MCP
slice adds no approval bypass and no second approval token.

Cancellation uses the existing Remote V1 route:

```http
POST /remote/v1/tool-invocations/<invocationId>/cancel
```

Closing/cancelling the transport also aborts the in-flight MCP call through the
existing invocation `AbortSignal`. A separate MCP-level cancellation state
machine is not implemented.

## 8. Transport matrix and current gaps

| Transport | `/mcp` support | Evidence / gap |
| --- | --- | --- |
| Tailscale Direct | HTTPS POST JSON-RPC, 1 MiB request bound | Real listening Fastify HTTP protocol tests plus route/auth tests. Real tailnet T4 not run in this slice. |
| Official Cloud Relay | Same POST JSON-RPC over existing Relay V1 request/response/chunk/complete | Relay frames already carry method/path/headers/body and cancellation. Real Relay forwarding of this MCP endpoint was not run in this slice. |
| GET SSE stream | Not supported | Returns no SSE stream; Mobile uses the documented stateless POST form. |
| MCP session id | Not issued | Stateless endpoint. |
| Desktop JWT only | Denied | A local JWT without a paired device or Cloud Grant is not a remote MCP caller. |

Relay limits remain those of Relay V1: 1 MiB request body and 16 MiB response
body. This slice does not claim transparent HTTP/SSE MCP proxying, stream
resumption, or durable MCP sessions. Any such requirement belongs to a separate
Relay/MCP transport contract, not this endpoint.

If the official Relay is later shown to reject or alter `application/json`
responses, `MCP-Protocol-Version`, or cancellation forwarding, record the exact
missing Relay behavior and its owner rather than changing another repository or
weakening admission here.

## 9. Remote V1 retention and removal condition

`GET /remote/v1/tools`, `POST /remote/v1/tool-invocations/stream`, approval, and
cancel routes remain supported. They continue to serve current Mobile clients
and agent workflows.

They may be removed only after a separately authorized cutover proves that the
supported Mobile consumer has moved to MCP for tool discovery/invocation and
that approval/cancellation recovery no longer depends on the Remote V1 tool
routes. Removing them before that evidence would be a consumer-breaking change.

## 10. Verification

Current regression evidence:

```bash
pnpm --dir server exec vitest run \
  src/routes/remote-mcp.test.ts \
  src/routes/remote-mcp-auth.test.ts \
  src/services/remote-tool-gateway.service.test.ts \
  src/harness/core-capability-scope.test.ts \
  src/harness/capability-profiles.test.ts \
  src/services/remote-device-auth.service.test.ts \
  src/services/cloud-host-grant-authority.service.test.ts \
  src/services/cloud-host-grant-runtime.service.test.ts \
  src/routes/remote-access.test.ts
pnpm --dir server typecheck
```

The route tests include a real listening Fastify HTTP client in addition to
in-process protocol calls. They cover initialize, real `tools/list` schema
projection, the shared core catalog, alias mapping, the optional capability
resource, a safe read-only invocation through the existing Harness chain, a
registered non-core Tool rejected before execution, missing scopes, unknown
tools, awaiting approval, notifications, and Direct/Cloud caller parity. The
core/capability tests prove authored core profiles resolve to the registered
Tool set, fallback Tools stay non-core, and an unavailable core Tool reports its
exact readiness reason instead of entering the catalog. The auth test uses a real
SQLite-backed owner/device to cover a positive local JWT, positive Direct
device, DSK-018 signed-in Direct denial, revoked-device denial, and denial of a
Desktop JWT at `/mcp`. The Cloud Grant runtime test proves a positive
`tools:read` admission for `/mcp`, cross-device denial, and revocation. Existing
Remote V1, remote-device, and Cloud Grant tests remain in the targeted suite.

Not tested in this slice:

- native packaging;
- real Tailscale device;
- real official Relay round-trip;
- real Mobile consumption;
- long-running tool/stream behavior beyond the stateless POST form.
