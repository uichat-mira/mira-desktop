import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { subscribeToLogLines } from "@/logger";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import {
  buildPlannerObservationContext,
  type AgentNodeState,
} from "../node-runtime";
import { createInvocationInputHash } from "../approval-fingerprint";
import { DEFAULT_AGENT_MAX_RECOVERY_ATTEMPTS } from "../recovery";
import {
  GENERIC_TASK_DELEGATE_TOOL_ID,
  withGenericTaskDelegationTool,
} from "../delegation/contract";
import { buildNextActionPlannerMessages } from "../planner/prompt";
import {
  nextActionPlannerNode,
  parseNextActionPlannerOutput,
} from "../nodes/next-action-planner";

const createState = (
  overrides: Partial<AgentNodeState> = {},
): AgentNodeState => ({
  runId: "run-1",
  threadId: "thread-1",
  userId: 1,
  goal: {
    id: "goal-1",
    text: "answer the user",
    successCriteria: ["answer"],
    constraints: ["safe"],
    riskLevel: "low",
  },
  question: "What should we do next?",
  messages: [
    {
      role: "user",
      content: "What should we do next?",
      parts: [{ type: "text", text: "What should we do next?" }],
    },
  ],
  toolExposure: {
    exposedTools: ["read_open", "web_search"],
    toolMeta: [
      {
        toolId: "read_open",
        title: "Read Open",
        description: "Open a workspace file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        domain: "read",
        source: "internal",
        tags: ["read"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      {
        toolId: "web_search",
        title: "Web Search",
        description: "Search the public web",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        domain: "web_search",
        source: "internal",
        tags: ["web"],
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
        },
      },
    ],
  },
  evidence: {
    observations: [],
    retrievals: [],
    toolExecutions: [],
  },
  iterationCount: 0,
  maxIterations: 3,
  ...overrides,
});

const readmeArgsHash = createInvocationInputHash({
  toolId: "read_open",
  args: { path: "README.md" },
  source: "planner",
});

const readListDotArgsHash = createInvocationInputHash({
  toolId: "read_list",
  args: { path: "." },
  source: "planner",
});

const baseToolExposure = createState().toolExposure!;

const readListToolMeta = {
  toolId: "read_list",
  title: "Read List",
  description: "List a workspace directory",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
  domain: "read",
  source: "internal",
  tags: ["read"],
  capabilities: {
    sideEffect: "none" as const,
    requiresApproval: false,
  },
};

test("buildPlannerObservationContext handles empty planner state", () => {
  const context = buildPlannerObservationContext(
    createState({
      currentTaskFrame: undefined,
      observations: undefined,
      evidence: undefined,
      lastToolExecution: undefined,
      pendingApproval: undefined,
      schemaReplanDiagnostics: undefined,
    }),
  );

  assert.equal(context.currentTaskFrame, undefined);
  assert.equal(context.latestObservation, undefined);
  assert.deepEqual(context.recentObservations, []);
  assert.equal(context.latestEvidenceSummary, undefined);
  assert.equal(context.latestToolCall, undefined);
  assert.equal(context.taskCoverageView, undefined);
  assert.deepEqual(context.recovery, {
    source: "none",
    attemptCount: 0,
    maxAttempts: 1,
    exhausted: false,
  });
  assert.equal(context.pendingApproval, undefined);
});

test("buildPlannerObservationContext reads completed tool facts from evidence.toolExecutions", () => {
  const context = buildPlannerObservationContext(
    createState({
      evidence: {
        observations: [],
        retrievals: [],
        toolExecutions: [
          {
            toolId: "read_open",
            args: { path: "README.md" },
            status: "completed",
            summary: {
              source: "tool",
              status: "completed",
              toolId: "read_open",
              actionTaken: "Opened README.md.",
              keyFindings: ["contentLength=120"],
              answerReadiness: {
                canAnswer: true,
                reason: "Opened file content is available for answer generation.",
              },
            },
            startedAt: "2026-07-06T10:00:00.000Z",
            finishedAt: "2026-07-06T10:00:01.000Z",
          },
        ],
      },
      observations: undefined,
    }),
  );

  assert.equal(context.latestObservation?.source, "tool_execution");
  assert.equal(context.latestObservation?.actionType, "tool");
  assert.equal(context.latestObservation?.toolId, "read_open");
  assert.equal(context.latestObservation?.status, "completed");
  assert.deepEqual(context.latestObservation?.argsPreview, { path: "README.md" });
  assert.equal(context.latestObservation?.summary?.toolId, "read_open");
  assert.equal(context.latestToolCall?.toolId, "read_open");
});

test("buildPlannerObservationContext exposes generic structured data without the raw result", () => {
  const context = buildPlannerObservationContext(
    createState({
      evidence: {
        observations: [],
        retrievals: [],
        toolExecutions: [
          {
            toolId: "browser_observe",
            args: { url: "https://example.com" },
            status: "completed",
            result: {
              page: { title: "Example Domain" },
              observation: { visibleText: "Example Domain content" },
              privateRawDom: "must not reach planner",
            },
            summary: {
              source: "tool",
              status: "completed",
              toolId: "browser_observe",
              actionTaken: "Completed managed browser observe.",
              keyFindings: ["title=Example Domain", "visibleText=Example Domain content"],
              facts: ["title=Example Domain", "visibleText=Example Domain content"],
              data: {
                kind: "generic_structured",
                preview: {
                  title: "Example Domain",
                  visibleText: "Example Domain content",
                },
                truncated: false,
                redacted: false,
                unsupported: false,
              },
            },
            startedAt: "2026-07-15T00:00:00.000Z",
            finishedAt: "2026-07-15T00:00:01.000Z",
          },
        ],
      },
      observations: undefined,
    }),
  );

  assert.deepEqual(context.latestObservation?.resultPreview, {
    kind: "generic_structured",
    preview: {
      title: "Example Domain",
      visibleText: "Example Domain content",
    },
    truncated: false,
    redacted: false,
    unsupported: false,
  });
  assert.doesNotMatch(JSON.stringify(context.latestObservation?.resultPreview), /privateRawDom/);
  assert.deepEqual(context.latestToolCall?.resultSummary?.data, context.latestObservation?.resultPreview);
});

test("buildPlannerObservationContext does not use lastToolExecution as a planner fact source after Evidence", () => {
  const context = buildPlannerObservationContext(
    createState({
      lastToolExecution: {
        toolId: "read_open",
        args: { path: "README.md" },
        status: "completed",
        summary: {
          source: "tool",
          status: "completed",
          toolId: "read_open",
          actionTaken: "Opened README.md.",
          keyFindings: ["contentLength=120"],
        },
        startedAt: "2026-07-06T10:00:00.000Z",
        finishedAt: "2026-07-06T10:00:01.000Z",
      },
      evidence: {
        observations: [],
        retrievals: [],
        toolExecutions: [],
      },
      observations: undefined,
    }),
  );

  assert.equal(context.latestObservation, undefined);
  assert.equal(context.latestToolCall, undefined);
});

test("buildPlannerObservationContext keeps terminal tool failure from evidence as failed_terminal", () => {
  const context = buildPlannerObservationContext(
    createState({
      evidence: {
        observations: [],
        retrievals: [],
        toolExecutions: [
          {
            toolCallId: "tool-call-terminal-failed",
            toolId: "read_open",
            inputHash: "hash-read-open-terminal",
            args: { path: "README.md" },
            status: "failed",
            failureKind: "terminal",
            errorMessage: "Tool protocol mismatch: result payload is invalid",
            startedAt: "2026-07-06T10:00:00.000Z",
            finishedAt: "2026-07-06T10:00:01.000Z",
          },
        ],
      },
      observations: undefined,
    }),
  );

  assert.equal(context.latestObservation?.source, "tool_execution");
  assert.equal(context.latestObservation?.actionType, "tool");
  assert.equal(context.latestObservation?.status, "failed_terminal");
  assert.equal(context.latestObservation?.recoverable, false);
  assert.deepEqual(context.latestObservation?.suggestedNextActions, [
    "report_terminal_failure",
  ]);
});

test("buildPlannerObservationContext keeps recoverable tool failure from evidence as failed_recoverable", () => {
  const context = buildPlannerObservationContext(
    createState({
      lastToolExecution: {
        toolCallId: "tool-call-recoverable-failed",
        toolId: "read_open",
        inputHash: "hash-read-open-recoverable",
        args: { path: "missing.md" },
        status: "failed",
        failureKind: "recoverable",
        recoveryAttemptCount: 1,
        errorMessage: "File not found",
        startedAt: "2026-07-06T10:00:00.000Z",
        finishedAt: "2026-07-06T10:00:01.000Z",
      },
      evidence: {
        observations: [],
        retrievals: [],
        toolExecutions: [
          {
            toolCallId: "tool-call-recoverable-failed",
            toolId: "read_open",
            inputHash: "hash-read-open-recoverable",
            args: { path: "missing.md" },
            status: "failed",
            failureKind: "recoverable",
            recoveryAttemptCount: 1,
            errorMessage: "File not found",
            startedAt: "2026-07-06T10:00:00.000Z",
            finishedAt: "2026-07-06T10:00:01.000Z",
          },
        ],
      },
      observations: undefined,
    }),
  );

  assert.equal(context.latestObservation?.source, "tool_execution");
  assert.equal(context.latestObservation?.actionType, "tool");
  assert.equal(context.latestObservation?.status, "failed_recoverable");
  assert.equal(context.latestObservation?.recoverable, true);
  assert.deepEqual(context.latestObservation?.suggestedNextActions, [
    "inspect_failure_cause",
    "retry_with_adjustment",
    "switch_action",
  ]);
  assert.deepEqual(context.recovery, {
    source: "tool_failure",
    attemptCount: 1,
    maxAttempts: DEFAULT_AGENT_MAX_RECOVERY_ATTEMPTS,
    exhausted: false,
    toolId: "read_open",
    inputHash: "hash-read-open-recoverable",
    errorMessage: "File not found",
    failureKind: "recoverable",
  });
});

test("buildPlannerObservationContext includes pendingApproval in both approval view and recent observations", () => {
  const context = buildPlannerObservationContext(
    createState({
      pendingApproval: {
        id: "approval-1",
        runId: "run-1",
        stepId: "approval",
        toolId: "terminal_session",
        toolCallId: "tool-call-1",
        inputHash: "hash-1",
        reason: "Needs approval before running.",
        createdAt: "2026-07-06T10:00:02.000Z",
      },
      evidence: undefined,
      observations: undefined,
    }),
  );

  assert.deepEqual(context.pendingApproval, {
    toolId: "terminal_session",
    inputHash: "hash-1",
    reason: "Needs approval before running.",
  });
  assert.equal(context.latestObservation?.source, "approval");
  assert.equal(context.latestObservation?.actionType, "approval");
  assert.equal(context.latestObservation?.toolId, "terminal_session");
  assert.equal(context.latestObservation?.status, "waiting_approval");
  assert.deepEqual(context.latestObservation?.suggestedNextActions, [
    "wait_for_approval",
    "resume_after_approval",
  ]);
});

test("buildPlannerObservationContext maps retrieve results into unified execution observations", () => {
  const context = buildPlannerObservationContext(
    createState({
      evidence: {
        observations: [],
        retrievals: [
          {
            knowledgeBaseId: "kb-1",
            query: "inspect docs",
            chunkCount: 1,
            chunks: [
              {
                chunkId: "c1",
                documentName: "README.md",
                content: "doc one",
              },
            ],
            createdAt: "2026-07-06T10:00:00.000Z",
          },
        ],
        toolExecutions: [],
      },
      lastToolExecution: undefined,
      pendingApproval: undefined,
    }),
  );

  assert.equal(context.latestObservation?.source, "retrieval");
  assert.equal(context.latestObservation?.actionType, "retrieve");
  assert.equal(context.latestObservation?.status, "completed");
  assert.deepEqual(context.latestObservation?.resultPreview, {
    query: "inspect docs",
    chunkCount: 1,
    documents: ["README.md"],
  });
});

test("buildPlannerObservationContext carries recovery diagnostics into a unified recovery view", () => {
  const context = buildPlannerObservationContext(
    createState({
      schemaReplanDiagnostics: {
        schemaError: "path is required",
        toolId: "read_open",
        invalidAction: {
          type: "use_tool",
          toolId: "read_open",
          args: {},
          reason: "Need file content.",
        },
        attemptCount: 1,
      },
    }),
  );

  assert.deepEqual(context.recovery, {
    source: "schema_replan",
    attemptCount: 1,
    maxAttempts: 1,
    exhausted: false,
    errorMessage: "path is required",
    schemaError: "path is required",
    toolId: "read_open",
    invalidAction: {
      type: "use_tool",
      toolId: "read_open",
      args: {},
      reason: "Need file content.",
    },
  });
});

test("buildPlannerObservationContext marks recovery as exhausted only after the replan budget is exceeded", () => {
  const context = buildPlannerObservationContext(
    createState({
      schemaReplanDiagnostics: {
        schemaError: "path is still required",
        toolId: "read_open",
        invalidAction: {
          type: "use_tool",
          toolId: "read_open",
          args: {},
          reason: "Need file content.",
        },
        attemptCount: 2,
      },
    }),
  );

  assert.deepEqual(context.recovery, {
    source: "schema_replan",
    attemptCount: 2,
    maxAttempts: 1,
    exhausted: true,
    errorMessage: "path is still required",
    schemaError: "path is still required",
    toolId: "read_open",
    invalidAction: {
      type: "use_tool",
      toolId: "read_open",
      args: {},
      reason: "Need file content.",
    },
  });
});

test("buildNextActionPlannerMessages reads planner observation context instead of scattered top-level planner state fields", () => {
  const observationContext = buildPlannerObservationContext(
    createState({
      currentTaskFrame: {
        currentGoal: "Inspect README.md",
        confirmedObjects: [],
        completionCriteria: ["Inspect README.md"],
      },
      evidence: {
        observations: [],
        retrievals: [],
        toolExecutions: [
          {
            toolCallId: "tool-call-readme-open",
            toolId: "read_open",
            inputHash: "hash-readme-open",
            args: { path: "README.md" },
            status: "completed",
            summary: {
              source: "tool",
              status: "completed",
              toolId: "read_open",
              actionTaken: "Opened README.md.",
              keyFindings: ["contentLength=120"],
              answerReadiness: {
                canAnswer: true,
                reason: "Opened file content is available for answer generation.",
              },
            },
            startedAt: "2026-07-06T10:00:00.000Z",
            finishedAt: "2026-07-06T10:00:01.000Z",
          },
        ],
      },
      pendingApproval: {
        id: "approval-1",
        runId: "run-1",
        stepId: "approval",
        toolId: "terminal_session",
        toolCallId: "tool-call-1",
        inputHash: "hash-1",
        reason: "Needs approval before running.",
        createdAt: "2026-07-06T10:00:02.000Z",
      },
      schemaReplanDiagnostics: {
        schemaError: "path is required",
        toolId: "read_open",
        attemptCount: 1,
      },
    }),
  );

  const messages = buildNextActionPlannerMessages({
    question: "Open README.md",
    messages: createState().messages,
    observationContext,
    toolExposure: createState().toolExposure!,
    iteration: 0,
    maxIterations: 3,
  });
  const payload = JSON.parse(String(messages[1]?.content ?? "{}")) as Record<string, unknown>;
  const promptObservationContext = payload.observationContext as Record<string, unknown>;

  assert.ok("observationContext" in payload);
  assert.equal(payload.currentUserRequest, "Open README.md");
  assert.equal("recentConversationHistory" in payload, false);
  assert.equal("taskFrame" in payload, false);
  assert.equal("lastToolExecution" in payload, false);
  assert.equal("pendingApproval" in payload, false);
  assert.equal("schemaReplanDiagnostics" in payload, false);
  assert.equal("latestEvidenceSummary" in payload, false);
  assert.equal("taskCoverageView" in promptObservationContext, false);
  assert.equal(
    (promptObservationContext.latestToolCall as Record<string, unknown>).toolId,
    "read_open",
  );
});

test("buildNextActionPlannerMessages uses tool failure recovery budget in the main planner prompt", () => {
  const observationContext = buildPlannerObservationContext(
    createState({
      lastToolExecution: {
        toolCallId: "tool-call-recoverable-failed",
        toolId: "read_open",
        inputHash: "hash-read-open-recoverable",
        args: { path: "missing.md" },
        status: "failed",
        failureKind: "recoverable",
        recoveryAttemptCount: 1,
        errorMessage: "File not found",
        startedAt: "2026-07-06T10:00:00.000Z",
        finishedAt: "2026-07-06T10:00:01.000Z",
      },
      evidence: undefined,
      observations: undefined,
    }),
  );

  const messages = buildNextActionPlannerMessages({
    question: "Open missing.md",
    messages: createState().messages,
    observationContext,
    toolExposure: createState().toolExposure!,
    iteration: 0,
    maxIterations: 3,
  });
  const payload = JSON.parse(String(messages[1]?.content ?? "{}")) as Record<string, unknown>;
  const progression = payload.progression as Record<string, unknown>;

  assert.equal(observationContext.recovery.source, "tool_failure");
  assert.equal(observationContext.recovery.attemptCount, 1);
  assert.equal(
    observationContext.recovery.maxAttempts,
    DEFAULT_AGENT_MAX_RECOVERY_ATTEMPTS,
  );
  assert.equal(progression.remainingRecoveryAttempts, 1);
  assert.match(
    String(messages[0]?.content ?? ""),
    /当前恢复预算还剩 1 次；如果继续恢复，必须说明这次为什么与上次不同。/,
  );
});

test("buildNextActionPlannerMessages only uses toolExposure as the planner-visible tool source", () => {
  const messages = buildNextActionPlannerMessages({
    question: "Open README.md",
    messages: createState().messages,
    observationContext: buildPlannerObservationContext(createState()),
    toolExposure: {
      exposedTools: ["read_open"],
      toolMeta: [baseToolExposure.toolMeta[0]!],
    },
    iteration: 0,
    maxIterations: 3,
  });

  const payloadMessage = messages.find((message) =>
    String(message.content).includes('"recentConversationHistory"'),
  );
  const payload = JSON.parse(String(payloadMessage?.content ?? "{}")) as {
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
});

test("buildNextActionPlannerMessages keeps a bounded recent user and assistant history window", () => {
  const messages = buildNextActionPlannerMessages({
    question: "那一段展开说说",
    messages: [
      {
        role: "user",
        content: "第一轮无关的旧问题",
        parts: [{ type: "text", text: "第一轮无关的旧问题" }],
      },
      {
        role: "assistant",
        content: "第一轮无关的旧回答",
        parts: [{ type: "text", text: "第一轮无关的旧回答" }],
      },
      {
        role: "user",
        content: "先看审批恢复这块",
        parts: [
          {
            type: "text",
            text: "先看审批恢复这块",
          },
        ],
      },
      {
        role: "assistant",
        content: "好的，我先去找相关实现。",
        parts: [
          {
            type: "text",
            text: "好的，我先去找相关实现。",
          },
        ],
      },
      {
        role: "user",
        content: "我找到 resume.ts 了",
        parts: [
          {
            type: "text",
            text: "我找到 resume.ts 了",
          },
        ],
      },
      {
        role: "assistant",
        content: "里面有 resumeApprovedAgentRun。",
        parts: [{ type: "text", text: "里面有 resumeApprovedAgentRun。" }],
      },
      {
        role: "user",
        content: "继续",
        parts: [{ type: "text", text: "继续" }],
      },
      {
        role: "assistant",
        content: "好，我继续看它怎么清 pending approval。",
        parts: [{ type: "text", text: "好，我继续看它怎么清 pending approval。" }],
      },
      {
        role: "user",
        content: "然后呢？",
        parts: [{ type: "text", text: "然后呢？" }],
      },
      {
        role: "assistant",
        content: "我再确认一下调用链。",
        parts: [{ type: "text", text: "我再确认一下调用链。" }],
      },
      {
        role: "user",
        content: "那一段展开说说",
        parts: [{ type: "text", text: "那一段展开说说" }],
      },
    ],
    observationContext: buildPlannerObservationContext(createState()),
    toolExposure: createState().toolExposure!,
    iteration: 0,
    maxIterations: 3,
  });

  const payload = JSON.parse(String(messages[1]?.content ?? "{}")) as {
    recentConversationHistory?: Array<{ role: string; content: string }>;
  };

  assert.deepEqual(payload.recentConversationHistory, [
    {
      role: "user",
      content: "第一轮无关的旧问题",
    },
    {
      role: "assistant",
      content: "第一轮无关的旧回答",
    },
    {
      role: "user",
      content: "先看审批恢复这块",
    },
    {
      role: "assistant",
      content: "好的，我先去找相关实现。",
    },
    {
      role: "user",
      content: "我找到 resume.ts 了",
    },
    {
      role: "assistant",
      content: "里面有 resumeApprovedAgentRun。",
    },
    {
      role: "user",
      content: "继续",
    },
    {
      role: "assistant",
      content: "好，我继续看它怎么清 pending approval。",
    },
    {
      role: "user",
      content: "然后呢？",
    },
    {
      role: "assistant",
      content: "我再确认一下调用链。",
    },
  ]);
});

test("nextActionPlannerNode returns answer action from task model JSON", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"answer","reason":"Evidence is already sufficient.","completionProof":[{"criterion":"answer the user","evidenceRefs":[]}],"unresolvedGaps":[]}';

    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch, {
      nextAction: {
        type: "answer",
        reason: "Evidence is already sufficient.",
        completionProof: [
          { criterion: "answer the user", evidenceRefs: [] },
        ],
        unresolvedGaps: [],
      },
      finalizationPacket: {
        type: "answer",
        reason: "Evidence is already sufficient.",
        completionProof: [
          { criterion: "answer the user", evidenceRefs: [] },
        ],
        unresolvedGaps: [],
      },
    });
    assert.equal(streamSpy.mock.calls.length, 1);
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode resolves a contextual follow-up through bounded history and planPatch", async () => {
  let plannerMessages: Array<{ content: string }> = [];
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* (messages) {
      plannerMessages = messages as Array<{ content: string }>;
      yield JSON.stringify({
        type: "use_tool",
        toolId: "browser_attached_browse",
        args: { url: "http://localhost:5173/#/login" },
        reason: "The bounded history identifies the pending login task and the attached browser is authorized.",
        planPatch: {
          addItems: [
            {
              id: "P1",
              text: "Log into http://localhost:5173/#/login with the credentials supplied in the conversation",
            },
            {
              id: "P2",
              text: "Verify that the local page reached the authenticated state",
            },
          ],
          completeIds: [],
        },
      });
    });

  try {
    const currentRequest = "Use the attached browser capability to proceed.";
    const patch = await nextActionPlannerNode(
      createState({
        goal: {
          id: "goal-follow-up",
          text: currentRequest,
          successCriteria: [currentRequest],
          constraints: ["safe"],
          riskLevel: "medium",
        },
        question: currentRequest,
        messages: [
          {
            role: "user",
            content:
              "Log into http://localhost:5173/#/login with username test-user and the password I supplied.",
            parts: [],
          },
          {
            role: "assistant",
            content: "I have the target and credentials, but have not executed the login.",
            parts: [],
          },
          {
            role: "user",
            content: currentRequest,
            parts: [],
          },
        ],
        currentTaskFrame: {
          currentGoal: currentRequest,
          currentSubtask: "Determine the next action.",
          confirmedObjects: [],
          completionCriteria: [currentRequest],
        },
        toolExposure: {
          exposedTools: ["browser_attached_browse"],
          toolMeta: [
            {
              toolId: "browser_attached_browse",
              title: "Attached Browser Browse",
              description: "Navigate the user's attached browser.",
              inputSchema: {
                type: "object",
                properties: { url: { type: "string" } },
                required: ["url"],
                additionalProperties: false,
              },
              domain: "browser_action",
              source: "internal",
              tags: ["browser"],
              capabilities: {
                sideEffect: "external",
                requiresApproval: false,
              },
            },
          ],
        },
      }),
    );

    assert.deepEqual(patch.nextAction, {
      type: "use_tool",
      toolId: "browser_attached_browse",
      args: { url: "http://localhost:5173/#/login" },
      reason:
        "The bounded history identifies the pending login task and the attached browser is authorized.",
    });
    assert.match(patch.currentTaskFrame?.currentGoal ?? "", /Log into http:\/\/localhost:5173/);
    assert.match(patch.currentTaskFrame?.currentGoal ?? "", /authenticated state/);
    assert.deepEqual(patch.currentTaskFrame?.completionCriteria, [
      "Log into http://localhost:5173/#/login with the credentials supplied in the conversation",
      "Verify that the local page reached the authenticated state",
    ]);

    const joinedPrompt = plannerMessages.map((message) => message.content).join("\n");
    assert.match(joinedPrompt, /currentUserRequest/);
    assert.match(joinedPrompt, /recentConversationHistory/);
    assert.match(joinedPrompt, /test-user/);
    assert.match(joinedPrompt, /bounded recent conversation history/i);
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode keeps a standalone first-turn goal authoritative when creating a plan", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield JSON.stringify({
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "Read the requested file.",
        planPatch: {
          addItems: [
            { id: "P1", text: "Open README.md" },
            { id: "P2", text: "Summarize the runtime section" },
          ],
          completeIds: [],
        },
      });
    });

  try {
    const question = "Read README.md and summarize its runtime section.";
    const patch = await nextActionPlannerNode(
      createState({
        goal: {
          id: "goal-standalone",
          text: question,
          successCriteria: [question],
          constraints: ["safe"],
          riskLevel: "low",
        },
        question,
        messages: [
          {
            role: "user",
            content: question,
            parts: [],
          },
        ],
        currentTaskFrame: {
          currentGoal: question,
          currentSubtask: "Determine the next action.",
          confirmedObjects: [],
          completionCriteria: [question],
        },
      }),
    );

    assert.equal(patch.currentTaskFrame?.currentGoal, question);
    assert.deepEqual(patch.currentTaskFrame?.completionCriteria, [question]);
    assert.equal(patch.currentTaskFrame?.currentSubtask, "Open README.md");
  } finally {
    streamSpy.mockRestore();
  }
});

