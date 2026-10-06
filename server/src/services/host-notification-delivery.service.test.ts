import assert from "node:assert/strict";
import { test } from "vitest";

import {
  HostNotificationDeliveryService,
} from "./host-notification-delivery.service.js";
import type {
  HostNotificationBindingRecord,
  NotificationOutboxRecord,
} from "@/db/repositories/host-notification.repository.js";

const NOW = Date.parse("2026-10-06T05:00:00.000Z");

const event: NotificationOutboxRecord = {
  id: "event-1",
  installationId: "installation-1",
  canonicalMessageId: "assistant-1",
  sourceId: "thread-1",
  eligibilityEvent: "final_transition_first_seen",
  state: "pending",
  attemptCount: 0,
  nextAttemptAt: new Date(NOW).toISOString(),
  expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
  lastError: null,
  createdAt: new Date(NOW - 1_000).toISOString(),
  updatedAt: new Date(NOW - 1_000).toISOString(),
};

const binding: HostNotificationBindingRecord = {
  installationId: "installation-1",
  originRemoteDeviceId: "device-1",
  ownerUserId: 7,
  brokerBaseUrl: "https://push.stale.example.test",
  deliveryToken: "delivery-secret",
  sourceScope: ["thread-1"],
  status: "active",
  createdAt: new Date(NOW - 10_000).toISOString(),
  updatedAt: new Date(NOW - 10_000).toISOString(),
};

const createHarness = (
  fetchImpl: typeof fetch,
  brokerBaseUrl: () => string = () => "https://push.current.example.test",
) => {
  const calls = {
    delivered: [] as string[],
    expired: [] as Array<{ id: string; reason: string }>,
    failed: [] as Array<{ id: string; message: string }>,
    retried: [] as Array<{
      id: string;
      attemptCount: number;
      nextAttemptAt: string;
      errorMessage: string;
    }>,
  };

  const repository = {
    expireDue: () => 0,
    listPending: () => [event],
    isCanonicalDeliveryEligible: () => true,
    getBinding: () => binding,
    markExpired: (id: string, reason: string) => {
      calls.expired.push({ id, reason });
      return true;
    },
    markDelivered: (id: string) => {
      calls.delivered.push(id);
      return true;
    },
    markFailed: (id: string, message: string) => {
      calls.failed.push({ id, message });
      return true;
    },
    scheduleRetry: (input: {
      id: string;
      attemptCount: number;
      nextAttemptAt: string;
      errorMessage: string;
    }) => {
      calls.retried.push(input);
      return true;
    },
  };

  const service = new HostNotificationDeliveryService({
    repository,
    identity: {
      getOrCreateIdentity: () => ({
        hostId: "host-1",
        publicKey: "public-key",
        createdAt: new Date(NOW - 20_000).toISOString(),
        rotatedAt: null,
      }),
      signEvent: () => "host-signature",
    },
    fetchImpl,
    brokerBaseUrl,
    now: () => NOW,
  });

  return { service, calls };
};

test("delivery posts identity-only Broker event and marks success", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  let capturedAuth = "";
  let capturedSignal: AbortSignal | null = null;

  const { service, calls } = createHarness(
    (async (_url, init) => {
      capturedAuth = new Headers(init?.headers).get("authorization") ?? "";
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      capturedSignal = init?.signal ?? null;
      return new Response("{}", { status: 202 });
    }) as typeof fetch,
  );

  const result = await service.drainOnce();
  assert.deepEqual(result, { delivered: 1, retried: 0, failed: 0 });
  assert.deepEqual(calls.delivered, ["event-1"]);
  assert.equal(capturedAuth, "Bearer delivery-secret");
  assert.equal(capturedBody?.canonicalMessageId, "assistant-1");
  assert.equal(capturedBody?.sourceId, "thread-1");
  assert.equal(capturedBody?.hostSignature, "host-signature");
  assert.ok(capturedSignal instanceof AbortSignal);
  assert.equal(capturedSignal.aborted, false);
  assert.equal("content" in (capturedBody ?? {}), false);
  assert.equal("body" in (capturedBody ?? {}), false);
  assert.equal("prompt" in (capturedBody ?? {}), false);
});

