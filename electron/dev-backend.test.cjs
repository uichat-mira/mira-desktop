"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const { EventEmitter } = require("node:events");

const {
  DEV_BACKEND_NODE_BINARY_ENV,
  DEV_BACKEND_OWNER_ENV,
  assertBackendIpcOwnership,
  assertBackendPortAvailable,
  createDevBackendWatcher,
  createRestartQueue,
  isTcpPortOpen,
  resolveDevBackendLaunch,
  resolveDevBackendSourceDir,
  shouldReloadBackendPath,
  terminateOwnedChild,
} = require("./dev-backend.cjs");

test("standard dev starts the source Backend with Electron-owned child IPC", () => {
  const workspaceRoot = path.resolve("C:/work/mira-desktop");
  const nodeBinary = path.resolve("C:/Program Files/nodejs/node.exe");
  const launch = resolveDevBackendLaunch({
    workspaceRoot,
    nodeBinary,
    baseEnv: {
      PATH: "C:/Windows/System32",
      UI_CHAT_CLOUD_PILOT: "1",
      UI_CHAT_CLOUD_PILOT_NODE_BINARY: "must-not-leak-to-backend.exe",
      [DEV_BACKEND_OWNER_ENV]: "1",
      [DEV_BACKEND_NODE_BINARY_ENV]: "must-not-leak-to-backend.exe",
      UI_CHAT_WORKSPACE_ROOT: "C:/Mira Workspace",
      UI_CHAT_ALLOW_BACKEND_REUSE: "1",
    },
    runtimeConfig: { backend: { host: "127.0.0.1", port: 8787 } },
  });

  assert.equal(launch.nodeBinary, nodeBinary);
  assert.deepEqual(launch.args, [
    path.join(workspaceRoot, "server", "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(workspaceRoot, "server", "src", "index.ts"),
  ]);
  assert.equal(launch.options.cwd, path.join(workspaceRoot, "server"));
  assert.deepEqual(launch.options.stdio, ["ignore", "pipe", "pipe", "ipc"]);
  assert.equal(launch.options.env.UI_CHAT_CLOUD_IPC_CHILD, "1");
  assert.equal(launch.options.env.UI_CHAT_ALLOW_BACKEND_REUSE, "0");
  assert.equal(launch.options.env.UI_CHAT_BACKEND_URL, "http://127.0.0.1:8787");
  assert.equal(launch.options.env.HOST, "127.0.0.1");
  assert.equal(launch.options.env.PORT, "8787");
  assert.equal(launch.options.env.UI_CHAT_WORKSPACE_ROOT, "C:/Mira Workspace");
  assert.equal(launch.options.env.UI_CHAT_CLOUD_PILOT, undefined);
  assert.equal(launch.options.env.UI_CHAT_CLOUD_PILOT_NODE_BINARY, undefined);
  assert.equal(launch.options.env[DEV_BACKEND_OWNER_ENV], undefined);
  assert.equal(launch.options.env[DEV_BACKEND_NODE_BINARY_ENV], undefined);
  assert.equal(launch.args.includes("watch"), false);
});

test("standard dev rejects relative executable and workspace paths", () => {
  const runtimeConfig = { backend: { host: "127.0.0.1", port: 8787 } };

  assert.throws(
    () => resolveDevBackendLaunch({
      workspaceRoot: "relative/workspace",
      nodeBinary: path.resolve("node.exe"),
      runtimeConfig,
    }),
    /absolute workspace root/,
  );

  assert.throws(
    () => resolveDevBackendLaunch({
      workspaceRoot: path.resolve("workspace"),
      nodeBinary: "node.exe",
      runtimeConfig,
    }),
    /absolute Node executable path/,
  );
});

test("standard dev rejects an invalid backend port instead of inventing a default", () => {
  assert.throws(
    () => resolveDevBackendLaunch({
      workspaceRoot: path.resolve("workspace"),
      nodeBinary: path.resolve("node.exe"),
      runtimeConfig: { backend: { host: "127.0.0.1", port: 0 } },
    }),
    /canonical backend host and port/,
  );
});

test("a Backend without the private IPC channel fails closed", () => {
  assert.throws(
    () => assertBackendIpcOwnership(null),
    /private Node IPC channel/,
  );

  const disconnected = new EventEmitter();
  disconnected.connected = false;
  disconnected.send = () => true;
  assert.throws(
    () => assertBackendIpcOwnership(disconnected),
    /refusing to run an unattached Backend/,
  );

  const owned = new EventEmitter();
  owned.connected = true;
  owned.send = () => true;
  assert.equal(assertBackendIpcOwnership(owned), owned);
});

test("an occupied Backend port is rejected instead of reused", async () => {
  await assert.rejects(
    assertBackendPortAvailable("127.0.0.1", 8787, async () => true),
    /exclusive Backend ownership.*already listening/,
  );
  await assert.doesNotReject(
    assertBackendPortAvailable("127.0.0.1", 8787, async () => false),
  );
});

test("dev detects a real listening Backend port", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.equal(await isTcpPortOpen("127.0.0.1", address.port), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await isTcpPortOpen("127.0.0.1", address.port), false);
});

