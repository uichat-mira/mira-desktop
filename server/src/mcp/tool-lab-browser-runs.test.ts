import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOOL_LAB_BROWSER_RUN_TTL_MS,
  acquireToolLabBrowserRunStep,
  beginToolLabBrowserApprovalResume,
  clearToolLabBrowserRuns,
  createToolLabBrowserRun,
  getToolLabBrowserRun,
  resetToolLabBrowserRun,
  settleToolLabBrowserApprovalRejection,
} from "./tool-lab-browser-runs.js";

describe("Tool Lab Browser runs", () => {
  beforeEach(() => {
    clearToolLabBrowserRuns();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T00:00:00.000Z"));
  });

  afterEach(() => {
    clearToolLabBrowserRuns();
    vi.useRealTimers();
  });

  it("creates opaque handles bound to the authenticated user and one run namespace", () => {
    const first = createToolLabBrowserRun({ userId: 7 });
    const second = createToolLabBrowserRun({ userId: 7 });

    expect(first.handle).toMatch(/^blrun_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toHaveProperty("threadId");
    expect(first.expiresAt).toBe(
      new Date(Date.now() + TOOL_LAB_BROWSER_RUN_TTL_MS).toISOString(),
    );
    expect(second.handle).not.toBe(first.handle);

    const firstStep = acquireToolLabBrowserRunStep({
      handle: first.handle,
      userId: 7,
    });
    const secondStep = acquireToolLabBrowserRunStep({
      handle: second.handle,
      userId: 7,
    });
    expect(firstStep.threadId).toMatch(/^tool-lab-browser-run:7:/);
    expect(secondStep.threadId).toMatch(/^tool-lab-browser-run:7:/);
    expect(firstStep.threadId).not.toBe(secondStep.threadId);
    firstStep.release();
    secondStep.release();
  });

  it("rejects foreign, expired, reset, and concurrently active run access", () => {
    const run = createToolLabBrowserRun({ userId: 7 });

    expect(() =>
      acquireToolLabBrowserRunStep({ handle: run.handle, userId: 8 }),
    ).toThrow(/not found/i);
    expect(() => getToolLabBrowserRun({ handle: run.handle, userId: 8 })).toThrow(
      /not found/i,
    );
    expect(() =>
      resetToolLabBrowserRun({ handle: run.handle, userId: 8 }),
    ).toThrow(/not found/i);

    const step = acquireToolLabBrowserRunStep({
      handle: run.handle,
      userId: 7,
    });
    expect(() =>
      acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 }),
    ).toThrow(/active step/i);
    step.release();
    acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 }).release();

    vi.advanceTimersByTime(TOOL_LAB_BROWSER_RUN_TTL_MS + 1);
    expect(() =>
      acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 }),
    ).toThrow(/expired/i);

    const resettable = createToolLabBrowserRun({ userId: 7 });
    expect(
      resetToolLabBrowserRun({ handle: resettable.handle, userId: 7 }),
    ).toEqual({ handle: resettable.handle, reset: true });
    expect(() =>
      acquireToolLabBrowserRunStep({
        handle: resettable.handle,
        userId: 7,
      }),
    ).toThrow(/not found/i);
  });

  it("keeps an active step exclusive with reset and expiry", () => {
    const run = createToolLabBrowserRun({ userId: 7 });
    const step = acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 });

    expect(() =>
      resetToolLabBrowserRun({ handle: run.handle, userId: 7 }),
    ).toThrow(/active step/i);
    vi.advanceTimersByTime(TOOL_LAB_BROWSER_RUN_TTL_MS + 1);
    expect(() => getToolLabBrowserRun({ handle: run.handle, userId: 7 })).toThrow(
      /expired/i,
    );
    expect(() =>
      acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 }),
    ).toThrow(/expired/i);

    step.release();
    expect(() => getToolLabBrowserRun({ handle: run.handle, userId: 7 })).toThrow(
      /not found/i,
    );
  });

  it("blocks new steps while approval is pending but still allows reset", () => {
    const run = createToolLabBrowserRun({ userId: 7 });
    const step = acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 });
    step.release({ pendingApproval: true });

    expect(() =>
      acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 }),
    ).toThrow(/awaiting approval/i);

    vi.advanceTimersByTime(TOOL_LAB_BROWSER_RUN_TTL_MS + 1);
    expect(() =>
      acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 }),
    ).toThrow(/expired/i);
    expect(() => getToolLabBrowserRun({ handle: run.handle, userId: 7 })).toThrow(
      /not found/i,
    );

    const resettable = createToolLabBrowserRun({ userId: 7 });
    const pendingStep = acquireToolLabBrowserRunStep({
      handle: resettable.handle,
      userId: 7,
    });
    pendingStep.release({ pendingApproval: true });
    expect(
      resetToolLabBrowserRun({ handle: resettable.handle, userId: 7 }),
    ).toEqual({ handle: resettable.handle, reset: true });
    expect(() =>
      acquireToolLabBrowserRunStep({ handle: resettable.handle, userId: 7 }),
    ).toThrow(/not found/i);
  });

  it("bounds concurrent runs per user", () => {
    for (let index = 0; index < 4; index += 1) {
      createToolLabBrowserRun({ userId: 7 });
    }

    expect(() => createToolLabBrowserRun({ userId: 7 })).toThrow(
      /too many active Browser Lab runs for this user/i,
    );
    expect(createToolLabBrowserRun({ userId: 8 }).handle).toMatch(/^blrun_/);
  });

  it("resumes only the pending approval of the same owned run", () => {
    const run = createToolLabBrowserRun({ userId: 7 });
    const pending = acquireToolLabBrowserRunStep({
      handle: run.handle,
      userId: 7,
    });
    pending.release({ pendingApproval: true });

    expect(() =>
      beginToolLabBrowserApprovalResume({
        toolId: "browser_navigate",
        threadId: pending.threadId,
        userId: 8,
      }),
    ).toThrow(/not found/i);
    expect(() =>
      beginToolLabBrowserApprovalResume({
        toolId: "glob",
        threadId: pending.threadId,
        userId: 7,
      }),
    ).toThrow(/Managed Browser tools/i);
    expect(() =>
      beginToolLabBrowserApprovalResume({
        toolId: "browser_navigate",
        threadId: "tool-lab-browser-run:7:other",
        userId: 7,
      }),
    ).toThrow(/not found/i);
    expect(() =>
      beginToolLabBrowserApprovalResume({
        toolId: "browser_navigate",
        userId: 7,
      }),
    ).toThrow(/context is unavailable/i);

    const resumed = beginToolLabBrowserApprovalResume({
      toolId: "browser_navigate",
      threadId: pending.threadId,
      userId: 7,
    });
    expect(resumed.threadId).toBe(pending.threadId);
    expect(() =>
      beginToolLabBrowserApprovalResume({
        toolId: "browser_navigate",
        threadId: pending.threadId,
        userId: 7,
      }),
    ).toThrow(/active step/i);
    expect(() =>
      acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 }),
    ).toThrow(/active step/i);
    resumed.release();
    expect(() =>
      beginToolLabBrowserApprovalResume({
        toolId: "browser_navigate",
        threadId: pending.threadId,
        userId: 7,
      }),
    ).toThrow(/no pending approval/i);

    const nextPending = acquireToolLabBrowserRunStep({
      handle: run.handle,
      userId: 7,
    });
    nextPending.release({ pendingApproval: true });
    expect(() =>
      beginToolLabBrowserApprovalResume({
        toolId: "browser_navigate",
        threadId: nextPending.threadId,
        userId: 7,
      }),
    ).not.toThrow();
  });

  it("fails closed when a pending approval outlives its run TTL or reset", () => {
    const expiring = createToolLabBrowserRun({ userId: 7 });
    const expiringStep = acquireToolLabBrowserRunStep({
      handle: expiring.handle,
      userId: 7,
    });
    expiringStep.release({ pendingApproval: true });
    vi.advanceTimersByTime(TOOL_LAB_BROWSER_RUN_TTL_MS + 1);
    expect(() =>
      beginToolLabBrowserApprovalResume({
        toolId: "browser_navigate",
        threadId: expiringStep.threadId,
        userId: 7,
      }),
    ).toThrow(/expired/i);

    const resettable = createToolLabBrowserRun({ userId: 7 });
    const pending = acquireToolLabBrowserRunStep({
      handle: resettable.handle,
      userId: 7,
    });
    pending.release({ pendingApproval: true });
    resetToolLabBrowserRun({ handle: resettable.handle, userId: 7 });
    expect(() =>
      beginToolLabBrowserApprovalResume({
        toolId: "browser_navigate",
        threadId: pending.threadId,
        userId: 7,
      }),
    ).toThrow(/not found/i);
  });

  it("settles a rejection without granting browser execution", () => {
    const run = createToolLabBrowserRun({ userId: 7 });
    const pending = acquireToolLabBrowserRunStep({
      handle: run.handle,
      userId: 7,
    });
    pending.release({ pendingApproval: true });

    settleToolLabBrowserApprovalRejection({
      threadId: pending.threadId,
      userId: 8,
    });
    const resume = beginToolLabBrowserApprovalResume({
      toolId: "browser_navigate",
      threadId: pending.threadId,
      userId: 7,
    });
    resume.release();

    const nextPending = acquireToolLabBrowserRunStep({
      handle: run.handle,
      userId: 7,
    });
    nextPending.release({ pendingApproval: true });
    settleToolLabBrowserApprovalRejection({
      threadId: nextPending.threadId,
      userId: 7,
    });
    acquireToolLabBrowserRunStep({ handle: run.handle, userId: 7 }).release();

    const reset = createToolLabBrowserRun({ userId: 7 });
    const resetPending = acquireToolLabBrowserRunStep({
      handle: reset.handle,
      userId: 7,
    });
    resetPending.release({ pendingApproval: true });
    resetToolLabBrowserRun({ handle: reset.handle, userId: 7 });
    expect(() =>
      settleToolLabBrowserApprovalRejection({
        threadId: resetPending.threadId,
        userId: 7,
      }),
    ).not.toThrow();
  });
});
