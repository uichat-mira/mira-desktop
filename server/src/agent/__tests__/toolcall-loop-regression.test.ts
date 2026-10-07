import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, beforeEach, test, vi } from "vitest";
import { initializeAuthDatabase } from "@/db/auth.db";
import { resetDatabaseClients } from "@/db/index.js";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import * as harnessInvocations from "@/harness/invocations";
import * as registry from "@/harness/registry";
import { contextBudgetService } from "@/services/context-budget/index";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import * as intentMatcherModule from "../intent/embedding-capability-matcher";

import * as policyModule from "../policy";
import * as runnablesModule from "../runnables";
import { agentGraph } from "../graph";
import type { AgentGraphOutput } from "../types";
import { normalizeToolResult, projectToolEvidence } from "@/mcp/core/tool-result.js";

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

const originalDatabaseUrl = process.env.DATABASE_URL;
const testDbPath = createTimestampedTestArtifactPath(
  "db",
  "toolcall-loop-regression",
  ".sqlite",
);

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

const readOpenTool = () =>
  makeToolDefinition({
    id: "read_open",
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

const setupGenerate = (answer = "final answer") =>
  vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke").mockResolvedValue(answer);

const completedReadOpenInvocation = (text = "# README\n\nUIChat Mira runtime docs.") =>
  ({
    id: "invocation-read-open-1",
    toolId: "read_open",
    status: "completed" as const,
    result: {
      type: "open",
      path: "README.md",
      source: {
        kind: "text",
        mimeType: "text/markdown",
        text,
        metadata: {},
      },
    },
    startedAt: "2026-07-05T00:00:00.000Z",
    finishedAt: "2026-07-05T00:00:01.000Z",
  }) as const;

const completedTimedOutTerminalInvocation = () => {
  const result = {
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
  return ({
    id: "invocation-terminal-timeout-1",
    toolId: "terminal",
    status: "completed" as const,
    result,
    evidence: projectToolEvidence(
      { id: "terminal", source: "internal", domain: "terminal" },
      normalizeToolResult({ structuredContent: result }),
    ),
    startedAt: "2026-07-05T00:00:00.000Z",
    finishedAt: "2026-07-05T00:00:30.000Z",
  }) as const;
};

const runToolLoop = (input: {
  runId: string;
  question: string;
  maxIterations?: number;
  onExecutionNode?: Parameters<typeof agentGraph.run>[0]["onExecutionNode"];
}) =>
  agentGraph.run({
    runId: input.runId,
    threadId: "thread-1",
    userId: 1,
    goal: {
      ...baseGoal,
      text: input.question,
    },
    plan: basePlan,
    messages: [makeMessage(input.question)],
    workspaceRoot: "D:\\workspace\\rag-demo",
    maxIterations: input.maxIterations,
    onExecutionNode: input.onExecutionNode,
  });

const assertMatrixFields = (
  result: AgentGraphOutput,
  expected: {
    status: AgentGraphOutput["status"];
    pendingToolCall: "present" | "absent";
    pendingApproval: "present" | "absent";
    lastToolExecution: "present" | "absent";
    latestSummary: "present" | "absent";
    terminalField: "answer" | "blockedReason" | "errorMessage" | "none";
  },
) => {
  assert.equal(result.status, expected.status);
  assert.equal(Boolean(result.pendingToolCall), expected.pendingToolCall === "present");
  assert.equal(Boolean(result.pendingApproval), expected.pendingApproval === "present");
  assert.equal(Boolean(result.lastToolExecution), expected.lastToolExecution === "present");
  assert.equal(Boolean(result.evidence.latestSummary), expected.latestSummary === "present");
  if (expected.terminalField === "answer") {
    assert.notEqual(result.answer.trim(), "");
  } else if (expected.terminalField === "blockedReason") {
    assert.notEqual((result.blockedReason ?? "").trim(), "");
  } else if (expected.terminalField === "errorMessage") {
    assert.notEqual((result.errorMessage ?? "").trim(), "");
  } else {
    assert.equal(result.answer, "");
  }
};

beforeEach(() => {
  process.env.DATABASE_URL = `file:${testDbPath}`;
  resetDatabaseClients();
  initializeAuthDatabase();
  initializeModelConfigDatabase();
  initializeKnowledgeBaseDatabase();
  initializeThreadDatabase();
  initializeRoleDatabase();
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
  resetDatabaseClients();
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // ignore cleanup failure on Windows file locking
  }
  if (originalDatabaseUrl) {
    process.env.DATABASE_URL = originalDatabaseUrl;
  } else {
    delete process.env.DATABASE_URL;
  }
});

test("toolCall loop ignores selectedToolIds unless planner emits use_tool", async () => {
  const readOpen = readOpenTool();
  setupToolExposure("answer directly", [readOpen]);
  const plannerSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"answer","reason":"No tool is needed.","completionProof":[{"criterion":"answer directly","evidenceRefs":[]}],"unresolvedGaps":[]}';
    });
  const executeSpy = vi.spyOn(harnessInvocations, "executeHarnessInvocation");
  const generateSpy = setupGenerate("direct answer");
  const normalizeEvents: Array<Record<string, unknown>> = [];
  const toolSelectEvents: Array<Record<string, unknown>> = [];

  const result = await runToolLoop({
    runId: "run-regression-selected-toolids-no-exec",
    question: "answer directly",
    onExecutionNode: async (event) => {
      if (event.nodeId === "agent-tool-call-normalize") {
        normalizeEvents.push(event.details as Record<string, unknown>);
      }
      if (event.nodeId.startsWith("agent-tool-select") && event.phase === "done") {
        toolSelectEvents.push(event.details as Record<string, unknown>);
      }
    },
  });

  assertMatrixFields(result, {
    status: "completed",
    pendingToolCall: "absent",
    pendingApproval: "absent",
    lastToolExecution: "absent",
    latestSummary: "absent",
    terminalField: "answer",
  });
  assert.equal(plannerSpy.mock.calls.length, 1);
  assert.equal(executeSpy.mock.calls.length, 0);
  assert.equal(generateSpy.mock.calls.length, 1);
  assert.equal(normalizeEvents.length, 0);
});

