import { createPrivateKey, randomUUID, sign as signBytes } from "node:crypto";

import { getSqlite } from "@/db/index.js";
import { decryptSecret, encryptSecret } from "@/utils/crypto.js";
import {
  NOTIFICATION_ELIGIBILITY_EVENT,
  isNotificationEligibleTransition,
  isNotificationUserVisibleFinal,
  type NotificationCanonicalMessage,
} from "@/services/notification-eligibility.js";

export type HostNotificationIdentityRecord = {
  hostId: string;
  publicKey: string;
  createdAt: string;
  rotatedAt: string | null;
};

export type HostNotificationBindingRequestRecord = {
  nonce: string;
  installationId: string;
  originRemoteDeviceId: string;
  ownerUserId: number;
  sourceScope: string[];
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

export type HostNotificationBindingErrorCode =
  | "REQUEST_NOT_FOUND"
  | "REQUEST_CONSUMED"
  | "REQUEST_EXPIRED"
  | "INSTALLATION_MISMATCH"
  | "AUTHORITY_MISMATCH"
  | "SOURCE_SCOPE_MISMATCH"
  | "INSTALLATION_BOUND_TO_ANOTHER_DEVICE";

export class HostNotificationBindingError extends Error {
  constructor(
    public readonly code: HostNotificationBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HostNotificationBindingError";
  }
}

export type HostNotificationBindingRecord = {
  installationId: string;
  originRemoteDeviceId: string;
  ownerUserId: number;
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
  origin_remote_device_id: string;
  owner_user_id: number;
  source_scope_json: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

type BindingRow = {
  installation_id: string;
  origin_remote_device_id: string;
  owner_user_id: number;
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
  ).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

const parseSourceScope = (value: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Stored notification source scope is invalid");
  }

  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new Error("Stored notification source scope is invalid");
  }
  return normalizeSourceScope(parsed);
};

const toIdentityRecord = (
  row: Pick<IdentityRow, "host_id" | "public_key" | "created_at" | "rotated_at">,
): HostNotificationIdentityRecord => ({
  hostId: row.host_id,
  publicKey: row.public_key,
  createdAt: row.created_at,
  rotatedAt: row.rotated_at,
});

const toBindingRequestRecord = (
  row: BindingRequestRow,
): HostNotificationBindingRequestRecord => ({
  nonce: row.nonce,
  installationId: row.installation_id,
  originRemoteDeviceId: row.origin_remote_device_id,
  ownerUserId: row.owner_user_id,
  sourceScope: parseSourceScope(row.source_scope_json),
  expiresAt: row.expires_at,
  consumedAt: row.consumed_at,
  createdAt: row.created_at,
});

