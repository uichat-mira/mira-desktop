import { beforeEach, describe, expect, test, vi } from "vitest";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getInvocation: vi.fn(),
  resolveExposure: vi.fn(),
  initialize: vi.fn(),
  eligibleExternal: vi.fn(() => []),
  resolveApproval: vi.fn(),
  claimApproval: vi.fn(),
  finalizeApproval: vi.fn(),
  llmText: vi.fn(() => "bounded result"),
}));

vi.mock("@/harness/invocations.js", () => ({
  executeHarnessInvocation: mocks.execute,
  getHarnessInvocation: mocks.getInvocation,
}));

vi.mock("@/harness/exposure.js", () => ({
  resolveHarnessToolExposure: mocks.resolveExposure,
}));

vi.mock("@/mcp/bootstrap.js", () => ({
  initializeHarnessRuntime: mocks.initialize,
}));

vi.mock("@/mcp/external.js", () => ({
  resolveAgentEligibleExternalMcpCapabilities: mocks.eligibleExternal,
}));

vi.mock("@/mcp/core/invocations.js", () => ({
  resolveInvocationApproval: mocks.resolveApproval,
  claimInvocationApproval: mocks.claimApproval,
  finalizeClaimedInvocationApproval: mocks.finalizeApproval,
}));

vi.mock("@/harness/llm-content.js", () => ({
  getHarnessLlmContentText: mocks.llmText,
}));

import {
  listRemoteToolManifests,
  resolveRemoteToolApproval,
} from "./remote-tool-gateway.service.js";

const terminalDefinition = {
  id: "terminal_session",
  title: "Terminal",
  description: "Run a command",
  domain: "terminal",
  source: "internal",
  mode: "stream",
  inputSchema: {
    type: "object",
    properties: { command: { type: "string" } },
  },
  tags: ["terminal"],
  capabilities: {
    sideEffect: "process",
    requiresApproval: true,
  },
};

const externalDefinition = {
  ...terminalDefinition,
  id: "mcp:server-1:tool:lookup",
  title: "Lookup",
  description: "External lookup",
  domain: "external_mcp",
  source: "external",
  capabilities: {
    sideEffect: "network",
    requiresApproval: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveExposure.mockReturnValue({
    exposedToolIds: [terminalDefinition.id, externalDefinition.id],
    exposedDefinitions: [terminalDefinition, externalDefinition],
    reason: [],
    visibleDefinitions: [terminalDefinition, externalDefinition],
    blockedCapabilityIds: [],
    blockedCapabilityReasons: {},
    reasons: [],
  });
  mocks.eligibleExternal.mockReturnValue([externalDefinition]);
});

