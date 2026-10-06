import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { contextBudgetService } from "@/services/context-budget/index";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import * as intentMatcherModule from "../intent/embedding-capability-matcher";
import { createToolExecutionEvidenceSummary } from "../evidence";
import { generateNode } from "../nodes/index";
import type { AgentNodeState } from "../node-runtime";
import type { AgentEvidenceReference } from "../types";
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

const makeMessage = (content: string) => ({
  role: "user" as const,
  content,
  parts: [{ type: "text" as const, text: content }],
});
const setPlannerAnswer = (
  state: AgentNodeState,
  evidenceRefs: AgentEvidenceReference[] = [],
) => {
  const packet = {
    type: "answer" as const,
    reason: "Planner decided the request is ready for final delivery.",
    completionProof: [
      { criterion: "return an answer", evidenceRefs },
    ],
    unresolvedGaps: [],
  };
  state.nextAction = packet;
  state.finalizationPacket = packet;
};

const createBaseState = (message: string): AgentNodeState => {
  const state: AgentNodeState = {
    runId: "run-1",
    threadId: "thread-1",
    userId: 1,
    goal: { ...baseGoal, text: message },
    plan: basePlan,
    messages: [makeMessage(message)],
    observations: [],
    evidence: {
      observations: [],
      toolExecutions: [],
      retrievals: [],
    },
  };
  setPlannerAnswer(state);
  return state;
};

const citeFirstTool = (state: AgentNodeState) =>
  setPlannerAnswer(state, ["tool:0"]);

const normalizedEvidence = (toolId: string, result: unknown) =>
  projectToolEvidence(
    {
      id: toolId,
      source: "internal",
      domain: toolId === "terminal_session" ? "terminal" : toolId === "edit_file" ? "edit" : toolId === "workspace_mutation" ? "edit" : "read",
    },
    normalizeToolResult({ structuredContent: result }),
  );

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

afterEach(() => {
  vi.clearAllMocks();
});

test("createToolExecutionEvidenceSummary prioritizes documentation content over build artifacts for read_locate", () => {
  const summary = createToolExecutionEvidenceSummary({
    question: "请检索 workspace 中关于 UIChat Mira 的说明，然后基于检索结果回答 UIChat Mira 是什么。",
    execution: {
      toolId: "read_locate",
      args: { query: "UIChat Mira" },
      status: "completed",
      inputHash: "hash-read-locate",
      result: {
        type: "locate",
        scope: ".",
        query: "UIChat Mira",
        searchMode: "auto",
        matches: [
          {
            path: "release/v0.7.1_20260704_205127/electron/UIChat Mira Setup 0.7.1.exe",
            matchType: "path",
          },
          {
            path: "README.md",
            matchType: "content",
            line: 3,
            column: 1,
            preview: "UIChat Mira is a local-first desktop workspace for chat, knowledge, tools, and docs.",
          },
          {
            path: "AGENTS.md",
            matchType: "content",
            line: 5,
            column: 1,
            preview: "UIChat Mira is a local-first desktop workspace with an Electron shell, a React renderer, and a bundled Fastify backend.",
          },
        ],
      },
      evidence: normalizedEvidence("read_locate", {
        type: "locate",
        scope: ".",
        query: "UIChat Mira",
        searchMode: "auto",
        matches: [
          { path: "release/v0.7.1_20260704_205127/electron/UIChat Mira Setup 0.7.1.exe", matchType: "path" },
          { path: "README.md", matchType: "content", line: 3, column: 1, preview: "UIChat Mira is a local-first desktop workspace for chat, knowledge, tools, and docs." },
          { path: "AGENTS.md", matchType: "content", line: 5, column: 1, preview: "UIChat Mira is a local-first desktop workspace with an Electron shell, a React renderer, and a bundled Fastify backend." },
        ],
      }),
      startedAt: "2026-07-04T00:00:00.000Z",
      finishedAt: "2026-07-04T00:00:01.000Z",
    },
    evidenceIndex: 0,
  });

  assert.equal(summary?.data?.kind, "read_locate");
  assert.deepEqual(
    summary?.data?.matchesPreview.slice(0, 2).map((entry) => entry.includes("README.md") || entry.includes("AGENTS.md")),
    [true, true],
  );
  assert.equal(
    (summary?.data?.matchesPreview[0] ?? "").startsWith("[path] release/"),
    false,
  );
});

