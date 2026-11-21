const net = require("net");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const electronBinary = require("electron");
const { pathToFileURL } = require("url");
const {
  DEV_BACKEND_NODE_BINARY_ENV,
  DEV_BACKEND_OWNER_ENV,
  assertBackendPortAvailable,
  isTcpPortOpen,
  terminateOwnedChild,
} = require("./dev-backend.cjs");

const STARTUP_TIMEOUT_MS = 60000;
const childProcesses = [];
let isShuttingDown = false;

function assertExistingDirectory(directoryPath, label) {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`${label} does not exist: ${directoryPath}`);
  }
  if (!fs.statSync(directoryPath).isDirectory()) {
    throw new Error(`${label} must be a directory: ${directoryPath}`);
  }
  return directoryPath;
}

function resolveBackendWorkspaceRoot(
  baseEnv = process.env,
  defaultWorkspaceRoot = path.join(
    os.homedir(),
    "Documents",
    "UIChat Mira",
    "Default Workspace",
  ),
) {
  const explicitWorkspaceRoot = baseEnv.UI_CHAT_WORKSPACE_ROOT?.trim();
  if (explicitWorkspaceRoot) {
    return assertExistingDirectory(
      path.resolve(explicitWorkspaceRoot),
      "UI_CHAT_WORKSPACE_ROOT",
    );
  }

  const resolvedDefaultRoot = path.resolve(defaultWorkspaceRoot);
  fs.mkdirSync(resolvedDefaultRoot, { recursive: true });
  return assertExistingDirectory(resolvedDefaultRoot, "Default workspace");
}

function buildBackendEnv(baseEnv = process.env, defaultWorkspaceRoot) {
  const { UI_CHAT_WORKSPACE_ROOT: _ignoredWorkspaceRoot, ...restEnv } = baseEnv;

  return {
    ...restEnv,
    // The standard dev Backend is always Electron-owned. A healthy listener
    // already on the port is never reused because it cannot receive the
    // private Cloud IPC channel.
    UI_CHAT_ALLOW_BACKEND_REUSE: "0",
    UI_CHAT_WORKSPACE_ROOT: resolveBackendWorkspaceRoot(
      baseEnv,
      defaultWorkspaceRoot,
    ),
  };
}

function buildElectronEnv(
  baseEnv = process.env,
  nodeBinary = process.execPath,
  defaultWorkspaceRoot,
) {
  if (typeof nodeBinary !== "string" || !path.isAbsolute(nodeBinary)) {
    throw new TypeError("The dev Backend requires an absolute Node executable path");
  }

  // A stale local .env must not reintroduce the retired Cloud Pilot path.
  const {
    UI_CHAT_CLOUD_PILOT: _legacyCloudPilot,
    UI_CHAT_CLOUD_PILOT_NODE_BINARY: _legacyCloudPilotNode,
    ...baseWithoutLegacyFlags
  } = baseEnv;

  return {
    ...buildBackendEnv(baseWithoutLegacyFlags, defaultWorkspaceRoot),
    [DEV_BACKEND_OWNER_ENV]: "1",
    [DEV_BACKEND_NODE_BINARY_ENV]: nodeBinary,
  };
}

function loadRuntimeConfig() {
  const candidates = [
    path.join(__dirname, "runtime.config.cjs"),
    path.join(__dirname, "..", "runtime.config.cjs"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }

  throw new Error(`Unable to locate runtime config. Checked: ${candidates.join(", ")}`);
}

function waitForReadySignal(name, readyWhen, timeoutMs) {
  let resolveReady;
  let rejectReady;
  let settled = false;
  let buffer = "";

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const timeoutId = setTimeout(() => {
    if (settled) {
      return;
    }

    settled = true;
    rejectReady(new Error(`Timed out waiting for ${name} to become ready`));
  }, timeoutMs);

  const markReady = () => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timeoutId);
    resolveReady();
  };

  const fail = (error) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timeoutId);
    rejectReady(error);
  };

  const handleChunk = (chunk) => {
    if (settled) {
      return;
    }

    const text = stripAnsi(String(chunk));
    buffer = `${buffer}${text}`.slice(-8000);

    if (readyWhen(text, buffer)) {
      markReady();
    }
  };

  return {
    ready,
    handleChunk,
    fail,
    markReady,
  };
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function resolveShellCommand(
  command,
  platform = process.platform,
  baseEnv = process.env,
) {
  return platform === "win32"
    ? { file: baseEnv.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] }
    : { file: "sh", args: ["-c", command] };
}

