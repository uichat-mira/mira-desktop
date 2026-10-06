---
status: current
owner: remote-runtime
last_verified: 2026-10-06
layer: runtime
module: RemoteAccess
feature: HostNotificationOutboxV1
doc_type: current-contract
canonical: true
related:
  - push-broker-v1.md
  - mobile-host-protocol-v1.md
---

# Host Notification Outbox V1

#268 implements the Desktop Host half of Mira background notification delivery.

## Canonical trigger

The only trigger is a canonical Assistant-message transition:

- absent -> user-visible final (ordinary Chat/RAG);
- placeholder/running -> user-visible final (Agent/resume).

`waiting_approval`, `waiting_user`, blocked/failed/cancelled Agent snapshots,
`run.completed`, token deltas, SSE close, tool events and repeated final updates
do not create notification events.

`server/src/services/notification-eligibility.ts` is the single predicate.

## Atomic persistence

`threadService.createMessage()` commits the canonical message mutation and
`notification_outbox` insert in the same better-sqlite3 transaction.

The outbox unique key is:

`(installation_id, canonical_message_id, eligibility_event)`

where v1 eligibilityEvent is `final_transition_first_seen`.

The active binding snapshot for that transition is read through the same process-wide
`getSqlite()` handle while the canonical transaction is open. This is the v1
single-process authority model; another connection's uncommitted binding changes
are intentionally not part of that transition snapshot.

If outbox evaluation/insertion fails, the canonical Assistant mutation rolls back.

Branch-tail database deletion, canonical mutation, outbox enqueue, and any required
filesystem/media cleanup journal entry are committed in the same SQLite transaction.
This is the authoritative atomic boundary. Filesystem/media deletion cannot share a
SQLite rollback boundary and is therefore an explicit durable eventual side effect,
not claimed as atomic. The request path only schedules an asynchronous microtask
after commit; it never drains cleanup work inline. Actual cleanup runs from
`canonical_message_cleanup_jobs`, with the Server lifecycle worker as recovery owner.
Failures record `attempt_count`, `next_attempt_at`, and `last_error`; exhausted
jobs remain durably in `failed` state and are surfaced in Server error logs on
failure and again at startup until operators resolve the backlog.

Outbox rows contain identities/status only; Assistant text, prompt and tool output
are not columns in the table or fields in the Broker event.

## Host identity and binding

- Host owns one stable Ed25519 identity (`hostId` + keypair).
- Private key is encrypted with the existing Host secret-encryption boundary.
- Public identity records never expose the decrypted private key. Signing decrypts
  the key only inside one repository-owned one-shot signer, creates the Node key
  object, signs, and releases the plaintext reference immediately afterward. This
  is an at-rest + bounded-plaintext software boundary, not an HSM/secure-enclave
  claim and not guaranteed memory zeroization.
- A paired Mobile requests a one-time binding descriptor over the authenticated
  Remote Host channel.
- Descriptor covers `hostId`, `hostPublicKey`, target `installationId`,
  `sourceScope`, nonce and short TTL and carries a Host signature.
- Broker authorization is still Mobile installation approval from #267; the
  paired-device credential is never treated as Broker authorization.
- Mobile returns only Broker-issued delivery capability data. The Broker base URL
  is Host-controlled via `MIRA_PUSH_BROKER_URL`, preventing a paired device from
  turning the delivery worker into an arbitrary network client.
- Binding nonce is persisted, one-time and TTL-bound.
- Every binding request and active binding records the originating paired-device id
  and owner user. A device may have only one outstanding descriptor and one active
  installation binding; rebind revokes its previous installation binding.
- Revoking the paired device revokes all Push bindings originating from that device
  in the same Host lifecycle transaction.
- Source scopes are normalized into an indexed relation table; canonical writes do
  not scan every active binding.

Remote bootstrap routes:

- `POST /remote/v1/push/binding-descriptor`
- `POST /remote/v1/push/bindings/accept`

Both require an already paired device. Requested source IDs must resolve to
Threads owned by the paired device's owner user.

## Delivery and recovery

The Host worker starts with Mira Server and drains pending durable outbox rows.

- Broker event uses #267 identity-only event shape and stable outbox `id` as eventId.
- Before each Broker POST, Host re-reads the canonical message and owning thread,
  verifies the owning user still matches the binding, and verifies the originating
  paired device is still active. Missing/deleted/non-final canonical state,
  archived/reassigned threads, or stale source authority expire the outbox row
  without network delivery. A revoked or otherwise unavailable binding marks the
  outbox row failed instead of expired.
- `canonical_message_id` is deliberately not an FK to `messages`: deleting a
  canonical message cannot silently erase durable outbox history; the worker marks
  that retained row expired explicitly.
- The Broker URL is resolved from the current `MIRA_PUSH_BROKER_URL` for every
  delivery attempt. The stored binding URL is not network authority.
- Host signs every event with its Ed25519 private key.
- 2xx => delivered.
- authorization/contract 4xx => final failure.
- transport errors, 408/425/429 and 5xx => bounded retry.
- TTL expiry stops retry.
- If Broker accepts but Host crashes before marking delivered, restart may resend
  the same eventId; Broker dedupe makes that recovery safe.

FCM/APNs provider dispatch remains #269. Mobile notification presentation remains
`mira-mobile#208`.