test("createToolExecutionEvidenceSummary preserves read_discover facts and truncation", () => {
  const summary = createToolExecutionEvidenceSummary({
    execution: {
      toolId: "read_discover",
      args: { mode: "list", path: "docs", maxResults: 1 },
      status: "completed",
      inputHash: "hash-read-discover",
      result: {
        type: "discover",
        mode: "list",
        operation: "list",
        path: "docs",
        entries: [{ name: "settings.md", type: "file" }],
        returnedCount: 1,
        totalCount: 3,
        hasMore: true,
        truncated: true,
      },
      evidence: normalizedEvidence("read_discover", {
        type: "discover",
        mode: "list",
        operation: "list",
        path: "docs",
        entries: [{ name: "settings.md", type: "file" }],
        returnedCount: 1,
        totalCount: 3,
        hasMore: true,
        truncated: true,
      }),
      startedAt: "2026-07-11T00:00:00.000Z",
      finishedAt: "2026-07-11T00:00:01.000Z",
    },
    evidenceIndex: 0,
  });

  assert.equal(summary.data?.kind, "read_discover");
  if (summary.data?.kind === "read_discover") {
    assert.equal(summary.data.mode, "list");
    assert.equal(summary.data.operation, "list");
    assert.equal(summary.data.path, "docs");
    assert.deepEqual(summary.data.candidatePaths, ["settings.md"]);
    assert.equal(summary.data.candidateCount, 1);
    assert.equal(summary.data.returnedCount, 1);
    assert.equal(summary.data.totalCount, 3);
    assert.equal(summary.data.hasMore, true);
    assert.equal(summary.status, "truncated");
    assert.match(summary.facts.join("\n"), /path=docs/);
    assert.match(summary.facts.join("\n"), /returnedCount=1/);
    assert.match(summary.facts.join("\n"), /totalCount=3/);
    assert.match(summary.facts.join("\n"), /candidatePath=settings\.md/);
  }
});

test("createToolExecutionEvidenceSummary limits read_discover candidatePaths to preview size", () => {
  const summary = createToolExecutionEvidenceSummary({
    execution: {
      toolId: "read_discover",
      args: { mode: "locate", query: "settings" },
      status: "completed",
      inputHash: "hash-read-discover-preview-limit",
      result: {
        type: "discover",
        mode: "locate",
        operation: "locate",
        root: "workspace-root",
        query: "settings",
        matches: [
          { path: "docs/settings-1.md", matchType: "path" },
          { path: "docs/settings-2.md", matchType: "path" },
          { path: "docs/settings-3.md", matchType: "path" },
          { path: "docs/settings-4.md", matchType: "path" },
          { path: "docs/settings-5.md", matchType: "path" },
          { path: "docs/settings-6.md", matchType: "path" },
        ],
        returnedCount: 6,
        hasMore: true,
        truncated: true,
      },
      evidence: normalizedEvidence("read_discover", {
        type: "discover",
        mode: "locate",
        operation: "locate",
        root: "workspace-root",
        query: "settings",
        matches: [
          { path: "docs/settings-1.md", matchType: "path" },
          { path: "docs/settings-2.md", matchType: "path" },
          { path: "docs/settings-3.md", matchType: "path" },
          { path: "docs/settings-4.md", matchType: "path" },
          { path: "docs/settings-5.md", matchType: "path" },
          { path: "docs/settings-6.md", matchType: "path" },
        ],
        returnedCount: 6,
        hasMore: true,
        truncated: true,
      }),
      startedAt: "2026-07-11T00:00:00.000Z",
      finishedAt: "2026-07-11T00:00:01.000Z",
    },
    evidenceIndex: 0,
  });

  assert.equal(summary.data?.kind, "read_discover");
  if (summary.data?.kind === "read_discover") {
    assert.equal(summary.data.candidateCount, 6);
    assert.equal(summary.data.returnedCount, 6);
    assert.equal(summary.data.candidatePaths.length, 5);
    assert.deepEqual(summary.data.candidatePaths, [
      "docs/settings-1.md",
      "docs/settings-2.md",
      "docs/settings-3.md",
      "docs/settings-4.md",
      "docs/settings-5.md",
    ]);
    assert.equal(summary.facts.some((fact) => fact.includes("settings-6.md")), false);
  }
});

