import assert from "node:assert/strict";
import { test } from "vitest";
import {
  clearHarnessRegistry,
  registerTool,
} from "@/harness/registry";
import type { ToolImplementation } from "@/mcp/core/definitions";
import { createAgentGoal } from "../nodes/goal-plan";
import {
  createPiAgentLoop,
  type PiAgentLoopNodes,
} from "../pi-loop";
import { generateNode } from "../nodes/generate";
import { toolSchemaDisclosureNode } from "../nodes/tool-schema-disclosure";
import type {
  AgentGraphInput,
  AgentNextAction,
  AgentToolExecutionResult,
  PendingToolCall,
} from "../types";

const requestText =
  "Read README.md, read package.json, compare them, fix README.md, and verify the result.";

const createInput = (
  overrides: Partial<AgentGraphInput> = {},
): AgentGraphInput => ({
  runId: "run-pi-runtime",
  threadId: "thread-pi-runtime",
  userId: 1,
  goal: createAgentGoal(requestText),
  messages: [
    {
      role: "user",
      content: requestText,
      parts: [{ type: "text", text: requestText }],
    },
  ],
  maxIterations: 8,
  ...overrides,
});

const createPendingToolCall = (
  action: Extract<AgentNextAction, { type: "use_tool" }>,
  index: number,
): PendingToolCall => ({
  id: `tool-call-${index}`,
  toolId: action.toolId,
  args: action.args,
  reason: action.reason,
  inputHash: `hash-${index}`,
  source: "planner",
  status: "frozen",
  toolMeta: {
    toolId: action.toolId,
    title: action.toolId,
    description: `Fake ${action.toolId}`,
    inputSchema: { type: "object", properties: {} },
    domain: "read",
    source: "internal",
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
      workspaceBound: true,
    },
  },
  createdAt: `2026-07-18T00:00:0${index}.000Z`,
});

const createCompletedExecution = (
  pendingToolCall: PendingToolCall,
): AgentToolExecutionResult => ({
  toolCallId: pendingToolCall.id,
  toolId: pendingToolCall.toolId,
  inputHash: pendingToolCall.inputHash,
  args: pendingToolCall.args,
  status: "completed",
  result: {
    type: "open",
    path: String(pendingToolCall.args.path ?? "unknown"),
    source: { text: `content for ${String(pendingToolCall.args.path ?? "unknown")}` },
  },
  summary: {
    source: "tool",
    status: "completed",
    toolId: pendingToolCall.toolId,
    inputHash: pendingToolCall.inputHash,
    actionTaken: `Opened ${String(pendingToolCall.args.path ?? "unknown")}.`,
    keyFindings: [`path=${String(pendingToolCall.args.path ?? "unknown")}`],
  },
  startedAt: pendingToolCall.createdAt,
  finishedAt: pendingToolCall.createdAt,
});

