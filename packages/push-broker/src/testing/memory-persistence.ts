import type {
  BindingRecord,
  BrokerPersistence,
  CommitBindingInput,
  CommitRegistrationInput,
  EventRecord,
  RegistrationRecord,
} from "../persistence";

export class MemoryBrokerPersistence implements BrokerPersistence {
  registration: RegistrationRecord | null = null;
  readonly bindings = new Map<string, BindingRecord>();
  readonly events = new Map<string, EventRecord>();
  readonly nonces = new Set<string>();

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
        updatedAt: input.now,
      };
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
      updatedAt: input.now,
      revokedAt: input.now,
    };
    for (const [hostId, binding] of this.bindings) {
      this.bindings.set(hostId, { ...binding, revokedAt: input.now });
    }
    for (const [eventId, event] of this.events) {
      if (event.state === "pending") {
        this.events.set(eventId, { ...event, state: "cancelled" });
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
}
