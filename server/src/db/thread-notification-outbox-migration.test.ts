import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, test } from "vitest";

import { initializeAuthDatabase } from "@/db/auth.db";
import { getSqlite, resetDatabaseClients } from "@/db/index.js";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
let dbPath = "";

afterEach(() => {
  resetDatabaseClients();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;

  if (dbPath) {
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
  }
  dbPath = "";
});

test("migrates legacy notification outbox off cascade foreign keys without losing events", () => {
  dbPath = createTimestampedTestArtifactPath(
    "db",
    "notification-outbox-durability",
    ".sqlite",
  );
  process.env.DATABASE_URL = `file:${dbPath}`;
  resetDatabaseClients();

  initializeAuthDatabase();
  initializeModelConfigDatabase();
  initializeKnowledgeBaseDatabase();
  initializeRoleDatabase();

  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE host_notification_bindings (
      installation_id TEXT PRIMARY KEY,
      origin_remote_device_id TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL,
      broker_base_url TEXT NOT NULL,
      delivery_token_encrypted TEXT NOT NULL,
      source_scope_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE notification_outbox (
      id TEXT PRIMARY KEY,
      installation_id TEXT NOT NULL
        REFERENCES host_notification_bindings(installation_id) ON DELETE CASCADE,
      canonical_message_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      eligibility_event TEXT NOT NULL DEFAULT 'final_transition_first_seen',
      state TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (installation_id, canonical_message_id, eligibility_event)
    );
  `);

  const now = new Date().toISOString();
  const installationId = `installation-${crypto.randomUUID()}`;
  const eventId = `event-${crypto.randomUUID()}`;
  sqlite
    .prepare(
      `INSERT INTO host_notification_bindings (
        installation_id, origin_remote_device_id, owner_user_id,
        broker_base_url, delivery_token_encrypted, source_scope_json,
        status, created_at, updated_at
      ) VALUES (?, 'device-1', 1, 'https://push.example.test', 'encrypted',
                '["thread-1"]', 'active', ?, ?)`,
    )
    .run(installationId, now, now);
  sqlite
    .prepare(
      `INSERT INTO notification_outbox (
        id, installation_id, canonical_message_id, source_id,
        eligibility_event, state, attempt_count, next_attempt_at,
        expires_at, last_error, created_at, updated_at
      ) VALUES (?, ?, 'assistant-1', 'thread-1',
                'final_transition_first_seen', 'pending', 0, ?, ?, NULL, ?, ?)`,
    )
    .run(
      eventId,
      installationId,
      now,
      new Date(Date.now() + 60_000).toISOString(),
      now,
      now,
    );

  initializeThreadDatabase();

  const foreignKeys = sqlite
    .prepare("PRAGMA foreign_key_list(notification_outbox)")
    .all() as Array<{ table: string }>;
  assert.deepEqual(foreignKeys, []);

  sqlite
    .prepare("DELETE FROM host_notification_bindings WHERE installation_id = ?")
    .run(installationId);

  const persisted = sqlite
    .prepare("SELECT id, state FROM notification_outbox WHERE id = ?")
    .get(eventId) as { id: string; state: string } | undefined;
  assert.deepEqual(persisted, { id: eventId, state: "pending" });

  // Migration stays idempotent once the durable schema is already in place.
  initializeThreadDatabase();
  const afterSecondInit = sqlite
    .prepare("SELECT COUNT(*) AS count FROM notification_outbox WHERE id = ?")
    .get(eventId) as { count: number };
  assert.equal(afterSecondInit.count, 1);
});
