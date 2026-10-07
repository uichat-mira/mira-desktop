import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, vi } from "vitest";
import * as registry from "@/harness/registry";
import type { AgentNodeState } from "../node-runtime";
import * as policy from "../policy";
import { policyNode } from "../nodes/policy-node";
import type { ToolDefinition } from "@/mcp/core/definitions";
import type { PendingToolCall } from "../types";

const createTool = (
  overrides: Partial<ToolDefinition>,
): ToolDefinition => ({
  id: overrides.id ?? "tool",
  title: overrides.title ?? "tool",
  description: overrides.description ?? "tool",
  domain: overrides.domain ?? "read",
  source: overrides.source ?? "internal",
  mode: overrides.mode ?? "sync",
  inputSchema: overrides.inputSchema ?? {},
  tags: overrides.tags ?? [],
  capabilities: overrides.capabilities ?? {
    sideEffect: "none",
    requiresApproval: false,
  },
});

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJson(nestedValue)]),
    );
  }

  return value;
};

const createPendingToolInputHash = (input: {
  toolId: string;
  args: Record<string, unknown>;
  source: PendingToolCall["source"];
}) =>
  createHash("sha256")
    .update(JSON.stringify(sortJson(input)))
    .digest("hex");

const createPendingToolCall = (
  toolId: string,
  args: Record<string, unknown> = {},
): PendingToolCall => ({
  id: `pending-${toolId}`,
  toolId,
  args,
  inputHash: createPendingToolInputHash({
    toolId,
    args,
    source: "planner",
  }),
  source: "planner",
  status: "frozen",
  createdAt: "2026-07-04T00:00:00.000Z",
  reason: "test",
});

const createBaseState = (
  overrides: Partial<AgentNodeState> = {},
): AgentNodeState => ({
  runId: "run-1",
  threadId: "thread-1",
  userId: 1,
  goal: {
    id: "goal-1",
    text: "inspect docs",
    successCriteria: ["inspect docs"],
    constraints: [],
    riskLevel: "low",
  },
  plan: {
    id: "plan-1",
    goalId: "goal-1",
    version: 1,
    steps: [],
  },
  messages: [],
  ...overrides,
});

test("evaluateAgentToolPolicy allows read and web_search tools in MVP", () => {
  assert.deepEqual(policy.evaluateAgentToolPolicy(createTool({ id: "read_open" })).type, "allow");
  assert.deepEqual(
    policy.evaluateAgentToolPolicy(
      createTool({
        id: "web_search",
        domain: "web_search",
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
        },
      }),
    ).type,
    "allow",
  );
});

test("evaluateAgentToolPolicy requires approval for risky tools", () => {
  assert.deepEqual(
    policy.evaluateAgentToolPolicy(
      createTool({
        id: "write",
        domain: "edit",
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: false,
        },
      }),
    ).type,
    "require_approval",
  );
  assert.deepEqual(
    policy.evaluateAgentToolPolicy(
      createTool({
        id: "delete",
        domain: "edit",
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
        },
      }),
    ).type,
    "require_approval",
  );
});

test("evaluateAgentToolPolicy requires approval for external MCP tools", () => {
  assert.deepEqual(
    policy.evaluateAgentToolPolicy(
      createTool({
        id: "external_search",
        domain: "external_mcp",
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
        },
      }),
    ).type,
    "require_approval",
  );
});

test("policyNode skips when pendingToolCall is missing", async () => {
  const result = await policyNode(createBaseState());

  assert.equal(result.selectedToolId, undefined);
  assert.equal(result.pendingApproval, undefined);
  assert.equal(result.policyDecision?.type, "skip");
  assert.equal(result.errorMessage, undefined);
  assert.equal(result.blockedReason, undefined);
});

test("policyNode blocks non-frozen legacy tool calls", async () => {
  const result = await policyNode(
    createBaseState({
      pendingToolCall: {
        toolId: "web_search",
        args: { query: "search docs" },
        inputHash: "legacy-hash",
        source: "planner_selection",
        createdAt: "2026-07-04T00:00:00.000Z",
      },
    }),
  );

  assert.equal(result.selectedToolId, undefined);
  assert.equal(result.pendingToolCall, undefined);
  assert.equal(result.policyDecision?.type, "error");
  assert.match(result.errorMessage ?? "", /frozen planner pendingToolCall/i);
  assert.equal(result.errorSourceNodeId, "agent-policy-0");
});

