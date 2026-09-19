import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import * as harnessInvocations from "@/harness/invocations";
import * as registry from "@/harness/registry";
import { contextBudgetService } from "@/services/context-budget/index";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import * as intentMatcherModule from "../intent/embedding-capability-matcher";

import * as runnablesModule from "../runnables";
import { agentGraph } from "../graph";
import {
  __resetAgentTracingForTests,
  __setAgentTraceSinkForTests,
  flushAgentTracing,
  type AgentTraceRecord,
} from "../observability";

const baseGoal = {
  id: "goal-obs-1",
  text: "inspect the workspace",
  successCriteria: ["return an answer"],
  constraints: ["stay safe"],
  riskLevel: "low" as const,
};

const basePlan = {
  id: "plan-obs-1",
  goalId: "goal-obs-1",
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
    requiresApproval: false,
  },
});

const makeToolIntentResult = (input: {
  query: string;
  toolId: string;
  domain: string;
  exposedDefinitions: Array<ReturnType<typeof makeToolDefinition>>;
}) => ({
  query: input.query,
  topCandidates: [
    {
      toolId: input.toolId,
      title: input.toolId,
      description: input.toolId,
      domain: input.domain,
      source: "internal" as const,
      tags: [input.domain],
      score: 0.9,
      embeddingScore: 0.9,
      ruleScore: 0,
      rerankScore: 0.9,
      finalScore: 0.9,
    },
  ],
  toolCandidates: [
    {
      toolId: input.toolId,
      title: input.toolId,
      description: input.toolId,
      domain: input.domain,
      source: "internal" as const,
      tags: [input.domain],
      score: 0.9,
      embeddingScore: 0.9,
      ruleScore: 0,
      rerankScore: 0.9,
      finalScore: 0.9,
    },
  ],
  toolExposure: {
    exposedToolIds: input.exposedDefinitions.map((definition) => definition.id),
    exposedDefinitions: input.exposedDefinitions,
    reason: [],
    blockedCapabilityIds: [],
  },});

beforeEach(() => {
  vi.spyOn(contextBudgetService, "pack").mockImplementation((input) => {
    const messages = [
      ...(input.sections.prefaceMessages ?? []),
      ...(input.sections.instructionMessages ?? []),
      ...((input.sections.payloads ?? []).flatMap((payload) => payload.messages)),
      ...(input.sections.historyMessages ?? []),
      input.sections.latestUserMessage,
    ];

    return {
      messages,
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
    };
  });

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


afterEach(async () => {
  delete process.env.AGENT_TRACE_PHOENIX;
  delete process.env.AGENT_TRACE_VERBOSE;
  delete process.env.PHOENIX_COLLECTOR_ENDPOINT;
  delete process.env.AGENT_TRACE_PROJECT;
  __setAgentTraceSinkForTests(undefined);
  await __resetAgentTracingForTests();
  vi.restoreAllMocks();
});

test("agentGraph tracing stays disabled by default", async () => {
  const records: AgentTraceRecord[] = [];
  const readOpen = makeToolDefinition({
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
  });

  __setAgentTraceSinkForTests((record) => {
    records.push(record);
  });
  vi.spyOn(registry, "listCapabilityDefinitions").mockReturnValue([readOpen]);
  vi.spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding").mockResolvedValue(
    makeToolIntentResult({
      query: "open README.md",
      toolId: "read_open",
      domain: "read",
      exposedDefinitions: [readOpen],
    }),
  );
  vi.spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementationOnce(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need the file content."}';
    })
    .mockImplementationOnce(async function* () {
      yield '{"type":"answer","reason":"The opened README facts are sufficient.","completionProof":[{"criterion":"answer from README","evidenceRefs":["tool:0"]}],"unresolvedGaps":[]}';
    });
  vi.spyOn(harnessInvocations, "executeHarnessInvocation").mockResolvedValue({
    id: "invocation-read-open-obs",
    toolId: "read_open",
    status: "completed",
    result: {
      type: "open",
      path: "README.md",
      source: {
        kind: "text",
        mimeType: "text/markdown",
        text: "# README\n\nProject overview",
        metadata: {},
      },
    },
    startedAt: "2026-07-04T00:00:00.000Z",
    finishedAt: "2026-07-04T00:00:01.000Z",
  });
  vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke").mockResolvedValue(
    "README summary",
  );

  const result = await agentGraph.run({
    runId: "run-obs-disabled",
    threadId: "thread-obs-1",
    userId: 1,
    goal: baseGoal,
    plan: basePlan,
    messages: [makeMessage("open README.md")],
  });

  assert.equal(result.status, "completed");
  assert.equal(records.length, 0);
});

