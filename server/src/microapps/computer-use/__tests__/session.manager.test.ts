import { describe, expect, it, vi } from "vitest";
import { BrowserSessionManager } from "../session/manager.js";

const readyRuntime = { resolveRuntime: () => ({ status: "ready" as const, strategy: "managed" as const, runtime: { source: "managed" as const, channel: "chromium" as const, executablePath: "C:/chrome.exe", version: "1", installedAt: "now" }, inspectedCandidates: [] }) };

const launcher = (close = vi.fn(async () => undefined)) => ({
  launch: vi.fn(async () => ({
    newContext: vi.fn(async () => ({
      newPage: vi.fn(async () => ({ goto: vi.fn(async () => undefined), url: vi.fn(() => "https://example.com"), close: vi.fn(async () => undefined) })),
      close: vi.fn(async () => undefined),
    })),
    close,
  })),
});

describe("BrowserSessionManager", () => {
  it("returns an explicit blocked session when T118 has no runtime", async () => {
    const manager = new BrowserSessionManager({ runtime: { resolveRuntime: () => ({ status: "not_installed", strategy: "download", inspectedCandidates: [], reason: "browser is missing" }) }, launcher: launcher() });
    const session = await manager.create({ allowedDomains: ["example.com"] });
    expect(session.status).toBe("blocked");
    expect(session.error).toMatchObject({ code: "runtime_unavailable", message: "browser is missing" });
  });

  it("creates, reuses and stops a ready session", async () => {
    const browserClose = vi.fn(async () => undefined);
    const manager = new BrowserSessionManager({ runtime: readyRuntime, launcher: launcher(browserClose) });
    const created = await manager.create({ allowedDomains: ["example.com"] });
    expect(created.status).toBe("ready");
    expect(manager.get(created.id)?.info.id).toBe(created.id);
    const stopped = await manager.stop(created.id);
    expect(stopped?.status).toBe("stopped");
    expect(manager.get(created.id)).toBeUndefined();
    expect(browserClose).toHaveBeenCalledOnce();
  });

  it("closes and removes an idle session after sessionTimeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const browserClose = vi.fn(async () => undefined);
      const manager = new BrowserSessionManager({ runtime: readyRuntime, launcher: launcher(browserClose) });
      const created = await manager.create({ allowedDomains: ["example.com"], sessionTimeoutMs: 10 });
      await vi.advanceTimersByTimeAsync(11);
      expect(browserClose).toHaveBeenCalledOnce();
      expect(manager.get(created.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("defers idle cleanup while an operation lease is held and closes once after release", async () => {
    vi.useFakeTimers();
    try {
      const browserClose = vi.fn(async () => undefined);
      const manager = new BrowserSessionManager({ runtime: readyRuntime, launcher: launcher(browserClose) });
      const created = await manager.create({ allowedDomains: ["example.com"], sessionTimeoutMs: 10 });
      const session = manager.get(created.id)!;
      manager.beginOperation(session);
      await vi.advanceTimersByTimeAsync(11);
      expect(manager.get(created.id)).toBeDefined();
      expect(browserClose).not.toHaveBeenCalled();
      manager.endOperation(session);
      await vi.advanceTimersByTimeAsync(11);
      expect(browserClose).toHaveBeenCalledOnce();
      expect(manager.get(created.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps sessions from different threads separate when one is stopped", async () => {
    const manager = new BrowserSessionManager({ runtime: readyRuntime, launcher: launcher() });
    const first = await manager.create({ allowedDomains: ["example.com"], sessionTimeoutMs: 1000 });
    const second = await manager.create({ allowedDomains: ["example.com"], sessionTimeoutMs: 1000 });
    expect(first.id).not.toBe(second.id);
    await manager.stop(first.id);
    expect(manager.get(first.id)).toBeUndefined();
    expect(manager.get(second.id)?.info.status).toBe("ready");
    await manager.closeAll();
  });
});
