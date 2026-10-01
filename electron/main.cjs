const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execFileSync } = require("child_process");

let mainWindow;
let backendProcess;
const BACKEND_START_TIMEOUT_MS = 15000;
const BACKEND_START_POLL_INTERVAL_MS = 300;

const isDev = !app.isPackaged;

function configureDevChromiumPaths() {
  if (!isDev) return;

  // 每个开发实例使用独立的 Chromium 临时目录，避免旧 Electron 进程锁住 cache/session 数据导致新窗口白屏。
  const devSessionRoot = path.join(app.getPath("temp"), `uichat-mira-electron-${process.pid}`);
  app.setPath("cache", path.join(devSessionRoot, "cache"));
  app.setPath("sessionData", path.join(devSessionRoot, "session"));
}

configureDevChromiumPaths();
const runtimeConfig = loadRuntimeConfig();

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

function getBackendUrl() {
  return `http://${runtimeConfig.backend.host}:${runtimeConfig.backend.port}`;
}

function ensureSecretFile(secretPath, secretName) {
  if (fs.existsSync(secretPath)) {
    const secret = fs.readFileSync(secretPath, "utf8").trim();
    if (secret) {
      return secret;
    }
  }

  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  const secret = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(secretPath, secret);
  console.log(`Created ${secretName} at: ${secretPath}`);
  return secret;
}

function ensureDirectory(directoryPath, label) {
  try {
    fs.mkdirSync(directoryPath, { recursive: true });
  } catch (error) {
    throw new Error(
      `Failed to create ${label} at ${directoryPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!fs.statSync(directoryPath).isDirectory()) {
    throw new Error(`${label} must be a directory: ${directoryPath}`);
  }

  return directoryPath;
}

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function isBackendHealthy() {
  try {
    const response = await fetch(`${getBackendUrl()}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackendReady(timeoutMs = BACKEND_START_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isBackendHealthy()) {
      return true;
    }

    if (backendProcess?.exitCode != null) {
      return false;
    }

    await sleep(BACKEND_START_POLL_INTERVAL_MS);
  }

  return false;
}

function resolveRendererEntry() {
  const candidates = [
    path.join(app.getAppPath(), "desktop", "dist", "index.html"),
    path.join(app.getAppPath(), "dist", "index.html"),
    path.join(__dirname, "desktop", "dist", "index.html"),
    path.join(__dirname, "dist", "index.html"),
    path.join(process.resourcesPath, "app.asar", "desktop", "dist", "index.html"),
    path.join(process.resourcesPath, "app.asar", "dist", "index.html"),
  ];

  for (const candidate of candidates) {
    console.log("Checking renderer entry:", candidate, fs.existsSync(candidate));
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to locate renderer entry. Checked: ${candidates.join(", ")}`,
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process exited:", details);
  });

  mainWindow.webContents.on("unresponsive", () => {
    console.error("Renderer became unresponsive");
  });

  if (isDev) {
    void mainWindow
      .loadURL(`http://localhost:${runtimeConfig.dev.desktopPort}`)
      .then(() => {
        mainWindow?.webContents.openDevTools({ mode: "detach" });
      })
      .catch((error) => {
        console.error("Failed to load dev renderer:", error);
      });
    return;
  }

  const indexPath = resolveRendererEntry();
  void mainWindow.loadFile(indexPath).catch((error) => {
    console.error("Failed to load packaged renderer:", error);
  });
}

ipcMain.handle("desktop:open-external", async (_event, url) => {
  if (typeof url !== "string") {
    throw new Error("Invalid external URL");
  }

  const trimmedUrl = url.trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) {
    throw new Error("Only http(s) external URLs are allowed");
  }

  await shell.openExternal(trimmedUrl);
  return true;
});

function getBrowserExtensionSourcePath() {
  return isDev
    ? path.join(__dirname, "..", "mira-clipper-ext", "dist", "dev", "Chujie.crx")
    : path.join(process.resourcesPath, "browser-extension", "Chujie.crx");
}

function getNativeHostSourcePath() {
  return isDev
    ? path.join(__dirname, "..", "mira-clipper-ext", "dist", "native", "MiraWebBridgeHost.exe")
    : path.join(process.resourcesPath, "browser-extension", "native", "MiraWebBridgeHost.exe");
}