test("agentGraph tracing emits sanitized Phoenix-ready node spans when enabled", async () => {
  const records: AgentTraceRecord[] = [];
  process.env.AGENT_TRACE_PHOENIX = "true";
  process.env.AGENT_TRACE_VERBOSE = "true";
  process.env.PHOENIX_COLLECTOR_ENDPOINT = "http://localhost:6006";
  process.env.AGENT_TRACE_PROJECT = "uichat-mira-dev";

  const readOpen = makeToolDefinition({
    id: "read_open",
    domain: "read",
    inputSchema: {
      type: "object",
      required: ["path", "apiKey", "nested"],
      properties: {
        path: { type: "string" },
        apiKey: { type: "string" },
        nested: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  });

  __setAgentTraceSinkForTests((record) => {
    records.push(record);
  });
  vi.spyOn(registry, "listCapabilityDefinitions").mockReturnValue([readOpen]);
  vi.spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding").mockResolvedValue(
    makeToolIntentResult({
      query: "open README.md",
      toolId: "read_open",
      domain: "read",
      exposedDefinitions: [readOpen],
    }),
  );
  vi.spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementationOnce(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md","apiKey":"sk-secret-123456789","nested":{"token":"Bearer super-secret-token"}},"reason":"Need the file content."}';
    })
    .mockImplementationOnce(async function* () {
      yield '{"type":"answer","reason":"The opened README facts are sufficient.","completionProof":[{"criterion":"answer from README","evidenceRefs":["tool:0"]}],"unresolvedGaps":[]}';
    });
  vi.spyOn(harnessInvocations, "executeHarnessInvocation").mockResolvedValue({
    id: "invocation-read-open-obs",
    toolId: "read_open",
    status: "completed",
    result: {
      type: "open",
      path: "README.md",
      source: {
        kind: "text",
        mimeType: "text/markdown",
        text: "# README\n\nObservability note",
        metadata: {
          apiKey: "sk-secret-should-not-leak",
        },
      },
    },
    startedAt: "2026-07-04T00:00:00.000Z",
    finishedAt: "2026-07-04T00:00:01.000Z",
  });
  vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke").mockResolvedValue(
    "README observability summary",
  );

  const result = await agentGraph.run({
    runId: "run-obs-enabled",
    threadId: "thread-obs-2",
    userId: 7,
    goal: {
      ...baseGoal,
      text: "open README.md",
    },
    plan: basePlan,
    messages: [makeMessage("open README.md")],
  });

  await flushAgentTracing();

  assert.equal(result.status, "completed");
  assert.equal(records.some((record) => record.name === "agent.graph.run"), true);
  assert.equal(
    records.some((record) => record.name === "agent.node.prepareContext"),
    true,
  );
  assert.equal(
    records.some((record) => record.name === "agent.node.toolCallNormalize"),
    true,
  );
  assert.equal(records.some((record) => record.name === "agent.node.tool"), true);
  const toolRecord = records.find((record) => record.name === "agent.node.tool");
  const toolVerboseJson = String(
    toolRecord?.attributes["agent.state.after.verbose_json"] ?? "",
  );
  assert.equal(toolVerboseJson.includes("sk-secret-123456789"), false);
  assert.equal(toolVerboseJson.includes("super-secret-token"), false);
  assert.equal(toolVerboseJson.includes("[REDACTED]"), true);
  assert.equal(
    String(toolRecord?.attributes["agent.node_status"] ?? ""),
    "ok",
  );
});
