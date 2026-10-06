import assert from "node:assert/strict";
import test from "node:test";

import {
  BROKER_SCHEMA_VERSION,
  ELIGIBILITY_EVENT,
  EVENT_TYPE,
  bindingApprovalSigningValue,
  bindingRevokeSigningValue,
  eventSigningValue,
  installationRevokeSigningValue,
  registrationSigningValue,
} from "./contracts";
import { exportBytesAsBase64Url, sha256Hex } from "./crypto";
import { BrokerDeliveryWorker } from "./delivery";
import type {
  ProviderDispatchInput,
  PushProviderAdapter,
} from "./provider-delivery";
import { BrokerService } from "./service";
import { MemoryBrokerPersistence } from "./testing/memory-persistence";

const NOW = Date.parse("2026-10-06T03:30:00.000Z");
const INSTALLATION_ID = "installation-1";
const BASE = `https://push.example.test/v1/installations/${INSTALLATION_ID}`;

const storageKey = exportBytesAsBase64Url(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
);

const createKeyPair = async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicKey: exportBytesAsBase64Url(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ),
  };
};

const sign = async (key: CryptoKey, payload: string) =>
  exportBytesAsBase64Url(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      key,
      new TextEncoder().encode(payload),
    ),
  );

const post = (
  service: BrokerService,
  path: string,
  body: unknown,
  token?: string,
) =>
  service.handle(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    INSTALLATION_ID,
  );

const register = async (
  service: BrokerService,
  installationKey: Awaited<ReturnType<typeof createKeyPair>>,
  options: {
    providerToken?: string;
    nonce?: string;
    action?: "register" | "refresh";
  } = {},
) => {
  const action = options.action ?? "register";
  const unsigned = {
    schemaVersion: BROKER_SCHEMA_VERSION as 1,
    installationId: INSTALLATION_ID,
    platform: "android" as const,
    providerToken: options.providerToken ?? "provider-token-secret",
    installationPublicKey: installationKey.publicKey,
    requestNonce: options.nonce ?? `${action}-nonce`,
    issuedAt: new Date(NOW).toISOString(),
  };
  return post(service, `/${action}`, {
    ...unsigned,
    installationSignature: await sign(
      installationKey.privateKey,
      registrationSigningValue(action, unsigned),
    ),
  });
};

const approve = async (
  service: BrokerService,
  installationKey: Awaited<ReturnType<typeof createKeyPair>>,
  hostKey: Awaited<ReturnType<typeof createKeyPair>>,
  options: {
    nonce?: string;
    sourceScope?: string[];
    hostId?: string;
  } = {},
) => {
  const unsigned = {
    schemaVersion: BROKER_SCHEMA_VERSION as 1,
    installationId: INSTALLATION_ID,
    hostId: options.hostId ?? "host-1",
    hostPublicKey: hostKey.publicKey,
    sourceScope: options.sourceScope ?? ["thread:alpha"],
    bindingNonce: options.nonce ?? "binding-nonce",
    bindingExpiresAt: new Date(NOW + 60_000).toISOString(),
  };
  const response = await post(service, "/bindings/approve", {
    ...unsigned,
    installationSignature: await sign(
      installationKey.privateKey,
      bindingApprovalSigningValue(unsigned),
    ),
  });
  return {
    response,
    json: (await response.json()) as Record<string, unknown>,
  };
};

const createEvent = async (
  hostKey: Awaited<ReturnType<typeof createKeyPair>>,
  overrides: Partial<{
    eventId: string;
    sourceId: string;
    hostId: string;
    canonicalMessageId: string;
  }> = {},
) => {
  const unsigned = {
    schemaVersion: BROKER_SCHEMA_VERSION as 1,
    eventType: EVENT_TYPE,
    installationId: INSTALLATION_ID,
    eventId: overrides.eventId ?? "event-1",
    hostId: overrides.hostId ?? "host-1",
    sourceId: overrides.sourceId ?? "thread:alpha",
    canonicalMessageId: overrides.canonicalMessageId ?? "message-1",
    eligibilityEvent: ELIGIBILITY_EVENT,
    occurredAt: new Date(NOW - 1_000).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
  };
  return {
    ...unsigned,
    hostSignature: await sign(hostKey.privateKey, eventSigningValue(unsigned)),
  };
};

