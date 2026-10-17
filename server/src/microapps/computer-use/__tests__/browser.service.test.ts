import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BrowserService } from "../browser/service.js";
import { BrowserSessionManager } from "../session/manager.js";

const root = path.join(path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd(), ".test-artifact", "computer-use", "browser-tests");

const createHarness = async (visibleText = "Example Domain", config: { actionTimeoutMs?: number; sessionTimeoutMs?: number } = {}) => {
  let currentUrl = "https://example.com/";
  let currentText = visibleText;
  const page = {
    goto: vi.fn(async (url: string) => { currentUrl = url; }),
    click: vi.fn(async () => undefined),
    type: vi.fn(async (_selector: string, text: string) => { currentText = text; }),
    screenshot: vi.fn(async ({ path: target }: { path: string }) => { fs.mkdirSync(pathLib.dirname(target), { recursive: true }); fs.writeFileSync(target, "png"); }),
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => "Example Domain"),
    evaluate: vi.fn(async () => ({ snapshot: 'heading "Example Domain" ref=e1\nbutton "Go" ref=e2', visibleText: currentText, refs: [{ ref: "e1", selector: '[data-cu-ref="e1"]' }, { ref: "e2", selector: '[data-cu-ref="e2"]' }] })),
  };
  const browserClose = vi.fn(async () => undefined);
  const contextClose = vi.fn(async () => undefined);
  const manager = new BrowserSessionManager({
    runtime: { resolveRuntime: () => ({ status: "ready" as const, strategy: "managed" as const, runtime: { source: "managed" as const, channel: "chromium" as const, executablePath: "C:/chrome.exe", version: "1", installedAt: "now" }, inspectedCandidates: [] }) },
    artifactRoot: root,
    launcher: { launch: vi.fn(async () => ({ newContext: vi.fn(async () => ({ newPage: vi.fn(async () => page), close: contextClose })), close: browserClose })) },
  });
  const session = await manager.create({ allowedDomains: ["example.com"], ...config });
  return { manager, service: new BrowserService(manager), session, page, browserClose, contextClose };
};

const pathLib = path;

