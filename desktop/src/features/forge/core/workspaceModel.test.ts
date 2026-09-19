import { describe, expect, it } from "vitest";
import { buildForgeWorkspaceSnapshot } from "./workspaceModel";
import type {
  ForgeProjectData,
  ForgeShellData,
} from "./protocol";

const shell = {
  meta: {
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
  },
  projects: [
    {
      id: "P-1",
      name: "Project",
      rootPath: "C:/repo",
      repository: null,
      taskLedger: "TASKS.md",
      taskDir: "docs/tasks",
      integrationBranch: "dev",
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
    },
  ],
  batches: [
    {
      id: "B-1",
      projectId: "P-1",
      name: "Batch",
      status: "reviewing",
      baseSha: null,
      tasks: [
        {
          id: "T100",
          title: "Task",
          status: "reviewing",
          builder: "codex-desktop-local",
          builderSessionId: "S-1",
          reviewerSessionId: null,
          worktree: null,
          baseSha: null,
          currentSha: "sha-1",
          reviewedSha: null,
          reviewRound: 0,
          dependsOn: [],
          previewUrls: {},
          createdAt: "2026-09-06T00:00:00.000Z",
          updatedAt: "2026-09-06T00:01:00.000Z",
        },
      ],
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:01:00.000Z",
    },
  ],
  dispatches: [
    {
      id: "D-1",
      projectId: "P-1",
      batchId: "B-1",
      taskId: "T100",
      adapterId: "codex-desktop-local",
      sessionId: "S-1",
      sourceThreadId: "MT-1",
      status: "completed",
      promptSource: "task_ref",
      taskRef: "docs/tasks/T100.md",
      model: null,
      agent: null,
      externalSessionId: "codex-thread-1",
      pid: null,
      exitCode: 0,
      signal: null,
      error: null,
      resultText: "Builder completed",
      startedAt: "2026-09-06T00:00:00.000Z",
      endedAt: "2026-09-06T00:01:00.000Z",
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:01:00.000Z",
    },
  ],
  summary: {
    schemaVersion: 1,
    projectCount: 1,
    batchCount: 1,
    activeBatchCount: 1,
    threadCount: 1,
    activeThreadCount: 0,
    dispatchCount: 1,
    activeDispatch: null,
    reviewCount: 0,
    pendingReviewCount: 0,
    attentionTaskCount: 0,
    adapterSummary: [],
    updatedAt: "2026-09-06T00:01:00.000Z",
  },
} as ForgeShellData;

const projectData = {
  projectId: "P-1",
  taskSource: {
    kind: "repository-markdown",
    ledgerRef: "TASKS.md",
    taskDirRef: "docs/tasks",
    tasks: [
      {
        id: "T100",
        title: "Task",
        status: "REVIEW",
        cardStatus: "REVIEW",
        taskRef: "docs/tasks/T100.md",
        warnings: [],
      },
    ],
  },
  taskSourceError: null,
  batches: shell.batches,
  dispatches: shell.dispatches,
  reviews: [],
  threads: [
    {
      id: "MT-1",
      projectId: "P-1",
      adapter: "codex",
      title: "Main Thread",
      model: null,
      status: "idle",
      externalThreadId: "codex-thread-main",
      lastError: null,
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:01:00.000Z",
    },
  ],
  threadSnapshot: {
    thread: {
      id: "MT-1",
      projectId: "P-1",
      adapter: "codex",
      title: "Main Thread",
      model: null,
      status: "idle",
      externalThreadId: "codex-thread-main",
      lastError: null,
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:01:00.000Z",
    },
    events: [
      {
        id: "H-1",
        threadId: "MT-1",
        projectId: "P-1",
        type: "handoff",
        role: null,
        text: "Builder completed",
        tool: null,
        artifact: null,
        handoff: {
          kind: "builder_result",
          taskId: "T100",
          adapterId: "codex-desktop-local",
          dispatchId: "D-1",
          dispatchStatus: "completed",
          sessionStatus: "completed",
          taskStatus: "reviewing",
          resultText: "Builder completed",
          error: null,
        },
        provider: null,
        createdAt: "2026-09-06T00:01:00.000Z",
      },
    ],
  },
  events: [],
  readiness: [],
  readinessFailures: [],
} as ForgeProjectData;

describe("buildForgeWorkspaceSnapshot", () => {
  it("keeps repository and runtime states independent", () => {
    const snapshot = buildForgeWorkspaceSnapshot({
      shell,
      projectData,
      selectedProjectId: "P-1",
      selectedTaskId: "T100",
      inspector: null,
    });

    expect(snapshot.tasks[0]?.repositoryState).toBe("REVIEW");
    expect(snapshot.tasks[0]?.runtimeState).toBe("reviewing");
    expect(snapshot.tasks[0]?.repositoryState).not.toBe("PASS");
  });

  it("keeps the latest integrated runtime state instead of falling back to waiting", () => {
    const integratedShell = {
      ...shell,
      batches: [
        {
          ...shell.batches[0],
          status: "integrated" as const,
          tasks: [
            {
              ...shell.batches[0].tasks[0],
              status: "integrated" as const,
            },
          ],
        },
      ],
    };
    const integratedProjectData = {
      ...projectData,
      batches: integratedShell.batches,
      readiness: [],
    } as ForgeProjectData;

    const snapshot = buildForgeWorkspaceSnapshot({
      shell: integratedShell,
      projectData: integratedProjectData,
      selectedProjectId: "P-1",
      selectedTaskId: "T100",
      inspector: null,
    });

    expect(snapshot.tasks[0]?.runtimeState).toBe("integrated");
    expect(snapshot.tasks[0]?.readiness).toBe("unavailable");
  });

  it("projects Builder Result Handoff without promoting Task truth", () => {
    const snapshot = buildForgeWorkspaceSnapshot({
      shell,
      projectData,
      selectedProjectId: "P-1",
      selectedTaskId: "T100",
      inspector: null,
    });

    const handoff = snapshot.messages.find(
      (message) => message.kind === "builder-result",
    );
    expect(handoff?.handoff?.dispatchStatus).toBe("completed");
    expect(handoff?.handoff?.taskStatus).toBe("reviewing");
    expect(snapshot.tasks[0]?.runtimeState).toBe("reviewing");
    expect(snapshot.tasks[0]?.repositoryState).toBe("REVIEW");
  });

  it("preserves readiness transport failures as operational evidence", () => {
    const snapshot = buildForgeWorkspaceSnapshot({
      shell,
      projectData: {
        ...projectData,
        readiness: [],
        readinessFailures: [
          {
            batchId: "B-1",
            error: "readiness endpoint unavailable",
          },
        ],
      },
      selectedProjectId: "P-1",
      selectedTaskId: "T100",
      inspector: null,
    });

    expect(snapshot.tasks[0]?.readiness).toBe("unavailable");
    expect(snapshot.tasks[0]?.readinessReasons).toEqual([
      "readiness_check_failed: readiness endpoint unavailable",
    ]);
  });

});
