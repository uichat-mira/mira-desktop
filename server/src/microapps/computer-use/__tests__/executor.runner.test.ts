import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPlaywrightChromiumLauncher } from "../executor/playwright.js";
import { runComputerUseActions } from "../executor/runner.js";
import type {
  PlaywrightBrowserLike,
  PlaywrightChromiumLauncherLike,
  PlaywrightContextLike,
  PlaywrightPageLike,
} from "../executor/types.js";

const artifactRoot = path.join(
  process.cwd(),
  ".test-artifact",
  "computer-use",
  "executor-tests",
);

afterEach(() => {
  fs.rmSync(artifactRoot, { recursive: true, force: true });
});

const createLauncher = () => {
  let currentUrl = "about:blank";
  const pageCalls: string[] = [];

  const page: PlaywrightPageLike = {
    goto: vi.fn(async (url) => {
      currentUrl = url;
      pageCalls.push(`goto:${url}`);
    }),
    click: vi.fn(async (selector) => {
      pageCalls.push(`click:${selector}`);
    }),
    fill: vi.fn(async (selector, value) => {
      pageCalls.push(`fill:${selector}:${value}`);
    }),
    type: vi.fn(async (selector, value, options) => {
      pageCalls.push(`type:${selector}:${value}:${options?.delay ?? 0}`);
    }),
    waitForSelector: vi.fn(async (selector) => {
      pageCalls.push(`waitForSelector:${selector}`);
    }),
    waitForLoadState: vi.fn(async (state) => {
      pageCalls.push(`waitForLoadState:${state ?? "load"}`);
    }),
    evaluate: vi.fn(async (_fn, arg) => {
      const payload = arg as { x?: number; y?: number };
      pageCalls.push(`scroll:${payload.x ?? 0}:${payload.y ?? 0}`);
      return undefined;
    }),
    screenshot: vi.fn(async ({ path: targetPath }) => {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, "image");
    }),
    url: vi.fn(() => currentUrl),
  };

  const context: PlaywrightContextLike = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };

  const browser: PlaywrightBrowserLike = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };

  const launcher: PlaywrightChromiumLauncherLike = {
    launch: vi.fn(async () => browser),
  };

  return {
    launcher,
    pageCalls,
  };
};

describe("runComputerUseActions", () => {
  it("exposes a repo-local Playwright launcher binding", async () => {
    const launcher = await loadPlaywrightChromiumLauncher();

    expect(launcher).toBeTruthy();
    expect(typeof launcher.launch).toBe("function");
  });

  it("orchestrates the first-phase minimal action set and writes captures into .test-artifact/computer-use", async () => {
    const { launcher, pageCalls } = createLauncher();

    const result = await runComputerUseActions(
      [
        { kind: "navigate", url: "https://example.com", waitUntil: "load" },
        { kind: "click", selector: "#start" },
        { kind: "type", selector: "#query", text: "hello", delayMs: 75 },
        { kind: "scroll", y: 480 },
        { kind: "wait_for", selector: "#done", timeoutMs: 500 },
        { kind: "capture", artifactPath: "session-1/final.png" },
        { kind: "finish", summary: "done" },
      ],
      {
        launcher,
        artifactRoot,
        executablePath: "C:\\managed\\chrome.exe",
        headless: true,
      },
    );

    expect(pageCalls).toEqual([
      "goto:https://example.com",
      "click:#start",
      "type:#query:hello:75",
      "scroll:0:480",
      "waitForSelector:#done",
    ]);
    expect(result.finalUrl).toBe("https://example.com");
    expect(result.finishSummary).toBe("done");
    expect(result.captures).toHaveLength(1);
    expect(result.captures[0]).toContain(
      path.join(".test-artifact", "computer-use", "executor-tests", "session-1"),
    );
    expect(fs.existsSync(result.captures[0]!)).toBe(true);
  });

  // "..\\" is only a traversal on Windows; on POSIX it is a literal filename
  // that legitimately resolves inside the artifact root, so it is asserted
  // only where it actually escapes.
  it.each(["../outside.png", "/etc/passwd"])(
    "blocks capture paths that escape the configured artifact root: %s",
    async (artifactPath) => {
      const { launcher } = createLauncher();

      await expect(
        runComputerUseActions(
          [{ kind: "capture", artifactPath }],
          { launcher, artifactRoot },
        ),
      ).rejects.toThrow(/artifactRoot/);
    },
  );

  it("blocks windows-style traversal on Windows hosts", async () => {
    if (process.platform !== "win32") return;
    const { launcher } = createLauncher();

    await expect(
      runComputerUseActions(
        [{ kind: "capture", artifactPath: "..\\outside.png" }],
        { launcher, artifactRoot },
      ),
    ).rejects.toThrow(/artifactRoot/);
  });
});
