
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const vm = require("node:vm");

test("secondary Electron instance cannot initialize Cloud OAuth, Backend or a window", async () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  let quits = 0;
  let controllerStarts = 0;
  let backendStarts = 0;
  let windowStarts = 0;
  const app = {
    isPackaged: true,
    requestSingleInstanceLock: () => false,
    quit: () => { quits += 1; },
    on: () => {},
    getPath: (name) => "/fixture/" + name,
    whenReady: () => Promise.resolve(),
  };
  const electron = {
    app,
    BrowserWindow: class { constructor() { windowStarts += 1; } },
    dialog: { showErrorBox: () => {} },
    ipcMain: { handle: () => {} },
    net: { fetch: () => {} },
    safeStorage: {},
    shell: {},
  };
  const mockedRequire = (name) => {
    if (name === "electron") return electron;
    if (name === "path") return path;
    if (name === "fs") return {
      existsSync: () => true,
      readFileSync: () => "test-secret",
      mkdirSync: () => {},
      statSync: () => ({ isDirectory: () => true }),
    };
    if (name === "child_process") return {
      execFileSync: () => {},
      spawn: () => {
        backendStarts += 1;
        return { stdout: null, stderr: null, on: () => {}, kill: () => {} };
      },
    };
    if (name === "./cloud-account.cjs") return {
      createCloudAccountController: () => {
        controllerStarts += 1;
        return { initialize: () => {} };
      },
    };
    if (name === "./cloud-relay-ticket-ipc.cjs") return {
      attachCloudRelayTicketIpc: () => {},
      attachCloudHostGrantIpc: () => {},
    };
    if (name.endsWith("runtime.config.cjs")) return {
      backend: { host: "127.0.0.1", port: 6000 },
    };
    throw new Error("Unexpected require in secondary-instance fixture: " + name);
  };
  vm.runInNewContext(mainSource, {
    require: mockedRequire,
    __dirname: path.join(__dirname, "__single_instance_fixture__"),
    process: { argv: ["electron", "main.cjs"], platform: "win32", pid: 123, execPath: "electron", resourcesPath: "/resources", env: {} },
    fetch: async () => ({ ok: true }),
    console: { log: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    Buffer,
  }, { filename: "electron/main.cjs", timeout: 1000 });
  // The mock whenReady resolves even after quit, reproducing the startup race.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quits, 1, "a secondary instance requests termination");
  assert.equal(controllerStarts, 0, "secondary must not own Cloud OAuth");
  assert.equal(backendStarts, 0, "secondary must not start the Backend");
  assert.equal(windowStarts, 0, "secondary must not open a competing window");
});

const { createCloudAccountController, parseCallback, validateScopes,
  RELAY_TICKET_ERROR_CODES } = require("./cloud-account.cjs");

// Keep the production entrypoint bound to Chromium networking. Controller
// fixtures alone cannot detect a regression to Electron's Node/undici fetch.
test("Electron main wires native Cloud Auth to Chromium net.fetch", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /\bnet\b[^}]*\}\s*=\s*require\(["']electron["']\)/);
  const start = main.indexOf("cloudAccount = createCloudAccountController({");
  assert.notEqual(start, -1, "native Cloud Account controller must be constructed");
  const end = main.indexOf("notify:", start);
  assert.ok(end > start, "Cloud Account controller must have a notify boundary");
  assert.match(
    main.slice(start, end),
    /\bfetcher:\s*\(input,\s*init\)\s*=>\s*net\.fetch\(input,\s*init\)\s*,/,
    "Cloud Auth must not silently fall back to Electron's Node fetch",
  );
});