test("registration proves installation-key possession and seals provider token", async () => {
  const store = new MemoryBrokerPersistence();
  const service = new BrokerService(store, storageKey, () => NOW);
  const installationKey = await createKeyPair();
  const attacker = await createKeyPair();

  const unsigned = {
    schemaVersion: BROKER_SCHEMA_VERSION as 1,
    installationId: INSTALLATION_ID,
    platform: "android" as const,
    providerToken: "provider-token-secret",
    installationPublicKey: installationKey.publicKey,
    requestNonce: "invalid-register-nonce",
    issuedAt: new Date(NOW).toISOString(),
  };
  const rejected = await post(service, "/register", {
    ...unsigned,
    installationSignature: await sign(
      attacker.privateKey,
      registrationSigningValue("register", unsigned),
    ),
  });
  assert.equal(rejected.status, 401);
  assert.equal(store.registration, null);

  const accepted = await register(service, installationKey);
  assert.equal(accepted.status, 201);
  assert.ok(store.registration?.providerTokenCiphertext);
  assert.notEqual(
    store.registration?.providerTokenCiphertext,
    "provider-token-secret",
  );
  assert.equal(
    store.registration?.providerTokenCiphertext?.includes(
      "provider-token-secret",
    ),
    false,
  );
});

test("provider-token refresh requires the original installation key", async () => {
  const store = new MemoryBrokerPersistence();
  const service = new BrokerService(store, storageKey, () => NOW);
  const installationKey = await createKeyPair();
  await register(service, installationKey);

  const refreshed = await register(service, installationKey, {
    action: "refresh",
    nonce: "refresh-2",
    providerToken: "provider-token-rotated",
  });
  assert.equal(refreshed.status, 200);
  assert.equal(
    store.registration?.providerTokenCiphertext?.includes(
      "provider-token-rotated",
    ),
    false,
  );

  const attacker = await createKeyPair();
  const denied = await register(service, attacker, {
    action: "refresh",
    nonce: "attacker-refresh",
  });
  assert.equal(denied.status, 403);
});

test("binding approval requires installation signature and rejects nonce replay", async () => {
  const store = new MemoryBrokerPersistence();
  const service = new BrokerService(store, storageKey, () => NOW);
  const installationKey = await createKeyPair();
  const hostKey = await createKeyPair();
  await register(service, installationKey);

  const first = await approve(service, installationKey, hostKey);
  assert.equal(first.response.status, 201);
  assert.equal(first.json.status, "authorized");
  const deliveryToken = String(first.json.deliveryToken);
  assert.ok(deliveryToken.length >= 32);
  assert.equal(
    store.bindings.get("host-1")?.deliveryTokenHash,
    await sha256Hex(deliveryToken),
  );
  assert.notEqual(store.bindings.get("host-1")?.deliveryTokenHash, deliveryToken);

  const replay = await approve(service, installationKey, hostKey);
  assert.equal(replay.response.status, 409);
  assert.deepEqual(replay.json, {
    error: "binding_nonce_reused",
  });
});