const NATIVE_MESSAGING_HOST_NAME = "com.tomz.uichat.webbridge";
const NATIVE_MESSAGING_REGISTRY_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_MESSAGING_HOST_NAME}`;
const NATIVE_MESSAGING_ALLOWED_ORIGINS = [
  // Development unpacked extension signed by mira-clipper-dev.pem.
  "chrome-extension://omdcdmcedejkenmjmkepgpinnehhmfkj/",
  // Production CRX signed by mira-clipper-prod.pem.
  "chrome-extension://nmoaglalgogogfaednbhpfadmdlpelag/",
];

function getNativeHostManifestPath() {
  return path.join(app.getPath("userData"), "native-host", `${NATIVE_MESSAGING_HOST_NAME}.json`);
}

function isSameWindowsPath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function getRegisteredNativeHostManifestPath() {
  try {
    const output = execFileSync("reg.exe", ["QUERY", NATIVE_MESSAGING_REGISTRY_KEY, "/ve"], {
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const registryLine = output.split(/\r?\n/).find((line) => line.includes("REG_SZ"));
    if (!registryLine) return "";
    return registryLine.slice(registryLine.indexOf("REG_SZ") + "REG_SZ".length).trim();
  } catch {
    return "";
  }
}

function getNativeMessagingHostStatus() {
  if (process.platform !== "win32") {
    return { status: "unsupported", installed: false, reason: "Native Messaging 当前仅支持 Windows" };
  }

  const manifestPath = getNativeHostManifestPath();
  const registeredManifestPath = getRegisteredNativeHostManifestPath();
  const manifestExists = fs.existsSync(manifestPath);

  if (!registeredManifestPath && !manifestExists) {
    return { status: "not_installed", installed: false };
  }
  if (!registeredManifestPath) {
    return { status: "repair_needed", installed: false, reason: "Chrome Native 注册项缺失" };
  }
  if (!isSameWindowsPath(registeredManifestPath, manifestPath)) {
    return { status: "repair_needed", installed: false, reason: "Chrome 注册项未指向当前 Mira" };
  }
  if (!manifestExists) {
    return { status: "repair_needed", installed: false, reason: "Native manifest 文件缺失" };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return { status: "repair_needed", installed: false, reason: "Native manifest 无法读取" };
  }

  const hostPath = typeof manifest.path === "string" ? manifest.path : "";
  const hostScriptPath = hostPath ? path.join(path.dirname(hostPath), "host.mjs") : "";
  const allowedOrigins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [];
  if (manifest.name !== NATIVE_MESSAGING_HOST_NAME || manifest.type !== "stdio" || NATIVE_MESSAGING_ALLOWED_ORIGINS.some((origin) => !allowedOrigins.includes(origin))) {
    return { status: "repair_needed", installed: false, reason: "Native manifest 配置不匹配" };
  }
  if (!hostPath || !fs.existsSync(hostPath) || !fs.existsSync(hostScriptPath)) {
    return { status: "repair_needed", installed: false, reason: "Native Host 文件缺失" };
  }
  if (!isSameWindowsPath(hostPath, getNativeHostSourcePath())) {
    return { status: "repair_needed", installed: false, reason: "Native Host 需要更新" };
  }

  return { status: "installed", installed: true };
}

function installNativeMessagingHost() {
  if (process.platform !== "win32") throw new Error("Native Messaging 当前仅支持 Windows");
  const sourcePath = getNativeHostSourcePath();
  if (!fs.existsSync(sourcePath)) throw new Error(`Native Messaging Host 未打包：${sourcePath}`);
  const hostPath = sourcePath;
  const manifestPath = getNativeHostManifestPath();
  const hostScriptPath = path.join(path.dirname(sourcePath), "host.mjs");
  if (!fs.existsSync(hostScriptPath)) throw new Error(`Native Messaging Host script 未打包：${hostScriptPath}`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({
    name: NATIVE_MESSAGING_HOST_NAME,
    description: "触界 Native Messaging Host",
    path: hostPath,
    type: "stdio",
    allowed_origins: NATIVE_MESSAGING_ALLOWED_ORIGINS,
  }, null, 2));
  execFileSync("reg.exe", ["ADD", NATIVE_MESSAGING_REGISTRY_KEY, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], { windowsHide: true });
  return { installed: true, hostPath, manifestPath, version: "0.7.1" };
}

ipcMain.handle("desktop:install-native-host", () => installNativeMessagingHost());
ipcMain.handle("desktop:get-native-host-status", () => getNativeMessagingHostStatus());

function uninstallNativeMessagingHost() {
  if (process.platform !== "win32") throw new Error("Native Messaging 当前仅支持 Windows");
  const manifestPath = getNativeHostManifestPath();
  try {
    execFileSync("reg.exe", ["DELETE", NATIVE_MESSAGING_REGISTRY_KEY, "/f"], { windowsHide: true, stdio: "ignore" });
  } catch {
    // 注册项不存在时，解除注册仍然视为成功。
  }
  if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath, { force: true });
  return { uninstalled: true, manifestPath };
}

ipcMain.handle("desktop:uninstall-native-host", () => uninstallNativeMessagingHost());

function getAvailableDownloadPath() {
  const downloadsDir = app.getPath("downloads");
  const baseName = "Chujie";
  let candidate = path.join(downloadsDir, `${baseName}.crx`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(downloadsDir, `${baseName} (${suffix}).crx`);
    suffix += 1;
  }
  return candidate;
}

ipcMain.handle("desktop:download-browser-extension", async () => {
  const sourcePath = getBrowserExtensionSourcePath();
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Browser extension package not found: ${sourcePath}`);
  }

  const destinationPath = getAvailableDownloadPath();
  fs.copyFileSync(sourcePath, destinationPath);
  return destinationPath;
});

