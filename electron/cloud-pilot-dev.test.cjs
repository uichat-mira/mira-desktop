"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { resolveCloudPilotBackendLaunch } = require("./cloud-pilot-dev.cjs");

test("Cloud Pilot starts the source Backend directly with an Electron-owned IPC channel", () => {
  const workspaceRoot = path.resolve("C:/work/mira-desktop");
  const nodeBinary = path.resolve("C:/Program Files/nodejs/node.exe");
  const launch = resolveCloudPilotBackendLaunch({
    workspaceRoot,
    nodeBinary,
    baseEnv: {
      PATH: "C:/Windows/System32",
      UI_CHAT_CLOUD_PILOT: "1",
      UI_CHAT_CLOUD_PILOT_NODE_BINARY: "must-not-leak-to-backend.exe",
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
  assert.equal(launch.options.env.UI_CHAT_WORKSPACE_ROOT, "C:/Mira Workspace");
  assert.equal(launch.options.env.UI_CHAT_CLOUD_PILOT, undefined);
  assert.equal(launch.options.env.UI_CHAT_CLOUD_PILOT_NODE_BINARY, undefined);
  assert.equal(launch.args.includes("watch"), false);
});

test("Cloud Pilot rejects relative executable and workspace paths", () => {
  const runtimeConfig = { backend: { host: "127.0.0.1", port: 8787 } };

  assert.throws(
    () => resolveCloudPilotBackendLaunch({
      workspaceRoot: "relative/workspace",
      nodeBinary: path.resolve("node.exe"),
      runtimeConfig,
    }),
    /absolute workspace root/,
  );

  assert.throws(
    () => resolveCloudPilotBackendLaunch({
      workspaceRoot: path.resolve("workspace"),
      nodeBinary: "node.exe",
      runtimeConfig,
    }),
    /absolute Node executable path/,
  );
});

test("Cloud Pilot rejects an invalid backend port instead of inventing a default", () => {
  assert.throws(
    () => resolveCloudPilotBackendLaunch({
      workspaceRoot: path.resolve("workspace"),
      nodeBinary: path.resolve("node.exe"),
      runtimeConfig: { backend: { host: "127.0.0.1", port: 0 } },
    }),
    /canonical backend host and port/,
  );
});
