import type { EventRecord } from "./persistence";

export const GENERIC_NOTIFICATION_TITLE = "Mira";
export const GENERIC_NOTIFICATION_BODY = "Mira 有新回复";
export const ANDROID_NOTIFICATION_CHANNEL_ID = "mira_messages";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 10_000;
const APNS_TOKEN_REUSE_MS = 50 * 60 * 1000;

export type ProviderName = "fcm" | "apns";

export type ProviderDispatchResult =
  | {
      type: "accepted";
      provider: ProviderName;
      requestId: string | null;
      httpStatus: number;
    }
  | {
      type: "retryable";
      provider: ProviderName;
      requestId: string | null;
      httpStatus: number | null;
      errorCode: string;
      retryAfterMs?: number;
    }
  | {
      type: "invalid_token";
      provider: ProviderName;
      requestId: string | null;
      httpStatus: number;
      errorCode: string;
    }
  | {
      type: "rejected";
      provider: ProviderName;
      requestId: string | null;
      httpStatus: number;
      errorCode: string;
    };

export type ProviderDispatchInput = {
  installationId: string;
  providerToken: string;
  event: EventRecord;
  nowMs: number;
};

export type PushProviderAdapter = {
  readonly provider: ProviderName;
  send(input: ProviderDispatchInput): Promise<ProviderDispatchResult>;
};

type FetchLike = typeof fetch;

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const encodeJsonPart = (value: unknown) =>
  base64Url(encoder.encode(JSON.stringify(value)));

const pemToBytes = (pem: string) => {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/gu, "")
    .replace(/-----END [^-]+-----/gu, "")
    .replace(/\s+/gu, "");
  if (!body) throw new Error("provider_private_key_invalid");
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const withTimeout = async (
  fetchImpl: FetchLike,
  input: RequestInfo | URL,
  init: RequestInit,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const parseRetryAfterMs = (response: Response, nowMs: number) => {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) && date > nowMs ? date - nowMs : undefined;
};

