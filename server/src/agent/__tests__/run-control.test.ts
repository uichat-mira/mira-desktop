import { afterEach, describe, expect, test } from "vitest";
import {
  cancelAgentRunExecution,
  clearAgentRunControls,
  finishAgentRunControl,
  getAgentRunSignal,
  isAgentRunCancellationRequested,
  startAgentRunControl,
  startAgentRunControlLease,
} from "../run-control";

describe("agent run control", () => {
  afterEach(() => {
    clearAgentRunControls();
  });

  test("exposes one shared AbortSignal for a durable run", () => {
    const signal = startAgentRunControl("run-1");

    expect(getAgentRunSignal("run-1")).toBe(signal);
    expect(isAgentRunCancellationRequested("run-1")).toBe(false);
    expect(cancelAgentRunExecution("run-1")).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(isAgentRunCancellationRequested("run-1")).toBe(true);
  });

  test("finishing a run removes its process-local control without changing durable state", () => {
    startAgentRunControl("run-1");
    finishAgentRunControl("run-1");

    expect(getAgentRunSignal("run-1")).toBeUndefined();
    expect(cancelAgentRunExecution("run-1")).toBe(false);
  });

  test("restarting control aborts the stale controller", () => {
    const stale = startAgentRunControl("run-1");
    const current = startAgentRunControl("run-1");

    expect(stale.aborted).toBe(true);
    expect(current.aborted).toBe(false);
    expect(getAgentRunSignal("run-1")).toBe(current);
  });

  test("a stale execution lease cannot observe or clear its replacement", () => {
    const stale = startAgentRunControlLease("run-1");
    const current = startAgentRunControlLease("run-1");

    expect(stale.signal.aborted).toBe(true);
    expect(
      isAgentRunCancellationRequested("run-1", stale.leaseId),
    ).toBe(true);
    expect(getAgentRunSignal("run-1", stale.leaseId)?.aborted).toBe(true);

    finishAgentRunControl("run-1", stale.leaseId);

    expect(getAgentRunSignal("run-1", current.leaseId)).toBe(current.signal);
    expect(cancelAgentRunExecution("run-1")).toBe(true);
    expect(current.signal.aborted).toBe(true);
  });
});
