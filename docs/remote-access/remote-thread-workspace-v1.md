---
title: Remote Thread Workspace V1
status: current
doc_type: current-contract
canonical: true
owner: runtime
last_verified: 2026-11-25
layer: architecture
module: Remote Access
feature: RemoteThreadWorkspace
related:
  - desktop-mcp-server-v1.md
  - relay-transport-v1.md
  - ../AGENT_CURRENT_TRUTH.md
---

# Remote Thread Workspace V1

## 1. Purpose and scope

This contract defines how an official Mira Cloud MCP caller gets a stable
Desktop-side workspace for one real remote thread, and how that thread is
explicitly ended.

It applies only to the official Cloud MCP outlet:

```text
Official Cloud Host Grant
  └─ POST /mcp
       └─ tools/call with X-Mira-Thread-Id
            └─ existing Harness Tool Core
                 └─ lazy per-thread workspace
```

Direct paired-device MCP and the existing Remote V1 tool stream keep their
pre-existing Desktop-selected workspace behavior. They do not consume this
thread workspace contract and do not implicitly depend on a Mira ID.

This document does not create a second scheduler, a workspace manager UI, a
cross-thread workspace pool, or a sandbox boundary.

## 2. Trusted thread identity

The client supplies only the thread resource id:

```http
POST /mcp
X-Mira-Thread-Id: <desktop thread id>
```

Rules:

- The header is read only when the request has a verified official Cloud Host
  Grant (`request.cloudRemoteCaller`). A Direct request cannot opt into the
  cloud thread contract by sending the header.
- `accountId`, `hostId`, and `mobileDeviceId` always come from the trusted
  Cloud grant authority. They are never read from the request body or a
  client-supplied account/Host header.
- The thread must belong to the authenticated local owner. An unknown, deleted,
  or differently owned thread behaves as `thread_not_found`.
- A workspace-bound `tools/call` without thread context is rejected with
  `thread_context_required`. Discovery, `initialize`, `ping`, non-workspace
  tools, and unknown tools do not require a thread.
- Remote V1 approval must send the same thread context. The original invocation
  remains authoritative, so a replayed approval cannot switch thread, account,
  Host, or device.

## 3. Lazy lifecycle

| State | Meaning | Directory |
| --- | --- | --- |
| `not_started` | No workspace-bound execution has been allowed yet. | Absent |
| `active` | The first allowed workspace-bound call created the binding. | Present |
| `ended` | The thread was explicitly ended. Files are retained. | Present unless the user removed them |

Creation boundary:

1. The tool name resolves through the existing Remote MCP catalog.
2. Arguments pass the existing Tool schema validation.
3. The existing approval decision for the exact invocation is `allow`.
4. Only then does Desktop create the private workspace and persist the binding.

Therefore the following never create a workspace:

- `initialize`, `ping`, `tools/list`, `resources/list`, `resources/read`;
- ordinary chat that performs no workspace-bound Tool call;
- non-workspace tools;
- unknown or denied tools;
- schema-invalid calls;
- `awaiting_approval` tool calls;
- rejected approvals.

Concurrent first calls for one thread converge on one binding and one
directory. A binding row is keyed by the Desktop thread id and is created with
`insert-or-read`; a second caller receives the existing target after the same
trusted identity check.

## 4. Stable target

The first activation chooses the target in this order:

1. the explicit ChatWorkspace already bound to the Desktop thread, if present;
2. otherwise the existing private agent workspace for `(userId, threadId)`
   under app data.

The chosen kind and root are stored in `remote_thread_workspaces`. Later local
Desktop project selection does not change the target. If the thread's explicit
workspace binding changes after an approval request has already frozen a target,
the approval fails closed with `workspace_changed` instead of executing against
the new location.

File tools and Terminal use the same root because the existing Harness
environment workspace is set to the resolved thread root for the whole
invocation. Terminal sessions created from that invocation also carry the
thread/owner identity, so another thread cannot attach, observe, stop, or reuse
them.

Existing path validation, approval, and Terminal process-tree cleanup remain in
force. This contract does not add an escape from the current workspace root and
does not claim a physical sandbox.

## 5. Discovery projection

```http
GET /remote/v1/threads/:threadId/workspace
```

