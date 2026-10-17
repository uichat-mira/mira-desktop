import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserRuntimeResolver } from "../browser/types.js";
import type { BrowserSessionConfig, BrowserSessionInfo } from "../browser/types.js";
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
  refs: Map<string, string>;
  artifactRoot: string;
  lastUsedAt: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  activeOperations: number;
};

export type BrowserSessionManagerOptions = {
  runtime?: BrowserRuntimeResolver;
  launcher?: PlaywrightChromiumLauncherLike;
  artifactRoot?: string;
  now?: () => number;
};

const error = (code: string, message: string, retryable = false) => ({ code, message, retryable });
const DEFAULT_ALLOWED_SCHEMES = ["http:", "https:", "file:"];

const isLocalFileUrl = (url: URL) =>
  url.protocol === "file:" &&
  (url.hostname === "" || url.hostname.toLowerCase() === "localhost");

export class BrowserActionTimeoutError extends Error {
  constructor(public readonly operation: Promise<unknown>) {
    super("Browser action timed out.");
    this.name = "BrowserActionTimeoutError";
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
      const session: ManagedBrowserSession = { info: { ...info, status: "ready" }, browser, context, page, refs: new Map(), artifactRoot: sessionRoot, lastUsedAt: this.now(), activeOperations: 0 };
      this.sessions.set(id, session);
      this.scheduleTimeout(session);
      if (config.initialUrl) {
        await this.navigate(session, config.initialUrl);
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

  async navigate(session: ManagedBrowserSession, url: string) {
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
