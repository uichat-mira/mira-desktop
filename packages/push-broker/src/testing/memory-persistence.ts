import type {
  BindingRecord,
  BrokerPersistence,
  CommitBindingInput,
  CommitRegistrationInput,
  DeliveryAttemptRecord,
  EventRecord,
  RecordDeliveryAttemptInput,
  RegistrationRecord,
} from "../persistence";

export class MemoryBrokerPersistence implements BrokerPersistence {
  registration: RegistrationRecord | null = null;
  readonly bindings = new Map<string, BindingRecord>();
  readonly events = new Map<string, EventRecord>();
  readonly nonces = new Set<string>();
  readonly attempts: DeliveryAttemptRecord[] = [];

  getRegistration() {
    return this.registration ? { ...this.registration } : null;
  }

  commitRegistration(input: CommitRegistrationInput) {
    if (this.nonces.has(input.requestNonce)) return "nonce_reused" as const;
    if (input.action === "register") {
      if (this.registration?.revokedAt) return "revoked" as const;
      if (this.registration) return "already_registered" as const;
      this.registration = {
        installationId: input.installationId,
        platform: input.platform,
        providerTokenCiphertext: input.providerTokenCiphertext,
        providerTokenStatus: "active",
        installationPublicKey: input.installationPublicKey,
        schemaVersion: 1,
        registeredAt: input.now,
        updatedAt: input.now,
        revokedAt: null,
      };
    } else {
      if (!this.registration || this.registration.revokedAt) {
        return "not_registered" as const;
      }
      if (
        this.registration.installationPublicKey !== input.installationPublicKey
      ) {
        return "public_key_mismatch" as const;
      }
      this.registration = {
        ...this.registration,
        platform: input.platform,
        providerTokenCiphertext: input.providerTokenCiphertext,
        providerTokenStatus: "active",
        updatedAt: input.now,
      };
      for (const [eventId, event] of this.events) {
        if (event.state !== "waiting_token_refresh") continue;
        this.events.set(
          eventId,
          event.expiresAt <= input.now
            ? {
                ...event,
                state: "expired",
                nextAttemptAt: null,
                lastError: "event_ttl_expired",
              }
            : {
                ...event,
                state: "pending",
                nextAttemptAt: input.now,
                lastError: null,
              },
        );
      }
    }
    this.nonces.add(input.requestNonce);
    return "ok" as const;
  }

  revokeInstallation(input: {
    requestNonce: string;
    nonceExpiresAt: string;
    now: string;
  }) {
    if (this.nonces.has(input.requestNonce)) return "nonce_reused" as const;
    if (!this.registration || this.registration.revokedAt) {
      return "not_registered" as const;
    }
    this.registration = {
      ...this.registration,
      providerTokenCiphertext: null,
      providerTokenStatus: "refresh_required",
      updatedAt: input.now,
      revokedAt: input.now,
    };
    for (const [hostId, binding] of this.bindings) {
      this.bindings.set(hostId, { ...binding, revokedAt: input.now });
    }
    for (const [eventId, event] of this.events) {
      if (
        event.state === "pending" ||
        event.state === "waiting_token_refresh"
      ) {
        this.events.set(eventId, {
          ...event,
          state: "cancelled",
          nextAttemptAt: null,
        });
      }
    }
    this.nonces.add(input.requestNonce);
    return "ok" as const;
  }

  getBinding(hostId: string) {
    const binding = this.bindings.get(hostId);
    return binding ? { ...binding, sourceScope: [...binding.sourceScope] } : null;
  }

  findActiveBindingByTokenHash(tokenHash: string) {
    for (const binding of this.bindings.values()) {
      if (
        binding.deliveryTokenHash === tokenHash &&
        binding.revokedAt === null
      ) {
        return { ...binding, sourceScope: [...binding.sourceScope] };
      }
    }
    return null;
  }

  commitBinding(input: CommitBindingInput) {
    if (this.nonces.has(input.bindingNonce)) return "nonce_reused" as const;
    if (!this.registration || this.registration.revokedAt) {
      return "not_registered" as const;
    }
    this.bindings.set(input.hostId, {
      hostId: input.hostId,
      hostPublicKey: input.hostPublicKey,
      sourceScope: [...input.sourceScope],
      deliveryTokenHash: input.deliveryTokenHash,
      authorizedAt: input.now,
      revokedAt: null,
    });
    this.nonces.add(input.bindingNonce);
    return "ok" as const;
  }

