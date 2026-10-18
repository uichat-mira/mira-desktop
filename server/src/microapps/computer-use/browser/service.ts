import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserActInput, BrowserArtifact, BrowserAssertInput, BrowserAssertion, BrowserInspectInput, BrowserNavigateInput, BrowserToolError, BrowserToolResult, BrowserWaitInput } from "./types.js";
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

type LatestObservation = {
  pageUrl: string;
  snapshotHash: string;
  refs: Set<string>;
};

const latestObservations = new WeakMap<ManagedBrowserSession, LatestObservation>();

const refsFromSnapshot = (snapshot: string) => {
  const refs = new Set<string>();
  for (const match of snapshot.matchAll(/\[ref=([^\]\s]+)\]/g)) {
    if (match[1]) refs.add(match[1]);
  }
  return refs;
};

const readVisibleText = (page: BrowserPage) =>
  page.evaluate(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 100000));

const validateObservation = (
  session: ManagedBrowserSession,
  pageUrl: string,
  snapshotHash: string,
) => {
  const latest = latestObservations.get(session);
  if (!latest ||
      latest.pageUrl !== pageUrl ||
      latest.snapshotHash !== snapshotHash ||
      session.page.url() !== pageUrl) return undefined;
  return latest;
};

const refFailure = (message: string) =>
  /ref .*not found|not found .*snapshot|does not match any element|element is not attached|element is detached|not connected|was detached|node is detached/i.test(message);

// Playwright fill() only accepts input/textarea/contenteditable targets; a
// non-fillable observed element is an invalid target, not a generic runtime fault.
const invalidTargetFailure = (message: string) =>
  /not an? <input>|not an input|not a textarea|not editable|not fillable|cannot be filled|does not have a text|readonly|not a form control/i.test(message);

// selectOption() only accepts a native <select> with an existing option; a
// different control or an unknown option is an invalid target, not a runtime fault.
const invalidSelectFailure = (message: string) =>
  /not a <select>|not a select|did not find some options|no option|option .*not found/i.test(message);

const makeArtifact = async (session: ManagedBrowserSession, invocationId: string): Promise<BrowserArtifact> => {
  const target = path.join(session.artifactRoot, `${invocationId}.png`);
  await session.page.screenshot({ path: target, fullPage: true });
  return { id: invocationId, kind: "screenshot", title: "Browser screenshot", uri: target };
};

const state = async (session: ManagedBrowserSession, maxChars = 12000) => {
  const timeout = session.info.config.actionTimeoutMs ?? 30000;
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = session.page.url();
    const snapshot = await session.page.ariaSnapshot({ mode: "ai", timeout });
    const visibleText = await readVisibleText(session.page);
    const title = await pageTitle(session.page);
    if (session.page.url() !== url) continue;

    const snapshotHash = crypto.createHash("sha256")
      .update(snapshot)
      .update("\0")
      .update(visibleText)
      .digest("hex");
    latestObservations.set(session, {
      pageUrl: url,
      snapshotHash,
      refs: refsFromSnapshot(snapshot),
    });
    const truncated = snapshot.length > maxChars || visibleText.length > maxChars;
    return {
      url,
      title,
      snapshotHash,
      observation: {
        snapshot: snapshot.slice(0, maxChars),
        visibleText: visibleText.slice(0, maxChars),
        truncated,
      },
    };
  }

  // A navigation during capture also replaces Playwright's latest AI snapshot.
  // Never leave our observation fingerprint pointing at a different native ref map.
  latestObservations.delete(session);
  throw new Error("Managed Browser page changed while capturing the AI snapshot.");
};

export class BrowserService {
  private readonly actionQueues = new Map<string, Promise<void>>();
  // Playwright resolves aria refs against the latest AI snapshot in the frame.
  // Hold one session lock through observation and every ref consumer so another
  // observation cannot replace that native ref map during an action/assert/wait.
  private readonly operationQueues = new WeakMap<ManagedBrowserSession, Promise<void>>();

  constructor(private readonly sessions: BrowserSessionManager) {}

  private async acquireSessionOperation(session: ManagedBrowserSession): Promise<() => void> {
    const previous = this.operationQueues.get(session) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.catch(() => undefined).then(() => turn);
    this.operationQueues.set(session, queued);
    await previous.catch(() => undefined);
    return () => {
      release();
      if (this.operationQueues.get(session) === queued) this.operationQueues.delete(session);
    };
  }

