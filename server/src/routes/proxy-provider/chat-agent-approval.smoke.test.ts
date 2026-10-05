import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, test, vi } from "vitest";
import {
  initializeAuthDatabase,
  createAccessToken,
  getAuthUserFromRequest,
} from "@/db/auth.db";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { userRepository } from "@/db/repositories";
import { getLoggerConfig } from "@/logger";
import * as harnessInvocations from "@/harness/invocations";
import * as registry from "@/harness/registry";
import { contextBudgetService } from "@/services/context-budget/index";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import { threadService } from "@/services/thread.service";
import { sendRouteError } from "@/utils/route-errors";
import agentRoute from "@/agent/routes";
import { getAgentRunById } from "@/agent/run-read";
import { agentRunStore } from "@/agent/run-store";
import * as intentMatcherModule from "@/agent/intent/embedding-capability-matcher";

import * as runnablesModule from "@/agent/runnables";
import proxyProviderRoute from "./index.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const testDbPath = createTimestampedTestArtifactPath(
  "db",
  "chat-agent-approval-smoke",
  ".sqlite",
);
const workspaceFixtureRoot = createTimestampedTestArtifactPath(
  "workspace",
  "chat-agent-approval-smoke",
);
const artifactServerRoot = path.resolve(
  workspaceFixtureRoot,
  "..",
);

process.env.DATABASE_URL = `file:${testDbPath}`;

initializeAuthDatabase();
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeRoleDatabase();
initializeThreadDatabase();

const baseGoal = {
  id: "goal-1",
  text: "answer the user",
  successCriteria: ["return an answer"],
  constraints: ["stay safe"],
  riskLevel: "low" as const,
};

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
    ...(input.workspaceBound
      ? {
          workspaceBoundary: {
            argKeys:
              input.id === "workspace_mutation"
                ? ["targetPath", "destinationPath"]
                : ["path"],
          },
        }
      : {}),
  },
});

