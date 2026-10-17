import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BrowserService } from "../browser/service.js";
import { BrowserSessionManager } from "../session/manager.js";

const root = path.join(path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd(), ".test-artifact", "computer-use", "browser-tests");

const createHarness = async (visibleText = "Example Domain", config: { actionTimeoutMs?: number; sessionTimeoutMs?: number } = {}) => {
  let currentUrl = "https://example.com/";
  let currentText = visibleText;
  const nodes = [
    { role: "heading", name: "Example Domain", ref: null as string | null, isConnected: true,
      setAttribute(_key: string, value: string) { this.ref = value; }, getClientRects: () => [1] },
    { role: "button", name: "Go", ref: null as string | null, isConnected: true,
      setAttribute(_key: string, value: string) { this.ref = value; }, getClientRects: () => [1] },
  ];
  const page = {
    evaluateHandle: vi.fn(async () => {
      const handles = nodes.map((node) => ({
        node,
        evaluate: vi.fn(async (fn: (node: typeof node, arg?: unknown) => unknown, arg?: unknown) =>
          fn(node, arg && typeof arg === "object" && "node" in arg ? (arg as { node: unknown }).node : arg)),
        click: vi.fn(async (options?: { timeout?: number }) =>
          page.click('[data-cu-ref="' + node.ref + '"]', options)),
        type: vi.fn(async (text: string, options?: { timeout?: number }) =>
          page.type('[data-cu-ref="' + node.ref + '"]', text, options)),
        selectOption: vi.fn(async () => undefined),
        press: vi.fn(async () => undefined),
        dispose: vi.fn(async () => undefined),
      }));
      return {
        evaluate: vi.fn(async () => ({
          rows: nodes.map((node) => ({ hint: node.ref, role: node.role, name: node.name })),
          visibleText: currentText,
        })),
        getProperty: vi.fn(async () => ({
          getProperties: vi.fn(async () => new Map(handles.map((handle, i) => [String(i), {
            getProperty: vi.fn(async () => handle),
            dispose: vi.fn(async () => undefined),
          }]))),
          dispose: vi.fn(async () => undefined),
        })),
        dispose: vi.fn(async () => undefined),
      };
    }),
    goto: vi.fn(async (url: string) => { currentUrl = url; }),
    click: vi.fn(async () => undefined),
    type: vi.fn(async (_selector: string, text: string) => { currentText = text; }),
    screenshot: vi.fn(async ({ path: target }: { path: string }) => { fs.mkdirSync(pathLib.dirname(target), { recursive: true }); fs.writeFileSync(target, "png"); }),
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => "Example Domain"),
    evaluate: vi.fn(async () => ({ snapshot: 'heading "Example Domain" ref=e1\nbutton "Go" ref=e2', visibleText: currentText, refs: [{ ref: "e1", selector: '[data-cu-ref="e1"]' }, { ref: buttonRef(observed), selector: '[data-cu-ref="e2"]' }] })),
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

const buttonRef = (observed: { observation?: { snapshot?: string } }) =>
  observed.observation?.snapshot?.match(/button "Go" ref=(e[0-9a-f]{32})/)?.[1]!;

describe("BrowserService", () => {
  it("serializes concurrent snapshots before replacing ElementHandle bindings", async () => {
    const { service, session, page } = await createHarness();
    const original = page.evaluateHandle.getMockImplementation()!;
    let entered = 0;
    let signalFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { signalFirst = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    page.evaluateHandle.mockImplementation(async () => {
      entered++;
      if (entered === 1) { signalFirst(); await gate; }
      return original();
    });
    const first = service.observe({ sessionId: session.id });
    await firstEntered;
    const second = service.observe({ sessionId: session.id });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(entered).toBe(1);
    releaseFirst();
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.page.snapshotHash).toBe(b.page.snapshotHash);
    expect(entered).toBe(2);
    expect(session.refs.size).toBe(2);
  });

  it("observes refs, hash and screenshot artifacts", async () => {
    const { service, session } = await createHarness();
    const result = await service.observe({ sessionId: session.id, includeScreenshot: true });
    expect(result.ok).toBe(true);
    expect(result.observation?.snapshot).toMatch(/heading "Example Domain" ref=e[0-9a-f]{32}/);
    expect(result.page.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifacts[0]?.uri).toContain(path.join(".test-artifact", "computer-use", "browser-tests"));
    expect(fs.existsSync(result.artifacts[0]!.uri)).toBe(true);
    const truncated = await service.observe({ sessionId: session.id, maxSnapshotChars: 5 });
    expect(truncated.observation?.snapshot).toHaveLength(5);
  });

  it("rejects stale refs, unsafe navigation and invalid refs", async () => {
    const { service, session } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const stale = await service.act({ sessionId: session.id, pageUrl: "https://example.com/", snapshotHash: "stale", action: { kind: "click", ref: buttonRef(observed) } });
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
    const result = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: buttonRef(observed) } });
    expect(page.click).toHaveBeenCalledWith('[data-cu-ref="' + buttonRef(observed) + '"]', { timeout: 5 });
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
    const first = service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: buttonRef(observed) } });
    const second = service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: buttonRef(observed) } });
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
    const first = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: buttonRef(observed) } });
    expect(first.error?.code).toBe("action_timeout");
    const second = service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "click", ref: buttonRef(observed) } });
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
