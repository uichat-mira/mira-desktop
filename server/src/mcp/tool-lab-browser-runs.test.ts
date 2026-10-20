import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOOL_LAB_BROWSER_RUN_TTL_MS,
  acquireToolLabBrowserRunStep,
  clearToolLabBrowserRuns,
  createToolLabBrowserRun,
  getToolLabBrowserRun,
  resetToolLabBrowserRun,
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
});
