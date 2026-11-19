"use strict";

// DSK-016: one standard Desktop development path. Electron Main owns the
// source Backend child so the private Cloud Relay ticket / Host Grant IPC
// channel exists in Dev exactly as it does in a packaged build. Main also owns
// the restart loop because `tsx watch` would supervise an inner process that
// can never inherit this child IPC channel.
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const DEV_BACKEND_OWNER_ENV = "UI_CHAT_DEV_OWN_BACKEND";
const DEV_BACKEND_NODE_BINARY_ENV = "UI_CHAT_DEV_NODE_BINARY";
// Removed by DSK-016. Still stripped from inherited environments so a stale
// local .env file cannot reintroduce two competing development paths.
const LEGACY_CLOUD_PILOT_ENV_KEYS = [
  "UI_CHAT_CLOUD_PILOT",
  "UI_CHAT_CLOUD_PILOT_NODE_BINARY",
];

const WATCH_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"]);
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "coverage",
  "test-report",
  "client-coverage",
  "server-coverage",
  ".artifacts",
]);

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new TypeError(`Dev Backend requires an absolute ${label}`);
  }
  return value;
}

function resolveDevBackendLaunch({
  workspaceRoot,
  nodeBinary,
  baseEnv = process.env,
  runtimeConfig,
}) {
  requireAbsolutePath(workspaceRoot, "workspace root");
  requireAbsolutePath(nodeBinary, "Node executable path");

  const host = runtimeConfig?.backend?.host;
  const port = runtimeConfig?.backend?.port;
  if (typeof host !== "string" || !host ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("Dev Backend requires the canonical backend host and port");
  }

  const serverDir = path.join(workspaceRoot, "server");
  const tsxCliPath = path.join(serverDir, "node_modules", "tsx", "dist", "cli.mjs");
  const serverEntryPath = path.join(serverDir, "src", "index.ts");
  const backendUrl = `http://${host}:${port}`;
  const backendEnv = { ...baseEnv };
  for (const key of LEGACY_CLOUD_PILOT_ENV_KEYS) delete backendEnv[key];
  delete backendEnv[DEV_BACKEND_NODE_BINARY_ENV];
  delete backendEnv[DEV_BACKEND_OWNER_ENV];

  return {
    nodeBinary,
    args: [tsxCliPath, serverEntryPath],
    serverEntryPath,
    tsxCliPath,
    options: {
      cwd: serverDir,
      env: {
        ...backendEnv,
        HOST: host,
        PORT: String(port),
        UI_CHAT_BACKEND_URL: backendUrl,
        // An independently started Backend can never receive this child's
        // private IPC channel, so a port collision must fail instead of
        // silently running an unattached Cloud Host.
        UI_CHAT_ALLOW_BACKEND_REUSE: "0",
        // This marker is safe only because Electron starts this exact child
        // with the dedicated IPC stdio channel below.
        UI_CHAT_CLOUD_IPC_CHILD: "1",
      },
      // Direct tsx execution stays in one process. `tsx watch` would insert a
      // supervisor between Electron and the Backend and break the IPC channel.
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  };
}

function resolveDevBackendSourceDir(workspaceRoot) {
  requireAbsolutePath(workspaceRoot, "workspace root");
  // Watch the runtime source only. The server data directory, logs, node_modules
  // and build output must never trigger a Backend restart.
  return path.join(workspaceRoot, "server", "src");
}

function assertBackendIpcOwnership(child) {
  if (!child || typeof child.send !== "function" ||
      typeof child.on !== "function" || child.connected !== true) {
    throw new Error(
      "Dev Backend was not created with Electron's private Node IPC channel; refusing to run an unattached Backend.",
    );
  }
  return child;
}

function isTcpPortOpen(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const cleanup = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => cleanup(true));
    socket.once("timeout", () => cleanup(false));
    socket.once("error", () => cleanup(false));
  });
}

/**
 * Terminates one Electron-owned child and resolves only after it exits (or a
 * bounded forced kill). Shared by the launcher and Main so Vite/Electron and
 * the source Backend have the same deterministic cleanup contract.
 */