test("generateNode blocks function_calls protocol text without treating it as execution", async () => {
  const state = createBaseState("看看当前 workspace 有哪些文件");
  state.evidence = {
    observations: [],
    toolExecutions: [
      {
        toolId: "read_list",
        args: { path: "." },
        status: "completed",
        inputHash: "hash-read-list",
        result: {
          type: "list",
          path: ".",
          entries: [],
        },
        summary: {
          source: "tool",
          status: "completed",
          toolId: "read_list",
          inputHash: "hash-read-list",
          actionTaken: "Listed workspace directory .",
          keyFindings: ["entryCount=3", "[F] README.md", "[D] docs"],
          answerReadiness: {
            canAnswer: true,
            reason: "Directory listing is sufficient for the user's workspace overview question.",
          },
          data: {
            kind: "read_list",
            path: ".",
            entryCount: 3,
            fileCount: 2,
            directoryCount: 1,
            entriesPreview: ["[F] README.md", "[D] docs", "[F] package.json"],
            truncated: false,
            canAnswerDirectoryQuestion: true,
          },
        },
        startedAt: "2026-07-04T00:00:00.000Z",
        finishedAt: "2026-07-04T00:00:01.000Z",
      },
    ],
    retrievals: [],
  };
  state.evidence.latestSummary = state.evidence.toolExecutions[0]?.summary;
  citeFirstTool(state);

  const invokeSpy = vi
    .spyOn(providerProxyService, "generateTextForRole")
    .mockResolvedValue('<function_calls>{"toolId":"read_list"}</function_calls>');
  const executionEvents: Array<{
    nodeId: string;
    phase: string;
    details?: Record<string, unknown>;
  }> = [];

  const result = await generateNode(state, async (event) => {
    executionEvents.push({
      nodeId: event.nodeId,
      phase: event.phase,
      details:
        event.details && typeof event.details === "object"
          ? (event.details as Record<string, unknown>)
          : undefined,
    });
  });

  assert.equal(invokeSpy.mock.calls.length, 1);
  assert.equal(result.answer, undefined);
  assert.match(result.errorMessage ?? "", /internal tool-call protocol/i);
  const generateErrorEvent = executionEvents.find(
    (event) => event.nodeId === "agent-generate" && event.phase === "error",
  );
  assert.equal(generateErrorEvent?.details?.outputGuardTriggered, true);
  assert.equal(generateErrorEvent?.details?.protocolGuardTriggered, true);
  assert.equal(generateErrorEvent?.details?.outputGuardReason, "function_calls_xml");
});

test("generateNode returns the Planner ask_user question verbatim without invoking the answer model", async () => {
  const state = createBaseState("请用触界帮我处理一下。");
  const plannerQuestion = "请说明要处理的页面地址和具体操作。";
  state.nextAction = {
    type: "ask_user",
    question: plannerQuestion,
    reason: "The concrete target and operation are missing.",
  };
  const invokeSpy = vi.spyOn(providerProxyService, "generateTextForRole");
  const executionEvents: Array<{
    nodeId: string;
    phase: string;
    details?: Record<string, unknown>;
  }> = [];

  const result = await generateNode(state, async (event) => {
    executionEvents.push({
      nodeId: event.nodeId,
      phase: event.phase,
      details:
        event.details && typeof event.details === "object"
          ? (event.details as Record<string, unknown>)
          : undefined,
    });
  });

  assert.equal(result.answer, plannerQuestion);
  assert.equal(invokeSpy.mock.calls.length, 0);
  assert.equal(result.evidence, undefined);
  assert.equal(result.pendingToolCall, undefined);
  assert.equal(result.lastToolExecution, undefined);
  assert.doesNotMatch(result.answer ?? "", /已执行|function_calls|pendingToolCall/i);
  const generateDoneEvent = executionEvents.find(
    (event) => event.nodeId === "agent-generate" && event.phase === "done",
  );
  assert.equal(generateDoneEvent?.details?.answerSource, "planner_ask_user_question");
  assert.equal(generateDoneEvent?.details?.modelInvoked, false);
});

test.each([
  ["invoke XML", '<invoke name="browser_attached_look"></invoke>', "invoke_xml"],
  [
    "pendingToolCall JSON",
    '{"pendingToolCall":{"toolId":"browser_attached_look","args":{}}}',
    "pending_tool_call_envelope",
  ],
  [
    "tool-call JSON",
    '{"type":"use_tool","toolId":"browser_attached_look","args":{},"reason":"inspect"}',
    "tool_call_json_envelope",
  ],
])("generateNode blocks %s protocol envelopes", async (_label, modelAnswer, expectedReason) => {
  const state = createBaseState("查看当前页面");
  const invokeSpy = vi
    .spyOn(providerProxyService, "generateTextForRole")
    .mockResolvedValue(modelAnswer);
  const executionEvents: Array<{ details?: Record<string, unknown> }> = [];

  const result = await generateNode(state, async (event) => {
    executionEvents.push({
      details:
        event.details && typeof event.details === "object"
          ? (event.details as Record<string, unknown>)
          : undefined,
    });
  });

  assert.equal(invokeSpy.mock.calls.length, 1);
  assert.equal(result.answer, undefined);
  assert.match(result.errorMessage ?? "", /internal tool-call protocol/i);
  assert.equal(
    executionEvents.find((event) => event.details?.protocolGuardTriggered)?.details
      ?.outputGuardReason,
    expectedReason,
  );
});

test("generateNode does not block valid natural language that discusses tool use", async () => {
  const state = createBaseState("说明接下来如何操作");
  const naturalAnswer =
    "我可以使用页面观察工具读取当前状态；真正执行前仍会遵守现有审批流程。";
  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue(
    naturalAnswer,
  );

  const result = await generateNode(state);

  assert.equal(result.answer, naturalAnswer);
});

