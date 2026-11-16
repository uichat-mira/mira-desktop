export type DesktopHostKind = "browser" | "electron";

export interface DesktopRuntimeInfo {
  hostKind: DesktopHostKind;
  platform: string;
  isPackaged: boolean;
  backendUrl: string;
}

const browserRuntime: DesktopRuntimeInfo = {
  hostKind: "browser",
  platform: "browser",
  isPackaged: false,
  backendUrl: "",
};

const isDesktopRuntimeInfo = (
  value: unknown,
): value is DesktopRuntimeInfo => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const runtime = value as Partial<DesktopRuntimeInfo>;

  return (
    (runtime.hostKind === "browser" ||
      runtime.hostKind === "electron") &&
    typeof runtime.platform === "string" &&
    typeof runtime.isPackaged === "boolean" &&
    typeof runtime.backendUrl === "string"
  );
};

const getLegacyElectronRuntime = (): DesktopRuntimeInfo | null => {
  const desktopApi = globalThis.window?.desktopApi;

  if (!desktopApi) {
    return null;
  }

  return {
    hostKind: "electron",
    platform: desktopApi.platform,
    isPackaged: desktopApi.isPackaged,
    backendUrl: desktopApi.backendUrl,
  };
};

export function getDesktopRuntime(): DesktopRuntimeInfo {
  const injectedRuntime = globalThis.window?.desktopRuntime;

  if (isDesktopRuntimeInfo(injectedRuntime)) {
    return injectedRuntime;
  }

  return getLegacyElectronRuntime() ?? browserRuntime;
}

export function isDesktopShell(runtime = getDesktopRuntime()) {
  return runtime.hostKind !== "browser";
}

export function getApiBaseUrl() {
  const viteApiUrl = import.meta.env.VITE_API_URL;
  if (viteApiUrl) {
    return viteApiUrl;
  }

  const runtime = getDesktopRuntime();

  return isDesktopShell(runtime) ? runtime.backendUrl : "/api";
}

export function getChatApiUrl() {
  const runtime = getDesktopRuntime();

  return isDesktopShell(runtime)
    ? `${runtime.backendUrl}/proxy/chat/default`
    : "/api/proxy/chat/default";
}

export function getRuntimeDisplayLabel(runtime = getDesktopRuntime()) {
  if (runtime.hostKind === "electron") {
    return `Electron · ${runtime.platform}`;
  }

  return "Browser Preview";
}

export function getRuntimeDescription(runtime = getDesktopRuntime()) {
  if (runtime.hostKind === "electron") {
    return "Electron 运行时通过后端 API 检查状态。";
  }

  return "当前为浏览器预览模式，状态检查通过 /api 代理访问后端。";
}

export async function openExternalUrl(url: string) {
  const trimmedUrl = url.trim();
  const runtime = getDesktopRuntime();

  if (/[\r\n]/.test(trimmedUrl)) {
    throw new Error("仅支持打开 http(s) 或 mailto 外部链接");
  }

  let protocol = "";
  try {
    protocol = new URL(trimmedUrl).protocol.toLowerCase();
  } catch {
    throw new Error("仅支持打开 http(s) 或 mailto 外部链接");
  }

  if (protocol !== "http:" && protocol !== "https:" && protocol !== "mailto:") {
    throw new Error("仅支持打开 http(s) 或 mailto 外部链接");
  }

  if (runtime.hostKind === "electron" && globalThis.window?.electronAPI?.invoke) {
    await globalThis.window.electronAPI.invoke("desktop:open-external", trimmedUrl);
    return;
  }

  if (runtime.hostKind === "electron") {
    throw new Error("Electron IPC 不可用，无法打开外部链接");
  }

  globalThis.window?.open(trimmedUrl, "_blank", "noopener,noreferrer");
}

export type NativeMessagingHostStatusKind =
  | "installed"
  | "not_installed"
  | "repair_needed"
  | "unsupported";

export interface NativeMessagingHostStatus {
  status: NativeMessagingHostStatusKind;
  installed: boolean;
  reason?: string;
}

export async function downloadBrowserExtension(): Promise<string> {
  const runtime = getDesktopRuntime();

  if (runtime.hostKind === "electron" && globalThis.window?.electronAPI?.invoke) {
    return String(
      await globalThis.window.electronAPI.invoke("desktop:download-browser-extension"),
    );
  }

  if (runtime.hostKind === "electron") {
    throw new Error("Electron IPC 不可用，无法下载浏览器扩展");
  }

  throw new Error("浏览器扩展下载仅支持 Electron 桌面端");
}

export async function installNativeMessagingHost(): Promise<unknown> {
  const runtime = getDesktopRuntime();
  if (runtime.hostKind === "electron" && globalThis.window?.electronAPI?.invoke) {
    return globalThis.window.electronAPI.invoke("desktop:install-native-host");
  }
  if (runtime.hostKind === "electron") {
    throw new Error("Electron IPC 不可用，无法安装 Native Messaging");
  }

  throw new Error("Native Messaging 安装仅支持 Electron 桌面端");
}

export async function getNativeMessagingHostStatus(): Promise<NativeMessagingHostStatus> {
  const runtime = getDesktopRuntime();
  if (runtime.hostKind === "electron" && globalThis.window?.electronAPI?.invoke) {
    return globalThis.window.electronAPI.invoke("desktop:get-native-host-status") as Promise<NativeMessagingHostStatus>;
  }
  if (runtime.hostKind === "electron") {
    throw new Error("Electron IPC 不可用，无法查询 Native Messaging 状态");
  }

  return {
    status: "unsupported",
    installed: false,
    reason: "Native Messaging 仅在桌面版 Windows 上可用",
  };
}

export async function uninstallNativeMessagingHost(): Promise<unknown> {
  const runtime = getDesktopRuntime();
  if (runtime.hostKind === "electron" && globalThis.window?.electronAPI?.invoke) {
    return globalThis.window.electronAPI.invoke("desktop:uninstall-native-host");
  }
  if (runtime.hostKind === "electron") {
    throw new Error("Electron IPC 不可用，无法注销 Native Messaging");
  }

  throw new Error("Native Messaging 注销仅支持 Electron 桌面端");
}