test("policyNode allows low-risk frozen pendingToolCall without modifying it", async () => {
  const listToolDefinitionsSpy = vi
    .spyOn(registry, "listToolDefinitions")
    .mockReturnValue([
      createTool({
        id: "web_search",
        domain: "web_search",
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
        },
      }),
    ]);
  const pendingToolCall = createPendingToolCall("web_search", {
    query: "search docs",
  });

  try {
    const result = await policyNode(
      createBaseState({
        pendingToolCall,
      }),
    );

    assert.equal(result.selectedToolId, undefined);
    assert.equal(result.policyDecision?.type, "allow");
    assert.equal(result.pendingApproval, undefined);
    assert.deepEqual(result.pendingToolCall, pendingToolCall);
    assert.deepEqual(result.pendingToolCall?.args, { query: "search docs" });
    assert.equal(result.pendingToolCall?.toolId, "web_search");
  } finally {
    listToolDefinitionsSpy.mockRestore();
  }
});

test("policyNode uses frozen pendingToolCall.toolMeta as the primary SSOT", async () => {
  const listToolDefinitionsSpy = vi
    .spyOn(registry, "listToolDefinitions")
    .mockReturnValue([
      createTool({
        id: "web_search",
        domain: "edit",
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
        },
      }),
    ]);
  const pendingToolCall = {
    ...createPendingToolCall("web_search", {
      query: "search docs",
    }),
    toolMeta: {
      toolId: "web_search",
      title: "Web Search",
      description: "Search the public web",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
        },
      },
      domain: "web_search" as const,
      source: "internal" as const,
      tags: ["web"],
      capabilities: {
        sideEffect: "network" as const,
        requiresApproval: false,
      },
    },
  };

  try {
    const result = await policyNode(
      createBaseState({
        pendingToolCall,
      }),
    );

    assert.equal(result.policyDecision?.type, "allow");
    assert.equal(result.pendingApproval, undefined);
    assert.deepEqual(result.pendingToolCall, pendingToolCall);
  } finally {
    listToolDefinitionsSpy.mockRestore();
  }
});

test("policyNode raises approval for risky frozen pendingToolCall", async () => {
  const listToolDefinitionsSpy = vi
    .spyOn(registry, "listToolDefinitions")
    .mockReturnValue([
      createTool({
        id: "delete",
        domain: "edit",
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
          workspaceBound: true,
        },
      }),
    ]);
  const emitted: unknown[] = [];
  const pendingToolCall = createPendingToolCall("delete", {
    path: "logs/output.txt",
    recursive: true,
  });

  try {
    const result = await policyNode(
      createBaseState({
        pendingToolCall,
      }),
      (event) => {
        emitted.push(event);
      },
    );

    assert.equal(result.selectedToolId, undefined);
    assert.equal(result.policyDecision?.type, "require_approval");
    assert.equal(result.pendingApproval?.toolId, "delete");
    assert.equal(result.pendingApproval?.toolCallId, pendingToolCall.id);
    assert.equal(result.pendingApproval?.inputHash, pendingToolCall.inputHash);
    assert.deepEqual(result.pendingToolCall, pendingToolCall);
    assert.ok(emitted.length > 0);
  } finally {
    listToolDefinitionsSpy.mockRestore();
  }
});

test("policyNode blocks execution when policy denies the frozen call", async () => {
  const listToolDefinitionsSpy = vi
    .spyOn(registry, "listToolDefinitions")
    .mockReturnValue([
      createTool({
        id: "web_search",
        domain: "web_search",
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
        },
      }),
    ]);
  const evaluatePolicySpy = vi
    .spyOn(policy, "evaluateAgentToolPolicy")
    .mockReturnValue({
      type: "deny",
      reason: "Denied by policy for test coverage.",
    });

  try {
    const result = await policyNode(
      createBaseState({
        pendingToolCall: createPendingToolCall("web_search", {
          query: "search docs",
        }),
      }),
    );

    assert.equal(result.selectedToolId, undefined);
    assert.equal(result.pendingToolCall, undefined);
    assert.equal(result.pendingApproval, undefined);
    assert.equal(result.policyDecision?.type, "deny");
    assert.equal(result.lastToolExecution, undefined);
    assert.equal(result.evidence, undefined);
    assert.equal(result.blockedReason, "Denied by policy for test coverage.");
    assert.equal(result.errorMessage, "Denied by policy for test coverage.");
  } finally {
    evaluatePolicySpy.mockRestore();
    listToolDefinitionsSpy.mockRestore();
  }
});