test("generateNode gives generic non-empty structured results to the model and does not answer as empty", async () => {
  const state = createBaseState("列出查询到的项目");
  const execution = {
    toolId: "generic-list",
    args: {},
    status: "completed" as const,
    result: {
      items: [{ name: "Project Alpha" }, { name: "Project Beta" }],
      total: 2,
      nextCursor: null,
    },
    startedAt: "2026-07-15T00:00:00.000Z",
    finishedAt: "2026-07-15T00:00:01.000Z",
  };
  const summary = createToolExecutionEvidenceSummary({ execution, evidenceIndex: 0 });
  state.evidence = {
    observations: [],
    toolExecutions: [{ ...execution, summary }],
    retrievals: [],
    latestSummary: summary,
  };
  citeFirstTool(state);
  let capturedMessages: Array<{ content: string }> = [];
  const invokeSpy = vi.spyOn(providerProxyService, "generateTextForRole").mockImplementation(
    async (_role, messages) => {
      capturedMessages = messages as Array<{ content: string }>;
      return "找到 2 条结果：Project Alpha 和 Project Beta。";
    },
  );

  const result = await generateNode(state);
  const evidencePrompt = capturedMessages.map((message) => message.content).join("\n");

  assert.equal(invokeSpy.mock.calls.length, 1);
  assert.match(evidencePrompt, /generic_structured/);
  assert.match(evidencePrompt, /Project Alpha/);
  assert.match(evidencePrompt, /total=2/);
  assert.doesNotMatch(evidencePrompt, /没有数据/);
  assert.match(result.answer ?? "", /Project Alpha/);
  assert.doesNotMatch(result.answer ?? "", /没有数据/);
});

test("generateNode includes browser_observe page fields in the answer context", async () => {
  const state = createBaseState("页面上显示了什么？");
  const summary = {
    source: "tool" as const,
    status: "completed" as const,
    toolId: "browser_observe",
    actionTaken: "Completed managed browser observe.",
    keyFindings: [
      "url=https://example.com",
      "title=Example Domain",
      "visibleText=Example Domain content",
    ],
    facts: [
      "url=https://example.com",
      "title=Example Domain",
      "visibleText=Example Domain content",
    ],
    data: {
      kind: "computer_use_browser",
      operation: "observe",
      page: { url: "https://example.com", title: "Example Domain", snapshotHash: "snapshot-1" },
      observation: { visibleText: "Example Domain content" },
    } as never,
  };
  state.evidence = {
    observations: [],
    toolExecutions: [{
      toolId: "browser_observe",
      args: { url: "https://example.com" },
      status: "completed",
      summary,
      startedAt: "2026-07-15T00:00:00.000Z",
      finishedAt: "2026-07-15T00:00:01.000Z",
    }],
    retrievals: [],
    latestSummary: summary,
  };
  citeFirstTool(state);
  const invokeSpy = vi.spyOn(providerProxyService, "generateTextForRole").mockImplementation(
    async (_role, messages) => {
      const content = (messages as Array<{ content: string }>).map((message) => message.content).join("\n");
      assert.match(content, /title=Example Domain/);
      assert.match(content, /visibleText=Example Domain content/);
      return "页面标题是 Example Domain，页面显示 Example Domain content。";
    },
  );

  const result = await generateNode(state);

  assert.equal(invokeSpy.mock.calls.length, 1);
  assert.match(result.answer ?? "", /Example Domain content/);
});

test("generateNode does not semantically rewrite ordinary model text", async () => {
  const state = createBaseState("打开 README.md 看看内容");
  state.evidence = {
    observations: [],
    toolExecutions: [
      {
        toolId: "read_open",
        args: { path: "README.md" },
        status: "completed",
        inputHash: "hash-read-open",
        result: {},
        summary: {
          source: "tool",
          status: "completed",
          toolId: "read_open",
          inputHash: "hash-read-open",
          actionTaken: "Opened file README.md.",
          keyFindings: ["contentLength=42", "# UIChat Mira"],
          answerReadiness: {
            canAnswer: true,
            reason: "Opened file content is available for answer generation.",
          },
          data: {
            kind: "read_open",
            path: "README.md",
            contentPreview: "# UIChat Mira UIChat Mira is a local-first desktop workspace.",
            contentLength: 42,
            truncated: false,
            keySections: ["UIChat Mira"],
            canAnswerFileQuestion: true,
          },
        },
        startedAt: "2026-07-04T00:00:00.000Z",
        finishedAt: "2026-07-04T00:00:01.000Z",
      },
    ],
    retrievals: [],
  };
  state.evidence.latestSummary = state.evidence.toolExecutions[0]?.summary;
  citeFirstTool(state);

  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue(
    "我将调用 read_open 来打开 README.md。",
  );

  const result = await generateNode(state);

  assert.equal(result.answer, "我将调用 read_open 来打开 README.md。");
});