const toBindingRecord = (row: BindingRow): HostNotificationBindingRecord => ({
  installationId: row.installation_id,
  originRemoteDeviceId: row.origin_remote_device_id,
  ownerUserId: row.owner_user_id,
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
        `SELECT host_id, public_key, created_at, rotated_at
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

  signWithIdentityPrivateKey(payload: Uint8Array) {
    const row = getSqlite()
      .prepare(
        `SELECT private_key_encrypted
         FROM host_notification_identity
         WHERE id = 1`,
      )
      .get() as Pick<IdentityRow, "private_key_encrypted"> | undefined;
    if (!row) {
      throw new Error("Host notification identity is not initialized");
    }

    let privateKeyPem = decryptSecret(row.private_key_encrypted);
    try {
      return signBytes(
        null,
        Buffer.from(payload),
        createPrivateKey(privateKeyPem),
      ).toString("base64url");
    } finally {
      // Keep plaintext lifetime bounded to this one signing call. JS strings are
      // immutable, so this is reference release rather than guaranteed zeroization.
      privateKeyPem = "";
    }
  },

  createBindingRequest(input: {
    nonce: string;
    installationId: string;
    originRemoteDeviceId: string;
    ownerUserId: number;
    sourceScope: string[];
    expiresAt: string;
    now?: string;
  }): HostNotificationBindingRequestRecord {
    const sourceScope = normalizeSourceScope(input.sourceScope);
    if (
      !input.nonce.trim() ||
      !input.installationId.trim() ||
      !input.originRemoteDeviceId.trim() ||
      !Number.isInteger(input.ownerUserId) ||
      sourceScope.length === 0
    ) {
      throw new Error("Notification binding request is incomplete");
    }
    const now = input.now ?? new Date().toISOString();
    getSqlite().transaction(() => {
      // Keep bootstrap storage bounded to one durable request per paired
      // device. Replacing the row also makes every older nonce unusable.
      getSqlite()
        .prepare(
          "DELETE FROM host_notification_binding_requests WHERE origin_remote_device_id = ?",
        )
        .run(input.originRemoteDeviceId.trim());

      getSqlite()
        .prepare(
          `INSERT INTO host_notification_binding_requests (
            nonce, installation_id, origin_remote_device_id, owner_user_id,
            source_scope_json, expires_at, consumed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          input.nonce.trim(),
          input.installationId.trim(),
          input.originRemoteDeviceId.trim(),
          input.ownerUserId,
          JSON.stringify(sourceScope),
          input.expiresAt,
          now,
        );
    })();
    const record = this.getBindingRequest(input.nonce);
    if (!record) throw new Error("Failed to persist notification binding request");
    return record;
  },

  getBindingRequest(
    nonce: string,
  ): HostNotificationBindingRequestRecord | null {
    const row = getSqlite()
      .prepare(
        `SELECT nonce, installation_id, origin_remote_device_id, owner_user_id,
                source_scope_json, expires_at, consumed_at, created_at
         FROM host_notification_binding_requests
         WHERE nonce = ?`,
      )
      .get(nonce) as BindingRequestRow | undefined;
    return row ? toBindingRequestRecord(row) : null;
  },

  acceptBindingCapability(input: {
    nonce: string;
    installationId: string;
    originRemoteDeviceId: string;
    ownerUserId: number;
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
        throw new HostNotificationBindingError(
          "REQUEST_NOT_FOUND",
          "Notification binding request was not found",
        );
      }
      if (request.consumedAt) {
        throw new HostNotificationBindingError(
          "REQUEST_CONSUMED",
          "Notification binding request was already consumed",
        );
      }
      if (Date.parse(request.expiresAt) <= Date.parse(now)) {
        throw new HostNotificationBindingError(
          "REQUEST_EXPIRED",
          "Notification binding request has expired",
        );
      }
      if (request.installationId !== input.installationId.trim()) {
        throw new HostNotificationBindingError(
          "INSTALLATION_MISMATCH",
          "Notification binding installation does not match request",
        );
      }
      if (
        request.originRemoteDeviceId !== input.originRemoteDeviceId.trim() ||
        request.ownerUserId !== input.ownerUserId
      ) {
        throw new HostNotificationBindingError(
          "AUTHORITY_MISMATCH",
          "Notification binding authority does not match request",
        );
      }
      if (JSON.stringify(request.sourceScope) !== JSON.stringify(normalizedScope)) {
        throw new HostNotificationBindingError(
          "SOURCE_SCOPE_MISMATCH",
          "Notification binding source scope does not match request",
        );
      }

      const binding = this.upsertBinding({
        installationId: input.installationId,
        originRemoteDeviceId: input.originRemoteDeviceId,
        ownerUserId: input.ownerUserId,
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
    originRemoteDeviceId: string;
    ownerUserId: number;
    brokerBaseUrl: string;
    deliveryToken: string;
    sourceScope: string[];
    now?: string;
  }): HostNotificationBindingRecord {
    const now = input.now ?? new Date().toISOString();
    const sourceScope = normalizeSourceScope(input.sourceScope);
    if (
      !input.installationId.trim() ||
      !input.originRemoteDeviceId.trim() ||
      !Number.isInteger(input.ownerUserId) ||
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

    getSqlite().transaction(() => {
      // A paired device owns at most one active Mobile installation binding.
      // Reinstall/rebind replaces its prior installation capability.
      getSqlite()
        .prepare(
          `UPDATE host_notification_bindings
           SET status = 'revoked', updated_at = ?
           WHERE origin_remote_device_id = ?
             AND installation_id <> ?
             AND status = 'active'`,
        )
        .run(now, input.originRemoteDeviceId.trim(), input.installationId.trim());

      const existing = this.getBinding(input.installationId);
      if (
        existing &&
        (existing.originRemoteDeviceId !== input.originRemoteDeviceId.trim() ||
          existing.ownerUserId !== input.ownerUserId)
      ) {
        throw new HostNotificationBindingError(
          "INSTALLATION_BOUND_TO_ANOTHER_DEVICE",
          "Notification installation is bound to another device",
        );
      }

      getSqlite()
        .prepare(
          `INSERT INTO host_notification_bindings (
            installation_id, origin_remote_device_id, owner_user_id,
            broker_base_url, delivery_token_encrypted,
            source_scope_json, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
          ON CONFLICT(installation_id) DO UPDATE SET
            broker_base_url = excluded.broker_base_url,
            delivery_token_encrypted = excluded.delivery_token_encrypted,
            source_scope_json = excluded.source_scope_json,
            status = 'active',
            updated_at = excluded.updated_at`,
        )
        .run(
          input.installationId.trim(),
          input.originRemoteDeviceId.trim(),
          input.ownerUserId,
          input.brokerBaseUrl.trim().replace(/\/+$/u, ""),
          encrypted,
          JSON.stringify(sourceScope),
          now,
          now,
        );

      getSqlite()
        .prepare(
          "DELETE FROM host_notification_binding_scopes WHERE installation_id = ?",
        )
        .run(input.installationId.trim());
      const insertScope = getSqlite().prepare(
        `INSERT INTO host_notification_binding_scopes (
          installation_id, source_id
        ) VALUES (?, ?)`,
      );
      for (const sourceId of sourceScope) {
        insertScope.run(input.installationId.trim(), sourceId);
      }
    })();

    const record = this.getBinding(input.installationId);
    if (!record) throw new Error("Failed to persist notification binding");
    return record;
  },

  getBinding(installationId: string): HostNotificationBindingRecord | null {
    const row = getSqlite()
      .prepare(
        `SELECT installation_id, origin_remote_device_id, owner_user_id,
                broker_base_url, delivery_token_encrypted,
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

  revokeBindingsForRemoteDevice(
    remoteDeviceId: string,
    ownerUserId: number,
    now = new Date().toISOString(),
  ) {
    const result = getSqlite()
      .prepare(
        `UPDATE host_notification_bindings
         SET status = 'revoked', updated_at = ?
         WHERE origin_remote_device_id = ?
           AND owner_user_id = ?
           AND status = 'active'`,
      )
      .run(now, remoteDeviceId, ownerUserId);
    return result.changes;
  },

  listActiveBindingsForSource(
    sourceId: string,
  ): HostNotificationBindingRecord[] {
    const rows = getSqlite()
      .prepare(
        `SELECT b.installation_id, b.origin_remote_device_id, b.owner_user_id,
                b.broker_base_url, b.delivery_token_encrypted,
                b.source_scope_json, b.status, b.created_at, b.updated_at
         FROM host_notification_bindings b
         JOIN host_notification_binding_scopes s
           ON s.installation_id = b.installation_id
         WHERE b.status = 'active'
           AND s.source_id = ?
         ORDER BY b.installation_id ASC`,
      )
      .all(sourceId) as BindingRow[];

    return rows.map(toBindingRecord);
  },

  listActiveInstallationIdsForSource(sourceId: string): string[] {
    const rows = getSqlite()
      .prepare(
        `SELECT b.installation_id
         FROM host_notification_bindings b
         JOIN host_notification_binding_scopes s
           ON s.installation_id = b.installation_id
         WHERE b.status = 'active'
           AND s.source_id = ?
         ORDER BY b.installation_id ASC`,
      )
      .all(sourceId) as Array<{ installation_id: string }>;

    return rows.map((row) => row.installation_id);
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

    // Canonical persistence only needs opaque installation identity. Do not
    // decrypt delivery capabilities on the message transaction path; a corrupt
    // or rotated token must not be able to roll back the Assistant message.
    const installationIds = this.listActiveInstallationIdsForSource(input.sourceId);
    const insert = getSqlite().prepare(
      `INSERT OR IGNORE INTO notification_outbox (
        id, installation_id, canonical_message_id, source_id,
        eligibility_event, state, attempt_count, next_attempt_at,
        expires_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL, ?, ?)`,
    );

    const created: NotificationOutboxRecord[] = [];
    for (const installationId of installationIds) {
      const id = randomUUID();
      const result = insert.run(
        id,
        installationId,
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

  isCanonicalDeliveryEligible(
    event: NotificationOutboxRecord,
    binding: HostNotificationBindingRecord,
  ) {
    if (!binding.sourceScope.includes(event.sourceId)) return false;

    const row = getSqlite()
      .prepare(
        `SELECT m.id, m.role, m.content, m.parts_json, m.metadata,
                m.thread_id, t.status AS thread_status, t.user_id AS owner_user_id
         FROM messages m
         JOIN threads t ON t.id = m.thread_id
         JOIN tailscale_remote_devices d
           ON d.id = ?
          AND d.user_id = ?
          AND d.revoked_at IS NULL
         WHERE m.id = ?
           AND m.thread_id = ?
           AND t.user_id = ?
         LIMIT 1`,
      )
      .get(
        binding.originRemoteDeviceId,
        binding.ownerUserId,
        event.canonicalMessageId,
        event.sourceId,
        binding.ownerUserId,
      ) as
      | {
          id: string;
          role: string;
          content: string;
          parts_json: string | null;
          metadata: string | null;
          thread_id: string;
          thread_status: string;
          owner_user_id: number;
        }
      | undefined;

    if (!row || row.thread_status !== "active") return false;

    let metadata: Record<string, unknown> = {};
    if (row.metadata) {
      try {
        const parsed = JSON.parse(row.metadata) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        return false;
      }
    }

    let parts: Array<{ type: string; text?: string }> = [];
    if (row.parts_json) {
      try {
        const parsed = JSON.parse(row.parts_json) as unknown;
        if (!Array.isArray(parsed)) return false;
        parts = parsed.flatMap((part) => {
          if (!part || typeof part !== "object" || Array.isArray(part)) return [];
          const record = part as Record<string, unknown>;
          if (typeof record.type !== "string") return [];
          return [
            {
              type: record.type,
              ...(typeof record.text === "string" ? { text: record.text } : {}),
            },
          ];
        });
      } catch {
        return false;
      }
    }

    return isNotificationUserVisibleFinal({
      id: row.id,
      role: row.role,
      content: row.content,
      parts,
      metadata,
    });
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

  expireDue(now = new Date().toISOString()) {
    const result = getSqlite()
      .prepare(
        `UPDATE notification_outbox
         SET state = 'expired', updated_at = ?
         WHERE state = 'pending' AND expires_at <= ?`,
      )
      .run(now, now);
    return result.changes;
  },

  markExpired(
    id: string,
    reason: string,
    now = new Date().toISOString(),
  ) {
    const result = getSqlite()
      .prepare(
        `UPDATE notification_outbox
         SET state = 'expired', last_error = ?, updated_at = ?
         WHERE id = ? AND state = 'pending'`,
      )
      .run(reason.slice(0, 1000), now, id);
    return result.changes > 0;
  },

  markDelivered(id: string, now = new Date().toISOString()) {
    const result = getSqlite()
      .prepare(
        `UPDATE notification_outbox
         SET state = 'delivered', last_error = NULL, updated_at = ?
         WHERE id = ? AND state = 'pending'`,
      )
      .run(now, id);
    return result.changes > 0;
  },

  markFailed(
    id: string,
    errorMessage: string,
    now = new Date().toISOString(),
  ) {
    const result = getSqlite()
      .prepare(
        `UPDATE notification_outbox
         SET state = 'failed', last_error = ?, updated_at = ?
         WHERE id = ? AND state = 'pending'`,
      )
      .run(errorMessage.slice(0, 1000), now, id);
    return result.changes > 0;
  },

  scheduleRetry(input: {
    id: string;
    attemptCount: number;
    nextAttemptAt: string;
    errorMessage: string;
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    const result = getSqlite()
      .prepare(
        `UPDATE notification_outbox
         SET attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ? AND state = 'pending'`,
      )
      .run(
        input.attemptCount,
        input.nextAttemptAt,
        input.errorMessage.slice(0, 1000),
        now,
        input.id,
      );
    return result.changes > 0;
  },
};
