
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
  const fetcher = async (url, opts) => {
    calls.push({ url, opts });
    if (offline) throw new Error("connection reset");
    if (url.endsWith("/v1/oauth/token")) return Response.json({
      sessionToken: "mcs_v1.session.secret",
      account: { id: "account-a", username: "test-a" },
      expiresAt: "2026-12-12T00:00:00.000Z",
    });
    if (url.endsWith("/v1/hosts") && opts.method === "POST")
      return Response.json({ id: "host-1" });
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
