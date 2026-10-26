
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCloudAccountController, parseCallback, validateScopes } = require("./cloud-account.cjs");

function fixture() {
  const artifactRoot = path.resolve(__dirname, "..", ".test-artifact");
  fs.mkdirSync(artifactRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifactRoot, "mira-cloud-"));
  const store = path.join(dir, "cloud.v1.enc");
  const opened = [];
  const calls = [];
  const storage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "dpapi",
    encryptString: (s) => Buffer.from("encrypted:" + Buffer.from(s).toString("base64")),
    decryptString: (b) => Buffer.from(b.toString().slice("encrypted:".length), "base64").toString(),
  };
  let offline = false;
  let storedPolicy = null;
  let beforePolicyPut = null;
  let beforeSessionRestore = null;
  let beforeOpenExternal = null;
  let hostFailuresRemaining = 0;
  const fetcher = async (url, opts) => {
    calls.push({ url, opts });
    if (offline) throw new Error("connection reset");
    if (url.endsWith("/v1/oauth/token")) return Response.json({
      sessionToken: "mcs_v1.session.secret",
      account: { id: "account-a", username: "test-a" },
      expiresAt: "2026-12-12T00:00:00.000Z",
    });
    if (url.endsWith("/v1/hosts") && opts.method === "POST") {
      if (hostFailuresRemaining > 0) {
        --hostFailuresRemaining;
        return Response.json({ code: "TEMPORARILY_UNAVAILABLE" }, { status: 503 });
      }
      return Response.json({ id: "host-1" });
    }
    if (url.endsWith("/v1/hosts/host-1/grants"))
      return Response.json({ hostId: "host-1", accountId: "account-a",
        revision: storedPolicy ? 7 : 0, policyConfigured: Boolean(storedPolicy),
        policyScopes: storedPolicy || [] });
    if (url.endsWith("/v1/hosts/host-1/grant-policy")) {
      if (beforePolicyPut) await beforePolicyPut();
      return Response.json({ hostId: "host-1", revision: 1 });
    }
    if (url.endsWith("/v1/auth/session")) {
      if (beforeSessionRestore) await beforeSessionRestore();
      return Response.json({ account: { id: "account-a", username: "test-a" }, expiresAt: "2026-12-12T00:00:00.000Z" });
    }
    if (url.endsWith("/v1/auth/logout")) return new Response(null, { status: 204 });
    throw new Error("unexpected route " + url);
  };
  const build = (overrides = {}) => createCloudAccountController({
    app: { getPath: () => dir }, safeStorage: storage,
    shell: { openExternal: async (url) => {
      opened.push(url);
      if (beforeOpenExternal) await beforeOpenExternal();
    } },
    notify: () => {}, fetcher, storagePath: store,
    ...overrides,
  });
  return { dir, store, opened, calls, build,
    setOffline: (yes) => { offline = yes; },
    setStoredPolicy: (scopes) => { storedPolicy = scopes; },
    failHostRegistration: (count = 1) => { hostFailuresRemaining = count; },
    setBeforePolicyPut: (hook) => { beforePolicyPut = hook; },
    setBeforeSessionRestore: (hook) => { beforeSessionRestore = hook; },
    setBeforeOpenExternal: (hook) => { beforeOpenExternal = hook; } };
}

test("rejects wrong protocols, duplicate parameters, fragments and invalid scopes", () => {
  assert.equal(parseCallback("https://attacker/callback?state=a&code=b"), null);
  assert.equal(parseCallback("mira-desktop://oauth/callback?code=mca_v1.x.y&state=" + "a".repeat(20) + "&state=evil"), null);
  assert.equal(parseCallback("mira-desktop://oauth/callback?code=mca_v1.x.y&state=" + "a".repeat(20) + "#fragment"), null);
  assert.throws(() => validateScopes(["tools:*"]));
  assert.deepEqual(validateScopes(["tools:read", "threads:read", "threads:read"]), ["threads:read", "tools:read"]);
});

