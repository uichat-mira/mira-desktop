import { getSqlite } from "../index.js";
import { hasSqliteColumn } from "../sqlite-utils.js";

export const REMOTE_DEVICE_SCOPES = [
  "threads:read",
  "messages:read",
  "messages:write",
  "agent:read",
  "agent:approve",
  "agent:control",
  "tools:read",
  "tools:invoke",
  "tools:approve",
  "tools:control",
  "artifacts:read",
] as const;

export type RemoteDeviceScope = (typeof REMOTE_DEVICE_SCOPES)[number];

export const REMOTE_PAIRING_TRANSPORTS = ["relay", "direct"] as const;
export type RemotePairingTransport =
  (typeof REMOTE_PAIRING_TRANSPORTS)[number];

export type TailscaleRemoteAccessConfig = {
  enabled: boolean;
  servePort: number;
  updatedAt: string | null;
};

export type TailscalePairedDevice = {
  id: string;
  name: string;
  platform: string;
  permissions: RemoteDeviceScope[];
  createdAt: string;
  lastSeenAt: string | null;
};

export type RemoteDeviceRecord = TailscalePairedDevice & {
  userId: number;
  publicKey: string | null;
  tokenHash: string;
};

export type PairingChallengeStatus =
  | "pending"
  | "claimed"
  | "approved"
  | "rejected"
  | "delivered"
  | "expired";

export type PairingChallengeRecord = {
  id: string;
  userId: number;
  status: PairingChallengeStatus;
  codeHash: string;
  hostUrl: string;
  createdAt: string;
  expiresAt: string;
  claimId: string | null;
  claimTokenHash: string | null;
  deviceName: string | null;
  platform: string | null;
  claimTransport: RemotePairingTransport | null;
  publicKey: string | null;
  requestedScopes: RemoteDeviceScope[];
  approvedScopes: RemoteDeviceScope[];
  credentialEncrypted: string | null;
  deviceId: string | null;
  attempts: number;
  claimedAt: string | null;
  resolvedAt: string | null;
  deliveredAt: string | null;
};

type ConfigRow = {
  enabled: number;
  serve_port: number;
  updated_at: string | null;
};

type DeviceRow = {
  id: string;
  user_id: number;
  name: string;
  platform: string;
  public_key: string | null;
  permissions_json: string;
  token_hash: string | null;
  created_at: string;
  last_seen_at: string | null;
};

type PairingChallengeRow = {
  id: string;
  user_id: number;
  status: string;
  code_hash: string;
  host_url: string;
  created_at: string;
  expires_at: string;
  claim_id: string | null;
  claim_token_hash: string | null;
  device_name: string | null;
  platform: string | null;
  claim_transport: string | null;
  public_key: string | null;
  requested_scopes_json: string;
  approved_scopes_json: string;
  credential_encrypted: string | null;
  device_id: string | null;
  attempts: number;
  claimed_at: string | null;
  resolved_at: string | null;
  delivered_at: string | null;
};

const DEFAULT_SERVE_PORT = 443;

const normalizeServePort = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SERVE_PORT;
  }

  const port = Math.trunc(value);
  return port >= 1 && port <= 65535 ? port : DEFAULT_SERVE_PORT;
};

const isRemoteDeviceScope = (value: unknown): value is RemoteDeviceScope =>
  typeof value === "string" &&
  (REMOTE_DEVICE_SCOPES as readonly string[]).includes(value);

const parseScopes = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isRemoteDeviceScope)
      : [];
  } catch {
    return [];
  }
};

const normalizeScopes = (value: readonly string[]) =>
  Array.from(new Set(value.filter(isRemoteDeviceScope)));

const normalizeChallengeStatus = (value: string): PairingChallengeStatus => {
  if (
    value === "pending" ||
    value === "claimed" ||
    value === "approved" ||
    value === "rejected" ||
    value === "delivered" ||
    value === "expired"
  ) {
    return value;
  }
  return "expired";
};

const normalizePairingTransport = (
  value: unknown,
): RemotePairingTransport | null =>
  value === "relay" || value === "direct" ? value : null;

