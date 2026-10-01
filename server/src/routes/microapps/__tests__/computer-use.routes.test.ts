import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { afterAll, test } from "vitest";
import Fastify from "fastify";
import { createAccessToken, initializeAuthDatabase } from "@/db/auth.db";
import { resetDatabaseClients } from "@/db/index.js";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { userRepository } from "@/db/repositories/index.js";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import {
  ComputerUseApprovalRequiredError,
  ComputerUseRequestValidationError,
  ComputerUseRuntimeUnavailableError,
  ComputerUseTaskNotFoundError,
  type ComputerUseGoalInput,
  type ComputerUseRuntimeState,
  type ComputerUseTask,
} from "@/microapps/computer-use/index.js";
import type { BrowserRuntimeDownloadRequest } from "@/microapps/computer-use/runtime/types.js";
import type { ComputerUseDebuggerService } from "../computer-use/debugger-service.js";
import { getLoggerConfig } from "@/logger";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { sendRouteError } from "@/utils/route-errors.js";
import microappsRoute, {
  type ComputerUseRouteService,
  type ComputerUseRuntimeRouteService,
  type ComfyUiStudioRouteService,
  type ImageGenerationRouteService,
  type MailCenterRouteService,
  type NewsHubRouteService,
  type CodeGraphStudioRouteService,
  type TtsRouteService,
} from "../index.js";

const testDbPath = createTimestampedTestArtifactPath(
  "db",
  "rag-demo-computer-use-routes",
  ".sqlite",
);

process.env.DATABASE_URL = `file:${testDbPath}`;
resetDatabaseClients();

initializeAuthDatabase();
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeThreadDatabase();
initializeRoleDatabase();

afterAll(() => {
  resetDatabaseClients();
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // ignore cleanup failure on Windows file locking
  }
});

const baseRuntime = (
  overrides: Partial<ComputerUseRuntimeState> = {},
): ComputerUseRuntimeState => ({
  status: "ready",
  browserEngine: "chromium",
  version: "141.0.0",
  checkedAt: "2026-07-06T12:00:00.000Z",
  ...overrides,
});

const createTask = (
  overrides: Partial<ComputerUseTask> = {},
): ComputerUseTask => ({
  id: "task-1",
  goal: "Open example.com",
  siteScope: ["example.com"],
  status: "queued",
  runtime: baseRuntime(),
  plan: {
    steps: [
      {
        id: "step-1",
        title: "Open page",
        description: "Navigate to the target site.",
        status: "pending",
        requiresApproval: false,
      },
    ],
    summary: "Open the target page and capture evidence.",
    createdAt: "2026-07-06T12:00:00.000Z",
    updatedAt: "2026-07-06T12:00:00.000Z",
    version: 1,
  },
  approvals: [],
  evidence: {
    entries: [],
    artifacts: [],
  },
  createdAt: "2026-07-06T12:00:00.000Z",
  updatedAt: "2026-07-06T12:00:00.000Z",
  ...overrides,
});

const imageGenerationService: ImageGenerationRouteService = {
  async createGeneration() {
    throw new Error("not used in computer use route tests");
  },
  async getGeneration() {
    throw new Error("not used in computer use route tests");
  },
};

const mailCenterService: MailCenterRouteService = {
  getOverview() {
    return {
      accounts: [],
      selectedAccountId: null,
      inbox: null,
    };
  },
  getMessageDetail() {
    throw new Error("not used in computer use route tests");
  },
  deleteAccount() {
    throw new Error("not used in computer use route tests");
  },
  saveAccount() {
    throw new Error("not used in computer use route tests");
  },
  async sendTestMail() {
    throw new Error("not used in computer use route tests");
  },
  async syncInbox() {
    throw new Error("not used in computer use route tests");
  },
};

const newsHubService: NewsHubRouteService = {
  async getOverview() {
    return {
      sources: [],
      items: [],
      total: 0,
      generatedAt: "2026-07-06T12:00:00.000Z",
    };
  },
  getConfig() {
    return {
      newsDataEnabled: false,
      newsDataApiKey: "",
      currentsEnabled: false,
      currentsApiKey: "",
      redditEnabled: false,
      redditClientId: "",
      redditClientSecret: "",
      redditUserAgent: "UIChat-Mira-NewsHub/0.1",
      redditSubreddits: "technology",
      refreshTtlMinutes: 60,
    };
  },
  updateConfig(input) {
    return {
      newsDataEnabled: input.newsDataEnabled ?? false,
      newsDataApiKey: input.newsDataApiKey ?? "",
      currentsEnabled: input.currentsEnabled ?? false,
      currentsApiKey: input.currentsApiKey ?? "",
      redditEnabled: input.redditEnabled ?? false,
      redditClientId: input.redditClientId ?? "",
      redditClientSecret: input.redditClientSecret ?? "",
      redditUserAgent: input.redditUserAgent ?? "UIChat-Mira-NewsHub/0.1",
      redditSubreddits: input.redditSubreddits ?? "technology",
      refreshTtlMinutes: input.refreshTtlMinutes ?? 60,
    };
  },
  async refresh() {
    return {
      startedAt: "2026-07-06T12:00:00.000Z",
      finishedAt: "2026-07-06T12:00:01.000Z",
      fetchedCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      ttlMinutes: 60,
      sources: [],
    };
  },
};