test("native PKCE exchanges once, sets the chosen Host ceiling and never exposes bearer to renderer", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build();
  await controller.initialize();
  await controller.begin(["threads:read"]);
  assert.equal(controller.status().status, "authorizing");
  assert.equal(f.opened.length, 1);
  const authorization = new URL(f.opened[0]);
  assert.equal(authorization.hostname, "cloud-auth.tomzlab.cn");
  assert.equal(authorization.searchParams.get("client_id"), "mira-desktop");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  const state = authorization.searchParams.get("state");
  assert.equal(await controller.handleCallback("mira-desktop://oauth/callback?state=WRONG&code=mca_v1.id.secret"), false);
  assert.equal(controller.status().status, "authorizing");
  assert.equal(await controller.handleCallback("mira-desktop://oauth/callback?state=" + state + "&code=mca_v1.id.secret"), true);
  assert.equal(controller.status().status, "signed_in");
  assert.deepEqual(controller.status().scopes, ["threads:read"]);
  const put = f.calls.find((c) => c.url.endsWith("/grant-policy"));
  assert.deepEqual(JSON.parse(put.opts.body), { expectedRevision: 0, scopes: ["threads:read"] });
  assert.equal(JSON.stringify(controller.status()).includes("mcs_v1."), false);
  assert.equal(fs.readFileSync(f.store, "utf8").includes("mcs_v1."), false);
  assert.equal(await controller.handleCallback("mira-desktop://oauth/callback?state=" + state + "&code=mca_v1.id.secret"), false);
  const restored = f.build();
  await restored.initialize();
  assert.equal(restored.status().status, "signed_in");
  f.setOffline(true);
  await restored.signOut();
  assert.equal(restored.status().status, "signed_out");
  assert.match(restored.status().message, /云端撤销未确认/);
});

test("Cloud offline preserves native session rather than invalidating local Mira", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const one = f.build();
  await one.initialize();
  await one.begin([]);
  const state = new URL(f.opened[0]).searchParams.get("state");
  await one.handleCallback("mira-desktop://oauth/callback?code=mca_v1.x.y&state=" + state);
  f.setOffline(true);
  const two = f.build();
  await two.initialize();
  assert.equal(two.status().status, "unavailable");
  assert.equal(two.status().account.username, "test-a");
});

test("re-login keeps the Cloud owner's existing Host ceiling instead of overwriting it", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  f.setStoredPolicy(["threads:read"]);
  const controller = f.build();
  await controller.initialize();
  await controller.begin(["tools:invoke"]);
  const state = new URL(f.opened[0]).searchParams.get("state");
  await controller.handleCallback("mira-desktop://oauth/callback?state=" + state + "&code=mca_v1.id.secret");
  assert.equal(controller.status().status, "signed_in");
  assert.deepEqual(controller.status().scopes, ["threads:read"]);
  assert.match(controller.status().message, /保留云端原有/);
  assert.equal(f.calls.some((call) => call.url.endsWith("/grant-policy")), false);
});

test("logout wins when an in-flight Host grant write finishes later", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  let entered;
  const writeStarted = new Promise((resolve) => { entered = resolve; });
  let release;
  const writeGate = new Promise((resolve) => { release = resolve; });
  f.setBeforePolicyPut(async () => { entered(); await writeGate; });
  const controller = f.build();
  await controller.initialize();
  await controller.begin(["threads:read"]);
  const state = new URL(f.opened[0]).searchParams.get("state");
  const callback = controller.handleCallback(
    "mira-desktop://oauth/callback?state=" + state + "&code=mca_v1.id.secret");
  await writeStarted;
  await controller.signOut();
  release();
  await callback;
  assert.equal(controller.status().status, "signed_out");
  assert.equal(controller.status().account, null);
  const restored = f.build();
  await restored.initialize();
  assert.equal(restored.status().status, "signed_out");
  assert.equal(f.calls.some((call) => call.url.endsWith("/v1/auth/logout")), true);
});

