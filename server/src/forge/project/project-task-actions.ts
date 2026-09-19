import { createBatch } from "../domain.js";
import { validateBatchDependencies } from "../readiness.js";
import type { ForgeProject } from "../types.js";
import type { ForgeRuntimeStore } from "../runtime/store.js";
import {
  createRepositoryTask,
  inspectRepositoryTaskSource,
  resolveRepositoryTask,
  updateRepositoryTask,
  type CreateRepositoryTaskInput,
  type RepositoryTaskSourceInspection,
  type RepositoryTaskSummary,
  type UpdateRepositoryTaskInput,
} from "../task-source/repository-task-source.js";

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(name + " is required");
  }
  return value.trim();
}

function projectForId(projects: ForgeProject[], projectId: unknown): ForgeProject {
  const id = requiredString(projectId, "projectId");
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error("projectId not found");
  return project;
}

function requireConfiguredTaskSource(project: ForgeProject): ForgeProject {
  if (!project.taskLedger || !project.taskDir) {
    throw new Error("project task source is not configured");
  }
  return project;
}

function taskIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("taskIds must not be empty");
  }
  const ids = value.map((item) => requiredString(item, "taskId"));
  if (new Set(ids).size !== ids.length) {
    throw new Error("taskIds must be unique");
  }
  return ids;
}

async function configuredProject(
  store: ForgeRuntimeStore,
  projectId: unknown,
): Promise<ForgeProject> {
  const state = await store.read();
  return requireConfiguredTaskSource(projectForId(state.projects, projectId));
}

export async function inspectProjectTaskSource(
  store: ForgeRuntimeStore,
  projectId: unknown,
): Promise<RepositoryTaskSourceInspection> {
  return inspectRepositoryTaskSource(await configuredProject(store, projectId));
}

export async function resolveProjectTask(
  store: ForgeRuntimeStore,
  projectId: unknown,
  taskId: unknown,
): Promise<RepositoryTaskSummary> {
  return resolveRepositoryTask(
    await configuredProject(store, projectId),
    taskId,
  );
}

export async function createProjectRepositoryTask(
  store: ForgeRuntimeStore,
  projectId: unknown,
  input: CreateRepositoryTaskInput,
): Promise<RepositoryTaskSummary> {
  return createRepositoryTask(
    await configuredProject(store, projectId),
    input,
  );
}

export async function updateProjectRepositoryTask(
  store: ForgeRuntimeStore,
  projectId: unknown,
  taskId: unknown,
  patch: UpdateRepositoryTaskInput,
): Promise<RepositoryTaskSummary> {
  return updateRepositoryTask(
    await configuredProject(store, projectId),
    taskId,
    patch,
  );
}

export async function createProjectBatch(
  store: ForgeRuntimeStore,
  projectId: unknown,
  input: { name?: unknown; taskIds?: unknown },
) {
  const ids = taskIdList(input?.taskIds);
  const project = await configuredProject(store, projectId);
  const source = await inspectRepositoryTaskSource(project);
  const byId = new Map(source.tasks.map((task) => [task.id, task]));

  for (const id of ids) {
    if (!byId.has(id)) {
      throw new Error("task " + id + " is not present in repository ledger");
    }
  }

  return store.mutate((state) => {
    projectForId(state.projects, project.id);
    const duplicate = state.batches
      .filter(
        (batch) =>
          batch.projectId === project.id && batch.status !== "integrated",
      )
      .flatMap((batch) => batch.tasks)
      .find(
        (task) => ids.includes(task.id) && task.status !== "integrated",
      );
    if (duplicate) {
      throw new Error(
        "task " + duplicate.id + " already exists in an active batch",
      );
    }

    const created = createBatch(state, {
      projectId: project.id,
      name: typeof input?.name === "string" ? input.name : undefined,
      tasks: ids.map((id) => {
        const task = byId.get(id);
        if (!task) throw new Error("task " + id + " disappeared from source");
        return { id: task.id, title: task.title };
      }),
    });
    validateBatchDependencies(created);
    return created;
  });
}
