import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { BrowserService } from "../browser/service.js";
import { BrowserSessionManager } from "../session/manager.js";
import { createComputerUseBrowserTools } from "../../../mcp/tools/browser-tools.tool.js";
import { clearRegistry, listToolDefinitions, registerTool } from "../../../mcp/core/registry.js";
import { clearInvocations, executeInvocation } from "../../../mcp/core/invocations.js";
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
      const boot = await executeInvocation({ toolId: "browser_observe", threadId, args: { url: pathToFileURL(file).href } });
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

});