test("policyNode bypasses approval only for the exact approved frozen invocation", async () => {
  const listToolDefinitionsSpy = vi
    .spyOn(registry, "listToolDefinitions")
    .mockReturnValue([
      createTool({
        id: "terminal",
        domain: "terminal",
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
          workspaceBound: true,
          longRunning: true,
        },
      }),
    ]);
  const pendingToolCall = createPendingToolCall("terminal", {
    command: "dir",
    cwd: "D:\\workspace\\rag-demo",
  });

  try {
    const result = await policyNode(
      createBaseState({
        pendingToolCall,
        approvedInvocations: [
          {
            toolId: "terminal",
            input: pendingToolCall.args,
            inputHash: pendingToolCall.inputHash,
            approvedAt: "2026-07-04T00:00:00.000Z",
            approvalId: "approval-1",
          },
        ],
      }),
    );

    assert.equal(result.pendingApproval, undefined);
    assert.equal(result.selectedToolId, undefined);
    assert.equal(result.policyDecision?.type, "allow");
    assert.deepEqual(result.pendingToolCall, pendingToolCall);
  } finally {
    listToolDefinitionsSpy.mockRestore();
  }
});

test("policyNode does not reuse approval when inputHash does not match", async () => {
  const listToolDefinitionsSpy = vi
    .spyOn(registry, "listToolDefinitions")
    .mockReturnValue([
      createTool({
        id: "terminal",
        domain: "terminal",
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
          workspaceBound: true,
          longRunning: true,
        },
      }),
    ]);
  const pendingToolCall = createPendingToolCall("terminal", {
    command: "dir /b",
  });

  try {
    const result = await policyNode(
      createBaseState({
        pendingToolCall,
        approvedInvocations: [
          {
            toolId: "terminal",
            input: { command: "dir" },
            inputHash: "another-hash",
            approvedAt: "2026-07-04T00:00:00.000Z",
            approvalId: "approval-1",
          },
        ],
      }),
    );

    assert.equal(result.selectedToolId, undefined);
    assert.equal(result.policyDecision?.type, "require_approval");
    assert.equal(result.pendingApproval?.toolId, "terminal");
    assert.equal(result.pendingApproval?.toolCallId, pendingToolCall.id);
    assert.equal(result.pendingApproval?.inputHash, pendingToolCall.inputHash);
  } finally {
    listToolDefinitionsSpy.mockRestore();
  }
});

test("policyNode blocks unknown tool ids instead of guessing fallbacks", async () => {
  const listToolDefinitionsSpy = vi
    .spyOn(registry, "listToolDefinitions")
    .mockReturnValue([]);

  try {
    const result = await policyNode(
      createBaseState({
        pendingToolCall: createPendingToolCall("unknown_tool", {
          query: "search docs",
        }),
      }),
    );

    assert.equal(result.selectedToolId, undefined);
    assert.equal(result.pendingToolCall, undefined);
    assert.equal(result.pendingApproval, undefined);
    assert.equal(result.policyDecision?.type, "error");
    assert.match(result.errorMessage ?? "", /unknown tool/i);
  } finally {
    listToolDefinitionsSpy.mockRestore();
  }
});

test("policyNode does not read toolIntent.toolExposure as a fallback execution source", async () => {
  const listToolDefinitionsSpy = vi
    .spyOn(registry, "listToolDefinitions")
    .mockReturnValue([]);

  try {
    const result = await policyNode(
      createBaseState({
        toolIntent: {
          query: "search docs",
          topCandidates: [],
          toolCandidates: [],
          toolExposure: {
            exposedToolIds: ["web_search"],
            exposedDefinitions: [
              createTool({
                id: "web_search",
                domain: "web_search",
                capabilities: {
                  sideEffect: "network",
                  requiresApproval: false,
                },
              }),
            ],
            reason: [],
            blockedCapabilityIds: [],
          },
        },
        pendingToolCall: createPendingToolCall("web_search", {
          query: "search docs",
        }),
      }),
    );

    assert.equal(result.pendingToolCall, undefined);
    assert.equal(result.pendingApproval, undefined);
    assert.equal(result.policyDecision?.type, "error");
    assert.match(result.errorMessage ?? "", /unknown tool/i);
  } finally {
    listToolDefinitionsSpy.mockRestore();
  }
});