test("logout wins over a pending startup Cloud Session restore", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const first = f.build();
  await first.initialize();
  await first.begin([]);
  const state = new URL(f.opened[0]).searchParams.get("state");
  await first.handleCallback("mira-desktop://oauth/callback?state=" + state + "&code=mca_v1.id.secret");

  let entered;
  const restoring = new Promise((resolve) => { entered = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  f.setBeforeSessionRestore(async () => { entered(); await gate; });
  const second = f.build();
  const initialize = second.initialize();
  await restoring;
  assert.equal(second.status().status, "checking");
  await second.signOut();
  release();
  await initialize;
  assert.equal(second.status().status, "signed_out");
  assert.equal(second.status().account, null);
  const third = f.build();
  await third.initialize();
  assert.equal(third.status().status, "signed_out");
});

test("a delayed system-browser launch cannot undo sign-out", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  let entered;
  const opening = new Promise((resolve) => { entered = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  f.setBeforeOpenExternal(async () => { entered(); await gate; });
  const controller = f.build();
  await controller.initialize();
  const begin = controller.begin(["threads:read"]);
  await opening;
  await controller.signOut();
  release();
  await begin;
  assert.equal(controller.status().status, "signed_out");
  assert.equal(controller.status().account, null);
});

test("abandoned browser authorization is cancellable; stale callbacks cannot exchange a token", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build();
  await controller.initialize();
  await controller.begin(["tools:invoke"]);
  const stateOne = new URL(f.opened[0]).searchParams.get("state");
  assert.equal(controller.status().status, "authorizing");
  assert.equal(controller.cancelAuthorization().status, "signed_out");
  assert.match(controller.status().message, /已取消/);
  assert.equal(await controller.handleCallback(
    "mira-desktop://oauth/callback?state=" + stateOne + "&code=mca_v1.id.secret"), false);
  assert.equal(f.calls.some((call) => call.url.endsWith("/v1/oauth/token")), false);
  await controller.begin([]);
  const stateTwo = new URL(f.opened[1]).searchParams.get("state");
  assert.notEqual(stateTwo, stateOne);
  assert.equal(await controller.handleCallback(
    "mira-desktop://oauth/callback?state=" + stateOne + "&code=mca_v1.id.secret"), false);
  assert.equal(await controller.handleCallback(
    "mira-desktop://oauth/callback?state=" + stateTwo +
    "&error=access_denied&error_description=User%20cancelled"), true);
  assert.equal(controller.status().status, "signed_out");
  assert.equal(controller.cancelAuthorization().status, "signed_out");
  await controller.begin([]);
  assert.equal(controller.status().status, "authorizing");
  assert.equal(f.calls.some((call) => call.url.endsWith("/v1/oauth/token")), false);
});

test("OAuth authorization expires and allows retry without process restart", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build({ authorizationTimeoutMs: 20 });
  await controller.initialize();
  await controller.begin([]);
  const expiredState = new URL(f.opened[0]).searchParams.get("state");
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(controller.status().status, "signed_out");
  assert.match(controller.status().message, /超时/);
  assert.equal(await controller.handleCallback(
    "mira-desktop://oauth/callback?state=" + expiredState + "&code=mca_v1.x.y"), false);
  await controller.begin([]);
  assert.equal(controller.status().status, "authorizing");
  assert.notEqual(new URL(f.opened[1]).searchParams.get("state"), expiredState);
  controller.cancelAuthorization();
});

test("cancel while shell.openExternal is pending cannot reinstate authorizing state", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  let entered;
  const opening = new Promise((resolve) => { entered = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  f.setBeforeOpenExternal(async () => { entered(); await gate; });
  const controller = f.build();
  await controller.initialize();
  const openingPromise = controller.begin(["threads:read"]);
  await opening;
  assert.equal(controller.status().status, "authorizing");
  assert.equal(controller.cancelAuthorization().status, "signed_out");
  release();
  assert.equal((await openingPromise).status, "signed_out");
  assert.equal(controller.status().status, "signed_out");
  const fresh = f.build();
  await fresh.initialize();
  assert.equal(fresh.status().status, "signed_out");
});

test("failed Host registration restores as setup_failed and retries with original encrypted scope choice", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  f.failHostRegistration();
  const first = f.build();
  await first.initialize();
  await first.begin(["threads:read", "tools:read"]);
  const state = new URL(f.opened[0]).searchParams.get("state");
  await first.handleCallback("mira-desktop://oauth/callback?state=" + state + "&code=mca_v1.id.secret");
  assert.equal(first.status().status, "setup_failed");
  assert.equal(first.status().permissionsConfigured, false);
  assert.equal(first.status().hostId, null);
  assert.equal(JSON.stringify(first.status()).includes("mcs_v1."), false);

  const second = f.build(); // restart with persisted Cloud Session, no OAuth browser flow
  await second.initialize();
  assert.equal(second.status().status, "setup_failed");
  assert.match(second.status().message, /重试/);
  assert.equal(f.opened.length, 1);
  const result = await second.retryHostSetup();
  assert.equal(result.status, "signed_in");
  assert.equal(result.hostId, "host-1");
  assert.deepEqual(result.scopes, ["threads:read", "tools:read"]);
  assert.equal(result.permissionsConfigured, true);
  const puts = f.calls.filter((call) => call.url.endsWith("/grant-policy"));
  assert.equal(puts.length, 1);
  assert.deepEqual(JSON.parse(puts[0].opts.body).scopes, ["threads:read", "tools:read"]);
  assert.equal(f.calls.filter((call) => call.url.endsWith("/v1/oauth/token")).length, 1);
  assert.equal(fs.readFileSync(f.store, "utf8").includes("tools:read"), false);
  const third = f.build();
  await third.initialize();
  assert.equal(third.status().status, "signed_in");
});

test("Host retry preserves a server policy that completed despite the earlier failure", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  f.failHostRegistration();
  const first = f.build();
  await first.initialize();
  await first.begin(["tools:control"]);
  const state = new URL(f.opened[0]).searchParams.get("state");
  await first.handleCallback("mira-desktop://oauth/callback?state=" + state + "&code=mca_v1.x.y");
  assert.equal(first.status().status, "setup_failed");
  f.setStoredPolicy(["threads:read"]); // Portal now owns the ceiling
  const second = f.build();
  await second.initialize();
  const result = await second.retryHostSetup();
  assert.equal(result.status, "signed_in");
  assert.deepEqual(result.scopes, ["threads:read"]);
  assert.equal(f.calls.filter((call) => call.url.endsWith("/grant-policy")).length, 0);
});