test("macOS dev bundle declares the OAuth scheme before native registration", () => {
  const preparePath = path.join(
    __dirname, "..", "scripts", "prepare-electron-macos-dev.mjs",
  );
  execFileSync(process.execPath, ["--check", preparePath], { stdio: "pipe" });
  const prepare = fs.readFileSync(preparePath, "utf8");
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");

  assert.match(prepare, /CFBundleURLTypes/);
  assert.match(prepare, /mira-desktop/);
  assert.match(prepare, /com\.tomz\.uichat\.dev/);
  assert.match(prepare, /CFBundleTypeRole/);
  assert.match(prepare, /lsregister/);
  assert.match(
    main,
    /process\.platform\s*===\s*["']darwin["'][\s\S]{0,600}setAsDefaultProtocolClient\(["']mira-desktop["']\)/,
    "prepared macOS dev bundles must attempt native protocol registration",
  );
});


const RELAY_AUDIENCE = "mira:cloud-relay-transport";
const RELAY_SCOPE = "relay:transport";
const RELAY_ROOM = "room_dGVzdC1yb29t";

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeTicket(options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttl ?? 300;
  const header = {
    alg: "EdDSA", typ: "JWT", kid: "cloud-auth-2026-10",
    ...(options.header || {}),
  };
  const claims = {
    iss: "mira:cloud-auth",
    sub: "account-a",
    device_id: "device-a",
    aud: RELAY_AUDIENCE,
    scope: [RELAY_SCOPE],
    relay: { room: RELAY_ROOM, role: "host" },
    iat: now,
    nbf: now,
    exp: now + ttl,
    ...(options.claims || {}),
  };
  if (options.omit) for (const key of options.omit) delete claims[key];
  return [base64urlJson(header), base64urlJson(claims), "c2lnbmF0dXJl"].join(".");
}

function issuedTicket(options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttl ?? 300;
  return {
    token: options.token ?? makeTicket({ ...options, now, ttl }),
    tokenType: options.tokenType ?? "Bearer",
    audience: options.responseAudience ?? RELAY_AUDIENCE,
    expiresAt: options.responseExpiresAt ?? new Date((now + ttl) * 1000).toISOString(),
  };
}

function hostPayload(overrides = {}) {
  return {
    id: "host-1", deviceId: "device-a", displayName: "Mira Desktop",
    clientVersion: "1.0.0", availability: "available", relayRoom: RELAY_ROOM,
    registeredAt: "2026-10-25T12:00:00.000Z",
    lastAdvertisedAt: "2026-10-25T12:00:30.000Z",
    leaseExpiresAt: "2026-10-25T12:02:30.000Z",
    ...overrides,
  };
}

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
  let beforeServiceCredential = null;
  let grantSnapshot = null;
  let beforeGrantRead = null;
  let hostFailuresRemaining = 0;
  let hostHandler = null;
  let serviceCredentialHandler = null;
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
      if (hostHandler) {
        const custom = await hostHandler({ url, opts });
        if (custom) return custom;
      }
      return Response.json({ id: "host-1", deviceId: "device-a",
        displayName: "Mira Desktop", clientVersion: "1.0.0",
        availability: "available", relayRoom: RELAY_ROOM,
        registeredAt: "2026-10-25T12:00:00.000Z",
        lastAdvertisedAt: "2026-10-25T12:00:30.000Z",
        leaseExpiresAt: "2026-10-25T12:02:30.000Z" });
    }
    if (url.endsWith("/v1/service-credentials") && opts.method === "POST") {
      if (beforeServiceCredential) await beforeServiceCredential();
      if (serviceCredentialHandler) {
        const custom = await serviceCredentialHandler({ url, opts });
        if (custom) return custom;
      }
      return Response.json(issuedTicket());
    }
    if (url.endsWith("/v1/hosts/host-1/grants")) {
      if (beforeGrantRead) await beforeGrantRead();
      if (grantSnapshot) return Response.json(grantSnapshot);
      return Response.json({ hostId: "host-1", accountId: "account-a",
        revision: storedPolicy ? 7 : 0, policyConfigured: Boolean(storedPolicy),
        policyScopes: storedPolicy || [] });
    }
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
    setBeforeOpenExternal: (hook) => { beforeOpenExternal = hook; },
    setBeforeServiceCredential: (hook) => { beforeServiceCredential = hook; },
    setGrantSnapshot: (snapshot) => { grantSnapshot = snapshot; },
    setBeforeGrantRead: (hook) => { beforeGrantRead = hook; },
    setHostHandler: (handler) => { hostHandler = handler; },
    setServiceCredentialHandler: (handler) => { serviceCredentialHandler = handler; } };
}

async function signIn(f, controller, scopes = ["threads:read"]) {
  await controller.initialize();
  await controller.begin(scopes, 7);
  const state = new URL(f.opened.at(-1)).searchParams.get("state");
  await controller.handleCallback(
    "mira-desktop://oauth/callback?state=" + state + "&code=mca_v1.id.secret");
  assert.equal(controller.status().status, "signed_in");
}

