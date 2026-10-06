# Mira Push Broker

Independent Mira-owned Push Broker foundation for MOB-056C.

## Boundary

This service is intentionally separate from `packages/remote-relay`.
Remote Relay stays transport-only; the Push Broker owns installation identity,
Host authorization, event ingest, durable broker state, and later provider delivery.

#267 currently owns:

- Mobile installation registration, refresh and revoke.
- Ed25519 installation proof-of-possession.
- Mobile-signed Host binding approval, rotation and revoke.
- Opaque installation/Host-scoped delivery capabilities.
- Host event signature verification plus `sourceScope` enforcement.
- `(installationId, eventId)` broker dedupe.
- AES-256-GCM encryption of raw provider tokens at rest.

FCM/APNs dispatch belongs to #269. Host canonical outbox/eligibility belongs to #268.

## Security contract

- Installation and Host public keys are raw 32-byte Ed25519 keys encoded as base64url.
- Signatures are 64-byte Ed25519 signatures encoded as base64url.
- Raw provider tokens are encrypted before Durable Object SQLite persistence.
- `BROKER_STORAGE_KEY` is a 32-byte base64url Worker secret and is never committed.
- Delivery tokens are random 256-bit bearer capabilities; only SHA-256 hashes persist.
- Relay credentials and `mira_device_*` are never accepted as Broker authorization.
- Event bodies use a strict identity-only allowlist; Assistant text, prompts and tool output are rejected.

## API

All mutation endpoints use POST:

- `/v1/installations/:installationId/register`
- `/v1/installations/:installationId/refresh`
- `/v1/installations/:installationId/revoke`
- `/v1/installations/:installationId/bindings/approve`
- `/v1/installations/:installationId/bindings/revoke`
- `/v1/installations/:installationId/events`

Event ingest requires `Authorization: Bearer <deliveryToken>`.

Signature payloads use `canonicalJson()` from `src/contracts.ts`: object keys sort
lexicographically; arrays keep order; binding source scopes normalize to sorted unique values.

## Runtime shape

Worker `/health` and `/v1/installations/:id/*` routes dispatch to one SQLite-backed
Durable Object per installation. This keeps registration/binding/event state strongly
consistent and separate from Remote Relay storage.

## Verification

- `pnpm check:push-broker`
- `pnpm test:push-broker`

A deployed Worker smoke is separate from repository T1/T2 evidence.