test("event ingest enforces delivery token, Host signature, scope and dedupe", async () => {
  const store = new MemoryBrokerPersistence();
  const service = new BrokerService(store, storageKey, () => NOW);
  const installationKey = await createKeyPair();
  const hostKey = await createKeyPair();
  await register(service, installationKey);
  const binding = await approve(service, installationKey, hostKey);
  const deliveryToken = String(binding.json.deliveryToken);

  const event = await createEvent(hostKey);
  const accepted = await post(service, "/events", event, deliveryToken);
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), {
    status: "accepted",
    duplicate: false,
  });

  const duplicate = await post(service, "/events", event, deliveryToken);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), {
    status: "accepted",
    duplicate: true,
  });
  assert.equal(store.events.size, 1);

  const outOfScope = await post(
    service,
    "/events",
    await createEvent(hostKey, {
      eventId: "event-out-of-scope",
      sourceId: "thread:other",
    }),
    deliveryToken,
  );
  assert.equal(outOfScope.status, 403);

  const attacker = await createKeyPair();
  const badSignature = await post(
    service,
    "/events",
    await createEvent(attacker, { eventId: "event-bad-signature" }),
    deliveryToken,
  );
  assert.equal(badSignature.status, 401);
});

test("Host-key rotation invalidates the previous delivery token", async () => {
  const store = new MemoryBrokerPersistence();
  const service = new BrokerService(store, storageKey, () => NOW);
  const installationKey = await createKeyPair();
  const firstHostKey = await createKeyPair();
  const rotatedHostKey = await createKeyPair();
  await register(service, installationKey);

  const first = await approve(service, installationKey, firstHostKey);
  const firstToken = String(first.json.deliveryToken);
  const rotated = await approve(service, installationKey, rotatedHostKey, {
    nonce: "rotation-nonce",
  });
  const rotatedToken = String(rotated.json.deliveryToken);

  const stale = await post(
    service,
    "/events",
    await createEvent(firstHostKey, { eventId: "event-old-key" }),
    firstToken,
  );
  assert.equal(stale.status, 401);

  const accepted = await post(
    service,
    "/events",
    await createEvent(rotatedHostKey, { eventId: "event-new-key" }),
    rotatedToken,
  );
  assert.equal(accepted.status, 202);
});

test("binding and installation revoke invalidate delivery capabilities", async () => {
  const store = new MemoryBrokerPersistence();
  const service = new BrokerService(store, storageKey, () => NOW);
  const installationKey = await createKeyPair();
  const hostKey = await createKeyPair();
  await register(service, installationKey);
  const binding = await approve(service, installationKey, hostKey);
  const deliveryToken = String(binding.json.deliveryToken);

  const revokeBindingUnsigned = {
    schemaVersion: BROKER_SCHEMA_VERSION as 1,
    installationId: INSTALLATION_ID,
    hostId: "host-1",
    requestNonce: "revoke-binding-nonce",
    issuedAt: new Date(NOW).toISOString(),
  };
  const revokeBinding = await post(service, "/bindings/revoke", {
    ...revokeBindingUnsigned,
    installationSignature: await sign(
      installationKey.privateKey,
      bindingRevokeSigningValue(revokeBindingUnsigned),
    ),
  });
  assert.equal(revokeBinding.status, 200);

  const denied = await post(
    service,
    "/events",
    await createEvent(hostKey, { eventId: "event-after-binding-revoke" }),
    deliveryToken,
  );
  assert.equal(denied.status, 401);

  const secondBinding = await approve(service, installationKey, hostKey, {
    nonce: "second-binding-nonce",
  });
  const secondToken = String(secondBinding.json.deliveryToken);

  const revokeInstallationUnsigned = {
    schemaVersion: BROKER_SCHEMA_VERSION as 1,
    installationId: INSTALLATION_ID,
    requestNonce: "revoke-installation-nonce",
    issuedAt: new Date(NOW).toISOString(),
  };
  const revokeInstallation = await post(service, "/revoke", {
    ...revokeInstallationUnsigned,
    installationSignature: await sign(
      installationKey.privateKey,
      installationRevokeSigningValue(revokeInstallationUnsigned),
    ),
  });
  assert.equal(revokeInstallation.status, 200);
  assert.equal(store.registration?.providerTokenCiphertext, null);

  const deniedAfterInstallationRevoke = await post(
    service,
    "/events",
    await createEvent(hostKey, { eventId: "event-after-installation-revoke" }),
    secondToken,
  );
  assert.equal(deniedAfterInstallationRevoke.status, 401);
});