test("createToolExecutionEvidenceSummary preserves historical edit_file mutation evidence", () => {
  const summary = createToolExecutionEvidenceSummary({
    question: "把 notes.txt 里的 old 替换成 new",
    execution: {
      toolId: "edit_file",
      args: {
        path: "notes.txt",
        operation: "replace_block",
        expectedOldText: "old",
        newText: "new",
      },
      status: "completed",
      inputHash: "hash-edit-file-replace",
      result: {
        actionProfileId: "edit_replace_block",
        runtimeToolId: "edit_file",
        result: {
          path: "notes.txt",
          operation: "replace_block",
          dryRun: false,
          bytes: Buffer.byteLength("new", "utf-8"),
        },
      },
      evidence: {
        status: "completed",
        actionTaken: "Changed workspace file notes.txt.",
        facts: [
          "operation=replace",
          "targetPath=notes.txt",
          "dryRun=false",
          "changed=true",
        ],
        data: {
          kind: "edit_file",
          operation: "replace",
          targetPath: "notes.txt",
          dryRun: false,
          changed: true,
          replaced: true,
          actionProfileId: "edit_replace_block",
          runtimeToolId: "edit_file",
        },
      },
      startedAt: "2026-07-07T00:00:00.000Z",
      finishedAt: "2026-07-07T00:00:01.000Z",
    },
    evidenceIndex: 4,
  });

  assert.equal(summary.status, "completed");
  assert.equal(summary.data?.kind, "edit_file");
  if (summary.data?.kind === "edit_file") {
    assert.equal(summary.data.operation, "replace");
    assert.equal(summary.data.dryRun, false);
    assert.equal(summary.data.changed, true);
    assert.equal(summary.data.replaced, true);
    assert.equal(summary.data.actionProfileId, "edit_replace_block");
    assert.equal(summary.data.runtimeToolId, "edit_file");
  }
});

test("createToolExecutionEvidenceSummary preserves historical workspace_mutation evidence", () => {
  const summary = createToolExecutionEvidenceSummary({
    question: "删除 notes.txt",
    execution: {
      toolId: "workspace_mutation",
      args: {
        operation: "delete",
        targetPath: "notes.txt",
      },
      status: "completed",
      inputHash: "hash-workspace-delete",
      result: {
        operation: "delete",
        targetPath: "notes.txt",
        dryRun: false,
        deletedType: "file",
        recursive: false,
      },
      evidence: {
        status: "completed",
        actionTaken: "Applied workspace mutation to notes.txt.",
        facts: [
          "operation=delete",
          "targetPath=notes.txt",
          "dryRun=false",
          "changed=true",
        ],
        data: {
          kind: "workspace_mutation",
          operation: "delete",
          targetPath: "notes.txt",
          dryRun: false,
          changed: true,
          deleted: true,
        },
      },
      startedAt: "2026-07-07T00:00:00.000Z",
      finishedAt: "2026-07-07T00:00:01.000Z",
    },
    evidenceIndex: 5,
  });

  assert.equal(summary.status, "completed");
  assert.equal(summary.data?.kind, "workspace_mutation");
  if (summary.data?.kind === "workspace_mutation") {
    assert.equal(summary.data.operation, "delete");
    assert.equal(summary.data.changed, true);
    assert.equal(summary.data.deleted, true);
    assert.equal(summary.data.dryRun, false);
  }
});

test("generateNode treats a tool protocol after incomplete evidence as delivery failure", async () => {
  const state = createBaseState("README.md 里写了什么？");
  state.evidence = {
    observations: [],
    toolExecutions: [
      {
        toolId: "read_list",
        args: { path: "." },
        status: "completed",
        inputHash: "hash-read-list-missing-content",
        result: {},
        summary: {
          source: "tool",
          status: "completed",
          toolId: "read_list",
          inputHash: "hash-read-list-missing-content",
          actionTaken: "Listed workspace directory .",
          keyFindings: ["entryCount=3", "[F] README.md", "[D] docs"],
          answerReadiness: {
            canAnswer: false,
            reason: "Directory listing alone does not satisfy a file-content question.",
            missingInfo: ["target file content or a narrower path"],
          },
          data: {
            kind: "read_list",
            path: ".",
            entryCount: 3,
            fileCount: 2,
            directoryCount: 1,
            entriesPreview: ["[F] README.md", "[D] docs", "[F] package.json"],
            truncated: false,
            canAnswerDirectoryQuestion: false,
          },
        },
        startedAt: "2026-07-04T00:00:00.000Z",
        finishedAt: "2026-07-04T00:00:01.000Z",
      },
    ],
    retrievals: [],
  };
  state.evidence.latestSummary = state.evidence.toolExecutions[0]?.summary;
  citeFirstTool(state);

  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue(
    "<function_calls>{\"toolId\":\"read_open\"}</function_calls>",
  );

  const result = await generateNode(state);

  assert.equal(result.answer, undefined);
  assert.match(result.errorMessage ?? "", /internal tool-call protocol/i);
});