function rejectsCode(promise, code) {
  return assert.rejects(promise, (error) => error.code === code);
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

test("DSK-009 acquires a host Relay ticket only through a trusted native consumer", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build();
  await signIn(f, controller);
  let delivered = null;
  await controller.withRelayHostTicket((ticket) => { delivered = ticket; });
  assert.ok(delivered);
  assert.equal(delivered.audience, RELAY_AUDIENCE);
  assert.equal(delivered.room, RELAY_ROOM);
  assert.equal(delivered.role, "host");
  assert.equal(Object.isFrozen(delivered), true);

  const credentialCall = f.calls.find((call) => call.url.endsWith("/v1/service-credentials"));
  assert.equal(credentialCall.opts.headers.authorization, "Bearer mcs_v1.session.secret");
  assert.deepEqual(JSON.parse(credentialCall.opts.body), {
    audience: RELAY_AUDIENCE,
    relay: { room: RELAY_ROOM, role: "host" },
  });
  assert.equal(f.calls.filter((call) =>
    call.url.endsWith("/v1/hosts") && call.opts.method === "POST").length, 2);

  const status = JSON.stringify(controller.status());
  assert.equal(status.includes(delivered.token), false);
  assert.equal(status.includes("mcs_v1."), false);
  const stored = fs.readFileSync(f.store, "utf8");
  assert.equal(stored.includes(delivered.token), false);
  assert.equal(stored.includes("mcs_v1."), false);
  assert.equal(await controller.withRelayHostTicket(() => {}), undefined);
});

test("DSK-009 fails closed without a configured session or on foreign Host ownership", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build();
  await controller.initialize();
  let consumed = false;
  await rejectsCode(controller.withRelayHostTicket(() => { consumed = true; }),
    RELAY_TICKET_ERROR_CODES.NOT_CONFIGURED);
  assert.equal(consumed, false);
  assert.equal(f.calls.some((call) => call.url.endsWith("/v1/service-credentials")), false);

  await signIn(f, controller);
  f.setHostHandler(() => Response.json(hostPayload({ id: "host-2" })));
  await rejectsCode(controller.withRelayHostTicket(() => { consumed = true; }),
    RELAY_TICKET_ERROR_CODES.HOST_MISMATCH);
  assert.equal(consumed, false);
  assert.equal(f.calls.some((call) => call.url.endsWith("/v1/service-credentials")), false);

  f.setHostHandler(() => Response.json(hostPayload({ availability: "offline" })));
  await rejectsCode(controller.withRelayHostTicket(() => { consumed = true; }),
    RELAY_TICKET_ERROR_CODES.NOT_AUTHORIZED);
  assert.equal(consumed, false);

  f.setHostHandler(() => Response.json(hostPayload({ relayRoom: "invalid room" })));
  await rejectsCode(controller.withRelayHostTicket(() => { consumed = true; }),
    RELAY_TICKET_ERROR_CODES.INVALID_RESPONSE);
  assert.equal(consumed, false);
  assert.equal(controller.status().status, "signed_in");
});

test("DSK-009 distinguishes relay denial from revoked Cloud Session and keeps recoverable session", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build();
  await signIn(f, controller);

  f.setServiceCredentialHandler(() => Response.json({
    error: { code: "SERVICE_CREDENTIAL_RELAY_NOT_AUTHORIZED",
      message: "Relay transport ticket is not authorized for this device" },
  }, { status: 403 }));
  let consumed = false;
  await rejectsCode(controller.withRelayHostTicket(() => { consumed = true; }),
    RELAY_TICKET_ERROR_CODES.NOT_AUTHORIZED);
  assert.equal(consumed, false);
  assert.equal(controller.status().status, "signed_in");
  const restarted = f.build();
  await restarted.initialize();
  assert.equal(restarted.status().status, "signed_in");

  f.setServiceCredentialHandler(() => Response.json({
    error: { code: "SERVICE_CREDENTIAL_DEVICE_REQUIRED",
      message: "A device-bound Mira Cloud Session is required" },
  }, { status: 403 }));
  await rejectsCode(restarted.withRelayHostTicket(() => { consumed = true; }),
    RELAY_TICKET_ERROR_CODES.DEVICE_REQUIRED);
  assert.equal(consumed, false);
  assert.equal(restarted.status().status, "signed_in");

  f.setServiceCredentialHandler(() => Response.json({
    error: { code: "SERVICE_CREDENTIAL_REAUTH_REQUIRED",
      message: "Re-authentication is required" },
  }, { status: 401 }));
  await rejectsCode(restarted.withRelayHostTicket(() => { consumed = true; }),
    RELAY_TICKET_ERROR_CODES.REAUTH);
  assert.equal(consumed, false);
  assert.equal(restarted.status().status, "rejected");
  assert.equal(restarted.status().account, null);
  const after = f.build();
  await after.initialize();
  assert.equal(after.status().status, "signed_out");
});