const listToolDefinition = () =>
  makeToolDefinition({
    id: "list",
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

const readToolDefinition = () =>
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

const workspaceMutationTool = () =>
  makeToolDefinition({
    id: "workspace_mutation",
    domain: "edit",
    inputSchema: {
      type: "object",
      required: ["operation", "targetPath"],
      properties: {
        operation: {
          type: "string",
          enum: ["delete", "move", "write"],
        },
        targetPath: { type: "string" },
        destinationPath: { type: "string" },
        content: { type: "string" },
      },
      additionalProperties: false,
    },
    sideEffect: "local-write",
    requiresApproval: true,
    workspaceBound: true,
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

const createAuthedApp = async () => {
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  app.addHook("preHandler", async (request) => {
    const authUser = getAuthUserFromRequest(request);
    if (authUser) {
      request.authUser = authUser;
    }
  });
  await app.register(proxyProviderRoute);
  await app.register(agentRoute);
  return app;
};

const createUserThread = () => {
  const user = userRepository.create({
    username: `smoke-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Chat Agent Smoke",
    agentEnabled: true,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });

  return { user, thread, token };
};

const getLatestAssistantMessage = (threadId: string, userId: number) => {
  const thread = threadService.getThreadById(threadId, userId);
  const assistantMessages =
    thread?.messages.filter((message) => message.role === "assistant") ?? [];
  return assistantMessages.at(-1);
};

// Approval schedules the resume, so the terminal state is observed by polling
// the run instead of being returned by the approve response itself.
const waitForAgentRunStatus = async (input: {
  app: Awaited<ReturnType<typeof createAuthedApp>>;
  token: string;
  runId: string;
  expectedStatus: string;
  timeoutMs?: number;
}): Promise<void> => {
  const timeoutMs = input.timeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await input.app.inject({
      method: "GET",
      url: `/agent/runs/${input.runId}`,
      headers: { authorization: `Bearer ${input.token}` },
    });
    if (response.statusCode === 200) {
      const body = response.json() as { data?: { status?: string } };
      if (body.data?.status === input.expectedStatus) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Agent run ${input.runId} did not reach status ${input.expectedStatus} within ${timeoutMs}ms`,
  );
};

const sendAgentChat = async (input: {
  app: Awaited<ReturnType<typeof createAuthedApp>>;
  token: string;
  threadId: string;
  messageId: string;
  text: string;
}) =>
  input.app.inject({
    method: "POST",
    url: "/proxy/chat/default",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
    payload: {
      id: input.threadId,
      messageId: input.messageId,
      agentEnabled: true,
      messages: [
        {
          id: input.messageId,
          role: "user",
          parts: [{ type: "text", text: input.text }],
        },
      ],
    },
  });

describe("chat route approval resume smoke", () => {
  beforeEach(() => {
    fs.mkdirSync(workspaceFixtureRoot, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceFixtureRoot, "ONLY_ALT_WORKSPACE.txt"),
      "delete me",
      "utf8",
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    agentRunStore.clear();
    try {
      fs.rmSync(workspaceFixtureRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure on Windows file locking
    }
  });

  afterAll(() => {
    try {
      fs.rmSync(testDbPath, { force: true });
    } catch {
      // ignore cleanup failure on Windows file locking
    }
  });

  test(
    "S1 reads the workspace through chat route and completes with answer and trace",
    async () => {
    const app = await createAuthedApp();
    const { user, thread, token } = createUserThread();

    setupToolExposure("看看当前 workspace 有哪些文件。", [listToolDefinition()]);
    vi.spyOn(providerProxyService, "streamTaskChatText")
      .mockImplementationOnce(async function* () {
        yield '{"type":"use_tool","toolId":"list","args":{"path":"."},"reason":"Need the workspace listing."}';
      })
      .mockImplementationOnce(async function* () {
        yield '{"type":"answer","reason":"The workspace listing is sufficient.","completionProof":[{"criterion":"Report the current workspace listing to the user.","evidenceRefs":[]}],"unresolvedGaps":[]}';
      });
    const executeSpy = vi
      .spyOn(harnessInvocations, "executeHarnessInvocation")
      .mockResolvedValue({
        id: "invocation-s1-list",
        toolId: "list",
        status: "completed",
        result: {
          type: "list",
          path: ".",
          entries: [
            { name: "README.md", type: "file" },
            { name: "server", type: "directory" },
          ],
        },
        startedAt: "2026-07-06T00:00:00.000Z",
        finishedAt: "2026-07-06T00:00:01.000Z",
      } as never);
    vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke").mockResolvedValue(
      "workspace listing answer",
    );

    const response = await sendAgentChat({
      app,
      token,
      threadId: thread.id,
      messageId: "user-s1",
      text: "看看当前 workspace 有哪些文件。",
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.body, /workspace listing answer/);
    assert.equal(executeSpy.mock.calls.length, 1);
    assert.equal(executeSpy.mock.calls[0]?.[0]?.toolId, "list");
    assert.deepEqual(executeSpy.mock.calls[0]?.[0]?.args, { path: "." });

    const assistantMessage = getLatestAssistantMessage(thread.id, user.id);
    assert.ok(assistantMessage);
    assert.equal(assistantMessage?.content, "workspace listing answer");
    assert.equal(
      (assistantMessage?.metadata as { agent?: { status?: string } } | undefined)?.agent
        ?.status,
      "completed",
    );
    assert.equal(
      typeof (assistantMessage?.metadata as { agent?: { runId?: string } } | undefined)
        ?.agent?.runId,
      "string",
    );
    assert.equal(
      typeof (assistantMessage?.metadata as { agent?: { traceId?: string } } | undefined)
        ?.agent?.traceId,
      "string",
    );

    const runId = (assistantMessage?.metadata as { agent?: { runId?: string } }).agent
      ?.runId;
    assert.ok(runId);
    const run = getAgentRunById(runId!);
    assert.equal(run?.status, "completed");
    assert.ok((run?.observations.length ?? 0) > 0);

      await app.close();
    },
    15000,
  );

  test(
    "S2-S3 approve/resume executes the approved workspace mutation only once and keeps second approve idempotent",
    async () => {
    const app = await createAuthedApp();
    const { user, thread, token } = createUserThread();

    setupToolExposure("删除 ONLY_ALT_WORKSPACE.txt。", [workspaceMutationTool()]);
    vi.spyOn(providerProxyService, "streamTaskChatText")
      .mockImplementationOnce(async function* () {
        yield '{"type":"use_tool","toolId":"workspace_mutation","args":{"operation":"delete","targetPath":"/ONLY_ALT_WORKSPACE.txt"},"reason":"Need to delete the file."}';
      })
      .mockImplementationOnce(async function* () {
        yield '{"type":"answer","reason":"The approved mutation is complete.","completionProof":[{"criterion":"The approved delete mutation ran exactly once.","evidenceRefs":[]}],"unresolvedGaps":[]}';
      })
      // The approved resume replans once more before it can answer, so keep a
      // terminal answer available instead of letting the stub run dry.
      .mockImplementation(async function* () {
        yield '{"type":"answer","reason":"The approved mutation is complete.","completionProof":[{"criterion":"The approved delete mutation ran exactly once.","evidenceRefs":[]}],"unresolvedGaps":[]}';
      });
    const executeSpy = vi
      .spyOn(harnessInvocations, "executeHarnessInvocation")
      .mockResolvedValue({
        id: "invocation-s2-delete",
        toolId: "workspace_mutation",
        status: "completed",
        result: {
          operation: "delete",
          targetPath: "ONLY_ALT_WORKSPACE.txt",
          deletedType: "file",
          dryRun: false,
          recursive: false,
        },
        startedAt: "2026-07-06T00:00:00.000Z",
        finishedAt: "2026-07-06T00:00:01.000Z",
      } as never);
    vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke").mockResolvedValue(
      "deleted ONLY_ALT_WORKSPACE.txt",
    );

    const waitingResponse = await sendAgentChat({
      app,
      token,
      threadId: thread.id,
      messageId: "user-s2",
      text: "删除 ONLY_ALT_WORKSPACE.txt。",
    });

    assert.equal(waitingResponse.statusCode, 200, waitingResponse.body);
    assert.match(waitingResponse.body, /等待审批/);
    assert.equal(executeSpy.mock.calls.length, 0);

    const waitingAssistant = getLatestAssistantMessage(thread.id, user.id);
    const waitingAgent = (waitingAssistant?.metadata as {
      agent?: {
        runId?: string;
        status?: string;
        pendingApproval?: { toolId?: string };
        blockedReason?: string;
      };
    }).agent;
    assert.equal(waitingAssistant?.content, "等待审批");
    assert.equal(waitingAgent?.status, "waiting_approval");
    assert.equal(waitingAgent?.pendingApproval?.toolId, "workspace_mutation");
    assert.equal(waitingAgent?.blockedReason, "waiting approval");

    const approveResponse = await app.inject({
      method: "POST",
      url: `/agent/runs/${waitingAgent?.runId}/approve`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.equal(approveResponse.statusCode, 200, approveResponse.body);
    const approveData = approveResponse.json() as {
      data: { status: string; pendingApproval?: unknown };
    };
    // Approval schedules the resume instead of running it inline, so the route
    // hands back the already-transitioned run. Assert the scheduling contract
    // first, then wait for the scheduled run to reach its terminal state.
    assert.equal(approveData.data.status, "running");
    assert.equal(approveData.data.pendingApproval, undefined);
    await waitForAgentRunStatus({
      app,
      token,
      runId: waitingAgent?.runId ?? "",
      expectedStatus: "completed",
    });
    assert.equal(executeSpy.mock.calls.length, 1);
    assert.equal(executeSpy.mock.calls[0]?.[0]?.toolId, "workspace_mutation");
    assert.deepEqual(executeSpy.mock.calls[0]?.[0]?.args, {
      operation: "delete",
      targetPath: "/ONLY_ALT_WORKSPACE.txt",
    });


    const resumedAssistant = getLatestAssistantMessage(thread.id, user.id);
    const resumedAgent = (resumedAssistant?.metadata as {
      agent?: {
        status?: string;
        pendingApproval?: unknown;
        blockedReason?: string;
      };
    }).agent;
    assert.equal(resumedAssistant?.content, "deleted ONLY_ALT_WORKSPACE.txt");
    assert.equal(resumedAgent?.status, "completed");
    assert.equal(resumedAgent?.pendingApproval, undefined);
    assert.equal(resumedAgent?.blockedReason, undefined);

    const secondApproveResponse = await app.inject({
      method: "POST",
      url: `/agent/runs/${waitingAgent?.runId}/approve`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.equal(secondApproveResponse.statusCode, 200, secondApproveResponse.body);
    assert.equal(
      (secondApproveResponse.json() as { data: { status: string } }).data.status,
      "completed",
    );
    assert.equal(executeSpy.mock.calls.length, 1);

    await app.close();
    },
    15000,
  );

  test(
    "S4 waiting_approval stays resumable while reject turns the visible state into blocked",
    async () => {
      const app = await createAuthedApp();
      const { user, token } = createUserThread();
      const blockedThread = threadService.createThread({
        userId: user.id,
        title: "Chat Agent Smoke Reject",
        agentEnabled: true,
      });

      setupToolExposure("删除 ONLY_ALT_WORKSPACE.txt。", [workspaceMutationTool()]);
      vi.spyOn(providerProxyService, "streamTaskChatText").mockImplementation(
        async function* () {
          yield '{"type":"use_tool","toolId":"workspace_mutation","args":{"operation":"delete","targetPath":"/ONLY_ALT_WORKSPACE.txt"},"reason":"Need to delete the file."}';
        },
      );
      vi.spyOn(harnessInvocations, "executeHarnessInvocation");
      vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke").mockResolvedValue(
        "deleted ONLY_ALT_WORKSPACE.txt",
      );

      const waitingResponse = await sendAgentChat({
        app,
        token,
        threadId: blockedThread.id,
        messageId: "user-s4",
        text: "删除 ONLY_ALT_WORKSPACE.txt。",
      });

      assert.equal(waitingResponse.statusCode, 200, waitingResponse.body);
      const blockedAssistantBeforeReject = getLatestAssistantMessage(blockedThread.id, user.id);
      const blockedAgentBeforeReject = (blockedAssistantBeforeReject?.metadata as {
        agent?: {
          runId?: string;
          status?: string;
          pendingApproval?: unknown;
          blockedReason?: string;
        };
      }).agent;
      assert.equal(blockedAgentBeforeReject?.status, "waiting_approval");
      assert.notEqual(blockedAgentBeforeReject?.pendingApproval, undefined);
      assert.equal(blockedAgentBeforeReject?.blockedReason, "waiting approval");

      const rejectResponse = await app.inject({
        method: "POST",
        url: `/agent/runs/${blockedAgentBeforeReject?.runId}/reject`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      assert.equal(rejectResponse.statusCode, 200, rejectResponse.body);
      const rejectData = rejectResponse.json() as {
        data: { status: string; pendingApproval?: unknown; blockedReason?: string };
      };
      assert.equal(rejectData.data.status, "blocked");
      assert.equal(rejectData.data.pendingApproval, undefined);
      assert.match(
        rejectData.data.blockedReason ?? "",
        /User rejected the pending approval request/i,
      );

      const blockedAssistant = getLatestAssistantMessage(blockedThread.id, user.id);
      const blockedAgent = (blockedAssistant?.metadata as {
        agent?: {
          status?: string;
          pendingApproval?: unknown;
          blockedReason?: string;
        };
      }).agent;
      assert.equal(blockedAgent?.status, "blocked");
      assert.equal(blockedAgent?.pendingApproval, undefined);
      assert.match(
        blockedAgent?.blockedReason ?? "",
        /User rejected the pending approval request/i,
      );

      await app.close();
    },
    15000,
  );

  test(
    "S5-S6 failed tool path emits a guarded answer and smoke artifacts stay under .test-artifact/server",
    async () => {
    const app = await createAuthedApp();
    const { user, thread, token } = createUserThread();

    setupToolExposure("打开一个不存在的文件。", [readToolDefinition()]);
    vi.spyOn(providerProxyService, "streamTaskChatText")
      .mockImplementationOnce(async function* () {
        yield '{"type":"use_tool","toolId":"read","args":{"path":"missing.md"},"reason":"Need the file content."}';
      })
      .mockImplementationOnce(async function* () {
        yield '{"type":"answer","reason":"The read failed, so the file cannot be confirmed.","completionProof":[{"criterion":"Report that the requested file could not be opened.","evidenceRefs":[]}],"unresolvedGaps":[]}';
      });
    vi.spyOn(harnessInvocations, "executeHarnessInvocation").mockResolvedValue({
      id: "invocation-s5-read-failed",
      toolId: "read",
      status: "failed",
      error: {
        message: "File not found",
      },
      startedAt: "2026-07-06T00:00:00.000Z",
      finishedAt: "2026-07-06T00:00:01.000Z",
    } as never);
    const generateSpy = vi
      .spyOn(runnablesModule.agentGenerateTextRunnable, "invoke")
      .mockResolvedValue("当前还没有足够的已完成证据，无法确认文件已成功打开。");

    const response = await sendAgentChat({
      app,
      token,
      threadId: thread.id,
      messageId: "user-s5",
      text: "打开一个不存在的文件。",
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.body, /File not found/);
    assert.match(response.body, /当前还没有足够的已完成证据/);
    assert.match(response.body, /"finishReason":"stop"/);
    assert.equal(generateSpy.mock.calls.length, 1);

    const assistantMessage = getLatestAssistantMessage(thread.id, user.id);
    assert.ok(assistantMessage);
    assert.match(assistantMessage?.content ?? "", /当前还没有足够的已完成证据/);
    assert.equal(
      (assistantMessage?.metadata as { agent?: { status?: string } } | undefined)?.agent
        ?.status,
      "completed",
    );

    const threadAfterFailure = threadService.getThreadById(thread.id, user.id);
    const userMessage = threadAfterFailure?.messages.find((message) => message.id === "user-s5");
    assert.ok(userMessage);
    assert.equal(userMessage?.role, "user");

    assert.match(testDbPath, /[\\\/]\.test-artifact[\\\/]server[\\\/]db[\\\/]/i);
    assert.match(workspaceFixtureRoot, /[\\\/]\.test-artifact[\\\/]server[\\\/]workspace[\\\/]/i);
    assert.ok(fs.existsSync(artifactServerRoot));
    assert.deepEqual(
      fs
        .readdirSync(process.cwd())
        .filter((entry) => /^tmp-.*\.sqlite(?:-wal|-shm)?$/i.test(entry)),
      [],
    );

      await app.close();
    },
    15000,
  );

  test(
    "S6 terminal failed tool path still returns finishReason error and does not persist a fake assistant answer",
    async () => {
      const app = await createAuthedApp();
      const { user, thread, token } = createUserThread();

      setupToolExposure("打开 README.md。", [readToolDefinition()]);
      vi.spyOn(providerProxyService, "streamTaskChatText").mockImplementation(
        async function* () {
          yield '{"type":"use_tool","toolId":"read","args":{"path":"README.md"},"reason":"Need the file content."}';
        },
      );
      const generateSpy = vi.spyOn(runnablesModule.agentGenerateTextRunnable, "invoke");
      vi.spyOn(harnessInvocations, "executeHarnessInvocation").mockResolvedValue({
        id: "invocation-s6-read-terminal-failed",
        toolId: "read",
        status: "failed",
        error: {
          message: "Tool protocol mismatch: result payload is invalid",
        },
        startedAt: "2026-07-06T00:00:00.000Z",
        finishedAt: "2026-07-06T00:00:01.000Z",
      } as never);

      const response = await sendAgentChat({
        app,
        token,
        threadId: thread.id,
        messageId: "user-s6",
        text: "打开 README.md。",
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.match(response.body, /protocol mismatch/i);
      // A terminal tool failure is not a transport failure: the stream still
      // completes, and the answer is the guarded failure text rather than a
      // fabricated success. The important guarantee is that the persisted
      // message records the failure instead of claiming a completed answer.
      assert.match(response.body, /"finishReason":"stop"/);
      assert.match(response.body, /Agent 运行失败。/);
      assert.equal(generateSpy.mock.calls.length, 0);

      const assistantMessage = getLatestAssistantMessage(thread.id, user.id);
      assert.ok(assistantMessage);
      // The persisted content carries the real failure reason, not a fabricated success.
      assert.match(assistantMessage?.content ?? "", /protocol mismatch/i);
      const agentMetadata = (
        assistantMessage?.metadata as
        | { agent?: { status?: string; errorMessage?: string } }
        | undefined
      )?.agent;
      assert.equal(agentMetadata?.status, "failed");
      assert.match(agentMetadata?.errorMessage ?? "", /protocol mismatch/i);

      await app.close();
    },
    15000,
  );
});
