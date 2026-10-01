import { realpath, stat } from "node:fs/promises";
import type { ForgeProject } from "../types.js";
import { registerProject } from "../domain.js";
import type { ForgeRuntimeStore } from "../runtime/store.js";
import {
  inspectRepositoryTaskSource,
  type RepositoryTaskSourceInspection,
} from "../task-source/repository-task-source.js";

export interface RegisterForgeProjectInput {
  id?: unknown;
  name?: unknown;
  rootPath?: unknown;
  repository?: unknown;
  integrationBranch?: unknown;
  taskLedger?: unknown;
  taskDir?: unknown;
}

export interface UpdateForgeProjectInput {
  name?: unknown;
  repository?: unknown;
  integrationBranch?: unknown;
  taskLedger?: unknown;
  taskDir?: unknown;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(name + " is required");
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredSingleLine(value: unknown, name: string): string {
  const text = requiredString(value, name);
  if (/\r|\n/.test(text)) {
    throw new Error(name + " must be a single line");
  }
  return text;
}

function optionalSingleLine(value: unknown, name: string): string | null {
  const text = optionalString(value);
  if (text && /\r|\n/.test(text)) {
    throw new Error(name + " must be a single line");
  }
  return text;
}

async function canonicalProjectRoot(value: unknown): Promise<string> {
  const input = requiredString(value, "rootPath");
  const root = await realpath(input).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("project root is unavailable: " + message);
  });
  const info = await stat(root);
  if (!info.isDirectory()) {
    throw new Error("project root is not a directory");
  }
  return root;
}

function projectForId(projects: ForgeProject[], projectId: unknown): ForgeProject {
  const id = requiredString(projectId, "projectId");
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error("projectId not found");
  return project;
}

function normalizeTaskSourcePair(input: {
  taskLedger?: unknown;
  taskDir?: unknown;
}): { taskLedger: string | null; taskDir: string | null } {
  const taskLedger = optionalSingleLine(input.taskLedger, "taskLedger");
  const taskDir = optionalSingleLine(input.taskDir, "taskDir");
  if ((taskLedger && !taskDir) || (!taskLedger && taskDir)) {
    throw new Error("taskLedger and taskDir must be configured together");
  }
  return { taskLedger, taskDir };
}

async function inspectConfiguredSource(
  project: ForgeProject,
): Promise<RepositoryTaskSourceInspection | null> {
  if (!project.taskLedger && !project.taskDir) return null;
  if (!project.taskLedger || !project.taskDir) {
    throw new Error("project task source configuration is incomplete");
  }
  return inspectRepositoryTaskSource(project);
}

export async function listForgeProjects(
  store: ForgeRuntimeStore,
): Promise<ForgeProject[]> {
  const state = await store.read();
  return state.projects.map((project) => ({ ...project }));
}

export async function getForgeProject(
  store: ForgeRuntimeStore,
  projectId: unknown,
): Promise<ForgeProject> {
  const state = await store.read();
  return { ...projectForId(state.projects, projectId) };
}

export async function registerForgeProject(
  store: ForgeRuntimeStore,
  input: RegisterForgeProjectInput,
): Promise<{
  project: ForgeProject;
  source: RepositoryTaskSourceInspection | null;
}> {
  const rootPath = await canonicalProjectRoot(input.rootPath);
  const name = requiredSingleLine(input.name, "name");
  const repository = optionalSingleLine(input.repository, "repository");
  const integrationBranch =
    optionalSingleLine(input.integrationBranch, "integrationBranch") ?? "dev";
  const sourcePair = normalizeTaskSourcePair(input);

  const candidate: ForgeProject = {
    id: optionalString(input.id) ?? "__candidate__",
    name,
    rootPath,
    repository,
    integrationBranch,
    taskLedger: sourcePair.taskLedger,
    taskDir: sourcePair.taskDir,
    createdAt: "",
    updatedAt: "",
  };
  const source = await inspectConfiguredSource(candidate);

  const project = await store.mutate((state) => {
    const existingByRoot = state.projects.find(
      (item) => item.rootPath === rootPath,
    );
    if (existingByRoot) {
      throw new Error("project root is already registered");
    }

    const explicitId = optionalString(input.id);
    if (explicitId && state.projects.some((item) => item.id === explicitId)) {
      throw new Error("duplicate project id: " + explicitId);
    }

    const created = registerProject(state, {
      id: explicitId ?? undefined,
      name,
      rootPath,
      repository,
      integrationBranch,
      taskLedger: sourcePair.taskLedger,
      taskDir: sourcePair.taskDir,
    });
    return { ...created };
  });

  return { project, source };
}

export async function updateForgeProject(
  store: ForgeRuntimeStore,
  projectId: unknown,
  input: UpdateForgeProjectInput,
): Promise<{
  project: ForgeProject;
  source: RepositoryTaskSourceInspection | null;
}> {
  return store.mutate(async (state) => {
    const target = projectForId(state.projects, projectId);

    const name =
      input.name === undefined
        ? target.name
        : requiredSingleLine(input.name, "name");
    const repository =
      input.repository === undefined
        ? target.repository
        : optionalSingleLine(input.repository, "repository");
    const integrationBranch =
      input.integrationBranch === undefined
        ? target.integrationBranch
        : requiredSingleLine(input.integrationBranch, "integrationBranch");
    const nextLedger =
      input.taskLedger === undefined
        ? target.taskLedger
        : optionalSingleLine(input.taskLedger, "taskLedger");
    const nextTaskDir =
      input.taskDir === undefined
        ? target.taskDir
        : optionalSingleLine(input.taskDir, "taskDir");

    if ((nextLedger && !nextTaskDir) || (!nextLedger && nextTaskDir)) {
      throw new Error("taskLedger and taskDir must be configured together");
    }

    const candidate: ForgeProject = {
      ...target,
      name,
      repository,
      integrationBranch,
      taskLedger: nextLedger,
      taskDir: nextTaskDir,
    };
    const source = await inspectConfiguredSource(candidate);

    target.name = name;
    target.repository = repository;
    target.integrationBranch = integrationBranch;
    target.taskLedger = nextLedger;
    target.taskDir = nextTaskDir;
    target.updatedAt = new Date().toISOString();

    return {
      project: { ...target },
      source,
    };
  });
}