const createFakeNodes = (input: {
  calls: string[];
  plannerActions: AgentNextAction[];
  requireApproval?: boolean;
  useRealGenerate?: boolean;
}): PiAgentLoopNodes => {
  let plannerIndex = 0;
  let toolIndex = 0;

  return {
    prepareContext: async () => {
      input.calls.push("prepare");
      return {
        toolExposure: {
          exposedTools: ["read_open"],
          toolMeta: [
            {
              toolId: "read_open",
              title: "Read Open",
              description: "Open a known workspace file.",
              inputSchema: { type: "object", properties: {} },
              domain: "read",
              source: "internal",
              capabilities: {
                sideEffect: "none",
                requiresApproval: false,
                workspaceBound: true,
              },
            },
          ],
        },
      };
    },

    planner: async () => {
      input.calls.push("planner");
      const action = input.plannerActions[plannerIndex];
      plannerIndex += 1;
      return action
        ? action.type === "answer"
          ? { nextAction: action, finalizationPacket: action }
          : { nextAction: action }
        : {
            nextAction: {
              type: "error" as const,
              reason: "Fake planner ran out of actions.",
            },
            errorMessage: "Fake planner ran out of actions.",
            errorSourceNodeId: "nextActionPlanner",
          };
    },

    discloseToolSchema: async () => ({
      toolSchemaDisclosure: undefined,
    }),

    normalizeToolCall: async (state) => {
      input.calls.push("normalize");
      if (state.nextAction?.type !== "use_tool") {
        return {
          errorMessage: "Expected use_tool action.",
          errorSourceNodeId: "toolCallNormalize",
        };
      }
      toolIndex += 1;
      return {
        pendingToolCall: createPendingToolCall(state.nextAction, toolIndex),
      };
    },

    policy: async (state) => {
      input.calls.push("policy");
      const pendingToolCall = state.pendingToolCall as PendingToolCall;
      if (input.requireApproval) {
        return {
          policyDecision: {
            type: "require_approval" as const,
            toolId: pendingToolCall.toolId,
            inputHash: pendingToolCall.inputHash,
            reason: "Fake approval required.",
          },
          pendingApproval: {
            id: "approval-1",
            runId: state.runId,
            stepId: "approval",
            toolId: pendingToolCall.toolId,
            toolCallId: pendingToolCall.id,
            reason: "Fake approval required.",
            input: pendingToolCall.args,
            inputHash: pendingToolCall.inputHash,
            createdAt: "2026-07-18T00:00:10.000Z",
          },
          pendingToolCall,
        };
      }

      return {
        policyDecision: {
          type: "allow" as const,
          toolId: pendingToolCall.toolId,
          inputHash: pendingToolCall.inputHash,
          reason: "Fake policy allowed execution.",
        },
        pendingToolCall,
      };
    },

    approval: async () => {
      input.calls.push("approval");
      return { blockedReason: "waiting approval" };
    },

    retrieve: async () => {
      input.calls.push("retrieve");
      return {};
    },

    tool: async (state) => {
      input.calls.push("tool");
      const pendingToolCall = state.pendingToolCall as PendingToolCall;
      const execution = createCompletedExecution(pendingToolCall);
      return {
        pendingToolCall: undefined,
        lastToolExecution: execution,
        pendingToolExecution: execution,
        iterationCount: (state.iterationCount ?? 0) + 1,
      };
    },

    evidence: async (state) => {
      input.calls.push("evidence");
      const execution = state.pendingToolExecution;
      return {
        evidence: {
          observations: state.evidence?.observations ?? [],
          retrievals: state.evidence?.retrievals ?? [],
          toolExecutions: execution
            ? [...(state.evidence?.toolExecutions ?? []), execution]
            : state.evidence?.toolExecutions ?? [],
          latestSummary: execution?.summary ?? state.evidence?.latestSummary,
        },
        pendingToolExecution: undefined,
        pendingEvidenceObservation: undefined,
        pendingRetrievalEvidence: undefined,
      };
    },

    generate: async (state) => {
      input.calls.push("generate");
      if (input.useRealGenerate) {
        return generateNode(state);
      }
      return {
        answer:
          state.nextAction?.type === "ask_user"
            ? state.nextAction.question
            : "Compound task completed.",
      };
    },

    evaluate: async () => {
      input.calls.push("evaluate");
      return { terminalReason: "completed" };
    },

    error: async (state) => {
      input.calls.push("error");
      return {
        errorMessage: state.errorMessage ?? "Fake loop error.",
      };
    },
  };
};

test("Pi runtime loops tool results back into the planner until answer", async () => {
  const calls: string[] = [];
  const loop = createPiAgentLoop(
    createFakeNodes({
      calls,
      plannerActions: [
        {
          type: "use_tool",
          toolId: "read_open",
          args: { path: "README.md" },
          reason: "Read the first required file.",
        },
        {
          type: "use_tool",
          toolId: "read_open",
          args: { path: "package.json" },
          reason: "Read the second required file before comparing.",
        },
        {
          type: "answer",
          reason: "All fake completion criteria are covered.",
          completionProof: [
            { criterion: "compare both files", evidenceRefs: ["tool:0", "tool:1"] },
          ],
          unresolvedGaps: [],
        },
      ],
    }),
  );

  const output = await loop.run(createInput());

  assert.equal(output.status, "completed");
  assert.equal(output.answer, "Compound task completed.");
  assert.equal(output.evidence.toolExecutions.length, 2);
  assert.deepEqual(calls, [
    "prepare",
    "planner",
    "normalize",
    "policy",
    "tool",
    "evidence",
    "planner",
    "normalize",
    "policy",
    "tool",
    "evidence",
    "planner",
    "generate",
    "evaluate",
  ]);
});

test("Pi runtime pauses for approval without executing or generating", async () => {
  const calls: string[] = [];
  const loop = createPiAgentLoop(
    createFakeNodes({
      calls,
      requireApproval: true,
      plannerActions: [
        {
          type: "use_tool",
          toolId: "read_open",
          args: { path: "README.md" },
          reason: "Read a protected file.",
        },
      ],
    }),
  );

  const output = await loop.run(createInput());

  assert.equal(output.status, "waiting_approval");
  assert.equal(output.pendingApproval?.toolId, "read_open");
  assert.equal(output.pendingToolCall?.toolId, "read_open");
  assert.deepEqual(calls, [
    "prepare",
    "planner",
    "normalize",
    "policy",
    "approval",
  ]);
});

