const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");

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

const runtimeConfig = loadRuntimeConfig();
const backendUrl =
  process.env.UI_CHAT_BACKEND_URL ||
  `http://${runtimeConfig.backend.host}:${runtimeConfig.backend.port}`;
const desktopRuntime = {
  hostKind: "electron",
  platform: process.platform,
  isPackaged: process.env.NODE_ENV !== "development",
  backendUrl,
};

contextBridge.exposeInMainWorld("cloudAccount", {
  status: () => ipcRenderer.invoke("cloud-account:status"),
  signIn: (scopes) => ipcRenderer.invoke("cloud-account:login", scopes),
  cancelSignIn: () => ipcRenderer.invoke("cloud-account:cancel-login"),
  retryHostSetup: () => ipcRenderer.invoke("cloud-account:retry-host"),
  resetLocalCredentials: () => ipcRenderer.invoke("cloud-account:reset-credentials"),
  signOut: () => ipcRenderer.invoke("cloud-account:logout"),
  subscribe: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("cloud-account:changed", listener);
    return () => ipcRenderer.removeListener("cloud-account:changed", listener);
  },
});

contextBridge.exposeInMainWorld("desktopRuntime", desktopRuntime);

contextBridge.exposeInMainWorld("desktopApi", {
  platform: desktopRuntime.platform,
  isPackaged: desktopRuntime.isPackaged,
  backendUrl,
});

contextBridge.exposeInMainWorld("electronAPI", {
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, func) =>
    ipcRenderer.on(channel, (event, ...args) => func(...args)),
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
});