test("generateNode treats a tool protocol after dry-run evidence as delivery failure", async () => {
  const state = createBaseState("把 notes.txt 改成新内容");
  state.evidence = {
    observations: [],
    toolExecutions: [
      {
        toolId: "edit_file",
        args: {
          path: "notes.txt",
          operation: "write_file",
          content: "replacement content",
        },
        status: "completed",
        inputHash: "hash-edit-dry-run-fallback",
        result: {
          path: "notes.txt",
          operation: "write_file",
          dryRun: true,
          bytes: Buffer.byteLength("replacement content", "utf-8"),
        },
        summary: createToolExecutionEvidenceSummary({
          question: "把 notes.txt 改成新内容",
          execution: {
            toolId: "edit_file",
            args: {
              path: "notes.txt",
              operation: "write_file",
              content: "replacement content",
            },
            status: "completed",
            inputHash: "hash-edit-dry-run-fallback",
            result: {
              path: "notes.txt",
              operation: "write_file",
              dryRun: true,
              bytes: Buffer.byteLength("replacement content", "utf-8"),
            },
            startedAt: "2026-07-07T00:00:00.000Z",
            finishedAt: "2026-07-07T00:00:01.000Z",
          },
          evidenceIndex: 6,
        }),
        startedAt: "2026-07-07T00:00:00.000Z",
        finishedAt: "2026-07-07T00:00:01.000Z",
      },
    ],
    retrievals: [],
  };
  state.evidence.latestSummary = state.evidence.toolExecutions[0]?.summary;
  citeFirstTool(state);

  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue(
    "<function_calls>{\"toolId\":\"edit_file\"}</function_calls>",
  );

  const result = await generateNode(state);

  assert.equal(result.answer, undefined);
  assert.match(result.errorMessage ?? "", /internal tool-call protocol/i);
});

test("generateNode treats a tool protocol after mutation evidence as delivery failure", async () => {
  const state = createBaseState("把 notes.txt 里的 old 替换成 new");
  state.evidence = {
    observations: [],
    toolExecutions: [
      {
        toolId: "edit_file",
        args: {
          path: "notes.txt",
          operation: "replace_block",
          expectedOldText: "old",
          newText: "new",
        },
        status: "completed",
        inputHash: "hash-edit-real-fallback",
        result: {
          actionProfileId: "edit_replace_block",
          runtimeToolId: "edit_file",
          result: {
            path: "notes.txt",
            operation: "replace_block",
            dryRun: false,
            bytes: Buffer.byteLength("new", "utf-8"),
          },
        },
        summary: createToolExecutionEvidenceSummary({
          question: "把 notes.txt 里的 old 替换成 new",
          execution: {
            toolId: "edit_file",
            args: {
              path: "notes.txt",
              operation: "replace_block",
              expectedOldText: "old",
              newText: "new",
            },
            status: "completed",
            inputHash: "hash-edit-real-fallback",
            result: {
              actionProfileId: "edit_replace_block",
              runtimeToolId: "edit_file",
              result: {
                path: "notes.txt",
                operation: "replace_block",
                dryRun: false,
                bytes: Buffer.byteLength("new", "utf-8"),
              },
            },
            startedAt: "2026-07-07T00:00:00.000Z",
            finishedAt: "2026-07-07T00:00:01.000Z",
          },
          evidenceIndex: 7,
        }),
        startedAt: "2026-07-07T00:00:00.000Z",
        finishedAt: "2026-07-07T00:00:01.000Z",
      },
    ],
    retrievals: [],
  };
  state.evidence.latestSummary = state.evidence.toolExecutions[0]?.summary;
  citeFirstTool(state);

  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue(
    "<function_calls>{\"toolId\":\"edit_file\"}</function_calls>",
  );

  const result = await generateNode(state);

  assert.equal(result.answer, undefined);
  assert.match(result.errorMessage ?? "", /internal tool-call protocol/i);
});