  // Keep later actions queued behind a timed-out underlying Playwright
  // operation so a slow/aborted call cannot overlap the next one.
  private async acquireActionTurn(sessionId: string): Promise<() => void> {
    const previous = this.actionQueues.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.catch(() => undefined).then(() => turn);
    this.actionQueues.set(sessionId, queued);
    await previous.catch(() => undefined);
    return () => {
      release();
      if (this.actionQueues.get(sessionId) === queued) this.actionQueues.delete(sessionId);
    };
  }

  async observe(input: BrowserInspectInput): Promise<BrowserToolResult> {
    const invocationId = crypto.randomUUID();
    const session = this.sessions.get(input.sessionId);
    if (!session || session.info.status !== "ready") return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
    this.sessions.beginOperation(session);
    const releaseOperation = await this.acquireSessionOperation(session);
    try {
      const current = await state(session, input.maxSnapshotChars ?? 12000);
      const artifacts = input.includeScreenshot ? [await makeArtifact(session, invocationId)] : [];
      return { ok: true, sessionId: input.sessionId, invocationId, page: { url: current.url, title: current.title, snapshotHash: current.snapshotHash }, observation: { snapshot: current.observation.snapshot, visibleText: input.includeVisibleText === false ? undefined : current.observation.visibleText, truncated: current.observation.truncated }, artifacts };
    } catch (cause) {
      return failure(input.sessionId, invocationId, { url: session.page.url(), title: "" }, "observe_failed", cause instanceof Error ? cause.message : String(cause), true);
    } finally {
      releaseOperation();
      this.sessions.endOperation(session);
    }
  }

