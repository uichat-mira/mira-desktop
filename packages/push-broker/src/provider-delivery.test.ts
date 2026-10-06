import assert from "node:assert/strict";
import test from "node:test";

import type { EventRecord } from "./persistence";
import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  ApnsProviderAdapter,
  FcmProviderAdapter,
  GENERIC_NOTIFICATION_BODY,
  GENERIC_NOTIFICATION_TITLE,
} from "./provider-delivery";

const NOW = Date.parse("2026-10-06T10:00:00.000Z");

const event: EventRecord = {
  eventId: "event-1",
  hostId: "host-1",
  sourceId: "thread:alpha",
  canonicalMessageId: "message-1",
  eligibilityEvent: "final_transition_first_seen",
  eventType: "assistant-message",
  occurredAt: new Date(NOW - 1_000).toISOString(),
  expiresAt: new Date(NOW + 60_000).toISOString(),
  state: "pending",
  attemptCount: 0,
  nextAttemptAt: new Date(NOW).toISOString(),
  lastError: null,
  providerRequestId: null,
  acceptedAt: new Date(NOW).toISOString(),
  deliveredAt: null,
};

const bytesToPem = (label: string, value: ArrayBuffer) => {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/gu) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
};

const createRsaMaterial = async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return {
    privateKeyPem: bytesToPem(
      "PRIVATE KEY",
      await crypto.subtle.exportKey("pkcs8", pair.privateKey),
    ),
    publicKey: pair.publicKey,
  };
};

const createRsaPem = async () => (await createRsaMaterial()).privateKeyPem;

const createEcMaterial = async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return {
    privateKeyPem: bytesToPem(
      "PRIVATE KEY",
      await crypto.subtle.exportKey("pkcs8", pair.privateKey),
    ),
    publicKey: pair.publicKey,
  };
};

const createEcPem = async () => (await createEcMaterial()).privateKeyPem;

const base64UrlToBytes = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const decodeJwtPart = (value: string) =>
  JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Record<
    string,
    unknown
  >;