test("generateNode leaves semantic wording to the model after Planner finalization", async () => {
  const state = createBaseState("执行命令看看中文输出");
  state.evidence = {
    observations: [],
    toolExecutions: [
      {
        toolId: "terminal_session",
        args: { command: "Get-Content README.md" },
        status: "completed",
        inputHash: "hash-terminal-garbled",
        result: {},
        summary: {
          source: "tool",
          status: "blocked",
          toolId: "terminal_session",
          inputHash: "hash-terminal-garbled",
          actionTaken: 'Executed terminal command "Get-Content README.md".',
          keyFindings: ["stdout=锟斤拷锟斤拷", "stdoutEncoding=unknown"],
          answerReadiness: {
            canAnswer: false,
            reason: "Terminal output appears garbled, so the agent must not pretend it understood the text.",
            missingInfo: ["a readable terminal result"],
          },
          data: {
            kind: "terminal_session",
            command: "Get-Content README.md",
            exitCode: 0,
            processCompleted: true,
            commandSucceeded: "unknown",
            taskSatisfied: "unknown",
            stdoutPreview: "锟斤拷锟斤拷",
            stderrPreview: "",
            stdoutEncoding: "unknown",
            stderrEncoding: "utf8",
            timedOut: false,
            truncated: false,
            binaryDetected: false,
            violations: [],
            outputInterpretable: false,
            unreadableReason: "Terminal output appears garbled, so the agent must not pretend it understood the text.",
            canAnswerCommandQuestion: false,
          },
        },
        startedAt: "2026-07-04T00:00:00.000Z",
        finishedAt: "2026-07-04T00:00:01.000Z",
      },
    ],
    retrievals: [],
  };
  state.evidence.latestSummary = state.evidence.toolExecutions[0]?.summary;
  citeFirstTool(state);

  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue(
    "命令输出说明 README 主要在介绍 UIChat Mira。",
  );

  const result = await generateNode(state);

  assert.equal(result.answer, "命令输出说明 README 主要在介绍 UIChat Mira。");
});

test("terminal evidence quality flags remain available to Generate without output rewriting", async () => {
  const state = createBaseState("执行命令并说明中文输出是否可读");
  const execution = {
    toolCallId: "tool-call-real-terminal-evidence",
    toolId: "terminal_session",
    inputHash: "hash-real-terminal-evidence",
    args: { command: "Get-Content README.md" },
    status: "completed" as const,
    result: {
      command: "Get-Content README.md",
      exitCode: 0,
      stdout: "锟斤拷锟斤拷",
      stderr: "",
      stdoutEncoding: "unknown" as const,
      stderrEncoding: "utf8" as const,
      timedOut: false,
      truncated: false,
      binaryDetected: false,
    },
    evidence: normalizedEvidence("terminal_session", {
      command: "Get-Content README.md",
      exitCode: 0,
      stdout: "锟斤拷锟斤拷",
      stderr: "",
      stdoutEncoding: "unknown",
      stderrEncoding: "utf8",
      timedOut: false,
      truncated: false,
      binaryDetected: false,
    }),
    startedAt: "2026-07-04T00:00:00.000Z",
    finishedAt: "2026-07-04T00:00:01.000Z",
  };
  const summary = createToolExecutionEvidenceSummary({
    execution,
    evidenceIndex: 0,
  });
  state.evidence = {
    observations: [],
    toolExecutions: [{ ...execution, summary }],
    retrievals: [],
    latestSummary: summary,
  };
  citeFirstTool(state);

  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue(
    "命令输出说明 README 主要在介绍 UIChat Mira。",
  );

  const result = await generateNode(state);

  assert.equal(summary.data?.kind, "terminal_session");
  if (summary.data?.kind === "terminal_session") {
    assert.equal(summary.data.commandSucceeded, "true");
    assert.equal(summary.data.outputInterpretable, false);
  }
  assert.equal(result.answer, "命令输出说明 README 主要在介绍 UIChat Mira。");
});

test("Generate does not become a second semantic judge over non-zero exit evidence", async () => {
  const state = createBaseState("执行 pnpm test 并告诉我结果");
  state.evidence = {
    observations: [],
    toolExecutions: [
      {
        toolId: "terminal_session",
        args: { command: "pnpm test" },
        status: "completed",
        inputHash: "hash-terminal-nonzero",
        result: {},
        summary: {
          source: "tool",
          status: "completed",
          toolId: "terminal_session",
          inputHash: "hash-terminal-nonzero",
          actionTaken: 'Executed terminal command "pnpm test".',
          keyFindings: [
            "exitCode=1",
            "processCompleted=true",
            "commandSucceeded=false",
            "taskSatisfied=unknown",
          ],
          answerReadiness: {
            canAnswer: true,
            reason:
              "Terminal command completed with a non-zero exit code, so the answer must describe command failure without claiming the task succeeded.",
          },
          data: {
            kind: "terminal_session",
            command: "pnpm test",
            exitCode: 1,
            processCompleted: true,
            commandSucceeded: "false",
            taskSatisfied: "unknown",
            stdoutPreview: "",
            stderrPreview: "missing script: test",
            stdoutEncoding: "utf8",
            stderrEncoding: "utf8",
            timedOut: false,
            truncated: false,
            binaryDetected: false,
            violations: [],
            outputInterpretable: true,
            canAnswerCommandQuestion: true,
          },
        },
        startedAt: "2026-07-04T00:00:00.000Z",
        finishedAt: "2026-07-04T00:00:01.000Z",
      },
    ],
    retrievals: [],
  };
  state.evidence.latestSummary = state.evidence.toolExecutions[0]?.summary;
  citeFirstTool(state);

  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue(
    "测试已通过，修复成功。",
  );

  const result = await generateNode(state);

  assert.equal(result.answer, "测试已通过，修复成功。");
});

