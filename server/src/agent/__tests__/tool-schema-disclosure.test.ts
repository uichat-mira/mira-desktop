import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentNodeState } from "../node-runtime";
import { toolSchemaDisclosureNode } from "../nodes/tool-schema-disclosure";
import {
  clearHarnessRegistry,
  registerTool,
} from "@/harness/registry";
import {
  createProgressiveResolutionState,
  readCapabilityDisclosure,
} from "@/harness/progressive-resolution-state";
import type { ToolImplementation } from "@/mcp/core/definitions";

const createTool = (
  id: string,
  options: { unavailable?: boolean } = {},
): ToolImplementation => ({
  definition: {
    id,
    title: id,
    description: "Test tool " + id,
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
      },
      required: ["target"],
      additionalProperties: false,
    },
    tags: ["test", id],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
    },
  },
  execute: async () => ({ result: { ok: true } }),
});

const createState = (
  overrides: Partial<AgentNodeState> = {},
): AgentNodeState => ({
  runId: "run-schema-disclosure",
  threadId: "thread-schema-disclosure",
  userId: 1,
  goal: {
    id: "goal-schema-disclosure",
    text: "complete a two-tool task",
    successCriteria: ["complete the task"],
    constraints: [],
    riskLevel: "low",
  },
  messages: [
    {
      role: "user",
      content: "complete a two-tool task",
      parts: [{ type: "text", text: "complete a two-tool task" }],
    },
  ],
  nextAction: {
    type: "use_tool",
    toolId: "tool_b",
    args: {},
    reason: "Tool B is now required.",
  },
  toolExposure: {
    exposedTools: ["tool_a"],
    eligibleTools: ["tool_a", "tool_b"],
    toolMeta: [
      {
        toolId: "tool_a",
        title: "tool_a",
        description: "Test tool tool_a",
        inputSchema: {
          type: "object",
          properties: { target: { type: "string" } },
          required: ["target"],
          additionalProperties: false,
        },
        domain: "read",
        source: "internal",
        tags: ["test", "tool_a"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      {
        toolId: "tool_b",
        title: "tool_b",
        description: "Test tool tool_b",
        domain: "read",
        source: "internal",
        tags: ["test", "tool_b"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
    ],
  },
  progressiveResolution: createProgressiveResolutionState(2),
  ...overrides,
});

describe("mid-run Tool schema disclosure", () => {
  beforeEach(() => {
    clearHarnessRegistry();
    registerTool(createTool("tool_a"));
    registerTool(createTool("tool_b"));
  });

  afterEach(() => {
    clearHarnessRegistry();
  });

  it("promotes exactly one metadata-only Tool and consumes one resolution step", async () => {
    const state = createState();
    const patch = await toolSchemaDisclosureNode(state);

    expect(patch.errorMessage).toBeUndefined();
    expect(patch.pendingToolCall).toBeUndefined();
    expect(patch.toolSchemaDisclosure).toMatchObject({
      toolId: "tool_b",
      status: "disclosed",
    });
    expect(patch.toolExposure?.exposedTools).toEqual(["tool_a", "tool_b"]);
    expect(
      patch.toolExposure?.toolMeta.find((tool) => tool.toolId === "tool_b")
        ?.inputSchema,
    ).toEqual(createTool("tool_b").definition.inputSchema);
    expect(patch.progressiveResolution?.budget).toEqual({
      limit: 2,
      consumed: 1,
    });
    expect(
      readCapabilityDisclosure(patch.progressiveResolution!, "tool_b"),
    ).toBe("schema");
  });

  it("does not charge again after the Tool schema is already disclosed", async () => {
    const state = createState();
    const first = await toolSchemaDisclosureNode(state);
    const second = await toolSchemaDisclosureNode({
      ...state,
      ...first,
      nextAction: {
        type: "use_tool",
        toolId: "tool_b",
        args: { target: "later" },
        reason: "Now invoke the disclosed Tool.",
      },
    });

    expect(second.toolSchemaDisclosure).toBeUndefined();
    expect(second.progressiveResolution).toBeUndefined();
    expect(first.progressiveResolution?.budget.consumed).toBe(1);
  });

  it("blocks expansion when the progressive-resolution budget is exhausted", async () => {
    const patch = await toolSchemaDisclosureNode(
      createState({
        progressiveResolution: createProgressiveResolutionState(0),
      }),
    );

    expect(patch.errorMessage).toMatch(/budget/i);
    expect(patch.pendingToolCall).toBeUndefined();
    expect(patch.toolSchemaDisclosure).toBeUndefined();
    expect(patch.progressiveResolution?.budget).toEqual({
      limit: 0,
      consumed: 0,
    });
    expect(patch.progressiveResolution?.exhausted).toBe(true);
  });

  it("refuses schema promotion when live runtime readiness becomes unavailable", async () => {
    clearHarnessRegistry();
    registerTool(createTool("tool_a"));
    registerTool(createTool("tool_b"), {
      resolveReadiness: () => ({
        state: "unavailable",
        reason: "test runtime is unavailable",
        code: "test_unavailable",
      }),
    });

    const patch = await toolSchemaDisclosureNode(createState());

    expect(patch.errorMessage).toMatch(/cannot be disclosed/i);
    expect(patch.errorMessage).toMatch(/blocked-unavailable/i);
    expect(patch.pendingToolCall).toBeUndefined();
    expect(patch.toolExposure).toBeUndefined();
    expect(patch.progressiveResolution?.budget.consumed).toBe(0);
  });

  it("discloses the agent_intent schema instead of the raw runtime schema", async () => {
    clearHarnessRegistry();
    registerTool(createTool("tool_a"));
    registerTool({
      definition: {
        ...createTool("tool_b").definition,
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            target: { type: "string" },
          },
          required: ["sessionId", "target"],
          additionalProperties: false,
        },
        inputSchemaByExposure: {
          agent_intent: {
            type: "object",
            properties: { target: { type: "string" } },
            required: ["target"],
            additionalProperties: false,
          },
        },
      },
      execute: async () => ({ result: { ok: true } }),
    });

    const patch = await toolSchemaDisclosureNode(createState());
    const disclosedSchema = patch.toolExposure?.toolMeta.find(
      (tool) => tool.toolId === "tool_b",
    )?.inputSchema;

    expect(disclosedSchema).toEqual({
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
      additionalProperties: false,
    });
    expect(disclosedSchema).not.toHaveProperty("properties.sessionId");
  });

  it("refuses a Tool outside the current authority and readiness envelope", async () => {
    const patch = await toolSchemaDisclosureNode(
      createState({
        toolExposure: {
          ...createState().toolExposure!,
          eligibleTools: ["tool_a"],
        },
      }),
    );

    expect(patch.errorMessage).toMatch(/outside the current capability envelope/i);
    expect(patch.pendingToolCall).toBeUndefined();
    expect(patch.progressiveResolution?.budget.consumed).toBe(0);
  });
});
