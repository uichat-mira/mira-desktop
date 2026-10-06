import {
  bindingApprovalSigningValue,
  bindingRevokeSigningValue,
  eventSigningValue,
  installationRevokeSigningValue,
  parseBindingApprovalRequest,
  parseBindingRevokeRequest,
  parseInstallationRevokeRequest,
  parseNotificationEventRequest,
  parseRegistrationRequest,
  registrationSigningValue,
  type RegistrationAction,
} from "./contracts";
import {
  randomToken,
  sealSecret,
  sha256Hex,
  verifyEd25519,
} from "./crypto";
import type { BrokerPersistence } from "./persistence";

const MAX_BODY_CHARS = 32 * 1024;
const SIGNED_REQUEST_MAX_AGE_MS = 5 * 60 * 1000;
const SIGNED_REQUEST_FUTURE_SKEW_MS = 60 * 1000;
const BINDING_MAX_TTL_MS = 5 * 60 * 1000;
const EVENT_MAX_TTL_MS = 24 * 60 * 60 * 1000;

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const error = (code: string, status: number) => json({ error: code }, status);

const readJson = async (request: Request) => {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_CHARS) {
    return null;
  }
  const text = await request.text();
  if (text.length === 0 || text.length > MAX_BODY_CHARS) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const bearerToken = (request: Request) => {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token.length >= 32 && token.length <= 512 ? token : null;
};

const isFreshTimestamp = (iso: string, now: number) => {
  const value = Date.parse(iso);
  return (
    value <= now + SIGNED_REQUEST_FUTURE_SKEW_MS &&
    value >= now - SIGNED_REQUEST_MAX_AGE_MS
  );
};

const nonceExpiry = (now: number) =>
  new Date(now + SIGNED_REQUEST_MAX_AGE_MS).toISOString();

