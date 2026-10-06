import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as signBytes,
} from "node:crypto";

import {
  hostNotificationRepository,
  type HostNotificationBindingRecord,
} from "@/db/repositories/host-notification.repository.js";
import { getConfiguredPushBrokerBaseUrl } from "@/services/host-notification-config.js";

const BINDING_DESCRIPTOR_TTL_MS = 5 * 60 * 1000;

const canonicalJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite canonical number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported canonical value");
};

const normalizeSourceScope = (value: string[]) =>
  Array.from(new Set(value.map((item) => item.trim()).filter(Boolean))).sort();

const createIdentityMaterial = () => {
  const pair = generateKeyPairSync("ed25519");
  const publicJwk = pair.publicKey.export({ format: "jwk" }) as {
    x?: string;
  };
  if (!publicJwk.x) {
    throw new Error("Failed to export Host notification public key");
  }
  return {
    hostId: `host_${randomUUID()}`,
    publicKey: publicJwk.x,
    privateKeyPem: pair.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
  };
};

const signCanonical = (privateKeyPem: string, value: unknown) =>
  signBytes(
    null,
    Buffer.from(canonicalJson(value), "utf8"),
    createPrivateKey(privateKeyPem),
  ).toString("base64url");

export type HostNotificationBindingDescriptor = {
  schemaVersion: 1;
  hostId: string;
  hostPublicKey: string;
  installationId: string;
  sourceScope: string[];
  bindingNonce: string;
  bindingExpiresAt: string;
  hostSignature: string;
};

export type HostNotificationEvent = {
  schemaVersion: 1;
  eventType: "assistant-message";
  installationId: string;
  eventId: string;
  hostId: string;
  sourceId: string;
  canonicalMessageId: string;
  eligibilityEvent: "final_transition_first_seen";
  occurredAt: string;
  expiresAt: string;
};

export const hostNotificationIdentityService = {
  getOrCreateIdentity() {
    const existing = hostNotificationRepository.getIdentity();
    if (existing) return existing;
    return hostNotificationRepository.createIdentity(createIdentityMaterial());
  },

  createBindingDescriptor(input: {
    installationId: string;
    sourceScope: string[];
    now?: number;
  }): HostNotificationBindingDescriptor {
    const installationId = input.installationId.trim();
    const sourceScope = normalizeSourceScope(input.sourceScope);
    if (!installationId || sourceScope.length === 0) {
      throw new Error("Notification binding descriptor is incomplete");
    }

    const identity = this.getOrCreateIdentity();
    const now = input.now ?? Date.now();
    const bindingNonce = `binding_${randomBytes(24).toString("base64url")}`;
    const bindingExpiresAt = new Date(
      now + BINDING_DESCRIPTOR_TTL_MS,
    ).toISOString();
    const unsigned = {
      schemaVersion: 1 as const,
      action: "binding-descriptor" as const,
      hostId: identity.hostId,
      hostPublicKey: identity.publicKey,
      installationId,
      sourceScope,
      bindingNonce,
      bindingExpiresAt,
    };
    const hostSignature = signCanonical(identity.privateKeyPem, unsigned);

    hostNotificationRepository.createBindingRequest({
      nonce: bindingNonce,
      installationId,
      sourceScope,
      expiresAt: bindingExpiresAt,
      now: new Date(now).toISOString(),
    });

    return {
      schemaVersion: 1,
      hostId: identity.hostId,
      hostPublicKey: identity.publicKey,
      installationId,
      sourceScope,
      bindingNonce,
      bindingExpiresAt,
      hostSignature,
    };
  },

  acceptApprovedBinding(input: {
    bindingNonce: string;
    installationId: string;
    deliveryToken: string;
    sourceScope: string[];
    now?: string;
  }): HostNotificationBindingRecord {
    return hostNotificationRepository.acceptBindingCapability({
      nonce: input.bindingNonce,
      installationId: input.installationId,
      brokerBaseUrl: getConfiguredPushBrokerBaseUrl(),
      deliveryToken: input.deliveryToken,
      sourceScope: input.sourceScope,
      now: input.now,
    });
  },

  signEvent(input: HostNotificationEvent) {
    const identity = this.getOrCreateIdentity();
    if (input.hostId !== identity.hostId) {
      throw new Error("Notification event Host identity mismatch");
    }
    return signCanonical(identity.privateKeyPem, input);
  },
};
