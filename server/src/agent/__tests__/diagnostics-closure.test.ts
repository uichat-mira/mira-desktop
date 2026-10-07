import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import * as embedding from "@/services/internal-capabilities/local-embedding.js";
import * as rerank from "@/services/internal-capabilities/local-rerank.js";
import * as harnessInvocations from "@/harness/invocations";
import * as registry from "@/harness/registry";
import { clearHarnessRegistry, registerTool } from "@/harness/registry";
import { resolveHarnessCapabilityDiagnostics } from "@/harness/capability-diagnostics";
import { normalizeToolResult, projectToolEvidence } from "@/mcp/core/tool-result.js";
import { contextBudgetService } from "@/services/context-budget/index";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import * as intentMatcherModule from "../intent/embedding-capability-matcher";

import * as policyModule from "../policy";
import * as runnablesModule from "../runnables";
import { agentGraph } from "../graph";
import { nextActionPlannerNode } from "../planner/node";
import { toolCallNormalizeNode } from "../nodes/tool-call-normalize";
import { generateNode } from "../nodes/generate";

vi.mock("@/mcp/external", () => ({
  resolveAgentEligibleExternalMcpCapabilities: vi.fn(() => []),
}));

const baseGoal = {
  id: "goal-1",
  text: "answer the user",
  successCriteria: ["return an answer"],
  constraints: ["stay safe"],
  riskLevel: "low" as const,
};

const basePlan = {
  id: "plan-1",
  goalId: "goal-1",
  version: 1,
  steps: [],
};

const makeMessage = (content: string) => ({
  role: "user" as const,
  content,
  parts: [{ type: "text" as const, text: content }],
});

const makeToolDefinition = (input: {
  id: string;
  domain: string;
  inputSchema: Record<string, unknown>;
  sideEffect?: "none" | "network" | "process" | "local-write";
  requiresApproval?: boolean;
  workspaceBound?: boolean;
}) => ({
  id: input.id,
  title: input.id,
  description: input.id,
  domain: input.domain,
  source: "internal" as const,
  mode: "sync" as const,
  inputSchema: input.inputSchema,
  tags: [input.domain],
  capabilities: {
    sideEffect: input.sideEffect ?? "none",
    requiresApproval: input.requiresApproval ?? false,
    workspaceBound: input.workspaceBound ?? false,
  },
});

const canonicalReadTool = () =>
  makeToolDefinition({
    id: "read",
    domain: "read",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
      },
      additionalProperties: false,
    },
    workspaceBound: true,
  });

const webSearchTool = () =>
  makeToolDefinition({
    id: "web_search",
    domain: "web_search",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
      },
      additionalProperties: false,
    },
    sideEffect: "network",
  });

const terminalTool = () =>
  makeToolDefinition({
    id: "terminal",
    domain: "terminal",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string" },
      },
      additionalProperties: false,
    },
    sideEffect: "process",
    requiresApproval: true,
  });

const makeToolIntentResult = (
  query: string,
  definitions: Array<ReturnType<typeof makeToolDefinition>>,
) => ({
  query,
  topCandidates: definitions.map((definition) => ({
    toolId: definition.id,
    title: definition.title,
    description: definition.description,
    domain: definition.domain,
    source: definition.source,
    tags: definition.tags,
    score: 0.9,
    embeddingScore: 0.9,
    ruleScore: 0,
    rerankScore: 0.9,
    finalScore: 0.9,
  })),
  toolCandidates: definitions.map((definition) => ({
    toolId: definition.id,
    title: definition.title,
    description: definition.description,
    domain: definition.domain,
    source: definition.source,
    tags: definition.tags,
    score: 0.9,
    embeddingScore: 0.9,
    ruleScore: 0,
    rerankScore: 0.9,
    finalScore: 0.9,
  })),
  toolExposure: {
    exposedToolIds: definitions.map((definition) => definition.id),
    exposedDefinitions: definitions,
    reason: [],
    blockedCapabilityIds: [],
  },
});

const setupToolExposure = (
  query: string,
  definitions: Array<ReturnType<typeof makeToolDefinition>>,
) => {
  vi.spyOn(registry, "listToolDefinitions").mockReturnValue(definitions);
  vi.spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding").mockResolvedValue(
    makeToolIntentResult(query, definitions),
  );
};