const parseJsonObject = async (response: Response) => {
  try {
    const value = (await response.json()) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const eventData = (installationId: string, event: EventRecord) => ({
  schemaVersion: "1",
  eventType: event.eventType,
  installationId,
  eventId: event.eventId,
  sourceId: event.sourceId,
  canonicalMessageId: event.canonicalMessageId,
  eligibilityEvent: event.eligibilityEvent,
});

const remainingTtlSeconds = (expiresAt: string, nowMs: number) =>
  Math.max(0, Math.floor((Date.parse(expiresAt) - nowMs) / 1000));

const normalizeAuditValue = (value: unknown, fallback: string) =>
  typeof value === "string" && value.length > 0
    ? value.slice(0, 256)
    : fallback;

const extractFcmErrorCode = (body: Record<string, unknown> | null) => {
  const error =
    body?.error && typeof body.error === "object" && !Array.isArray(body.error)
      ? (body.error as Record<string, unknown>)
      : null;
  const details = Array.isArray(error?.details) ? error.details : [];
  for (const detail of details) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) continue;
    const record = detail as Record<string, unknown>;
    if (
      record["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
      typeof record.errorCode === "string"
    ) {
      return record.errorCode;
    }
  }
  return typeof error?.status === "string" ? error.status : null;
};

export class FcmProviderAdapter implements PushProviderAdapter {
  readonly provider = "fcm" as const;
  private cachedAccessToken: { value: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly config: {
      projectId: string;
      clientEmail: string;
      privateKeyPem: string;
    },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(input: ProviderDispatchInput): Promise<ProviderDispatchResult> {
    let accessToken: string;
    try {
      accessToken = await this.getAccessToken(input.nowMs);
    } catch {
      return {
        type: "retryable",
        provider: this.provider,
        requestId: null,
        httpStatus: null,
        errorCode: "fcm_auth_failed",
      };
    }

    const body = {
      message: {
        token: input.providerToken,
        notification: {
          title: GENERIC_NOTIFICATION_TITLE,
          body: GENERIC_NOTIFICATION_BODY,
        },
        data: eventData(input.installationId, input.event),
        android: {
          ttl: `${remainingTtlSeconds(input.event.expiresAt, input.nowMs)}s`,
          notification: {
            channel_id: ANDROID_NOTIFICATION_CHANNEL_ID,
          },
        },
      },
    };

    let response: Response;
    try {
      response = await withTimeout(
        this.fetchImpl,
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
          this.config.projectId,
        )}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json; charset=utf-8",
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      return {
        type: "retryable",
        provider: this.provider,
        requestId: null,
        httpStatus: null,
        errorCode: "fcm_transport_error",
      };
    }

    const responseBody = await parseJsonObject(response);
    if (response.ok) {
      return {
        type: "accepted",
        provider: this.provider,
        requestId:
          typeof responseBody?.name === "string"
            ? responseBody.name.slice(0, 256)
            : null,
        httpStatus: response.status,
      };
    }

    const code = normalizeAuditValue(
      extractFcmErrorCode(responseBody),
      `HTTP_${response.status}`,
    );
    if (response.status === 401) {
      // A cached OAuth token can be revoked or invalidated before its advertised
      // expiry. Force the next durable retry through service-account auth again.
      this.cachedAccessToken = null;
    }
    if (code === "UNREGISTERED" || code === "INVALID_ARGUMENT") {
      return {
        type: "invalid_token",
        provider: this.provider,
        requestId: null,
        httpStatus: response.status,
        errorCode: code,
      };
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429 ||
      response.status === 500 ||
      response.status === 503 ||
      code === "QUOTA_EXCEEDED" ||
      code === "UNAVAILABLE" ||
      code === "INTERNAL" ||
      code === "THIRD_PARTY_AUTH_ERROR"
    ) {
      return {
        type: "retryable",
        provider: this.provider,
        requestId: null,
        httpStatus: response.status,
        errorCode: code,
        retryAfterMs: parseRetryAfterMs(response, input.nowMs),
      };
    }
    return {
      type: "rejected",
      provider: this.provider,
      requestId: null,
      httpStatus: response.status,
      errorCode: code,
    };
  }

  private async getAccessToken(nowMs: number) {
    if (
      this.cachedAccessToken &&
      this.cachedAccessToken.expiresAtMs - nowMs > 5 * 60 * 1000
    ) {
      return this.cachedAccessToken.value;
    }

    const issuedAt = Math.floor(nowMs / 1000);
    const header = encodeJsonPart({ alg: "RS256", typ: "JWT" });
    const payload = encodeJsonPart({
      iss: this.config.clientEmail,
      scope: FCM_SCOPE,
      aud: FCM_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    });
    const unsigned = `${header}.${payload}`;
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToBytes(this.config.privateKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      encoder.encode(unsigned),
    );
    const assertion = `${unsigned}.${base64Url(
      new Uint8Array(signature),
    )}`;

    const response = await withTimeout(this.fetchImpl, FCM_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    const body = await parseJsonObject(response);
    const token = typeof body?.access_token === "string" ? body.access_token : null;
    const expiresIn =
      typeof body?.expires_in === "number" && Number.isFinite(body.expires_in)
        ? body.expires_in
        : 3600;
    if (!response.ok || !token) throw new Error("fcm_auth_failed");
    this.cachedAccessToken = {
      value: token,
      expiresAtMs: nowMs + Math.max(60, expiresIn) * 1000,
    };
    return token;
  }
}

export class ApnsProviderAdapter implements PushProviderAdapter {
  readonly provider = "apns" as const;
  private cachedProviderToken: { value: string; createdAtMs: number } | null =
    null;

  constructor(
    private readonly config: {
      teamId: string;
      keyId: string;
      privateKeyPem: string;
      topic: string;
      environment: "production" | "sandbox";
    },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(input: ProviderDispatchInput): Promise<ProviderDispatchResult> {
    let providerToken: string;
    try {
      providerToken = await this.getProviderToken(input.nowMs);
    } catch {
      return {
        type: "retryable",
        provider: this.provider,
        requestId: null,
        httpStatus: null,
        errorCode: "apns_auth_failed",
      };
    }

    const endpoint =
      this.config.environment === "sandbox"
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com";
    const body = {
      aps: {
        alert: {
          title: GENERIC_NOTIFICATION_TITLE,
          body: GENERIC_NOTIFICATION_BODY,
        },
      },
      mira: {
        schemaVersion: 1,
        eventType: input.event.eventType,
        installationId: input.installationId,
        eventId: input.event.eventId,
        sourceId: input.event.sourceId,
        canonicalMessageId: input.event.canonicalMessageId,
        eligibilityEvent: input.event.eligibilityEvent,
      },
    };

    let response: Response;
    try {
      response = await withTimeout(
        this.fetchImpl,
        `${endpoint}/3/device/${encodeURIComponent(input.providerToken)}`,
        {
          method: "POST",
          headers: {
            authorization: `bearer ${providerToken}`,
            "content-type": "application/json",
            "apns-push-type": "alert",
            "apns-topic": this.config.topic,
            "apns-priority": "10",
            "apns-expiration": String(
              Math.floor(Date.parse(input.event.expiresAt) / 1000),
            ),
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      return {
        type: "retryable",
        provider: this.provider,
        requestId: null,
        httpStatus: null,
        errorCode: "apns_transport_error",
      };
    }

    const requestId = response.headers.get("apns-id")?.slice(0, 256) ?? null;
    if (response.ok) {
      return {
        type: "accepted",
        provider: this.provider,
        requestId,
        httpStatus: response.status,
      };
    }

    const responseBody = await parseJsonObject(response);
    const reason = normalizeAuditValue(
      responseBody?.reason,
      `HTTP_${response.status}`,
    );
    if (
      response.status === 410 ||
      reason === "Unregistered" ||
      reason === "BadDeviceToken"
    ) {
      return {
        type: "invalid_token",
        provider: this.provider,
        requestId,
        httpStatus: response.status,
        errorCode: reason,
      };
    }
    if (
      response.status === 429 ||
      response.status === 500 ||
      response.status === 503 ||
      (response.status === 403 &&
        (reason === "ExpiredProviderToken" ||
          reason === "InvalidProviderToken" ||
          reason === "TooManyProviderTokenUpdates"))
    ) {
      if (
        reason === "ExpiredProviderToken" ||
        reason === "InvalidProviderToken"
      ) {
        this.cachedProviderToken = null;
      }
      return {
        type: "retryable",
        provider: this.provider,
        requestId,
        httpStatus: response.status,
        errorCode: reason,
        retryAfterMs: parseRetryAfterMs(response, input.nowMs),
      };
    }
    return {
      type: "rejected",
      provider: this.provider,
      requestId,
      httpStatus: response.status,
      errorCode: reason,
    };
  }

  private async getProviderToken(nowMs: number) {
    if (
      this.cachedProviderToken &&
      nowMs - this.cachedProviderToken.createdAtMs < APNS_TOKEN_REUSE_MS
    ) {
      return this.cachedProviderToken.value;
    }

    const header = encodeJsonPart({
      alg: "ES256",
      kid: this.config.keyId,
    });
    const payload = encodeJsonPart({
      iss: this.config.teamId,
      iat: Math.floor(nowMs / 1000),
    });
    const unsigned = `${header}.${payload}`;
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToBytes(this.config.privateKeyPem),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      encoder.encode(unsigned),
    );
    const value = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
    this.cachedProviderToken = { value, createdAtMs: nowMs };
    return value;
  }
}
