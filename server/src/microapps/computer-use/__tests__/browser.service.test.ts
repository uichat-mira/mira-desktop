import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BrowserService } from "../browser/service.js";
import { BrowserSessionManager } from "../session/manager.js";

const root = path.join(path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd(), ".test-artifact", "computer-use", "browser-tests");

type FakeNode = {
  role: string;
  name: string;
  ref: string;
  isConnected: boolean;
  visible: boolean;
  value?: string;
};

const createHarness = async (visibleText = "Example Domain", config: { actionTimeoutMs?: number; sessionTimeoutMs?: number } = {}) => {
  let currentUrl = "https://example.com/";
  let currentText = visibleText;
  let scrollX = 0;
  let scrollY = 0;
  let latestSnapshotRefs = new Map<string, FakeNode>();
  const nodes: FakeNode[] = [
    { role: "heading", name: "Example Domain", ref: "e1", isConnected: true, visible: true },
    { role: "button", name: "Go", ref: "e2", isConnected: true, visible: true },
    { role: "textbox", name: "Recipient Name", ref: "e3", isConnected: true, visible: true, value: "Alice" },
    { role: "combobox", name: "Shipping", ref: "e4", isConnected: true, visible: true, value: "Standard" },
  ];
  const resolveRef = (ref: string) => {
    const node = latestSnapshotRefs.get(ref);
    return node?.isConnected ? node : undefined;
  };
  const page = {
    goto: vi.fn(async (url: string) => { currentUrl = url; }),
    click: vi.fn(async (_ref: string, _options?: { timeout?: number }) => undefined),
    type: vi.fn(async (_ref: string, text: string, _options?: { timeout?: number }) => { currentText = text; }),
    selectOption: vi.fn(async (ref: string, value: string) => {
      const node = resolveRef(ref);
      if (!node) throw new Error(`Ref ${ref} not found in current page snapshot`);
      if (node.role !== "combobox") throw new Error("Element is not a <select> element");
      node.value = value;
    }),
    press: vi.fn(async () => undefined),
    screenshot: vi.fn(async ({ path: target }: { path: string }) => { fs.mkdirSync(pathLib.dirname(target), { recursive: true }); fs.writeFileSync(target, "png"); }),
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => "Example Domain"),
    evaluate: vi.fn(async (_fn: unknown, arg?: unknown) => {
      if (arg && typeof arg === "object" && ("x" in arg || "y" in arg)) {
        const delta = arg as { x?: number; y?: number };
        scrollX += delta.x ?? 0;
        scrollY += delta.y ?? 0;
        return undefined;
      }
      if (typeof _fn === "function" && String(_fn).includes("window.scrollX")) return { x: scrollX, y: scrollY };
      return currentText;
    }),
    ariaSnapshot: vi.fn(async () => {
      const visible = nodes.filter((node) => node.isConnected && node.visible);
      latestSnapshotRefs = new Map(visible.map((node) => [node.ref, node]));
      return visible.map((node) => `- ${node.role} "${node.name}" [ref=${node.ref}]`).join("\n");
    }),
    getByRef: vi.fn((ref: string) => ({
      count: vi.fn(async () => resolveRef(ref) ? 1 : 0),
      isVisible: vi.fn(async () => Boolean(resolveRef(ref)?.visible)),
      inputValue: vi.fn(async () => {
        const node = resolveRef(ref);
        if (!node) throw new Error(`Ref ${ref} not found in current page snapshot`);
        return node.value ?? "";
      }),
      click: vi.fn(async (options?: { timeout?: number }) => {
        if (!resolveRef(ref)) throw new Error(`Ref ${ref} not found in current page snapshot`);
        return page.click(ref, options);
      }),
      type: vi.fn(async (text: string, options?: { timeout?: number }) => {
        if (!resolveRef(ref)) throw new Error(`Ref ${ref} not found in current page snapshot`);
        return page.type(ref, text, options);
      }),
      fill: vi.fn(async (value: string, _options?: { timeout?: number }) => {
        const node = resolveRef(ref);
        if (!node) throw new Error(`Ref ${ref} not found in current page snapshot`);
        if (node.role !== "textbox") throw new Error("Element is not an <input>, <textarea> or [contenteditable]");
        node.value = value;
      }),
      selectOption: vi.fn(async (value: string, options?: { timeout?: number }) => {
        if (!resolveRef(ref)) throw new Error(`Ref ${ref} not found in current page snapshot`);
        return page.selectOption(ref, value, options);
      }),
      press: vi.fn(async (key: string, options?: { timeout?: number }) => {
        if (!resolveRef(ref)) throw new Error(`Ref ${ref} not found in current page snapshot`);
        return page.press(ref, key, options);
      }),
    })),
  };
  const browserClose = vi.fn(async () => undefined);
  const contextClose = vi.fn(async () => undefined);
  const pages: unknown[] = [page];
  const manager = new BrowserSessionManager({
    runtime: { resolveRuntime: () => ({ status: "ready" as const, strategy: "managed" as const, runtime: { source: "managed" as const, channel: "chromium" as const, executablePath: "C:/chrome.exe", version: "1", installedAt: "now" }, inspectedCandidates: [] }) },
    artifactRoot: root,
    launcher: { launch: vi.fn(async () => ({ newContext: vi.fn(async () => ({ newPage: vi.fn(async () => page), pages: vi.fn(() => pages), close: contextClose })), close: browserClose })) } as never,
  });
  const session = await manager.create({ allowedDomains: ["example.com"], ...config });
  return { manager, service: new BrowserService(manager), session, page, pages, nodes, browserClose, contextClose };
};