test("parseNextActionPlannerOutput accepts fenced JSON output", () => {
  assert.deepEqual(
    parseNextActionPlannerOutput(
      '```json\n{"type":"answer","reason":"Evidence is already sufficient.","completionProof":[{"criterion":"answer the user","evidenceRefs":[]}],"unresolvedGaps":[]}\n```',
    ),
    {
      type: "answer",
      reason: "Evidence is already sufficient.",
      completionProof: [{ criterion: "answer the user", evidenceRefs: [] }],
      unresolvedGaps: [],
    },
  );
});

test("parseNextActionPlannerOutput accepts prefixed JSON output", () => {
  assert.deepEqual(
    parseNextActionPlannerOutput(
      '好的，下面是 JSON：\n{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need the file content."}',
    ),
    {
      type: "use_tool",
      toolId: "read_open",
      args: {
        path: "README.md",
      },
      reason: "Need the file content.",
    },
  );
});

test("parseNextActionPlannerOutput accepts think-prefixed JSON output", () => {
  assert.deepEqual(
    parseNextActionPlannerOutput(
      '<think>Need to inspect the file first.</think>\n{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need file content."}',
    ),
    {
      type: "use_tool",
      toolId: "read_open",
      args: {
        path: "README.md",
      },
      reason: "Need file content.",
    },
  );
});