test("the dev watcher only targets the server runtime source directory", () => {
  const workspaceRoot = path.resolve("workspace");
  assert.equal(
    resolveDevBackendSourceDir(workspaceRoot),
    path.join(workspaceRoot, "server", "src"),
  );
});

test("only Backend source changes trigger a reload", () => {
  assert.equal(shouldReloadBackendPath("index.ts"), true);
  assert.equal(shouldReloadBackendPath("src\\routes\\remote-access.ts"), true);
  assert.equal(shouldReloadBackendPath("config/app.json"), true);

  assert.equal(shouldReloadBackendPath("index.test.ts"), false);
  assert.equal(shouldReloadBackendPath("routes/chat.spec.tsx"), false);
  assert.equal(shouldReloadBackendPath("node_modules/pkg/index.ts"), false);
  assert.equal(shouldReloadBackendPath("dist/index.js"), false);
  assert.equal(shouldReloadBackendPath("README.md"), false);
  assert.equal(shouldReloadBackendPath(""), false);
});

test("a burst of source changes schedules one debounced reload", () => {
  let emitChange;
  let closed = false;
  const events = [];
  const timers = new Map();
  let nextTimerId = 1;

  const watcher = createDevBackendWatcher({
    sourceDir: path.resolve("server"),
    debounceMs: 50,
    watch: (_dir, _options, listener) => {
      emitChange = listener;
      return { close() { closed = true; } };
    },
    setTimer: (callback) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onChange: (info) => events.push(info),
  });

  emitChange("change", "src/index.ts");
  const firstTimerId = [...timers.keys()][0];
  emitChange("change", "src\\routes\\remote-access.ts");

  assert.equal(timers.has(firstTimerId), false);
  assert.equal(timers.size, 1);

  // Test files are not part of the runtime module graph and must not restart
  // the Backend or reset the pending debounce.
  emitChange("change", "src/index.test.ts");
  assert.equal(timers.size, 1);

  for (const [id, callback] of [...timers.entries()]) {
    timers.delete(id);
    callback();
  }
  assert.deepEqual(events, [{ path: "src\\routes\\remote-access.ts" }]);

  watcher.close();
  assert.equal(closed, true);
  assert.equal(timers.size, 0);
});

test("closing the watcher cancels a pending reload", () => {
  let emitChange;
  const events = [];
  const timers = new Map();
  let nextTimerId = 1;

  const watcher = createDevBackendWatcher({
    sourceDir: path.resolve("server"),
    watch: (_dir, _options, listener) => {
      emitChange = listener;
      return { close() {} };
    },
    setTimer: (callback) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onChange: (info) => events.push(info),
  });

  emitChange("change", "src/index.ts");
  assert.equal(timers.size, 1);

  watcher.close();
  assert.equal(timers.size, 0);

  emitChange("change", "src/late.ts");
  assert.equal(timers.size, 0);
  assert.deepEqual(events, []);
});

test("an in-flight Backend restart coalesces later edits into one follow-up", async () => {
  let releaseFirstRestart;
  let restarts = 0;
  const queue = createRestartQueue(async () => {
    restarts += 1;
    if (restarts === 1) {
      await new Promise((resolve) => {
        releaseFirstRestart = resolve;
      });
    }
  });

  const first = queue.request();
  queue.request();
  queue.request();
  assert.equal(restarts, 1);

  releaseFirstRestart();
  await first;
  await queue.whenIdle();
  assert.equal(restarts, 2);
});

test("owned child termination waits for exit and skips already-exited children", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 4242;
  child.kill = (signal) => {
    child.signalCode = signal ?? "SIGTERM";
    child.emit("exit", null, child.signalCode);
    return true;
  };

  await terminateOwnedChild(child, {
    platform: "linux",
    killTree: (target) => target.kill("SIGTERM"),
  });
  assert.equal(child.signalCode, "SIGTERM");

  let killed = false;
  const exited = new EventEmitter();
  exited.exitCode = 0;
  exited.kill = () => {
    killed = true;
    return true;
  };
  await terminateOwnedChild(exited, {
    platform: "linux",
    killTree: (target) => target.kill("SIGTERM"),
  });
  assert.equal(killed, false);
});
