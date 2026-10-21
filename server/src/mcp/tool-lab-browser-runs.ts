import crypto from "node:crypto";
import type { ToolInvocation } from "./core/definitions.js";
import { isComputerUseInvocation } from "./core/invocations.js";
import { mcpBadRequest, mcpNotFound } from "./core/errors.js";

export const TOOL_LAB_BROWSER_RUN_TTL_MS = 10 * 60 * 1000;
const TOOL_LAB_BROWSER_RUN_MAX_PER_USER = 4;
const TOOL_LAB_BROWSER_RUN_MAX_TOTAL = 64;
const HANDLE_PREFIX = "blrun_";
const THREAD_ID_PREFIX = "tool-lab-browser-run:";

export type ToolLabBrowserRun = {
  handle: string;
  expiresAt: string;
  activeStep: boolean;
};

type BrowserRunRecord = {
  handle: string;
  userId: number;
  threadId: string;
  expiresAt: number;
  activeStep: boolean;
  pendingApproval: boolean;
};

const browserRuns = new Map<string, BrowserRunRecord>();

const now = () => Date.now();

const sweepExpiredRuns = (at: number) => {
  for (const [handle, run] of browserRuns) {
    if (run.activeStep || run.expiresAt > at) continue;
    browserRuns.delete(handle);
  }
};

const toPublicRun = (run: BrowserRunRecord): ToolLabBrowserRun => ({
  handle: run.handle,
  expiresAt: new Date(run.expiresAt).toISOString(),
  activeStep: run.activeStep,
});

const requireOwnedRun = (input: { handle: string; userId: number }) => {
  const run = browserRuns.get(input.handle);
  // A missing, expired, reset, or foreign run is indistinguishable on purpose:
  // the handle is a capability, so its owner must not learn about other runs.
  if (!run || run.userId !== input.userId) {
    throw mcpNotFound("Browser Lab run was not found");
  }
  if (run.expiresAt <= now()) {
    if (!run.activeStep) browserRuns.delete(run.handle);
    throw mcpNotFound("Browser Lab run has expired");
  }
  return run;
};

export const isToolLabBrowserTool = (toolId: string) =>
  isComputerUseInvocation(toolId);

export const createToolLabBrowserRun = (input: {
  userId: number;
  ttlMs?: number;
}): ToolLabBrowserRun => {
  const at = now();
  sweepExpiredRuns(at);

  if (browserRuns.size >= TOOL_LAB_BROWSER_RUN_MAX_TOTAL) {
    throw mcpBadRequest(
      "Too many active Browser Lab runs. Reset an existing run and retry.",
    );
  }
  const runsForUser = [...browserRuns.values()].filter(
    (run) => run.userId === input.userId,
  ).length;
  if (runsForUser >= TOOL_LAB_BROWSER_RUN_MAX_PER_USER) {
    throw mcpBadRequest(
      "Too many active Browser Lab runs for this user. Reset an existing run and retry.",
    );
  }

  const runId = crypto.randomUUID();
  const ttlMs = input.ttlMs ?? TOOL_LAB_BROWSER_RUN_TTL_MS;
  const run: BrowserRunRecord = {
    handle: `${HANDLE_PREFIX}${crypto.randomBytes(32).toString("base64url")}`,
    userId: input.userId,
    // Each run owns a distinct namespace so two runs can never resolve to the
    // same Managed Browser thread even when the same user created both.
    threadId: `${THREAD_ID_PREFIX}${input.userId}:${runId}`,
    expiresAt: at + ttlMs,
    activeStep: false,
    pendingApproval: false,
  };
  browserRuns.set(run.handle, run);
  return toPublicRun(run);
};

export const getToolLabBrowserRun = (input: {
  handle: string;
  userId: number;
}): ToolLabBrowserRun => toPublicRun(requireOwnedRun(input));