test("parseNextActionPlannerOutput accepts think-prefixed answer JSON output", () => {
  assert.deepEqual(
    parseNextActionPlannerOutput(
      '<think>Evidence is enough.</think>\n{"type":"answer","reason":"Evidence is already sufficient.","completionProof":[{"criterion":"answer the user","evidenceRefs":[]}],"unresolvedGaps":[]}',
    ),
    {
      type: "answer",
      reason: "Evidence is already sufficient.",
      completionProof: [{ criterion: "answer the user", evidenceRefs: [] }],
      unresolvedGaps: [],
    },
  );
});

test("parseNextActionPlannerOutput defaults reason for use_tool read_list output", () => {
  assert.deepEqual(
    parseNextActionPlannerOutput(
      '{"type":"use_tool","toolId":"read_list","args":{"path":"/workspace"}}',
    ),
    {
      type: "use_tool",
      toolId: "read_list",
      args: {
        path: "/workspace",
      },
      reason: "Planner selected tool read_list.",
    },
  );
});

test("parseNextActionPlannerOutput defaults reason for use_tool read_open output", () => {
  assert.deepEqual(
    parseNextActionPlannerOutput(
      '{"type":"use_tool","toolId":"read_open","args":{"path":"/README.md"}}',
    ),
    {
      type: "use_tool",
      toolId: "read_open",
      args: {
        path: "/README.md",
      },
      reason: "Planner selected tool read_open.",
    },
  );
});