test("toolCall loop policy deny does not execute the tool", async () => {
  const readOpen = readOpenTool();
  setupToolExposure("open README.md", [readOpen]);
  vi.spyOn(providerProxyService, "streamTaskChatText").mockImplementation(
    async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need file content."}';
    },
  );
  vi.spyOn(policyModule, "evaluateAgentToolPolicy").mockReturnValue({
    type: "deny",
    reason: "read_open is denied in this regression case.",
  });
  const executeSpy = vi.spyOn(harnessInvocations, "executeHarnessInvocation");
  const generateSpy = vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke");

  const result = await runToolLoop({
    runId: "run-regression-policy-deny",
    question: "open README.md",
  });

  assertMatrixFields(result, {
    status: "failed",
    pendingToolCall: "absent",
    pendingApproval: "absent",
    lastToolExecution: "absent",
    latestSummary: "absent",
    terminalField: "errorMessage",
  });
  assert.equal(result.policyDecision?.type, "deny");
  assert.equal(executeSpy.mock.calls.length, 0);
  assert.equal(generateSpy.mock.calls.length, 0);
  assert.equal(result.lastToolExecution, undefined);
  assert.equal(result.evidence.latestSummary, undefined);
});

test("toolCall loop policy approval stops at waiting_approval without ToolNode execution", async () => {
  const terminalSession = terminalTool();
  setupToolExposure("run dir", [terminalSession]);
  vi.spyOn(providerProxyService, "streamTaskChatText").mockImplementation(
    async function* () {
      yield '{"type":"use_tool","toolId":"terminal","args":{"command":"dir"},"reason":"Need command output."}';
    },
  );
  const executeSpy = vi.spyOn(harnessInvocations, "executeHarnessInvocation");
  const generateSpy = vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke");

  const result = await runToolLoop({
    runId: "run-regression-policy-approval",
    question: "run dir",
  });

  assertMatrixFields(result, {
    status: "waiting_approval",
    pendingToolCall: "present",
    pendingApproval: "present",
    lastToolExecution: "absent",
    latestSummary: "absent",
    terminalField: "none",
  });
  assert.equal(result.policyDecision?.type, "require_approval");
  assert.equal(result.pendingApproval?.toolCallId, "id" in result.pendingToolCall! ? result.pendingToolCall.id : undefined);
  assert.equal(executeSpy.mock.calls.length, 0);
  assert.equal(generateSpy.mock.calls.length, 0);

});

