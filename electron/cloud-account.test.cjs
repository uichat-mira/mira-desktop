
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCloudAccountController, parseCallback, validateScopes } = require("./cloud-account.cjs");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mira-cloud-"));
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
      return Response.json({ revision: 0, policyConfigured: false });
    if (url.endsWith("/v1/hosts/host-1/grant-policy"))
      return Response.json({ hostId: "host-1", revision: 1 });
    if (url.endsWith("/v1/auth/session"))
      return Response.json({ account: { id: "account-a", username: "test-a" }, expiresAt: "2026-12-12T00:00:00.000Z" });
    if (url.endsWith("/v1/auth/logout")) return new Response(null, { status: 204 });
    throw new Error("unexpected route " + url);
  };
  const build = () => createCloudAccountController({
    app: { getPath: () => dir }, safeStorage: storage,
    shell: { openExternal: async (url) => { opened.push(url); } },
    notify: () => {}, fetcher, storagePath: store,
  });
  return { dir, store, opened, calls, build, setOffline: (yes) => { offline = yes; } };
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
