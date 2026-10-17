import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserService } from "../browser/service.js";
import { BrowserSessionManager } from "../session/manager.js";

const evidenceRoot = path.resolve(
  path.resolve(process.cwd(), ".."),
  ".test-artifact",
  "computer-use-acceptance",
  "server",
);

const createPage = () => {
  let url = "https://example.com/";
  let visibleText = "Example Domain";
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
          visibleText: visibleText,
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
    goto: vi.fn(async (nextUrl: string) => {
      url = nextUrl;
    }),
    click: vi.fn(async () => undefined),
    type: vi.fn(async (_selector: string, text: string) => {
      visibleText = text;
    }),
    selectOption: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    screenshot: vi.fn(async ({ path: target }: { path: string }) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "png");
    }),
    url: vi.fn(() => url),
    title: vi.fn(async () => "Example Domain"),
    evaluate: vi.fn(async () => ({
      snapshot: 'heading "Example Domain" ref=e1\nbutton "Go" ref=e2',
      visibleText,
      refs: [
        { ref: "e1", selector: '[data-cu-ref="e1"]' },
        { ref: "e2", selector: '[data-cu-ref="e2"]' },
      ],
    })),
  };
  return page;
};

const writeEvidence = (name: string, value: unknown) => {
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const target = path.join(evidenceRoot, name);
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
  return target;
};

describe("Computer Use T122 server acceptance", () => {
  const managers: BrowserSessionManager[] = [];

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.closeAll()));
  });

  it("returns an explicit runtime block when no browser exists", async () => {
    const manager = new BrowserSessionManager({
      runtime: {
        resolveRuntime: () => ({
          status: "not_installed",
          strategy: "download",
          inspectedCandidates: [],
          reason: "Managed Chromium is not installed.",
        }),
      },
      launcher: { launch: vi.fn() },
    });
    const session = await manager.create({ allowedDomains: ["example.com"] });
    expect(session.status).toBe("blocked");
    expect(session.error?.code).toBe("runtime_unavailable");
    writeEvidence("runtime-blocked.json", session);
  });

  it("completes session -> observe -> act -> assert with evidence", async () => {
    const page = createPage();
    const manager = new BrowserSessionManager({
      runtime: {
        resolveRuntime: () => ({
          status: "ready",
          strategy: "managed",
          runtime: {
            source: "managed",
            channel: "chromium",
            executablePath: "C:/managed/chrome.exe",
            version: "test",
            installedAt: new Date().toISOString(),
          },
          inspectedCandidates: [],
        }),
      },
      launcher: {
        launch: vi.fn(async () => ({
          newContext: vi.fn(async () => ({
            newPage: vi.fn(async () => page),
            close: vi.fn(async () => undefined),
          })),
          close: vi.fn(async () => undefined),
        })),
      },
      artifactRoot: path.join(evidenceRoot, "browser"),
    });
    managers.push(manager);
    const browser = new BrowserService(manager);
    const session = await manager.create({ allowedDomains: ["example.com"] });
    expect(session.status).toBe("ready");

    const observed = await browser.observe({
      sessionId: session.id,
      includeScreenshot: true,
      includeVisibleText: true,
    });
    expect(observed.ok).toBe(true);
    expect(observed.page.snapshotHash).toMatch(/^[a-f0-9]{64}$/);

    const acted = await browser.act({
      sessionId: session.id,
      pageUrl: observed.page.url,
      snapshotHash: observed.page.snapshotHash!,
      action: { kind: "click", ref: observed.observation?.snapshot?.match(/button "Go" ref=(e[0-9a-f]{32})/)?.[1]! },
    });
    expect(acted.ok).toBe(true);

    const asserted = await browser.assert({
      sessionId: session.id,
      assertion: { kind: "title", expected: "Example Domain" },
    });
    expect(asserted.ok).toBe(true);
    expect(asserted.assertion?.passed).toBe(true);

    writeEvidence("manual-debug-flow.json", {
      sessionId: session.id,
      observe: observed,
      act: acted,
      assert: asserted,
    });
  });

  it("keeps domain and stale-ref failures as explicit non-success results", async () => {
    const page = createPage();
    const manager = new BrowserSessionManager({
      runtime: { resolveRuntime: () => ({ status: "ready", strategy: "managed", runtime: { source: "managed", channel: "chromium", executablePath: "C:/chrome.exe", version: "test", installedAt: "now" }, inspectedCandidates: [] }) },
      launcher: { launch: vi.fn(async () => ({ newContext: vi.fn(async () => ({ newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) })), close: vi.fn(async () => undefined) })) },
    });
    managers.push(manager);
    const browser = new BrowserService(manager);
    const session = await manager.create({ allowedDomains: ["example.com"] });
    const observed = await browser.observe({ sessionId: session.id });
    const stale = await browser.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: "stale", action: { kind: "click", ref: observed.observation?.snapshot?.match(/button "Go" ref=(e[0-9a-f]{32})/)?.[1]! } });
    const boundary = await browser.act({ sessionId: session.id, pageUrl: observed.page.url, snapshotHash: observed.page.snapshotHash!, action: { kind: "navigate", url: "https://not-example.com/" } });
    expect(stale.error?.code).toBe("stale_snapshot");
    expect(boundary.error?.code).toBe("action_failed");
    writeEvidence("failure-terminals.json", { stale, boundary });
  });
});
