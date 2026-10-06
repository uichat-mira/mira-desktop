import assert from "node:assert/strict";
import test from "node:test";

import { BrokerDeliveryWorker } from "./delivery";
import { exportBytesAsBase64Url, sealSecret } from "./crypto";
import type { EventRecord } from "./persistence";
import type {
  ProviderDispatchInput,
  ProviderDispatchResult,
  PushProviderAdapter,
} from "./provider-delivery";
import { MemoryBrokerPersistence } from "./testing/memory-persistence";

const INSTALLATION_ID = "installation-1";
const START = Date.parse("2026-10-06T10:00:00.000Z");
const storageKey = exportBytesAsBase64Url(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
);

const event = (
  id: string,
  nowMs: number,
  expiresInMs = 10 * 60 * 1000,
): EventRecord => ({
  eventId: id,
  hostId: "host-1",
  sourceId: "thread:alpha",
  canonicalMessageId: `message-${id}`,
  eligibilityEvent: "final_transition_first_seen",
  eventType: "assistant-message",
  occurredAt: new Date(nowMs - 1_000).toISOString(),
  expiresAt: new Date(nowMs + expiresInMs).toISOString(),
  state: "pending",
  attemptCount: 0,
  nextAttemptAt: new Date(nowMs).toISOString(),
  lastError: null,
  providerRequestId: null,
  acceptedAt: new Date(nowMs).toISOString(),
  deliveredAt: null,
});

const prepareStore = async (
  platform: "android" | "ios",
  nowMs: number,
) => {
  const store = new MemoryBrokerPersistence();
  store.registration = {
    installationId: INSTALLATION_ID,
    platform,
    providerTokenCiphertext: await sealSecret(
      "raw-provider-token",
      storageKey,
      INSTALLATION_ID,
    ),
    providerTokenStatus: "active",
    installationPublicKey: "installation-public-key",
    schemaVersion: 1,
    registeredAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    revokedAt: null,
  };
  return store;
};

class SequenceAdapter implements PushProviderAdapter {
  calls: ProviderDispatchInput[] = [];
  constructor(
    readonly provider: "fcm" | "apns",
    private readonly outcomes: ProviderDispatchResult[],
  ) {}
  async send(input: ProviderDispatchInput) {
    this.calls.push(input);
    const outcome = this.outcomes.shift();
    if (!outcome) throw new Error("unexpected provider call");
    return outcome;
  }
}

test("accepted event dispatches once and duplicate drains do not send twice", async () => {
  const store = await prepareStore("android", START);
  store.commitEvent(event("event-1", START));
  const adapter = new SequenceAdapter("fcm", [
    {
      type: "accepted",
      provider: "fcm",
      requestId: "projects/mira/messages/1",
      httpStatus: 200,
    },
  ]);
  const worker = new BrokerDeliveryWorker(
    store,
    storageKey,
    { android: adapter },
    () => START,
  );

  const first = await worker.drain();
  const second = await worker.drain();

  assert.equal(first.delivered, 1);
  assert.equal(second.delivered, 0);
  assert.equal(adapter.calls.length, 1);
  assert.equal(store.getEvent("event-1")?.state, "delivered");
  assert.equal(store.attempts.length, 1);
  const audit = JSON.stringify(store.attempts);
  assert.equal(audit.includes("raw-provider-token"), false);
  assert.equal(audit.includes(storageKey), false);
});

test("retryable provider failure honors backoff then delivers", async () => {
  let now = START;
  const store = await prepareStore("android", now);
  store.commitEvent(event("event-retry", now));
  const adapter = new SequenceAdapter("fcm", [
    {
      type: "retryable",
      provider: "fcm",
      requestId: null,
      httpStatus: 503,
      errorCode: "UNAVAILABLE",
      retryAfterMs: 120_000,
    },
    {
      type: "accepted",
      provider: "fcm",
      requestId: "projects/mira/messages/2",
      httpStatus: 200,
    },
  ]);
  const worker = new BrokerDeliveryWorker(
    store,
    storageKey,
    { android: adapter },
    () => now,
  );

  const first = await worker.drain();
  assert.equal(first.retried, 1);
  const pending = store.getEvent("event-retry");
  assert.equal(pending?.state, "pending");
  assert.equal(
    pending?.nextAttemptAt,
    new Date(START + 120_000).toISOString(),
  );

  now = START + 120_000;
  const second = await worker.drain();
  assert.equal(second.delivered, 1);
  assert.equal(store.getEvent("event-retry")?.state, "delivered");
  assert.equal(adapter.calls.length, 2);
});