test("parseNextActionPlannerOutput defaults reason for retrieve output", () => {
  assert.deepEqual(
    parseNextActionPlannerOutput(
      '{"type":"retrieve","query":"查看 README.md 的内容"}',
    ),
    {
      type: "retrieve",
      query: "查看 README.md 的内容",
      reason: "Planner requested retrieval for query: 查看 README.md 的内容.",
    },
  );
});

test("parseNextActionPlannerOutput rejects answer output without completion proof", () => {
  assert.equal(parseNextActionPlannerOutput('{"type":"answer"}'), null);
});

test("parseNextActionPlannerOutput accepts ask_user output and defaults the reason", () => {
  assert.deepEqual(
    parseNextActionPlannerOutput(
      '{"type":"ask_user","question":"请确认要检查哪个仓库？"}',
    ),
    {
      type: "ask_user",
      question: "请确认要检查哪个仓库？",
      reason: "Planner needs the user to clarify the missing information.",
    },
  );
});

test("parseNextActionPlannerOutput rejects multiple JSON objects instead of guessing", () => {
  assert.equal(
    parseNextActionPlannerOutput(
      '{"type":"answer","reason":"First."}\n{"type":"error","reason":"Second."}',
    ),
    null,
  );
});

test("nextActionPlannerNode returns retrieve action from task model JSON", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"retrieve","query":"deployment process","reason":"Need knowledge-base evidence."}';
    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch, {
      nextAction: {
        type: "retrieve",
        query: "deployment process",
        reason: "Need knowledge-base evidence.",
      },
    });
    assert.equal(streamSpy.mock.calls.length, 1);
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode consumes the native structured value through the typed adapter", async () => {
  const nativeStream = Object.assign(
    (async function* () {
      yield "not-json-text";
    })(),
    {
      getOutputKind: () => "native" as const,
      getStructuredOutput: () => ({
        type: "retrieve",
        reason: "Native schema selected repository evidence.",
        query: "README",
        toolId: null,
        args: null,
        question: null,
        completionProof: [],
        unresolvedGaps: [],
        planPatch: { addItems: [], completeIds: [] },
      }),
    },
  );
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockReturnValue(nativeStream);

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch, {
      nextAction: {
        type: "retrieve",
        query: "README",
        reason: "Native schema selected repository evidence.",
      },
    });
    assert.equal(streamSpy.mock.calls.length, 1);
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode returns use_tool action when toolId is exposed", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need the file content."}';
    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch, {
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: {
          path: "README.md",

        },
        reason: "Need the file content.",
      },
    });
    assert.equal("pendingToolCall" in patch, false);
    assert.equal("selectedToolId" in patch, false);
  } finally {
    streamSpy.mockRestore();
  }
});