test("DSK-009 temporary Cloud outage is distinct from denial and preserves the session", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build();
  await signIn(f, controller);
  f.setOffline(true);
  let consumed = false;
  await rejectsCode(controller.withRelayHostTicket(() => { consumed = true; }),
    RELAY_TICKET_ERROR_CODES.UNAVAILABLE);
  assert.equal(consumed, false);
  assert.equal(controller.status().status, "signed_in");

  const offline = f.build();
  await offline.initialize();
  assert.equal(offline.status().status, "unavailable");
  assert.equal(offline.status().account.username, "test-a");

  f.setOffline(false);
  const restored = f.build();
  await restored.initialize();
  assert.equal(restored.status().status, "signed_in");
  let delivered = null;
  await restored.withRelayHostTicket((ticket) => { delivered = ticket; });
  assert.ok(delivered);
});

test("DSK-009 rejects malformed, expired, foreign and mismatched Relay tickets", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build();
  await signIn(f, controller);
  const now = Math.floor(Date.now() / 1000);
  const variants = [
    ["malformed token", { ...issuedTicket(), token: "not-a-jwt" }],
    ["wrong header algorithm", issuedTicket({ header: { alg: "HS256" } })],
    ["wrong issuer", issuedTicket({ claims: { iss: "attacker" } })],
    ["wrong account", issuedTicket({ claims: { sub: "account-b" } })],
    ["wrong device", issuedTicket({ claims: { device_id: "device-b" } })],
    ["wrong audience claim", issuedTicket({ claims: { aud: "mira:cloud-shiyan" } })],
    ["wrong response audience", issuedTicket({ responseAudience: "mira:cloud-shiyan" })],
    ["wrong scope", issuedTicket({ claims: { scope: ["shiyan:authenticate"] } })],
    ["wrong room", issuedTicket({ claims: { relay: { room: "room_other", role: "host" } } })],
    ["wrong role", issuedTicket({ claims: { relay: { room: RELAY_ROOM, role: "client" } } })],
    ["expired", issuedTicket({ now: now - 600, ttl: 300 })],
    ["expiresAt mismatch", issuedTicket({
      responseExpiresAt: new Date((now + 100) * 1000).toISOString(),
    })],
    ["extra claim", issuedTicket({ claims: { admin: true } })],
    ["missing relay", issuedTicket({ omit: ["relay"] })],
    ["extra response field", { ...issuedTicket(), hostToken: "leak" }],
  ];
  for (const [name, payload] of variants) {
    f.setServiceCredentialHandler(() => Response.json(payload));
    let consumed = false;
    await rejectsCode(controller.withRelayHostTicket(() => { consumed = true; }),
      RELAY_TICKET_ERROR_CODES.INVALID_RESPONSE);
    assert.equal(consumed, false, name);
    assert.equal(controller.status().status, "signed_in", name);
  }
});

test("DSK-009 sign-out during ticket acquisition discards the late ticket", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build();
  await signIn(f, controller);
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  f.setBeforeServiceCredential(async () => { entered(); await gate; });
  let consumed = false;
  const operation = controller.withRelayHostTicket(() => { consumed = true; });
  await started;
  await controller.signOut();
  release();
  await rejectsCode(operation, RELAY_TICKET_ERROR_CODES.ABORTED);
  assert.equal(consumed, false);
  assert.equal(controller.status().status, "signed_out");
});

