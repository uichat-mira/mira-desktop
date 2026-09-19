import {
  forgeApi,
  type RegisterForgeProjectInput,
} from "@/shared/api/forge";
import type {
  ForgeBatch,
  ForgeDispatch,
  ForgeDispatchReadiness,
  ForgeInspectorData,
  ForgeMainThread,
  ForgeMainThreadSnapshot,
  ForgeMeta,
  ForgeProject,
  ForgeReview,
  ForgeRuntimeEvent,
  ForgeRuntimeSummary,
  ForgeTaskSource,
} from "@/shared/api/forge/types";

export interface ForgeShellData {
  meta: ForgeMeta;
  projects: ForgeProject[];
  batches: ForgeBatch[];
  dispatches: ForgeDispatch[];
  summary: ForgeRuntimeSummary;
}

export interface ForgeProjectData {
  projectId: string;
  taskSource: ForgeTaskSource | null;
  taskSourceError: string | null;
  batches: ForgeBatch[];
  dispatches: ForgeDispatch[];
  reviews: ForgeReview[];
  threads: ForgeMainThread[];
  threadSnapshot: ForgeMainThreadSnapshot | null;
  events: ForgeRuntimeEvent[];
  readiness: ForgeDispatchReadiness[];
  readinessFailures: Array<{
    batchId: string;
    error: string;
  }>;
}

const readError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const newestByUpdatedAt = <T extends { updatedAt: string }>(items: T[]) =>
  [...items].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

export interface ForgeDesktopProtocol {
  loadShell(): Promise<ForgeShellData>;
  loadProject(
    projectId: string,
    preferredThreadId?: string | null,
  ): Promise<ForgeProjectData>;
  loadInspector(query: {
    projectId: string;
    batchId?: string;
    taskId?: string;
    dispatchId?: string;
    threadId?: string;
  }): Promise<ForgeInspectorData>;
  registerProject(
    input: RegisterForgeProjectInput,
  ): ReturnType<typeof forgeApi.registerProject>;
  openThread(input: {
    projectId: string;
    adapter: "opencode" | "codex-desktop" | "codex";
  }): ReturnType<typeof forgeApi.openThread>;
  sendMessage(
    threadId: string,
    message: string,
  ): ReturnType<typeof forgeApi.sendMessage>;
  createBatch(
    projectId: string,
    taskId: string,
  ): ReturnType<typeof forgeApi.createBatch>;
  dispatchTask(
    batchId: string,
    taskId: string,
    input: {
      builder: "opencode" | "piagent" | "codex";
      sourceThreadId?: string;
      taskRef?: string;
    },
  ): ReturnType<typeof forgeApi.dispatchTask>;
  cancelDispatch(
    dispatchId: string,
  ): ReturnType<typeof forgeApi.cancelDispatch>;
  integrateTask(
    projectId: string,
    batchId: string,
    taskId: string,
    expectedSha: string,
  ): ReturnType<typeof forgeApi.integrateTask>;
}

export class DesktopForgeProtocol implements ForgeDesktopProtocol {
  async loadShell(): Promise<ForgeShellData> {
    const [meta, projects, batches, dispatches, summary] = await Promise.all([
      forgeApi.getMeta(),
      forgeApi.listProjects(),
      forgeApi.listBatches(),
      forgeApi.listDispatches(),
      forgeApi.getRuntimeSummary(),
    ]);
    return { meta, projects, batches, dispatches, summary };
  }

  async loadProject(
    projectId: string,
    preferredThreadId?: string | null,
  ): Promise<ForgeProjectData> {
    const [batches, dispatches, reviews, threads, events, taskSourceResult] =
      await Promise.all([
        forgeApi.listBatches(projectId),
        forgeApi.listDispatches({ projectId }),
        forgeApi.listReviews({ projectId }),
        forgeApi.listThreads(projectId),
        forgeApi.getEvents({ projectId }),
        forgeApi
          .inspectTaskSource(projectId)
          .then((taskSource) => ({ taskSource, error: null as string | null }))
          .catch((error) => ({
            taskSource: null,
            error: readError(error),
          })),
      ]);

    const sortedThreads = newestByUpdatedAt(threads);
    const selectedThread =
      sortedThreads.find((thread) => thread.id === preferredThreadId) ??
      sortedThreads[0] ??
      null;
    const threadSnapshot = selectedThread
      ? await forgeApi.getThread(selectedThread.id)
      : null;

    const readinessResults = await Promise.all(
      batches
        .filter((batch) => batch.status !== "integrated")
        .map(async (batch) => {
          try {
            return {
              readiness: await forgeApi.getReadiness(batch.id),
              failure: null,
            };
          } catch (error) {
            return {
              readiness: null,
              failure: {
                batchId: batch.id,
                error: readError(error),
              },
            };
          }
        }),
    );
    const readiness = readinessResults.flatMap((result) =>
      result.readiness ? [result.readiness] : [],
    );
    const readinessFailures = readinessResults.flatMap((result) =>
      result.failure ? [result.failure] : [],
    );

    return {
      projectId,
      taskSource: taskSourceResult.taskSource,
      taskSourceError: taskSourceResult.error,
      batches,
      dispatches,
      reviews,
      threads: sortedThreads,
      threadSnapshot,
      events,
      readiness,
      readinessFailures,
    };
  }

  loadInspector(query: {
    projectId: string;
    batchId?: string;
    taskId?: string;
    dispatchId?: string;
    threadId?: string;
  }) {
    return forgeApi.getInspector(query);
  }

  registerProject(input: RegisterForgeProjectInput) {
    return forgeApi.registerProject(input);
  }

  openThread(input: {
    projectId: string;
    adapter: "opencode" | "codex-desktop" | "codex";
  }) {
    return forgeApi.openThread({
      projectId: input.projectId,
      adapter: input.adapter,
      title: "Main Thread",
    });
  }

  sendMessage(threadId: string, message: string) {
    return forgeApi.sendMessage(threadId, { message });
  }

  createBatch(projectId: string, taskId: string) {
    return forgeApi.createBatch(projectId, {
      name: taskId,
      taskIds: [taskId],
    });
  }

  dispatchTask(
    batchId: string,
    taskId: string,
    input: {
      builder: "opencode" | "piagent" | "codex";
      sourceThreadId?: string;
      taskRef?: string;
    },
  ) {
    return forgeApi.dispatchTask(batchId, taskId, input);
  }

  cancelDispatch(dispatchId: string) {
    return forgeApi.cancelDispatch(dispatchId);
  }

  integrateTask(
    projectId: string,
    batchId: string,
    taskId: string,
    expectedSha: string,
  ) {
    return forgeApi.integrateTask(batchId, taskId, {
      projectId,
      expectedSha,
    });
  }
}
