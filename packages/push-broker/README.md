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

#269 owns provider dispatch. The Broker now maps accepted events to user-visible
FCM/APNs alerts, persists provider outcomes, and retries with bounded TTL. Host
canonical outbox/eligibility belongs to #268.

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


## Provider delivery (#269)

The provider layer sends a generic alert only:

- title: `Mira`
- body: `Mira 有新回复`
- identity metadata: schema version, event type, installation, event, source and
  canonical message IDs, plus the frozen eligibility event.
- Assistant text, prompts and tool output are never accepted by event ingest and
  never enter provider payloads.

Android uses FCM HTTP v1 and the existing `mira_messages` notification channel.
iOS uses APNs token authentication with `apns-push-type: alert` and maps the
event expiration to `apns-expiration`.

Provider success means the provider accepted the request. It does **not** mean
the OS displayed the notification. Permission, channel and DND suppression are
not Broker failures and never trigger Broker retry.

Durable delivery state lives in the installation Durable Object. Retryable
transport/credential failures use bounded backoff and the event TTL. Invalid
device/provider tokens move pending events to `waiting_token_refresh`; a
signed Mobile `/refresh` request reactivates still-unexpired events.

### Worker secret/config boundary

Set these values through Worker secrets/configuration; never commit their values:

- `BROKER_STORAGE_KEY`
- Android: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`
- iOS: `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`,
  `APNS_TOPIC`, and `APNS_ENVIRONMENT=production|sandbox`

Raw FCM/APNs device tokens remain encrypted at rest and are decrypted only inside
the installation Durable Object for dispatch. Delivery audit rows contain only
provider name, attempt number, normalized outcome/error code, HTTP status and
provider request ID.
