import { describe, expect, test, vi } from "vitest";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import {
  claimInvocationApproval,
  clearInvocations,
  executeInvocation,
  finalizeClaimedInvocationApproval,
  getInvocation,
  resolveInvocationApproval,
} from "../invocations.js";
import { clearRegistry, registerTool } from "../registry.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";

const args = { sessionId: "session-1", pageUrl: "https://example.com", snapshotHash: "hash-1", action: { kind: "click", ref: "e1" } };

describe("MCP approval resolution", () => {
  test("persists a rejected original invocation as cancelled", async () => {
    clearRegistry(); clearInvocations();
    registerTool(createComputerUseBrowserTools({ observe: vi.fn(), act: vi.fn(), assert: vi.fn() } as never).find((tool) => tool.definition.id === "browser_act")!);
    const pending = await executeInvocation({ toolId: "browser_act", args });
    expect(pending.status).toBe("awaiting_approval");
    const resolved = resolveInvocationApproval({ invocationId: pending.id, decision: "rejected", reason: "Unsafe action" });
    expect(resolved.status).toBe("cancelled");
    expect(getInvocation(pending.id)?.approval?.resolution?.decision).toBe("rejected");
    expect(getInvocation(pending.id)?.error?.failureCode).toBe("cancelled");
  });

  test("claims an approval exactly once before resumed execution", async () => {
    clearRegistry(); clearInvocations();
    registerTool(createComputerUseBrowserTools({ observe: vi.fn(), act: vi.fn(), assert: vi.fn() } as never).find((tool) => tool.definition.id === "browser_act")!);
    const pending = await executeInvocation({ toolId: "browser_act", args, userId: 7 });
    expect(pending.status).toBe("awaiting_approval");

    const claimed = claimInvocationApproval({
      invocationId: pending.id,
      userId: 7,
      reason: "Approved from Mira Mobile",
    });
    expect(claimed.status).toBe("running");
    expect(claimed.approval?.resolution?.decision).toBe("approved");

    expect(() =>
      claimInvocationApproval({
        invocationId: pending.id,
        userId: 7,
      }),
    ).toThrow("approval is no longer available");

    const finalized = finalizeClaimedInvocationApproval({
      invocationId: pending.id,
      resolutionInvocationId: "resumed-1",
      status: "completed",
    });
    expect(finalized.status).toBe("completed");
    expect(finalized.approval?.resolution?.resolutionInvocationId).toBe("resumed-1");
  });

  test("hides claimed approvals from a different user", async () => {
    clearRegistry(); clearInvocations();
    registerTool(createComputerUseBrowserTools({ observe: vi.fn(), act: vi.fn(), assert: vi.fn() } as never).find((tool) => tool.definition.id === "browser_act")!);
    const pending = await executeInvocation({ toolId: "browser_act", args, userId: 7 });

    expect(() =>
      claimInvocationApproval({
        invocationId: pending.id,
        userId: 99,
      }),
    ).toThrow("Invocation was not found");
    expect(getInvocation(pending.id)?.status).toBe("awaiting_approval");
  });

  test("links an approved original invocation to its resumed invocation", async () => {
    clearRegistry(); clearInvocations();
    registerTool(createComputerUseBrowserTools({ observe: vi.fn(), act: vi.fn(async () => ({ ok: true, sessionId: "session-1", invocationId: "act", page: { url: "https://example.com", title: "Example", snapshotHash: "hash-1" }, artifacts: [] })), assert: vi.fn() } as never).find((tool) => tool.definition.id === "browser_act")!);
    const pending = await executeInvocation({ toolId: "browser_act", args });
    const resumed = await executeInvocation({ toolId: "browser_act", args, approvedInvocations: [{ toolId: "browser_act", inputHash: createInvocationInputHash(args) }] });
    const resolved = resolveInvocationApproval({ invocationId: pending.id, decision: "approved", resolutionInvocationId: resumed.id });
    expect(resolved.status).toBe("completed");
    expect(getInvocation(pending.id)?.approval?.resolution?.resolutionInvocationId).toBe(resumed.id);
  });
});