export class BrokerService {
  constructor(
    private readonly store: BrokerPersistence,
    private readonly storageKey: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async handle(request: Request, installationId: string): Promise<Response> {
    if (request.method !== "POST") return error("method_not_allowed", 405);

    const url = new URL(request.url);
    const prefix = `/v1/installations/${installationId}`;
    if (!url.pathname.startsWith(prefix)) return error("not_found", 404);
    const action = url.pathname.slice(prefix.length);

    try {
      switch (action) {
        case "/register":
          return await this.register(request, installationId, "register");
        case "/refresh":
          return await this.register(request, installationId, "refresh");
        case "/revoke":
          return await this.revokeInstallation(request, installationId);
        case "/bindings/approve":
          return await this.approveBinding(request, installationId);
        case "/bindings/revoke":
          return await this.revokeBinding(request, installationId);
        case "/events":
          return await this.ingestEvent(request, installationId);
        default:
          return error("not_found", 404);
      }
    } catch {
      return error("broker_internal_error", 500);
    }
  }

  private async register(
    request: Request,
    installationId: string,
    action: RegistrationAction,
  ) {
    const parsed = parseRegistrationRequest(await readJson(request));
    if (!parsed || parsed.installationId !== installationId) {
      return error("invalid_registration", 400);
    }
    const now = this.now();
    if (!isFreshTimestamp(parsed.issuedAt, now)) {
      return error("stale_registration", 400);
    }

    const current = this.store.getRegistration();
    if (action === "refresh") {
      if (!current || current.revokedAt) return error("not_registered", 404);
      if (current.installationPublicKey !== parsed.installationPublicKey) {
        return error("installation_key_mismatch", 403);
      }
    }

    const signedBy =
      action === "register"
        ? parsed.installationPublicKey
        : current?.installationPublicKey;
    if (
      !signedBy ||
      !(await verifyEd25519(
        signedBy,
        parsed.installationSignature,
        registrationSigningValue(action, {
          schemaVersion: parsed.schemaVersion,
          installationId: parsed.installationId,
          platform: parsed.platform,
          providerToken: parsed.providerToken,
          installationPublicKey: parsed.installationPublicKey,
          requestNonce: parsed.requestNonce,
          issuedAt: parsed.issuedAt,
        }),
      ))
    ) {
      return error("invalid_installation_signature", 401);
    }

    const providerTokenCiphertext = await sealSecret(
      parsed.providerToken,
      this.storageKey,
      parsed.installationId,
    );
    const committed = this.store.commitRegistration({
      action,
      installationId: parsed.installationId,
      platform: parsed.platform,
      providerTokenCiphertext,
      installationPublicKey: parsed.installationPublicKey,
      requestNonce: parsed.requestNonce,
      nonceExpiresAt: nonceExpiry(now),
      now: new Date(now).toISOString(),
    });

    if (committed === "nonce_reused") return error("nonce_reused", 409);
    if (committed === "already_registered") return error("already_registered", 409);
    if (committed === "public_key_mismatch") return error("installation_key_mismatch", 403);
    if (committed === "revoked") return error("installation_revoked", 410);
    if (committed === "not_registered") return error("not_registered", 404);

    const registration = this.store.getRegistration();
    return json(
      {
        installationId: parsed.installationId,
        status: action === "register" ? "registered" : "refreshed",
        registeredAt: registration?.registeredAt ?? new Date(now).toISOString(),
      },
      action === "register" ? 201 : 200,
    );
  }

  private async revokeInstallation(
    request: Request,
    installationId: string,
  ) {
    const parsed = parseInstallationRevokeRequest(await readJson(request));
    if (!parsed || parsed.installationId !== installationId) {
      return error("invalid_revoke", 400);
    }
    const current = this.store.getRegistration();
    if (!current || current.revokedAt) return error("not_registered", 404);
    const now = this.now();
    if (!isFreshTimestamp(parsed.issuedAt, now)) {
      return error("stale_revoke", 400);
    }
    if (
      !(await verifyEd25519(
        current.installationPublicKey,
        parsed.installationSignature,
        installationRevokeSigningValue({
          schemaVersion: parsed.schemaVersion,
          installationId: parsed.installationId,
          requestNonce: parsed.requestNonce,
          issuedAt: parsed.issuedAt,
        }),
      ))
    ) {
      return error("invalid_installation_signature", 401);
    }

    const committed = this.store.revokeInstallation({
      requestNonce: parsed.requestNonce,
      nonceExpiresAt: nonceExpiry(now),
      now: new Date(now).toISOString(),
    });
    if (committed === "nonce_reused") return error("nonce_reused", 409);
    if (committed === "not_registered") return error("not_registered", 404);
    return json({ installationId, status: "revoked" });
  }

  private async approveBinding(request: Request, installationId: string) {
    const parsed = parseBindingApprovalRequest(await readJson(request));
    if (!parsed || parsed.installationId !== installationId) {
      return error("invalid_binding_approval", 400);
    }
    const current = this.store.getRegistration();
    if (!current || current.revokedAt) return error("not_registered", 404);

    const now = this.now();
    const bindingExpiry = Date.parse(parsed.bindingExpiresAt);
    if (bindingExpiry <= now || bindingExpiry > now + BINDING_MAX_TTL_MS) {
      return error("invalid_binding_ttl", 400);
    }
    if (
      !(await verifyEd25519(
        current.installationPublicKey,
        parsed.installationSignature,
        bindingApprovalSigningValue({
          schemaVersion: parsed.schemaVersion,
          installationId: parsed.installationId,
          hostId: parsed.hostId,
          hostPublicKey: parsed.hostPublicKey,
          sourceScope: parsed.sourceScope,
          bindingNonce: parsed.bindingNonce,
          bindingExpiresAt: parsed.bindingExpiresAt,
        }),
      ))
    ) {
      return error("invalid_installation_signature", 401);
    }

    const deliveryToken = randomToken(32);
    const deliveryTokenHash = await sha256Hex(deliveryToken);
    const committed = this.store.commitBinding({
      hostId: parsed.hostId,
      hostPublicKey: parsed.hostPublicKey,
      sourceScope: parsed.sourceScope,
      deliveryTokenHash,
      bindingNonce: parsed.bindingNonce,
      nonceExpiresAt: parsed.bindingExpiresAt,
      now: new Date(now).toISOString(),
    });
    if (committed === "nonce_reused") return error("binding_nonce_reused", 409);
    if (committed === "not_registered") return error("not_registered", 404);

    return json(
      {
        installationId,
        hostId: parsed.hostId,
        status: "authorized",
        deliveryToken,
      },
      201,
    );
  }

  private async revokeBinding(request: Request, installationId: string) {
    const parsed = parseBindingRevokeRequest(await readJson(request));
    if (!parsed || parsed.installationId !== installationId) {
      return error("invalid_binding_revoke", 400);
    }
    const current = this.store.getRegistration();
    if (!current || current.revokedAt) return error("not_registered", 404);
    const now = this.now();
    if (!isFreshTimestamp(parsed.issuedAt, now)) {
      return error("stale_binding_revoke", 400);
    }
    if (
      !(await verifyEd25519(
        current.installationPublicKey,
        parsed.installationSignature,
        bindingRevokeSigningValue({
          schemaVersion: parsed.schemaVersion,
          installationId: parsed.installationId,
          hostId: parsed.hostId,
          requestNonce: parsed.requestNonce,
          issuedAt: parsed.issuedAt,
        }),
      ))
    ) {
      return error("invalid_installation_signature", 401);
    }

    const committed = this.store.revokeBinding({
      hostId: parsed.hostId,
      requestNonce: parsed.requestNonce,
      nonceExpiresAt: nonceExpiry(now),
      now: new Date(now).toISOString(),
    });
    if (committed === "nonce_reused") return error("nonce_reused", 409);
    if (committed === "not_registered") return error("not_registered", 404);
    if (committed === "binding_not_found") return error("binding_not_found", 404);
    return json({ installationId, hostId: parsed.hostId, status: "revoked" });
  }

  private async ingestEvent(request: Request, installationId: string) {
    const token = bearerToken(request);
    if (!token) return error("delivery_token_required", 401);
    const tokenHash = await sha256Hex(token);
    const binding = this.store.findActiveBindingByTokenHash(tokenHash);
    if (!binding) return error("invalid_delivery_token", 401);

    const parsed = parseNotificationEventRequest(await readJson(request));
    if (!parsed || parsed.installationId !== installationId) {
      return error("invalid_event", 400);
    }
    if (parsed.hostId !== binding.hostId) return error("host_mismatch", 403);
    if (!binding.sourceScope.includes(parsed.sourceId)) {
      return error("source_out_of_scope", 403);
    }

    const now = this.now();
    const occurredAt = Date.parse(parsed.occurredAt);
    const expiresAt = Date.parse(parsed.expiresAt);
    if (
      occurredAt > now + SIGNED_REQUEST_FUTURE_SKEW_MS ||
      expiresAt <= now ||
      expiresAt <= occurredAt ||
      expiresAt - occurredAt > EVENT_MAX_TTL_MS
    ) {
      return error("invalid_event_ttl", 400);
    }

    if (
      !(await verifyEd25519(
        binding.hostPublicKey,
        parsed.hostSignature,
        eventSigningValue({
          schemaVersion: parsed.schemaVersion,
          eventType: parsed.eventType,
          installationId: parsed.installationId,
          eventId: parsed.eventId,
          hostId: parsed.hostId,
          sourceId: parsed.sourceId,
          canonicalMessageId: parsed.canonicalMessageId,
          eligibilityEvent: parsed.eligibilityEvent,
          occurredAt: parsed.occurredAt,
          expiresAt: parsed.expiresAt,
        }),
      ))
    ) {
      return error("invalid_host_signature", 401);
    }

    const acceptedAt = new Date(now).toISOString();
    const committed = this.store.commitEvent({
      eventId: parsed.eventId,
      hostId: parsed.hostId,
      sourceId: parsed.sourceId,
      canonicalMessageId: parsed.canonicalMessageId,
      eligibilityEvent: parsed.eligibilityEvent,
      eventType: parsed.eventType,
      occurredAt: parsed.occurredAt,
      expiresAt: parsed.expiresAt,
      state: "pending",
      attemptCount: 0,
      nextAttemptAt: acceptedAt,
      lastError: null,
      providerRequestId: null,
      acceptedAt,
      deliveredAt: null,
    });
    if (committed === "not_registered") return error("not_registered", 404);
    if (committed === "duplicate") {
      return json({ status: "accepted", duplicate: true });
    }
    return json({ status: "accepted", duplicate: false }, 202);
  }
}
