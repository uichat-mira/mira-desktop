import {
  initializeForgeRuntime,
  type ForgeRuntime,
} from "../runtime/runtime.js";
import { attachMainThreadRuntime } from "../main-thread/runtime.js";
import type { MainThreadManager } from "../main-thread/manager.js";
import {
  attachBuilderDispatchRuntime,
  type ForgeDispatchManager,
} from "../dispatch/index.js";
import {
  createForgeReviewManager,
  type ForgeReviewManager,
} from "../review/manager.js";
import {
  createProjectBatch,
  createProjectRepositoryTask,
  inspectProjectTaskSource,
  resolveProjectTask,
  updateProjectRepositoryTask,
} from "../project/project-task-actions.js";
import {
  getForgeProject,
  listForgeProjects,
  registerForgeProject,
  updateForgeProject,
} from "../project/project-registry.js";
import { getDispatchReadiness } from "../readiness.js";
import type { ForgeRuntimeState } from "../runtime/state.js";
import {
  forgeMeta,
  projectInspector,
  projectRuntimeSummary,
  publicRuntimeEvent,
} from "./public-contract.js";

export interface ForgeRouteService {
  readonly runtime: ForgeRuntime;
  readonly mainThread: MainThreadManager;
  readonly dispatch: ForgeDispatchManager;
  readonly review: ForgeReviewManager;
  listProjects(): ReturnType<typeof listForgeProjects>;
  getProject(projectId: unknown): ReturnType<typeof getForgeProject>;
  registerProject(
    input: Parameters<typeof registerForgeProject>[1],
  ): ReturnType<typeof registerForgeProject>;
  updateProject(
    projectId: unknown,
    input: Parameters<typeof updateForgeProject>[2],
  ): ReturnType<typeof updateForgeProject>;
  inspectTaskSource(
    projectId: unknown,
  ): ReturnType<typeof inspectProjectTaskSource>;
  resolveTask(
    projectId: unknown,
    taskId: unknown,
  ): ReturnType<typeof resolveProjectTask>;
  createTask(
    projectId: unknown,
    input: Parameters<typeof createProjectRepositoryTask>[2],
  ): ReturnType<typeof createProjectRepositoryTask>;
  updateTask(
    projectId: unknown,
    taskId: unknown,
    patch: Parameters<typeof updateProjectRepositoryTask>[3],
  ): ReturnType<typeof updateProjectRepositoryTask>;
  createBatch(
    projectId: unknown,
    input: Parameters<typeof createProjectBatch>[2],
  ): ReturnType<typeof createProjectBatch>;
  listBatches(projectId?: string): Promise<ForgeRuntimeState["batches"]>;
  getBatch(batchId: string): Promise<ForgeRuntimeState["batches"][number]>;
  readiness(batchId: string): Promise<ReturnType<typeof getDispatchReadiness>>;
  meta(): ReturnType<typeof forgeMeta>;
  listDispatches(input?: {
    projectId?: string;
    batchId?: string;
    taskId?: string;
    status?: string;
  }): Promise<ForgeRuntimeState["dispatches"]>;
  listReviews(input?: {
    projectId?: string;
    batchId?: string;
    taskId?: string;
  }): Promise<ForgeRuntimeState["reviews"]>;
  runtimeSummary(): Promise<ReturnType<typeof projectRuntimeSummary>>;
  inspector(query: Parameters<typeof projectInspector>[1]): Promise<ReturnType<typeof projectInspector>>;
  events(query?: {
    projectId?: string;
    batchId?: string;
    taskId?: string;
    dispatchId?: string;
    sessionId?: string;
  }): Promise<ForgeRuntimeState["events"]>;
}

let defaultServicePromise: Promise<ForgeRouteService> | null = null;

function requiredId(value: string, name: string): string {
  const id = value.trim();
  if (!id) throw new Error(name + " is required");
  return id;
}

