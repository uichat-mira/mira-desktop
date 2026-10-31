// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopRuntime,
  isDesktopShell,
  getApiBaseUrl,
  getChatApiUrl,
  getRuntimeDisplayLabel,
  getRuntimeDescription,
  openExternalUrl,
  getNativeMessagingHostStatus,
  downloadBrowserExtension,
  installNativeMessagingHost,
  uninstallNativeMessagingHost,
  type DesktopRuntimeInfo,
} from "../desktopRuntime";

function setWindow(value: typeof globalThis.window) {
  Object.defineProperty(globalThis, "window", {
    value,
    writable: true,
    configurable: true,
  });
}

describe("desktopRuntime", () => {
  function resetWindow() {
    setWindow(window);
    delete (window as unknown as Record<string, unknown>).desktopRuntime;
    delete (window as unknown as Record<string, unknown>).desktopApi;
    delete (window as unknown as Record<string, unknown>).electronAPI;
  }

  beforeEach(() => {
    vi.unstubAllEnvs();
    resetWindow();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetWindow();
  });

  it("browser 环境返回 browser runtime", () => {
    const runtime = getDesktopRuntime();

    expect(runtime).toEqual({
      hostKind: "browser",
      platform: "browser",
      isPackaged: false,
      backendUrl: "",
    });
  });

  it("已退役的 Tauri runtime 注入被拒绝，不会伪装成桌面环境", () => {
    setWindow({
      ...window,
      desktopRuntime: {
        hostKind: "tauri",
        platform: "win32",
        isPackaged: true,
        backendUrl: "http://localhost:3000",
      },
    } as unknown as typeof globalThis.window);

    expect(getDesktopRuntime().hostKind).toBe("browser");
    expect(getApiBaseUrl()).toBe("/api");
  });

  it("window.desktopRuntime 注入时优先使用", () => {
    const injected: DesktopRuntimeInfo = {
      hostKind: "electron",
      platform: "win32",
      isPackaged: true,
      backendUrl: "http://localhost:3000",
    };
    setWindow({
      ...window,
      desktopRuntime: injected,
    } as unknown as typeof globalThis.window);

    const runtime = getDesktopRuntime();

    expect(runtime).toEqual(injected);
  });

  it("兼容旧版 electron desktopApi", () => {
    setWindow({
      ...window,
      desktopApi: {
        platform: "darwin",
        isPackaged: false,
        backendUrl: "http://localhost:4000",
      },
    } as unknown as typeof globalThis.window);

    const runtime = getDesktopRuntime();

    expect(runtime).toEqual({
      hostKind: "electron",
      platform: "darwin",
      isPackaged: false,
      backendUrl: "http://localhost:4000",
    });
  });

  it("isDesktopShell 正确判断", () => {
    expect(
      isDesktopShell({
        hostKind: "browser",
        platform: "browser",
        isPackaged: false,
        backendUrl: "",
      }),
    ).toBe(false);
    expect(
      isDesktopShell({
        hostKind: "electron",
        platform: "win32",
        isPackaged: true,
        backendUrl: "",
      }),
    ).toBe(true);
  });

  it("getApiBaseUrl 优先使用 VITE_API_URL", () => {
    vi.stubEnv("VITE_API_URL", "http://api.example.com");

    expect(getApiBaseUrl()).toBe("http://api.example.com");
  });

  it("getApiBaseUrl browser 环境返回 /api", () => {
    expect(getApiBaseUrl()).toBe("/api");
  });

  it("getApiBaseUrl desktop 环境返回 backendUrl", () => {
    setWindow({
      ...window,
      desktopRuntime: {
        hostKind: "electron",
        platform: "win32",
        isPackaged: true,
        backendUrl: "http://localhost:3000",
      },
    } as unknown as typeof globalThis.window);

    expect(getApiBaseUrl()).toBe("http://localhost:3000");
  });

  it("getChatApiUrl browser 环境返回 /api/proxy/chat/default", () => {
    expect(getChatApiUrl()).toBe("/api/proxy/chat/default");
  });

  it("getChatApiUrl desktop 环境返回 backendUrl/proxy/chat/default", () => {
    setWindow({
      ...window,
      desktopRuntime: {
        hostKind: "electron",
        platform: "win32",
        isPackaged: true,
        backendUrl: "http://localhost:3000",
      },
    } as unknown as typeof globalThis.window);

    expect(getChatApiUrl()).toBe("http://localhost:3000/proxy/chat/default");
  });

  it("getRuntimeDisplayLabel 返回正确标签", () => {
    expect(
      getRuntimeDisplayLabel({
        hostKind: "browser",
        platform: "browser",
        isPackaged: false,
        backendUrl: "",
      }),
    ).toBe("Browser Preview");

    expect(
      getRuntimeDisplayLabel({
        hostKind: "electron",
        platform: "win32",
        isPackaged: true,
        backendUrl: "",
      }),
    ).toBe("Electron · win32");

  });

  it("getRuntimeDescription 返回正确描述", () => {
    const browser = getRuntimeDescription({
      hostKind: "browser",
      platform: "browser",
      isPackaged: false,
      backendUrl: "",
    });
    expect(browser).toContain("浏览器预览模式");

    const electron = getRuntimeDescription({
      hostKind: "electron",
      platform: "win32",
      isPackaged: true,
      backendUrl: "",
    });
    expect(electron).toContain("Electron");
  });

  it("openExternalUrl browser 环境使用 window.open", async () => {
    const open = vi.fn();
    setWindow({ ...window, open } as unknown as typeof globalThis.window);

    await openExternalUrl("https://example.com");

    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("openExternalUrl electron 环境使用 invoke", async () => {
    const invoke = vi.fn();
    setWindow({
      ...window,
      desktopRuntime: {
        hostKind: "electron",
        platform: "win32",
        isPackaged: true,
        backendUrl: "",
      },
      electronAPI: { invoke },
    } as unknown as typeof globalThis.window);

    await openExternalUrl("https://example.com");

    expect(invoke).toHaveBeenCalledWith(
      "desktop:open-external",
      "https://example.com",
    );
  });

  it("Electron 桌面环境缺少 IPC 时不静默退回浏览器打开链接", async () => {
    setWindow({
      ...window,
      desktopRuntime: {
        hostKind: "electron",
        platform: "win32",
        isPackaged: true,
        backendUrl: "http://localhost:3000",
      },
      open: vi.fn(),
    } as unknown as typeof globalThis.window);

    await expect(openExternalUrl("https://example.com")).rejects.toThrow("Electron IPC 不可用");
    expect(window.open).not.toHaveBeenCalled();
  });

  it("Electron 缺少 IPC 时扩展与 Native Messaging 操作明确失败", async () => {
    const open = vi.fn();
    setWindow({
      ...window,
      desktopRuntime: {
        hostKind: "electron",
        platform: "win32",
        isPackaged: true,
        backendUrl: "http://localhost:3000",
      },
      open,
    } as unknown as typeof globalThis.window);

    await expect(downloadBrowserExtension()).rejects.toThrow("Electron IPC 不可用");
    await expect(installNativeMessagingHost()).rejects.toThrow("Electron IPC 不可用");
    await expect(getNativeMessagingHostStatus()).rejects.toThrow("Electron IPC 不可用");
    await expect(uninstallNativeMessagingHost()).rejects.toThrow("Electron IPC 不可用");
    expect(open).not.toHaveBeenCalled();
  });

  it("getNativeMessagingHostStatus electron 环境使用原生状态查询", async () => {
    const nativeStatus = { status: "installed", installed: true };
    const invoke = vi.fn().mockResolvedValue(nativeStatus);
    setWindow({
      ...window,
      desktopRuntime: {
        hostKind: "electron",
        platform: "win32",
        isPackaged: true,
        backendUrl: "",
      },
      electronAPI: { invoke },
    } as unknown as typeof globalThis.window);

    await expect(getNativeMessagingHostStatus()).resolves.toEqual(nativeStatus);
    expect(invoke).toHaveBeenCalledWith("desktop:get-native-host-status");
  });

  it("getNativeMessagingHostStatus 浏览器环境返回不支持", async () => {
    await expect(getNativeMessagingHostStatus()).resolves.toMatchObject({
      status: "unsupported",
      installed: false,
    });
  });

  it("openExternalUrl electron 环境将 mailto 交给系统邮件客户端", async () => {
    const invoke = vi.fn();
    setWindow({
      ...window,
      desktopRuntime: {
        hostKind: "electron",
        platform: "win32",
        isPackaged: true,
        backendUrl: "",
      },
      electronAPI: { invoke },
    } as unknown as typeof globalThis.window);

    await openExternalUrl("mailto:dangjingtao@gmail.com?subject=UIChat%20Mira");

    expect(invoke).toHaveBeenCalledWith(
      "desktop:open-external",
      "mailto:dangjingtao@gmail.com?subject=UIChat%20Mira",
    );
  });

  it("openExternalUrl 拒绝非 http(s) 或 mailto 链接", async () => {
    await expect(openExternalUrl("ftp://example.com")).rejects.toThrow(
      "仅支持打开 http(s) 或 mailto 外部链接",
    );
  });
});
