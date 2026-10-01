import { get, patch, post } from "@/shared/lib/request";
import type {
  ForgeBatch,
  ForgeDispatch,
  ForgeDispatchReadiness,
  ForgeInspectorData,
  ForgeMainThread,
  ForgeMainThreadEvent,
  ForgeMainThreadSnapshot,
  ForgeMeta,
  ForgeProject,
  ForgeRepositoryTask,
  ForgeReview,
  ForgeRuntimeEvent,
  ForgeRuntimeSummary,
  ForgeTask,
  ForgeTaskSource,
} from "./types";

export interface RegisterForgeProjectInput {
  id?: string;
  name: string;
  rootPath: string;
  repository?: string | null;
  integrationBranch?: string;
  taskLedger?: string | null;
  taskDir?: string | null;
}

export interface UpdateForgeProjectInput {
  name?: string;
  repository?: string | null;
  integrationBranch?: string;
  taskLedger?: string | null;
  taskDir?: string | null;
}

export interface CreateForgeRepositoryTaskInput {
  id: string;
  title: string;
  status?: string;
  body?: string;
  content?: string;
}

export interface UpdateForgeRepositoryTaskInput {
  title?: string;
  status?: string;
  content?: string;
}

export const forgeApi = {
  getMeta: () => get<ForgeMeta>("/forge/meta"),
  listDispatches: (query?: {
    projectId?: string;
    batchId?: string;
    taskId?: string;
    status?: string;
  }) => get<ForgeDispatch[]>("/forge/dispatches", { params: query }),

  listProjects: () => get<ForgeProject[]>("/forge/projects"),
  registerProject: (input: RegisterForgeProjectInput) =>
    post<{ project: ForgeProject; source: ForgeTaskSource | null }>(
      "/forge/projects",
      input,
    ),
  getProject: (projectId: string) =>
    get<ForgeProject>(`/forge/projects/${encodeURIComponent(projectId)}`),
  updateProject: (projectId: string, input: UpdateForgeProjectInput) =>
    patch<{ project: ForgeProject; source: ForgeTaskSource | null }>(
      `/forge/projects/${encodeURIComponent(projectId)}`,
      input,
    ),
  inspectTaskSource: (projectId: string) =>
    get<ForgeTaskSource>(
      `/forge/projects/${encodeURIComponent(projectId)}/task-source`,
    ),
  configureTaskSource: (
    projectId: string,
    input: { taskLedger: string | null; taskDir: string | null },
  ) =>
    patch<{ project: ForgeProject; source: ForgeTaskSource | null }>(
      `/forge/projects/${encodeURIComponent(projectId)}/task-source`,
      input,
    ),
  listRepositoryTasks: (projectId: string) =>
    get<ForgeTaskSource>(
      `/forge/projects/${encodeURIComponent(projectId)}/tasks`,
    ),
  resolveRepositoryTask: (projectId: string, taskId: string) =>
    get<ForgeRepositoryTask>(
      `/forge/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
    ),
  createRepositoryTask: (
    projectId: string,
    input: CreateForgeRepositoryTaskInput,
  ) =>
    post<ForgeRepositoryTask>(
      `/forge/projects/${encodeURIComponent(projectId)}/tasks`,
      input,
    ),
  updateRepositoryTask: (
    projectId: string,
    taskId: string,
    input: UpdateForgeRepositoryTaskInput,
  ) =>
    patch<ForgeRepositoryTask>(
      `/forge/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      input,
    ),

  listBatches: (projectId?: string) =>
    get<ForgeBatch[]>("/forge/batches", {
      params: projectId ? { projectId } : undefined,
    }),
  createBatch: (
    projectId: string,
    input: { name?: string; taskIds: string[] },
  ) =>
    post<ForgeBatch>(
      `/forge/projects/${encodeURIComponent(projectId)}/batches`,
      input,
    ),
  getBatch: (batchId: string) =>
    get<ForgeBatch>(`/forge/batches/${encodeURIComponent(batchId)}`),
  getReadiness: (batchId: string) =>
    get<ForgeDispatchReadiness>(
      `/forge/batches/${encodeURIComponent(batchId)}/readiness`,
    ),

  listThreads: (projectId?: string) =>
    get<ForgeMainThread[]>("/forge/threads", {
      params: projectId ? { projectId } : undefined,
    }),
  openThread: (input: {
    id?: string;
    projectId: string;
    adapter: "opencode" | "codex-desktop" | "codex";
    title?: string;
    model?: string;
  }) => post<ForgeMainThread>("/forge/threads", input),
  getThread: (threadId: string) =>
    get<ForgeMainThreadSnapshot>(
      `/forge/threads/${encodeURIComponent(threadId)}`,
    ),
  sendMessage: (
    threadId: string,
    input: { message: string; model?: string },
  ) =>
    post<ForgeMainThreadSnapshot>(
      `/forge/threads/${encodeURIComponent(threadId)}/messages`,
      input,
    ),
  inspectThreadTasks: (threadId: string) =>
    get<ForgeTaskSource>(
      `/forge/threads/${encodeURIComponent(threadId)}/tasks`,
    ),
  resolveThreadTask: (threadId: string, taskId: string) =>
    get<ForgeRepositoryTask>(
      `/forge/threads/${encodeURIComponent(threadId)}/tasks/${encodeURIComponent(taskId)}`,
    ),
  createThreadTask: (
    threadId: string,
    input: CreateForgeRepositoryTaskInput,
  ) =>
    post<ForgeRepositoryTask>(
      `/forge/threads/${encodeURIComponent(threadId)}/tasks`,
      input,
    ),
  updateThreadTask: (
    threadId: string,
    taskId: string,
    input: UpdateForgeRepositoryTaskInput,
  ) =>
    patch<ForgeRepositoryTask>(
      `/forge/threads/${encodeURIComponent(threadId)}/tasks/${encodeURIComponent(taskId)}`,
      input,
    ),
  createHandoff: (
    threadId: string,
    input: {
      taskId: string;
      taskRef?: string;
      preferredBuilder: string;
    },
  ) =>
    post<ForgeMainThreadEvent>(
      `/forge/threads/${encodeURIComponent(threadId)}/handoffs`,
      input,
    ),

  dispatchTask: (
    batchId: string,
    taskId: string,
    input: {
      adapterId?: string;
      builder?: string;
      preferredBuilder?: string;
      sourceThreadId?: string;
      prompt?: string;
      taskRef?: string;
      model?: string;
      agent?: string;
    },
  ) =>
    post<ForgeDispatch>(
      `/forge/batches/${encodeURIComponent(batchId)}/tasks/${encodeURIComponent(taskId)}/dispatch`,
      input,
    ),
  cancelDispatch: (dispatchId: string) =>
    post<ForgeDispatch>(
      `/forge/dispatches/${encodeURIComponent(dispatchId)}/cancel`,
    ),

  listReviews: (query?: {
    projectId?: string;
    batchId?: string;
    taskId?: string;
  }) => get<ForgeReview[]>("/forge/reviews", { params: query }),
  requestReview: (input: {
    projectId: string;
    batchId: string;
    taskId: string;
    reviewerSessionId: string;
    requestedSha: string;
  }) => post<ForgeReview>("/forge/reviews", input),
  resolveReview: (
    reviewId: string,
    input: {
      result: "passed" | "changes_requested" | "failed" | "cancelled";
      reviewedSha?: string;
    },
  ) =>
    post<ForgeReview>(
      `/forge/reviews/${encodeURIComponent(reviewId)}/result`,
      input,
    ),
  integrateTask: (
    batchId: string,
    taskId: string,
    input: { projectId: string; expectedSha: string },
  ) =>
    post<ForgeTask>(
      `/forge/batches/${encodeURIComponent(batchId)}/tasks/${encodeURIComponent(taskId)}/integrate`,
      input,
    ),

  getRuntimeSummary: () =>
    get<ForgeRuntimeSummary>("/forge/runtime/summary"),
  getInspector: (query?: {
    projectId?: string;
    batchId?: string;
    taskId?: string;
    dispatchId?: string;
    sessionId?: string;
    reviewId?: string;
    threadId?: string;
  }) => get<ForgeInspectorData>("/forge/inspector", { params: query }),
  getEvents: (query?: {
    projectId?: string;
    batchId?: string;
    taskId?: string;
    dispatchId?: string;
    sessionId?: string;
  }) => get<ForgeRuntimeEvent[]>("/forge/events", { params: query }),
};
