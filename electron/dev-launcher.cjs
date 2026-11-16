const net = require("net");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const electronBinary = require("electron");
const { pathToFileURL } = require("url");

const STARTUP_TIMEOUT_MS = 60000;
// Capture the explicit CLI opt-in before runtime.config.cjs loads local .env.
// A stale .env value must never turn an ordinary Dev launch into Cloud Pilot.
const cloudPilotRequested = process.env.UI_CHAT_CLOUD_PILOT === "1";
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
    UI_CHAT_ALLOW_BACKEND_REUSE: "1",
    UI_CHAT_WORKSPACE_ROOT: resolveBackendWorkspaceRoot(
      baseEnv,
      defaultWorkspaceRoot,
    ),
  };
}

function isCloudPilotMode(baseEnv = process.env) {
  return baseEnv.UI_CHAT_CLOUD_PILOT === "1";
}

function buildElectronEnv(
  baseEnv = process.env,
  nodeBinary = process.execPath,
  defaultWorkspaceRoot,
) {
  if (!isCloudPilotMode(baseEnv)) {
    return { ...baseEnv };
  }
  if (typeof nodeBinary !== "string" || !path.isAbsolute(nodeBinary)) {
    throw new TypeError("Cloud Pilot requires an absolute Node executable path");
  }

  return {
    ...buildBackendEnv(baseEnv, defaultWorkspaceRoot),
    UI_CHAT_CLOUD_PILOT: "1",
    UI_CHAT_CLOUD_PILOT_NODE_BINARY: nodeBinary,
    // The Electron-owned Backend must fail on EADDRINUSE, never reuse a
    // separately started process that cannot receive its private IPC channel.
    UI_CHAT_ALLOW_BACKEND_REUSE: "0",
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

function shutdown(exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  for (const child of childProcesses) {
    if (!child.killed) {
      try {
        if (process.platform === "win32") {
          spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `taskkill /PID ${child.pid} /T /F`], {
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch {}
    }
  }

  setTimeout(() => process.exit(exitCode), 300);
}

async function isTcpPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const cleanup = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1000);
    socket.once("connect", () => cleanup(true));
    socket.once("timeout", () => cleanup(false));
    socket.once("error", () => cleanup(false));
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
        reject(new Error("Unable to allocate a Cloud Pilot renderer port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function isBackendHealthy(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const runtimeConfig = loadRuntimeConfig();
  const backendHost = runtimeConfig.backend.host;
  const backendPort = runtimeConfig.backend.port;
  let desktopPort = runtimeConfig.dev.desktopPort;
  const backendHealthUrl = `http://${backendHost}:${backendPort}/health`;

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

  const cloudPilot = cloudPilotRequested;
  let desktopAlreadyRunning = false;
  if (cloudPilot) {
    if (await isTcpPortOpen("127.0.0.1", desktopPort)) {
      const configuredPort = desktopPort;
      desktopPort = await findAvailableTcpPort("127.0.0.1");
      console.log(
        `Cloud Pilot: renderer port ${configuredPort} is occupied; using a free development port ${desktopPort} without reusing the existing service.`,
      );
    }
  } else {
    desktopAlreadyRunning = await isTcpPortOpen("localhost", desktopPort);
  }
  const backendAlreadyHealthy = cloudPilot
    ? false
    : await isBackendHealthy(backendHealthUrl);

  let backendReady = Promise.resolve();
  let desktopReady = Promise.resolve();

  if (cloudPilot) {
    if (await isTcpPortOpen(backendHost, backendPort)) {
      throw new Error(
        `Cloud Pilot requires exclusive Backend ownership, but ${backendHost}:${backendPort} is already listening. Stop the existing Backend and retry.`,
      );
    }
    console.log(
      "Cloud Pilot: skipping the independent Backend dev server; Electron Main will own the Backend and its private IPC channel.",
    );
  } else if (backendAlreadyHealthy) {
    console.log(`Reusing existing backend at ${backendHealthUrl}`);
  } else {
    console.log("Starting backend dev server...");
    backendReady = spawnManagedProcess("server", serverDir, "pnpm dev", {
      env: buildBackendEnv(process.env),
      readyWhen: (_text, combined) =>
        combined.includes(`Server running on http://${backendHost}:${backendPort}`),
    }).ready;
  }

  if (desktopAlreadyRunning) {
    console.log(`Reusing existing desktop dev server on tcp://localhost:${desktopPort}`);
  } else {
    console.log("Starting desktop dev server...");
    desktopReady = spawnManagedProcess("desktop", desktopDir, "pnpm dev", {
      env: cloudPilot ? { UI_CHAT_DESKTOP_PORT: String(desktopPort) } : undefined,
      readyWhen: (_text, combined) =>
        combined.includes(`http://localhost:${desktopPort}/`) ||
        combined.includes(`http://127.0.0.1:${desktopPort}/`),
    }).ready;
  }

  if (!desktopAlreadyRunning) {
    console.log("Waiting for desktop dev server readiness signal...");
  }

  if (!cloudPilot && !backendAlreadyHealthy) {
    console.log("Waiting for backend readiness signal...");
  }

  await Promise.all([desktopReady, backendReady]);

  console.log(
    cloudPilot
      ? "Desktop renderer is ready. Launching Electron; Main will start the owned Backend..."
      : "Desktop and backend are ready. Launching Electron...",
  );
  const electronEnv = {
    ...process.env,
    // Do not inherit a stale Cloud Pilot flag from the local .env file.
    UI_CHAT_CLOUD_PILOT: cloudPilot ? "1" : "0",
    ...(cloudPilot ? { UI_CHAT_DESKTOP_PORT: String(desktopPort) } : {}),
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

if (require.main === module) {
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
  isCloudPilotMode,
  findAvailableTcpPort,
  resolveShellCommand,
  resolveBackendWorkspaceRoot,
};
