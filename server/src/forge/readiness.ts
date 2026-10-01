import type { ForgeBatch, ForgeCoreState, ForgeTaskStatus } from "./types.js";

export const DISPATCHABLE_TASK_STATUSES = ["waiting", "fixing"] as const;
const ACTIVE_BUILDER_SESSION_STATUSES = ["starting", "running", "waiting"] as const;

function dependencyIds(task: ForgeBatch["tasks"][number]): string[] {
  if (!Array.isArray(task.dependsOn)) {
    throw new Error(`dependsOn must be an array for task ${task.id}`);
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of task.dependsOn) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`invalid dependency id for task ${task.id}`);
    }
    const id = value.trim();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function validateBatchDependencies(batch: ForgeBatch): ForgeBatch {
  if (!batch || !Array.isArray(batch.tasks)) throw new Error("batch tasks are required");
  const taskIds = new Set(batch.tasks.map((task) => task.id));
  const graph = new Map<string, string[]>();

  for (const task of batch.tasks) {
    const dependencies = dependencyIds(task);
    for (const dependencyId of dependencies) {
      if (dependencyId === task.id) {
        throw new Error(`task ${task.id} cannot depend on itself`);
      }
      if (!taskIds.has(dependencyId)) {
        throw new Error(`dependency ${dependencyId} not found for task ${task.id}`);
      }
    }
    graph.set(task.id, dependencies);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(taskId: string, path: string[]): void {
    if (visiting.has(taskId)) {
      throw new Error(`cyclic task dependencies: ${[...path, taskId].join(" -> ")}`);
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependencyId of graph.get(taskId) ?? []) {
      visit(dependencyId, [...path, taskId]);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of batch.tasks) visit(task.id, []);
  return batch;
}

export interface DispatchReadinessReason {
  code: "task_status" | "active_builder_session" | "dependency_not_integrated";
  status?: ForgeTaskStatus;
  sessionId?: string;
  taskId?: string;
}

export interface DispatchReadinessTask {
  taskId: string;
  title: string;
  status: ForgeTaskStatus;
  dependsOn: string[];
}

export function getDispatchReadiness(state: ForgeCoreState, batchId: string): {
  batchId: string;
  projectId: string;
  ready: DispatchReadinessTask[];
  blocked: Array<DispatchReadinessTask & { reasons: DispatchReadinessReason[] }>;
} {
  const batch = state.batches.find((item) => item.id === batchId);
  if (!batch) throw new Error("batch not found");
  validateBatchDependencies(batch);

  const taskById = new Map(batch.tasks.map((task) => [task.id, task]));
  const activeBuilderByTask = new Map<string, NonNullable<ForgeCoreState["sessions"]>[number]>();
  for (const session of state.sessions ?? []) {
    if (
      session.batchId === batch.id &&
      session.role === "builder" &&
      (ACTIVE_BUILDER_SESSION_STATUSES as readonly string[]).includes(session.status)
    ) {
      activeBuilderByTask.set(session.taskId, session);
    }
  }

  const ready: DispatchReadinessTask[] = [];
  const blocked: Array<DispatchReadinessTask & { reasons: DispatchReadinessReason[] }> = [];
  for (const task of batch.tasks) {
    const reasons: DispatchReadinessReason[] = [];
    if (!(DISPATCHABLE_TASK_STATUSES as readonly string[]).includes(task.status)) {
      reasons.push({ code: "task_status", status: task.status });
    }

    const activeBuilder = activeBuilderByTask.get(task.id);
    if (activeBuilder) {
      reasons.push({ code: "active_builder_session", sessionId: activeBuilder.id });
    }

    for (const dependencyId of dependencyIds(task)) {
      const dependency = taskById.get(dependencyId);
      if (!dependency) throw new Error(`dependency ${dependencyId} not found for task ${task.id}`);
      if (dependency.status !== "integrated") {
        reasons.push({
          code: "dependency_not_integrated",
          taskId: dependency.id,
          status: dependency.status,
        });
      }
    }

    const summary: DispatchReadinessTask = {
      taskId: task.id,
      title: task.title,
      status: task.status,
      dependsOn: dependencyIds(task),
    };
    if (reasons.length === 0) ready.push(summary);
    else blocked.push({ ...summary, reasons });
  }

  return {
    batchId: batch.id,
    projectId: batch.projectId,
    ready,
    blocked,
  };
}