export async function createForgeRouteService(
  runtime: ForgeRuntime,
): Promise<ForgeRouteService> {
  const [mainThread, dispatch] = await Promise.all([
    attachMainThreadRuntime(runtime),
    attachBuilderDispatchRuntime(runtime),
  ]);
  const review = createForgeReviewManager({ store: runtime.store });

  return {
    runtime,
    mainThread,
    dispatch,
    review,
    listProjects: () => listForgeProjects(runtime.store),
    getProject: (projectId) => getForgeProject(runtime.store, projectId),
    registerProject: (projectInput) =>
      registerForgeProject(runtime.store, projectInput),
    updateProject: (projectId, projectInput) =>
      updateForgeProject(runtime.store, projectId, projectInput),
    inspectTaskSource: (projectId) =>
      inspectProjectTaskSource(runtime.store, projectId),
    resolveTask: (projectId, taskId) =>
      resolveProjectTask(runtime.store, projectId, taskId),
    createTask: (projectId, taskInput) =>
      createProjectRepositoryTask(runtime.store, projectId, taskInput),
    updateTask: (projectId, taskId, patch) =>
      updateProjectRepositoryTask(
        runtime.store,
        projectId,
        taskId,
        patch,
      ),
    createBatch: (projectId, batchInput) =>
      createProjectBatch(runtime.store, projectId, batchInput),
    async listBatches(projectId) {
      const state = await runtime.store.read();
      return state.batches
        .filter((batch) => !projectId || batch.projectId === projectId)
        .map((batch) => structuredClone(batch));
    },
    async getBatch(batchId) {
      const id = requiredId(batchId, "batchId");
      const state = await runtime.store.read();
      const batch = state.batches.find((item) => item.id === id);
      if (!batch) throw new Error("batch not found");
      return structuredClone(batch);
    },
    async readiness(batchId) {
      const id = requiredId(batchId, "batchId");
      const state = await runtime.store.read();
      return getDispatchReadiness(state, id);
    },
    meta: () => forgeMeta(),
    async listDispatches(input = {}) {
      const state = await runtime.store.read();
      return state.dispatches
        .filter((dispatch) => {
          if (input.projectId && dispatch.projectId !== input.projectId) return false;
          if (input.batchId && dispatch.batchId !== input.batchId) return false;
          if (input.taskId && dispatch.taskId !== input.taskId) return false;
          if (input.status && dispatch.status !== input.status) return false;
          return true;
        })
        .map((dispatch) => ({ ...dispatch }));
    },
    async listReviews(input = {}) {
      const state = await runtime.store.read();
      return state.reviews
        .filter((reviewItem) => {
          if (input.projectId && reviewItem.projectId !== input.projectId) return false;
          if (input.batchId && reviewItem.batchId !== input.batchId) return false;
          if (input.taskId && reviewItem.taskId !== input.taskId) return false;
          return true;
        })
        .map((reviewItem) => ({ ...reviewItem }));
    },
    async runtimeSummary() {
      return projectRuntimeSummary(await runtime.store.read());
    },
    async inspector(query) {
      return projectInspector(await runtime.store.read(), query);
    },
    async events(query = {}) {
      const state = await runtime.store.read();
      return state.events
        .filter((event) => {
          if (query.projectId && event.projectId !== query.projectId) return false;
          if (query.batchId && event.batchId !== query.batchId) return false;
          if (query.taskId && event.taskId !== query.taskId) return false;
          if (query.dispatchId && event.dispatchId !== query.dispatchId) return false;
          if (query.sessionId && event.sessionId !== query.sessionId) return false;
          return true;
        })
        .slice(-500)
        .map(publicRuntimeEvent);
    },
  };
}

export async function getDefaultForgeRouteService(): Promise<ForgeRouteService> {
  if (!defaultServicePromise) {
    defaultServicePromise = (async () => {
      const runtime = await initializeForgeRuntime();
      return createForgeRouteService(runtime);
    })();
  }
  return defaultServicePromise;
}

export function resetDefaultForgeRouteServiceForTests(): void {
  defaultServicePromise = null;
}