describe("BrowserService", () => {
  it("observes refs, hash and screenshot artifacts", async () => {
    const { service, session } = await createHarness();
    const result = await service.observe({ sessionId: session.id, includeScreenshot: true });
    expect(result.ok).toBe(true);
    expect(result.observation?.snapshot).toContain("ref=e1");
    expect(result.page.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifacts[0]?.uri).toContain(path.join(".test-artifact", "computer-use", "browser-tests"));
    expect(fs.existsSync(result.artifacts[0]!.uri)).toBe(true);
    const truncated = await service.observe({ sessionId: session.id, maxSnapshotChars: 5 });
    expect(truncated.observation?.snapshot).toHaveLength(5);
  });

  it("rejects stale refs, unsafe navigation and invalid refs", async () => {
    const { service, session } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const stale = await service.act({ sessionId: session.id, pageUrl: "https://example.com/", snapshotHash: "stale", action: { kind: "click", ref: "e2" } });
    expect(stale.error?.code).toBe("stale_snapshot");
    const invalidRef = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: "missing" } });
    expect(invalidRef.error?.code).toBe("ref_not_found");
    const unsafe = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "navigate", url: "https://not-example.com/" } });
    expect(unsafe.error?.code).toBe("action_failed");
  });

  it("returns structured assertion failures and wait timeouts", async () => {
    const { service, session } = await createHarness("not found");
    const observed = await service.observe({ sessionId: session.id });
    const assertion = await service.assert({ sessionId: session.id, assertion: { kind: "text", expected: "Example Domain" } });
    expect(assertion.ok).toBe(false);
    expect(assertion.error?.code).toBe("assertion_failed");
    const timeout = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "wait", text: "never", timeoutMs: 1 } });
    expect(timeout.error?.code).toBe("action_timeout");
  });

  it("applies action timeout to click and includes the recovered snapshot hash on failure", async () => {
    const { service, session, page } = await createHarness("Example Domain", { actionTimeoutMs: 5 });
    const observed = await service.observe({ sessionId: session.id });
    page.click.mockImplementation(() => new Promise(() => undefined));
    const result = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: "e2" } });
    expect(page.click).toHaveBeenCalledWith('[data-cu-ref="e2"]', { timeout: 5 });
    expect(result.error?.code).toBe("action_timeout");
    expect(result.page.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("serializes actions within one session", async () => {
    const { service, session, page } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const events: string[] = [];
    page.click.mockImplementation(async () => {
      events.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push("first-end");
    });
    const first = service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: "e2" } });
    const second = service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: "e2" } });
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "first-start", "first-end"]);
  });

  it("keeps the queue occupied until a timed-out underlying operation settles", async () => {
    const { service, session, page } = await createHarness("Example Domain", { actionTimeoutMs: 5 });
    const observed = await service.observe({ sessionId: session.id });
    let finishUnderlying!: () => void;
    let callCount = 0;
    page.click.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return new Promise<void>((resolve) => { finishUnderlying = resolve; });
      return Promise.resolve();
    });
    const first = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: "e2" } });
    expect(first.error?.code).toBe("action_timeout");
    const second = service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: "e2" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1);
    finishUnderlying();
    await second;
    expect(callCount).toBe(2);
  });

  it("keeps a real in-flight observe alive past idle expiry and closes only once it settles", async () => {
    vi.useFakeTimers();
    try {
      const { manager, service, session, page, browserClose, contextClose } = await createHarness("Example Domain", { sessionTimeoutMs: 10 });
      let resolveTitle!: (value: string) => void;
      const titleGate = new Promise<string>((resolve) => { resolveTitle = resolve; });
      page.title.mockImplementation(() => titleGate);
      const pending = service.observe({ sessionId: session.id });
      await vi.advanceTimersByTimeAsync(11);
      expect(manager.get(session.id)).toBeDefined();
      expect(browserClose).not.toHaveBeenCalled();
      expect(contextClose).not.toHaveBeenCalled();
      resolveTitle("Example Domain");
      const result = await pending;
      expect(result.ok).toBe(true);
      await vi.advanceTimersByTimeAsync(11);
      expect(browserClose).toHaveBeenCalledOnce();
      expect(contextClose).toHaveBeenCalledOnce();
      expect(manager.get(session.id)).toBeUndefined();
      await vi.advanceTimersByTimeAsync(11);
      expect(browserClose).toHaveBeenCalledOnce();
      expect(contextClose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a real in-flight observe screenshot alive past idle expiry", async () => {
    vi.useFakeTimers();
    try {
      const { manager, service, session, page, browserClose } = await createHarness("Example Domain", { sessionTimeoutMs: 10 });
      let resolveScreenshot!: () => void;
      const screenshotGate = new Promise<void>((resolve) => { resolveScreenshot = resolve; });
      page.screenshot.mockImplementation(() => screenshotGate);
      const pending = service.observe({ sessionId: session.id, includeScreenshot: true });
      await vi.advanceTimersByTimeAsync(11);
      expect(manager.get(session.id)).toBeDefined();
      expect(browserClose).not.toHaveBeenCalled();
      resolveScreenshot();
      const result = await pending;
      expect(result.ok).toBe(true);
      await vi.advanceTimersByTimeAsync(11);
      expect(browserClose).toHaveBeenCalledOnce();
      expect(manager.get(session.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a real in-flight assert alive past idle expiry and closes after release", async () => {
    vi.useFakeTimers();
    try {
      const { manager, service, session, page, browserClose } = await createHarness("Example Domain", { sessionTimeoutMs: 10 });
      let resolveTitle!: (value: string) => void;
      const titleGate = new Promise<string>((resolve) => { resolveTitle = resolve; });
      page.title.mockImplementation(() => titleGate);
      const pending = service.assert({ sessionId: session.id, assertion: { kind: "title", expected: "Example Domain" } });
      await vi.advanceTimersByTimeAsync(11);
      expect(manager.get(session.id)).toBeDefined();
      expect(browserClose).not.toHaveBeenCalled();
      resolveTitle("Example Domain");
      const result = await pending;
      expect(result.ok).toBe(true);
      expect(result.assertion?.passed).toBe(true);
      await vi.advanceTimersByTimeAsync(11);
      expect(browserClose).toHaveBeenCalledOnce();
      expect(manager.get(session.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
