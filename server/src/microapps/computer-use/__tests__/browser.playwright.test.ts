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
      expect(observed.observation?.snapshot).toMatch(/textbox "Recipient Name" ref=e[0-9a-f]{32}/);
      expect(observed.observation?.snapshot).toMatch(/button "Confirm" ref=e[0-9a-f]{32}/);
      expect(observed.observation?.snapshot).toMatch(/link "Details"/);
      expect(observed.observation?.snapshot).toMatch(/combobox "Shipping"/);
      const ref = observed.observation?.snapshot?.match(/button "Confirm" ref=(e[0-9a-f]{32})/)?.[1]!;
      const url = observed.page.url;
      const snapshotHash = observed.page.snapshotHash!;
      const same = await browser.observe({ sessionId });
      expect(same.page.snapshotHash).toBe(snapshotHash);
      expect(same.observation?.snapshot).toContain(`ref=${ref}`);
      const current = manager.get(sessionId)!;
      // Force the precise race: state() captures the OLD element, then the page
      // replaces it before the saved Playwright ElementHandle clicks.
      // A selector-based implementation would click the clone instead.
      const racePage = current.page as typeof current.page & {
        evaluateHandle: (fn: () => unknown) => Promise<unknown>;
      };
      const originalEvaluateHandle = racePage.evaluateHandle.bind(racePage);
      let replaceAfterCapture = true;
      racePage.evaluateHandle = async (fn) => {
        const collection = await originalEvaluateHandle(fn);
        if (replaceAfterCapture) {
          replaceAfterCapture = false;
          await current.page.evaluate(() => {
            const old = document.getElementById("replace")!;
            const clone = old.cloneNode(true);
            clone.addEventListener("click", () => document.body.setAttribute("data-wrong-click", "yes"));
            old.replaceWith(clone);
          });
        }
        return collection;
      };
      const racingClick = await browser.act({ sessionId, pageUrl: url, snapshotHash, action: { kind: "click", ref } });
      racePage.evaluateHandle = originalEvaluateHandle;
      expect(racingClick.ok).toBe(false);
      expect(racingClick.error?.code).toBe("stale_snapshot");
      expect(await current.page.evaluate(() => document.body.hasAttribute("data-wrong-click"))).toBe(false);
      // A second replacement before an action must also be rejected.
      await current.page.evaluate(() => {
        const prior = document.getElementById("replace")!;
        const clone = prior.cloneNode(true);
        prior.replaceWith(clone);
      });
      const click = await browser.act({ sessionId, pageUrl: url, snapshotHash, action: { kind: "click", ref } });
      expect(click.ok).toBe(false);
      expect(click.error?.code).toBe("stale_snapshot");
      const visible = await browser.assert({ sessionId, assertion: { kind: "visible", ref } });
      expect(visible.ok).toBe(false);
      expect(visible.error?.code).toBe("stale_snapshot");
      const wait = await browser.act({ sessionId, pageUrl: url, snapshotHash, action: { kind: "wait", ref, timeoutMs: 10 } });
      expect(wait.ok).toBe(false);
      expect(wait.error?.code).toBe("stale_snapshot");
      const after = await browser.observe({ sessionId });
      expect(after.observation?.snapshot).not.toContain(`ref=${ref}`);
      // An identical input clone must not inherit the observed node identity.
      const inputRef = after.observation?.snapshot?.match(/textbox "Recipient Name" ref=(e[0-9a-f]{32})/)?.[1]!;
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
});