test.each([
  {
    name: "composite read and compare smoke request",
    question:
      "读取根目录 package.json 和 server/package.json，比较两边的 Node、包管理器和测试脚本配置，给出差异和证据。",
    goal:
      "读取根目录 package.json 和 server/package.json，比较两边的 Node、包管理器和测试脚本配置，给出差异和证据。",
    acceptanceCriteria: [
      "根目录 package.json 已读取",
      "server/package.json 已读取",
      "Node、包管理器和测试脚本差异已比较并有 Evidence",
    ],
  },
  {
    name: "create and verify artifact smoke request",
    question:
      "在当前工作区的 .test-artifact/ 下创建 subagent-smoke.txt，写入 subagent smoke passed，重新读取确认内容，最后汇报路径和验证结果。",
    goal:
      "在 .test-artifact/ 下创建 subagent-smoke.txt，写入 subagent smoke passed，重新读取确认内容，最后汇报路径和验证结果。",
    acceptanceCriteria: [
      "已在 .test-artifact/ 下创建并写入 subagent-smoke.txt",
      "已重新读取文件并确认内容为 subagent smoke passed",
      "已返回文件路径和验证 Evidence",
    ],
  },
])("Planner contract accepts one bounded delegation decision: $name", async ({
  question,
  goal,
  acceptanceCriteria,
}) => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield JSON.stringify({
        type: "use_tool",
        toolId: GENERIC_TASK_DELEGATE_TOOL_ID,
        args: { goal, acceptanceCriteria },
        reason: "Delegate the bounded package so the child can execute and verify it locally.",
      });
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        question,
        messages: [
          {
            role: "user",
            content: question,
            parts: [{ type: "text", text: question }],
          },
        ],
        toolExposure: withGenericTaskDelegationTool(baseToolExposure),
      }),
    );

    assert.deepEqual(patch.nextAction, {
      type: "use_tool",
      toolId: GENERIC_TASK_DELEGATE_TOOL_ID,
      args: { goal, acceptanceCriteria },
      reason: "Delegate the bounded package so the child can execute and verify it locally.",
    });
    assert.equal(streamSpy.mock.calls.length, 1);
  } finally {
    streamSpy.mockRestore();
  }
});

test("Planner prompt gives delegate_task semantic priority without classifying by business keywords", () => {
  const question =
    "读取根目录 package.json 和 server/package.json，比较两边的 Node、包管理器和测试脚本配置，给出差异和证据。";
  const messages = buildNextActionPlannerMessages({
    question,
    observationContext: buildPlannerObservationContext(createState()),
    toolExposure: withGenericTaskDelegationTool(baseToolExposure),
    iteration: 0,
    maxIterations: 3,
  });
  const prompt = messages.map((message) => message.content).join("\n");

  assert.match(prompt, /clear boundary|independent acceptance boundary/i);
  assert.match(prompt, /multiple sequential tools|multiple sequential tool calls/i);
  assert.match(prompt, /delegate_task/);
  assert.match(prompt, /single concrete tool call|trivial one-step/i);
  assert.doesNotMatch(prompt, /code task|file task|business keyword/i);
});