function terminateOwnedChild(child, {
  platform = process.platform,
  timeoutMs = 5000,
  killTree = platform === "win32"
    ? (target) => {
      spawn(process.env.ComSpec || "cmd.exe", [
        "/d", "/s", "/c", `taskkill /PID ${target.pid} /T /F`,
      ], { stdio: "ignore", windowsHide: true });
    }
    : (target) => target.kill("SIGTERM"),
} = {}) {
  if (!child || child.exitCode != null || child.signalCode != null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", finish);
      child.removeListener("close", finish);
      resolve();
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The child already exited.
      }
      finish();
    }, timeoutMs);
    timer.unref?.();
    child.once("exit", finish);
    child.once("close", finish);

    try {
      killTree(child);
    } catch {
      // The child already exited; resolve on the final state below.
      finish();
    }
  });
}

async function assertBackendPortAvailable(
  host,
  port,
  isPortOpen = isTcpPortOpen,
) {
  if (await isPortOpen(host, port)) {
    throw new Error(
      `The standard Desktop dev launch requires exclusive Backend ownership, but ${host}:${port} is already listening. ` +
      "Stop the other process; an independently started Backend cannot receive Electron's private IPC channel.",
    );
  }
}

function shouldReloadBackendPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return false;
  }

  const segments = relativePath.replace(/\\/gu, "/").split("/");
  if (segments.some((segment) => IGNORED_DIRECTORIES.has(segment))) {
    return false;
  }

  const baseName = segments[segments.length - 1];
  if (/(?:\.test|\.spec)\.[cm]?[jt]sx?$/u.test(baseName)) {
    return false;
  }

  return WATCH_EXTENSIONS.has(path.posix.extname(baseName).toLowerCase());
}

function createDevBackendWatcher({
  sourceDir,
  onChange,
  debounceMs = 250,
  watch = fs.watch,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (typeof sourceDir !== "string" || !path.isAbsolute(sourceDir)) {
    throw new TypeError("Dev Backend watcher requires an absolute server source directory");
  }
  if (typeof onChange !== "function") {
    throw new TypeError("Dev Backend watcher requires an onChange callback");
  }
  if (!Number.isInteger(debounceMs) || debounceMs < 0) {
    throw new TypeError("Dev Backend watcher debounce must be a non-negative integer");
  }

  let timer = null;
  let closed = false;
  const watcher = watch(sourceDir, { recursive: true }, (_eventType, filename) => {
    if (closed || filename == null || !shouldReloadBackendPath(String(filename))) {
      return;
    }
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      if (closed) return;
      onChange({ path: String(filename) });
    }, debounceMs);
    timer?.unref?.();
  });

  return {
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimer(timer);
      timer = null;
      watcher.close();
    },
  };
}

/**
 * Coalesces file-change bursts into at most one follow-up restart while a
 * restart is already running. A failed restart must be handled by the
 * `restartBackend` implementation so the next source edit can try again.
 */
function createRestartQueue(restartBackend) {
  if (typeof restartBackend !== "function") {
    throw new TypeError("Dev Backend restart queue requires a restart function");
  }

  let running = false;
  let queued = false;
  let idle = Promise.resolve();

  async function drain() {
    do {
      queued = false;
      await restartBackend();
    } while (queued);
  }

  function start() {
    running = true;
    idle = drain().finally(() => {
      running = false;
      // A request that arrived between the loop exit and this finally must
      // still produce a follow-up restart.
      if (queued) start();
    });
  }

  function request() {
    if (running) {
      queued = true;
      return idle;
    }
    start();
    return idle;
  }

  return { request, whenIdle: () => idle };
}

module.exports = {
  DEV_BACKEND_OWNER_ENV,
  DEV_BACKEND_NODE_BINARY_ENV,
  assertBackendIpcOwnership,
  assertBackendPortAvailable,
  createDevBackendWatcher,
  createRestartQueue,
  isTcpPortOpen,
  resolveDevBackendLaunch,
  resolveDevBackendSourceDir,
  shouldReloadBackendPath,
  terminateOwnedChild,
};
