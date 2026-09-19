// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForgeDesktopProtocol } from "../core/protocol";
import { useForgeWorkspace } from "./useForgeWorkspace";

const shell = {
  meta: {
    taskStatuses: [],
    adapterKinds: [],
    adapterStatuses: [],
    sessionRoles: [],
    sessionStatuses: [],
    reviewStatuses: [],
    dispatchStatuses: [],
    builderChoices: ["codex"],
    builtinBuilderAdapters: [],
    mainThreadAdapters: ["codex"],
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
  batches: [],
  dispatches: [],
  summary: {
    schemaVersion: 1,
    projectCount: 1,
    batchCount: 0,
    activeBatchCount: 0,
    threadCount: 1,
    activeThreadCount: 0,
    dispatchCount: 0,
    activeDispatch: null,
    reviewCount: 0,
    pendingReviewCount: 0,
    attentionTaskCount: 0,
    adapterSummary: [],
    updatedAt: null,
  },
};

const thread = {
  id: "MT-1",
  projectId: "P-1",
  adapter: "codex",
  title: "Main Thread",
  model: null,
  status: "idle",
  externalThreadId: null,
  lastError: null,
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
};

const projectData = {
  projectId: "P-1",
  taskSource: {
    kind: "repository-markdown",
    ledgerRef: "TASKS.md",
    taskDirRef: "docs/tasks",
    tasks: [],
  },
  taskSourceError: null,
  batches: [],
  dispatches: [],
  reviews: [],
  threads: [thread],
  threadSnapshot: {
    thread,
    events: [],
  },
  events: [],
  readiness: [],
  readinessFailures: [],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("useForgeWorkspace", () => {
  it("starts refresh polling while a Main Thread send request is still in flight", async () => {
    let resolveSend:
      | ((value: typeof projectData.threadSnapshot) => void)
      | undefined;
    const sendMessage = vi.fn(
      () =>
        new Promise<typeof projectData.threadSnapshot>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const loadShell = vi.fn().mockResolvedValue(shell);
    const loadProject = vi.fn().mockResolvedValue(projectData);

    const protocol = {
      loadShell,
      loadProject,
      loadInspector: vi.fn(),
      registerProject: vi.fn(),
      openThread: vi.fn(),
      sendMessage,
      createBatch: vi.fn(),
      dispatchTask: vi.fn(),
      cancelDispatch: vi.fn(),
      integrateTask: vi.fn(),
    } as unknown as ForgeDesktopProtocol;

    const { result } = renderHook(() =>
      useForgeWorkspace({ protocol }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.useFakeTimers();

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.sendMessage("hello");
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledWith("MT-1", "hello");
    const callsBeforePoll = loadShell.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(loadShell.mock.calls.length).toBeGreaterThan(callsBeforePoll);

    await act(async () => {
      resolveSend?.(projectData.threadSnapshot);
      await sendPromise;
    });
  });
});