export const resetToolLabBrowserRun = (input: {
  handle: string;
  userId: number;
}): { handle: string; reset: true } => {
  const run = requireOwnedRun(input);
  if (run.activeStep) {
    throw mcpBadRequest(
      "Browser Lab run has an active step and cannot be reset. Wait for it to finish.",
    );
  }
  browserRuns.delete(run.handle);
  return { handle: run.handle, reset: true };
};

const createRunStep = (run: BrowserRunRecord) => {
  run.activeStep = true;
  let released = false;
  return {
    threadId: run.threadId,
    release: (options?: { pendingApproval?: boolean }) => {
      if (released) return;
      released = true;
      run.activeStep = false;
      run.pendingApproval = options?.pendingApproval === true;
      if (browserRuns.get(run.handle) !== run || run.expiresAt <= now()) {
        browserRuns.delete(run.handle);
      }
    },
  };
};

export const acquireToolLabBrowserRunStep = (input: {
  handle: string;
  userId: number;
}): {
  threadId: string;
  release: (options?: { pendingApproval?: boolean }) => void;
} => {
  const run = requireOwnedRun(input);
  if (run.activeStep) {
    throw mcpBadRequest(
      "Browser Lab run already has an active step. Wait for it to finish before starting another.",
    );
  }
  if (run.pendingApproval) {
    throw mcpBadRequest(
      "Browser Lab run is awaiting approval for its previous step. Reset the run or wait for the approval to resolve before starting another.",
    );
  }
  return createRunStep(run);
};

const findRunByThreadId = (threadId: string) => {
  for (const run of browserRuns.values()) {
    if (run.threadId === threadId) return run;
  }
  return undefined;
};

export const beginToolLabBrowserApprovalResume = (input: {
  toolId: string;
  threadId?: string;
  userId?: number;
}): {
  threadId: string;
  release: (options?: { pendingApproval?: boolean }) => void;
} => {
  if (!isToolLabBrowserTool(input.toolId)) {
    throw mcpBadRequest(
      "Browser Lab approval context is only valid for Managed Browser tools",
    );
  }
  // The threadId comes from the server-side original invocation, never from a
  // client-supplied approval field; a missing binding is not recoverable.
  if (!input.threadId || typeof input.userId !== "number") {
    throw mcpBadRequest(
      "Browser Lab approval context is unavailable for this invocation",
    );
  }
  const run = findRunByThreadId(input.threadId);
  // Missing, reset, expired, and foreign runs are indistinguishable on purpose.
  if (!run || run.userId !== input.userId) {
    throw mcpNotFound("Browser Lab run was not found");
  }
  if (run.expiresAt <= now()) {
    browserRuns.delete(run.handle);
    throw mcpNotFound("Browser Lab run has expired");
  }
  if (run.activeStep) {
    throw mcpBadRequest(
      "Browser Lab run already has an active step. Wait for it to finish before resuming approval.",
    );
  }
  if (!run.pendingApproval) {
    throw mcpBadRequest(
      "Browser Lab run has no pending approval for this step",
    );
  }
  run.pendingApproval = false;
  return createRunStep(run);
};

export const settleToolLabBrowserApprovalRejection = (input: {
  threadId?: string;
  userId?: number;
}) => {
  // Rejection never executes a browser step, so it must not fail because the
  // run was reset or expired meanwhile; it only releases a still-live pending flag.
  if (!input.threadId || typeof input.userId !== "number") return;
  const run = findRunByThreadId(input.threadId);
  if (!run || run.userId !== input.userId) return;
  run.pendingApproval = false;
  if (run.expiresAt <= now() && !run.activeStep) {
    browserRuns.delete(run.handle);
  }
};

export const projectToolLabBrowserInvocation = (
  record: ToolInvocation,
): ToolInvocation => {
  // The internal namespace is created only by this module, so the prefix is a
  // trusted Lab marker even for persisted copies read back after retention.
  if (!record.threadId?.startsWith(THREAD_ID_PREFIX)) {
    return record;
  }
  const projected = { ...record };
  delete projected.threadId;
  return projected;
};

export const clearToolLabBrowserRuns = () => {
  browserRuns.clear();
};