test("simple one-step read remains a direct Planner tool action", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"package.json"},"reason":"Read the requested file."}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        question: "读取 package.json。",
        messages: [
          {
            role: "user",
            content: "读取 package.json。",
            parts: [{ type: "text", text: "读取 package.json。" }],
          },
        ],
        toolExposure: withGenericTaskDelegationTool(baseToolExposure),
      }),
    );

    assert.equal(patch.nextAction?.type, "use_tool");
    assert.equal(
      patch.nextAction?.type === "use_tool"
        ? patch.nextAction.toolId
        : undefined,
      "read_open",
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("pure response remains a direct answer without delegation", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"answer","reason":"Return the requested token.","completionProof":[{"criterion":"reply SMOKE_OK","evidenceRefs":[]}],"unresolvedGaps":[]}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        question: "只回复 SMOKE_OK。",
        messages: [
          {
            role: "user",
            content: "只回复 SMOKE_OK。",
            parts: [{ type: "text", text: "只回复 SMOKE_OK。" }],
          },
        ],
        toolExposure: withGenericTaskDelegationTool(baseToolExposure),
      }),
    );

    assert.equal(patch.nextAction?.type, "answer");
    assert.equal(
      patch.nextAction?.type === "use_tool"
        ? patch.nextAction.toolId
        : undefined,
      undefined,
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode uses bounded replan prompt when schema diagnostics exist", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need the file content."}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        workspaceRoot: "D:\\workspace\\rag-demo",
        schemaReplanDiagnostics: {
          schemaError: "args.limit is not allowed",
          toolId: "read_open",
          invalidAction: {
            type: "use_tool",
            toolId: "read_open",
            args: {
              path: "README.md",
              limit: 3,
            },
            reason: "Need file content.",
          },
          attemptCount: 1,
        },
      }),
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: {
          path: "README.md",
        },
        reason: "Need the file content.",
      },
    });

    const plannerMessages = streamSpy.mock.calls[0]?.[0] ?? [];
    assert.match(String(plannerMessages[0]?.content ?? ""), /bounded replan/i);
    const plannerPrompt = plannerMessages.map((message) => message.content).join("\n");
    assert.match(plannerPrompt, /args\.limit is not allowed/);
    assert.match(plannerPrompt, /allowedTools/);
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode allows the same tool when args differ", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"docs/README.md"},"reason":"Need the nested file content."}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        evidence: {
          observations: [],
          retrievals: [],
          toolExecutions: [
            {
              toolCallId: "tool-call-readme",
              toolId: "read_open",
              inputHash: readmeArgsHash,
              args: {
                path: "README.md",
              },
              status: "completed",
              result: {
                type: "open",
                path: "README.md",
              },
              startedAt: "2026-07-04T00:00:00.000Z",
              finishedAt: "2026-07-04T00:00:01.000Z",
            },
          ],
        },
      }),
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: {
          path: "docs/README.md",
        },
        reason: "Need the nested file content.",
      },
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode does not treat failed tool execution as a completed duplicate", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Retry the file content."}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        evidence: {
          observations: [],
          retrievals: [],
          toolExecutions: [
            {
              toolCallId: "tool-call-readme-failed",
              toolId: "read_open",
              inputHash: readmeArgsHash,
              args: {
                path: "README.md",
              },
              status: "failed",
              errorMessage: "file not found",
              startedAt: "2026-07-04T00:00:00.000Z",
              finishedAt: "2026-07-04T00:00:01.000Z",
            },
          ],
        },
      }),
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: {
          path: "README.md",
        },
        reason: "Retry the file content.",
      },
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode stops on pendingApproval without producing a final answer", async () => {
  const streamSpy = vi.spyOn(providerProxyService, "streamTaskChatText");
  const events: Array<Record<string, unknown>> = [];

  try {
    const patch = await nextActionPlannerNode(
      createState({
        pendingApproval: {
          id: "approval-1",
          runId: "run-1",
          stepId: "tool",
          toolId: "read_open",
          toolCallId: "tool-call-readme-awaiting",
          reason: "Needs approval before reading README.md.",
          input: {
            path: "README.md",
          },
          inputHash: readmeArgsHash,
          createdAt: "2026-07-04T00:00:00.000Z",
        },
        lastToolExecution: {
          toolCallId: "tool-call-readme-awaiting",
          toolId: "read_open",
          inputHash: readmeArgsHash,
          args: {
            path: "README.md",
          },
          status: "awaiting_approval",
          approval: {
            id: "approval-1",
            runId: "run-1",
            stepId: "tool",
            toolId: "read_open",
            reason: "Needs approval before reading README.md.",
            input: {
              path: "README.md",
            },
            inputHash: readmeArgsHash,
            createdAt: "2026-07-04T00:00:00.000Z",
          },
          startedAt: "2026-07-04T00:00:00.000Z",
          finishedAt: "2026-07-04T00:00:01.000Z",
        },
      }),
      async (event) => {
        events.push({
          nodeId: event.nodeId,
          phase: event.phase,
          details: event.details,
        });
      },
    );

    assert.deepEqual(patch, {});
    assert.equal(streamSpy.mock.calls.length, 0);

    const doneEvent = events.find(
      (event) =>
        event.nodeId === "agent-next-action-planner" && event.phase === "done",
    );
    assert.equal(
      (doneEvent?.details as Record<string, unknown>)?.pendingApprovalActive,
      true,
    );
    assert.equal(
      (doneEvent?.details as Record<string, unknown>)?.selectedActionType,
      null,
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode keeps missing-reason use_tool output as a valid action", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"}}';
    });
  const events: Array<Record<string, unknown>> = [];

  try {
    const patch = await nextActionPlannerNode(
      createState(),
      async (event) => {
        events.push({
          nodeId: event.nodeId,
          phase: event.phase,
          details: event.details,
        });
      },
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: {
          path: "README.md",
        },
        reason: "Planner selected tool read_open.",
      },
    });

    const doneEvent = events.find(
      (event) =>
        event.nodeId === "agent-next-action-planner" && event.phase === "done",
    );
    assert.ok(doneEvent);
    assert.deepEqual(
      (doneEvent?.details as Record<string, unknown>)?.parseWarnings,
      ["missing_reason_defaulted", "planner_task_plan_missing_on_initial_turn"],
    );
    assert.equal(
      (doneEvent?.details as Record<string, unknown>)?.parseErrorReason,
      undefined,
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode accepts ask_user output for missing information", async () => {

  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"ask_user","question":"Which repository should I inspect?","reason":"The target repo is ambiguous."}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        currentTaskFrame: {
          currentGoal: "Inspect the repository",
          currentSubtask: "Determine the next action.",
          currentBlocker: undefined,
          confirmedObjects: [],
          completionCriteria: ["Identify the right repository"],
        },
      }),
    );
    assert.deepEqual(patch, {
      nextAction: {
        type: "ask_user",
        question: "Which repository should I inspect?",
        reason: "The target repo is ambiguous.",
      },
      currentTaskFrame: {
        currentGoal: "What should we do next?",
        globalGoal: "answer the user",
        currentSubtask: "Ask the user for the missing information needed to continue.",
        currentBlocker: undefined,
        confirmedObjects: [],
        completionCriteria: ["Identify the right repository"],
        coveredProgress: undefined,
        remainingWork: undefined,
      },
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode prompt allows ask_user output and includes progression rules", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"answer","reason":"Enough evidence.","completionProof":[{"criterion":"answer the user","evidenceRefs":[]}],"unresolvedGaps":[]}';
    });

  try {
    await nextActionPlannerNode(
      createState({
        currentTaskFrame: {
          currentGoal: "Inspect the repository",
          currentSubtask: "Review the latest failed action.",
          currentBlocker: "Last path was wrong",
          confirmedObjects: [],
          completionCriteria: ["Find the right repository"],
        },
        lastToolExecution: {
          toolId: "read_open",
          args: {
            path: "missing.md",
          },
          status: "failed",
          errorMessage: "file not found",
          startedAt: "2026-07-06T10:00:00.000Z",
          finishedAt: "2026-07-06T10:00:01.000Z",
        },
      }),
    );
    const plannerMessages = streamSpy.mock.calls[0]?.[0] ?? [];
    assert.match(String(plannerMessages[0]?.content ?? ""), /"type":"ask_user"/);
    assert.match(
      String(plannerMessages[0]?.content ?? ""),
      /如果上一次工具或检索失败但仍可恢复，不要默认输出 error/,
    );
    assert.match(
      String(plannerMessages[0]?.content ?? ""),
      /不要无理由重复同一个失败调用/,
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode bounded replan prompt includes ask_user and recovery exhaustion guidance", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"ask_user","question":"Please confirm the exact file path.","reason":"The previous tool args were invalid and the correct path is still unclear."}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        workspaceRoot: "D:\\workspace\\rag-demo",
        schemaReplanDiagnostics: {
          schemaError: "args.limit is not allowed",
          toolId: "read_open",
          invalidAction: {
            type: "use_tool",
            toolId: "read_open",
            args: {
              path: "README.md",
              limit: 3,
            },
            reason: "Need file content.",
          },
          attemptCount: 1,
        },
      }),
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "ask_user",
        question: "Please confirm the exact file path.",
        reason:
          "The previous tool args were invalid and the correct path is still unclear.",
      },
    });

    const plannerMessages = streamSpy.mock.calls[0]?.[0] ?? [];
    assert.match(String(plannerMessages[0]?.content ?? ""), /ask_user/);
    assert.match(
      String(plannerMessages[0]?.content ?? ""),
      /改参数、换工具、ask_user，或在确实无法继续时输出明确终局/,
    );
    assert.match(
      plannerMessages.map((message) => message.content).join("\n"),
      /remainingRecoveryAttempts/,
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode stops with a terminal conclusion when recovery budget is exhausted", async () => {
  const streamSpy = vi.spyOn(providerProxyService, "streamTaskChatText");
  const events: Array<Record<string, unknown>> = [];

  try {
    const patch = await nextActionPlannerNode(
      createState({
        lastToolExecution: {
          toolCallId: "tool-call-readme-failed",
          toolId: "read_open",
          inputHash: readmeArgsHash,
          args: {
            path: "README.md",
          },
          status: "failed",
          errorMessage: "file not found",
          summary: {
            source: "tool",
            status: "failed",
            toolId: "read_open",
            actionTaken: "Tried to open README.md.",
            keyFindings: ["The file path could not be resolved."],
            answerReadiness: {
              canAnswer: false,
              reason: "The file open attempt failed, so there is no grounded file evidence.",
              missingInfo: ["A valid file path or a different recovery action."],
            },
          },
          startedAt: "2026-07-04T00:00:00.000Z",
          finishedAt: "2026-07-04T00:00:01.000Z",
        },
        schemaReplanDiagnostics: {
          schemaError: "path is required",
          toolId: "read_open",
          invalidAction: {
            type: "use_tool",
            toolId: "read_open",
            args: {},
            reason: "Need file content.",
          },
          attemptCount: 2,
        },
      }),
      async (event) => {
        events.push({
          nodeId: event.nodeId,
          phase: event.phase,
          details: event.details,
        });
      },
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "error",
        reason: "Recovery budget exhausted after read_open failed: path is required",
      },
      schemaReplanDiagnostics: {
        schemaError: "path is required",
        toolId: "read_open",
        invalidAction: {
          type: "use_tool",
          toolId: "read_open",
          args: {},
          reason: "Need file content.",
        },
        attemptCount: 2,
      },
      errorMessage: "Recovery budget exhausted after read_open failed: path is required",
      blockedReason: "Recovery budget exhausted after read_open failed: path is required",
      errorSourceNodeId: "agent-next-action-planner",
    });
    assert.equal(streamSpy.mock.calls.length, 0);

    const doneEvent = events.find(
      (event) =>
        event.nodeId === "agent-next-action-planner" && event.phase === "done",
    );
    assert.equal(
      (doneEvent?.details as Record<string, unknown>)?.recoveryExhausted,
      true,
    );
    assert.equal(
      (doneEvent?.details as Record<string, unknown>)?.selectedActionType,
      "error",
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode stops when schema replan budget is exhausted even without a failed observation", async () => {
  const streamSpy = vi.spyOn(providerProxyService, "streamTaskChatText");

  try {
    const patch = await nextActionPlannerNode(
      createState({
        schemaReplanDiagnostics: {
          schemaError: "args.limit is not allowed",
          toolId: "read_open",
          invalidAction: {
            type: "use_tool",
            toolId: "read_open",
            args: {
              path: "README.md",
              limit: 3,
            },
            reason: "Need file content.",
          },
          attemptCount: 2,
        },
      }),
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "error",
        reason:
          "Recovery budget exhausted after read_open failed: args.limit is not allowed",
      },
      schemaReplanDiagnostics: {
        schemaError: "args.limit is not allowed",
        toolId: "read_open",
        invalidAction: {
          type: "use_tool",
          toolId: "read_open",
          args: {
            path: "README.md",
            limit: 3,
          },
          reason: "Need file content.",
        },
        attemptCount: 2,
      },
      errorMessage:
        "Recovery budget exhausted after read_open failed: args.limit is not allowed",
      blockedReason:
        "Recovery budget exhausted after read_open failed: args.limit is not allowed",
      errorSourceNodeId: "agent-next-action-planner",
    });
    assert.equal(streamSpy.mock.calls.length, 0);
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode falls back when task model output is invalid JSON", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield "not-json";
    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch, {
      nextAction: {
        type: "error",
        reason:
          "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      },
      errorMessage:
        "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      blockedReason:
        "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      errorSourceNodeId: "agent-next-action-planner",
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode writes invalid planner output diagnostics into trace", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"answer","reason":"First."}\n{"type":"error","reason":"Second."}';
    });
  const events: Array<Record<string, unknown>> = [];

  try {
    const patch = await nextActionPlannerNode(
      createState(),
      async (event) => {
        events.push({
          nodeId: event.nodeId,
          phase: event.phase,
          details: event.details,
        });
      },
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "error",
        reason:
          "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      },
      errorMessage:
        "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      blockedReason:
        "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      errorSourceNodeId: "agent-next-action-planner",
    });

    const doneEvent = events.find(
      (event) =>
        event.nodeId === "agent-next-action-planner" && event.phase === "done",
    );
    assert.ok(doneEvent);
    assert.match(
      String((doneEvent?.details as Record<string, unknown>)?.rawOutputPreview ?? ""),
      /"type":"answer"/,
    );
    assert.match(
      String(
        (doneEvent?.details as Record<string, unknown>)?.sanitizedOutputPreview ?? "",
      ),
      /"type":"error"/,
    );
    assert.match(
      String((doneEvent?.details as Record<string, unknown>)?.parseErrorReason ?? ""),
      /multiple JSON objects/i,
    );
    assert.deepEqual(
      (doneEvent?.details as Record<string, unknown>)?.allowedActionTypes,
      ["answer", "retrieve", "use_tool", "ask_user", "error"],
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode writes invalid planner output diagnostics into structured logs", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"answer","reason":"First."}\n{"type":"error","reason":"Second."}';
    });
  const seen: string[] = [];
  const unsubscribe = subscribeToLogLines((line) => {
    seen.push(line);
  });

  try {
    await nextActionPlannerNode(
      createState({
        runId: "run-log-invalid-json",
        threadId: "thread-log-invalid-json",
      }),
    );
  } finally {
    unsubscribe();
    streamSpy.mockRestore();
  }

  const debugLine = seen
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .find(
      (entry) =>
        entry?.event === "agent-next-action-planner-debug" &&
        entry.runId === "run-log-invalid-json",
    );

  assert.ok(debugLine);
  assert.equal(debugLine?.threadId, "thread-log-invalid-json");
  assert.equal(debugLine?.selectedActionType, "error");
  assert.match(String(debugLine?.rawOutputPreview ?? ""), /"type":"answer"/);
  assert.match(String(debugLine?.sanitizedOutputPreview ?? ""), /"type":"error"/);
  assert.match(String(debugLine?.parseErrorReason ?? ""), /multiple JSON objects/i);
});