test("invalid provider token pauses delivery until Mobile refresh", async () => {
  let now = START;
  const store = await prepareStore("android", now);
  store.commitEvent(event("event-token", now));
  store.commitEvent(event("event-token-2", now));
  const adapter = new SequenceAdapter("fcm", [
    {
      type: "invalid_token",
      provider: "fcm",
      requestId: null,
      httpStatus: 404,
      errorCode: "UNREGISTERED",
    },
    {
      type: "accepted",
      provider: "fcm",
      requestId: "projects/mira/messages/refreshed",
      httpStatus: 200,
    },
    {
      type: "accepted",
      provider: "fcm",
      requestId: "projects/mira/messages/refreshed-2",
      httpStatus: 200,
    },
  ]);
  const worker = new BrokerDeliveryWorker(
    store,
    storageKey,
    { android: adapter },
    () => now,
  );

  await worker.drain();
  assert.equal(store.registration?.providerTokenStatus, "refresh_required");
  assert.equal(store.registration?.providerTokenCiphertext, null);
  assert.equal(store.getEvent("event-token")?.state, "waiting_token_refresh");
  assert.equal(store.getEvent("event-token-2")?.state, "waiting_token_refresh");

  await worker.drain();
  assert.equal(adapter.calls.length, 1);

  now += 30_000;
  const refreshed = await sealSecret(
    "rotated-provider-token",
    storageKey,
    INSTALLATION_ID,
  );
  const refreshResult = store.commitRegistration({
    action: "refresh",
    installationId: INSTALLATION_ID,
    platform: "android",
    providerTokenCiphertext: refreshed,
    installationPublicKey: "installation-public-key",
    requestNonce: "refresh-nonce",
    nonceExpiresAt: new Date(now + 60_000).toISOString(),
    now: new Date(now).toISOString(),
  });
  assert.equal(refreshResult, "ok");

  const afterRefresh = await worker.drain();
  assert.equal(afterRefresh.delivered, 2);
  assert.equal(adapter.calls.length, 3);
  assert.equal(store.getEvent("event-token")?.state, "delivered");
  assert.equal(store.getEvent("event-token-2")?.state, "delivered");
});

test("retry stops at event TTL instead of busy looping", async () => {
  const store = await prepareStore("ios", START);
  store.commitEvent(event("event-expiring", START, 30_000));
  const adapter = new SequenceAdapter("apns", [
    {
      type: "retryable",
      provider: "apns",
      requestId: "apns-1",
      httpStatus: 503,
      errorCode: "ServiceUnavailable",
    },
  ]);
  const worker = new BrokerDeliveryWorker(
    store,
    storageKey,
    { ios: adapter },
    () => START,
  );

  const result = await worker.drain();
  assert.equal(result.expired, 1);
  assert.equal(store.getEvent("event-expiring")?.state, "expired");
  assert.equal(store.getEvent("event-expiring")?.nextAttemptAt, null);
  assert.equal(adapter.calls.length, 1);
});


test("token refresh racing an invalid-token response preserves the fresh token", async () => {
  let now = START;
  const store = await prepareStore("android", now);
  store.commitEvent(event("event-refresh-race", now));
  let calls = 0;
  const adapter: PushProviderAdapter = {
    provider: "fcm",
    async send(input) {
      calls += 1;
      if (calls === 1) {
        const refreshedCiphertext = await sealSecret(
          "fresh-provider-token",
          storageKey,
          INSTALLATION_ID,
        );
        const refreshed = store.commitRegistration({
          action: "refresh",
          installationId: INSTALLATION_ID,
          platform: "android",
          providerTokenCiphertext: refreshedCiphertext,
          installationPublicKey: "installation-public-key",
          requestNonce: "refresh-during-provider-request",
          nonceExpiresAt: new Date(now + 60_000).toISOString(),
          now: new Date(now).toISOString(),
        });
        assert.equal(refreshed, "ok");
        return {
          type: "invalid_token",
          provider: "fcm",
          requestId: null,
          httpStatus: 404,
          errorCode: "UNREGISTERED",
        };
      }
      assert.equal(input.providerToken, "fresh-provider-token");
      return {
        type: "accepted",
        provider: "fcm",
        requestId: "projects/mira/messages/fresh-token",
        httpStatus: 200,
      };
    },
  };
  const worker = new BrokerDeliveryWorker(
    store,
    storageKey,
    { android: adapter },
    () => now,
  );

  const raced = await worker.drain();
  assert.equal(raced.retried, 1);
  assert.equal(store.registration?.providerTokenStatus, "active");
  assert.ok(store.registration?.providerTokenCiphertext);
  assert.equal(store.getEvent("event-refresh-race")?.state, "pending");
  assert.equal(
    store.getEvent("event-refresh-race")?.lastError,
    "provider_token_rotated_during_attempt",
  );

  now += 1;
  const delivered = await worker.drain();
  assert.equal(delivered.delivered, 1);
  assert.equal(calls, 2);
  assert.equal(store.getEvent("event-refresh-race")?.state, "delivered");
});
