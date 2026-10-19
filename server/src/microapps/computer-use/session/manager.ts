import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserRuntimeResolver } from "../browser/types.js";
import type { BrowserSessionConfig, BrowserSessionInfo, BrowserTab } from "../browser/types.js";
import type { PlaywrightBrowserLike, PlaywrightChromiumLauncherLike, PlaywrightContextLike, PlaywrightPageLike } from "../executor/types.js";
import { loadPlaywrightChromiumLauncher } from "../executor/playwright.js";

export type BrowserPage = PlaywrightPageLike & {
  title?: () => Promise<string>;
  selectOption?: (selector: string, value: string, options?: { timeout?: number }) => Promise<unknown>;
  press?: (selector: string, key: string, options?: { timeout?: number }) => Promise<unknown>;
  inputValue?: (selector: string) => Promise<string>;
};

export type ManagedBrowserSession = {
  info: BrowserSessionInfo;
  browser: PlaywrightBrowserLike;
  context: PlaywrightContextLike;
  page: BrowserPage;
  tabIds: Map<BrowserPage, string>;
  artifactRoot: string;
  lastUsedAt: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  activeOperations: number;
};

export type ManagedBrowserTabList = {
  tabs: BrowserTab[];
  truncated: boolean;
};

export type BrowserSessionManagerOptions = {
  runtime?: BrowserRuntimeResolver;
  launcher?: PlaywrightChromiumLauncherLike;
  artifactRoot?: string;
  now?: () => number;
};

const error = (code: string, message: string, retryable = false) => ({ code, message, retryable });
const DEFAULT_ALLOWED_SCHEMES = ["http:", "https:", "file:"];
const MAX_LISTED_TABS = 50;
const MAX_TAB_TITLE_CHARS = 256;
const MAX_TAB_URL_CHARS = 2048;

const isLocalFileUrl = (url: URL) =>
  url.protocol === "file:" &&
  (url.hostname === "" || url.hostname.toLowerCase() === "localhost");

export class BrowserActionTimeoutError extends Error {
  constructor(public readonly operation: Promise<unknown>) {
    super("Browser action timed out.");
    this.name = "BrowserActionTimeoutError";
  }
}

export class BrowserTabNotFoundError extends Error {
  constructor(public readonly tabId: string) {
    super(`Tab is not part of the current Managed Browser session or has been closed: ${tabId}`);
    this.name = "BrowserTabNotFoundError";
  }
}

export class BrowserTabPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserTabPolicyError";
  }
}

export class BrowserSessionManager {
  private readonly sessions = new Map<string, ManagedBrowserSession>();
  private readonly runtime?: BrowserRuntimeResolver;
  private readonly launcher?: PlaywrightChromiumLauncherLike;
  private readonly artifactRoot: string;
  private readonly now: () => number;

  constructor(options: BrowserSessionManagerOptions = {}) {
    this.runtime = options.runtime;
    this.launcher = options.launcher;
    const workspaceRoot = path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd();
    this.artifactRoot = path.resolve(options.artifactRoot ?? path.join(workspaceRoot, ".test-artifact", "computer-use", "browser"));
    this.now = options.now ?? Date.now;
  }

  async create(config: BrowserSessionConfig): Promise<BrowserSessionInfo> {
    const id = `browser-${crypto.randomUUID()}`;
    const info: BrowserSessionInfo = { id, status: "creating", config };
    const runtime = this.runtime?.resolveRuntime();
    if (runtime && runtime.status !== "ready") {
      info.status = "blocked";
      info.error = error("runtime_unavailable", runtime.reason);
      return info;
    }
    const executablePath = config.executablePath ?? (runtime?.status === "ready" ? runtime.runtime.executablePath : undefined);
    const sessionRoot = path.join(this.artifactRoot, id);
    fs.mkdirSync(sessionRoot, { recursive: true });
    let browser: PlaywrightBrowserLike | undefined;
    try {
      const launcher = this.launcher ?? (await loadPlaywrightChromiumLauncher());
      browser = await launcher.launch({ executablePath, headless: config.headless ?? true });
      const context = await browser.newContext();
      const page = (await context.newPage()) as BrowserPage;
      if (config.viewport) {
        const pageWithViewport = page as BrowserPage & { setViewportSize?: (size: { width: number; height: number }) => Promise<unknown> };
        await pageWithViewport.setViewportSize?.(config.viewport);
      }
      const session: ManagedBrowserSession = { info: { ...info, status: "ready" }, browser, context, page, tabIds: new Map(), artifactRoot: sessionRoot, lastUsedAt: this.now(), activeOperations: 0 };
      this.sessions.set(id, session);
      this.scheduleTimeout(session);
      if (config.initialUrl) {
        // Initial navigation is also active session work; the idle timer must
        // never close Chromium while the first page is still loading.
        this.beginOperation(session);
        try {
          await this.navigate(session, config.initialUrl);
        } finally {
          this.endOperation(session);
        }
      }
      return session.info;
    } catch (cause) {
      this.sessions.delete(id);
      await browser?.close().catch(() => undefined);
      info.status = "failed";
      info.error = error("session_create_failed", cause instanceof Error ? cause.message : String(cause), true);
      return info;
    }
  }