test("Pi runtime returns retrieval evidence to the planner before answering", async () => {
  const calls: string[] = [];
  const loop = createPiAgentLoop(
    createFakeNodes({
      calls,
      plannerActions: [
        {
          type: "retrieve",
          query: "current pnpm command",
          reason: "The answer requires workspace evidence.",
        },
        {
          type: "answer",
          reason: "The retrieval evidence is sufficient.",
          completionProof: [
            { criterion: "find the command", evidenceRefs: ["retrieval:0"] },
          ],
          unresolvedGaps: [],
        },
      ],
    }),
  );

  const output = await loop.run(createInput({
    goal: createAgentGoal("Find the current pnpm command."),
    messages: [
      {
        role: "user",
        content: "Find the current pnpm command.",
        parts: [{ type: "text", text: "Find the current pnpm command." }],
      },
    ],
  }));

  assert.equal(output.status, "completed");
  assert.equal(output.answer, "Compound task completed.");
  assert.deepEqual(calls, [
    "prepare",
    "planner",
    "retrieve",
    "evidence",
    "planner",
    "generate",
    "evaluate",
  ]);
});

test("Pi runtime turns normalization failures into an error without policy or tool execution", async () => {
  const calls: string[] = [];
  const nodes = createFakeNodes({
    calls,
    plannerActions: [
      {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "Read the requested file.",
      },
    ],
  });
  const loop = createPiAgentLoop({
    ...nodes,
    normalizeToolCall: async () => {
      calls.push("normalize");
      return {
        errorMessage: "args.path must be a string.",
        errorSourceNodeId: "toolCallNormalize",
      };
    },
  });

  const output = await loop.run(createInput());

  assert.equal(output.status, "failed");
  assert.equal(output.errorMessage, "args.path must be a string.");
  assert.deepEqual(calls, ["prepare", "planner", "normalize", "error"]);
});

test("Pi runtime resumes a frozen pending tool call before asking the planner for the next action", async () => {
  const calls: string[] = [];
  const pendingToolCall = createPendingToolCall(
    {
      type: "use_tool",
      toolId: "read_open",
      args: { path: "README.md" },
      reason: "Resume the approved file read.",
    },
    1,
  );
  const loop = createPiAgentLoop(
    createFakeNodes({
      calls,
      plannerActions: [
        {
          type: "answer",
          reason: "The resumed tool result is available.",
          completionProof: [
            { criterion: "use the resumed result", evidenceRefs: ["tool:0"] },
          ],
          unresolvedGaps: [],
        },
      ],
    }),
  );

  const output = await loop.run(createInput({ pendingToolCall }));

  assert.equal(output.status, "completed");
  assert.equal(output.evidence.toolExecutions.length, 1);
  assert.deepEqual(calls, [
    "prepare",
    "policy",
    "tool",
    "evidence",
    "planner",
    "generate",
    "evaluate",
  ]);
});

test("Pi runtime follows a contextual attached-browser use_tool action through real loop routing", async () => {
  const calls: string[] = [];
  const loop = createPiAgentLoop(
    createFakeNodes({
      calls,
      plannerActions: [
        {
          type: "use_tool",
          toolId: "browser_attached_browse",
          args: { url: "http://localhost:5173/#/login" },
          reason: "Continue the uniquely identified login task from conversation context.",
        },
        {
          type: "answer",
          reason: "The fake attached-browser execution is available for verification.",
          completionProof: [
            { criterion: "verify the browser task", evidenceRefs: ["tool:0"] },
          ],
          unresolvedGaps: [],
        },
      ],
    }),
  );

  const output = await loop.run(
    createInput({
      goal: createAgentGoal("Use the attached browser capability to proceed."),
      messages: [
        {
          role: "user",
          content: "Log into http://localhost:5173/#/login.",
          parts: [{ type: "text", text: "Log into http://localhost:5173/#/login." }],
        },
        {
          role: "assistant",
          content: "The login task is pending and has not been executed.",
          parts: [{ type: "text", text: "The login task is pending and has not been executed." }],
        },
        {
          role: "user",
          content: "Use the attached browser capability to proceed.",
          parts: [{ type: "text", text: "Use the attached browser capability to proceed." }],
        },
      ],
    }),
  );

  assert.equal(output.status, "completed");
  assert.equal(output.evidence.toolExecutions.length, 1);
  assert.equal(output.evidence.toolExecutions[0]?.toolId, "browser_attached_browse");
  assert.deepEqual(calls, [
    "prepare",
    "planner",
    "normalize",
    "policy",
    "tool",
    "evidence",
    "planner",
    "generate",
    "evaluate",
  ]);
});