const verifyJwt = async (
  jwt: string,
  publicKey: CryptoKey,
  algorithm: AlgorithmIdentifier | EcdsaParams,
) => {
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  const [header, payload, signature] = parts;
  assert.ok(header && payload && signature);
  const valid = await crypto.subtle.verify(
    algorithm,
    publicKey,
    base64UrlToBytes(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  assert.equal(valid, true);
  return {
    header: decodeJwtPart(header),
    payload: decodeJwtPart(payload),
  };
};

test("FCM adapter emits only generic alert plus identity data", async () => {
  const material = await createRsaMaterial();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let oauthAssertion = "";
  const fakeFetch: typeof fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    if (String(input).includes("oauth2.googleapis.com")) {
      oauthAssertion = new URLSearchParams(String(init.body)).get("assertion") ?? "";
      return new Response(
        JSON.stringify({ access_token: "oauth-access", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ name: "projects/mira/messages/123" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const adapter = new FcmProviderAdapter(
    {
      projectId: "mira-project",
      clientEmail: "push@example.iam.gserviceaccount.com",
      privateKeyPem: material.privateKeyPem,
    },
    fakeFetch,
  );

  const result = await adapter.send({
    installationId: "installation-1",
    providerToken: "provider-token-secret",
    event,
    nowMs: NOW,
  });
  assert.equal(result.type, "accepted");
  assert.equal(calls.length, 2);

  const oauthJwt = await verifyJwt(
    oauthAssertion,
    material.publicKey,
    { name: "RSASSA-PKCS1-v1_5" },
  );
  assert.equal(oauthJwt.header.alg, "RS256");
  assert.equal(
    oauthJwt.payload.iss,
    "push@example.iam.gserviceaccount.com",
  );
  assert.equal(
    oauthJwt.payload.scope,
    "https://www.googleapis.com/auth/firebase.messaging",
  );
  assert.equal(oauthJwt.payload.aud, "https://oauth2.googleapis.com/token");

  const send = calls[1]!;
  const body = JSON.parse(String(send.init.body)) as {
    message: {
      token: string;
      notification: { title: string; body: string };
      data: Record<string, string>;
      android: { ttl: string; notification: { channel_id: string } };
    };
  };
  assert.equal(body.message.token, "provider-token-secret");
  assert.deepEqual(body.message.notification, {
    title: GENERIC_NOTIFICATION_TITLE,
    body: GENERIC_NOTIFICATION_BODY,
  });
  assert.equal(
    body.message.android.notification.channel_id,
    ANDROID_NOTIFICATION_CHANNEL_ID,
  );
  assert.equal(body.message.data.canonicalMessageId, "message-1");
  assert.equal(JSON.stringify(body).includes("assistant text"), false);
  assert.match(
    String((send.init.headers as Record<string, string>).authorization),
    /^Bearer /u,
  );
});

test("FCM adapter classifies invalid, retryable and rejected responses", async () => {
  const privateKeyPem = await createRsaPem();
  const make = (sendResponse: () => Response) =>
    new FcmProviderAdapter(
      {
        projectId: "mira-project",
        clientEmail: "push@example.iam.gserviceaccount.com",
        privateKeyPem,
      },
      (async (input) =>
        String(input).includes("oauth2.googleapis.com")
          ? new Response(
              JSON.stringify({ access_token: "oauth-access", expires_in: 3600 }),
              { status: 200 },
            )
          : sendResponse()) as typeof fetch,
    );

  const invalid = await make(
    () =>
      new Response(
        JSON.stringify({
          error: {
            status: "NOT_FOUND",
            details: [
              {
                "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                errorCode: "UNREGISTERED",
              },
            ],
          },
        }),
        { status: 404 },
      ),
  ).send({
    installationId: "installation-1",
    providerToken: "token",
    event,
    nowMs: NOW,
  });
  assert.equal(invalid.type, "invalid_token");

  const retryable = await make(
    () =>
      new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), {
        status: 503,
        headers: { "retry-after": "120" },
      }),
  ).send({
    installationId: "installation-1",
    providerToken: "token",
    event,
    nowMs: NOW,
  });
  assert.equal(retryable.type, "retryable");
  if (retryable.type === "retryable") {
    assert.equal(retryable.retryAfterMs, 120_000);
  }

  const rejected = await make(
    () =>
      new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION" } }), {
        status: 400,
      }),
  ).send({
    installationId: "installation-1",
    providerToken: "token",
    event,
    nowMs: NOW,
  });
  assert.equal(rejected.type, "rejected");
});

test("APNs adapter emits alert request with event expiration and identity metadata", async () => {
  const material = await createEcMaterial();
  let captured: { url: string; init: RequestInit } | null = null;
  const adapter = new ApnsProviderAdapter(
    {
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      privateKeyPem: material.privateKeyPem,
      topic: "io.tomz.mira.mobile",
      environment: "production",
    },
    (async (input, init = {}) => {
      captured = { url: String(input), init };
      return new Response(null, {
        status: 200,
        headers: { "apns-id": "123e4567-e89b-12d3-a456-426655440000" },
      });
    }) as typeof fetch,
  );

  const result = await adapter.send({
    installationId: "installation-1",
    providerToken: "apns-device-token",
    event,
    nowMs: NOW,
  });
  assert.equal(result.type, "accepted");
  assert.ok(captured);
  const request = captured as { url: string; init: RequestInit };
  assert.equal(
    request.url,
    "https://api.push.apple.com/3/device/apns-device-token",
  );
  const headers = request.init.headers as Record<string, string>;
  const providerJwt = headers.authorization.replace(/^bearer\s+/u, "");
  const verifiedJwt = await verifyJwt(
    providerJwt,
    material.publicKey,
    { name: "ECDSA", hash: "SHA-256" },
  );
  assert.equal(verifiedJwt.header.alg, "ES256");
  assert.equal(verifiedJwt.header.kid, "KEY1234567");
  assert.equal(verifiedJwt.payload.iss, "TEAM123456");
  assert.equal(verifiedJwt.payload.iat, Math.floor(NOW / 1000));

  assert.equal(headers["apns-push-type"], "alert");
  assert.equal(headers["apns-topic"], "io.tomz.mira.mobile");
  assert.equal(
    headers["apns-expiration"],
    String(Math.floor(Date.parse(event.expiresAt) / 1000)),
  );
  const body = JSON.parse(String(request.init.body)) as {
    aps: { alert: { title: string; body: string } };
    mira: Record<string, unknown>;
  };
  assert.deepEqual(body.aps.alert, {
    title: GENERIC_NOTIFICATION_TITLE,
    body: GENERIC_NOTIFICATION_BODY,
  });
  assert.equal(body.mira.canonicalMessageId, "message-1");
});

test("APNs adapter classifies invalid, retryable and rejected responses", async () => {
  const privateKeyPem = await createEcPem();
  const make = (response: () => Response) =>
    new ApnsProviderAdapter(
      {
        teamId: "TEAM123456",
        keyId: "KEY1234567",
        privateKeyPem,
        topic: "io.tomz.mira.mobile",
        environment: "sandbox",
      },
      (async () => response()) as typeof fetch,
    );

  const invalid = await make(
    () =>
      new Response(JSON.stringify({ reason: "Unregistered" }), {
        status: 410,
      }),
  ).send({
    installationId: "installation-1",
    providerToken: "apns-token",
    event,
    nowMs: NOW,
  });
  assert.equal(invalid.type, "invalid_token");

  const retryable = await make(
    () =>
      new Response(JSON.stringify({ reason: "ServiceUnavailable" }), {
        status: 503,
      }),
  ).send({
    installationId: "installation-1",
    providerToken: "apns-token",
    event,
    nowMs: NOW,
  });
  assert.equal(retryable.type, "retryable");

  const rejected = await make(
    () =>
      new Response(JSON.stringify({ reason: "BadTopic" }), {
        status: 400,
      }),
  ).send({
    installationId: "installation-1",
    providerToken: "apns-token",
    event,
    nowMs: NOW,
  });
  assert.equal(rejected.type, "rejected");
});


test("FCM 401 clears the cached OAuth token before the durable retry", async () => {
  const privateKeyPem = await createRsaPem();
  let authCalls = 0;
  let sendCalls = 0;
  const adapter = new FcmProviderAdapter(
    {
      projectId: "mira-project",
      clientEmail: "push@example.iam.gserviceaccount.com",
      privateKeyPem,
    },
    (async (input) => {
      if (String(input).includes("oauth2.googleapis.com")) {
        authCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: `oauth-access-${authCalls}`,
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }
      sendCalls += 1;
      if (sendCalls === 1) {
        return new Response(
          JSON.stringify({ error: { status: "UNAUTHENTICATED" } }),
          { status: 401 },
        );
      }
      return new Response(
        JSON.stringify({ name: "projects/mira/messages/reauthenticated" }),
        { status: 200 },
      );
    }) as typeof fetch,
  );

  const first = await adapter.send({
    installationId: "installation-1",
    providerToken: "token",
    event,
    nowMs: NOW,
  });
  assert.equal(first.type, "retryable");

  const second = await adapter.send({
    installationId: "installation-1",
    providerToken: "token",
    event,
    nowMs: NOW + 60_000,
  });
  assert.equal(second.type, "accepted");
  assert.equal(authCalls, 2);
  assert.equal(sendCalls, 2);
});
