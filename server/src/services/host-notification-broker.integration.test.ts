import assert from "node:assert/strict";
import fs from "node:fs";
import { generateKeyPairSync, sign as signBytes, type KeyObject } from "node:crypto";
import { afterAll, test } from "vitest";

import { initializeAuthDatabase } from "@/db/auth.db";
import { getSqlite, resetDatabaseClients } from "@/db/index.js";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { hostNotificationRepository, userRepository } from "@/db/repositories/index.js";
import { tailscaleRemoteAccessRepository } from "@/db/repositories/tailscale-remote-access.repository.js";
import { hostNotificationIdentityService } from "@/services/host-notification-identity.service.js";
import { HostNotificationDeliveryService } from "@/services/host-notification-delivery.service.js";
import { threadService } from "@/services/thread.service.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

import {
  bindingApprovalSigningValue,
  registrationSigningValue,
} from "../../../packages/push-broker/src/contracts.js";
import { BrokerService } from "../../../packages/push-broker/src/service.js";
import { MemoryBrokerPersistence } from "../../../packages/push-broker/src/testing/memory-persistence.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalBrokerUrl = process.env.MIRA_PUSH_BROKER_URL;
const dbPath = createTimestampedTestArtifactPath(
  "db",
  "host-notification-broker-integration",
  ".sqlite",
);

const initializeDatabase = () => {
  initializeAuthDatabase();
  initializeModelConfigDatabase();
  initializeKnowledgeBaseDatabase();
  initializeRoleDatabase();
  initializeThreadDatabase();
};

process.env.DATABASE_URL = `file:${dbPath}`;
process.env.MIRA_PUSH_BROKER_URL = "https://push.example.test";
resetDatabaseClients();
initializeDatabase();

afterAll(() => {
  resetDatabaseClients();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalBrokerUrl === undefined) delete process.env.MIRA_PUSH_BROKER_URL;
  else process.env.MIRA_PUSH_BROKER_URL = originalBrokerUrl;

  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

const createSigningIdentity = () => {
  const pair = generateKeyPairSync("ed25519");
  const jwk = pair.publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new Error("Failed to export test installation public key");
  return {
    privateKey: pair.privateKey,
    publicKey: jwk.x,
  };
};

const signCanonical = (privateKey: KeyObject, value: string) =>
  signBytes(null, Buffer.from(value, "utf8"), privateKey).toString("base64url");

test("pending Host outbox survives database restart and interoperates with the real Push Broker contract", async () => {
  const now = Date.now();
  const user = userRepository.create({
    username: `notify-integration-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });
  const deviceId = `device-${crypto.randomUUID()}`;
  const installationId = `installation-${crypto.randomUUID()}`;

  tailscaleRemoteAccessRepository.createDevice({
    id: deviceId,
    userId: user.id,
    name: "Integration Phone",
    platform: "android",
    permissions: ["threads:read", "messages:read"],
    tokenHash: `hash-${crypto.randomUUID()}`,
    createdAt: new Date(now).toISOString(),
  });

  const brokerStore = new MemoryBrokerPersistence();
  const broker = new BrokerService(
    brokerStore,
    Buffer.alloc(32, 7).toString("base64url"),
    () => Date.now(),
  );
  const installationKey = createSigningIdentity();
  const brokerBase = `https://push.example.test/v1/installations/${installationId}`;
  const brokerPost = (
    path: string,
    body: unknown,
    deliveryToken?: string,
  ) =>
    broker.handle(
      new Request(`${brokerBase}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(deliveryToken
            ? { authorization: `Bearer ${deliveryToken}` }
            : {}),
        },
        body: JSON.stringify(body),
      }),
      installationId,
    );

  const registrationUnsigned = {
    schemaVersion: 1 as const,
    installationId,
    platform: "android" as const,
    providerToken: "provider-token-integration",
    installationPublicKey: installationKey.publicKey,
    requestNonce: `register-${crypto.randomUUID()}`,
    issuedAt: new Date(now).toISOString(),
  };
  const registration = await brokerPost("/register", {
    ...registrationUnsigned,
    installationSignature: signCanonical(
      installationKey.privateKey,
      registrationSigningValue("register", registrationUnsigned),
    ),
  });
  assert.equal(registration.status, 201);

  const descriptor = hostNotificationIdentityService.createBindingDescriptor({
    installationId,
    originRemoteDeviceId: deviceId,
    ownerUserId: user.id,
    sourceScope: [thread.id],
    now,
  });
  const approvalUnsigned = {
    schemaVersion: descriptor.schemaVersion,
    installationId: descriptor.installationId,
    hostId: descriptor.hostId,
    hostPublicKey: descriptor.hostPublicKey,
    sourceScope: descriptor.sourceScope,
    bindingNonce: descriptor.bindingNonce,
    bindingExpiresAt: descriptor.bindingExpiresAt,
  };
  const approval = await brokerPost("/bindings/approve", {
    ...approvalUnsigned,
    installationSignature: signCanonical(
      installationKey.privateKey,
      bindingApprovalSigningValue(approvalUnsigned),
    ),
  });
  assert.equal(approval.status, 201);
  const approvalBody = (await approval.json()) as {
    status: string;
    deliveryToken: string;
  };
  assert.equal(approvalBody.status, "authorized");

  hostNotificationIdentityService.acceptApprovedBinding({
    bindingNonce: descriptor.bindingNonce,
    installationId,
    originRemoteDeviceId: deviceId,
    ownerUserId: user.id,
    deliveryToken: approvalBody.deliveryToken,
    sourceScope: descriptor.sourceScope,
    now: new Date(now + 1_000).toISOString(),
  });

  const assistantMessageId = `assistant-${crypto.randomUUID()}`;
  threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    role: "assistant",
    content: "Broker contract integration reply",
    parts: [{ type: "text", text: "Broker contract integration reply" }],
  });

  const pendingBeforeRestart = getSqlite()
    .prepare(
      "SELECT state FROM notification_outbox WHERE canonical_message_id = ? AND installation_id = ?",
    )
    .get(assistantMessageId, installationId) as { state: string } | undefined;
  assert.deepEqual(pendingBeforeRestart, { state: "pending" });

  // Simulate a Host process restart by closing the shared SQLite clients and
  // reopening the same durable database before constructing a fresh worker.
  resetDatabaseClients();
  initializeDatabase();

  const delivery = new HostNotificationDeliveryService({
    fetchImpl: (async (url, init) =>
      broker.handle(
        new Request(String(url), init),
        installationId,
      )) as typeof fetch,
  });

  const result = await delivery.drainOnce();
  assert.deepEqual(result, { delivered: 1, retried: 0, failed: 0 });

  const persistedAfterRestart = getSqlite()
    .prepare(
      "SELECT state FROM notification_outbox WHERE canonical_message_id = ? AND installation_id = ?",
    )
    .get(assistantMessageId, installationId) as { state: string } | undefined;
  assert.deepEqual(persistedAfterRestart, { state: "delivered" });
  assert.equal(brokerStore.events.size, 1);

  const brokerEvent = [...brokerStore.events.values()][0];
  assert.equal(brokerEvent?.canonicalMessageId, assistantMessageId);
  assert.equal(brokerEvent?.sourceId, thread.id);
  assert.equal(brokerEvent?.hostId, descriptor.hostId);
  assert.equal(brokerEvent?.eligibilityEvent, "final_transition_first_seen");
});