  revokeBinding(input: {
    hostId: string;
    requestNonce: string;
    nonceExpiresAt: string;
    now: string;
  }) {
    if (this.nonces.has(input.requestNonce)) return "nonce_reused" as const;
    if (!this.registration || this.registration.revokedAt) {
      return "not_registered" as const;
    }
    const binding = this.bindings.get(input.hostId);
    if (!binding || binding.revokedAt) return "binding_not_found" as const;
    this.bindings.set(input.hostId, { ...binding, revokedAt: input.now });
    this.nonces.add(input.requestNonce);
    return "ok" as const;
  }

  commitEvent(event: EventRecord) {
    if (!this.registration || this.registration.revokedAt) {
      return "not_registered" as const;
    }
    if (this.events.has(event.eventId)) return "duplicate" as const;
    this.events.set(event.eventId, { ...event });
    return "inserted" as const;
  }

  getEvent(eventId: string) {
    const event = this.events.get(eventId);
    return event ? { ...event } : null;
  }

  listDueEvents(now: string, limit: number) {
    return [...this.events.values()]
      .filter(
        (event) =>
          event.state === "pending" &&
          event.expiresAt > now &&
          (event.nextAttemptAt ?? event.acceptedAt) <= now,
      )
      .sort((left, right) =>
        (left.nextAttemptAt ?? left.acceptedAt).localeCompare(
          right.nextAttemptAt ?? right.acceptedAt,
        ),
      )
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map((event) => ({ ...event }));
  }

  expireDue(now: string) {
    let count = 0;
    for (const [eventId, event] of this.events) {
      if (
        (event.state === "pending" ||
          event.state === "waiting_token_refresh") &&
        event.expiresAt <= now
      ) {
        this.events.set(eventId, {
          ...event,
          state: "expired",
          nextAttemptAt: null,
          lastError: "event_ttl_expired",
        });
        count += 1;
      }
    }
    return count;
  }

  pausePendingForTokenRefresh(now: string) {
    let count = 0;
    for (const [eventId, event] of this.events) {
      if (event.state === "pending" && event.expiresAt > now) {
        this.events.set(eventId, {
          ...event,
          state: "waiting_token_refresh",
          nextAttemptAt: null,
          lastError: "provider_token_refresh_required",
        });
        count += 1;
      }
    }
    return count;
  }

  recordDeliveryAttempt(input: RecordDeliveryAttemptInput) {
    this.attempts.push({
      eventId: input.eventId,
      attemptNo: input.attemptNo,
      provider: input.provider,
      outcome: input.outcome,
      providerRequestId: input.providerRequestId,
      httpStatus: input.httpStatus,
      errorCode: input.errorCode,
      attemptedAt: input.attemptedAt,
    });
    const event = this.events.get(input.eventId);
    if (event) {
      this.events.set(input.eventId, {
        ...event,
        state: input.eventState,
        attemptCount: input.attemptNo,
        nextAttemptAt: input.nextAttemptAt,
        lastError: input.lastError,
        providerRequestId: input.providerRequestId,
        deliveredAt:
          input.eventState === "delivered" ? input.attemptedAt : null,
      });
    }
    if (input.invalidateProviderToken && this.registration) {
      this.registration = {
        ...this.registration,
        providerTokenCiphertext: null,
        providerTokenStatus: "refresh_required",
        updatedAt: input.attemptedAt,
      };
      for (const [eventId, pending] of this.events) {
        if (
          pending.state === "pending" &&
          pending.expiresAt > input.attemptedAt
        ) {
          this.events.set(eventId, {
            ...pending,
            state: "waiting_token_refresh",
            nextAttemptAt: null,
            lastError: "provider_token_refresh_required",
          });
        }
      }
    }
  }

  getNextWakeAt(now: string) {
    let next: string | null = null;
    for (const event of this.events.values()) {
      if (
        event.state !== "pending" &&
        event.state !== "waiting_token_refresh"
      ) continue;
      const candidate =
        event.state === "waiting_token_refresh"
          ? event.expiresAt
          : event.nextAttemptAt ?? event.acceptedAt;
      if (candidate <= now) return now;
      if (!next || candidate < next) next = candidate;
    }
    return next;
  }
}