const pathLib = path;

const buttonRef = (observed: { observation?: { snapshot?: string } }) =>
  observed.observation?.snapshot?.match(/button "Go" \[ref=(e\d+)\]/)?.[1]!;

const inputRef = (observed: { observation?: { snapshot?: string } }) =>
  observed.observation?.snapshot?.match(/textbox "Recipient Name" \[ref=(e\d+)\]/)?.[1]!;

const selectRef = (observed: { observation?: { snapshot?: string } }) =>
  observed.observation?.snapshot?.match(/combobox "Shipping" \[ref=(e\d+)\]/)?.[1]!;

describe("BrowserService", () => {
  it("serializes an observation and a ref action against one native snapshot map", async () => {
    const { service, session, page } = await createHarness();
    const first = await service.observe({ sessionId: session.id });
    const ref = buttonRef(first);
    let started!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const originalSnapshot = page.ariaSnapshot.getMockImplementation()!;
    page.ariaSnapshot.mockImplementationOnce(async () => { started(); await gate; return originalSnapshot(); });
    const observing = service.observe({ sessionId: session.id });
    await entered;
    const clicking = service.act({
      sessionId: session.id, pageUrl: first.page.url,
      snapshotHash: first.page.snapshotHash!, action: { kind: "click", ref },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.click).not.toHaveBeenCalled();
    resume();
    const [observed, acted] = await Promise.all([observing, clicking]);
    expect(observed.ok).toBe(true);
    expect(acted.ok).toBe(true);
    expect(page.click).toHaveBeenCalledOnce();
  });

  it("serializes concurrent snapshots before replacing Playwright's latest AI ref map", async () => {
    const { service, session, page } = await createHarness();
    const original = page.ariaSnapshot.getMockImplementation()!;
    let entered = 0;
    let signalFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { signalFirst = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    page.ariaSnapshot.mockImplementation(async () => {
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
    expect(page.ariaSnapshot).toHaveBeenCalledTimes(2);
  });

  it("observes refs, hash and screenshot artifacts", async () => {
    const { service, session } = await createHarness();
    const result = await service.observe({ sessionId: session.id, includeScreenshot: true });
    expect(result.ok).toBe(true);
    expect(result.observation?.snapshot).toMatch(/heading "Example Domain" \[ref=e1\]/);
    expect(result.page.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifacts[0]?.uri).toContain(path.join(".test-artifact", "computer-use", "browser-tests"));
    expect(fs.existsSync(result.artifacts[0]!.uri)).toBe(true);
    const truncated = await service.observe({ sessionId: session.id, maxSnapshotChars: 5 });
    expect(truncated.observation?.snapshot).toHaveLength(5);
  });

  it("lists session tabs, selects one and invalidates the previous tab observation", async () => {
    const { service, session, pages } = await createHarness();
    const first = await service.observe({ sessionId: session.id });
    const secondPage = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => "https://example.com/second"),
      title: vi.fn(async () => "Second Tab"),
      evaluate: vi.fn(async () => "Second Tab"),
      ariaSnapshot: vi.fn(async () => '- heading "Second" [ref=e1]'),
      getByRef: vi.fn(() => ({ count: vi.fn(async () => 1) })),
      screenshot: vi.fn(async () => undefined),
    };
    pages.push(secondPage);

    const listed = await service.listTabs({ sessionId: session.id });
    expect(listed.ok).toBe(true);
    expect(listed.tabsTruncated).toBe(false);
    expect(listed.tabs).toEqual([
      { id: expect.stringMatching(/^tab-/), title: "Example Domain", url: "https://example.com/", selected: true },
      { id: expect.stringMatching(/^tab-/), title: "Second Tab", url: "https://example.com/second", selected: false },
    ]);
    const tabIds = listed.tabs!.map((tab) => tab.id);
    expect(new Set(tabIds).size).toBe(2);

    const secondTab = listed.tabs!.find((tab) => tab.url === "https://example.com/second")!;
    const selected = await service.selectTab({ sessionId: session.id, tabId: secondTab.id });
    expect(selected.ok).toBe(true);
    expect(selected.page).toMatchObject({ url: "https://example.com/second", title: "Second Tab" });
    expect(selected.observation?.snapshot).toContain('heading "Second"');
    expect(selected.tabs?.find((tab) => tab.id === secondTab.id)?.selected).toBe(true);

    const oldRef = first.observation?.snapshot?.match(/button "Go" \[ref=(e\d+)\]/)?.[1]!;
    const stale = await service.act({
      sessionId: session.id,
      pageUrl: first.page.url,
      snapshotHash: first.page.snapshotHash!,
      action: { kind: "click", ref: oldRef },
    });
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("stale_snapshot");

    pages.splice(pages.indexOf(secondPage), 1);
    const closed = await service.selectTab({ sessionId: session.id, tabId: secondTab.id });
    expect(closed.ok).toBe(false);
    expect(closed.error).toMatchObject({ code: "tab_not_found", retryable: false });
    const stillA = await service.listTabs({ sessionId: session.id });
    expect(stillA.tabs?.map((tab) => tab.id)).toEqual([tabIds[0]]);
  });

  it("does not revive old action refs across identical A -> B -> A tabs", async () => {
    const { service, session, page, pages } = await createHarness();
    const first = await service.observe({ sessionId: session.id });
    expect(first.ok).toBe(true);
    const ref = buttonRef(first);
    const originalHash = first.page.snapshotHash!;

    // Same URL, visible text, ARIA snapshot and ref IDs on distinct Page objects.
    const clickB = vi.fn(async () => undefined);
    const pageB = {
      ...page,
      getByRef: vi.fn((_ref: string) => ({
        count: vi.fn(async () => 1),
        click: clickB,
      })),
      bringToFront: vi.fn(async () => undefined),
    };
    pages.push(pageB);
    const tabs = (await service.listTabs({ sessionId: session.id })).tabs!;
    const tabA = tabs.find((tab) => tab.selected)!;
    const tabB = tabs.find((tab) => !tab.selected)!;
    const selectB = await service.selectTab({ sessionId: session.id, tabId: tabB.id });
    expect(selectB.ok).toBe(true);
    expect(selectB.page.url).toBe(first.page.url);
    expect(selectB.observation?.snapshot).toBe(first.observation?.snapshot);
    expect(selectB.page.snapshotHash).not.toBe(originalHash);

    const staleOnB = await service.act({
      sessionId: session.id, pageUrl: first.page.url,
      snapshotHash: originalHash, action: { kind: "click", ref },
    });
    expect(staleOnB.error?.code).toBe("stale_snapshot");
    expect(page.click).not.toHaveBeenCalled();
    expect(clickB).not.toHaveBeenCalled();

    const freshB = await service.observe({ sessionId: session.id });
    expect(freshB.page.snapshotHash).toBe(selectB.page.snapshotHash);
    const currentB = await service.act({
      sessionId: session.id, pageUrl: freshB.page.url,
      snapshotHash: freshB.page.snapshotHash!, action: { kind: "click", ref },
    });
    expect(currentB.ok).toBe(true);
    expect(clickB).toHaveBeenCalledOnce();

    // Selecting an already selected tab must not bump the generation.
    const sameB = await service.selectTab({ sessionId: session.id, tabId: tabB.id });
    expect(sameB.page.snapshotHash).toBe(freshB.page.snapshotHash);

    const selectA = await service.selectTab({ sessionId: session.id, tabId: tabA.id });
    expect(selectA.ok).toBe(true);
    expect(selectA.page.snapshotHash).not.toBe(originalHash);
    expect(selectA.page.snapshotHash).not.toBe(freshB.page.snapshotHash);
    const staleOnReturn = await service.act({
      sessionId: session.id, pageUrl: first.page.url,
      snapshotHash: originalHash, action: { kind: "click", ref },
    });
    expect(staleOnReturn.error?.code).toBe("stale_snapshot");
    expect(page.click).not.toHaveBeenCalled();
    const refreshedA = await service.observe({ sessionId: session.id });
    expect(refreshedA.page.snapshotHash).toBe(selectA.page.snapshotHash);

    // A rejected switch cannot invalidate a valid observation or move the page.
    const blockedPage = { ...page, url: vi.fn(() => "https://outside.invalid/") };
    pages.push(blockedPage);
    const blockedTab = (await service.listTabs({ sessionId: session.id })).tabs!.find(
      (tab) => tab.url === "https://outside.invalid/",
    )!;
    const denied = await service.selectTab({ sessionId: session.id, tabId: blockedTab.id });
    expect(denied.error?.code).toBe("navigation_blocked");
    expect(session.page).toBe(page);
    const afterDenial = await service.observe({ sessionId: session.id });
    expect(afterDenial.page.snapshotHash).toBe(refreshedA.page.snapshotHash);
    const currentA = await service.act({
      sessionId: session.id, pageUrl: refreshedA.page.url,
      snapshotHash: refreshedA.page.snapshotHash!, action: { kind: "click", ref },
    });
    expect(currentA.ok).toBe(true);
    expect(page.click).toHaveBeenCalledOnce();
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

  it("fills an observed input to the exact value, replacing instead of appending", async () => {
    const { service, session, nodes } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const ref = inputRef(observed);
    const input = nodes.find((node) => node.ref === ref)!;
    expect(input.value).toBe("Alice");
    const result = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "fill", ref, value: "Blueberry" } });
    expect(result.ok).toBe(true);
    expect(input.value).toBe("Blueberry");
    expect(input.value).not.toContain("Alice");
    const assertion = await service.assert({ sessionId: session.id, assertion: { kind: "value", ref, expected: "Blueberry" } });
    expect(assertion.ok).toBe(true);
    expect(assertion.assertion).toEqual({ kind: "value", passed: true });
  });

  it("rejects a stale or missing ref before filling", async () => {
    const { service, session } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const ref = inputRef(observed);
    const stale = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: "stale-hash", action: { kind: "fill", ref, value: "x" } });
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("stale_snapshot");
    const missing = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "fill", ref: "e-missing", value: "x" } });
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe("ref_not_found");
  });

  it("reports a non-fillable observed target as invalid_target", async () => {
    const { service, session } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const result = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "fill", ref: buttonRef(observed), value: "x" } });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_target");
  });

  it("presses a key on the observed control and rejects stale or missing refs", async () => {
    const { service, session, page } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const ref = buttonRef(observed);
    const pressed = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "press", ref, key: "Enter" } });
    expect(pressed.ok).toBe(true);
    expect(page.press).toHaveBeenCalledWith(ref, "Enter", { timeout: 30000 });

    const stale = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: "stale-hash", action: { kind: "press", ref, key: "Enter" } });
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("stale_snapshot");
    const missing = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "press", ref: "e-missing", key: "Enter" } });
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe("ref_not_found");
  });

  it("selects an option on the observed select and reports invalid targets", async () => {
    const { service, session, nodes } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const ref = selectRef(observed);
    const select = nodes.find((node) => node.ref === ref)!;
    expect(select.value).toBe("Standard");
    const selected = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "select", ref, value: "Express" } });
    expect(selected.ok).toBe(true);
    expect(select.value).toBe("Express");
    const assertion = await service.assert({ sessionId: session.id, assertion: { kind: "value", ref, expected: "Express" } });
    expect(assertion.ok).toBe(true);

    const invalid = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "select", ref: buttonRef(observed), value: "Express" } });
    expect(invalid.ok).toBe(false);
    expect(invalid.error?.code).toBe("invalid_target");
  });

  it("scrolls the viewport by the requested offset and rejects a stale observation", async () => {
    const { service, session, page } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    page.evaluate.mockClear();
    const scrolled = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "scroll", x: 0, y: 400 } });
    expect(scrolled.ok).toBe(true);
    expect(scrolled.scroll).toEqual({
      requested: { x: 0, y: 400 },
      before: { x: 0, y: 0 },
      after: { x: 0, y: 400 },
      moved: true,
    });
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), { x: 0, y: 400 });

    page.evaluate.mockClear();
    const stale = await service.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: "stale-hash", action: { kind: "scroll", x: 0, y: 400 } });
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("stale_snapshot");
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("navigates an allowed URL and reports the resulting page", async () => {
    const { service, session, page } = await createHarness();
    const result = await service.navigate({ sessionId: session.id, url: "https://example.com/next" });
    expect(result.ok).toBe(true);
    expect(result.page.url).toBe("https://example.com/next");
    expect(result.page.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(page.goto).toHaveBeenCalledWith("https://example.com/next", expect.objectContaining({ waitUntil: "domcontentloaded" }));
  });

  it("rejects a disallowed navigation without rewriting the URL", async () => {
    const { service, session, page } = await createHarness();
    const domain = await service.navigate({ sessionId: session.id, url: "https://evil.com/steal" });
    expect(domain.ok).toBe(false);
    expect(domain.error?.code).toBe("navigation_blocked");
    expect(page.goto).not.toHaveBeenCalled();
    const scheme = await service.navigate({ sessionId: session.id, url: "ftp://example.com/file" });
    expect(scheme.ok).toBe(false);
    expect(scheme.error?.code).toBe("navigation_blocked");
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("waits for text and URL conditions and reports deterministic timeouts", async () => {
    const { service, session } = await createHarness("Ready now");
    const text = await service.wait({ sessionId: session.id, condition: { kind: "text", value: "Ready" }, timeoutMs: 50 });
    expect(text.ok).toBe(true);
    const url = await service.wait({ sessionId: session.id, condition: { kind: "url", value: "https://example.com/" }, timeoutMs: 50 });
    expect(url.ok).toBe(true);
    const timeout = await service.wait({ sessionId: session.id, condition: { kind: "text", value: "never-present" }, timeoutMs: 5 });
    expect(timeout.ok).toBe(false);
    expect(timeout.error?.code).toBe("wait_timeout");
  });

  it("does not treat a URL prefix as a matching destination", async () => {
    const { service, session } = await createHarness();
    await service.navigate({ sessionId: session.id, url: "https://example.com/checkout/success-error" });
    const falsePositive = await service.wait({
      sessionId: session.id, condition: { kind: "url", value: "https://example.com/checkout/success" }, timeoutMs: 30,
    });
    expect(falsePositive.ok).toBe(false);
    expect(falsePositive.error?.code).toBe("wait_timeout");

    await service.navigate({ sessionId: session.id, url: "https://example.com/checkout/success" });
    const exactMatch = await service.wait({
      sessionId: session.id, condition: { kind: "url", value: "https://example.com/checkout/success" }, timeoutMs: 100,
    });
    expect(exactMatch.ok).toBe(true);
  });

  it("times out a stalled page observation without releasing its session lock early", async () => {
    const { service, session, page } = await createHarness("Ready");
    let resolveTitle!: (title: string) => void;
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const stalledTitle = new Promise<string>((resolve) => { resolveTitle = resolve; });
    page.title.mockImplementationOnce(() => {
      signalEntered();
      return stalledTitle;
    });

    const first = service.wait({
      sessionId: session.id, condition: { kind: "text", value: "Ready" }, timeoutMs: 30,
    });
    await entered;
    const timedOut = await first;
    expect(timedOut.ok).toBe(false);
    expect(timedOut.error?.code).toBe("wait_timeout");

    // The Playwright read is still pending. Its handle/snapshot work must
    // finish before the next action enters the same session.
    const second = service.wait({
      sessionId: session.id, condition: { kind: "text", value: "Ready" }, timeoutMs: 200,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.title).toHaveBeenCalledTimes(1);
    resolveTitle("Example Domain");
    expect((await second).ok).toBe(true);
  });

  it("waits on a bound visible ref and rejects a mismatched page identity", async () => {
    const { service, session } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const ref = buttonRef(observed);
    const ok = await service.wait({ sessionId: session.id, condition: { kind: "visible", ref, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash! }, timeoutMs: 50 });
    expect(ok.ok).toBe(true);
    const stale = await service.wait({ sessionId: session.id, condition: { kind: "visible", ref, pageUrl: observed.page.url, snapshotHash: "different-hash" }, timeoutMs: 5 });
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("stale_snapshot");
    const unknownRef = await service.wait({ sessionId: session.id, condition: { kind: "visible", ref: "e-missing", pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash! }, timeoutMs: 5 });
    expect(unknownRef.ok).toBe(false);
    expect(unknownRef.error?.code).toBe("ref_not_found");
  });

  it("does not accept a replacement DOM node for a visible wait", async () => {
    const { service, session, nodes } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const ref = buttonRef(observed);
    const original = nodes[1]!;
    original.isConnected = false;
    nodes[1] = { ...original, ref: "e3", isConnected: true };
    const result = await service.wait({ sessionId: session.id, condition: { kind: "visible", ref, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash! }, timeoutMs: 5 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("stale_snapshot");
  });

  it("waits for the same hidden target to become visible without taking an intermediate snapshot", async () => {
    const { service, session, nodes, page } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const ref = buttonRef(observed);
    nodes[1]!.visible = false;
    const snapshotsBeforeWait = page.ariaSnapshot.mock.calls.length;
    setTimeout(() => { nodes[1]!.visible = true; }, 10);
    const result = await service.wait({
      sessionId: session.id,
      condition: { kind: "visible", ref, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash! },
      timeoutMs: 100,
    });
    expect(result.ok).toBe(true);
    expect(page.ariaSnapshot.mock.calls.length).toBe(snapshotsBeforeWait + 1);
  });

  it("times out while the original ref remains hidden", async () => {
    const { service, session, nodes } = await createHarness();
    const observed = await service.observe({ sessionId: session.id });
    const ref = buttonRef(observed);
    nodes[1]!.visible = false;
    const result = await service.wait({
      sessionId: session.id,
      condition: { kind: "visible", ref, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash! },
      timeoutMs: 10,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("wait_timeout");
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
    expect(page.click).toHaveBeenCalledWith(buttonRef(observed), { timeout: 5 });
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
