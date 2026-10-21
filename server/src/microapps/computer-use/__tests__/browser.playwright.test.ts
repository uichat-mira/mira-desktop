import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { BrowserService } from "../browser/service.js";
import { BrowserSessionManager } from "../session/manager.js";
import { createComputerUseBrowserTools } from "../../../mcp/tools/browser-tools.tool.js";
import { clearRegistry, listToolDefinitions, registerTool } from "../../../mcp/core/registry.js";
import { clearInvocations, executeInvocation } from "../../../mcp/core/invocations.js";
import {
  clearHarnessInvocations,
  executeHarnessInvocation,
  resolveHarnessInvocationApproval,
} from "../../../harness/invocations.js";
import {
  acquireToolLabBrowserRunStep,
  clearToolLabBrowserRuns,
  createToolLabBrowserRun,
} from "../../../mcp/tool-lab-browser-runs.js";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";

const root = path.join(path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd(), ".test-artifact", "computer-use", "agt-006");
const executableCandidates = (() => {
  const cache = path.join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright");
  if (!fs.existsSync(cache)) return [];
  return fs.readdirSync(cache).filter((p) => /^chromium-\d+$/.test(p)).sort().reverse().map((revision) =>
    path.join(cache, revision, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
})();
// GitHub-hosted Linux/Windows runners may have Chrome installed without a
// Playwright-managed browser bundle. Exercise the actual browser when present.
const installedBrowsers = [
  process.env.MIRA_BROWSER_TEST_EXECUTABLE,
  chromium.executablePath(),
  ...executableCandidates,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = installedBrowsers.find((file): file is string => Boolean(file && fs.existsSync(file)));

describe.skipIf(!executablePath)("Managed Browser real Chromium DOM fixture", () => {
  it("rejects reused refs after DOM replacement and emits real Screenshot Artifact", async () => {
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `fixture-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, `<!doctype html><html><head><title>Managed Browser Fixture</title></head>
<body><h1>Checkout</h1><a href="#more">Details</a>
<label for="name">Recipient Name</label><input id="name" placeholder="Customer" value="Alice">
<button id="replace">Confirm</button><select aria-label="Shipping"><option>Standard</option></select>
</body></html>`);
    const manager = new BrowserSessionManager({
      launcher: { launch: (opts) => chromium.launch({ ...opts, executablePath }) },
      artifactRoot: root,
    });
    const browser = new BrowserService(manager);
    try {
      clearRegistry(); clearInvocations();
      const tools = createComputerUseBrowserTools(browser, { sessionManager: manager });
      for (const tool of tools) registerTool(tool);
      expect(listToolDefinitions().map((def) => def.id)).toContain("browser_snapshot");
      expect(listToolDefinitions().map((def) => def.id)).toContain("browser_screenshot");
      const threadId = `smoke-${crypto.randomUUID()}`;
      const bootArgs = { url: pathToFileURL(file).href };
      const boot = await executeInvocation({ toolId: "browser_navigate", threadId, args: bootArgs, approvedInvocations: [{ toolId: "browser_navigate", inputHash: createInvocationInputHash(bootArgs) }] });
      expect(boot.status).toBe("completed");
      const sessionId = boot.args.sessionId as string;
      const before = await executeInvocation({ toolId: "browser_snapshot", threadId, args: {} });
      expect(before.status).toBe("completed");
      const observed = await browser.observe({ sessionId });
      expect(observed.observation?.snapshot).toMatch(/textbox "Recipient Name" \[ref=e\d+\]/);
      expect(observed.observation?.snapshot).toMatch(/button "Confirm" \[ref=e\d+\]/);
      expect(observed.observation?.snapshot).toMatch(/link "Details"/);
      expect(observed.observation?.snapshot).toMatch(/combobox "Shipping"/);
      const ref = observed.observation?.snapshot?.match(/button "Confirm" \[ref=(e\d+)\]/)?.[1]!;
      const url = observed.page.url;
      const snapshotHash = observed.page.snapshotHash!;
      const same = await browser.observe({ sessionId });
      expect(same.page.snapshotHash).toBe(snapshotHash);
      expect(same.observation?.snapshot).toContain(`[ref=${ref}]`);
      const current = manager.get(sessionId)!;
      const clicked = await browser.act({ sessionId, pageUrl: url, snapshotHash, action: { kind: "click", ref } });
      expect(clicked.ok).toBe(true);

      // Playwright's latest AI snapshot owns the ref -> DOM-node mapping.
      // Replacing the node with an identical clone disconnects the original
      // mapped object; getByRef(ref) must never rebound the old ref to the clone.
      await current.page.evaluate(() => {
        const old = document.getElementById("replace")!;
        const clone = old.cloneNode(true);
        clone.addEventListener("click", () => document.body.setAttribute("data-wrong-click", "yes"));
        old.replaceWith(clone);
      });
      const click = await browser.act({
        sessionId,
        pageUrl: clicked.page.url,
        snapshotHash: clicked.page.snapshotHash!,
        action: { kind: "click", ref },
      });
      expect(click.ok).toBe(false);
      expect(click.error?.code).toBe("stale_snapshot");
      expect(await current.page.evaluate(() => document.body.hasAttribute("data-wrong-click"))).toBe(false);
      const visible = await browser.assert({ sessionId, assertion: { kind: "visible", ref } });
      expect(visible.ok).toBe(false);
      expect(visible.error?.code).toBe("stale_snapshot");
      const wait = await browser.act({
        sessionId,
        pageUrl: clicked.page.url,
        snapshotHash: clicked.page.snapshotHash!,
        action: { kind: "wait", ref, timeoutMs: 10 },
      });
      expect(wait.ok).toBe(false);
      expect(wait.error?.code).toBe("stale_snapshot");
      const after = await browser.observe({ sessionId });
      expect(after.observation?.snapshot).not.toContain(`[ref=${ref}]`);
      // An identical input clone must not inherit the observed node identity.
      const inputRef = after.observation?.snapshot?.match(/textbox "Recipient Name" \[ref=(e\d+)\]/)?.[1]!;
      await current.page.evaluate(() => {
        const original = document.getElementById("name")!;
        original.replaceWith(original.cloneNode(true));
      });
      const staleValue = await browser.assert({ sessionId, assertion: { kind: "value", ref: inputRef, expected: "Alice" } });
      expect(staleValue.ok).toBe(false);
      expect(staleValue.error?.code).toBe("stale_snapshot");
      const bounded = await browser.observe({ sessionId, maxSnapshotChars: 100 });
      expect(bounded.observation?.snapshot?.length).toBeLessThanOrEqual(100);
      expect(bounded.observation?.truncated).toBe(true);
      const shot = await executeInvocation({ toolId: "browser_screenshot", threadId, args: { fullPage: true } });
      expect(shot.status).toBe("completed");
      expect(shot.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "image" })]));
      const artifact = shot.artifacts.find((a) => a.kind === "image")!;
      expect(fs.readFileSync(artifact.uri!).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    } finally {
      await manager.closeAll();
      clearRegistry(); clearInvocations();
      fs.rmSync(file, { force: true });
    }
  }, 30000);

  it("lists and selects same-session tabs, rejects closed and foreign tab IDs, and keeps session ownership", async () => {
    fs.mkdirSync(root, { recursive: true });
    const firstFile = path.join(root, `tabs-first-${crypto.randomUUID()}.html`);
    const secondFile = path.join(root, `tabs-second-${crypto.randomUUID()}.html`);
    fs.writeFileSync(firstFile, `<!doctype html><html><head><title>First Tab</title></head><body><h1>First Tab</h1></body></html>`);
    fs.writeFileSync(secondFile, `<!doctype html><html><head><title>Second Tab</title></head><body><h1>Second Tab</h1></body></html>`);
    const manager = new BrowserSessionManager({
      launcher: { launch: (opts) => chromium.launch({ ...opts, executablePath }) },
      artifactRoot: root,
    });
    const otherManager = new BrowserSessionManager({
      launcher: { launch: (opts) => chromium.launch({ ...opts, executablePath }) },
      artifactRoot: root,
    });
    const browser = new BrowserService(manager);
    const approve = (toolId: string, args: Record<string, unknown>) => ({ toolId, inputHash: createInvocationInputHash(args) });
    try {
      clearRegistry(); clearInvocations();
      for (const tool of createComputerUseBrowserTools(browser, { sessionManager: manager })) registerTool(tool);
      const threadId = `tabs-${crypto.randomUUID()}`;
      const firstUrl = pathToFileURL(firstFile).href;
      const secondUrl = pathToFileURL(secondFile).href;

      const navArgs = { url: firstUrl };
      const boot = await executeInvocation({ toolId: "browser_navigate", threadId, args: navArgs, approvedInvocations: [approve("browser_navigate", navArgs)] });
      expect(boot.status).toBe("completed");
      const sessionId = boot.args.sessionId as string;
      const session = manager.get(sessionId)!;
      const firstPage = session.page;

      const single = await executeInvocation({ toolId: "browser_tabs_list", threadId, args: {} });
      expect(single.status).toBe("completed");
      const singleResult = single.result as { tabs?: Array<{ id: string; title: string; url: string; selected: boolean }> };
      expect(singleResult.tabs).toHaveLength(1);
      expect(singleResult.tabs?.[0]).toMatchObject({ title: "First Tab", url: firstUrl, selected: true });
      const firstTabId = singleResult.tabs![0]!.id;

      // A same-context page represents a tab created by an in-session popup or
      // page action; it must be discoverable without touching another browser.
      const secondPage = await session.context.newPage();
      await secondPage.goto(secondUrl, { waitUntil: "domcontentloaded" });
      const listed = await executeInvocation({ toolId: "browser_tabs_list", threadId, args: {} });
      const listedResult = listed.result as { tabs?: Array<{ id: string; title: string; url: string; selected: boolean }> };
      expect(listedResult.tabs).toHaveLength(2);
      expect(listedResult.tabs?.find((tab) => tab.id === firstTabId)).toMatchObject({ selected: true });
      const secondTab = listedResult.tabs!.find((tab) => tab.url === secondUrl)!;
      expect(secondTab).toMatchObject({ title: "Second Tab", selected: false });

      const selectArgs = { tabId: secondTab.id };
      const selectPending = await executeInvocation({ toolId: "browser_tab_select", threadId, args: selectArgs });
      expect(selectPending.status).toBe("awaiting_approval");
      expect(session.page).toBe(firstPage);
      const selected = await executeInvocation({ toolId: "browser_tab_select", threadId, args: selectArgs, approvedInvocations: [approve("browser_tab_select", selectArgs)] });
      expect(selected.status).toBe("completed");
      expect(selected.result).toMatchObject({ ok: true, page: { url: secondUrl, title: "Second Tab" } });
      expect(session.page).toBe(secondPage);
      const secondSnapshot = await executeInvocation({ toolId: "browser_snapshot", threadId, args: {} });
      expect((secondSnapshot.result as { observation?: { snapshot?: string } }).observation?.snapshot).toContain('heading "Second Tab"');

      const firstSelectArgs = { tabId: firstTabId };
      const back = await executeInvocation({ toolId: "browser_tab_select", threadId, args: firstSelectArgs, approvedInvocations: [approve("browser_tab_select", firstSelectArgs)] });
      expect(back.result).toMatchObject({ ok: true, page: { url: firstUrl } });

      await secondPage.close?.();
      const closedArgs = { tabId: secondTab.id };
      const closed = await executeInvocation({ toolId: "browser_tab_select", threadId, args: closedArgs, approvedInvocations: [approve("browser_tab_select", closedArgs)] });
      expect(closed.status).toBe("completed");
      expect(closed.result).toMatchObject({ ok: false, error: { code: "tab_not_found" } });
      const afterClose = await executeInvocation({ toolId: "browser_tabs_list", threadId, args: {} });
      expect((afterClose.result as { tabs?: Array<{ id: string }> }).tabs?.map((tab) => tab.id)).toEqual([firstTabId]);
      expect(session.page).toBe(firstPage);

      const otherSession = await otherManager.create({ allowedDomains: [], allowedSchemes: ["file:"], initialUrl: secondUrl });
      expect(otherSession.status).toBe("ready");
      const foreignTab = (await otherManager.listTabs(otherManager.get(otherSession.id)!)).tabs[0]!;
      const foreignArgs = { tabId: foreignTab.id };
      const foreign = await executeInvocation({ toolId: "browser_tab_select", threadId, args: foreignArgs, approvedInvocations: [approve("browser_tab_select", foreignArgs)] });
      expect(foreign.result).toMatchObject({ ok: false, error: { code: "tab_not_found" } });
      expect(session.page).toBe(firstPage);

      await manager.stop(sessionId);
      expect(firstPage.isClosed?.()).toBe(true);
      expect(secondPage.isClosed?.()).toBe(true);
    } finally {
      await manager.closeAll();
      await otherManager.closeAll();
      clearRegistry(); clearInvocations();
      fs.rmSync(firstFile, { force: true });
      fs.rmSync(secondFile, { force: true });
    }
  }, 30000);

  it("blocks an out-of-scope same-context tab even when its ID was listed while allowed", async () => {
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `tab-policy-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, '<!doctype html><html><head><title>Allowed Tab</title></head><body><h1>Allowed Tab</h1></body></html>');
    const manager = new BrowserSessionManager({
      launcher: { launch: (opts) => chromium.launch({ ...opts, executablePath }) },
      artifactRoot: root,
    });
    const browser = new BrowserService(manager);
    try {
      const allowedUrl = pathToFileURL(file).href;
      const created = await manager.create({
        allowedDomains: ["approved.example"],
        allowedSchemes: ["file:", "https:"],
        initialUrl: allowedUrl,
      });
      expect(created.status).toBe("ready");
      const session = manager.get(created.id)!;
      const originalPage = session.page;
      const popup = (await session.context.newPage()) as Page;
      await popup.goto(allowedUrl, { waitUntil: "domcontentloaded" });
      const listed = await browser.listTabs({ sessionId: created.id });
      const tabId = listed.tabs?.find((tab) => tab.url === allowedUrl && !tab.selected)?.id;
      expect(tabId).toBeTruthy();

      // The site can navigate its own popup after the list; its tab ID remains
      // valid, but cannot authorize a destination outside allowedDomains.
      await popup.route("https://outside.invalid/**", (route) => route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>Outside Domain</title><h1>Outside Domain</h1>",
      }));
      await popup.goto("https://outside.invalid/popup", { waitUntil: "domcontentloaded" });
      const denied = await browser.selectTab({ sessionId: created.id, tabId: tabId! });
      expect(denied).toMatchObject({ ok: false, error: { code: "navigation_blocked", retryable: false } });
      expect(session.page).toBe(originalPage);
      const observed = await browser.observe({ sessionId: created.id });
      expect(observed.ok).toBe(true);
      expect(observed.page.url).toBe(allowedUrl);
      expect(observed.observation?.snapshot).toContain('heading "Allowed Tab"');
    } finally {
      await manager.closeAll();
      fs.rmSync(file, { force: true });
    }
  }, 30000);

  it("rejects a pre-navigation native ref after a same-URL full-document navigation", async () => {
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `generation-fixture-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, `<!doctype html><html><head><title>Same Document Shape</title></head>
<body><button id="target">Go</button></body></html>`);
    const manager = new BrowserSessionManager({
      launcher: { launch: (opts) => chromium.launch({ ...opts, executablePath }) },
      artifactRoot: root,
    });
    const browser = new BrowserService(manager);
    const fileUrl = pathToFileURL(file).href;
    try {
      const created = await manager.create({ allowedDomains: [], allowedSchemes: ["file:"], initialUrl: fileUrl });
      expect(created.status).toBe("ready");
      const sessionId = created.id;
      const observed = await browser.observe({ sessionId });
      const oldRef = observed.observation?.snapshot?.match(/button "Go" \[ref=([^\]\s]+)\]/)?.[1];
      expect(oldRef).toBeTruthy();

      // Bypass BrowserService navigation so it still holds the old URL/hash.
      // Playwright itself must make the old aria-ref unusable in the new document.
      const page = manager.get(sessionId)!.page;
      await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
      expect(page.url()).toBe(observed.page.url);

      const stale = await browser.act({
        sessionId,
        pageUrl: observed.page.url,
        snapshotHash: observed.page.snapshotHash!,
        action: { kind: "click", ref: oldRef! },
      });
      expect(stale.ok).toBe(false);
      expect(stale.error?.code).toBe("stale_snapshot");

      const fresh = await browser.observe({ sessionId });
      const freshRef = fresh.observation?.snapshot?.match(/button "Go" \[ref=([^\]\s]+)\]/)?.[1];
      expect(freshRef).toBeTruthy();
      expect(freshRef).not.toBe(oldRef);
      expect(freshRef).toMatch(/^f\d+e\d+$/);
    } finally {
      await manager.closeAll();
      fs.rmSync(file, { force: true });
    }
  }, 30000);

  it("navigates, blocks out-of-scope URLs, waits on real conditions and rejects replaced refs", async () => {
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `wait-fixture-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, `<!doctype html><html><head><title>Managed Browser Wait</title></head>
<body><button id="replace">Confirm</button><div id="status">starting</div>
<script>setTimeout(function () { document.getElementById("status").textContent = "Loaded"; }, 150);</script>
</body></html>`);
    const manager = new BrowserSessionManager({
      launcher: { launch: (opts) => chromium.launch({ ...opts, executablePath }) },
      artifactRoot: root,
    });
    const browser = new BrowserService(manager);
    const fileUrl = pathToFileURL(file).href;
    const approve = (toolId: string, args: Record<string, unknown>) => ({ toolId, inputHash: createInvocationInputHash(args) });
    try {
      clearRegistry(); clearInvocations();
      const tools = createComputerUseBrowserTools(browser, { sessionManager: manager });
      for (const tool of tools) registerTool(tool);
      const threadId = `wait-${crypto.randomUUID()}`;

      const navArgs = { url: fileUrl };
      const nav = await executeInvocation({ toolId: "browser_navigate", threadId, args: navArgs, approvedInvocations: [approve("browser_navigate", navArgs)] });
      expect(nav.status).toBe("completed");
      expect(nav.result).toMatchObject({ ok: true, page: { url: fileUrl } });

      const textArgs = { condition: { kind: "text", value: "Loaded" }, timeoutMs: 5000 };
      const waited = await executeInvocation({ toolId: "browser_wait_for", threadId, args: textArgs, approvedInvocations: [approve("browser_wait_for", textArgs)] });
      expect(waited.status).toBe("completed");
      expect(waited.result).toMatchObject({ ok: true });

      const timeoutArgs = { condition: { kind: "text", value: "NeverAppears" }, timeoutMs: 200 };
      const timedOut = await executeInvocation({ toolId: "browser_wait_for", threadId, args: timeoutArgs, approvedInvocations: [approve("browser_wait_for", timeoutArgs)] });
      expect(timedOut.status).toBe("completed");
      expect(timedOut.result).toMatchObject({ ok: false, error: { code: "wait_timeout" } });

      const blockedArgs = { url: "https://example.com" };
      const blocked = await executeInvocation({ toolId: "browser_navigate", threadId, args: blockedArgs, approvedInvocations: [approve("browser_navigate", blockedArgs)] });
      expect(blocked.result).toMatchObject({ ok: false, error: { code: "navigation_blocked" } });

      const before = await executeInvocation({ toolId: "browser_snapshot", threadId, args: {} });
      const beforeResult = before.result as { page: { url: string; snapshotHash: string }; observation?: { snapshot?: string } };
      const ref = beforeResult.observation?.snapshot?.match(/button "Confirm" \[ref=(e\d+)\]/)?.[1]!;
      expect(ref).toBeTruthy();
      const sessionId = nav.args.sessionId as string;
      await manager.get(sessionId)!.page.evaluate(() => {
        const original = document.getElementById("replace")!;
        original.replaceWith(original.cloneNode(true));
      });
      const visibleArgs = { condition: { kind: "visible", ref, pageUrl: beforeResult.page.url, snapshotHash: beforeResult.page.snapshotHash }, timeoutMs: 500 };
      const replaced = await executeInvocation({ toolId: "browser_wait_for", threadId, args: visibleArgs, approvedInvocations: [approve("browser_wait_for", visibleArgs)] });
      expect(replaced.result).toMatchObject({ ok: false });
      expect(["stale_snapshot", "ref_not_found"]).toContain((replaced.result as { error?: { code?: string } }).error?.code);
    } finally {
      await manager.closeAll();
      clearRegistry(); clearInvocations();
      fs.rmSync(file, { force: true });
    }
  }, 30000);

  it("clicks an observed button and fills an input to an exact value, rejecting stale refs, invalid targets and absent approval", async () => {
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `click-fill-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, `<!doctype html><html><head><title>Click Fill Fixture</title></head>
<body>
  <button id="confirm" onclick="document.getElementById('status').textContent = 'Confirmed'">Confirm</button>
  <div id="status">idle</div>
  <label for="name">Recipient Name</label><input id="name" placeholder="Customer" value="Alice">
</body></html>`);
    const manager = new BrowserSessionManager({
      launcher: { launch: (opts) => chromium.launch({ ...opts, executablePath }) },
      artifactRoot: root,
    });
    const browser = new BrowserService(manager);
    const fileUrl = pathToFileURL(file).href;
    const approve = (toolId: string, args: Record<string, unknown>) => ({ toolId, inputHash: createInvocationInputHash(args) });
    try {
      clearRegistry(); clearInvocations();
      const tools = createComputerUseBrowserTools(browser, { sessionManager: manager });
      for (const tool of tools) registerTool(tool);
      const threadId = `click-fill-${crypto.randomUUID()}`;

      const bootArgs = { url: fileUrl };
      const boot = await executeInvocation({ toolId: "browser_navigate", threadId, args: bootArgs, approvedInvocations: [approve("browser_navigate", bootArgs)] });
      expect(boot.status).toBe("completed");
      const sessionId = boot.args.sessionId as string;
      const page = manager.get(sessionId)!.page;

      const snapshot = await executeInvocation({ toolId: "browser_snapshot", threadId, args: {} });
      const snapshotResult = snapshot.result as { page: { url: string; snapshotHash: string }; observation?: { snapshot?: string } };
      const buttonRef = snapshotResult.observation?.snapshot?.match(/button "Confirm" \[ref=(e\d+)\]/)?.[1]!;
      const inputRef = snapshotResult.observation?.snapshot?.match(/textbox "Recipient Name" \[ref=(e\d+)\]/)?.[1]!;
      expect(buttonRef).toBeTruthy();
      expect(inputRef).toBeTruthy();

      // Click requires approval and must not run before it is granted.
      const clickArgs = { pageUrl: snapshotResult.page.url, snapshotHash: snapshotResult.page.snapshotHash, ref: buttonRef };
      const clickPending = await executeInvocation({ toolId: "browser_click", threadId, args: clickArgs });
      expect(clickPending.status).toBe("awaiting_approval");
      expect(await page.evaluate(() => document.getElementById("status")!.textContent)).toBe("idle");
      const clicked = await executeInvocation({ toolId: "browser_click", threadId, args: clickArgs, approvedInvocations: [approve("browser_click", clickArgs)] });
      expect(clicked.status).toBe("completed");
      expect(clicked.result).toMatchObject({ ok: true });
      expect(await page.evaluate(() => document.getElementById("status")!.textContent)).toBe("Confirmed");

      // Fill replaces the exact value instead of appending to it.
      const afterClick = (await executeInvocation({ toolId: "browser_snapshot", threadId, args: {} })).result as { page: { url: string; snapshotHash: string }; observation?: { snapshot?: string } };
      const freshInputRef = afterClick.observation?.snapshot?.match(/textbox "Recipient Name" \[ref=(e\d+)\]/)?.[1]!;
      const fillArgs = { pageUrl: afterClick.page.url, snapshotHash: afterClick.page.snapshotHash, ref: freshInputRef, value: "Blueberry" };
      const fillPending = await executeInvocation({ toolId: "browser_fill", threadId, args: fillArgs });
      expect(fillPending.status).toBe("awaiting_approval");
      expect(await page.evaluate(() => (document.getElementById("name") as HTMLInputElement).value)).toBe("Alice");
      const filled = await executeInvocation({ toolId: "browser_fill", threadId, args: fillArgs, approvedInvocations: [approve("browser_fill", fillArgs)] });
      expect(filled.status).toBe("completed");
      expect(filled.result).toMatchObject({ ok: true });
      expect(await page.evaluate(() => (document.getElementById("name") as HTMLInputElement).value)).toBe("Blueberry");

      // A stale snapshot identity cannot be used to fill another element.
      const staleFillArgs = { pageUrl: afterClick.page.url, snapshotHash: "stale-hash", ref: freshInputRef, value: "Mallory" };
      const staleFill = await executeInvocation({ toolId: "browser_fill", threadId, args: staleFillArgs, approvedInvocations: [approve("browser_fill", staleFillArgs)] });
      expect(staleFill.result).toMatchObject({ ok: false, error: { code: "stale_snapshot" } });
      expect(await page.evaluate(() => (document.getElementById("name") as HTMLInputElement).value)).toBe("Blueberry");

      // An observed non-fillable target fails truthfully instead of being re-targeted.
      const current = (await executeInvocation({ toolId: "browser_snapshot", threadId, args: {} })).result as { page: { url: string; snapshotHash: string }; observation?: { snapshot?: string } };
      const currentButtonRef = current.observation?.snapshot?.match(/button "Confirm" \[ref=(e\d+)\]/)?.[1]!;
      const invalidArgs = { pageUrl: current.page.url, snapshotHash: current.page.snapshotHash, ref: currentButtonRef, value: "x" };
      const invalid = await executeInvocation({ toolId: "browser_fill", threadId, args: invalidArgs, approvedInvocations: [approve("browser_fill", invalidArgs)] });
      expect(invalid.result).toMatchObject({ ok: false, error: { code: "invalid_target" } });
    } finally {
      await manager.closeAll();
      clearRegistry(); clearInvocations();
      fs.rmSync(file, { force: true });
    }
  }, 30000);


  it("keeps a native ref bound to the same hidden node and invalidates it on navigation", async () => {
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `visibility-fixture-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, `<!doctype html><html><head><title>Managed Browser Visibility</title></head>
<body><button id="target">Continue</button></body></html>`);
    const manager = new BrowserSessionManager({
      launcher: { launch: (opts) => chromium.launch({ ...opts, executablePath }) },
      artifactRoot: root,
    });
    const browser = new BrowserService(manager);
    try {
      const created = await manager.create({ allowedDomains: [], allowedSchemes: ["file:"], initialUrl: pathToFileURL(file).href });
      expect(created.status).toBe("ready");
      const sessionId = created.id;
      const observed = await browser.observe({ sessionId });
      const ref = observed.observation?.snapshot?.match(/button "Continue" \[ref=(e\d+)\]/)?.[1];
      expect(ref).toBeTruthy();
      const page = manager.get(sessionId)!.page;

      await page.evaluate(() => { (document.getElementById("target") as HTMLElement).style.display = "none"; });
      setTimeout(() => { void page.evaluate(() => { (document.getElementById("target") as HTMLElement).style.display = "block"; }); }, 50);
      const reappeared = await browser.wait({
        sessionId,
        condition: { kind: "visible", ref: ref!, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash! },
        timeoutMs: 1000,
      });
      expect(reappeared.ok).toBe(true);

      const visibleObservation = await browser.observe({ sessionId });
      const visibleRef = visibleObservation.observation?.snapshot?.match(/button "Continue" \[ref=(e\d+)\]/)?.[1];
      expect(visibleRef).toBeTruthy();
      await page.evaluate(() => { (document.getElementById("target") as HTMLElement).style.visibility = "hidden"; });
      const hidden = await browser.wait({
        sessionId,
        condition: { kind: "visible", ref: visibleRef!, pageUrl: visibleObservation.page.url, snapshotHash: visibleObservation.page.snapshotHash! },
        timeoutMs: 100,
      });
      expect(hidden.ok).toBe(false);
      expect(hidden.error?.code).toBe("wait_timeout");

      await page.evaluate(() => {
        (document.getElementById("target") as HTMLElement).style.visibility = "visible";
        history.pushState({}, "", "#next");
      });
      const navigated = await browser.wait({
        sessionId,
        condition: { kind: "visible", ref: visibleRef!, pageUrl: visibleObservation.page.url, snapshotHash: visibleObservation.page.snapshotHash! },
        timeoutMs: 100,
      });
      expect(navigated.ok).toBe(false);
      expect(navigated.error?.code).toBe("stale_snapshot");
    } finally {
      await manager.closeAll();
      fs.rmSync(file, { force: true });
    }
  }, 30000);

  it("presses a key, selects a native option and scrolls the viewport while refusing an invalid select target", async () => {
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `press-select-scroll-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, `<!doctype html><html style="scroll-behavior: smooth"><head><title>Press Select Scroll Fixture</title></head>
<body style="height: 3000px">
  <label for="q">Search</label><input id="q" value="hello">
  <label for="shipping">Shipping</label>
  <select id="shipping"><option value="standard">Standard</option><option value="express">Express</option></select>
  <button id="not-select">Not Select</button>
  <div id="status">idle</div>
  <script>document.getElementById("q").addEventListener("keydown", function (event) { if (event.key === "Enter") { document.getElementById("status").textContent = "enter-pressed"; } });</script>
</body></html>`);
    const manager = new BrowserSessionManager({
      launcher: { launch: (opts) => chromium.launch({ ...opts, executablePath }) },
      artifactRoot: root,
    });
    const browser = new BrowserService(manager);
    const fileUrl = pathToFileURL(file).href;
    const approve = (toolId: string, args: Record<string, unknown>) => ({ toolId, inputHash: createInvocationInputHash(args) });
    const snapshotResult = async (threadId: string) => (await executeInvocation({ toolId: "browser_snapshot", threadId, args: {} })).result as { page: { url: string; snapshotHash: string }; observation?: { snapshot?: string } };
    try {
      clearRegistry(); clearInvocations();
      const tools = createComputerUseBrowserTools(browser, { sessionManager: manager });
      for (const tool of tools) registerTool(tool);
      const threadId = `press-select-scroll-${crypto.randomUUID()}`;

      const bootArgs = { url: fileUrl };
      const boot = await executeInvocation({ toolId: "browser_navigate", threadId, args: bootArgs, approvedInvocations: [approve("browser_navigate", bootArgs)] });
      expect(boot.status).toBe("completed");
      const sessionId = boot.args.sessionId as string;
      const page = manager.get(sessionId)!.page;

      const before = await snapshotResult(threadId);
      const inputRef = before.observation?.snapshot?.match(/textbox "Search"[^\n]*\[ref=([^\]]+)\]/)?.[1]!;
      expect(inputRef).toBeTruthy();

      // Press requires approval and only then delivers the key.
      const pressArgs = { pageUrl: before.page.url, snapshotHash: before.page.snapshotHash, ref: inputRef, key: "Enter" };
      const pressPending = await executeInvocation({ toolId: "browser_press_key", threadId, args: pressArgs });
      expect(pressPending.status).toBe("awaiting_approval");
      expect(await page.evaluate(() => document.getElementById("status")!.textContent)).toBe("idle");
      const pressed = await executeInvocation({ toolId: "browser_press_key", threadId, args: pressArgs, approvedInvocations: [approve("browser_press_key", pressArgs)] });
      expect(pressed.status).toBe("completed");
      expect(pressed.result).toMatchObject({ ok: true });
      expect(await page.evaluate(() => document.getElementById("status")!.textContent)).toBe("enter-pressed");

      // Select a real native option.
      const afterPress = await snapshotResult(threadId);
      const selectRef = afterPress.observation?.snapshot?.match(/combobox "Shipping"[^\n]*\[ref=([^\]]+)\]/)?.[1]!;
      expect(selectRef).toBeTruthy();
      const selectArgs = { pageUrl: afterPress.page.url, snapshotHash: afterPress.page.snapshotHash, ref: selectRef, value: "express" };
      const selectPending = await executeInvocation({ toolId: "browser_select_option", threadId, args: selectArgs });
      expect(selectPending.status).toBe("awaiting_approval");
      const selected = await executeInvocation({ toolId: "browser_select_option", threadId, args: selectArgs, approvedInvocations: [approve("browser_select_option", selectArgs)] });
      expect(selected.status).toBe("completed");
      expect(selected.result).toMatchObject({ ok: true });
      expect(await page.evaluate(() => (document.getElementById("shipping") as HTMLSelectElement).value)).toBe("express");

      // A non-select target fails explicitly instead of selecting something else.
      const afterSelect = await snapshotResult(threadId);
      const nonSelectRef = afterSelect.observation?.snapshot?.match(/button "Not Select"[^\n]*\[ref=([^\]]+)\]/)?.[1]!;
      expect(nonSelectRef).toBeTruthy();
      const invalidSelectArgs = { pageUrl: afterSelect.page.url, snapshotHash: afterSelect.page.snapshotHash, ref: nonSelectRef, value: "express" };
      const invalid = await executeInvocation({ toolId: "browser_select_option", threadId, args: invalidSelectArgs, approvedInvocations: [approve("browser_select_option", invalidSelectArgs)] });
      expect(invalid.result).toMatchObject({ ok: false, error: { code: "invalid_target" } });

      // Scroll moves the viewport by the requested offset.
      const beforeScroll = await snapshotResult(threadId);
      const scrollArgs = { pageUrl: beforeScroll.page.url, snapshotHash: beforeScroll.page.snapshotHash, x: 0, y: 800 };
      const scrollPending = await executeInvocation({ toolId: "browser_scroll", threadId, args: scrollArgs });
      expect(scrollPending.status).toBe("awaiting_approval");
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const scrolled = await executeInvocation({ toolId: "browser_scroll", threadId, args: scrollArgs, approvedInvocations: [approve("browser_scroll", scrollArgs)] });
      expect(scrolled.status).toBe("completed");
      expect(scrolled.result).toMatchObject({
        ok: true,
        scroll: { requested: { x: 0, y: 800 }, before: { x: 0, y: 0 }, moved: true },
      });
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      // At the document boundary, the Tool must report a truthful no-op rather
      // than returning an indistinguishable generic success.
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      const atBottom = await snapshotResult(threadId);
      const noOpArgs = { pageUrl: atBottom.page.url, snapshotHash: atBottom.page.snapshotHash, x: 0, y: 800 };
      const noOpPending = await executeInvocation({ toolId: "browser_scroll", threadId, args: noOpArgs });
      expect(noOpPending.status).toBe("awaiting_approval");
      const noOp = await executeInvocation({ toolId: "browser_scroll", threadId, args: noOpArgs, approvedInvocations: [approve("browser_scroll", noOpArgs)] });
      expect(noOp.status).toBe("completed");
      expect(noOp.result).toMatchObject({ ok: true, scroll: { requested: { x: 0, y: 800 }, moved: false } });
    } finally {
      await manager.closeAll();
      clearRegistry(); clearInvocations();
      fs.rmSync(file, { force: true });
    }
  }, 30000);

  it("resumes a Tool Lab Navigate approval on the original real Chromium session", async () => {
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `approval-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, `<!doctype html><html><head><title>Approved Destination</title></head>
<body><h1>Approved Destination</h1></body></html>`);
    const manager = new BrowserSessionManager({
      launcher: { launch: (opts) => chromium.launch({ ...opts, executablePath }) },
      artifactRoot: root,
    });
    const browser = new BrowserService(manager);
    const navArgs = { url: pathToFileURL(file).href };
    try {
      clearRegistry();
      clearHarnessInvocations();
      clearToolLabBrowserRuns();
      const tools = createComputerUseBrowserTools(browser, { sessionManager: manager });
      for (const tool of tools) registerTool(tool);

      const run = createToolLabBrowserRun({ userId: 7 });
      const step = acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 });
      const pending = await executeHarnessInvocation({
        toolId: "browser_navigate",
        args: navArgs,
        userId: 7,
        threadId: step.threadId,
      });
      step.release({ pendingApproval: pending.status === "awaiting_approval" });
      expect(pending.status).toBe("awaiting_approval");
      expect(pending.threadId).toBe(step.threadId);

      const approved = await resolveHarnessInvocationApproval({
        invocationId: pending.id,
        decision: "approved",
        toolId: "browser_navigate",
        args: navArgs,
        userId: 7,
      });
      expect(approved.originalInvocation.status).toBe("completed");
      expect(approved.originalInvocation.threadId).toBe(step.threadId);
      expect(approved.resumedInvocation?.status).toBe("completed");
      expect(approved.resumedInvocation?.threadId).toBe(step.threadId);
      const resumedResult = approved.resumedInvocation?.result as {
        ok?: boolean;
        sessionId?: string;
        page?: { url?: string };
      };
      expect(resumedResult).toMatchObject({
        ok: true,
        page: { url: navArgs.url },
      });
      expect(manager.get(resumedResult.sessionId!)).toBeTruthy();

      const snapshot = await executeHarnessInvocation({
        toolId: "browser_snapshot",
        args: {},
        userId: 7,
        threadId: step.threadId,
      });
      expect(snapshot.status).toBe("completed");
      expect(snapshot.result).toMatchObject({
        ok: true,
        sessionId: resumedResult.sessionId,
        page: { url: navArgs.url },
      });
      expect(
        (snapshot.result as { observation?: { snapshot?: string } }).observation
          ?.snapshot,
      ).toContain('heading "Approved Destination"');
    } finally {
      clearToolLabBrowserRuns();
      clearRegistry();
      clearHarnessInvocations();
      await manager.closeAll();
      fs.rmSync(file, { force: true });
    }
  }, 30000);

});