test("nextActionPlannerNode writes missing_reason_defaulted warning into structured logs", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"retrieve","query":"README"}';
    });
  const seen: string[] = [];
  const unsubscribe = subscribeToLogLines((line) => {
    seen.push(line);
  });

  try {
    await nextActionPlannerNode(
      createState({
        runId: "run-log-missing-reason",
        threadId: "thread-log-missing-reason",
      }),
    );
  } finally {
    unsubscribe();
    streamSpy.mockRestore();
  }

  const debugLine = seen
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .find(
      (entry) =>
        entry?.event === "agent-next-action-planner-debug" &&
        entry.runId === "run-log-missing-reason",
    );

  assert.ok(debugLine);
  assert.equal(debugLine?.selectedActionType, "retrieve");
  assert.deepEqual(debugLine?.parseWarnings, [
    "missing_reason_defaulted",
    "planner_task_plan_missing_on_initial_turn",
  ]);
  assert.equal(debugLine?.parseErrorReason, undefined);
  assert.equal(
    debugLine?.reason,
    "Planner requested retrieval for query: README.",
  );
});

test("nextActionPlannerNode stops when task model returns an unknown action type", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"do_something","reason":"invalid type"}';
    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch, {
      nextAction: {
        type: "error",
        reason:
          "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      },
      errorMessage:
        "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      blockedReason:
        "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      errorSourceNodeId: "agent-next-action-planner",
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode falls back when task model selects an unexposed tool", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"terminal_session","args":{"command":"dir"},"reason":"Need terminal."}';
    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch, {
      nextAction: {
        type: "error",

        reason:
          "Planner selected a tool that was not exposed for this turn; planner must stop.",
      },
      errorMessage:
        "Planner selected a tool that was not exposed for this turn; planner must stop.",
      blockedReason:
        "Planner selected a tool that was not exposed for this turn; planner must stop.",

      errorSourceNodeId: "agent-next-action-planner",
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode falls back when task model returns schema-invalid use_tool args", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":[],"reason":"Need file content."}';
    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch, {
      nextAction: {
        type: "error",
        reason:
          "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      },
      errorMessage:
        "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      blockedReason:
        "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      errorSourceNodeId: "agent-next-action-planner",
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode keeps calling the task model beyond the legacy iteration budget", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"ask_user","question":"Which file should I inspect?","reason":"The target is missing."}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        iterationCount: 3,
        maxIterations: 3,
      }),
    );
    assert.deepEqual(patch, {
      nextAction: {
        type: "ask_user",
        question: "Which file should I inspect?",
        reason: "The target is missing.",
      },
    });
    assert.equal(streamSpy.mock.calls.length, 1);
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode stops when task model call throws", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      throw new Error("provider unavailable");
    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch, {
      nextAction: {
        type: "error",
        reason: "Planner task model call failed: provider unavailable",
      },
      errorMessage: "Planner task model call failed: provider unavailable",
      blockedReason: "Planner task model call failed: provider unavailable",
      errorSourceNodeId: "agent-next-action-planner",
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode writes decision trace and includes prompt context for task model", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"web_search","args":{"query":"latest release notes"},"reason":"Need current external information."}';
    });
  const events: Array<Record<string, unknown>> = [];

  try {
    const patch = await nextActionPlannerNode(
      createState({
        evidence: {
          observations: [
            {
              id: "obs-1",
              runId: "run-1",
              stepId: "retrieve",
              status: "ok",
              facts: ["Need current release notes."],
              createdAt: "2026-07-03T00:00:00.000Z",
            },
          ],
          retrievals: [],
          toolExecutions: [],
        },
      }),
      async (event) => {
        events.push({
          nodeId: event.nodeId,
          phase: event.phase,
          details: event.details,
        });
      },
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "use_tool",
        toolId: "web_search",
        args: {
          query: "latest release notes",
        },
        reason: "Need current external information.",
      },
    });

    assert.equal(streamSpy.mock.calls.length, 1);
    const plannerMessages = streamSpy.mock.calls[0]?.[0] ?? [];
    assert.equal(plannerMessages.length, 3);
    const plannerPrompt = plannerMessages.map((message) => message.content).join("\n");
    assert.match(plannerPrompt, /"toolExposure"/);
    assert.match(plannerPrompt, /"exposedTools"/);
    assert.doesNotMatch(plannerPrompt, /"plan"/);

    const doneEvent = events.find(
      (event) =>
        event.nodeId === "agent-next-action-planner" && event.phase === "done",
    );
    assert.ok(doneEvent);
    assert.deepEqual((doneEvent?.details as Record<string, unknown>)?.selectedActionType, "use_tool");
    assert.deepEqual((doneEvent?.details as Record<string, unknown>)?.selectedToolId, "web_search");
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode does not derive tool exposure from toolIntent when explicit toolExposure is absent", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need file content."}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        toolExposure: undefined,
        toolIntent: {
          query: "open README.md",
          topCandidates: [],
          toolCandidates: [],
          toolExposure: {
            exposedToolIds: ["read_open"],
            exposedDefinitions: [
              {
                id: "read_open",
                title: "Read Open",
                description: "Open a workspace file",
                domain: "read",
                source: "internal",
                mode: "sync",
                inputSchema: {},
                tags: ["read"],
                capabilities: {
                  sideEffect: "none",
                  requiresApproval: false,
                },
              },
            ],
            reason: [],
            blockedCapabilityIds: [],
          },
        },
      }),
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "error",
        reason:
          "Planner selected a tool that was not exposed for this turn; planner must stop.",
      },
      errorMessage:
        "Planner selected a tool that was not exposed for this turn; planner must stop.",
      blockedReason:
        "Planner selected a tool that was not exposed for this turn; planner must stop.",
      errorSourceNodeId: "agent-next-action-planner",
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("task model can select an exposed projected MCP capability", async () => {
  const projectedToolId = "mcp:docs-server:tool:search_docs";
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield JSON.stringify({
        type: "use_tool",
        toolId: projectedToolId,
        args: { query: "installation guides" },
        reason: "Search the connected documentation server.",
      });
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        question: "Find the installation guide in the connected documentation server.",
        toolExposure: {
          exposedTools: [projectedToolId],
          toolMeta: [
            {
              toolId: projectedToolId,
              title: "Search product documentation",
              description: "Search the connected documentation server for product guides.",
              inputSchema: {
                type: "object",
                required: ["query"],
                properties: { query: { type: "string" } },
                additionalProperties: false,
              },
              domain: "external_mcp",
              source: "external",
              tags: ["docs", "search", "docs-server"],
              capabilities: {
                sideEffect: "network",
                requiresApproval: true,
              },
            },
          ],
        },
      }),
    );

    assert.deepEqual(patch.nextAction, {
      type: "use_tool",
      toolId: projectedToolId,
      args: { query: "installation guides" },
      reason: "Search the connected documentation server.",
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode writes the answer action and frozen finalization packet", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"answer","reason":"Enough evidence.","completionProof":[{"criterion":"answer the user","evidenceRefs":[]}],"unresolvedGaps":[]}';
    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(Object.keys(patch), ["nextAction", "finalizationPacket"]);
    assert.deepEqual(patch.finalizationPacket, patch.nextAction);
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode ignores an injected legacy plan field", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"ask_user","question":"Which file should I inspect?","reason":"The target is ambiguous."}';
    });

  try {
    const patch = await nextActionPlannerNode({
      ...createState(),
      plan: {
        steps: [
          {
            id: "legacy-step",
            kind: "retrieve",
            status: "pending",
          },
        ],
      },
    } as AgentNodeState);

    assert.deepEqual(patch, {
      nextAction: {
        type: "ask_user",
        question: "Which file should I inspect?",
        reason: "The target is ambiguous.",
      },
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode is the primary writer for runtime currentTaskFrame updates", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"README.md"},"reason":"Need file content."}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        currentTaskFrame: {
          currentGoal: "stale goal",
          currentSubtask: "Old subtask",
          currentBlocker: "Existing blocker",
          confirmedObjects: [
            {
              type: "knowledge",
              id: "kb-1",
              label: "kb-1",
              confidence: 1,
            },
          ],
          completionCriteria: ["Inspect README.md"],
        },
        question: "Open README.md",
      }),
    );

    assert.deepEqual(patch, {
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: {
          path: "README.md",
        },
        reason:
          "Need file content.",
      },
      currentTaskFrame: {
        currentGoal: "Open README.md",
        globalGoal: "answer the user",
        currentSubtask: "Run read_open with reviewed parameters.",
        currentBlocker: "Existing blocker",
        confirmedObjects: [
          {
            type: "knowledge",
            id: "kb-1",
            label: "kb-1",
            confidence: 1,
          },
        ],
        completionCriteria: ["Inspect README.md"],
        coveredProgress: undefined,
        remainingWork: undefined,
      },
    });
  } finally {
    streamSpy.mockRestore();
  }
});

