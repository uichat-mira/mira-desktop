import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BrowserSessionManager } from "../session/manager.js";
import type {
  PlaywrightBrowserLike,
  PlaywrightChromiumLauncherLike,
  PlaywrightContextLike,
  PlaywrightPageLike,
} from "../executor/types.js";

const artifactRoot = path.resolve(
  process.cwd(),
  ".test-artifact",
  "computer-use",
  "browser-file-url",
);

const createLauncher = (navigatedUrls: string[]): PlaywrightChromiumLauncherLike => {
  const page: PlaywrightPageLike = {
    async goto(url) {
      navigatedUrls.push(url);
    },
    async click() {},
    async fill() {},
    async type() {},
    async waitForSelector() {},
    async waitForLoadState() {},
    async evaluate() {
      return undefined as never;
    },
    async screenshot() {},
    url() {
      return navigatedUrls.at(-1) ?? "about:blank";
    },
  };

  const context: PlaywrightContextLike = {
    async newPage() {
      return page;
    },
    pages() {
      return [page];
    },
    async close() {},
  };

  const browser: PlaywrightBrowserLike = {
    async newContext() {
      return context;
    },
    async close() {},
  };

  return {
    async launch() {
      return browser;
    },
  };
};

afterEach(() => {
  fs.rmSync(artifactRoot, { recursive: true, force: true });
});

describe("BrowserSessionManager file URL navigation", () => {
  it("allows local file URLs by default", async () => {
    const navigatedUrls: string[] = [];
    const manager = new BrowserSessionManager({
      launcher: createLauncher(navigatedUrls),
      artifactRoot,
    });

    const initialUrl = "file:///C:/workspace/demo/index.html";
    const session = await manager.create({
      allowedDomains: [],
      initialUrl,
      headless: true,
    });

    expect(session.status).toBe("ready");
    expect(navigatedUrls).toEqual([initialUrl]);
    await manager.closeAll();
  });

  it("rejects remote file hosts", async () => {
    const navigatedUrls: string[] = [];
    const manager = new BrowserSessionManager({
      launcher: createLauncher(navigatedUrls),
      artifactRoot,
    });

    const session = await manager.create({
      allowedDomains: [],
      initialUrl: "file://remote-host/share/index.html",
      headless: true,
    });

    expect(session.status).toBe("failed");
    expect(session.error?.message).toContain("Remote file URL is not allowed");
    expect(navigatedUrls).toEqual([]);
    await manager.closeAll();
  });
});
