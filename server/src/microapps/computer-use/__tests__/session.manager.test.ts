import { describe, expect, it, vi } from "vitest";
import { BrowserSessionManager, BrowserTabNotFoundError, BrowserTabPolicyError } from "../session/manager.js";

const readyRuntime = { resolveRuntime: () => ({ status: "ready" as const, strategy: "managed" as const, runtime: { source: "managed" as const, channel: "chromium" as const, executablePath: "C:/chrome.exe", version: "1", installedAt: "now" }, inspectedCandidates: [] }) };

const launcher = (close = vi.fn(async () => undefined)) => ({
  launch: vi.fn(async () => ({
    newContext: vi.fn(async () => {
      const page = { goto: vi.fn(async () => undefined), url: vi.fn(() => "https://example.com"), close: vi.fn(async () => undefined) };
      return {
        newPage: vi.fn(async () => page),
        pages: vi.fn(() => [page]),
        close: vi.fn(async () => undefined),
      };
    }),
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

  it("lists stable tab IDs, selects only current session pages and replaces a closed active tab", async () => {
    const pageA = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => "https://example.com/a"),
      title: vi.fn(async () => "Tab A"),
      close: vi.fn(async () => undefined),
      bringToFront: vi.fn(async () => undefined),
    };
    const pageB = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => "https://example.com/b"),
      title: vi.fn(async () => "Tab B"),
      close: vi.fn(async () => undefined),
      bringToFront: vi.fn(async () => undefined),
    };
    let pages = [pageA];
    const manager = new BrowserSessionManager({
      runtime: readyRuntime,
      launcher: {
        launch: vi.fn(async () => ({
          newContext: vi.fn(async () => ({
            newPage: vi.fn(async () => pageA),
            pages: vi.fn(() => pages),
            close: vi.fn(async () => undefined),
          })),
          close: vi.fn(async () => undefined),
        })),
      },
    });
    const created = await manager.create({ allowedDomains: ["example.com"] });
    const session = manager.get(created.id)!;

    const one = await manager.listTabs(session);
    expect(one.truncated).toBe(false);
    expect(one.tabs).toEqual([{ id: expect.stringMatching(/^tab-/), title: "Tab A", url: "https://example.com/a", selected: true }]);

    pages = [pageA, pageB];
    const both = await manager.listTabs(session);
    expect(both.tabs.map((tab) => tab.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(both.tabs.find((tab) => tab.selected)?.url).toBe("https://example.com/a");
    const tabB = both.tabs.find((tab) => tab.url === "https://example.com/b")!;

    await manager.selectTab(session, tabB.id);
    expect(session.page).toBe(pageB);
    expect(pageB.bringToFront).toHaveBeenCalledOnce();
    const selected = await manager.listTabs(session);
    expect(selected.tabs.find((tab) => tab.id === tabB.id)?.selected).toBe(true);
    expect(selected.tabs.map((tab) => tab.id)).toEqual(both.tabs.map((tab) => tab.id));

    pages = [pageA];
    await expect(manager.selectTab(session, tabB.id)).rejects.toBeInstanceOf(BrowserTabNotFoundError);
    expect(session.page).toBe(pageB);

    const other = new BrowserSessionManager({
      runtime: readyRuntime,
      launcher: {
        launch: vi.fn(async () => ({
          newContext: vi.fn(async () => ({
            newPage: vi.fn(async () => pageA),
            pages: vi.fn(() => [pageA]),
            close: vi.fn(async () => undefined),
          })),
          close: vi.fn(async () => undefined),
        })),
      },
    });
    const otherSession = other.get((await other.create({ allowedDomains: ["example.com"] })).id)!;
    const foreignTab = (await other.listTabs(otherSession)).tabs[0]!;
    await expect(manager.selectTab(session, foreignTab.id)).rejects.toBeInstanceOf(BrowserTabNotFoundError);

    await manager.closeAll();
    await other.closeAll();
  });

  it("rejects an out-of-policy tab before focus and rechecks after an asynchronous focus", async () => {
    const firstPage = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => "https://example.com/first"),
    };
    let secondUrl = "https://outside.invalid/popup";
    let redirectOnFocus = false;
    const secondPage = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => secondUrl),
      bringToFront: vi.fn(async () => {
        if (redirectOnFocus) secondUrl = "https://outside.invalid/redirected";
      }),
    };
    const manager = new BrowserSessionManager({
      runtime: readyRuntime,
      launcher: {
        launch: vi.fn(async () => ({
          newContext: vi.fn(async () => ({
            newPage: vi.fn(async () => firstPage),
            pages: vi.fn(() => [firstPage, secondPage]),
            close: vi.fn(async () => undefined),
          })),
          close: vi.fn(async () => undefined),
        })),
      },
    });
    try {
      const created = await manager.create({ allowedDomains: ["example.com"], allowedSchemes: ["https:"] });
      const session = manager.get(created.id)!;
      const tab = (await manager.listTabs(session)).tabs[1]!;
      await expect(manager.selectTab(session, tab.id)).rejects.toBeInstanceOf(BrowserTabPolicyError);
      expect(secondPage.bringToFront).not.toHaveBeenCalled();
      expect(session.page).toBe(firstPage);

      secondUrl = "data:text/html,not-allowed";
      await expect(manager.selectTab(session, tab.id)).rejects.toThrow("URL scheme is not allowed");
      expect(session.page).toBe(firstPage);

      secondUrl = "https://example.com/allowed";
      redirectOnFocus = true;
      await expect(manager.selectTab(session, tab.id)).rejects.toBeInstanceOf(BrowserTabPolicyError);
      expect(secondPage.bringToFront).toHaveBeenCalledOnce();
      expect(session.page).toBe(firstPage);

      redirectOnFocus = false;
      secondUrl = "https://example.com/allowed";
      await manager.selectTab(session, tab.id);
      expect(session.page).toBe(secondPage);
    } finally {
      await manager.closeAll();
    }
  });

  it("keeps an initial navigation alive while its idle timer fires, then expires it normally", async () => {
    vi.useFakeTimers();
    let finishNavigation!: () => void;
    try {
      let startedNavigation!: () => void;
      const started = new Promise<void>((resolve) => { startedNavigation = resolve; });
      const gate = new Promise<void>((resolve) => { finishNavigation = resolve; });
      const browserClose = vi.fn(async () => undefined);
      const contextClose = vi.fn(async () => undefined);
      const manager = new BrowserSessionManager({
        runtime: readyRuntime,
        launcher: {
          launch: vi.fn(async () => ({
            newContext: vi.fn(async () => {
              const page = {
                goto: vi.fn(async () => { startedNavigation(); await gate; }),
                url: vi.fn(() => "https://example.com/"),
                close: vi.fn(async () => undefined),
              };
              return {
                newPage: vi.fn(async () => page),
                pages: vi.fn(() => [page]),
                close: contextClose,
              };
            }),
            close: browserClose,
          })),
        },
      });
      const creating = manager.create({
        allowedDomains: ["example.com"],
        initialUrl: "https://example.com/",
        sessionTimeoutMs: 10,
      });
      await started;
      await vi.advanceTimersByTimeAsync(11);
      expect(browserClose).not.toHaveBeenCalled();
      expect(contextClose).not.toHaveBeenCalled();
      finishNavigation();
      const session = await creating;
      expect(session.status).toBe("ready");
      expect(manager.get(session.id)).toBeDefined();
      await vi.advanceTimersByTimeAsync(11);
      expect(manager.get(session.id)).toBeUndefined();
      expect(browserClose).toHaveBeenCalledOnce();
      expect(contextClose).toHaveBeenCalledOnce();
    } finally {
      finishNavigation?.();
      vi.useRealTimers();
    }
  });
});