test("nextActionPlannerNode updates currentTaskFrame from explicit evidence facts and gaps only", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"package.json"},"reason":"README.md is already covered; package.json is still missing."}';
    });

  try {
    const patch = await nextActionPlannerNode(
      createState({
        currentTaskFrame: {
          currentGoal: "compare README.md and package.json",
          currentSubtask: "Old subtask",
          currentBlocker: undefined,
          confirmedObjects: [],
          completionCriteria: ["compare README.md and package.json"],
        },
        question: "compare README.md and package.json",
        evidence: {
          observations: [],
          retrievals: [],
          toolExecutions: [
            {
              toolId: "read_open",
              args: { path: "README.md" },
              status: "completed",
              summary: {
                source: "tool",
                status: "partial",
                toolId: "read_open",
                actionTaken: "Opened README.md.",
                keyFindings: ["path=README.md"],
                gaps: ["package.json is still missing."],
                data: {
                  kind: "read_open",
                  path: "README.md",
                  contentPreview: "# README",
                  contentLength: 8,
                  keySections: [],
                },
              },
              startedAt: "2026-07-11T00:00:00.000Z",
              finishedAt: "2026-07-11T00:00:01.000Z",
            },
          ],
          latestSummary: {
            source: "tool",
            status: "partial",
            toolId: "read_open",
            actionTaken: "Opened README.md.",
            keyFindings: ["path=README.md"],
            gaps: ["package.json is still missing."],
            data: {
              kind: "read_open",
              path: "README.md",
              contentPreview: "# README",
              contentLength: 8,
              keySections: [],
            },
          },
        },
      }),
    );

    assert.deepEqual(patch.currentTaskFrame?.coveredProgress, [
      "Opened README.md.",
      "path=README.md",
    ]);
    assert.deepEqual(patch.currentTaskFrame?.remainingWork, [
      "package.json is still missing.",
    ]);
  } finally {
    streamSpy.mockRestore();
  }
});

test("buildNextActionPlannerMessages preserves read_discover oneOf inputSchema", () => {
  const messages = buildNextActionPlannerMessages({
    question: "Find settings files",
    messages: createState().messages,
    observationContext: buildPlannerObservationContext(createState()),
    toolExposure: {
      exposedTools: ["read_discover"],
      toolMeta: [
        {
          toolId: "read_discover",
          title: "read_discover",
          description: "discover files",
          inputSchema: {
            oneOf: [
              {
                type: "object",
                required: ["mode", "path"],
                additionalProperties: false,
                properties: {
                  mode: { type: "string", enum: ["list"] },
                  path: { type: "string" },
                },
              },
              {
                type: "object",
                required: ["mode", "query"],
                additionalProperties: false,
                properties: {
                  mode: { type: "string", enum: ["locate"] },
                  query: { type: "string" },
                },
              },
            ],
          },
          domain: "read",
          source: "internal",
          tags: ["read"],
          capabilities: { sideEffect: "none", requiresApproval: false },
        },
      ],
    },
    iteration: 0,
    maxIterations: 3,
  });

  const payload = JSON.parse(String(messages[1]?.content ?? "{}")) as {
    toolExposure: {
      toolMeta: Array<{ toolId: string; inputSchema?: { oneOf?: unknown[] } }>;
    };
  };

  assert.equal(payload.toolExposure.toolMeta[0]?.toolId, "read_discover");
  assert.equal(payload.toolExposure.toolMeta[0]?.inputSchema?.oneOf?.length, 2);
});

test("nextActionPlannerNode writes planner error fields only for error actions", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"error","reason":"Planner cannot continue safely."}';
    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch, {
      nextAction: {
        type: "error",
        reason: "Planner cannot continue safely.",
      },
      errorMessage: "Planner cannot continue safely.",
      blockedReason: "Planner cannot continue safely.",
      errorSourceNodeId: "agent-next-action-planner",
    });
  } finally {
    streamSpy.mockRestore();
  }
});

