import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicKey, verify } from "node:crypto";
import { afterAll, test } from "vitest";

import { getSqlite, resetDatabaseClients } from "@/db/index.js";
import { initializeThreadDatabase } from "@/db/thread.db.js";
import { hostNotificationRepository } from "@/db/repositories/host-notification.repository.js";
import { hostNotificationIdentityService } from "./host-notification-identity.service.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const testDbPath = createTimestampedTestArtifactPath(
  "db",
  "host-notification-identity",
  ".sqlite",
);
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.MIRA_PUSH_BROKER_URL = "https://push.example.test";
initializeThreadDatabase();

afterAll(() => {
  resetDatabaseClients();
  delete process.env.MIRA_PUSH_BROKER_URL;
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // Ignore Windows cleanup locks.
  }
});

const canonicalJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

test("Host notification identity is stable and private key is encrypted at rest", () => {
  const first = hostNotificationIdentityService.getOrCreateIdentity();
  const second = hostNotificationIdentityService.getOrCreateIdentity();

  assert.equal(second.hostId, first.hostId);
  assert.equal(second.publicKey, first.publicKey);
  assert.equal("privateKeyPem" in first, false);
  assert.equal("privateKeyPem" in second, false);

  const row = getSqlite()
    .prepare(
      "SELECT private_key_encrypted AS encrypted FROM host_notification_identity WHERE id = 1",
    )
    .get() as { encrypted: string };
  assert.equal(row.encrypted.includes("BEGIN PRIVATE KEY"), false);
});

test("binding descriptor is Host-signed, scoped, expiring and one-time", () => {
  const now = Date.parse("2026-10-06T04:45:00.000Z");
  const descriptor = hostNotificationIdentityService.createBindingDescriptor({
    installationId: "installation-1",
    originRemoteDeviceId: "device-1",
    ownerUserId: 7,
    sourceScope: ["thread-b", "thread-a", "thread-a"],
    now,
  });

  assert.deepEqual(descriptor.sourceScope, ["thread-a", "thread-b"]);
  assert.ok(Date.parse(descriptor.bindingExpiresAt) > now);

  const unsigned = {
    schemaVersion: descriptor.schemaVersion,
    action: "binding-descriptor",
    hostId: descriptor.hostId,
    hostPublicKey: descriptor.hostPublicKey,
    installationId: descriptor.installationId,
    sourceScope: descriptor.sourceScope,
    bindingNonce: descriptor.bindingNonce,
    bindingExpiresAt: descriptor.bindingExpiresAt,
  };
  const publicKey = createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: descriptor.hostPublicKey,
    },
    format: "jwk",
  });
  assert.equal(
    verify(
      null,
      Buffer.from(canonicalJson(unsigned), "utf8"),
      publicKey,
      Buffer.from(descriptor.hostSignature, "base64url"),
    ),
    true,
  );

  const token = "delivery_0123456789012345678901234567890123456789";
  const accepted = hostNotificationIdentityService.acceptApprovedBinding({
    bindingNonce: descriptor.bindingNonce,
    installationId: descriptor.installationId,
    originRemoteDeviceId: "device-1",
    ownerUserId: 7,
    deliveryToken: token,
    sourceScope: descriptor.sourceScope,
    now: new Date(now + 1_000).toISOString(),
  });
  assert.equal(accepted.deliveryToken, token);
  assert.equal(accepted.brokerBaseUrl, "https://push.example.test");

  const raw = getSqlite()
    .prepare(
      "SELECT delivery_token_encrypted AS encrypted FROM host_notification_bindings WHERE installation_id = ?",
    )
    .get(descriptor.installationId) as { encrypted: string };
  assert.equal(raw.encrypted.includes(token), false);

  assert.throws(
    () =>
      hostNotificationIdentityService.acceptApprovedBinding({
        bindingNonce: descriptor.bindingNonce,
        installationId: descriptor.installationId,
        originRemoteDeviceId: "device-1",
        ownerUserId: 7,
        deliveryToken: token,
        sourceScope: descriptor.sourceScope,
        now: new Date(now + 2_000).toISOString(),
      }),
    /already consumed/,
  );
});

test("binding acceptance rejects scope substitution", () => {
  const now = Date.parse("2026-10-06T04:50:00.000Z");
  const descriptor = hostNotificationIdentityService.createBindingDescriptor({
    installationId: "installation-scope",
    originRemoteDeviceId: "device-scope",
    ownerUserId: 7,
    sourceScope: ["thread-allowed"],
    now,
  });

  assert.throws(
    () =>
      hostNotificationRepository.acceptBindingCapability({
        nonce: descriptor.bindingNonce,
        installationId: descriptor.installationId,
        originRemoteDeviceId: "device-scope",
        ownerUserId: 7,
        brokerBaseUrl: "https://push.example.test",
        deliveryToken: "delivery_abcdefghijklmnopqrstuvwxyz0123456789",
        sourceScope: ["thread-other"],
        now: new Date(now + 1_000).toISOString(),
      }),
    /source scope does not match/,
  );
});