const codeGraphStudioService: CodeGraphStudioRouteService = {
  async getReport() {
    return {
      status: "stopped",
      blockedReasons: [],
      config: {
        workspaceRoot: "/tmp/computer-use-routes",
        appDataRoot: "",
        appDataRootResolved: null,
        logRoot: null,
        indexRoot: null,
        microAppEnabled: true,
        agentCapabilityEnabled: false,
      },
      index: null,
    };
  },
} as unknown as CodeGraphStudioRouteService;

const ttsService = {
  async getOverview() {
    return { providers: [], recentJobs: [] };
  },
  getProvider() {
    return null;
  },
} as unknown as TtsRouteService;

const createApp = async (input: {
  computerUseService: ComputerUseRouteService;
  computerUseRuntimeService: ComputerUseRuntimeRouteService;
  computerUseDebuggerService?: ComputerUseDebuggerService;
}) => {
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  await app.register(microappsRoute, {
    imageGenerationService,
    comfyUiStudioService: {} as ComfyUiStudioRouteService,
    computerUseService: input.computerUseService,
    computerUseRuntimeService: input.computerUseRuntimeService,
    computerUseDebuggerService: input.computerUseDebuggerService,
    mailCenterService,
    newsHubService,
    codeGraphStudioService,
    ttsService,
  });
  return app;
};

const debuggerSession = {
  sessionId: "browser-session-1",
  status: "ready",
  config: { runtime: "managed", url: "https://example.com", allowedDomains: ["example.com"], limits: { timeoutMs: 30000, maxSnapshotChars: 12000 }, approvalPolicy: "write_actions" },
  browser: { url: "https://example.com", title: "Example", snapshot: "button ref=e1", visibleText: "Example page", screenshotArtifact: "artifact-1", snapshotHash: "hash-1" },
  invocations: [],
  evidence: { entries: [], artifacts: [] },
};

const createDebuggerService = (): ComputerUseDebuggerService => ({
  getStatus: () => ({ runtime: { status: "ready", checkedAt: "2026-07-14T00:00:00.000Z" }, model: { status: "unavailable", message: "No provider", checkedAt: "2026-07-14T00:00:00.000Z" } }),
  create: async () => debuggerSession,
  get: () => debuggerSession,
  observe: async () => debuggerSession,
  act: async (_id, input) => ({ ...debuggerSession, invocations: [{ invocationId: "invocation-1", tool: "browser_act", args: input, status: "succeeded", createdAt: "2026-07-14T00:00:00.000Z" }] }),
  assert: async () => debuggerSession,
  stop: async () => ({ ...debuggerSession, status: "stopped" }),
  readArtifact: async () => ({ bytes: Buffer.from("png-bytes"), contentType: "image/png" }),
});