test("delivery resolves the current Host Broker URL instead of stored binding URL", async () => {
  let capturedUrl = "";
  let currentBrokerUrl = "https://push.current.example.test";

  const { service } = createHarness(
    (async (url) => {
      capturedUrl = String(url);
      return new Response("{}", { status: 202 });
    }) as typeof fetch,
    () => currentBrokerUrl,
  );

  await service.drainOnce();
  assert.match(capturedUrl, /^https:\/\/push\.current\.example\.test\//);
  assert.equal(capturedUrl.includes("push.stale.example.test"), false);

  currentBrokerUrl = "https://push.rotated.example.test";
  capturedUrl = "";
  await service.drainOnce();
  assert.match(capturedUrl, /^https:\/\/push\.rotated\.example\.test\//);
});

test("retryable Broker failures schedule bounded retry", async () => {
  const { service, calls } = createHarness(
    (async () => new Response("{}", { status: 503 })) as typeof fetch,
  );

  const result = await service.drainOnce();
  assert.deepEqual(result, { delivered: 0, retried: 1, failed: 0 });
  assert.equal(calls.retried.length, 1);
  assert.equal(calls.retried[0]?.attemptCount, 1);
  assert.ok(Date.parse(calls.retried[0]!.nextAttemptAt) > NOW);
});

test("stale canonical events expire without calling the Broker", async () => {
  let fetchCalls = 0;
  const { service, calls } = createHarness(
    (async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 202 });
    }) as typeof fetch,
  );

  const repository = (
    service as unknown as {
      dependencies: {
        repository: {
          isCanonicalDeliveryEligible: () => boolean;
        };
      };
    }
  ).dependencies.repository;
  repository.isCanonicalDeliveryEligible = () => false;

  const result = await service.drainOnce();
  assert.deepEqual(result, { delivered: 0, retried: 0, failed: 0 });
  assert.equal(fetchCalls, 0);
  assert.deepEqual(calls.expired, [
    {
      id: "event-1",
      reason: "Canonical message or binding authority is no longer eligible",
    },
  ]);
});

test("authorization failures are final and are not retried", async () => {
  const { service, calls } = createHarness(
    (async () => new Response("{}", { status: 403 })) as typeof fetch,
  );

  const result = await service.drainOnce();
  assert.deepEqual(result, { delivered: 0, retried: 0, failed: 1 });
  assert.equal(calls.failed.length, 1);
  assert.equal(calls.retried.length, 0);
});


test("one corrupt binding does not abort delivery of later outbox events", async () => {
  let fetchCalls = 0;
  const { service, calls } = createHarness(
    (async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 202 });
    }) as typeof fetch,
  );

  const secondEvent: NotificationOutboxRecord = {
    ...event,
    id: "event-2",
    installationId: "installation-2",
    canonicalMessageId: "assistant-2",
  };
  const repository = (
    service as unknown as {
      dependencies: {
        repository: {
          listPending: () => NotificationOutboxRecord[];
          getBinding: (
            installationId: string,
          ) => HostNotificationBindingRecord | null;
        };
      };
    }
  ).dependencies.repository;

  repository.listPending = () => [event, secondEvent];
  repository.getBinding = (installationId) => {
    if (installationId === event.installationId) {
      throw new Error("stored delivery token cannot be decrypted");
    }
    return {
      ...binding,
      installationId,
    };
  };

  const result = await service.drainOnce();

  assert.deepEqual(result, { delivered: 1, retried: 0, failed: 1 });
  assert.equal(fetchCalls, 1);
  assert.deepEqual(calls.delivered, ["event-2"]);
  assert.deepEqual(calls.failed, [
    {
      id: "event-1",
      message:
        "Notification delivery preparation failed: stored delivery token cannot be decrypted",
    },
  ]);
});
