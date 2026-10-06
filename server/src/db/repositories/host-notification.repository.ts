import { randomUUID } from "node:crypto";

import { getSqlite } from "@/db/index.js";
import { decryptSecret, encryptSecret } from "@/utils/crypto.js";
import {
  NOTIFICATION_ELIGIBILITY_EVENT,
  isNotificationEligibleTransition,
  type NotificationCanonicalMessage,
} from "@/services/notification-eligibility.js";

export type HostNotificationIdentityRecord = {
  hostId: string;
  publicKey: string;
  privateKeyPem: string;
  createdAt: string;
  rotatedAt: string | null;
};

export type HostNotificationBindingRequestRecord = {
  nonce: string;
  installationId: string;
  sourceScope: string[];
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

export type HostNotificationBindingRecord = {
  installationId: string;
  brokerBaseUrl: string;
  deliveryToken: string;
  sourceScope: string[];
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
};

export type NotificationOutboxState =
  | "pending"
  | "delivered"
  | "failed"
  | "expired";

export type NotificationOutboxRecord = {
  id: string;
  installationId: string;
  canonicalMessageId: string;
  sourceId: string;
  eligibilityEvent: typeof NOTIFICATION_ELIGIBILITY_EVENT;
  state: NotificationOutboxState;
  attemptCount: number;
  nextAttemptAt: string;
  expiresAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type IdentityRow = {
  host_id: string;
  public_key: string;
  private_key_encrypted: string;
  created_at: string;
  rotated_at: string | null;
};

type BindingRequestRow = {
  nonce: string;
  installation_id: string;
  source_scope_json: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

type BindingRow = {
  installation_id: string;
  broker_base_url: string;
  delivery_token_encrypted: string;
  source_scope_json: string;
  status: "active" | "revoked";
  created_at: string;
  updated_at: string;
};

type OutboxRow = {
  id: string;
  installation_id: string;
  canonical_message_id: string;
  source_id: string;
  eligibility_event: typeof NOTIFICATION_ELIGIBILITY_EVENT;
  state: NotificationOutboxState;
  attempt_count: number;
  next_attempt_at: string;
  expires_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const normalizeSourceScope = (sourceScope: string[]) =>
  Array.from(
    new Set(
      sourceScope
        .map((sourceId) => sourceId.trim())
        .filter(Boolean),
    ),
  ).sort();

const parseSourceScope = (value: string) => {
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new Error("Stored notification source scope is invalid");
  }
  return normalizeSourceScope(parsed);
};

const toIdentityRecord = (
  row: IdentityRow,
): HostNotificationIdentityRecord => ({
  hostId: row.host_id,
  publicKey: row.public_key,
  privateKeyPem: decryptSecret(row.private_key_encrypted),
  createdAt: row.created_at,
  rotatedAt: row.rotated_at,
});

const toBindingRequestRecord = (
  row: BindingRequestRow,
): HostNotificationBindingRequestRecord => ({
  nonce: row.nonce,
  installationId: row.installation_id,
  sourceScope: parseSourceScope(row.source_scope_json),
  expiresAt: row.expires_at,
  consumedAt: row.consumed_at,
  createdAt: row.created_at,
});

const toBindingRecord = (row: BindingRow): HostNotificationBindingRecord => ({
  installationId: row.installation_id,
  brokerBaseUrl: row.broker_base_url,
  deliveryToken: decryptSecret(row.delivery_token_encrypted),
  sourceScope: parseSourceScope(row.source_scope_json),
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toOutboxRecord = (row: OutboxRow): NotificationOutboxRecord => ({
  id: row.id,
  installationId: row.installation_id,
  canonicalMessageId: row.canonical_message_id,
  sourceId: row.source_id,
  eligibilityEvent: row.eligibility_event,
  state: row.state,
  attemptCount: row.attempt_count,
  nextAttemptAt: row.next_attempt_at,
  expiresAt: row.expires_at,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const hostNotificationRepository = {
  getIdentity(): HostNotificationIdentityRecord | null {
    const row = getSqlite()
      .prepare(
        `SELECT host_id, public_key, private_key_encrypted, created_at, rotated_at
         FROM host_notification_identity
         WHERE id = 1`,
      )
      .get() as IdentityRow | undefined;
    return row ? toIdentityRecord(row) : null;
  },

  createIdentity(input: {
    hostId: string;
    publicKey: string;
    privateKeyPem: string;
    now?: string;
  }): HostNotificationIdentityRecord {
    const now = input.now ?? new Date().toISOString();
    const privateKeyEncrypted = encryptSecret(input.privateKeyPem);
    if (!privateKeyEncrypted) {
      throw new Error("Failed to protect Host notification private key");
    }

    getSqlite()
      .prepare(
        `INSERT INTO host_notification_identity (
          id, host_id, public_key, private_key_encrypted, created_at, rotated_at
        ) VALUES (1, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.hostId,
        input.publicKey,
        privateKeyEncrypted,
        now,
      );

    const identity = this.getIdentity();
    if (!identity) throw new Error("Failed to persist Host notification identity");
    return identity;
  },

  createBindingRequest(input: {
    nonce: string;
    installationId: string;
    sourceScope: string[];
    expiresAt: string;
    now?: string;
  }): HostNotificationBindingRequestRecord {
    const sourceScope = normalizeSourceScope(input.sourceScope);
    if (!input.nonce.trim() || !input.installationId.trim() || sourceScope.length === 0) {
      throw new Error("Notification binding request is incomplete");
    }
    const now = input.now ?? new Date().toISOString();
    getSqlite()
      .prepare(
        `INSERT INTO host_notification_binding_requests (
          nonce, installation_id, source_scope_json,
          expires_at, consumed_at, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        input.nonce.trim(),
        input.installationId.trim(),
        JSON.stringify(sourceScope),
        input.expiresAt,
        now,
      );
    const record = this.getBindingRequest(input.nonce);
    if (!record) throw new Error("Failed to persist notification binding request");
    return record;
  },

  getBindingRequest(
    nonce: string,
  ): HostNotificationBindingRequestRecord | null {
    const row = getSqlite()
      .prepare(
        `SELECT nonce, installation_id, source_scope_json,
                expires_at, consumed_at, created_at
         FROM host_notification_binding_requests
         WHERE nonce = ?`,
      )
      .get(nonce) as BindingRequestRow | undefined;
    return row ? toBindingRequestRecord(row) : null;
  },

  acceptBindingCapability(input: {
    nonce: string;
    installationId: string;
    brokerBaseUrl: string;
    deliveryToken: string;
    sourceScope: string[];
    now?: string;
  }): HostNotificationBindingRecord {
    const now = input.now ?? new Date().toISOString();
    const normalizedScope = normalizeSourceScope(input.sourceScope);

    return getSqlite().transaction(() => {
      const request = this.getBindingRequest(input.nonce);
      if (!request) {
        throw new Error("Notification binding request was not found");
      }
      if (request.consumedAt) {
        throw new Error("Notification binding request was already consumed");
      }
      if (Date.parse(request.expiresAt) <= Date.parse(now)) {
        throw new Error("Notification binding request has expired");
      }
      if (request.installationId !== input.installationId.trim()) {
        throw new Error("Notification binding installation does not match request");
      }
      if (JSON.stringify(request.sourceScope) !== JSON.stringify(normalizedScope)) {
        throw new Error("Notification binding source scope does not match request");
      }

      const binding = this.upsertBinding({
        installationId: input.installationId,
        brokerBaseUrl: input.brokerBaseUrl,
        deliveryToken: input.deliveryToken,
        sourceScope: normalizedScope,
        now,
      });
      getSqlite()
        .prepare(
          `UPDATE host_notification_binding_requests
           SET consumed_at = ?
           WHERE nonce = ? AND consumed_at IS NULL`,
        )
        .run(now, input.nonce);
      return binding;
    })();
  },

  upsertBinding(input: {
    installationId: string;
    brokerBaseUrl: string;
    deliveryToken: string;
    sourceScope: string[];
    now?: string;
  }): HostNotificationBindingRecord {
    const now = input.now ?? new Date().toISOString();
    const sourceScope = normalizeSourceScope(input.sourceScope);
    if (
      !input.installationId.trim() ||
      !input.brokerBaseUrl.trim() ||
      !input.deliveryToken.trim() ||
      sourceScope.length === 0
    ) {
      throw new Error("Notification binding is incomplete");
    }

    const encrypted = encryptSecret(input.deliveryToken.trim());
    if (!encrypted) {
      throw new Error("Failed to protect notification delivery token");
    }

    getSqlite()
      .prepare(
        `INSERT INTO host_notification_bindings (
          installation_id, broker_base_url, delivery_token_encrypted,
          source_scope_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(installation_id) DO UPDATE SET
          broker_base_url = excluded.broker_base_url,
          delivery_token_encrypted = excluded.delivery_token_encrypted,
          source_scope_json = excluded.source_scope_json,
          status = 'active',
          updated_at = excluded.updated_at`,
      )
      .run(
        input.installationId.trim(),
        input.brokerBaseUrl.trim().replace(/\/+$/u, ""),
        encrypted,
        JSON.stringify(sourceScope),
        now,
        now,
      );

    const record = this.getBinding(input.installationId);
    if (!record) throw new Error("Failed to persist notification binding");
    return record;
  },

  getBinding(installationId: string): HostNotificationBindingRecord | null {
    const row = getSqlite()
      .prepare(
        `SELECT installation_id, broker_base_url, delivery_token_encrypted,
                source_scope_json, status, created_at, updated_at
         FROM host_notification_bindings
         WHERE installation_id = ?`,
      )
      .get(installationId) as BindingRow | undefined;
    return row ? toBindingRecord(row) : null;
  },

  revokeBinding(installationId: string, now = new Date().toISOString()) {
    const result = getSqlite()
      .prepare(
        `UPDATE host_notification_bindings
         SET status = 'revoked', updated_at = ?
         WHERE installation_id = ? AND status = 'active'`,
      )
      .run(now, installationId);
    return result.changes > 0;
  },

  listActiveBindingsForSource(
    sourceId: string,
  ): HostNotificationBindingRecord[] {
    const rows = getSqlite()
      .prepare(
        `SELECT installation_id, broker_base_url, delivery_token_encrypted,
                source_scope_json, status, created_at, updated_at
         FROM host_notification_bindings
         WHERE status = 'active'
         ORDER BY installation_id ASC`,
      )
      .all() as BindingRow[];

    return rows
      .map(toBindingRecord)
      .filter((binding) => binding.sourceScope.includes(sourceId));
  },

  enqueueEligibleTransition(input: {
    previous: NotificationCanonicalMessage | null;
    next: NotificationCanonicalMessage;
    sourceId: string;
    now?: string;
    ttlMs?: number;
  }): NotificationOutboxRecord[] {
    if (!isNotificationEligibleTransition(input.previous, input.next)) {
      return [];
    }

    const nowMs = input.now ? Date.parse(input.now) : Date.now();
    if (!Number.isFinite(nowMs)) {
      throw new Error("Notification outbox now timestamp is invalid");
    }
    const now = new Date(nowMs).toISOString();
    const expiresAt = new Date(
      nowMs + (input.ttlMs ?? 24 * 60 * 60 * 1000),
    ).toISOString();

    const bindings = this.listActiveBindingsForSource(input.sourceId);
    const insert = getSqlite().prepare(
      `INSERT OR IGNORE INTO notification_outbox (
        id, installation_id, canonical_message_id, source_id,
        eligibility_event, state, attempt_count, next_attempt_at,
        expires_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL, ?, ?)`,
    );

    const created: NotificationOutboxRecord[] = [];
    for (const binding of bindings) {
      const id = randomUUID();
      const result = insert.run(
        id,
        binding.installationId,
        input.next.id,
        input.sourceId,
        NOTIFICATION_ELIGIBILITY_EVENT,
        now,
        expiresAt,
        now,
        now,
      );
      if (result.changes > 0) {
        const row = getSqlite()
          .prepare(
            `SELECT id, installation_id, canonical_message_id, source_id,
                    eligibility_event, state, attempt_count, next_attempt_at,
                    expires_at, last_error, created_at, updated_at
             FROM notification_outbox WHERE id = ?`,
          )
          .get(id) as OutboxRow | undefined;
        if (row) created.push(toOutboxRecord(row));
      }
    }
    return created;
  },

  listPending(now = new Date().toISOString(), limit = 100) {
    const rows = getSqlite()
      .prepare(
        `SELECT id, installation_id, canonical_message_id, source_id,
                eligibility_event, state, attempt_count, next_attempt_at,
                expires_at, last_error, created_at, updated_at
         FROM notification_outbox
         WHERE state = 'pending'
           AND next_attempt_at <= ?
           AND expires_at > ?
         ORDER BY next_attempt_at ASC, created_at ASC
         LIMIT ?`,
      )
      .all(now, now, limit) as OutboxRow[];
    return rows.map(toOutboxRecord);
  },
};
