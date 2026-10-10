import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import {
  clearHarnessRegistry,
  registerTool,
} from "@/harness/registry.js";
import { readTool } from "@/mcp/tools/read.tool.js";
import { writeTool } from "@/mcp/tools/write.tool.js";
import {
  createGenericTaskSkillContext,
  GENERIC_TASK_DELEGATE_TOOL_ID,
  GENERIC_TASK_SUBAGENT_SKILL_ID,
  parseGenericTaskDelegationArgs,
  resolveGenericChildCapabilityView,
  withGenericTaskDelegationTool,
} from "../delegation/contract.js";
import type { AgentNodeState } from "../node-runtime.js";
import {
  createGenericTaskSubAgentNode,
  isGenericTaskApprovalToolCall,
  type ForkedTaskRunner,
} from "../nodes/generic-task-subagent.js";
import {
  routeAfterGenericTaskSubAgent,
  routeAfterNextAction,
} from "../graph/routes.js";
import type { AgentObservation } from "../types.js";

const createState = (
  overrides: Partial<AgentNodeState> = {},
): AgentNodeState => ({
  runId: "run-generic-task",
  threadId: "thread-generic-task",
  userId: 1,
  goal: {
    id: "goal-generic-task",
    text: "complete the global task",
    successCriteria: ["global task is complete"],
    constraints: [],
    riskLevel: "low",
  },
  question: "complete the global task",
  messages: [
    {
      role: "user",
      content: "complete the global task",
      parts: [{ type: "text", text: "complete the global task" }],
    },
  ],
  currentTaskFrame: {
    globalGoal: "complete the global task",
    currentGoal: "complete the global task",
    confirmedObjects: [],
    completionCriteria: ["global task is complete"],
  },
  toolExposure: {
    // Parent disclosure is narrowed to "read"; the broader authority envelope
    // still carries "write". The Child ceiling must follow the envelope.
    exposedTools: ["read"],
    eligibleTools: ["read", "write"],
    toolMeta: [
      {
        toolId: "read",
        title: "Read",
        description: "Read a known workspace file.",
      },
      {
        toolId: "write",
        title: "Write",
        description: "Write a governed workspace file.",
      },
    ],
  },
  nextAction: {
    type: "use_tool",
    toolId: GENERIC_TASK_DELEGATE_TOOL_ID,
    args: {
      goal: "inspect, update and verify the target implementation",
      acceptanceCriteria: ["root cause identified", "verification passes"],
    },
    reason: "The task is a coherent multi-step work package.",
  },
  evidence: {
    observations: [],
    retrievals: [],
    toolExecutions: [],
  },
  ...overrides,
});

const createObservation = (input: {
  status: AgentObservation["status"];
  resultStatus: string;
  requirements?: Record<string, unknown>[];
  errorMessage?: string;
}): AgentObservation => ({
  id: `observation-${input.resultStatus}`,
  runId: "run-generic-task",
  stepId: `subagent:${GENERIC_TASK_SUBAGENT_SKILL_ID}`,
  status: input.status,
  facts: [`subAgent status: ${input.resultStatus}`],
  ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  summary: {
    source: "observation",
    status:
      input.status === "ok"
        ? "completed"
        : input.status === "blocked"
          ? "blocked"
          : input.status === "failed"
            ? "failed"
            : "partial",
    actionTaken: "Delegated one bounded task.",
    keyFindings: [`status=${input.resultStatus}`],
    data: {
      kind: "generic_structured",
      preview: {
        skillId: GENERIC_TASK_SUBAGENT_SKILL_ID,
        status: input.resultStatus,
        requirements: input.requirements ?? [],
        trace: { toolCalls: ["read_open"] },
      },
      truncated: false,
      redacted: false,
      unsupported: false,
    },
  },
  createdAt: "2026-07-27T00:00:00.000Z",
});

beforeEach(() => {
  registerTool(readTool);
  registerTool(writeTool);
});

afterEach(() => {
  clearHarnessRegistry();
});