test("event contract rejects arbitrary payload fields that could carry content", async () => {
  const store = new MemoryBrokerPersistence();
  const service = new BrokerService(store, storageKey, () => NOW);
  const installationKey = await createKeyPair();
  const hostKey = await createKeyPair();
  await register(service, installationKey);
  const binding = await approve(service, installationKey, hostKey);
  const deliveryToken = String(binding.json.deliveryToken);

  const event = await createEvent(hostKey);
  const response = await post(
    service,
    "/events",
    { ...event, body: "secret assistant text" },
    deliveryToken,
  );
  assert.equal(response.status, 400);
  assert.equal(store.events.size, 0);
});


test("duplicate ingest after provider acceptance never dispatches the provider twice", async () => {
  const store = new MemoryBrokerPersistence();
  const service = new BrokerService(store, storageKey, () => NOW);
  const installationKey = await createKeyPair();
  const hostKey = await createKeyPair();
  await register(service, installationKey);
  const binding = await approve(service, installationKey, hostKey);
  const deliveryToken = String(binding.json.deliveryToken);
  const event = await createEvent(hostKey, { eventId: "event-provider-dedupe" });

  const accepted = await post(service, "/events", event, deliveryToken);
  assert.equal(accepted.status, 202);

  const calls: ProviderDispatchInput[] = [];
  const adapter: PushProviderAdapter = {
    provider: "fcm",
    async send(input) {
      calls.push(input);
      return {
        type: "accepted",
        provider: "fcm",
        requestId: "projects/mira/messages/dedupe",
        httpStatus: 200,
      };
    },
  };
  const worker = new BrokerDeliveryWorker(
    store,
    storageKey,
    { android: adapter },
    () => NOW,
  );
  await worker.drain();
  assert.equal(calls.length, 1);
  assert.equal(store.getEvent("event-provider-dedupe")?.state, "delivered");

  const duplicate = await post(service, "/events", event, deliveryToken);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), {
    status: "accepted",
    duplicate: true,
  });

  await worker.drain();
  assert.equal(calls.length, 1);
  assert.equal(store.events.size, 1);
});


test("binding revoke cancels pending provider delivery for that Host", async () => {
  const store = new MemoryBrokerPersistence();
  const service = new BrokerService(store, storageKey, () => NOW);
  const installationKey = await createKeyPair();
  const hostKey = await createKeyPair();
  await register(service, installationKey);
  const binding = await approve(service, installationKey, hostKey);
  const deliveryToken = String(binding.json.deliveryToken);

  const pendingEvent = await createEvent(hostKey, {
    eventId: "event-cancel-on-binding-revoke",
  });
  const accepted = await post(service, "/events", pendingEvent, deliveryToken);
  assert.equal(accepted.status, 202);
  assert.equal(
    store.getEvent("event-cancel-on-binding-revoke")?.state,
    "pending",
  );

  const revokeUnsigned = {
    schemaVersion: BROKER_SCHEMA_VERSION as 1,
    installationId: INSTALLATION_ID,
    hostId: "host-1",
    requestNonce: "cancel-pending-binding-revoke",
    issuedAt: new Date(NOW).toISOString(),
  };
  const revoked = await post(service, "/bindings/revoke", {
    ...revokeUnsigned,
    installationSignature: await sign(
      installationKey.privateKey,
      bindingRevokeSigningValue(revokeUnsigned),
    ),
  });
  assert.equal(revoked.status, 200);
  assert.equal(
    store.getEvent("event-cancel-on-binding-revoke")?.state,
    "cancelled",
  );

  let providerCalls = 0;
  const worker = new BrokerDeliveryWorker(
    store,
    storageKey,
    {
      android: {
        provider: "fcm",
        async send() {
          providerCalls += 1;
          return {
            type: "accepted",
            provider: "fcm",
            requestId: "should-not-send",
            httpStatus: 200,
          };
        },
      },
    },
    () => NOW,
  );
  await worker.drain();
  assert.equal(providerCalls, 0);
});
