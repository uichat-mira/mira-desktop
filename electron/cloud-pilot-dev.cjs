"use strict";

const path = require("node:path");

function resolveCloudPilotBackendLaunch({
  workspaceRoot,
  nodeBinary,
  baseEnv = process.env,
  runtimeConfig,
}) {
  if (typeof workspaceRoot !== "string" || !path.isAbsolute(workspaceRoot)) {
    throw new TypeError("Cloud Pilot requires an absolute workspace root");
  }
  if (typeof nodeBinary !== "string" || !path.isAbsolute(nodeBinary)) {
    throw new TypeError("Cloud Pilot requires an absolute Node executable path");
  }

  const host = runtimeConfig?.backend?.host;
  const port = runtimeConfig?.backend?.port;
  if (typeof host !== "string" || !host ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("Cloud Pilot requires the canonical backend host and port");
  }

  const serverDir = path.join(workspaceRoot, "server");
  const tsxCliPath = path.join(serverDir, "node_modules", "tsx", "dist", "cli.mjs");
  const serverEntryPath = path.join(serverDir, "src", "index.ts");
  const backendUrl = `http://${host}:${port}`;
  const backendEnv = { ...baseEnv };
  delete backendEnv.UI_CHAT_CLOUD_PILOT;
  delete backendEnv.UI_CHAT_CLOUD_PILOT_NODE_BINARY;

  return {
    nodeBinary,
    args: [tsxCliPath, serverEntryPath],
    options: {
      cwd: serverDir,
      env: {
        ...backendEnv,
        HOST: host,
        PORT: String(port),
        UI_CHAT_BACKEND_URL: backendUrl,
        UI_CHAT_ALLOW_BACKEND_REUSE: "0",
        // This marker is safe only because Electron starts this exact child
        // with the dedicated IPC stdio channel below.
        UI_CHAT_CLOUD_IPC_CHILD: "1",
      },
      // Deliberately run tsx without watch: the Electron-owned process must
      // retain Node's IPC channel for native Cloud ticket and grant messages.
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  };
}

module.exports = { resolveCloudPilotBackendLaunch };