async function startBackend() {
  if (isDev) {
    console.log("Dev mode: backend server already started via concurrently");
    return true;
  }

  const backendPath = path.join(process.resourcesPath, "server", "server.cjs");
  const cwd = path.join(process.resourcesPath, "server");
  const bundledNodeBinary = process.platform === "win32" ? "node.exe" : "node";
  const bundledNodePath = path.join(
    process.resourcesPath,
    "node-runtime",
    bundledNodeBinary,
  );
  const localModelResourceRoot = path.join(process.resourcesPath, "model-packs");
  const localOnnxWasmRoot = path.join(
    process.resourcesPath,
    "model-runtime",
    "onnxruntime-web",
  );
  const backendRuntime = fs.existsSync(bundledNodePath)
    ? bundledNodePath
    : process.execPath;
  const usesBundledNode = backendRuntime === bundledNodePath;

  console.log("Starting backend from:", backendPath);
  console.log("Working directory:", cwd);
  console.log("Backend runtime:", backendRuntime);

  const userDataDir = app.getPath("userData");
  const dataDir = path.join(userDataDir, "data");
  const logDir = path.join(userDataDir, "logs");
  const secretsDir = path.join(userDataDir, "secrets");
  const defaultWorkspaceRoot = path.join(
    app.getPath("documents"),
    "UIChat Mira",
    "Default Workspace",
  );
  ensureDirectory(dataDir, "data directory");
  ensureDirectory(logDir, "log directory");
  ensureDirectory(defaultWorkspaceRoot, "default workspace");

  const jwtSecret = ensureSecretFile(
    path.join(secretsDir, "jwt-secret.txt"),
    "JWT secret",
  );
  const settingsSecret = ensureSecretFile(
    path.join(secretsDir, "settings-secret.txt"),
    "settings secret",
  );

  backendProcess = spawn(backendRuntime, [backendPath], {
    cwd,
    env: {
      ...process.env,
      ...(usesBundledNode ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
      NODE_ENV: "production",
      HOST: runtimeConfig.backend.host,
      PORT: String(runtimeConfig.backend.port),
      JWT_SECRET: jwtSecret,
      SETTINGS_SECRET: settingsSecret,
      UI_CHAT_ALLOW_DEFAULT_BOOTSTRAP: "1",
      UI_CHAT_BACKEND_URL: getBackendUrl(),
      UI_CHAT_DESKTOP_RESOURCES_ROOT: process.resourcesPath,
      UI_CHAT_DATABASE_DIR: dataDir,
      UI_CHAT_LOG_DIR: logDir,
      UI_CHAT_WORKSPACE_ROOT: defaultWorkspaceRoot,
      LOCAL_MODEL_RESOURCE_ROOT: localModelResourceRoot,
      LOCAL_MODEL_USER_DATA_DIR: userDataDir,
      LOCAL_ONNX_WASM_ROOT: localOnnxWasmRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (backendProcess.stdout) {
    backendProcess.stdout.on("data", (data) => {
      console.log(`Backend: ${data}`);
    });
  }

  if (backendProcess.stderr) {
    backendProcess.stderr.on("data", (data) => {
      console.error(`Backend error: ${data}`);
    });
  }

  backendProcess.on("close", (code) => {
    console.log(`Backend process exited with code ${code}`);
  });

  backendProcess.on("error", (error) => {
    console.error("Failed to start backend process:", error);
  });

  const backendReady = await waitForBackendReady();
  if (!backendReady) {
    console.error(
      `Backend did not become healthy within ${BACKEND_START_TIMEOUT_MS}ms: ${getBackendUrl()}/health`,
    );
  }

  return backendReady;
}

app.whenReady().then(async () => {
  console.log("App ready, isDev:", isDev);
  console.log("__dirname:", __dirname);
  console.log("app.getAppPath():", app.getAppPath());
  console.log("process.resourcesPath:", process.resourcesPath);

  if (!process.argv.includes("--no-backend")) {
    await startBackend();
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});