const mockRecallOrder = (preferredCapabilityIds: string[] = []) => {
  vi.spyOn(embedding, "executeLocalEmbedding").mockRejectedValue(
    new Error("LOCAL_MODEL_RAW_ROOT is not set."),
  );
  vi.spyOn(rerank, "executeLocalRerank").mockImplementation(async ({ candidates }) => {
    const scored = candidates
      .map((candidate) => {
        const orderIndex = preferredCapabilityIds.indexOf(candidate.id);
        return {
          id: candidate.id,
          text: candidate.text,
          score: orderIndex === -1 ? 0.1 : 1 - orderIndex * 0.1,
          probability: orderIndex === -1 ? 0.1 : 0.95 - orderIndex * 0.1,
          rank: orderIndex === -1 ? preferredCapabilityIds.length + 1 : orderIndex + 1,
        };
      })
      .sort((left, right) => right.probability - left.probability);

    return {
      rerankedCandidates: scored,
      rerankModel: "test-rerank",
      rerankModelConfigId: "test-rerank-config",
    };
  });
};

beforeEach(() => {
  clearHarnessRegistry();
  vi.spyOn(contextBudgetService, "pack").mockImplementation((input) => ({
    messages: [
      ...(input.sections.prefaceMessages ?? []),
      ...(input.sections.instructionMessages ?? []),
      ...((input.sections.payloads ?? []).flatMap((payload) => payload.messages)),
      ...(input.sections.historyMessages ?? []),
      input.sections.latestUserMessage,
    ],
    payloads: [],
    audit: {
      policy: input.policy,
      model: "test-model",
      providerCode: "test-provider",
      modelContextTokens: 8192,
      reservedOutputTokens: 1024,
      maxInputTokens: 7168,
      totalEstimatedTokensBefore: 0,
      totalEstimatedTokensAfter: 0,
      sections: [],
      warnings: [],
    },
  }));
  vi.spyOn(providerProxyService, "describeChatInvocation").mockImplementation(
    (_requestedProvider, messages) => ({
      operation: "chat",
      providerCode: "test-provider",
      requestedProvider: "default",
      resolvedProvider: "default",
      model: "test-model",
      modelConfigId: "test-model-config",
      messageCount: messages.length,
      messagesPreview: [],
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("diagnostics closure explains workspace-local web_search hiding with blocked ids and scores", async () => {
  registerTool({
    definition: canonicalReadTool(),
    execute() {
      return {};
    },
  });
  registerTool({
    definition: webSearchTool(),
    execute() {
      return {};
    },
  });
  mockRecallOrder(["read"]);

  const result = await resolveHarnessCapabilityDiagnostics({
    query: "请打开 README.md 看看 Runtime 部分",
    source: "agent_intent",
  });

  assert.deepEqual(result.toolExposure.exposedToolIds, ["read", "web_search"]);
  assert.equal(result.blockedCapabilityIds.includes("web_search"), false);
  assert.equal(result.toolCandidates.length > 0, true);
  assert.equal(result.toolCandidates.some((candidate) => candidate.toolId === "read"), true);
});

test("diagnostics closure records planner and normalize reasons when the selected tool is not exposed", async () => {
  const canonicalRead = canonicalReadTool();
  const plannerEvents: Array<Record<string, unknown>> = [];
  const normalizeEvents: Array<Record<string, unknown>> = [];

  vi.spyOn(providerProxyService, "streamTaskChatText").mockImplementation(
    async function* () {
      yield '{"type":"use_tool","toolId":"terminal","args":{"command":"dir"},"reason":"Need terminal."}';
    },
  );

  const plannerPatch = await nextActionPlannerNode(
    {
      runId: "run-unexposed-planner",
      threadId: "thread-1",
      userId: 1,
      goal: baseGoal,
      plan: basePlan,
      messages: [makeMessage("open README.md")],
      toolExposure: {
        exposedTools: ["read"],
        toolMeta: [
          {
            toolId: canonicalRead.id,
            title: canonicalRead.title,
            description: canonicalRead.description,
            inputSchema: canonicalRead.inputSchema,
            domain: canonicalRead.domain,
            source: canonicalRead.source,
            tags: canonicalRead.tags,
            capabilities: canonicalRead.capabilities,
          },
        ],
      },
      evidence: { observations: [], retrievals: [], toolExecutions: [] },
      observations: [],
      iterationCount: 0,
      maxIterations: 3,
    },
    async (event) => {
      if (event.nodeId === "agent-next-action-planner" && event.phase === "done") {
        plannerEvents.push(event.details as Record<string, unknown>);
      }
    },
  );

  assert.equal(plannerPatch.nextAction?.type, "error");
  assert.match(String(plannerPatch.errorMessage ?? ""), /not exposed/i);
  assert.equal(plannerEvents[0]?.selectedActionType, "error");
  assert.match(String(plannerEvents[0]?.reason ?? ""), /not exposed/i);

  const normalizePatch = await toolCallNormalizeNode(
    {
      runId: "run-unexposed-normalize",
      threadId: "thread-1",
      userId: 1,
      goal: baseGoal,
      plan: basePlan,
      messages: [makeMessage("open README.md")],
      nextAction: {
        type: "use_tool",
        toolId: "terminal",
        args: { command: "dir" },
        reason: "Need terminal.",
      },
      toolExposure: {
        exposedTools: ["read"],
        toolMeta: [
          {
            toolId: canonicalRead.id,
            title: canonicalRead.title,
            description: canonicalRead.description,
            inputSchema: canonicalRead.inputSchema,
            domain: canonicalRead.domain,
            source: canonicalRead.source,
            tags: canonicalRead.tags,
            capabilities: canonicalRead.capabilities,
          },
        ],
      },
    },
    async (event) => {
      if (event.nodeId === "agent-tool-call-normalize" && event.phase === "error") {
        normalizeEvents.push(event.details as Record<string, unknown>);
      }
    },
  );

  assert.match(String(normalizePatch.errorMessage ?? ""), /not exposed/i);
  assert.match(String(normalizeEvents[0]?.reason ?? ""), /not exposed/i);
});

test("diagnostics closure keeps schema invalid bounded replan out of Generate", async () => {
  const canonicalRead = canonicalReadTool();
  setupToolExposure("open README.md", [canonicalRead]);
  vi.spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementationOnce(async function* () {
      yield '{"type":"use_tool","toolId":"read","args":{"missing":"README.md"},"reason":"Need file content."}';
    })
    .mockImplementationOnce(async function* () {
      yield '{"type":"use_tool","toolId":"read","args":{"missing":"README.md"},"reason":"Still invalid."}';
    });
  vi.spyOn(harnessInvocations, "executeHarnessInvocation");
  vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke");

  const normalizeErrors: Array<Record<string, unknown>> = [];
  const generateEvents: Array<Record<string, unknown>> = [];

  const result = await agentGraph.run({
    runId: "run-diagnostics-invalid-args",
    threadId: "thread-1",
    userId: 1,
    goal: {
      ...baseGoal,
      text: "open README.md",
    },
    plan: basePlan,
    workspaceRoot: "D:\\workspace\\rag-demo",
    messages: [makeMessage("open README.md")],
    onExecutionNode: async (event) => {
      if (event.nodeId === "agent-tool-call-normalize" && event.phase === "error") {
        normalizeErrors.push(event.details as Record<string, unknown>);
      }
      if (event.nodeId === "agent-generate" && event.phase === "done") {
        generateEvents.push(event.details as Record<string, unknown>);
      }
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.answer, "");
  assert.equal(normalizeErrors.length >= 2, true);
  assert.equal(normalizeErrors[0]?.schemaReplanEligible, true);
  assert.equal(normalizeErrors[0]?.schemaReplanAttemptCount, 1);
  assert.equal(generateEvents.length, 0);
});

test("diagnostics closure records runtime timedOut evidence as not answer-ready", async () => {
  const terminalSession = terminalTool();
  setupToolExposure("run pwd", [terminalSession]);
  vi.spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementationOnce(async function* () {
      yield '{"type":"use_tool","toolId":"terminal","args":{"command":"pwd"},"reason":"Need command output."}';
    })
    .mockImplementationOnce(async function* () {
      yield '{"type":"answer","reason":"Timeout evidence is not enough for a grounded command result.","completionProof":[{"criterion":"report the command outcome","evidenceRefs":["tool:0"]}],"unresolvedGaps":[]}';
    });
  vi.spyOn(policyModule, "evaluateAgentToolPolicy").mockReturnValue({
    type: "allow",
    reason: "Diagnostics regression allows terminal execution.",
  });
  const timedOutResult = {
    sessionId: "terminal-session-timeout-1",
    command: "pwd",
    cwd: "D:\\workspace\\rag-demo",
    exitCode: null,
    output: "",
    stdout: "",
    stderr: "Command timed out",
    timedOut: true,
    reusedSession: false,
    sessionMode: "ephemeral",
    streamMode: "split",
    stderrSeparated: true,
  };
  const timedOutEvidence = projectToolEvidence(
    terminalSession,
    normalizeToolResult({ structuredContent: timedOutResult }),
  );
  vi.spyOn(harnessInvocations, "executeHarnessInvocation").mockResolvedValue({
    id: "invocation-terminal-timeout-1",
    toolId: "terminal",
    status: "completed",
    result: timedOutResult,
    evidence: timedOutEvidence,
    startedAt: "2026-07-05T00:00:00.000Z",
    finishedAt: "2026-07-05T00:00:30.000Z",
  } as never);
  vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke").mockResolvedValue(
    "The command timed out before producing a stable result.",
  );

  const evidenceUpdateEvents: Array<Record<string, unknown>> = [];
  const policyEvents: Array<Record<string, unknown>> = [];
  const result = await agentGraph.run({
    runId: "run-diagnostics-timeout",
    threadId: "thread-1",
    userId: 1,
    goal: {
      ...baseGoal,
      text: "run pwd",
    },
    plan: basePlan,
    workspaceRoot: "D:\\workspace\\rag-demo",
    messages: [makeMessage("run pwd")],
    onExecutionNode: async (event) => {
      if (event.nodeId.startsWith("agent-policy") && event.phase === "done") {
        policyEvents.push(event.details as Record<string, unknown>);
      }
      if (
        (event.nodeId === "agent-evidence-update-tool" || event.nodeId === "agent-evidence") &&
        event.phase === "done"
      ) {
        evidenceUpdateEvents.push(event.details as Record<string, unknown>);
      }
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(policyEvents.some((details) => details.decisionType === "allow"), true);
  assert.equal(result.evidence.latestSummary?.answerReadiness, undefined);
  assert.match(result.evidence.latestSummary?.gaps?.join(" ") ?? "", /finish|complete|stable/i);
  assert.equal(result.evidence.latestSummary?.data?.kind, "terminal_session");
  if (result.evidence.latestSummary?.data?.kind === "terminal_session") {
    assert.equal(result.evidence.latestSummary.data.timedOut, true);
  }
  assert.equal(
    evidenceUpdateEvents.some(
      (details) =>
        Boolean(details.latestEvidenceSummary) &&
        (details.latestEvidenceSummary as { data?: { timedOut?: boolean } }).data?.timedOut === true,
    ),
    true,
  );
});

test("Generate does not replace Planner's semantic decision with a second evidence judgment", async () => {
  vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke").mockResolvedValue(
    "当前 workspace 下有 README.md、docs、server，我已经查看过它们的内容。",
  );

  const generateEvents: Array<Record<string, unknown>> = [];
  const finalizationPacket = {
    type: "answer" as const,
    reason: "Planner decided the direct answer criterion is covered.",
    completionProof: [
      { criterion: "answer the user's question directly", evidenceRefs: [] },
    ],
    unresolvedGaps: [],
  };
  const patch = await generateNode(
    {
      runId: "run-diagnostics-generate-guard",
      threadId: "thread-1",
      userId: 1,

      goal: {
        ...baseGoal,
        text: "那结论是什么",
      },
      plan: basePlan,
      workspaceRoot: "D:\\workspace\\rag-demo",
      messages: [makeMessage("那结论是什么")],
      evidence: {
        observations: [],
        retrievals: [],
        toolExecutions: [],
      },
      observations: [],
      nextAction: finalizationPacket,
      finalizationPacket,
    },
    async (event) => {
      if (event.nodeId === "agent-generate" && event.phase === "done") {
        generateEvents.push(event.details as Record<string, unknown>);
      }
    },
  );

  assert.equal(
    patch.answer,
    "当前 workspace 下有 README.md、docs、server，我已经查看过它们的内容。",
  );
  assert.equal(generateEvents.at(-1)?.outputGuardTriggered, false);
});