  get(sessionId: string) { return this.sessions.get(sessionId); }

  private sessionTabs(session: ManagedBrowserSession) {
    const pages = session.context.pages() as BrowserPage[];
    const current = new Set(pages);
    for (const page of session.tabIds.keys()) {
      if (!current.has(page)) session.tabIds.delete(page);
    }
    return pages.map((page) => {
      let id = session.tabIds.get(page);
      if (!id) {
        // Session-scoped random IDs keep a foreign session's tab ID from
        // matching a local tab even when both sessions use the same context.
        id = `tab-${crypto.randomUUID()}`;
        session.tabIds.set(page, id);
      }
      return { id, page };
    });
  }

  private async readTabTitle(page: BrowserPage) {
    try {
      return ((await page.title?.()) ?? "").slice(0, MAX_TAB_TITLE_CHARS);
    } catch {
      // A tab can close between pages() and title resolution; the tab list
      // still reports the remaining session-owned tabs truthfully.
      return "";
    }
  }

  async listTabs(session: ManagedBrowserSession): Promise<ManagedBrowserTabList> {
    const pages = this.sessionTabs(session);
    const truncated = pages.length > MAX_LISTED_TABS;
    const tabs = await Promise.all(
      pages.slice(0, MAX_LISTED_TABS).map(async ({ id, page }) => ({
        id,
        title: await this.readTabTitle(page),
        url: page.url().slice(0, MAX_TAB_URL_CHARS),
        selected: page === session.page,
      })),
    );
    return { tabs, truncated };
  }

  async selectTab(session: ManagedBrowserSession, tabId: string): Promise<BrowserPage> {
    const target = this.sessionTabs(session).find((tab) => tab.id === tabId);
    if (!target) throw new BrowserTabNotFoundError(tabId);
    const assertTargetAllowed = () => {
      try {
        this.assertAllowedUrl(session, target.page.url());
      } catch (cause) {
        throw new BrowserTabPolicyError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    // A popup is not permission to browse outside the session's existing URL policy.
    assertTargetAllowed();
    await target.page.bringToFront?.();
    if (!this.sessionTabs(session).some((tab) => tab.id === tabId && tab.page === target.page)) {
      throw new BrowserTabNotFoundError(tabId);
    }
    // Focusing is asynchronous; a page may close or navigate while it is pending.
    assertTargetAllowed();
    session.page = target.page;
    this.touch(session);
    return target.page;
  }

  private scheduleTimeout(session: ManagedBrowserSession) {
    const timeoutMs = session.info.config.sessionTimeoutMs;
    if (!timeoutMs || timeoutMs <= 0) return;
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
    session.timeoutHandle = setTimeout(() => {
      if (!this.sessions.has(session.info.id)) return;
      if (session.activeOperations > 0) {
        this.scheduleTimeout(session);
        return;
      }
      if (this.now() - session.lastUsedAt < timeoutMs) {
        this.scheduleTimeout(session);
        return;
      }
      void this.closeSession(session);
    }, timeoutMs);
  }

  touch(session: ManagedBrowserSession) {
    session.lastUsedAt = this.now();
    this.scheduleTimeout(session);
  }

  beginOperation(session: ManagedBrowserSession) {
    session.activeOperations += 1;
  }

  endOperation(session: ManagedBrowserSession) {
    if (session.activeOperations > 0) session.activeOperations -= 1;
    if (session.info.status !== "stopped") this.touch(session);
  }

  private async closeSession(session: ManagedBrowserSession) {
    if (session.info.status === "stopped") return;
    session.info.status = "stopped";
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    this.sessions.delete(session.info.id);
  }

  async stop(sessionId: string): Promise<BrowserSessionInfo | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    await this.closeSession(session);
    return session.info;
  }

  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
  }

  private assertAllowedUrl(session: ManagedBrowserSession, url: string) {
    const parsed = new URL(url);
    const schemes = session.info.config.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
    if (!schemes.includes(parsed.protocol)) throw new Error(`URL scheme is not allowed: ${parsed.protocol}`);

    if (parsed.protocol === "file:") {
      if (!isLocalFileUrl(parsed)) {
        throw new Error(`Remote file URL is not allowed: ${parsed.hostname}`);
      }
    } else {
      const domains = session.info.config.allowedDomains.map((domain) => domain.toLowerCase().replace(/^\.+/, ""));
      if (!domains.some((domain) => parsed.hostname.toLowerCase() === domain || parsed.hostname.toLowerCase().endsWith(`.${domain}`))) {
        throw new Error(`Navigation domain is not allowed: ${parsed.hostname}`);
      }
    }

  }

  async navigate(session: ManagedBrowserSession, url: string) {
    this.assertAllowedUrl(session, url);
    const operation = Promise.resolve().then(() => session.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: session.info.config.actionTimeoutMs,
    }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new BrowserActionTimeoutError(operation)), session.info.config.actionTimeoutMs ?? 30000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    this.touch(session);
  }
}