describe("mobile remote tool gateway service", () => {
  test("projects only Agent exposure definitions with model-safe names", async () => {
    const manifests = await listRemoteToolManifests();

    expect(manifests[0]).toMatchObject({
      id: "terminal_session",
      name: "terminal_session",
      requiresApproval: true,
    });
    expect(manifests[1]?.id).toBe("mcp:server-1:tool:lookup");
    expect(manifests[1]?.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/u);
    expect(manifests[1]?.name).not.toContain(":");
    expect(mocks.resolveExposure).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "agent_intent",
        allowExternal: true,
      }),
    );
  });

  test("does not apply per-turn top-20 ranking to persistent remote discovery", async () => {
    const internalDefinitions = Array.from({ length: 20 }, (_, index) => ({
      ...terminalDefinition,
      id: `internal_tool_${index}`,
      title: `Internal ${index}`,
    }));
    const allDefinitions = [...internalDefinitions, externalDefinition];
    mocks.resolveExposure.mockReturnValueOnce({
      exposedToolIds: allDefinitions.map((definition) => definition.id),
      exposedDefinitions: allDefinitions,
      reason: [],
      visibleDefinitions: allDefinitions,
      blockedCapabilityIds: [],
      blockedCapabilityReasons: {},
      reasons: [],
    });

    const manifests = await listRemoteToolManifests();

    expect(manifests).toHaveLength(21);
    expect(manifests.at(-1)?.id).toBe(externalDefinition.id);
  });

  test("rejects approval when Mobile changes the frozen invocation arguments", async () => {
    const originalArgs = { command: "pwd" };
    mocks.getInvocation.mockReturnValue({
      id: "inv-original",
      toolId: "terminal_session",
      userId: 7,
      status: "awaiting_approval",
      args: originalArgs,
      inputHash: createInvocationInputHash(originalArgs),
      approval: {
        required: true,
        reason: "terminal_session requires explicit approval",
      },
      artifacts: [],
    });

    await expect(
      resolveRemoteToolApproval({
        invocationId: "inv-original",
        decision: "approved",
        toolId: "terminal_session",
        args: { command: "echo changed" },
        userId: 7,
      }),
    ).rejects.toThrow(
      "Tool approval does not match the original invocation arguments",
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  test("hides invocations owned by another user", async () => {
    const args = { command: "pwd" };
    mocks.getInvocation.mockReturnValue({
      id: "inv-other-user",
      toolId: "terminal_session",
      userId: 99,
      status: "awaiting_approval",
      args,
      inputHash: createInvocationInputHash(args),
      approval: {
        required: true,
        reason: "terminal_session requires explicit approval",
      },
      artifacts: [],
    });

    await expect(
      resolveRemoteToolApproval({
        invocationId: "inv-other-user",
        decision: "approved",
        toolId: "terminal_session",
        args,
        userId: 7,
      }),
    ).rejects.toThrow("Tool invocation was not found");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  test("does not start resumed execution when the approval was already consumed", async () => {
    const args = { command: "pwd" };
    const inputHash = createInvocationInputHash(args);
    mocks.getInvocation.mockReturnValue({
      id: "inv-original",
      toolId: "terminal_session",
      userId: 7,
      status: "awaiting_approval",
      args,
      inputHash,
      approval: {
        required: true,
        reason: "terminal_session requires explicit approval",
      },
      artifacts: [],
    });
    mocks.claimApproval.mockImplementationOnce(() => {
      throw new Error("Invocation approval is no longer available: inv-original");
    });

    await expect(
      resolveRemoteToolApproval({
        invocationId: "inv-original",
        decision: "approved",
        toolId: "terminal_session",
        args,
        userId: 7,
      }),
    ).rejects.toThrow("approval is no longer available");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.finalizeApproval).not.toHaveBeenCalled();
  });

  test("finalizes the claimed approval as failed when resumed execution throws", async () => {
    const args = { command: "pwd" };
    const inputHash = createInvocationInputHash(args);
    mocks.getInvocation.mockReturnValue({
      id: "inv-failing",
      toolId: "terminal_session",
      userId: 7,
      status: "awaiting_approval",
      args,
      inputHash,
      approval: {
        required: true,
        reason: "terminal_session requires explicit approval",
      },
      artifacts: [],
    });
    mocks.execute.mockRejectedValueOnce(new Error("runtime failed"));

    await expect(
      resolveRemoteToolApproval({
        invocationId: "inv-failing",
        decision: "approved",
        toolId: "terminal_session",
        args,
        userId: 7,
      }),
    ).rejects.toThrow("runtime failed");

    expect(mocks.finalizeApproval).toHaveBeenCalledWith({
      invocationId: "inv-failing",
      status: "failed",
      reason: "runtime failed",
    });
  });

  test("maps a cancelled resumed invocation back to cancelled", async () => {
    const args = { command: "pwd" };
    const inputHash = createInvocationInputHash(args);
    mocks.getInvocation.mockReturnValue({
      id: "inv-cancelled",
      toolId: "terminal_session",
      userId: 7,
      status: "awaiting_approval",
      args,
      inputHash,
      approval: {
        required: true,
        reason: "terminal_session requires explicit approval",
      },
      artifacts: [],
    });
    mocks.execute.mockResolvedValueOnce({
      id: "inv-resumed-cancelled",
      toolId: "terminal_session",
      status: "cancelled",
      args,
      inputHash,
      error: { message: "cancelled", failureCode: "cancelled" },
      artifacts: [],
    });

    await expect(
      resolveRemoteToolApproval({
        invocationId: "inv-cancelled",
        decision: "approved",
        toolId: "terminal_session",
        args,
        userId: 7,
      }),
    ).resolves.toMatchObject({
      status: "cancelled",
    });

    expect(mocks.finalizeApproval).toHaveBeenCalledWith({
      invocationId: "inv-cancelled",
      resolutionInvocationId: "inv-resumed-cancelled",
      status: "cancelled",
      reason: "cancelled",
    });
  });

  test("replays only the exact approved arguments through Harness", async () => {
    const args = { command: "pwd" };
    const inputHash = createInvocationInputHash(args);
    mocks.getInvocation.mockReturnValue({
      id: "inv-original",
      toolId: "terminal_session",
      userId: 7,
      status: "awaiting_approval",
      args,
      inputHash,
      approval: {
        required: true,
        reason: "terminal_session requires explicit approval",
      },
      artifacts: [],
    });
    mocks.execute.mockResolvedValue({
      id: "inv-resumed",
      toolId: "terminal_session",
      status: "completed",
      args,
      inputHash,
      result: { cwd: "/workspace" },
      llmContent: { version: 1, blocks: [], source: "harness_result" },
      artifacts: [],
    });

    await expect(
      resolveRemoteToolApproval({
        invocationId: "inv-original",
        decision: "approved",
        toolId: "terminal_session",
        args,
        userId: 7,
      }),
    ).resolves.toMatchObject({
      invocationId: "inv-resumed",
      status: "completed",
      content: "bounded result",
    });
    expect(mocks.claimApproval).toHaveBeenCalledWith({
      invocationId: "inv-original",
      userId: 7,
      reason: "Approved from Mira Mobile",
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "terminal_session",
        args,
        approvedInvocations: [{ toolId: "terminal_session", inputHash }],
      }),
    );
    expect(mocks.finalizeApproval).toHaveBeenCalledWith({
      invocationId: "inv-original",
      resolutionInvocationId: "inv-resumed",
      status: "completed",
      reason: undefined,
    });
  });
});