test("Generate only blocks protocol envelopes, not ordinary text containing a tool id", async () => {
  const state = createBaseState("打开 README.md 看看内容");
  state.evidence = {
    observations: [],
    toolExecutions: [
      {
        toolId: "read_open",
        args: { path: "README.md" },
        status: "completed",
        inputHash: "hash-read-open",
        result: {},
        summary: {
          source: "tool",
          status: "completed",
          toolId: "read_open",
          inputHash: "hash-read-open",
          actionTaken: "Opened file README.md.",
          keyFindings: ["contentLength=42", "# UIChat Mira"],
          answerReadiness: {
            canAnswer: true,
            reason: "Opened file content is available for answer generation.",
          },
          data: {
            kind: "read_open",
            path: "README.md",
            contentPreview: "# UIChat Mira UIChat Mira is a local-first desktop workspace.",
            contentLength: 42,
            truncated: false,
            keySections: ["UIChat Mira"],
            canAnswerFileQuestion: true,
          },
        },
        startedAt: "2026-07-04T00:00:00.000Z",
        finishedAt: "2026-07-04T00:00:01.000Z",
      },
    ],
    retrievals: [],
  };
  state.evidence.latestSummary = state.evidence.toolExecutions[0]?.summary;
  citeFirstTool(state);

  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue(
    "read_open completed, README.md says UIChat Mira is a local-first desktop workspace.",
  );

  const result = await generateNode(state);

  assert.equal(
    result.answer,
    "read_open completed, README.md says UIChat Mira is a local-first desktop workspace.",
  );
});

test("generateNode fails delivery when model answer is empty despite completed evidence", async () => {
  const state = createBaseState("打开 README.md 看看内容");
  state.evidence = {
    observations: [],
    toolExecutions: [
      {
        toolId: "read_open",
        args: { path: "README.md" },
        status: "completed",
        inputHash: "hash-read-open",
        result: {},
        summary: {
          source: "tool",
          status: "completed",
          toolId: "read_open",
          inputHash: "hash-read-open",
          actionTaken: "Opened file README.md.",
          keyFindings: ["contentLength=42", "# UIChat Mira"],
          answerReadiness: {
            canAnswer: true,
            reason: "Opened file content is available for answer generation.",
          },
          data: {
            kind: "read_open",
            path: "README.md",
            contentPreview: "# UIChat Mira UIChat Mira is a local-first desktop workspace.",
            contentLength: 42,
            truncated: false,
            keySections: ["UIChat Mira"],
            canAnswerFileQuestion: true,
          },
        },
        startedAt: "2026-07-04T00:00:00.000Z",
        finishedAt: "2026-07-04T00:00:01.000Z",
      },
    ],
    retrievals: [],
  };
  state.evidence.latestSummary = state.evidence.toolExecutions[0]?.summary;
  citeFirstTool(state);

  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue("");

  const result = await generateNode(state);

  assert.equal(result.answer, undefined);
  assert.match(result.errorMessage ?? "", /empty user answer/i);
});

test("generateNode fails delivery when model answer is empty and no evidence exists", async () => {
  const state = createBaseState("README.md 的 Runtime 一节具体列了哪些运行组件？");
  vi.spyOn(providerProxyService, "generateTextForRole").mockResolvedValue("");

  const result = await generateNode(state);

  assert.equal(result.answer, undefined);
  assert.match(result.errorMessage ?? "", /empty user answer/i);
});

test("generateNode refuses to run without a Planner answer finalization packet", async () => {
  const state = createBaseState("README.md 的 Runtime 一节具体列了哪些运行组件？请基于文件内容回答。");
  state.schemaReplanDiagnostics = {
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
  };
  state.nextAction = {
    type: "error",
    reason: "Planner schema replan budget was exhausted.",
  };
  state.finalizationPacket = undefined;
  const invokeSpy = vi.spyOn(providerProxyService, "generateTextForRole");

  const result = await generateNode(state);

  assert.equal(invokeSpy.mock.calls.length, 0);
  assert.equal(result.answer, undefined);
  assert.match(result.errorMessage ?? "", /frozen Planner answer finalization packet/i);
});
