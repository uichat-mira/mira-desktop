import assert from "node:assert/strict";
import { test, vi } from "vitest";
import * as harnessInvocations from "@/harness/invocations";
import * as harnessRegistry from "@/harness/registry";
import * as intentMatcherModule from "../intent/embedding-capability-matcher";
import { externalExpertService } from "@/microapps/external-expert/index.js";
import { createInitialAgentGraphState } from "../graph/state";
import { buildPlannerObservationContext } from "../node-runtime";
import { prepareContextNode } from "../nodes/prepare-context";
import { retrieveNode } from "../nodes/retrieve";
import { toolNode } from "../nodes/tool-node";
import { buildNextActionPlannerMessages } from "../planner/prompt";
import type { AgentNodeState } from "../node-runtime";

const createBaseState = (
  overrides: Partial<AgentNodeState> = {},
): AgentNodeState => ({
  runId: "run-1",
  threadId: "thread-1",
  userId: 1,
  goal: {
    id: "goal-1",
    text: "inspect docs",
    successCriteria: ["inspect docs", "report findings"],
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

const makeToolDefinition = (toolId: string, domain = "read") => ({
  id: toolId,
  title: toolId,
  description: toolId,
  inputSchema: { type: "object", properties: {} },
  domain,
  source: "internal" as const,
  mode: "sync" as const,
  tags: [domain],
  capabilities: { sideEffect: "none" as const, requiresApproval: false },
});

test("createInitialAgentGraphState initializes the runtime-minimum currentTaskFrame from goal when no newer user question exists", () => {
  const state = createInitialAgentGraphState({
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
    selectedToolId: "legacy-tool-should-not-enter-state",
  });

  assert.equal("selectedToolId" in state, false);
  assert.deepEqual(state.currentTaskFrame, {
    globalGoal: "inspect docs",
    currentGoal: "inspect docs",
    currentSubtask: "Prepare context and determine the next action.",
    currentBlocker: undefined,
    confirmedObjects: [],
    completionCriteria: ["inspect docs"],
  });
});

test("createInitialAgentGraphState keeps globalGoal stable while currentGoal follows the latest user question", () => {
  const state = createInitialAgentGraphState({
    runId: "run-1",
    threadId: "thread-1",
    userId: 1,
    goal: {
      id: "goal-1",
      text: "historic goal text",
      successCriteria: ["report findings"],
      constraints: [],
      riskLevel: "low",
    },
    plan: {
      id: "plan-1",
      goalId: "goal-1",
      version: 1,
      steps: [],
    },
    messages: [
      {
        role: "user",
        content: "Please inspect docs/README.md",
        parts: [{ type: "text", text: "Please inspect docs/README.md" }],
      },
    ],
  });

  assert.equal(state.currentTaskFrame?.globalGoal, "historic goal text");
  assert.equal(
    state.currentTaskFrame?.currentGoal,
    "Please inspect docs/README.md",
  );
  assert.deepEqual(state.currentTaskFrame?.completionCriteria, ["report findings"]);
});

test("prepareContextNode keeps the initialized currentTaskFrame unchanged", async () => {
  const readOpen = makeToolDefinition("read_open");
  const matcherSpy = vi
    .spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding")
    .mockResolvedValue({
      query: "inspect docs",
      topCandidates: [],
      toolCandidates: [],
      toolExposure: {
        exposedToolIds: ["read_open"],
        exposedDefinitions: [readOpen],
        reason: ["matched read_open"],
      },
      exposureReasons: ["matched read_open"],
    });
  const initialState = createInitialAgentGraphState({
    runId: "run-1",
    threadId: "thread-1",
    userId: 1,
    goal: {
      id: "goal-1",
      text: "inspect docs",
      successCriteria: ["inspect docs", "report findings"],
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
    workspaceRoot: "D:\\workspace\\rag-demo",
    knowledgeBaseId: "kb-1",
  });

  try {
    const patch = await prepareContextNode(
      createBaseState({
        workspaceRoot: "D:\\workspace\\rag-demo",
        knowledgeBaseId: "kb-1",
        currentTaskFrame: initialState.currentTaskFrame,
      }),
    );

    assert.equal(patch.toolIntent?.query, "inspect docs");
    assert.deepEqual(initialState.currentTaskFrame, {
      globalGoal: "inspect docs",
      currentGoal: "inspect docs",
      currentSubtask: "Prepare context and determine the next action.",
      currentBlocker: undefined,
      confirmedObjects: [
        {
          type: "file",
          id: "D:\\workspace\\rag-demo",
          label: "D:\\workspace\\rag-demo",
          confidence: 1,
        },
        {
          type: "knowledge",
          id: "kb-1",
          label: "kb-1",
          confidence: 1,
        },
      ],
      completionCriteria: ["inspect docs", "report findings"],
    });
  } finally {
    matcherSpy.mockRestore();
  }
});

test("prepareContextNode initializes runtime toolExposure independently from toolIntent diagnostics", async () => {
  const readOpen = makeToolDefinition("read_open");
  const webSearch = makeToolDefinition("web_search", "research");
  const matcherSpy = vi
    .spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding")
    .mockResolvedValue({
      query: "inspect docs",
      topCandidates: [],
      toolCandidates: [],
      toolExposure: {
        exposedToolIds: ["read_open"],
        exposedDefinitions: [readOpen],
        reason: ["matched read_open"],
      },
      exposureReasons: ["matched read_open"],
    });

  try {
    const patch = await prepareContextNode(createBaseState());
    assert.deepEqual(patch.toolExposure, {
      exposedTools: ["read_open"],
      toolMeta: [
        {
          toolId: "read_open",
          title: "read_open",
          description: "read_open",
          inputSchema: { type: "object", properties: {} },
          domain: "read",
          source: "internal",
          tags: ["read"],
          capabilities: { sideEffect: "none", requiresApproval: false },
        },
      ],
    });
    const conflictingState = createBaseState({
      ...patch,
      toolIntent: {
        ...patch.toolIntent!,
        toolExposure: {
          exposedToolIds: ["web_search"],
          exposedDefinitions: [webSearch],
          reason: ["diagnostic mismatch"],
        },
        exposureReasons: ["diagnostic mismatch"],
      },
    });
    const plannerMessages = buildNextActionPlannerMessages({
      question: "Open README.md",
      messages: conflictingState.messages,
      observationContext: buildPlannerObservationContext(conflictingState),
      toolExposure: conflictingState.toolExposure!,
      iteration: 0,
      maxIterations: 3,
    });
    const payload = JSON.parse(String(plannerMessages[1]?.content ?? "{}")) as {
      toolExposure: {
        exposedTools: string[];
        toolMeta: Array<{ toolId: string }>;
      };
    };

    assert.deepEqual(payload.toolExposure.exposedTools, ["read_open"]);
    assert.deepEqual(
      payload.toolExposure.toolMeta.map((tool) => tool.toolId),
      ["read_open"],
    );
  } finally {
    matcherSpy.mockRestore();
  }
});

test("prepareContextNode injects an explicit tool package as a Planner preference without filtering exposed tools", async () => {
  const readOpen = makeToolDefinition("read_open");
  const webSearch = makeToolDefinition("web_search", "web_search");
  const registrySpy = vi
    .spyOn(harnessRegistry, "listCapabilityDefinitions")
    .mockReturnValue([readOpen, webSearch]);
  const matcherSpy = vi
    .spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding")
    .mockImplementation(async ({ query }) => ({
      query,
      topCandidates: [],
      toolCandidates: [],
      toolExposure: {
        exposedToolIds: ["read_open", "web_search"],
        exposedDefinitions: [readOpen, webSearch],
        reason: ["matched tools"],
      },
      exposureReasons: ["matched tools"],
    }));
  const events: Array<{
    nodeId: string;
    phase: string;
    label: string;
    details?: Record<string, unknown>;
  }> = [];

  try {
    const patch = await prepareContextNode(
      createBaseState({ requestedToolGroupIds: ["web_search"] }),
      async (event) => {
        events.push({
          nodeId: event.nodeId,
          phase: event.phase,
          label: event.label,
          details: event.details,
        });
      },
    );

    assert.match(
      matcherSpy.mock.calls[0]?.[0].query ?? "",
      /用户明确选择了以下工具包作为本轮工具偏好/,
    );
    assert.match(matcherSpy.mock.calls[0]?.[0].query ?? "", /网络搜索/);
    assert.deepEqual(patch.toolExposure?.exposedTools, ["read_open", "web_search"]);
    assert.deepEqual(patch.toolExposure?.requestedToolGroups, [
      {
        groupId: "web_search",
        groupLabel: "网络搜索",
        groupDescription: "公网实时搜索与本地新闻源检索。",
        toolIds: ["web_search"],
        exposedToolIds: ["web_search"],
        status: "available",
      },
    ]);

    const plannerMessages = buildNextActionPlannerMessages({
      question: "查一下最新资料",
      messages: [],
      observationContext: buildPlannerObservationContext(
        createBaseState({ ...patch }),
      ),
      toolExposure: patch.toolExposure!,
      iteration: 0,
      maxIterations: 3,
    });
    const plannerPayload = JSON.parse(
      String(plannerMessages[1]?.content ?? "{}"),
    ) as {
      toolSelectionHints: Array<{ groupId: string; status: string }>;
      toolExposure: { exposedTools: string[] };
    };
    assert.deepEqual(plannerPayload.toolExposure.exposedTools, [
      "read_open",
      "web_search",
    ]);
    assert.deepEqual(plannerPayload.toolSelectionHints, [
      {
        groupId: "web_search",
        groupLabel: "网络搜索",
        groupDescription: "公网实时搜索与本地新闻源检索。",
        toolIds: ["web_search"],
        exposedToolIds: ["web_search"],
        status: "available",
      },
    ]);
    const toolkitEvent = events.find(
      (event) => event.nodeId === "agent-toolkit-context" && event.phase === "done",
    );
    assert.equal(toolkitEvent?.label, "应用工具包");
    assert.equal(toolkitEvent?.details?.changesToolExposure, false);
  } finally {
    matcherSpy.mockRestore();
    registrySpy.mockRestore();
  }
});

test("prepareContextNode reports unavailable and unknown tool packages without changing tool exposure", async () => {
  const readOpen = makeToolDefinition("read_open");
  const webSearch = makeToolDefinition("web_search", "web_search");
  const registrySpy = vi
    .spyOn(harnessRegistry, "listCapabilityDefinitions")
    .mockReturnValue([readOpen, webSearch]);
  const matcherSpy = vi
    .spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding")
    .mockResolvedValue({
      query: "inspect docs",
      topCandidates: [],
      toolCandidates: [],
      toolExposure: {
        exposedToolIds: ["read_open"],
        exposedDefinitions: [readOpen],
        reason: ["matched read_open"],
      },
      exposureReasons: ["matched read_open"],
    });

  try {
    const patch = await prepareContextNode(
      createBaseState({
        requestedToolGroupIds: ["web_search", "missing-package"],
      }),
    );
    assert.deepEqual(patch.toolExposure?.exposedTools, ["read_open"]);
    assert.deepEqual(
      patch.toolExposure?.requestedToolGroups?.map((group) => ({
        groupId: group.groupId,
        status: group.status,
        exposedToolIds: group.exposedToolIds,
      })),
      [
        {
          groupId: "web_search",
          status: "unavailable",
          exposedToolIds: [],
        },
        {
          groupId: "missing-package",
          status: "unknown",
          exposedToolIds: [],
        },
      ],
    );
    assert.match(matcherSpy.mock.calls[0]?.[0].query ?? "", /网络搜索/);
    assert.doesNotMatch(
      matcherSpy.mock.calls[0]?.[0].query ?? "",
      /missing-package/,
    );
  } finally {
    matcherSpy.mockRestore();
    registrySpy.mockRestore();
  }
});

test("prepareContextNode hides external expert from a user without a runtime connection", async () => {
  const externalExpert = makeToolDefinition("ask_external_expert", "external_expert");
  const readOpen = makeToolDefinition("read_open");
  const availabilitySpy = vi
    .spyOn(externalExpertService, "isAgentAvailable")
    .mockReturnValue(false);
  const matcherSpy = vi
    .spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding")
    .mockResolvedValue({
      query: "请咨询专家",
      topCandidates: [
        {
          toolId: "ask_external_expert",
          title: "问策",
          description: "咨询外部专家",
          score: 1,
          embeddingScore: 1,
          ruleScore: 0,
          source: "internal",
          domain: "external_expert",
          tags: ["问策"],
        },
      ],
      toolCandidates: [
        {
          toolId: "ask_external_expert",
          title: "问策",
          description: "咨询外部专家",
          domain: "external_expert",
          source: "internal",
          tags: ["问策"],
          score: 1,
          embeddingScore: 1,
          ruleScore: 0,
          rerankScore: 0,
          finalScore: 1,
        },
      ],
      toolExposure: {
        exposedToolIds: ["ask_external_expert", "read_open"],
        exposedDefinitions: [externalExpert, readOpen],
        reason: ["matched tools"],
        blockedCapabilityIds: [],
        blockedCapabilityReasons: {},
      },
      exposureReasons: ["matched tools"],
    });

  try {
    const patch = await prepareContextNode(createBaseState({
      userId: 7,
      goal: {
        ...createBaseState().goal,
        text: "请咨询专家",
      },
    }));

    assert.deepEqual(patch.toolExposure?.exposedTools, ["read_open"]);
    assert.deepEqual(patch.toolIntent?.topCandidates, []);
    assert.deepEqual(patch.toolIntent?.toolCandidates, []);
    assert.deepEqual(patch.toolIntent?.toolExposure.exposedToolIds, ["read_open"]);
    assert.equal(availabilitySpy.mock.calls[0]?.[0], 7);
  } finally {
    matcherSpy.mockRestore();
    availabilitySpy.mockRestore();
  }
});

test("prepareContextNode exposes external expert after the current user creates a connection", async () => {
  const externalExpert = makeToolDefinition("ask_external_expert", "external_expert");
  const availabilitySpy = vi
    .spyOn(externalExpertService, "isAgentAvailable")
    .mockReturnValue(true);
  const matcherSpy = vi
    .spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding")
    .mockResolvedValue({
      query: "请咨询专家",
      topCandidates: [],
      toolCandidates: [],
      toolExposure: {
        exposedToolIds: ["ask_external_expert"],
        exposedDefinitions: [externalExpert],
        reason: ["matched external expert"],
        blockedCapabilityIds: [],
        blockedCapabilityReasons: {},
      },
      exposureReasons: ["matched external expert"],
    });

  try {
    const patch = await prepareContextNode(createBaseState({ userId: 7 }));
    assert.deepEqual(patch.toolExposure?.exposedTools, ["ask_external_expert"]);
    assert.deepEqual(patch.toolIntent?.toolExposure.exposedToolIds, ["ask_external_expert"]);
    assert.equal(availabilitySpy.mock.calls[0]?.[0], 7);
  } finally {
    matcherSpy.mockRestore();
    availabilitySpy.mockRestore();
  }
});

test("retrieveNode does not write currentTaskFrame when no knowledge base is bound", async () => {
  const patch = await retrieveNode(
    createBaseState({
      currentTaskFrame: {
        currentGoal: "inspect docs",
        currentSubtask: "Gather evidence",
        currentBlocker: undefined,
        confirmedObjects: [],
        completionCriteria: ["inspect docs"],
      },
      messages: [
        {
          role: "user",
          content: "inspect docs",
          parts: [{ type: "text", text: "inspect docs" }],
        },
      ],
    }),
  );

  assert.equal("currentTaskFrame" in patch, false);
});

test("toolNode does not write currentTaskFrame", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-1",
      toolId: "read_open",
      status: "completed",
      result: { ok: true },
      startedAt: "2026-07-06T00:00:00.000Z",
      finishedAt: "2026-07-06T00:00:01.000Z",
    });

  try {
    const patch = await toolNode(
      createBaseState({
        currentTaskFrame: {
          currentGoal: "inspect docs",
          currentSubtask: "Gather evidence",
          currentBlocker: "Old blocker",
          confirmedObjects: [
            {
              type: "knowledge",
              id: "kb-1",
              label: "kb-1",
              confidence: 1,
            },
          ],
          completionCriteria: ["inspect docs"],
        },
        policyDecision: {
          type: "allow",
          toolId: "read_open",
          inputHash: "hash-read-open",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-1",
          toolId: "read_open",
          args: { path: "README.md" },
          inputHash: "hash-read-open",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-06T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal("currentTaskFrame" in patch, false);
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("buildPlannerObservationContext carries currentTaskFrame into the planner observation view", () => {
  const state = createInitialAgentGraphState({
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
  });

  const context = buildPlannerObservationContext(state);
  assert.deepEqual(context.currentTaskFrame, state.currentTaskFrame);
});
