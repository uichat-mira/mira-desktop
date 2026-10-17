import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserActInput, BrowserArtifact, BrowserAssertInput, BrowserAssertion, BrowserInspectInput, BrowserToolError, BrowserToolResult } from "./types.js";
import { BrowserActionTimeoutError } from "../session/manager.js";
import type { BrowserPage, BrowserSessionManager, ManagedBrowserSession } from "../session/manager.js";

const failure = (sessionId: string, invocationId: string, page: BrowserToolResult["page"], code: string, message: string, retryable = false, assertion?: BrowserToolResult["assertion"]): BrowserToolResult => ({ ok: false, sessionId, invocationId, page, artifacts: [], assertion, error: { code, message, retryable } });
const pageTitle = async (page: BrowserPage) => (await page.title?.()) ?? "";
const withTimeout = async <T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> => {
  const operationPromise = Promise.resolve().then(operation);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operationPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BrowserActionTimeoutError(operationPromise)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// Playwright handles are owned by the backend, not by the inspected document.
// Page attributes are only lookup hints: never authority for an action.
type SafeElementHandle = {
  evaluate<R, T = unknown>(fn: (node: Element, arg: T) => R, arg?: T): Promise<R>;
  click(options?: { timeout?: number }): Promise<unknown>;
  type(text: string, options?: { timeout?: number }): Promise<unknown>;
  selectOption(value: string, options?: { timeout?: number }): Promise<unknown>;
  press(key: string, options?: { timeout?: number }): Promise<unknown>;
  dispose(): Promise<void>;
};
type CollectionHandle = {
  evaluate<R>(fn: (value: { entries: unknown[]; visibleText: string }) => R): Promise<R>;
  getProperty(name: string): Promise<CollectionHandle>;
  getProperties(): Promise<Map<string, CollectionHandle>>;
  dispose(): Promise<void>;
};

const elementBindings = new WeakMap<ManagedBrowserSession, Map<string, SafeElementHandle>>();
const boundElement = (session: ManagedBrowserSession, ref: string) =>
  elementBindings.get(session)?.get(ref);

const observePage = async (session: ManagedBrowserSession, maxChars = 12000) => {
  const page = session.page as typeof session.page & {
    evaluateHandle?: (fn: () => unknown) => Promise<CollectionHandle>;
  };
  if (!page.evaluateHandle) {
    throw new Error("Managed Browser runtime lacks secure Playwright element handles.");
  }
  // Collect metadata and actual DOM node handles in one renderer execution.
  // Nothing is stored in a page-accessible global or trusted from the page.
  const collection = await page.evaluateHandle(() => {
    const entries: Array<{ node: Element; hint: string | null; role: string; name: string }> = [];
    for (const element of Array.from(document.querySelectorAll("body *"))) {
      if (entries.length >= 500) break;
      const tag = element.tagName.toLowerCase();
      if (!["a", "button", "input", "textarea", "select"].includes(tag) &&
          !/^h[1-6]$/.test(tag) && !element.hasAttribute("role")) continue;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || !rect.width || !rect.height) continue;
      const role = element.getAttribute("role") ??
        (tag === "a" ? "link" : tag === "input" ? (
          ["checkbox", "radio"].includes((element as HTMLInputElement).type)
            ? (element as HTMLInputElement).type : "textbox"
        ) : tag === "textarea" ? "textbox" : tag === "select" ? "combobox" : /^h[1-6]$/.test(tag) ? "heading" : tag);
      const form = element as HTMLInputElement;
      const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
      const name = (element.getAttribute("aria-label") || labelledBy ||
        form.labels?.item(0)?.textContent || element.getAttribute("alt") ||
        element.getAttribute("placeholder") || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
      entries.push({ node: element, hint: element.getAttribute("data-cu-ref"), role, name });
    }
    return {
      entries,
      visibleText: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 100000),
    };
  });
  const previous = elementBindings.get(session) ?? new Map<string, SafeElementHandle>();
  const next = new Map<string, SafeElementHandle>();
  const lines: string[] = [];
  let visibleText = "";
  let members: CollectionHandle | undefined;
  try {
    const data = await collection.evaluate(({ entries, visibleText }) => ({
      rows: entries.map((item) => ({ hint: (item as {hint: string | null}).hint, role: (item as {role: string}).role, name: (item as {name: string}).name })),
      visibleText,
    }));
    visibleText = data.visibleText;
    members = await collection.getProperty("entries");
    const nodes = await members.getProperties();
    for (let index = 0; index < data.rows.length; index++) {
      const rowHandle = nodes.get(String(index));
      if (!rowHandle) throw new Error("Playwright observation lost an element row.");
      const handle = await rowHandle.getProperty("node") as unknown as SafeElementHandle;
      await rowHandle.dispose().catch(() => undefined);
      const row = data.rows[index]!;
      const hint = row.hint;
      let ref: string | undefined;
      // Reuse a previous token only when the current node is literally the
      // same remote DOM object. A page can forge attributes but not JSHandles.
      if (hint && previous.has(hint) && !next.has(hint)) {
        const original = previous.get(hint)!;
        if (await handle.evaluate((node, prior) => node === (prior as unknown as Element), original).catch(() => false)) {
          ref = hint;
        }
      }
      if (!ref) ref = "e" + crypto.randomBytes(16).toString("hex");
      next.set(ref, handle);
      // This attribute is only an untrusted hint on the next observation.
      await handle.evaluate((node, id) => { node.setAttribute("data-cu-ref", id); }, ref);
      lines.push(row.role + ' "' + row.name.replace(/"/g, "'") + '" ref=' + ref);
    }
  } catch (cause) {
    for (const handle of next.values()) await handle.dispose().catch(() => undefined);
    throw cause;
  } finally {
    await members?.dispose().catch(() => undefined);
    await collection.dispose().catch(() => undefined);
  }
  elementBindings.set(session, next);
  session.refs.clear();
  for (const ref of next.keys()) session.refs.set(ref, "[data-cu-ref=" + JSON.stringify(ref) + "]");
  for (const handle of previous.values()) await handle.dispose().catch(() => undefined);
  const snapshot = lines.join("\n");
  const truncated = snapshot.length > maxChars || visibleText.length > maxChars;
  const fingerprint = crypto.createHash("sha256").update(snapshot).update("\0").update(visibleText).digest("hex");
  return { snapshot: snapshot.slice(0, maxChars), visibleText: visibleText.slice(0, maxChars), truncated, fingerprint };
};

const makeArtifact = async (session: ManagedBrowserSession, invocationId: string): Promise<BrowserArtifact> => {
  const target = path.join(session.artifactRoot, `${invocationId}.png`);
  await session.page.screenshot({ path: target, fullPage: true });
  return { id: invocationId, kind: "screenshot", title: "Browser screenshot", uri: target };
};

const state = async (session: ManagedBrowserSession, maxChars = 12000) => {
  const url = session.page.url();
  const title = await pageTitle(session.page);
  const observation = await observePage(session, maxChars);
  return { url, title, snapshotHash: observation.fingerprint, observation };
};

export class BrowserService {
  private readonly actionQueues = new Map<string, Promise<void>>();

  constructor(private readonly sessions: BrowserSessionManager) {}

  async observe(input: BrowserInspectInput): Promise<BrowserToolResult> {
    const invocationId = crypto.randomUUID();
    const session = this.sessions.get(input.sessionId);
    if (!session || session.info.status !== "ready") return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
    this.sessions.beginOperation(session);
    try {
      const current = await state(session, input.maxSnapshotChars ?? 12000);
      const artifacts = input.includeScreenshot ? [await makeArtifact(session, invocationId)] : [];
      return { ok: true, sessionId: input.sessionId, invocationId, page: { url: current.url, title: current.title, snapshotHash: current.snapshotHash }, observation: { snapshot: current.observation.snapshot, visibleText: input.includeVisibleText === false ? undefined : current.observation.visibleText, truncated: current.observation.truncated }, artifacts };
    } catch (cause) {
      return failure(input.sessionId, invocationId, { url: session.page.url(), title: "" }, "observe_failed", cause instanceof Error ? cause.message : String(cause), true);
    } finally {
      this.sessions.endOperation(session);
    }
  }

  async act(input: BrowserActInput): Promise<BrowserToolResult> {
    const invocationId = crypto.randomUUID();
    const session = this.sessions.get(input.sessionId);
    if (!session || (session.info.status !== "ready" && session.info.status !== "busy")) return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
    this.sessions.beginOperation(session);
    const previous = this.actionQueues.get(input.sessionId) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.catch(() => undefined).then(() => turn);
    this.actionQueues.set(input.sessionId, queued);
    await previous.catch(() => undefined);
    let pendingOperation: Promise<unknown> | undefined;
    try {
      if (session.info.status !== "ready") return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
      session.info.status = "busy";
      const actionTimeoutMs = session.info.config.actionTimeoutMs ?? 30000;
      const current = await state(session);
      if (current.url !== input.pageUrl || current.snapshotHash !== input.snapshotHash) return failure(input.sessionId, invocationId, { url: current.url, title: current.title, snapshotHash: current.snapshotHash }, "stale_snapshot", "The page or snapshot changed; observe again before acting.", true);
      const action = input.action;
      if (action.kind === "navigate") await this.sessions.navigate(session, action.url);
      else if (action.kind === "scroll") await withTimeout(() => session.page.evaluate(({ x, y }) => window.scrollBy(x ?? 0, y ?? 0), { x: action.x ?? 0, y: action.y ?? 0 }), actionTimeoutMs);
      else {
        const ref = "ref" in action ? action.ref : undefined;
        const target = ref ? boundElement(session, ref) : undefined;
        if (ref && !target) return failure(input.sessionId, invocationId,
          { url: current.url, title: current.title, snapshotHash: current.snapshotHash },
          "ref_not_found", "Snapshot ref is not available: " + ref, true);
        // Playwright ElementHandle operations always target the original
        // object. A clone cannot inherit the click even during a TOCTOU race.
        if (action.kind === "click") await withTimeout(() => target!.click({ timeout: actionTimeoutMs }), actionTimeoutMs);
        if (action.kind === "type") await withTimeout(() => target!.type(action.text, { timeout: actionTimeoutMs }), actionTimeoutMs);
        if (action.kind === "select") await withTimeout(() => target!.selectOption(action.value, { timeout: actionTimeoutMs }), actionTimeoutMs);
        if (action.kind === "press") await withTimeout(() => target!.press(action.key, { timeout: actionTimeoutMs }), actionTimeoutMs);
        if (action.kind === "wait") {
          const deadline = Date.now() + Math.min(action.timeoutMs ?? actionTimeoutMs, actionTimeoutMs);
          let matched = false;
          while (Date.now() < deadline) {
            const next = await state(session);
            const textMatch = !action.text || next.observation.visibleText.includes(action.text);
            const currentTarget = action.ref ? boundElement(session, action.ref) : undefined;
            const refMatch = !action.ref || Boolean(currentTarget && await currentTarget.evaluate((node) => node.isConnected).catch(() => false));
            if (textMatch && refMatch) { matched = true; break; }
            if (action.ref && !refMatch) return failure(input.sessionId, invocationId,
              { url: next.url, title: next.title, snapshotHash: next.snapshotHash },
              "stale_snapshot", "The observed element was replaced; take a fresh snapshot.", true);
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (!matched) throw new Error("Browser action timed out while waiting.");
        }
      }
      const next = await state(session);
      return { ok: true, sessionId: input.sessionId, invocationId, page: { url: next.url, title: next.title, snapshotHash: next.snapshotHash }, observation: { snapshot: next.observation.snapshot, visibleText: next.observation.visibleText, truncated: next.observation.truncated }, artifacts: [] };
    } catch (cause) {
      if (cause instanceof BrowserActionTimeoutError) pendingOperation = cause.operation;
      const message = cause instanceof Error ? cause.message : String(cause);
      const recovered = await state(session).catch(() => undefined);
      const detached = /element is not attached|element is detached|not connected|was detached|node is detached/i.test(message);
      return failure(input.sessionId, invocationId, recovered ? { url: recovered.url, title: recovered.title, snapshotHash: recovered.snapshotHash } : { url: session.page.url(), title: await pageTitle(session.page) }, detached ? "stale_snapshot" : message.includes("timed out") ? "action_timeout" : "action_failed", message, true);
    } finally {
      const finish = () => {
        if (session.info.status === "busy") session.info.status = "ready";
        this.sessions.endOperation(session);
        release();
        if (this.actionQueues.get(input.sessionId) === queued) this.actionQueues.delete(input.sessionId);
      };
      if (pendingOperation) void pendingOperation.catch(() => undefined).then(finish);
      else finish();
    }
  }

  async assert(input: BrowserAssertInput): Promise<BrowserToolResult> {
    const invocationId = crypto.randomUUID();
    const session = this.sessions.get(input.sessionId);
    if (!session || session.info.status !== "ready") return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
    this.sessions.beginOperation(session);
    try {
      const assertion = input.assertion;
      const priorRef = assertion.kind === "visible" || assertion.kind === "value"
        ? boundElement(session, assertion.ref) : undefined;
      const current = await state(session);
      if ((assertion.kind === "visible" || assertion.kind === "value") &&
          (!priorRef || !boundElement(session, assertion.ref))) {
        return failure(input.sessionId, invocationId,
          { url: current.url, title: current.title, snapshotHash: current.snapshotHash },
          "stale_snapshot", "The observed element ref is no longer valid; take a fresh snapshot.", true,
          { kind: assertion.kind, passed: false });
      }
      let passed = false;
      if (assertion.kind === "title") passed = current.title === assertion.expected;
      if (assertion.kind === "url") passed = current.url === assertion.expected;
      if (assertion.kind === "text") passed = current.observation.visibleText.includes(assertion.expected);
      if (assertion.kind === "visible") passed = Boolean(await boundElement(session, assertion.ref)?.evaluate((node) => node.isConnected && Boolean(node.getClientRects().length)).catch(() => false));
      if (assertion.kind === "value") passed = Boolean(await boundElement(session, assertion.ref)?.evaluate((node, expected) =>
        node.isConnected && (node as HTMLInputElement).value === expected, assertion.expected).catch(() => false));
      const result: BrowserToolResult = { ok: passed, sessionId: input.sessionId, invocationId, page: { url: current.url, title: current.title, snapshotHash: current.snapshotHash }, observation: { snapshot: current.observation.snapshot, visibleText: current.observation.visibleText, truncated: current.observation.truncated }, assertion: { kind: assertion.kind, passed }, artifacts: [] };
      if (!passed) result.error = { code: "assertion_failed", message: `Browser assertion failed: ${assertion.kind}.`, retryable: false } as BrowserToolError;
      return result;
    } finally {
      this.sessions.endOperation(session);
    }
  }
}