test("toolCall loop reports Harness awaiting approval as an owner-contract failure", async () => {
  const readOpen = readOpenTool();
  setupToolExposure("open README.md", [readOpen]);
  vi.spyOn(providerProxyService, "streamTaskChatText").mockImplementation(
    async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need file content."}';
    },
  );
  const executeSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-read-open-awaiting-approval",
      toolId: "read_open",
      status: "awaiting_approval",
      approval: {
        reason: "read_open requires Harness approval.",
      },
      startedAt: "2026-07-05T00:00:00.000Z",
    } as never);

  const result = await runToolLoop({
    runId: "run-regression-harness-approval",
    question: "open README.md",
  });

  assertMatrixFields(result, {
    status: "failed",
    pendingToolCall: "present",
    pendingApproval: "absent",
    lastToolExecution: "present",
    latestSummary: "present",
    terminalField: "errorMessage",
  });
  assert.equal(executeSpy.mock.calls.length, 1);
  assert.equal(result.lastToolExecution?.status, "awaiting_approval");
  assert.equal(result.evidence.latestSummary?.status, "blocked");
  assert.equal(result.evidence.latestSummary?.answerReadiness, undefined);
  assert.match(result.errorMessage ?? "", /Policy must create pendingApproval/i);
});

test("toolCall loop lets Planner decide how to proceed after recoverable failure", async () => {
  const readOpen = readOpenTool();
  setupToolExposure("open README.md", [readOpen]);
  vi.spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementationOnce(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need file content."}';
    })
    .mockImplementationOnce(async function* () {
      yield '{"type":"answer","reason":"There is still no completed evidence to answer from.","completionProof":[{"criterion":"report the failed read","evidenceRefs":["tool:0"]}],"unresolvedGaps":[]}';
    });
  const executeSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-read-open-failed",
      toolId: "read_open",
      status: "failed",
      error: {
        message: "File not found",
      },
      startedAt: "2026-07-05T00:00:00.000Z",
      finishedAt: "2026-07-05T00:00:01.000Z",
    } as never);
  const generateSpy = setupGenerate(
    "README.md could not be opened because the file was not found.",
  );

  const result = await runToolLoop({
    runId: "run-regression-failed-tool",
    question: "open README.md",
  });

  assertMatrixFields(result, {
    status: "completed",
    pendingToolCall: "absent",
    pendingApproval: "absent",
    lastToolExecution: "present",
    latestSummary: "present",
    terminalField: "answer",
  });
  assert.equal(executeSpy.mock.calls.length, 1);
  assert.equal(generateSpy.mock.calls.length, 1);
  assert.match(result.answer, /not found/i);
  assert.equal(result.lastToolExecution?.status, "failed");
  assert.equal(result.lastToolExecution?.failureKind, "recoverable");
  assert.equal(result.evidence.latestSummary?.status, "failed");
  assert.equal(result.evidence.latestSummary?.answerReadiness, undefined);
}, 15000);