const ensureDeviceColumns = () => {
  const sqlite = getSqlite();

  if (!hasSqliteColumn(sqlite, "tailscale_remote_devices", "user_id")) {
    sqlite.exec(
      "ALTER TABLE tailscale_remote_devices ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!hasSqliteColumn(sqlite, "tailscale_remote_devices", "public_key")) {
    sqlite.exec(
      "ALTER TABLE tailscale_remote_devices ADD COLUMN public_key TEXT",
    );
  }
  if (!hasSqliteColumn(sqlite, "tailscale_remote_devices", "token_hash")) {
    sqlite.exec(
      "ALTER TABLE tailscale_remote_devices ADD COLUMN token_hash TEXT",
    );
  }
};

const ensurePairingChallengeColumns = () => {
  const sqlite = getSqlite();
  if (
    !hasSqliteColumn(
      sqlite,
      "tailscale_pairing_challenges",
      "claim_transport",
    )
  ) {
    sqlite.exec(
      "ALTER TABLE tailscale_pairing_challenges ADD COLUMN claim_transport TEXT",
    );
  }
};

const ensureTables = () => {
  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tailscale_remote_access_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      serve_port INTEGER NOT NULL DEFAULT 443,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tailscale_remote_devices (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'unknown',
      public_key TEXT,
      permissions_json TEXT NOT NULL DEFAULT '[]',
      token_hash TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tailscale_pairing_challenges (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      code_hash TEXT NOT NULL,
      host_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      claim_id TEXT UNIQUE,
      claim_token_hash TEXT,
      device_name TEXT,
      platform TEXT,
      claim_transport TEXT,
      public_key TEXT,
      requested_scopes_json TEXT NOT NULL DEFAULT '[]',
      approved_scopes_json TEXT NOT NULL DEFAULT '[]',
      credential_encrypted TEXT,
      device_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT,
      resolved_at TEXT,
      delivered_at TEXT
    );
  `);

  ensureDeviceColumns();
  ensurePairingChallengeColumns();
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tailscale_remote_devices_token_hash
      ON tailscale_remote_devices(token_hash)
      WHERE token_hash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tailscale_remote_devices_user
      ON tailscale_remote_devices(user_id, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_tailscale_pairing_challenges_user
      ON tailscale_pairing_challenges(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tailscale_pairing_claim_id
      ON tailscale_pairing_challenges(claim_id)
      WHERE claim_id IS NOT NULL;
  `);

  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO tailscale_remote_access_settings
       (id, enabled, serve_port, created_at, updated_at)
       VALUES (1, 0, ?, ?, NULL)`,
    )
    .run(DEFAULT_SERVE_PORT, now);
};

const toConfig = (row: ConfigRow): TailscaleRemoteAccessConfig => ({
  enabled: row.enabled === 1,
  servePort: normalizeServePort(row.serve_port),
  updatedAt: row.updated_at,
});

const toDevice = (row: DeviceRow): TailscalePairedDevice => ({
  id: row.id,
  name: row.name,
  platform: row.platform,
  permissions: parseScopes(row.permissions_json),
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
});

const toDeviceRecord = (row: DeviceRow): RemoteDeviceRecord | null => {
  if (!row.token_hash || row.user_id <= 0) {
    return null;
  }

  return {
    ...toDevice(row),
    userId: row.user_id,
    publicKey: row.public_key,
    tokenHash: row.token_hash,
  };
};

const toPairingChallenge = (
  row: PairingChallengeRow,
): PairingChallengeRecord => ({
  id: row.id,
  userId: row.user_id,
  status: normalizeChallengeStatus(row.status),
  codeHash: row.code_hash,
  hostUrl: row.host_url,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  claimId: row.claim_id,
  claimTokenHash: row.claim_token_hash,
  deviceName: row.device_name,
  platform: row.platform,
  claimTransport: normalizePairingTransport(row.claim_transport),
  publicKey: row.public_key,
  requestedScopes: parseScopes(row.requested_scopes_json),
  approvedScopes: parseScopes(row.approved_scopes_json),
  credentialEncrypted: row.credential_encrypted,
  deviceId: row.device_id,
  attempts: row.attempts,
  claimedAt: row.claimed_at,
  resolvedAt: row.resolved_at,
  deliveredAt: row.delivered_at,
});

const selectChallengeBy = (
  column: "id" | "claim_id",
  value: string,
): PairingChallengeRecord | null => {
  ensureTables();
  const row = getSqlite()
    .prepare(
      `SELECT * FROM tailscale_pairing_challenges WHERE ${column} = ? LIMIT 1`,
    )
    .get(value) as PairingChallengeRow | undefined;
  return row ? toPairingChallenge(row) : null;
};

export const tailscaleRemoteAccessRepository = {
  initialize() {
    ensureTables();
  },

  getConfig(): TailscaleRemoteAccessConfig {
    ensureTables();
    const row = getSqlite()
      .prepare(
        `SELECT enabled, serve_port, updated_at
         FROM tailscale_remote_access_settings
         WHERE id = 1`,
      )
      .get() as ConfigRow | undefined;

    if (!row) {
      throw new Error("Failed to initialize Tailscale remote access settings");
    }

    return toConfig(row);
  },

  updateConfig(
    input: Partial<Pick<TailscaleRemoteAccessConfig, "enabled" | "servePort">>,
  ): TailscaleRemoteAccessConfig {
    const current = this.getConfig();
    const nextEnabled =
      typeof input.enabled === "boolean" ? input.enabled : current.enabled;
    const nextServePort =
      typeof input.servePort === "number"
        ? normalizeServePort(input.servePort)
        : current.servePort;
    const updatedAt = new Date().toISOString();

    getSqlite()
      .prepare(
        `UPDATE tailscale_remote_access_settings
         SET enabled = ?, serve_port = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(nextEnabled ? 1 : 0, nextServePort, updatedAt);

    return this.getConfig();
  },

  listDevices(userId?: number): TailscalePairedDevice[] {
    ensureTables();
    const rows = (
      typeof userId === "number"
        ? getSqlite()
            .prepare(
              `SELECT id, user_id, name, platform, public_key, permissions_json,
                      token_hash, created_at, last_seen_at
               FROM tailscale_remote_devices
               WHERE user_id = ? AND revoked_at IS NULL
               ORDER BY COALESCE(last_seen_at, created_at) DESC`,
            )
            .all(userId)
        : getSqlite()
            .prepare(
              `SELECT id, user_id, name, platform, public_key, permissions_json,
                      token_hash, created_at, last_seen_at
               FROM tailscale_remote_devices
               WHERE revoked_at IS NULL
               ORDER BY COALESCE(last_seen_at, created_at) DESC`,
            )
            .all()
    ) as DeviceRow[];

    return rows.map(toDevice);
  },

  createDevice(input: {
    id: string;
    userId: number;
    name: string;
    platform: string;
    publicKey?: string | null;
    permissions: readonly RemoteDeviceScope[];
    tokenHash: string;
    createdAt: string;
  }): RemoteDeviceRecord {
    ensureTables();
    getSqlite()
      .prepare(
        `INSERT INTO tailscale_remote_devices (
          id, user_id, name, platform, public_key, permissions_json,
          token_hash, created_at, last_seen_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(
        input.id,
        input.userId,
        input.name,
        input.platform,
        input.publicKey ?? null,
        JSON.stringify(normalizeScopes(input.permissions)),
        input.tokenHash,
        input.createdAt,
      );

    const created = this.getActiveDeviceById(input.id);
    if (!created) {
      throw new Error("Failed to create remote device");
    }
    return created;
  },

  getActiveDeviceById(id: string): RemoteDeviceRecord | null {
    ensureTables();
    const row = getSqlite()
      .prepare(
        `SELECT id, user_id, name, platform, public_key, permissions_json,
                token_hash, created_at, last_seen_at
         FROM tailscale_remote_devices
         WHERE id = ? AND revoked_at IS NULL
         LIMIT 1`,
      )
      .get(id) as DeviceRow | undefined;
    return row ? toDeviceRecord(row) : null;
  },

  touchDevice(id: string, at = new Date().toISOString()) {
    ensureTables();
    getSqlite()
      .prepare(
        `UPDATE tailscale_remote_devices
         SET last_seen_at = ?
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(at, id);
  },

  revokeDevice(id: string, userId?: number): boolean {
    ensureTables();
    const result =
      typeof userId === "number"
        ? getSqlite()
            .prepare(
              `UPDATE tailscale_remote_devices
               SET revoked_at = ?
               WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
            )
            .run(new Date().toISOString(), id, userId)
        : getSqlite()
            .prepare(
              `UPDATE tailscale_remote_devices
               SET revoked_at = ?
               WHERE id = ? AND revoked_at IS NULL`,
            )
            .run(new Date().toISOString(), id);

    return result.changes > 0;
  },

  createPairingChallenge(input: {
    id: string;
    userId: number;
    codeHash: string;
    hostUrl: string;
    createdAt: string;
    expiresAt: string;
  }): PairingChallengeRecord {
    ensureTables();
    getSqlite()
      .prepare(
        `INSERT INTO tailscale_pairing_challenges (
          id, user_id, status, code_hash, host_url, created_at, expires_at
        ) VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.userId,
        input.codeHash,
        input.hostUrl,
        input.createdAt,
        input.expiresAt,
      );

    const created = this.getPairingChallengeById(input.id);
    if (!created) {
      throw new Error("Failed to create pairing challenge");
    }
    return created;
  },

  getPairingChallengeById(id: string) {
    return selectChallengeBy("id", id);
  },

  getPairingChallengeByClaimId(claimId: string) {
    return selectChallengeBy("claim_id", claimId);
  },

  incrementPairingAttempts(id: string) {
    ensureTables();
    getSqlite()
      .prepare(
        `UPDATE tailscale_pairing_challenges
         SET attempts = attempts + 1
         WHERE id = ? AND status = 'pending'`,
      )
      .run(id);
  },

  claimPairingChallenge(input: {
    id: string;
    claimId: string;
    claimTokenHash: string;
    deviceName: string;
    platform: string;
    transport?: RemotePairingTransport | null;
    publicKey?: string | null;
    requestedScopes: readonly RemoteDeviceScope[];
    claimedAt: string;
  }): PairingChallengeRecord | null {
    ensureTables();
    const result = getSqlite()
      .prepare(
        `UPDATE tailscale_pairing_challenges
         SET status = 'claimed',
             claim_id = ?,
             claim_token_hash = ?,
             device_name = ?,
             platform = ?,
             claim_transport = ?,
             public_key = ?,
             requested_scopes_json = ?,
             claimed_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(
        input.claimId,
        input.claimTokenHash,
        input.deviceName,
        input.platform,
        normalizePairingTransport(input.transport),
        input.publicKey ?? null,
        JSON.stringify(normalizeScopes(input.requestedScopes)),
        input.claimedAt,
        input.id,
      );

    return result.changes > 0 ? this.getPairingChallengeById(input.id) : null;
  },

  approvePairingChallenge(input: {
    claimId: string;
    userId: number;
    approvedScopes: readonly RemoteDeviceScope[];
    credentialEncrypted: string;
    deviceId: string;
    resolvedAt: string;
  }): PairingChallengeRecord | null {
    ensureTables();
    const result = getSqlite()
      .prepare(
        `UPDATE tailscale_pairing_challenges
         SET status = 'approved',
             approved_scopes_json = ?,
             credential_encrypted = ?,
             device_id = ?,
             resolved_at = ?
         WHERE claim_id = ? AND user_id = ? AND status = 'claimed'`,
      )
      .run(
        JSON.stringify(normalizeScopes(input.approvedScopes)),
        input.credentialEncrypted,
        input.deviceId,
        input.resolvedAt,
        input.claimId,
        input.userId,
      );

    return result.changes > 0
      ? this.getPairingChallengeByClaimId(input.claimId)
      : null;
  },

  rejectPairingChallenge(input: {
    claimId: string;
    userId: number;
    resolvedAt: string;
  }): PairingChallengeRecord | null {
    ensureTables();
    const result = getSqlite()
      .prepare(
        `UPDATE tailscale_pairing_challenges
         SET status = 'rejected', resolved_at = ?
         WHERE claim_id = ? AND user_id = ? AND status = 'claimed'`,
      )
      .run(input.resolvedAt, input.claimId, input.userId);

    return result.changes > 0
      ? this.getPairingChallengeByClaimId(input.claimId)
      : null;
  },

  consumePairingCredential(input: {
    claimId: string;
    deliveredAt: string;
  }): PairingChallengeRecord | null {
    ensureTables();
    const current = this.getPairingChallengeByClaimId(input.claimId);
    if (!current || current.status !== "approved" || !current.credentialEncrypted) {
      return null;
    }

    const result = getSqlite()
      .prepare(
        `UPDATE tailscale_pairing_challenges
         SET status = 'delivered', credential_encrypted = NULL, delivered_at = ?
         WHERE claim_id = ? AND status = 'approved' AND credential_encrypted = ?`,
      )
      .run(input.deliveredAt, input.claimId, current.credentialEncrypted);

    return result.changes === 1 ? current : null;
  },

  expirePairingChallenge(id: string, at = new Date().toISOString()) {
    ensureTables();
    getSqlite()
      .prepare(
        `UPDATE tailscale_pairing_challenges
         SET status = 'expired', resolved_at = COALESCE(resolved_at, ?),
             credential_encrypted = NULL
         WHERE id = ? AND status IN ('pending', 'claimed', 'approved')`,
      )
      .run(at, id);
    return this.getPairingChallengeById(id);
  },
};