test("planner-only delegation surface preserves dynamic Harness tools", () => {
  const base = createState().toolExposure!;
  const exposed = withGenericTaskDelegationTool(base);

  assert.deepEqual(base.exposedTools, ["read"]);
  assert.deepEqual(exposed.exposedTools, [
    GENERIC_TASK_DELEGATE_TOOL_ID,
    "read",
  ]);
  assert.equal(
    exposed.toolMeta[0]?.toolId,
    GENERIC_TASK_DELEGATE_TOOL_ID,
  );

  const parsed = parseGenericTaskDelegationArgs({
    goal: "finish one bounded task",
    acceptanceCriteria: ["evidence exists"],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const childContext = createGenericTaskSkillContext({
    task: parsed.task,
    parentVisibleToolIds: base.exposedTools,
    delegatedAuthorityToolIds: base.eligibleTools ?? [],
  });
  assert.deepEqual(childContext.primary?.execution?.allowedTools, [
    "read",
    "write",
  ]);
  assert.equal(
    childContext.primary?.execution?.allowedTools.includes(
      GENERIC_TASK_DELEGATE_TOOL_ID,
    ),
    false,
  );
});

test("delegate_task is never in the Generic Child allowlist even if it appears in the envelope", () => {
  const resolution = resolveGenericChildCapabilityView({
    parentVisibleToolIds: ["read", GENERIC_TASK_DELEGATE_TOOL_ID],
    delegatedAuthorityToolIds: ["read", GENERIC_TASK_DELEGATE_TOOL_ID],
  });

  assert.equal(
    resolution.discoverableToolIds.includes(GENERIC_TASK_DELEGATE_TOOL_ID),
    false,
  );
  assert.equal(
    resolution.allowedTools.includes(GENERIC_TASK_DELEGATE_TOOL_ID),
    false,
  );
});

test("regression: a Tool hidden from Parent disclosure stays reachable to the Child inside the delegated envelope", () => {
  const resolution = resolveGenericChildCapabilityView({
    parentVisibleToolIds: ["read"],
    delegatedAuthorityToolIds: ["read", "write"],
  });

  // Old coupling would have capped the Child at the Parent visible snapshot.
  assert.equal(resolution.parentVisibleToolIds.includes("write"), false);
  assert.equal(resolution.delegatedAuthorityToolIds.includes("write"), true);
  assert.equal(resolution.discoverableToolIds.includes("write"), true);
  assert.equal(resolution.allowedTools.includes("write"), true);

  // Parent visible set and Child eligible/discoverable set are independent.
  assert.notDeepEqual(
    resolution.parentVisibleToolIds,
    resolution.discoverableToolIds,
  );
});

test("a Tool outside the delegated authority envelope stays unavailable even when registered and ready", () => {
  const resolution = resolveGenericChildCapabilityView({
    parentVisibleToolIds: ["read"],
    delegatedAuthorityToolIds: ["read"],
  });

  assert.equal(resolution.discoverableToolIds.includes("write"), false);
  assert.equal(resolution.allowedTools.includes("write"), false);
});

test("a runtime-unavailable Tool is excluded even when it is inside the delegated envelope", () => {
  clearHarnessRegistry();
  registerTool(writeTool, {
    resolveReadiness: () => ({
      state: "unavailable",
      reason: "Runtime prerequisite is missing.",
      code: "test_runtime_unavailable",
    }),
  });

  const resolution = resolveGenericChildCapabilityView({
    parentVisibleToolIds: ["write"],
    delegatedAuthorityToolIds: ["write"],
  });

  assert.equal(resolution.discoverableToolIds.includes("write"), false);
  assert.equal(resolution.allowedTools.includes("write"), false);
});

test("delegate_task parser validates object shape without keyword routing", () => {
  assert.deepEqual(
    parseGenericTaskDelegationArgs({
      task: {
        goal: "run an arbitrary bounded task",
        acceptanceCriteria: ["first condition", "second condition"],
      },
    }),
    {
      ok: true,
      task: {
        goal: "run an arbitrary bounded task",
        acceptanceCriteria: ["first condition", "second condition"],
      },
    },
  );
  assert.equal(
    parseGenericTaskDelegationArgs({ goal: "missing criteria" }).ok,
    false,
  );
});

test("graph routes delegate_task to the generic worker", () => {
  const state = createState();
  assert.equal(routeAfterNextAction(state as never), "genericTaskSubAgent");
  assert.equal(
    routeAfterGenericTaskSubAgent({
      ...state,
      pendingEvidenceObservation: createObservation({
        status: "ok",
        resultStatus: "completed",
      }),
    } as never),
    "evidenceStage",
  );
});

test("generic worker returns completed task evidence to Main Planner", async () => {
  const runner: ForkedTaskRunner = async (state) => {
    const frame = state.currentTaskFrame as typeof state.currentTaskFrame & {
      skillContext?: ReturnType<typeof createGenericTaskSkillContext>;
    };
    assert.equal(frame?.skillContext?.primary?.id, GENERIC_TASK_SUBAGENT_SKILL_ID);
    assert.deepEqual(frame?.skillContext?.primary?.execution?.allowedTools, [
      "read",
      "write",
    ]);
    return {
      pendingEvidenceObservation: createObservation({
        status: "ok",
        resultStatus: "completed",
      }),
    };
  };
  const node = createGenericTaskSubAgentNode(runner);
  const result = await node(createState());

  assert.equal(result.pendingEvidenceObservation?.status, "ok");
  assert.equal(result.finalizationPacket, undefined);
  assert.equal(result.errorMessage, undefined);
});

test("generic worker freezes needs_input for the Parent", async () => {
  const runner: ForkedTaskRunner = async () => ({
    pendingEvidenceObservation: createObservation({
      status: "partial",
      resultStatus: "needs_input",
      requirements: [
        {
          id: "requirement-1",
          kind: "user_input",
          description: "请提供目标文件名。",
          requiredFor: "target_file",
        },
      ],
    }),
  });
  const result = await createGenericTaskSubAgentNode(runner)(createState());

  assert.equal(result.nextAction?.type, "ask_user");
  assert.equal(
    result.nextAction?.type === "ask_user" ? result.nextAction.question : "",
    "请提供目标文件名。",
  );
});

test("generic worker preserves exact approval handoff", async () => {
  const runner: ForkedTaskRunner = async () => ({
    pendingEvidenceObservation: createObservation({
      status: "partial",
      resultStatus: "needs_input",
    }),
    pendingApproval: {
      id: "approval-generic-task",
      runId: "run-generic-task",
      stepId: `subagent:${GENERIC_TASK_SUBAGENT_SKILL_ID}`,
      toolId: "terminal",
      toolCallId: "tool-call-generic-task",
      reason: "Command execution requires approval.",
      input: { command: "npm test" },
      inputHash: "hash-generic-task",
      createdAt: "2026-07-27T00:00:00.000Z",
    },
  });
  const result = await createGenericTaskSubAgentNode(runner)(createState());

  assert.equal(result.pendingApproval?.toolId, "terminal");
  assert.notEqual(result.nextAction?.type, "ask_user");
});

test("generic worker maps malformed packets to schema replan", async () => {
  const node = createGenericTaskSubAgentNode(async () => {
    throw new Error("runner must not be called for invalid packets");
  });
  const result = await node(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: GENERIC_TASK_DELEGATE_TOOL_ID,
        args: { goal: "missing acceptance criteria" },
        reason: "delegate",
      },
    }),
  );

  assert.equal(result.schemaReplanDiagnostics?.toolId, GENERIC_TASK_DELEGATE_TOOL_ID);
  assert.equal(result.schemaReplanDiagnostics?.attemptCount, 1);
  assert.equal(result.errorMessage, undefined);
});

test("generic approval marker is distinguishable from normal Skill approvals", () => {
  const genericPending = {
    id: "tool-call-generic",
    toolId: "terminal",
    args: { command: "npm test" },
    inputHash: "hash-generic",
    source: "llm_tool_call" as const,
    origin: "skill_agent" as const,
    skillId: GENERIC_TASK_SUBAGENT_SKILL_ID,
    createdAt: "2026-07-27T00:00:00.000Z",
  };
  const skillPending = {
    ...genericPending,
    skillId: "docx",
  };

  assert.equal(isGenericTaskApprovalToolCall(genericPending), true);
  assert.equal(isGenericTaskApprovalToolCall(skillPending), false);
});