Required scope: `tools:read`. Official Cloud caller only.

Response:

```json
{
  "threadId": "thread-1",
  "status": "not_started",
  "workspace": null,
  "startedAt": null,
  "endedAt": null
}
```

When active or ended with a workspace:

```json
{
  "threadId": "thread-1",
  "status": "active",
  "workspace": {
    "ref": "mira-thread-workspace:thread-1",
    "kind": "private",
    "available": true,
    "startedAt": "2026-11-25 00:00:00"
  },
  "startedAt": "2026-11-25 00:00:00",
  "endedAt": null
}
```

`ref` is an opaque locator. The absolute Desktop path is not exposed through
the remote protocol; Desktop resolves the same thread id through its existing
workspace/file entry points. `kind` is `private` or `chat`. `available` reports
whether the retained directory currently exists.

## 6. Explicit end

```http
POST /remote/v1/threads/:threadId/end
```

Required scope: `tools:control`. Official Cloud caller only.

Behavior:

- marks the authoritative binding `ended` before tearing down work, so a racing
  new call for the thread is rejected;
- aborts in-flight official Cloud MCP invocations owned by that thread;
- stops persistent Terminal sessions owned by that thread/owner;
- leaves files and the private workspace directory intact;
- never stops tasks from another thread or another owner;
- is idempotent: ending an already ended thread returns `ended` again and repeats
  the cleanup safely;
- ending a thread that never started records an `ended` tombstone with
  `workspace: null` and creates no directory.

The response extends the discovery projection:

```json
{
  "threadId": "thread-1",
  "status": "ended",
  "workspace": {
    "ref": "mira-thread-workspace:thread-1",
    "kind": "private",
    "available": true,
    "startedAt": "2026-11-25 00:00:00"
  },
  "startedAt": "2026-11-25 00:00:00",
  "endedAt": "2026-11-25 00:00:10",
  "stoppedInvocations": 1,
  "stoppedTerminalSessions": 1
}
```

### Not thread end

The following are not explicit end and must not call the end endpoint:

- finishing one chat turn;
- closing the Mobile app or backgrounding it;
- a transport disconnect or Relay reconnect;
- a short network outage;
- closing the Desktop app.

They interrupt transport, not the thread lifecycle. After reconnect, the same
thread remains `active` with the same target. If an end request cannot be
confirmed, the remote client must present the thread as not confirmed ended and
retry; it must not claim the thread ended locally.

## 7. Rejection and error contract

HTTP routes use the normal response envelope and these stable codes. MCP
`tools/call` uses JSON-RPC error `-32010` with `data.code` equal to the same
value.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `thread_context_invalid` | 400 | `X-Mira-Thread-Id` is malformed. |
| `thread_context_required` | 400 | A Cloud MCP workspace-bound call/approval lacks thread context. |
| `thread_not_found` | 404 | Thread is unknown, not owned by the caller, or bound to another account/Host/device. |
| `thread_ended` | 409 | The thread was explicitly ended; new execution or approval is refused. |
| `workspace_unavailable` | 409 | The frozen target directory or explicit ChatWorkspace is unavailable. |
| `workspace_changed` | 409 | A pending approval was frozen to a different target than the current thread target. |

Identity mismatch deliberately returns `thread_not_found` so one account/device
cannot probe another binding.

## 8. Cross-repository handoff

`uichat-mira/mira-mobile` MOB-106 consumes this contract:

- send `X-Mira-Thread-Id` on official Cloud MCP `tools/call`;
- send the same header on the existing Remote V1 approval/cancel calls;
- use `GET /remote/v1/threads/:threadId/workspace` for real state instead of
  inventing a directory;
- use `POST /remote/v1/threads/:threadId/end` only for explicit thread end;
- treat disconnect, backgrounding, app close, and single-turn completion as
  transport events, not end;
- retry end idempotently and keep local state unconfirmed when the Host cannot
  confirm.

## 9. Non-goals

- no cross-thread workspace reuse;
- no default-space escape or new filesystem permission;
- no physical sandbox claim;
- no automatic deletion of results;
- no complex workspace management UI;
- no new Relay protocol or Relay repository change;
- no change to Direct pairing, Direct tool execution, or local Desktop tasks.