const createToken = () => {
  const user = userRepository.create({
    username: `computer-use-user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });

  return createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
};

test("computer use routes expose runtime state, create task, start, approve, and cancel", async () => {
  const plannedTask = createTask();
  const awaitingTask = createTask({
    status: "awaiting_approval",
    currentStepId: "step-submit",
    pendingApproval: {
      id: "approval-1",
      stepId: "step-submit",
      status: "pending",
      title: "Approve submit",
      reason: "This action sends data to an external site.",
      requestedAt: "2026-07-06T12:00:02.000Z",
    },
    approvals: [
      {
        id: "approval-1",
        stepId: "step-submit",
        status: "pending",
        title: "Approve submit",
        reason: "This action sends data to an external site.",
        requestedAt: "2026-07-06T12:00:02.000Z",
      },
    ],
  });
  const cancelledTask = createTask({
    status: "cancelled",
    result: {
      status: "cancelled",
      summary: "Stopped by user.",
      completedAt: "2026-07-06T12:00:04.000Z",
    },
    completedAt: "2026-07-06T12:00:04.000Z",
  });

  const computerUseService: ComputerUseRouteService = {
    async createPlan(input: ComputerUseGoalInput) {
      assert.equal(input.goal, "Open example.com");
      return plannedTask;
    },
    async getTask(taskId: string) {
      assert.equal(taskId, plannedTask.id);
      return plannedTask;
    },
    async startTask(taskId: string) {
      assert.equal(taskId, plannedTask.id);
      return awaitingTask;
    },
    async resolveApproval(input) {
      assert.deepEqual(input, {
        taskId: plannedTask.id,
        approvalId: "approval-1",
        decision: "approved",
        resolvedBy: "tester",
        resolutionNote: undefined,
      });
      return createTask({
        status: "succeeded",
        result: {
          status: "succeeded",
          summary: "Done",
          completedAt: "2026-07-06T12:00:03.000Z",
        },
      });
    },
    async cancelTask(taskId: string, reason?: string) {
      assert.equal(taskId, plannedTask.id);
      assert.equal(reason, "Stopped by user");
      return cancelledTask;
    },
  };

  const computerUseRuntimeService: ComputerUseRuntimeRouteService = {
    async getRuntimeState() {
      return baseRuntime();
    },
    async installRuntime(request: BrowserRuntimeDownloadRequest) {
      assert.equal(request.version, "141.0.0");
      return baseRuntime({
        checkedAt: "2026-07-06T12:00:01.000Z",
      });
    },
  };

  const app = await createApp({
    computerUseService,
    computerUseRuntimeService,
    computerUseDebuggerService: createDebuggerService(),
  });
  const token = createToken();

  const runtimeResponse = await app.inject({
    method: "GET",
    url: "/microapps/computer-use/runtime",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(runtimeResponse.statusCode, 200, runtimeResponse.body);
  assert.equal(runtimeResponse.json().data.status, "ready");

  const debuggerStatusResponse = await app.inject({
    method: "GET",
    url: "/microapps/computer-use/debugger/status",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(debuggerStatusResponse.statusCode, 200, debuggerStatusResponse.body);
  assert.equal(debuggerStatusResponse.json().data.model.status, "unavailable");

  const sessionResponse = await app.inject({
    method: "POST",
    url: "/microapps/computer-use/sessions",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: debuggerSession.config,
  });
  assert.equal(sessionResponse.statusCode, 200, sessionResponse.body);
  assert.equal(sessionResponse.json().data.sessionId, debuggerSession.sessionId);
  assert.equal(sessionResponse.json().data.browser.snapshotHash, "hash-1");

  const observeResponse = await app.inject({
    method: "POST",
    url: `/microapps/computer-use/sessions/${debuggerSession.sessionId}/observe`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(observeResponse.statusCode, 200, observeResponse.body);

  const actionResponse = await app.inject({
    method: "POST",
    url: `/microapps/computer-use/sessions/${debuggerSession.sessionId}/action`,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { pageUrl: "https://example.com", snapshotHash: "hash-1", action: { kind: "click", ref: "e1" } },
  });
  assert.equal(actionResponse.statusCode, 200, actionResponse.body);
  assert.equal(actionResponse.json().data.invocations[0].tool, "browser_act");

  const assertResponse = await app.inject({
    method: "POST",
    url: `/microapps/computer-use/sessions/${debuggerSession.sessionId}/assert`,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { assertion: { kind: "title", expected: "Example" } },
  });
  assert.equal(assertResponse.statusCode, 200, assertResponse.body);

  const artifactResponse = await app.inject({
    method: "GET",
    url: `/microapps/computer-use/sessions/${debuggerSession.sessionId}/artifacts/artifact-1/content`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(artifactResponse.statusCode, 200, artifactResponse.body);
  assert.equal(artifactResponse.headers["content-type"], "image/png");
  assert.equal(artifactResponse.body, "png-bytes");

  const stopResponse = await app.inject({
    method: "POST",
    url: `/microapps/computer-use/sessions/${debuggerSession.sessionId}/stop`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(stopResponse.statusCode, 200, stopResponse.body);
  assert.equal(stopResponse.json().data.status, "stopped");

  const installResponse = await app.inject({
    method: "POST",
    url: "/microapps/computer-use/runtime/install",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      version: "141.0.0",
      archiveUrl: "https://example.com/chromium.zip",
      executableRelativePath: "chrome-win/chrome.exe",
    },
  });

  assert.equal(installResponse.statusCode, 200, installResponse.body);
  assert.equal(installResponse.json().data.checkedAt, "2026-07-06T12:00:01.000Z");

  const createResponse = await app.inject({
    method: "POST",
    url: "/microapps/computer-use/tasks",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      goal: "Open example.com",
      siteScope: ["example.com"],
    },
  });

  assert.equal(createResponse.statusCode, 200, createResponse.body);
  assert.equal(createResponse.json().data.taskId, plannedTask.id);
  assert.equal(createResponse.json().data.status, "queued");

  const startResponse = await app.inject({
    method: "POST",
    url: `/microapps/computer-use/tasks/${plannedTask.id}/start`,
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(startResponse.statusCode, 200, startResponse.body);
  assert.equal(startResponse.json().data.status, "awaiting_approval");
  assert.equal(
    startResponse.json().data.pendingApproval.reason,
    "This action sends data to an external site.",
  );

  const getResponse = await app.inject({
    method: "GET",
    url: `/microapps/computer-use/tasks/${plannedTask.id}`,
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(getResponse.statusCode, 200, getResponse.body);
  assert.equal(getResponse.json().data.goal, "Open example.com");

  const approvalResponse = await app.inject({
    method: "POST",
    url: `/microapps/computer-use/tasks/${plannedTask.id}/approval`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      approvalId: "approval-1",
      decision: "approved",
      resolvedBy: "tester",
    },
  });

  assert.equal(approvalResponse.statusCode, 200, approvalResponse.body);
  assert.equal(approvalResponse.json().data.status, "succeeded");

  const cancelResponse = await app.inject({
    method: "POST",
    url: `/microapps/computer-use/tasks/${plannedTask.id}/cancel`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      reason: "Stopped by user",
    },
  });

  assert.equal(cancelResponse.statusCode, 200, cancelResponse.body);
  assert.equal(cancelResponse.json().data.status, "cancelled");

  await app.close();
});

test("computer use routes reject invalid create payloads before touching service", async () => {
  let called = false;
  const app = await createApp({
    computerUseService: {
      async createPlan() {
        called = true;
        return createTask();
      },
      async getTask() {
        return createTask();
      },
      async startTask() {
        return createTask();
      },
      async resolveApproval() {
        return createTask();
      },
      async cancelTask() {
        return createTask();
      },
    },
    computerUseRuntimeService: {
      async getRuntimeState() {
        return baseRuntime();
      },
      async installRuntime() {
        return baseRuntime();
      },
    },
  });
  const token = createToken();

  const response = await app.inject({
    method: "POST",
    url: "/microapps/computer-use/tasks",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {},
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().code, "VALIDATION_ERROR");
  assert.equal(called, false);

  await app.close();
});

test("computer use routes map runtime unavailable and approval-missing conflicts to 409", async () => {
  const app = await createApp({
    computerUseService: {
      async createPlan() {
        throw new ComputerUseRuntimeUnavailableError(
          baseRuntime({
            status: "not_installed",
            message: "runtime missing",
          }),
        );
      },
      async getTask() {
        return createTask();
      },
      async startTask() {
        return createTask();
      },
      async resolveApproval() {
        throw new ComputerUseApprovalRequiredError("task-1");
      },
      async cancelTask() {
        return createTask();
      },
    },
    computerUseRuntimeService: {
      async getRuntimeState() {
        return baseRuntime({
          status: "not_installed",
          message: "runtime missing",
        });
      },
      async installRuntime() {
        return baseRuntime();
      },
    },
  });
  const token = createToken();

  const createResponse = await app.inject({
    method: "POST",
    url: "/microapps/computer-use/tasks",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      goal: "Open example.com",
    },
  });

  assert.equal(createResponse.statusCode, 409, createResponse.body);
  assert.match(
    createResponse.json().message,
    /Computer use runtime is not ready: not_installed/,
  );

  const approvalResponse = await app.inject({
    method: "POST",
    url: "/microapps/computer-use/tasks/task-1/approval",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      approvalId: "approval-missing",
      decision: "approved",
    },
  });

  assert.equal(approvalResponse.statusCode, 409, approvalResponse.body);
  assert.match(
    approvalResponse.json().message,
    /Computer use task is waiting for approval: task-1/,
  );

  await app.close();
});

test("computer use routes map missing tasks and cancellation validation failures", async () => {
  const app = await createApp({
    computerUseService: {
      async createPlan() {
        return createTask();
      },
      async getTask() {
        return null;
      },
      async startTask() {
        throw new ComputerUseTaskNotFoundError("task-missing");
      },
      async resolveApproval() {
        return createTask();
      },
      async cancelTask() {
        throw new ComputerUseRequestValidationError(
          "Computer use task is already finished and cannot be cancelled again.",
        );
      },
    },
    computerUseRuntimeService: {
      async getRuntimeState() {
        return baseRuntime();
      },
      async installRuntime() {
        return baseRuntime();
      },
    },
  });
  const token = createToken();

  const getResponse = await app.inject({
    method: "GET",
    url: "/microapps/computer-use/tasks/task-missing",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(getResponse.statusCode, 404, getResponse.body);
  assert.equal(
    getResponse.json().message,
    "Computer use task was not found: task-missing",
  );

  const cancelResponse = await app.inject({
    method: "POST",
    url: "/microapps/computer-use/tasks/task-1/cancel",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      reason: "duplicate cancel",
    },
  });

  assert.equal(cancelResponse.statusCode, 400, cancelResponse.body);
  assert.equal(
    cancelResponse.json().message,
    "Computer use task is already finished and cannot be cancelled again.",
  );

  await app.close();
});