  async act(input: BrowserActInput): Promise<BrowserToolResult> {
    const invocationId = crypto.randomUUID();
    const session = this.sessions.get(input.sessionId);
    if (!session || (session.info.status !== "ready" && session.info.status !== "busy")) return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
    this.sessions.beginOperation(session);
    const releaseAction = await this.acquireActionTurn(input.sessionId);
    const releaseOperation = await this.acquireSessionOperation(session);
    let pendingOperation: Promise<unknown> | undefined;
    let validatedPage: BrowserToolResult["page"] | undefined;
    let scrollEvidence: BrowserToolResult["scroll"] | undefined;
    try {
      if (session.info.status !== "ready") return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
      session.info.status = "busy";
      const actionTimeoutMs = session.info.config.actionTimeoutMs ?? 30000;
      const latest = validateObservation(session, input.pageUrl, input.snapshotHash);
      const title = await pageTitle(session.page);
      validatedPage = {
        url: session.page.url(),
        title,
        snapshotHash: latestObservations.get(session)?.snapshotHash,
      };
      if (!latest) {
        return failure(input.sessionId, invocationId, validatedPage, "stale_snapshot", "The page or accepted observation changed; observe again before acting.", true);
      }

      const action = input.action;
      if (action.kind === "navigate") {
        await this.sessions.navigate(session, action.url);
      } else if (action.kind === "scroll") {
        const requested = { x: action.x ?? 0, y: action.y ?? 0 };
        const before = await withTimeout(
          () => session.page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
          actionTimeoutMs,
        );
        await withTimeout(
          () => session.page.evaluate(({ x, y }) => window.scrollBy(x, y), requested),
          actionTimeoutMs,
        );
        const after = await withTimeout(
          () => session.page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
          actionTimeoutMs,
        );
        scrollEvidence = {
          requested,
          before,
          after,
          moved: before.x !== after.x || before.y !== after.y,
        };
      } else if (action.kind === "wait") {
        const target = action.ref
          ? latest.refs.has(action.ref) ? session.page.getByRef(action.ref) : undefined
          : undefined;
        if (action.ref && !target) {
          return failure(input.sessionId, invocationId, validatedPage, "ref_not_found", "Snapshot ref is not available: " + action.ref, true);
        }
        const deadline = Date.now() + Math.min(action.timeoutMs ?? actionTimeoutMs, actionTimeoutMs);
        const withinDeadline = <T>(operation: () => Promise<T>) => {
          const remaining = deadline - Date.now();
          return remaining > 0
            ? withTimeout(operation, remaining)
            : Promise.reject(new BrowserActionTimeoutError(Promise.resolve()));
        };
        let matched = false;
        while (Date.now() < deadline) {
          if (session.page.url() !== input.pageUrl) {
            return failure(input.sessionId, invocationId, {
              url: session.page.url(), title: "", snapshotHash: latest.snapshotHash,
            }, "stale_snapshot", "The page changed while waiting; observe again.", true);
          }
          const textMatch = !action.text || (await withinDeadline(() => readVisibleText(session.page))).includes(action.text);
          const refCount = target ? await withinDeadline(() => target.count()) : 1;
          if (target && refCount === 0) {
            return failure(input.sessionId, invocationId, validatedPage, "stale_snapshot", "The observed element was replaced or detached; take a fresh snapshot.", true);
          }
          if (textMatch && refCount > 0) {
            matched = true;
            break;
          }
          const remaining = deadline - Date.now();
          if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)));
        }
        if (!matched) throw new Error("Browser action timed out while waiting.");
      } else {
        if (!latest.refs.has(action.ref)) {
          return failure(input.sessionId, invocationId, validatedPage, "ref_not_found", "Snapshot ref is not available: " + action.ref, true);
        }
        // Playwright 1.64 scopes AI refs to the current injected-document snapshot.
        // A new-document navigation re-numbers the frame ref prefix, so an old
        // ref cannot resolve into an identical replacement document.
        const target = session.page.getByRef(action.ref);
        if (await withTimeout(() => target.count(), actionTimeoutMs) === 0) {
          return failure(input.sessionId, invocationId, validatedPage, "stale_snapshot", "The observed element was replaced or detached; take a fresh snapshot.", true);
        }
        if (action.kind === "click") await withTimeout(() => target.click({ timeout: actionTimeoutMs }), actionTimeoutMs);
        if (action.kind === "fill") await withTimeout(() => target.fill(action.value, { timeout: actionTimeoutMs }), actionTimeoutMs);
        if (action.kind === "type") await withTimeout(() => target.type(action.text, { timeout: actionTimeoutMs }), actionTimeoutMs);
        if (action.kind === "select") await withTimeout(() => target.selectOption(action.value, { timeout: actionTimeoutMs }), actionTimeoutMs);
        if (action.kind === "press") await withTimeout(() => target.press(action.key, { timeout: actionTimeoutMs }), actionTimeoutMs);
      }

      const next = await state(session);
      return { ok: true, sessionId: input.sessionId, invocationId, page: { url: next.url, title: next.title, snapshotHash: next.snapshotHash }, observation: { snapshot: next.observation.snapshot, visibleText: next.observation.visibleText, truncated: next.observation.truncated }, ...(scrollEvidence ? { scroll: scrollEvidence } : {}), artifacts: [] };
    } catch (cause) {
      if (cause instanceof BrowserActionTimeoutError) pendingOperation = cause.operation;
      const message = cause instanceof Error ? cause.message : String(cause);
      const recovered = pendingOperation ? undefined : await state(session).catch(() => undefined);
      const errorPage = recovered ? { url: recovered.url, title: recovered.title, snapshotHash: recovered.snapshotHash }
        : validatedPage ?? { url: session.page.url(), title: "" };
      return failure(input.sessionId, invocationId, errorPage, refFailure(message) ? "stale_snapshot" : message.includes("timed out") ? "action_timeout" : input.action.kind === "fill" && invalidTargetFailure(message) ? "invalid_target" : input.action.kind === "select" && invalidSelectFailure(message) ? "invalid_target" : "action_failed", message, true);
    } finally {
      const finish = () => {
        if (session.info.status === "busy") session.info.status = "ready";
        releaseOperation();
        this.sessions.endOperation(session);
        releaseAction();
      };
      if (pendingOperation) void pendingOperation.catch(() => undefined).then(finish);
      else finish();
    }
  }

  async navigate(input: BrowserNavigateInput): Promise<BrowserToolResult> {
    const invocationId = crypto.randomUUID();
    const session = this.sessions.get(input.sessionId);
    if (!session || (session.info.status !== "ready" && session.info.status !== "busy")) return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
    this.sessions.beginOperation(session);
    const releaseAction = await this.acquireActionTurn(input.sessionId);
    const releaseOperation = await this.acquireSessionOperation(session);
    let pendingOperation: Promise<unknown> | undefined;
    try {
      if (session.info.status !== "ready") return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
      session.info.status = "busy";
      await this.sessions.navigate(session, input.url);
      const next = await state(session);
      return { ok: true, sessionId: input.sessionId, invocationId, page: { url: next.url, title: next.title, snapshotHash: next.snapshotHash }, observation: { snapshot: next.observation.snapshot, visibleText: next.observation.visibleText, truncated: next.observation.truncated }, artifacts: [] };
    } catch (cause) {
      if (cause instanceof BrowserActionTimeoutError) pendingOperation = cause.operation;
      const message = cause instanceof Error ? cause.message : String(cause);
      const recovered = pendingOperation ? undefined : await state(session).catch(() => undefined);
      // BrowserSessionManager rejects disallowed scheme/domain explicitly; do
      // not rewrite or silently widen the allowlist for the requested URL.
      const blocked = /not allowed|is not permitted|disallowed/i.test(message);
      const timeout = cause instanceof BrowserActionTimeoutError || /timed out/i.test(message);
      const errorPage = recovered ? { url: recovered.url, title: recovered.title, snapshotHash: recovered.snapshotHash }
        : { url: session.page.url(), title: "" };
      return failure(input.sessionId, invocationId, errorPage, timeout ? "action_timeout" : blocked ? "navigation_blocked" : "navigation_failed", message, true);
    } finally {
      const finish = () => {
        if (session.info.status === "busy") session.info.status = "ready";
        releaseOperation();
        this.sessions.endOperation(session);
        releaseAction();
      };
      if (pendingOperation) void pendingOperation.catch(() => undefined).then(finish);
      else finish();
    }
  }

  async wait(input: BrowserWaitInput): Promise<BrowserToolResult> {
    const invocationId = crypto.randomUUID();
    const session = this.sessions.get(input.sessionId);
    if (!session || (session.info.status !== "ready" && session.info.status !== "busy")) return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
    this.sessions.beginOperation(session);
    const releaseAction = await this.acquireActionTurn(input.sessionId);
    const releaseOperation = await this.acquireSessionOperation(session);
    let pendingOperation: Promise<unknown> | undefined;
    let lastObserved: Awaited<ReturnType<typeof state>> | undefined;
    try {
      if (session.info.status !== "ready") return failure(input.sessionId, invocationId, { url: "", title: "" }, "session_unavailable", "Browser session is not ready.", true);
      session.info.status = "busy";
      const actionTimeoutMs = session.info.config.actionTimeoutMs ?? 30000;
      const deadline = Date.now() + Math.min(input.timeoutMs ?? actionTimeoutMs, actionTimeoutMs);
      const withinDeadline = <T>(operation: () => Promise<T>): Promise<T> => {
        const remainingMs = deadline - Date.now();
        return remainingMs > 0
          ? withTimeout(operation, remainingMs)
          : Promise.reject(new BrowserActionTimeoutError(Promise.resolve()));
      };
      const resultPage = (): BrowserToolResult["page"] => lastObserved
        ? { url: lastObserved.url, title: lastObserved.title, snapshotHash: lastObserved.snapshotHash }
        : {
          url: session.page.url(),
          title: "",
          snapshotHash: latestObservations.get(session)?.snapshotHash,
        };
      const condition = input.condition;

      if (condition.kind === "visible") {
        const latest = validateObservation(session, condition.pageUrl, condition.snapshotHash);
        if (!latest) {
          return failure(input.sessionId, invocationId, resultPage(), "stale_snapshot", "The page or accepted observation changed; observe again before waiting on a ref.", true);
        }
        if (!latest.refs.has(condition.ref)) {
          return failure(input.sessionId, invocationId, resultPage(), "ref_not_found", "Snapshot ref is not available: " + condition.ref, true);
        }

        // Do not capture another AI snapshot while the target is hidden.
        // getByRef resolves against the accepted snapshot's original DOM node;
        // a detached/replaced node yields zero matches while the same hidden
        // node can become visible again without being rebound to a clone.
        const target = session.page.getByRef(condition.ref);
        while (Date.now() < deadline) {
          if (session.page.url() !== condition.pageUrl) {
            return failure(input.sessionId, invocationId, resultPage(), "stale_snapshot", "The page changed while waiting; observe again.", true);
          }
          const count = await withinDeadline(() => target.count());
          if (count === 0) {
            return failure(input.sessionId, invocationId, resultPage(), "stale_snapshot", "The observed element was replaced or detached; take a fresh snapshot.", true);
          }
          if (await withinDeadline(() => target.isVisible())) {
            const next = await withinDeadline(() => state(session));
            lastObserved = next;
            if (next.url !== condition.pageUrl) {
              return failure(input.sessionId, invocationId, resultPage(), "stale_snapshot", "The page changed while completing the wait; observe again.", true);
            }
            return {
              ok: true, sessionId: input.sessionId, invocationId,
              page: resultPage(),
              observation: { snapshot: next.observation.snapshot, visibleText: next.observation.visibleText, truncated: next.observation.truncated },
              artifacts: [],
            };
          }
          const remainingMs = deadline - Date.now();
          if (remainingMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(25, remainingMs)));
        }
        return failure(input.sessionId, invocationId, resultPage(), "wait_timeout", "Browser wait timed out before the condition became true.", true);
      }

      while (Date.now() < deadline) {
        const next = await withinDeadline(() => state(session));
        lastObserved = next;
        const matched = condition.kind === "text"
          ? next.observation.visibleText.includes(condition.value)
          : next.url === condition.value;
        if (matched) {
          return {
            ok: true, sessionId: input.sessionId, invocationId,
            page: resultPage(),
            observation: { snapshot: next.observation.snapshot, visibleText: next.observation.visibleText, truncated: next.observation.truncated },
            artifacts: [],
          };
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(25, remainingMs)));
      }
      return failure(input.sessionId, invocationId, resultPage(), "wait_timeout", "Browser wait timed out before the condition became true.", true);
    } catch (cause) {
      if (cause instanceof BrowserActionTimeoutError) pendingOperation = cause.operation;
      const message = pendingOperation
        ? "Browser wait timed out before the condition became true."
        : cause instanceof Error ? cause.message : String(cause);
      return failure(input.sessionId, invocationId, {
        url: lastObserved?.url ?? session.page.url(),
        title: lastObserved?.title ?? "",
        snapshotHash: lastObserved?.snapshotHash ?? latestObservations.get(session)?.snapshotHash,
      }, pendingOperation ? "wait_timeout" : refFailure(message) ? "stale_snapshot" : "wait_failed", message, true);
    } finally {
      const finish = () => {
        if (session.info.status === "busy") session.info.status = "ready";
        releaseOperation();
        this.sessions.endOperation(session);
        releaseAction();
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
    const releaseOperation = await this.acquireSessionOperation(session);
    try {
      const assertion = input.assertion;
      let passed = false;

      if (assertion.kind === "visible" || assertion.kind === "value") {
        const latest = latestObservations.get(session);
        const errorPage: BrowserToolResult["page"] = {
          url: session.page.url(),
          title: await pageTitle(session.page),
          snapshotHash: latest?.snapshotHash,
        };
        if (!latest || session.page.url() !== latest.pageUrl) {
          return failure(input.sessionId, invocationId, errorPage,
            "stale_snapshot", "The page changed since the last accepted observation; take a fresh snapshot.", true,
            { kind: assertion.kind, passed: false });
        }
        if (!latest.refs.has(assertion.ref)) {
          return failure(input.sessionId, invocationId, errorPage,
            "ref_not_found", "Snapshot ref is not available: " + assertion.ref, true,
            { kind: assertion.kind, passed: false });
        }
        const target = session.page.getByRef(assertion.ref);
        if (await target.count() === 0) {
          return failure(input.sessionId, invocationId, errorPage,
            "stale_snapshot", "The observed element was replaced or detached; take a fresh snapshot.", true,
            { kind: assertion.kind, passed: false });
        }
        if (assertion.kind === "visible") passed = await target.isVisible();
        else passed = (await target.inputValue().catch(() => undefined)) === assertion.expected;
      }

      const current = await state(session);
      if (assertion.kind === "title") passed = current.title === assertion.expected;
      if (assertion.kind === "url") passed = current.url === assertion.expected;
      if (assertion.kind === "text") passed = current.observation.visibleText.includes(assertion.expected);
      const result: BrowserToolResult = { ok: passed, sessionId: input.sessionId, invocationId, page: { url: current.url, title: current.title, snapshotHash: current.snapshotHash }, observation: { snapshot: current.observation.snapshot, visibleText: current.observation.visibleText, truncated: current.observation.truncated }, assertion: { kind: assertion.kind, passed }, artifacts: [] };
      if (!passed) result.error = { code: "assertion_failed", message: `Browser assertion failed: ${assertion.kind}.`, retryable: false } as BrowserToolError;
      return result;
    } finally {
      releaseOperation();
      this.sessions.endOperation(session);
    }
  }
}
