import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, test } from "vitest";
import { getSqlite, resetDatabaseClients } from "@/db/index.js";
import { retireLegacyRemoteRelaySettings } from "@/db/remote-relay-retirement.js";
import { hasSqliteTable } from "@/db/sqlite-utils.js";
import { tailscaleRemoteAccessRepository } from "@/db/repositories/tailscale-remote-access.repository.js";
import {
  createTimestampedTestArtifactPath,
  getTestArtifactDir,
} from "@/test-support/artifacts.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
let dbPath = "";
let root = "";

afterEach(() => {
  resetDatabaseClients();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (root) fs.rmSync(root, { recursive: true, force: true });
  if (dbPath) {
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
  }
  dbPath = "";
  root = "";
});

const setupLegacyDatabase = () => {
  root = getTestArtifactDir("remote-relay-retirement", `${process.pid}-${Date.now()}`);
  dbPath = createTimestampedTestArtifactPath(
    "db",
    "remote-relay-retirement",
    ".sqlite",
  );
  process.env.DATABASE_URL = `file:${dbPath}`;
  resetDatabaseClients();

  tailscaleRemoteAccessRepository.initialize();

  // Reproduce an upgraded Host that still holds the retired, enabled,
  // custom-endpoint Relay identity with encrypted tokens.
  getSqlite().exec(`
    CREATE TABLE remote_relay_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      endpoint_mode TEXT NOT NULL DEFAULT 'default',
      custom_url TEXT NOT NULL DEFAULT '',
      relay_id TEXT NOT NULL DEFAULT '',
      host_token_encrypted TEXT,
      client_token_encrypted TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    INSERT INTO remote_relay_settings (
      id, enabled, endpoint_mode, custom_url, relay_id,
      host_token_encrypted, client_token_encrypted, created_at, updated_at
    ) VALUES (1, 1, 'custom', 'https://relay.example.test',
      'relay_1234567890abcdef', 'legacy-host-secret',
      'legacy-client-secret', '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z');
  `);
};

test("retires legacy Relay settings without touching Direct devices", () => {
  setupLegacyDatabase();
  tailscaleRemoteAccessRepository.createDevice({
    id: "direct-device-1",
    userId: 7,
    name: "Direct phone",
    platform: "android",
    publicKey: null,
    permissions: ["threads:read"],
    tokenHash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(hasSqliteTable(getSqlite(), "remote_relay_settings"), true);

  retireLegacyRemoteRelaySettings();

  assert.equal(hasSqliteTable(getSqlite(), "remote_relay_settings"), false);
  assert.deepEqual(
    tailscaleRemoteAccessRepository.listDevices().map((device) => device.id),
    ["direct-device-1"],
  );
  assert.equal(
    tailscaleRemoteAccessRepository.getActiveDeviceById("direct-device-1")
      ?.permissions.includes("threads:read"),
    true,
  );
});

test("legacy Relay retirement is idempotent and never recreates tokens", () => {
  setupLegacyDatabase();

  retireLegacyRemoteRelaySettings();
  retireLegacyRemoteRelaySettings();

  const sqlite = getSqlite();
  assert.equal(hasSqliteTable(sqlite, "remote_relay_settings"), false);
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .all("remote_relay_settings");
  assert.deepEqual(tables, []);
});
