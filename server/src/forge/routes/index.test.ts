import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { sendRouteError } from "@/utils/route-errors.js";
import forgeRoutes from "./index.js";
import type { ForgeRouteService } from "./service.js";

function createService(): ForgeRouteService {
  return {
    runtime: {} as ForgeRouteService["runtime"],
    mainThread: {
      listThreads: vi.fn(async () => []),
      getThread: vi.fn(async () => ({
        thread: {
          id: "MT-1",
          projectId: "P-1",
          adapter: "codex",
          title: "Main",
          model: null,
          status: "idle",
          externalThreadId: null,
          lastError: null,
          createdAt: "2026-09-06T00:00:00.000Z",
          updatedAt: "2026-09-06T00:00:00.000Z",
        },
        events: [],
      })),
      openThread: vi.fn(async () => ({
        id: "MT-1",
        projectId: "P-1",
        adapter: "codex",
        title: "Main",
        model: null,
        status: "idle",
        externalThreadId: null,
        lastError: null,
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
      })),
      sendMessage: vi.fn(async () => ({
        thread: {
          id: "MT-1",
          projectId: "P-1",
          adapter: "codex",
          title: "Main",
          model: null,
          status: "idle",
          externalThreadId: "thr-1",
          lastError: null,
          createdAt: "2026-09-06T00:00:00.000Z",
          updatedAt: "2026-09-06T00:00:00.000Z",
        },
        events: [],
      })),
      inspectTasks: vi.fn(async () => ({
        kind: "repository-markdown",
        ledgerRef: "TASKS.md",
        taskDirRef: "docs/tasks",
        tasks: [],
      })),
      resolveTask: vi.fn(async () => ({
        id: "T100",
        title: "Task",
        status: "TODO",
        cardStatus: "TODO",
        taskRef: "docs/tasks/T100.md",
        warnings: [],
      })),
      createTask: vi.fn(async () => ({
        id: "T101",
        title: "Created",
        status: "TODO",
        cardStatus: "TODO",
        taskRef: "docs/tasks/T101.md",
        warnings: [],
      })),
      updateTask: vi.fn(async () => ({
        id: "T100",
        title: "Task",
        status: "DOING",
        cardStatus: "DOING",
        taskRef: "docs/tasks/T100.md",
        warnings: [],
      })),
      createHandoff: vi.fn(async () => ({
        id: "TE-1",
        threadId: "MT-1",
        projectId: "P-1",
        type: "handoff",
        role: null,
        text: "dispatch handoff: T100",
        tool: null,
        artifact: null,
        handoff: {
          projectId: "P-1",
          taskId: "T100",
          taskRef: "docs/tasks/T100.md",
          preferredBuilder: "opencode",
        },
        provider: null,
        createdAt: "2026-09-06T00:00:00.000Z",
      })),
      reconcile: vi.fn(async () => []),
      shutdown: vi.fn(async () => undefined),
    },
    dispatch: {
      dispatchTask: vi.fn(async () => ({
        id: "D-1",
        projectId: "P-1",
        batchId: "B-1",
        taskId: "T100",
        adapterId: "opencode-local",
        sessionId: "S-1",
        sourceThreadId: "MT-1",
        status: "starting",
        promptSource: "task_ref",
        taskRef: "docs/tasks/T100.md",
        model: null,
        agent: null,
        externalSessionId: null,
        pid: null,
        exitCode: null,
        signal: null,
        error: null,
        resultText: null,
        startedAt: null,
        endedAt: null,
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
      })),
      cancelDispatch: vi.fn(async () => ({
        id: "D-1",
        projectId: "P-1",
        batchId: "B-1",
        taskId: "T100",
        adapterId: "opencode-local",
        sessionId: "S-1",
        sourceThreadId: "MT-1",
        status: "cancelled",
        promptSource: "task_ref",
        taskRef: "docs/tasks/T100.md",
        model: null,
        agent: null,
        externalSessionId: null,
        pid: 42,
        exitCode: null,
        signal: "SIGTERM",
        error: null,
        resultText: null,
        startedAt: null,
        endedAt: "2026-09-06T00:01:00.000Z",
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:01:00.000Z",
      })),
      getReadiness: vi.fn(async () => ({
        batchId: "B-1",
        projectId: "P-1",
        ready: [],
        blocked: [],
      })),
      reconcile: vi.fn(async () => 0),
      shutdown: vi.fn(async () => undefined),
    },
    review: {
      requestReview: vi.fn(async (input) => ({
        id: "R-1",
        projectId: String(input.projectId),
        batchId: String(input.batchId),
        taskId: String(input.taskId),
        reviewerSessionId: String(input.reviewerSessionId),
        round: 1,
        requestedSha: String(input.requestedSha),
        reviewedSha: null,
        status: "requested",
        actionable: null,
        invalidatedAt: null,
        resolvedAt: null,
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
      })),
      resolveReview: vi.fn(async (_id, input) => ({
        id: "R-1",
        projectId: "P-1",
        batchId: "B-1",
        taskId: "T100",
        reviewerSessionId: "S-review",
        round: 1,
        requestedSha: "sha-1",
        reviewedSha: String(input.reviewedSha),
        status: input.result === "passed" ? "passed" : "changes_requested",
        actionable: true,
        invalidatedAt: null,
        resolvedAt: "2026-09-06T00:01:00.000Z",
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:01:00.000Z",
      })),
      integrateTask: vi.fn(async () => ({
        id: "T100",
        title: "Task",
        status: "integrated",
        builder: null,
        builderSessionId: null,
        reviewerSessionId: "S-review",
        worktree: null,
        baseSha: null,
        currentSha: "sha-1",
        reviewedSha: "sha-1",
        reviewRound: 1,
        dependsOn: [],
        previewUrls: {},
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:01:00.000Z",
      })),
    },
    listProjects: vi.fn(async () => []),
    getProject: vi.fn(async () => ({
      id: "P-1",
      name: "Project",
      rootPath: "/repo",
      repository: null,
      taskLedger: "TASKS.md",
      taskDir: "docs/tasks",
      integrationBranch: "dev",
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
    })),
    registerProject: vi.fn(async () => {
      throw new Error("unused");
    }),
    updateProject: vi.fn(async () => {
      throw new Error("unused");
    }),
    inspectTaskSource: vi.fn(async () => ({
      kind: "repository-markdown",
      ledgerRef: "TASKS.md",
      taskDirRef: "docs/tasks",
      tasks: [],
    })),
    resolveTask: vi.fn(async () => ({
      id: "T100",
      title: "Task",
      status: "TODO",
      cardStatus: "TODO",
      taskRef: "docs/tasks/T100.md",
      warnings: [],
    })),
    createTask: vi.fn(async () => {
      throw new Error("unused");
    }),
    updateTask: vi.fn(async () => {
      throw new Error("unused");
    }),
    createBatch: vi.fn(async () => {
      throw new Error("unused");
    }),
    listBatches: vi.fn(async () => []),
    getBatch: vi.fn(async () => {
      throw new Error("unused");
    }),
    readiness: vi.fn(async () => ({
      batchId: "B-1",
      projectId: "P-1",
      ready: [],
      blocked: [],
    })),
    meta: vi.fn(() => ({
      taskStatuses: [],
      adapterKinds: [],
      adapterStatuses: [],
      sessionRoles: [],
      sessionStatuses: [],
      reviewStatuses: [],
      dispatchStatuses: [],
      builderChoices: ["opencode", "piagent", "codex"],
      builtinBuilderAdapters: [],
      mainThreadAdapters: ["opencode", "codex-desktop", "codex"],
      mainThreadStatuses: ["idle", "running", "error"],
      mainThreadEventTypes: [
        "message",
        "thinking",
        "tool",
        "status",
        "artifact",
        "handoff",
      ],
    })),
    listDispatches: vi.fn(async () => []),
    listReviews: vi.fn(async () => []),
    runtimeSummary: vi.fn(async () => ({
      schemaVersion: 1,
      projectCount: 1,
      batchCount: 1,
      activeBatchCount: 1,
      threadCount: 1,
      activeThreadCount: 0,
      dispatchCount: 1,
      activeDispatch: null,
      reviewCount: 1,
      pendingReviewCount: 0,
      attentionTaskCount: 0,
      adapterSummary: [],
      updatedAt: "2026-09-06T00:01:00.000Z",
    })),
    inspector: vi.fn(async () => ({
      project: null,
      batch: null,
      task: null,
      dispatch: null,
      session: null,
      review: null,
      thread: null,
      threadEvents: [],
      events: [],
    })),
    events: vi.fn(async () => []),
  };
}