test("toolCall loop terminal failed tool still fails the graph and does not generate a guarded answer", async () => {
  const readOpen = readOpenTool();
  setupToolExposure("open README.md", [readOpen]);
  vi.spyOn(providerProxyService, "streamTaskChatText").mockImplementation(
    async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need file content."}';
    },
  );
  const executeSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-read-open-terminal-failed",
      toolId: "read_open",
      status: "failed",
      error: {
        message: "Tool protocol mismatch: result payload is invalid",
      },
      startedAt: "2026-07-05T00:00:00.000Z",
      finishedAt: "2026-07-05T00:00:01.000Z",
    } as never);
  const generateSpy = vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke");

  const result = await runToolLoop({
    runId: "run-regression-terminal-failed-tool",
    question: "open README.md",
  });

  assertMatrixFields(result, {
    status: "failed",
    pendingToolCall: "absent",
    pendingApproval: "absent",
    lastToolExecution: "present",
    latestSummary: "present",
    terminalField: "errorMessage",
  });
  assert.equal(executeSpy.mock.calls.length, 1);
  assert.equal(generateSpy.mock.calls.length, 0);
  assert.equal(result.lastToolExecution?.status, "failed");
  assert.equal(result.lastToolExecution?.failureKind, "terminal");
  assert.equal(result.evidence.latestSummary?.status, "failed");
  assert.equal(result.evidence.latestSummary?.answerReadiness, undefined);
  assert.match(result.errorMessage ?? "", /protocol mismatch/i);
  assert.match(result.terminalReason ?? "", /protocol mismatch/i);
  assert.equal(result.answer, "");
});

test("toolCall loop timedOut tool evidence is not marked answer-ready", async () => {
  const terminalSession = terminalTool();
  setupToolExposure("execute shell command pwd and show stdout", [terminalSession]);
  vi.spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementationOnce(async function* () {
      yield '{"type":"use_tool","toolId":"terminal","args":{"command":"pwd"},"reason":"Need command output."}';
    })
    .mockImplementationOnce(async function* () {
      yield '{"type":"answer","reason":"Timeout evidence is not enough for a grounded command result.","completionProof":[{"criterion":"report the command outcome","evidenceRefs":["tool:0"]}],"unresolvedGaps":[]}';
    });
  vi.spyOn(policyModule, "evaluateAgentToolPolicy").mockReturnValue({
    type: "allow",
    reason: "Regression case allows terminal execution to inspect timeout evidence.",
  });
  const executeSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue(completedTimedOutTerminalInvocation());
  const generateSpy = setupGenerate("The command timed out before producing a stable result.");

  const result = await runToolLoop({
    runId: "run-regression-timedout-tool",
    question: "execute shell command pwd and show stdout",
  });

  assertMatrixFields(result, {
    status: "completed",
    pendingToolCall: "absent",
    pendingApproval: "absent",
    lastToolExecution: "present",
    latestSummary: "present",
    terminalField: "answer",
  });
  assert.equal(executeSpy.mock.calls.length, 1);
  assert.equal(generateSpy.mock.calls.length, 1);
  assert.equal(result.lastToolExecution?.status, "completed");
  assert.equal(result.evidence.latestSummary?.status, "timed_out");
  assert.equal(result.evidence.latestSummary?.toolId, "terminal");
  assert.equal(result.evidence.latestSummary?.answerReadiness, undefined);
  assert.match(result.evidence.latestSummary?.gaps?.join(" ") ?? "", /finish|complete|stable/i);
  assert.equal(result.evidence.latestSummary?.data?.kind, "terminal_session");
  if (result.evidence.latestSummary?.data?.kind === "terminal_session") {
    assert.equal(result.evidence.latestSummary.data.processCompleted, false);
    assert.equal(result.evidence.latestSummary.data.commandSucceeded, "unknown");
    assert.equal(result.evidence.latestSummary.data.timedOut, true);
    assert.equal(result.evidence.latestSummary.data.outputInterpretable, false);
  }
});