test("DSK-009 Cloud reauth invalidates another in-flight Relay ticket request", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const controller = f.build();
  await signIn(f, controller);

  // Hold the second response while the first call reports a revoked session.
  // Both calls have already passed the original Cloud Session check.
  let secondEntered;
  const secondReady = new Promise((resolve) => { secondEntered = resolve; });
  let releaseSecond;
  const secondBlocked = new Promise((resolve) => { releaseSecond = resolve; });
  let requested = 0;
  f.setBeforeServiceCredential(async () => {
    requested += 1;
    if (requested === 1) {
      await secondReady;
    } else {
      secondEntered();
      await secondBlocked;
    }
  });

  let responded = 0;
  f.setServiceCredentialHandler(() => {
    responded += 1;
    if (responded === 1) {
      return Response.json({
        error: { code: "SERVICE_CREDENTIAL_REAUTH_REQUIRED",
          message: "Re-authentication is required" },
      }, { status: 401 });
    }
    return Response.json(issuedTicket());
  });

  let consumed = 0;
  const first = controller.withRelayHostTicket(() => { consumed += 1; });
  const second = controller.withRelayHostTicket(() => { consumed += 1; });

  await rejectsCode(first, RELAY_TICKET_ERROR_CODES.REAUTH);
  assert.equal(controller.status().status, "rejected");
  releaseSecond();
  await rejectsCode(second, RELAY_TICKET_ERROR_CODES.ABORTED);
  assert.equal(consumed, 0);
  assert.equal(requested, 2);
  assert.equal(responded, 2);

  const restarted = f.build();
  await restarted.initialize();
  assert.equal(restarted.status().status, "signed_out");
});

test("DSK-007 native owner fetches live scoped Host snapshot without passing Cloud bearer", async () => {
  const f = fixture();
  const controller = f.build();
  await signIn(f, controller);
  const issuedAt = new Date(Date.now() - 1000).toISOString();
  const validUntil = new Date(Date.now() + 200000).toISOString();
  const snapshot = {
    hostId: "host-1", accountId: "account-a", policyConfigured: true,
    policyScopes: ["threads:read"], revision: 5, issuedAt, validUntil,
    maxStalenessSeconds: 300,
    grants: [{ mobileDeviceId: "phone-a", scopes: ["threads:read"], status: "active" }],
  };
  f.setGrantSnapshot(snapshot);
  const resolved = await controller.requestHostGrantSnapshot();
  assert.deepEqual(resolved, snapshot);
  assert.equal(JSON.stringify(resolved).includes("mcs_v1."), false);
  const request = f.calls.at(-1);
  assert.equal(request.url.endsWith("/v1/hosts/host-1/grants"), true);
  assert.equal(request.opts.headers.authorization, "Bearer mcs_v1.session.secret");
  f.setGrantSnapshot({ ...snapshot, accountId: "other-account" });
  await rejectsCode(controller.requestHostGrantSnapshot(), "cloud_grant_invalid_response");
});

test("DSK-007 grant fetch rejects logout races and never revives an old session", async () => {
  const f = fixture();
  const controller = f.build();
  await signIn(f, controller);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  f.setBeforeGrantRead(() => gate);
  const inFlight = controller.requestHostGrantSnapshot();
  await controller.signOut();
  release();
  await rejectsCode(inFlight, "cloud_grant_aborted");
  await rejectsCode(controller.requestHostGrantSnapshot(), "cloud_grant_not_configured");
});

test("DSK-007 owner association is encrypted, survives native restore, and clears on signout", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const account = f.build();
  await signIn(f, account);
  assert.equal(account.getBoundLocalOwnerUserId(), 7);
  assert.equal(account.status().localOwnerBound, true);
  assert.equal(fs.readFileSync(f.store, "utf8").includes("localOwnerUserId"), false);
  const restored = f.build();
  await restored.initialize();
  assert.equal(restored.getBoundLocalOwnerUserId(), 7);
  await restored.signOut();
  assert.equal(restored.getBoundLocalOwnerUserId(), null);
  assert.equal(restored.status().localOwnerBound, false);
});

test("DSK-007 legacy Cloud sessions without local owner never yield Host business grants", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const account = f.build();
  await account.initialize();
  await account.begin(["threads:read"]); // legacy native flow, no verified owner
  const state = new URL(f.opened.at(-1)).searchParams.get("state");
  await account.handleCallback("mira-desktop://oauth/callback?state=" + state +
    "&code=mca_v1.id.secret");
  assert.equal(account.status().status, "signed_in");
  assert.equal(account.status().localOwnerBound, false);
  await rejectsCode(account.requestHostGrantSnapshot(), "cloud_grant_not_configured");
  assert.equal(account.getBoundLocalOwnerUserId(), null);
  await assert.rejects(account.begin([], -7), /本地 Mira 用户 ID 无效/);
});