async function createApp(service: ForgeRouteService) {
  const app = Fastify();
  app.setErrorHandler(sendRouteError);
  await app.register(forgeRoutes, {
    getService: async () => service,
  });
  return app;
}

describe("Forge routes", () => {
  it("uses prefix-free backend paths and does not expose a generic runtime task patch", async () => {
    const service = createService();
    const app = await createApp(service);

    const meta = await app.inject({
      method: "GET",
      url: "/forge/meta",
    });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().data.builderChoices).toEqual([
      "opencode",
      "piagent",
      "codex",
    ]);

    const dispatches = await app.inject({
      method: "GET",
      url: "/forge/dispatches?status=running",
    });
    expect(dispatches.statusCode).toBe(200);
    expect(service.listDispatches).toHaveBeenCalledWith({
      status: "running",
    });

    const summary = await app.inject({
      method: "GET",
      url: "/forge/runtime/summary",
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().data.projectCount).toBe(1);

    const vitePrefixed = await app.inject({
      method: "GET",
      url: "/api/forge/runtime/summary",
    });
    expect(vitePrefixed.statusCode).toBe(404);

    const genericPatch = await app.inject({
      method: "PATCH",
      url: "/forge/batches/B-1/tasks/T100",
      payload: { status: "integrated" },
    });
    expect(genericPatch.statusCode).toBe(404);

    await app.close();
  });

  it("maps dispatch, guarded review, integration and inspector actions", async () => {
    const service = createService();
    const app = await createApp(service);

    const dispatch = await app.inject({
      method: "POST",
      url: "/forge/batches/B-1/tasks/T100/dispatch",
      payload: {
        builder: "opencode",
        sourceThreadId: "MT-1",
      },
    });
    expect(dispatch.statusCode).toBe(202);
    expect(service.dispatch.dispatchTask).toHaveBeenCalledWith({
      batchId: "B-1",
      taskId: "T100",
      builder: "opencode",
      sourceThreadId: "MT-1",
    });

    const review = await app.inject({
      method: "POST",
      url: "/forge/reviews",
      payload: {
        projectId: "P-1",
        batchId: "B-1",
        taskId: "T100",
        reviewerSessionId: "S-review",
        requestedSha: "sha-1",
      },
    });
    expect(review.statusCode).toBe(201);
    expect(service.review.requestReview).toHaveBeenCalledTimes(1);

    const integrate = await app.inject({
      method: "POST",
      url: "/forge/batches/B-1/tasks/T100/integrate",
      payload: {
        projectId: "P-1",
        expectedSha: "sha-1",
      },
    });
    expect(integrate.statusCode).toBe(200);
    expect(service.review.integrateTask).toHaveBeenCalledWith({
      projectId: "P-1",
      batchId: "B-1",
      taskId: "T100",
      expectedSha: "sha-1",
    });

    const inspector = await app.inject({
      method: "GET",
      url: "/forge/inspector?projectId=P-1&dispatchId=D-1",
    });
    expect(inspector.statusCode).toBe(200);
    expect(service.inspector).toHaveBeenCalledWith({
      projectId: "P-1",
      dispatchId: "D-1",
    });

    await app.close();
  });
});
