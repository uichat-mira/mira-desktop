export type RegistrationRecord = {
  installationId: string;
  platform: "android" | "ios";
  providerTokenCiphertext: string | null;
  installationPublicKey: string;
  schemaVersion: number;
  registeredAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

export type BindingRecord = {
  hostId: string;
  hostPublicKey: string;
  sourceScope: string[];
  deliveryTokenHash: string;
  authorizedAt: string;
  revokedAt: string | null;
};

export type EventRecord = {
  eventId: string;
  hostId: string;
  sourceId: string;
  canonicalMessageId: string;
  eligibilityEvent: string;
  eventType: string;
  occurredAt: string;
  expiresAt: string;
  state: "pending" | "cancelled";
  acceptedAt: string;
};

export type CommitRegistrationInput = {
  action: "register" | "refresh";
  installationId: string;
  platform: "android" | "ios";
  providerTokenCiphertext: string;
  installationPublicKey: string;
  requestNonce: string;
  nonceExpiresAt: string;
  now: string;
};

export type CommitBindingInput = {
  hostId: string;
  hostPublicKey: string;
  sourceScope: string[];
  deliveryTokenHash: string;
  bindingNonce: string;
  nonceExpiresAt: string;
  now: string;
};

export type BrokerPersistence = {
  getRegistration(): RegistrationRecord | null;
  commitRegistration(
    input: CommitRegistrationInput,
  ):
    | "ok"
    | "nonce_reused"
    | "already_registered"
    | "not_registered"
    | "public_key_mismatch"
    | "revoked";
  revokeInstallation(input: {
    requestNonce: string;
    nonceExpiresAt: string;
    now: string;
  }): "ok" | "nonce_reused" | "not_registered";
  getBinding(hostId: string): BindingRecord | null;
  findActiveBindingByTokenHash(tokenHash: string): BindingRecord | null;
  commitBinding(
    input: CommitBindingInput,
  ): "ok" | "nonce_reused" | "not_registered";
  revokeBinding(input: {
    hostId: string;
    requestNonce: string;
    nonceExpiresAt: string;
    now: string;
  }): "ok" | "nonce_reused" | "not_registered" | "binding_not_found";
  commitEvent(
    event: EventRecord,
  ): "inserted" | "duplicate" | "not_registered";
};

type SqlCursor<T> = { toArray(): T[] };

export type SqlStorageLike = {
  sql: {
    exec<T = Record<string, unknown>>(
      query: string,
      ...bindings: unknown[]
    ): SqlCursor<T>;
  };
  transactionSync<T>(callback: () => T): T;
};

type RegistrationRow = {
  installation_id: string;
  platform: "android" | "ios";
  provider_token_ciphertext: string | null;
  installation_public_key: string;
  schema_version: number;
  registered_at: string;
  updated_at: string;
  revoked_at: string | null;
};

type BindingRow = {
  host_id: string;
  host_public_key: string;
  source_scope_json: string;
  delivery_token_hash: string;
  authorized_at: string;
  revoked_at: string | null;
};

export class SqlBrokerPersistence implements BrokerPersistence {
  constructor(private readonly storage: SqlStorageLike) {
    this.storage.sql.exec(\`
      CREATE TABLE IF NOT EXISTS installation (
        installation_id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        provider_token_ciphertext TEXT,
        installation_public_key TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        registered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS used_nonces (
        nonce TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        used_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS host_bindings (
        host_id TEXT PRIMARY KEY,
        host_public_key TEXT NOT NULL,
        source_scope_json TEXT NOT NULL,
        delivery_token_hash TEXT NOT NULL UNIQUE,
        authorized_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS notification_events (
        event_id TEXT PRIMARY KEY,
        host_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        canonical_message_id TEXT NOT NULL,
        eligibility_event TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        state TEXT NOT NULL,
        accepted_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notification_events_state_idx
        ON notification_events(state, expires_at);
    \`);
  }

  getRegistration(): RegistrationRecord | null {
    const row = this.storage.sql
      .exec<RegistrationRow>("SELECT * FROM installation LIMIT 1")
      .toArray()[0];
    return row
      ? {
          installationId: row.installation_id,
          platform: row.platform,
          providerTokenCiphertext: row.provider_token_ciphertext,
          installationPublicKey: row.installation_public_key,
          schemaVersion: row.schema_version,
          registeredAt: row.registered_at,
          updatedAt: row.updated_at,
          revokedAt: row.revoked_at,
        }
      : null;
  }

  commitRegistration(input: CommitRegistrationInput) {
    return this.storage.transactionSync(() => {
      if (this.hasNonce(input.requestNonce)) return "nonce_reused" as const;
      const current = this.getRegistration();

      if (input.action === "register") {
        if (current?.revokedAt) return "revoked" as const;
        if (current) return "already_registered" as const;
        this.storage.sql.exec(
          \`INSERT INTO installation (
            installation_id, platform, provider_token_ciphertext,
            installation_public_key, schema_version, registered_at,
            updated_at, revoked_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, NULL)\`,
          input.installationId,
          input.platform,
          input.providerTokenCiphertext,
          input.installationPublicKey,
          input.now,
          input.now,
        );
      } else {
        if (!current || current.revokedAt) return "not_registered" as const;
        if (current.installationPublicKey !== input.installationPublicKey) {
          return "public_key_mismatch" as const;
        }
        this.storage.sql.exec(
          \`UPDATE installation
             SET platform = ?, provider_token_ciphertext = ?, updated_at = ?
           WHERE installation_id = ? AND revoked_at IS NULL\`,
          input.platform,
          input.providerTokenCiphertext,
          input.now,
          input.installationId,
        );
      }

      this.insertNonce(
        input.requestNonce,
        input.action,
        input.now,
        input.nonceExpiresAt,
      );
      return "ok" as const;
    });
  }

  revokeInstallation(input: {
    requestNonce: string;
    nonceExpiresAt: string;
    now: string;
  }) {
    return this.storage.transactionSync(() => {
      if (this.hasNonce(input.requestNonce)) return "nonce_reused" as const;
      const current = this.getRegistration();
      if (!current || current.revokedAt) return "not_registered" as const;

      this.storage.sql.exec(
        \`UPDATE installation
           SET provider_token_ciphertext = NULL, revoked_at = ?, updated_at = ?
         WHERE installation_id = ?\`,
        input.now,
        input.now,
        current.installationId,
      );
      this.storage.sql.exec(
        "UPDATE host_bindings SET revoked_at = ? WHERE revoked_at IS NULL",
        input.now,
      );
      this.storage.sql.exec(
        "UPDATE notification_events SET state = 'cancelled' WHERE state = 'pending'",
      );
      this.insertNonce(
        input.requestNonce,
        "revoke-installation",
        input.now,
        input.nonceExpiresAt,
      );
      return "ok" as const;
    });
  }

  getBinding(hostId: string): BindingRecord | null {
    const row = this.storage.sql
      .exec<BindingRow>(
        "SELECT * FROM host_bindings WHERE host_id = ? LIMIT 1",
        hostId,
      )
      .toArray()[0];
    return row ? this.mapBinding(row) : null;
  }

  findActiveBindingByTokenHash(tokenHash: string): BindingRecord | null {
    const row = this.storage.sql
      .exec<BindingRow>(
        \`SELECT * FROM host_bindings
          WHERE delivery_token_hash = ? AND revoked_at IS NULL LIMIT 1\`,
        tokenHash,
      )
      .toArray()[0];
    return row ? this.mapBinding(row) : null;
  }

  commitBinding(input: CommitBindingInput) {
    return this.storage.transactionSync(() => {
      if (this.hasNonce(input.bindingNonce)) return "nonce_reused" as const;
      const registration = this.getRegistration();
      if (!registration || registration.revokedAt) {
        return "not_registered" as const;
      }

      this.storage.sql.exec(
        \`INSERT INTO host_bindings (
          host_id, host_public_key, source_scope_json,
          delivery_token_hash, authorized_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT(host_id) DO UPDATE SET
          host_public_key = excluded.host_public_key,
          source_scope_json = excluded.source_scope_json,
          delivery_token_hash = excluded.delivery_token_hash,
          authorized_at = excluded.authorized_at,
          revoked_at = NULL\`,
        input.hostId,
        input.hostPublicKey,
        JSON.stringify(input.sourceScope),
        input.deliveryTokenHash,
        input.now,
      );
      this.insertNonce(
        input.bindingNonce,
        "approve-binding",
        input.now,
        input.nonceExpiresAt,
      );
      return "ok" as const;
    });
  }

  revokeBinding(input: {
    hostId: string;
    requestNonce: string;
    nonceExpiresAt: string;
    now: string;
  }) {
    return this.storage.transactionSync(() => {
      if (this.hasNonce(input.requestNonce)) return "nonce_reused" as const;
      const registration = this.getRegistration();
      if (!registration || registration.revokedAt) {
        return "not_registered" as const;
      }
      const binding = this.getBinding(input.hostId);
      if (!binding || binding.revokedAt) return "binding_not_found" as const;

      this.storage.sql.exec(
        "UPDATE host_bindings SET revoked_at = ? WHERE host_id = ?",
        input.now,
        input.hostId,
      );
      this.insertNonce(
        input.requestNonce,
        "revoke-binding",
        input.now,
        input.nonceExpiresAt,
      );
      return "ok" as const;
    });
  }

  commitEvent(event: EventRecord) {
    return this.storage.transactionSync(() => {
      const registration = this.getRegistration();
      if (!registration || registration.revokedAt) {
        return "not_registered" as const;
      }
      const duplicate = this.storage.sql
        .exec<{ event_id: string }>(
          "SELECT event_id FROM notification_events WHERE event_id = ? LIMIT 1",
          event.eventId,
        )
        .toArray()[0];
      if (duplicate) return "duplicate" as const;

      this.storage.sql.exec(
        \`INSERT INTO notification_events (
          event_id, host_id, source_id, canonical_message_id,
          eligibility_event, event_type, occurred_at, expires_at,
          state, accepted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`,
        event.eventId,
        event.hostId,
        event.sourceId,
        event.canonicalMessageId,
        event.eligibilityEvent,
        event.eventType,
        event.occurredAt,
        event.expiresAt,
        event.state,
        event.acceptedAt,
      );
      return "inserted" as const;
    });
  }

  private hasNonce(nonce: string) {
    return Boolean(
      this.storage.sql
        .exec<{ nonce: string }>(
          "SELECT nonce FROM used_nonces WHERE nonce = ? LIMIT 1",
          nonce,
        )
        .toArray()[0],
    );
  }

  private insertNonce(
    nonce: string,
    kind: string,
    usedAt: string,
    expiresAt: string,
  ) {
    this.storage.sql.exec(
      "INSERT INTO used_nonces (nonce, kind, used_at, expires_at) VALUES (?, ?, ?, ?)",
      nonce,
      kind,
      usedAt,
      expiresAt,
    );
  }

  private mapBinding(row: BindingRow): BindingRecord {
    const parsed = JSON.parse(row.source_scope_json) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("Stored source scope is invalid");
    }
    return {
      hostId: row.host_id,
      hostPublicKey: row.host_public_key,
      sourceScope: parsed as string[],
      deliveryTokenHash: row.delivery_token_hash,
      authorizedAt: row.authorized_at,
      revokedAt: row.revoked_at,
    };
  }
}