test("sign-out during Host retry prevents late setup from restoring the signed-in state", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  f.failHostRegistration();
  const first = f.build();
  await first.initialize();
  await first.begin(["threads:read"]);
  const state = new URL(f.opened[0]).searchParams.get("state");
  await first.handleCallback("mira-desktop://oauth/callback?state=" + state + "&code=mca_v1.x.y");
  const resumed = f.build();
  await resumed.initialize();
  let entering;
  const entered = new Promise((resolve) => { entering = resolve; });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  f.setBeforePolicyPut(async () => { entering(); await blocked; });
  const retry = resumed.retryHostSetup();
  await entered;
  await resumed.signOut();
  release();
  await retry;
  assert.equal(resumed.status().status, "signed_out");
  const restarted = f.build();
  await restarted.initialize();
  assert.equal(restarted.status().status, "signed_out");
});

test("unreadable encrypted record is only replaced by explicit credential reset", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const first = f.build();
  await first.initialize();
  const corrupted = "corrupted-keychain-record";
  fs.writeFileSync(f.store, corrupted);
  const second = f.build();
  await second.initialize();
  assert.equal(second.status().status, "unavailable");
  assert.equal(second.status().canResetCredentials, true);
  assert.equal(fs.readFileSync(f.store, "utf8"), corrupted);
  const recovered = second.resetLocalCredentials();
  assert.equal(recovered.status, "signed_out");
  assert.equal(recovered.canResetCredentials, false);
  assert.match(recovered.message, /旧云端会话未确认撤销/);
  assert.equal(fs.readFileSync(f.store, "utf8").includes("installationId"), false);
  const third = f.build();
  await third.initialize();
  assert.equal(third.status().status, "signed_out");
  assert.equal(third.status().canResetCredentials, false);
});

test("missing OS encryption must not offer credential reset or plaintext recovery", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const first = f.build();
  await first.initialize();
  const disabled = f.build({ safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
  } });
  await disabled.initialize();
  assert.equal(disabled.status().status, "unavailable");
  assert.equal(disabled.status().canResetCredentials, false);
  assert.throws(() => disabled.resetLocalCredentials(), /不允许重置/);
});

test("OAuth callback tolerates standard optional metadata but pins the issuer", () => {
  const state = "a".repeat(32);
  const callback = (params) => "mira-desktop://oauth/callback?" +
    new URLSearchParams({ state, ...params }).toString();
  assert.deepEqual(parseCallback(callback({
    code: "mca_v1.id.secret", iss: "https://cloud-auth.tomzlab.cn",
  })), { state, code: "mca_v1.id.secret", error: null });
  assert.deepEqual(parseCallback(callback({
    error: "access_denied", error_description: "User declined",
    error_uri: "https://cloud-auth.tomzlab.cn/help/oauth",
    iss: "https://cloud-auth.tomzlab.cn",
  })), { state, code: null, error: "access_denied" });
  assert.equal(parseCallback(callback({
    code: "mca_v1.id.secret", iss: "https://attacker.example",
  })), null);
  assert.equal(parseCallback(callback({
    code: "mca_v1.id.secret", error_uri: "https://cloud-auth.tomzlab.cn/help",
  })), null);
  assert.equal(parseCallback(callback({
    code: "mca_v1.id.secret", unexpected: "ignored",
  })), null);
  assert.equal(parseCallback(callback({ code: "mca_v1.id.secret" }) +
    "&iss=https%3A%2F%2Fcloud-auth.tomzlab.cn&iss=https%3A%2F%2Fcloud-auth.tomzlab.cn"), null);
});

test("OAuth denial with optional error_uri and issuer returns to signed-out without token exchange", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build();
  await controller.initialize();
  await controller.begin([]);
  const state = new URL(f.opened[0]).searchParams.get("state");
  const query = new URLSearchParams({
    state, error: "access_denied", error_description: "User declined",
    error_uri: "https://cloud-auth.tomzlab.cn/help/oauth",
    iss: "https://cloud-auth.tomzlab.cn",
  });
  assert.equal(await controller.handleCallback(
    "mira-desktop://oauth/callback?" + query.toString()), true);
  assert.equal(controller.status().status, "signed_out");
  assert.equal(f.calls.some((call) => call.url.endsWith("/v1/oauth/token")), false);
  await controller.begin([]);
  assert.equal(controller.status().status, "authorizing");
  controller.cancelAuthorization();
});
