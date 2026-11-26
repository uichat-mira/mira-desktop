import { createHash } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getInvocation: vi.fn(),
  resolveExposure: vi.fn(),
  initialize: vi.fn(),
  coreToolIds: vi.fn(),
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

vi.mock("@/harness/core-capability-scope.js", () => ({
  resolveCoreCapabilityScope: vi.fn(),
  resolveCoreCapabilityToolIds: mocks.coreToolIds,
}));

vi.mock("@/harness/registry.js", () => ({
  listInternalToolDefinitions: vi.fn(() => []),
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
  resolveRemoteToolCatalog,
} from "./remote-tool-gateway.service.js";

const terminalDefinition = {
  id: "terminal",
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

const nonCoreInternalDefinition = {
  ...terminalDefinition,
  id: "github_repository",
  title: "GitHub Repository",
  description: "Registered but outside the curated core scope",
  domain: "github",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveExposure.mockReturnValue({
    exposedToolIds: [
      terminalDefinition.id,
      externalDefinition.id,
      nonCoreInternalDefinition.id,
    ],
    exposedDefinitions: [
      terminalDefinition,
      externalDefinition,
      nonCoreInternalDefinition,
    ],
    reason: [],
    visibleDefinitions: [
      terminalDefinition,
      externalDefinition,
      nonCoreInternalDefinition,
    ],
    blockedCapabilityIds: [],
    blockedCapabilityReasons: {},
    reasons: [],
  });
  mocks.coreToolIds.mockReturnValue(new Set([terminalDefinition.id]));
});

describe("mobile remote tool gateway service", () => {
  test("projects only the core Agent exposure definitions with model-safe names", async () => {
    const manifests = await listRemoteToolManifests();

    expect(manifests).toEqual([
      expect.objectContaining({
        id: "terminal",
        name: "terminal",
        requiresApproval: true,
      }),
    ]);
    expect(mocks.resolveExposure).toHaveBeenCalledWith({
      source: "agent_intent",
      editFacade: "all",
    });
  });

  test("exposes one bidirectional alias index for the catalog", async () => {
    const catalog = await resolveRemoteToolCatalog();

    expect(catalog.nameToId.get("terminal")).toBe("terminal");
    expect(catalog.idToName.get("terminal")).toBe("terminal");
    expect(catalog.nameToId.size).toBe(1);
    expect(catalog.idToName.size).toBe(1);
  });

  test("fails closed when two Tool Core ids would share one MCP name", async () => {
    const externalId = "mcp:server-1:tool:lookup";
    const suffix = createHash("sha256")
      .update(externalId, "utf8")
      .digest("hex")
      .slice(0, 10);
    const collidingDefinitions = [
      {
        ...terminalDefinition,
        id: externalId,
      },
      {
        ...terminalDefinition,
        id: `mcp_server-1_tool_lookup_${suffix}`,
      },
    ];
    mocks.resolveExposure.mockReturnValueOnce({
      exposedToolIds: collidingDefinitions.map((definition) => definition.id),
      exposedDefinitions: collidingDefinitions,
      reason: [],
      visibleDefinitions: collidingDefinitions,
      blockedCapabilityIds: [],
      blockedCapabilityReasons: {},
      reasons: [],
    });
    mocks.coreToolIds.mockReturnValueOnce(
      new Set(collidingDefinitions.map((definition) => definition.id)),
    );

    await expect(resolveRemoteToolCatalog()).rejects.toThrow(
      /Remote tool alias collision/u,
    );
  });

  test("does not apply per-turn top-20 ranking to persistent core discovery", async () => {
    const internalDefinitions = Array.from({ length: 20 }, (_, index) => ({
      ...terminalDefinition,
      id: `internal_tool_${index}`,
      title: `Internal ${index}`,
    }));
    mocks.resolveExposure.mockReturnValueOnce({
      exposedToolIds: internalDefinitions.map((definition) => definition.id),
      exposedDefinitions: internalDefinitions,
      reason: [],
      visibleDefinitions: internalDefinitions,
      blockedCapabilityIds: [],
      blockedCapabilityReasons: {},
      reasons: [],
    });
    mocks.coreToolIds.mockReturnValueOnce(
      new Set(internalDefinitions.map((definition) => definition.id)),
    );

    const manifests = await listRemoteToolManifests();

    expect(manifests).toHaveLength(20);
    expect(manifests.at(-1)?.id).toBe("internal_tool_19");
  });

  test("rejects approval when Mobile changes the frozen invocation arguments", async () => {
    const originalArgs = { command: "pwd" };
    mocks.getInvocation.mockReturnValue({
      id: "inv-original",
      toolId: "terminal",
      userId: 7,
      status: "awaiting_approval",
      args: originalArgs,
      inputHash: createInvocationInputHash(originalArgs),
      approval: {
        required: true,
        reason: "terminal requires explicit approval",
      },
      artifacts: [],
    });

    await expect(
      resolveRemoteToolApproval({
        invocationId: "inv-original",
        decision: "approved",
        toolId: "terminal",
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
      toolId: "terminal",
      userId: 99,
      status: "awaiting_approval",
      args,
      inputHash: createInvocationInputHash(args),
      approval: {
        required: true,
        reason: "terminal requires explicit approval",
      },
      artifacts: [],
    });

    await expect(
      resolveRemoteToolApproval({
        invocationId: "inv-other-user",
        decision: "approved",
        toolId: "terminal",
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
      toolId: "terminal",
      userId: 7,
      status: "awaiting_approval",
      args,
      inputHash,
      approval: {
        required: true,
        reason: "terminal requires explicit approval",
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
        toolId: "terminal",
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
      toolId: "terminal",
      userId: 7,
      status: "awaiting_approval",
      args,
      inputHash,
      approval: {
        required: true,
        reason: "terminal requires explicit approval",
      },
      artifacts: [],
    });
    mocks.execute.mockRejectedValueOnce(new Error("runtime failed"));

    await expect(
      resolveRemoteToolApproval({
        invocationId: "inv-failing",
        decision: "approved",
        toolId: "terminal",
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
      toolId: "terminal",
      userId: 7,
      status: "awaiting_approval",
      args,
      inputHash,
      approval: {
        required: true,
        reason: "terminal requires explicit approval",
      },
      artifacts: [],
    });
    mocks.execute.mockResolvedValueOnce({
      id: "inv-resumed-cancelled",
      toolId: "terminal",
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
        toolId: "terminal",
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
      toolId: "terminal",
      userId: 7,
      status: "awaiting_approval",
      args,
      inputHash,
      approval: {
        required: true,
        reason: "terminal requires explicit approval",
      },
      artifacts: [],
    });
    mocks.execute.mockResolvedValue({
      id: "inv-resumed",
      toolId: "terminal",
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
        toolId: "terminal",
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
        toolId: "terminal",
        args,
        approvedInvocations: [{ toolId: "terminal", inputHash }],
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