test("Pi runtime ask_user path returns the Planner question without tool execution", async () => {
  const calls: string[] = [];
  const plannerQuestion = "Which page and operation should I handle?";
  const loop = createPiAgentLoop(
    createFakeNodes({
      calls,
      useRealGenerate: true,
      plannerActions: [
        {
          type: "ask_user",
          question: plannerQuestion,
          reason: "The bounded history does not identify a unique task.",
        },
      ],
    }),
  );

  const output = await loop.run(
    createInput({
      goal: createAgentGoal("Please handle this with the attached browser."),
      messages: [
        {
          role: "user",
          content: "Please handle this with the attached browser.",
          parts: [{ type: "text", text: "Please handle this with the attached browser." }],
        },
      ],
    }),
  );

  assert.equal(output.status, "completed");
  assert.equal(output.answer, plannerQuestion);
  assert.equal(output.pendingToolCall, undefined);
  assert.equal(output.evidence.toolExecutions.length, 0);
  assert.deepEqual(calls, ["prepare", "planner", "generate", "evaluate"]);
});

test("Pi runtime can disclose a second Tool schema mid-run before executing it", async () => {
  clearHarnessRegistry();

  const createRuntimeTool = (toolId: string): ToolImplementation => ({
    definition: {
      id: toolId,
      title: toolId,
      description: "Pi-loop progressive disclosure test tool " + toolId,
      domain: "read",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      tags: ["test", toolId],
      capabilities: {
        sideEffect: "none",
        requiresApproval: false,
      },
    },
    execute: async () => ({ result: { ok: true } }),
  });

  registerTool(createRuntimeTool("tool_a"));
  registerTool(createRuntimeTool("tool_b"));

  try {
    const calls: string[] = [];
    const nodes = createFakeNodes({
      calls,
      plannerActions: [
        {
          type: "use_tool",
          toolId: "tool_a",
          args: { path: "first.txt" },
          reason: "Run the already-disclosed first Tool.",
        },
        {
          type: "use_tool",
          toolId: "tool_b",
          args: {},
          reason: "Evidence now shows Tool B is required; request its schema.",
        },
        {
          type: "use_tool",
          toolId: "tool_b",
          args: { path: "second.txt" },
          reason: "Run Tool B with its newly disclosed schema.",
        },
        {
          type: "answer",
          reason: "Both required Tool executions are covered.",
          completionProof: [
            {
              criterion: "complete both Tool actions",
              evidenceRefs: ["tool:0", "tool:1"],
            },
          ],
          unresolvedGaps: [],
        },
      ],
    });

    nodes.discloseToolSchema = toolSchemaDisclosureNode;
    nodes.prepareContext = async () => {
      calls.push("prepare");
      return {
        toolExposure: {
          exposedTools: ["tool_a"],
          eligibleTools: ["tool_a", "tool_b"],
          toolMeta: [
            {
              toolId: "tool_a",
              title: "tool_a",
              description: "Already-disclosed first Tool",
              inputSchema: createRuntimeTool("tool_a").definition.inputSchema,
              domain: "read",
              source: "internal",
              capabilities: {
                sideEffect: "none",
                requiresApproval: false,
              },
            },
            {
              toolId: "tool_b",
              title: "tool_b",
              description: "Metadata-only second Tool",
              domain: "read",
              source: "internal",
              capabilities: {
                sideEffect: "none",
                requiresApproval: false,
              },
            },
          ],
        },
      };
    };

    const loop = createPiAgentLoop(nodes);
    const output = await loop.run(createInput());

    assert.equal(output.status, "completed");
    assert.deepEqual(
      output.evidence.toolExecutions.map((execution) => execution.toolId),
      ["tool_a", "tool_b"],
    );
    assert.equal(output.progressiveResolution?.budget.consumed, 1);
    assert.equal(output.progressiveResolution?.disclosure.tool_b, "schema");

    // The metadata-only request itself must not be normalized or executed.
    assert.equal(calls.filter((call) => call === "normalize").length, 2);
    assert.equal(calls.filter((call) => call === "tool").length, 2);
    assert.deepEqual(calls, [
      "prepare",
      "planner",
      "normalize",
      "policy",
      "tool",
      "evidence",
      "planner",
      "planner",
      "normalize",
      "policy",
      "tool",
      "evidence",
      "planner",
      "generate",
      "evaluate",
    ]);
  } finally {
    clearHarnessRegistry();
  }
});