function spawnManagedProcess(name, cwd, command, options = {}) {
  const shellCommand = resolveShellCommand(command);

  const readiness = options.readyWhen
    ? waitForReadySignal(name, options.readyWhen, options.timeoutMs ?? STARTUP_TIMEOUT_MS)
    : null;

  const child = spawn(shellCommand.file, shellCommand.args, {
    cwd,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });

  child.processName = name;
  childProcesses.push(child);

  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      readiness?.handleChunk(chunk);
    });
  }

  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      readiness?.handleChunk(chunk);
    });
  }

  child.on("exit", (code, signal) => {
    if (isShuttingDown) {
      return;
    }

    const reason =
      signal != null ? `${name} exited via signal ${signal}` : `${name} exited with code ${code ?? 0}`;

    readiness?.fail(new Error(reason));
    console.error(reason);
    shutdown(code ?? 1);
  });

  child.on("error", (error) => {
    if (isShuttingDown) {
      return;
    }

    readiness?.fail(error);
    console.error(`Failed to start ${name}:`, error);
    shutdown(1);
  });

  return {
    child,
    ready: readiness?.ready ?? Promise.resolve(),
  };
}

function terminateChild(child) {
  return terminateOwnedChild(child);
}

function shutdown(exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  void Promise.all(childProcesses.map(terminateChild)).finally(() => {
    process.exit(exitCode);
  });
}

async function findAvailableTcpPort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a development renderer port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function main() {
  const runtimeConfig = loadRuntimeConfig();
  const backendHost = runtimeConfig.backend.host;
  const backendPort = runtimeConfig.backend.port;
  let desktopPort = runtimeConfig.dev.desktopPort;

  const workspaceRoot = path.resolve(__dirname, "..");
  const serverDir = path.join(workspaceRoot, "server");
  const desktopDir = path.join(workspaceRoot, "desktop");
  const { writeAppMetaJsons } = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "app-meta-generator.js")).href
  );

  writeAppMetaJsons(workspaceRoot, [
    path.join(serverDir, "app-meta.json"),
    path.join(workspaceRoot, ".artifacts", "server-bundle", "app-meta.json"),
  ]);

  // Fail before starting Vite when another Backend owns the port. Reusing it
  // would produce a Cloud-hostless session that looks superficially healthy.
  await assertBackendPortAvailable(backendHost, backendPort);
  console.log(
    "Dev Backend ownership: Electron Main will start the source Backend with its private Cloud IPC channel.",
  );

  if (await isTcpPortOpen("127.0.0.1", desktopPort)) {
    const configuredPort = desktopPort;
    desktopPort = await findAvailableTcpPort("127.0.0.1");
    console.log(
      `Renderer port ${configuredPort} is occupied; using free development port ${desktopPort} without reusing the existing service.`,
    );
  }

  console.log("Starting desktop dev server...");
  const desktopReady = spawnManagedProcess("desktop", desktopDir, "pnpm dev", {
    // Keep Vite and Electron on the exact same development port and host.
    env: { UI_CHAT_DESKTOP_PORT: String(desktopPort) },
    readyWhen: (_text, combined) =>
      combined.includes(`http://localhost:${desktopPort}/`) ||
      combined.includes(`http://127.0.0.1:${desktopPort}/`),
  }).ready;

  console.log("Waiting for desktop dev server readiness signal...");
  await desktopReady;

  console.log(
    "Desktop renderer is ready. Launching Electron; Main will start the owned Backend...",
  );
  const electronEnv = {
    ...process.env,
    UI_CHAT_DESKTOP_PORT: String(desktopPort),
  };
  const electronChild = spawn(electronBinary, ["."], {
    cwd: __dirname,
    env: buildElectronEnv(electronEnv, process.execPath),
    stdio: "inherit",
    windowsHide: false,
  });

  childProcesses.push(electronChild);

  electronChild.on("exit", (code) => {
    shutdown(code ?? 0);
  });

  electronChild.on("error", (error) => {
    console.error("Failed to launch Electron:", error);
    shutdown(1);
  });
}

if (require.main?.filename === __filename) {
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    shutdown(1);
  });
}

module.exports = {
  buildBackendEnv,
  buildElectronEnv,
  findAvailableTcpPort,
  resolveShellCommand,
  resolveBackendWorkspaceRoot,
  waitForReadySignal,
};
