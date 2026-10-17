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

const observePage = async (session: ManagedBrowserSession, maxChars = 12000) => {
  const result = await session.page.evaluate(() => {
    // The WeakMap binds each ref to its actual DOM node, not its position in the
    // snapshot. Replacing e.g. the third button cannot inherit that button's ref.
    // The opaque random ID also prevents ref reuse after a full page navigation.
    const holder = window as typeof window & { __miraComputerUseRefs?: WeakMap<Element, string> };
    if (!holder.__miraComputerUseRefs) {
      Object.defineProperty(holder, "__miraComputerUseRefs", {
        value: new WeakMap<Element, string>(), configurable: false,
      });
    }
    const identities = holder.__miraComputerUseRefs!;
    const elements = Array.from(document.querySelectorAll("body *"));
    const refs: Array<{ ref: string; selector: string; line: string }> = [];
    for (const element of elements) {
      if (refs.length >= 500) break;
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role") ??
        (tag === "a" ? "link" : tag === "input" ? (
          ["checkbox", "radio"].includes((element as HTMLInputElement).type)
            ? (element as HTMLInputElement).type : "textbox"
        ) : tag === "textarea" ? "textbox" : tag === "select" ? "combobox" : /^h[1-6]$/.test(tag) ? "heading" : tag);
      if (!["a", "button", "input", "textarea", "select"].includes(tag) &&
          !/^h[1-6]$/.test(tag) && !element.hasAttribute("role")) continue;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || !rect.width || !rect.height) continue;

      let ref = identities.get(element);
      if (!ref) {
        const bytes = window.crypto.getRandomValues(new Uint8Array(16));
        ref = "e" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        identities.set(element, ref);
      }
      // A cloned element may copy the old attribute, but never the WeakMap identity.
      element.setAttribute("data-cu-ref", ref);
      const form = element as HTMLInputElement;
      const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
      const name = (element.getAttribute("aria-label") || labelledBy ||
        form.labels?.item(0)?.textContent || element.getAttribute("alt") ||
        element.getAttribute("placeholder") || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
      refs.push({ ref, selector: `[data-cu-ref="${ref}"]`, line: `${role} "${name.replace(/"/g, "'")}" ref=${ref}` });
    }
    return {
      snapshot: refs.map((entry) => entry.line).join("\n"),
      visibleText: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 100000),
      refs,
    };
  });
  session.refs.clear();
  for (const ref of result.refs) session.refs.set(ref.ref, ref.selector);
  const truncated = result.snapshot.length > maxChars || result.visibleText.length > maxChars;
  // Hash the full bounded observation, not only its presentation-truncated preview.
  // DOM-node identities change the hash even when replacement text is identical.
  const fingerprint = crypto.createHash("sha256")
    .update(result.snapshot).update("\0").update(result.visibleText).digest("hex");
  return { snapshot: result.snapshot.slice(0, maxChars), visibleText: result.visibleText.slice(0, maxChars), truncated, fingerprint };
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
        const selector = action.kind === "wait" ? (action.ref ? session.refs.get(action.ref) : undefined) : session.refs.get(action.ref);
        if (action.kind !== "wait" && !selector) return failure(input.sessionId, invocationId, { url: current.url, title: current.title, snapshotHash: current.snapshotHash }, "ref_not_found", `Snapshot ref is not available: ${action.ref}`, true);
        if (action.kind === "wait" && action.ref && !selector) return failure(input.sessionId, invocationId, { url: current.url, title: current.title, snapshotHash: current.snapshotHash }, "ref_not_found", `Snapshot ref is not available: ${action.ref}`, true);
        const target = selector as string;
        if (action.kind === "click") await withTimeout(() => session.page.click(target, { timeout: actionTimeoutMs }), actionTimeoutMs);
        if (action.kind === "type") await withTimeout(() => session.page.type(target, action.text, { timeout: actionTimeoutMs }), actionTimeoutMs);
        if (action.kind === "select") await withTimeout(async () => { await session.page.selectOption?.(target, action.value, { timeout: actionTimeoutMs }); }, actionTimeoutMs);
        if (action.kind === "press") await withTimeout(async () => { await session.page.press?.(target, action.key, { timeout: actionTimeoutMs }); }, actionTimeoutMs);
        if (action.kind === "wait") {
          const deadline = Date.now() + Math.min(action.timeoutMs ?? actionTimeoutMs, actionTimeoutMs);
          let matched = false;
          while (Date.now() < deadline) {
            const next = await state(session);
            const textMatch = !action.text || next.observation.visibleText.includes(action.text);
            const refMatch = !action.ref || session.refs.has(action.ref);
            if (textMatch && refMatch) { matched = true; break; }
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
      return failure(input.sessionId, invocationId, recovered ? { url: recovered.url, title: recovered.title, snapshotHash: recovered.snapshotHash } : { url: session.page.url(), title: await pageTitle(session.page) }, message.includes("timed out") ? "action_timeout" : "action_failed", message, true);
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
        ? session.refs.get(assertion.ref) : undefined;
      const current = await state(session);
      if ((assertion.kind === "visible" || assertion.kind === "value") &&
          (!priorRef || session.refs.get(assertion.ref) !== priorRef)) {
        return failure(input.sessionId, invocationId,
          { url: current.url, title: current.title, snapshotHash: current.snapshotHash },
          "stale_snapshot", "The observed element ref is no longer valid; take a fresh snapshot.", true,
          { kind: assertion.kind, passed: false });
      }
      let passed = false;
      if (assertion.kind === "title") passed = current.title === assertion.expected;
      if (assertion.kind === "url") passed = current.url === assertion.expected;
      if (assertion.kind === "text") passed = current.observation.visibleText.includes(assertion.expected);
      if (assertion.kind === "visible") passed = session.refs.has(assertion.ref);
      if (assertion.kind === "value") {
        const selector = session.refs.get(assertion.ref);
        passed = Boolean(selector && session.page.inputValue && (await session.page.inputValue(selector)) === assertion.expected);
      }
      const result: BrowserToolResult = { ok: passed, sessionId: input.sessionId, invocationId, page: { url: current.url, title: current.title, snapshotHash: current.snapshotHash }, observation: { snapshot: current.observation.snapshot, visibleText: current.observation.visibleText, truncated: current.observation.truncated }, assertion: { kind: assertion.kind, passed }, artifacts: [] };
      if (!passed) result.error = { code: "assertion_failed", message: `Browser assertion failed: ${assertion.kind}.`, retryable: false } as BrowserToolError;
      return result;
    } finally {
      this.sessions.endOperation(session);
    }
  }
}
