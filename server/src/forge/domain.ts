import { randomUUID } from "node:crypto";
import {
  ADAPTER_KINDS,
  ADAPTER_STATUSES,
  REVIEW_STATUSES,
  SESSION_ROLES,
  SESSION_STATUSES,
  TASK_STATUSES,
  type ForgeAdapter,
  type ForgeAdapterKind,
  type ForgeAdapterStatus,
  type ForgeBatch,
  type ForgeCoreState,
  type ForgeReview,
  type ForgeReviewStatus,
  type ForgeSession,
  type ForgeSessionRole,
  type ForgeSessionStatus,
  type ForgeTask,
  type ForgeTaskStatus,
} from "./types.js";

export {
  ADAPTER_KINDS,
  ADAPTER_STATUSES,
  REVIEW_STATUSES,
  SESSION_ROLES,
  SESSION_STATUSES,
  TASK_STATUSES,
} from "./types.js";

const ACTIVE_SESSION_STATUSES: ForgeSessionStatus[] = ["starting", "running", "waiting"];
const TERMINAL_SESSION_STATUSES: ForgeSessionStatus[] = ["completed", "failed", "disconnected"];
const REVIEW_RESULTS: ForgeReviewStatus[] = ["passed", "changes_requested", "failed", "cancelled"];
const REVIEW_DERIVED_TASK_STATUSES: ForgeTaskStatus[] = [
  "review_passed",
  "waiting_integration",
  "integrated",
];
const SESSION_TRANSITIONS: Record<ForgeSessionStatus, ForgeSessionStatus[]> = {
  starting: ["running", "completed", "failed", "disconnected"],
  running: ["waiting", "completed", "failed", "disconnected"],
  waiting: ["running", "completed", "failed", "disconnected"],
  completed: [],
  failed: [],
  disconnected: [],
};

const now = () => new Date().toISOString();

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return [...new Set(value.map((item) => requiredString(item, `${name} item`)))];
}

function adapters(state: ForgeCoreState): ForgeAdapter[] {
  if (!Array.isArray(state.adapters)) state.adapters = [];
  return state.adapters;
}

function sessions(state: ForgeCoreState): ForgeSession[] {
  if (!Array.isArray(state.sessions)) state.sessions = [];
  return state.sessions;
}

function reviews(state: ForgeCoreState): ForgeReview[] {
  if (!Array.isArray(state.reviews)) state.reviews = [];
  return state.reviews;
}

function nextUniqueId<T extends { id: string }>(
  items: T[],
  inputId: unknown,
  prefix: string,
  name: string,
): string {
  const explicitId = typeof inputId === "string" ? inputId.trim() : "";
  if (explicitId) {
    if (items.some((item) => item.id === explicitId)) {
      throw new Error(`duplicate ${name} id: ${explicitId}`);
    }
    return explicitId;
  }

  let id: string;
  do {
    id = prefix ? `${prefix}-${randomUUID().slice(0, 12)}` : randomUUID();
  } while (items.some((item) => item.id === id));
  return id;
}

function nextBatchId(state: ForgeCoreState, inputId: unknown): string {
  const explicitId = typeof inputId === "string" ? inputId.trim() : "";
  if (explicitId) {
    if (state.batches.some((batch) => batch.id === explicitId)) {
      throw new Error(`duplicate batch id: ${explicitId}`);
    }
    return explicitId;
  }

  let id: string;
  do {
    id = `B-${randomUUID().slice(0, 8)}`;
  } while (state.batches.some((batch) => batch.id === id));
  return id;
}

function resolveTaskBinding(
  state: ForgeCoreState,
  projectId: string,
  batchId: string,
  taskId: string,
): { project: ForgeCoreState["projects"][number]; batch: ForgeBatch; task: ForgeTask } {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("projectId not found");
  const batch = state.batches.find(
    (item) => item.id === batchId && item.projectId === projectId,
  );
  if (!batch) throw new Error("batchId not found for project");
  const task = batch.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("taskId not found in batch");
  return { project, batch, task };
}

function deriveBatchStatus(tasks: ForgeTask[]): ForgeBatch["status"] {
  if (tasks.every((task) => task.status === "integrated")) return "integrated";
  if (tasks.some((task) => task.status === "interrupted" || task.status === "stale")) {
    return "attention";
  }
  if (tasks.some((task) => task.status === "building" || task.status === "fixing")) {
    return "active";
  }
  if (tasks.some((task) => task.status === "reviewing")) return "reviewing";
  if (
    tasks.every((task) =>
      ["review_passed", "waiting_integration", "integrated"].includes(task.status),
    )
  ) {
    return "waiting_integration";
  }
  return "planned";
}

export interface RegisterAdapterInput {
  id?: unknown;
  name?: unknown;
  kind?: unknown;
  capabilities?: unknown;
  status?: unknown;
}

export function registerAdapter(
  state: ForgeCoreState,
  input: RegisterAdapterInput,
): ForgeAdapter {
  const kind = requiredString(input.kind, "kind");
  if (!(ADAPTER_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`invalid adapter kind: ${kind}`);
  }

  const status = input.status === undefined ? "offline" : requiredString(input.status, "status");
  if (!(ADAPTER_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`invalid adapter status: ${status}`);
  }

  const timestamp = now();
  const adapter: ForgeAdapter = {
    id: nextUniqueId(adapters(state), input.id, "", "adapter"),
    name: requiredString(input.name, "name"),
    kind: kind as ForgeAdapterKind,
    capabilities: stringList(input.capabilities, "capabilities"),
    status: status as ForgeAdapterStatus,
    lastSeenAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  adapters(state).push(adapter);
  return adapter;
}

export function heartbeatAdapter(
  state: ForgeCoreState,
  adapterId: string,
  input: { status?: unknown } = {},
): ForgeAdapter {
  const adapter = adapters(state).find((item) => item.id === adapterId);
  if (!adapter) throw new Error("adapter not found");

  const status = input.status === undefined ? "available" : requiredString(input.status, "status");
  if (!(ADAPTER_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`invalid adapter status: ${status}`);
  }

  const timestamp = now();
  adapter.status = status as ForgeAdapterStatus;
  adapter.lastSeenAt = timestamp;
  adapter.updatedAt = timestamp;
  return adapter;
}

export interface CreateSessionInput {
  id?: unknown;
  role?: unknown;
  adapterId?: unknown;
  projectId?: unknown;
  batchId?: unknown;
  taskId?: unknown;
  externalSessionId?: unknown;
}

export function createSession(
  state: ForgeCoreState,
  input: CreateSessionInput,
): ForgeSession {
  const role = requiredString(input.role, "role");
  if (!(SESSION_ROLES as readonly string[]).includes(role)) {
    throw new Error(`invalid session role: ${role}`);
  }

  const adapterId = requiredString(input.adapterId, "adapterId");
  const adapter = adapters(state).find((item) => item.id === adapterId);
  if (!adapter) throw new Error("adapterId not found");
  if (adapter.kind !== role) {
    throw new Error(`adapter kind ${adapter.kind} is incompatible with session role ${role}`);
  }

  const projectId = requiredString(input.projectId, "projectId");
  const batchId = requiredString(input.batchId, "batchId");
  const taskId = requiredString(input.taskId, "taskId");
  const { task } = resolveTaskBinding(state, projectId, batchId, taskId);

  const active = sessions(state).find(
    (session) =>
      session.projectId === projectId &&
      session.batchId === batchId &&
      session.taskId === taskId &&
      session.role === role &&
      ACTIVE_SESSION_STATUSES.includes(session.status),
  );
  if (active) throw new Error(`active ${role} session already exists for task`);

  const timestamp = now();
  const session: ForgeSession = {
    id: nextUniqueId(sessions(state), input.id, "S", "session"),
    role: role as ForgeSessionRole,
    adapterId,
    projectId,
    batchId,
    taskId,
    status: "starting",
    externalSessionId: optionalString(input.externalSessionId),
    startedAt: null,
    endedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  sessions(state).push(session);

  if (role === "builder") task.builderSessionId = session.id;
  if (role === "reviewer") task.reviewerSessionId = session.id;
  task.updatedAt = timestamp;
  return session;
}

export function updateSession(
  state: ForgeCoreState,
  sessionId: string,
  patch: { status?: unknown; externalSessionId?: unknown },
): ForgeSession {
  const session = sessions(state).find((item) => item.id === sessionId);
  if (!session) throw new Error("session not found");

  const timestamp = now();
  if (patch.status !== undefined) {
    const nextStatus = requiredString(patch.status, "status");
    if (!(SESSION_STATUSES as readonly string[]).includes(nextStatus)) {
      throw new Error(`invalid session status: ${nextStatus}`);
    }
    const typedStatus = nextStatus as ForgeSessionStatus;
    if (
      typedStatus !== session.status &&
      !SESSION_TRANSITIONS[session.status].includes(typedStatus)
    ) {
      throw new Error(`invalid session transition: ${session.status} -> ${typedStatus}`);
    }
    if (session.status !== "running" && typedStatus === "running" && !session.startedAt) {
      session.startedAt = timestamp;
    }
    if (
      !TERMINAL_SESSION_STATUSES.includes(session.status) &&
      TERMINAL_SESSION_STATUSES.includes(typedStatus)
    ) {
      session.endedAt = timestamp;
    }
    session.status = typedStatus;
  }

  if (patch.externalSessionId !== undefined) {
    session.externalSessionId = optionalString(patch.externalSessionId);
  }

  session.updatedAt = timestamp;
  return session;
}

export interface CreateReviewHandoffInput {
  id?: unknown;
  projectId?: unknown;
  batchId?: unknown;
  taskId?: unknown;
  sha?: unknown;
  reviewerSessionId?: unknown;
}

export function createReviewHandoff(
  state: ForgeCoreState,
  input: CreateReviewHandoffInput,
): ForgeReview {
  const projectId = requiredString(input.projectId, "projectId");
  const batchId = requiredString(input.batchId, "batchId");
  const taskId = requiredString(input.taskId, "taskId");
  const requestedSha = requiredString(input.sha, "sha");
  const reviewerSessionId = requiredString(input.reviewerSessionId, "reviewerSessionId");
  const { batch, task } = resolveTaskBinding(state, projectId, batchId, taskId);

  if (!task.currentSha) throw new Error("task currentSha is required before review handoff");
  if (task.currentSha !== requestedSha) throw new Error("review sha must match task currentSha");

  const reviewerSession = sessions(state).find((session) => session.id === reviewerSessionId);
  if (!reviewerSession) throw new Error("reviewerSessionId not found");
  if (reviewerSession.role !== "reviewer") {
    throw new Error("review handoff requires a reviewer session");
  }
  if (
    reviewerSession.projectId !== projectId ||
    reviewerSession.batchId !== batchId ||
    reviewerSession.taskId !== taskId
  ) {
    throw new Error("reviewer session is bound to a different task");
  }
  if (!ACTIVE_SESSION_STATUSES.includes(reviewerSession.status)) {
    throw new Error("reviewer session is not active");
  }

  const history = reviews(state);
  const taskHistory = history.filter(
    (review) =>
      review.projectId === projectId &&
      review.batchId === batchId &&
      review.taskId === taskId,
  );
  if (taskHistory.find((review) => review.status === "requested")) {
    throw new Error("pending review handoff already exists for task");
  }

  const timestamp = now();
  const round =
    taskHistory.reduce(
      (highest, review) =>
        Number.isInteger(review.round) ? Math.max(highest, review.round) : highest,
      0,
    ) + 1;

  const review: ForgeReview = {
    id: nextUniqueId(history, input.id, "R", "review"),
    projectId,
    batchId,
    taskId,
    reviewerSessionId,
    round,
    requestedSha,
    reviewedSha: null,
    status: "requested",
    actionable: null,
    invalidatedAt: null,
    resolvedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  history.push(review);

  task.reviewRound = round;
  task.reviewerSessionId = reviewerSessionId;
  task.status = "reviewing";
  task.updatedAt = timestamp;
  batch.updatedAt = timestamp;
  batch.status = deriveBatchStatus(batch.tasks);
  return review;
}

export function resolveReviewHandoff(
  state: ForgeCoreState,
  reviewId: string,
  input: { result?: unknown; reviewedSha?: unknown },
): ForgeReview {
  const review = reviews(state).find((item) => item.id === reviewId);
  if (!review) throw new Error("review not found");
  if (review.status !== "requested") throw new Error("review handoff is already resolved");

  const result = requiredString(input.result, "result");
  if (!(REVIEW_RESULTS as readonly string[]).includes(result)) {
    throw new Error(`invalid review result: ${result}`);
  }
  const typedResult = result as ForgeReviewStatus;
  const { batch, task } = resolveTaskBinding(
    state,
    review.projectId,
    review.batchId,
    review.taskId,
  );

  let reviewedSha: string | null = null;
  if (typedResult !== "cancelled") {
    reviewedSha = requiredString(input.reviewedSha, "reviewedSha");
    if (reviewedSha !== review.requestedSha) {
      throw new Error("reviewedSha must match review requestedSha");
    }
  }

  const timestamp = now();
  const actionable = typedResult !== "cancelled" && task.currentSha === review.requestedSha;
  review.status = typedResult;
  review.reviewedSha = reviewedSha;
  review.actionable = actionable;
  review.resolvedAt = timestamp;
  review.updatedAt = timestamp;

  if (actionable && typedResult === "passed") {
    task.reviewedSha = reviewedSha;
    task.status = "review_passed";
  } else if (actionable && typedResult === "changes_requested") {
    task.reviewedSha = null;
    task.status = "fixing";
  }
  task.updatedAt = timestamp;
  batch.updatedAt = timestamp;
  batch.status = deriveBatchStatus(batch.tasks);
  return review;
}

export interface IntegrateReviewedTaskInput {
  projectId?: unknown;
  batchId?: unknown;
  taskId?: unknown;
  expectedSha?: unknown;
}

export function integrateReviewedTask(
  state: ForgeCoreState,
  input: IntegrateReviewedTaskInput,
): ForgeTask {
  const projectId = requiredString(input.projectId, "projectId");
  const batchId = requiredString(input.batchId, "batchId");
  const taskId = requiredString(input.taskId, "taskId");
  const expectedSha = requiredString(input.expectedSha, "expectedSha");
  const { batch, task } = resolveTaskBinding(
    state,
    projectId,
    batchId,
    taskId,
  );

  if (task.status !== "review_passed") {
    throw new Error("integration requires review_passed task state");
  }
  if (!task.currentSha || task.currentSha !== expectedSha) {
    throw new Error("integration sha must match task currentSha");
  }
  if (!task.reviewedSha || task.reviewedSha !== expectedSha) {
    throw new Error("integration sha must match task reviewedSha");
  }

  const review = reviews(state).find(
    (item) =>
      item.projectId === projectId &&
      item.batchId === batchId &&
      item.taskId === taskId &&
      item.status === "passed" &&
      item.actionable === true &&
      item.requestedSha === expectedSha &&
      item.reviewedSha === expectedSha,
  );
  if (!review) {
    throw new Error("integration requires an actionable SHA-bound PASS review");
  }

  const timestamp = now();
  task.status = "integrated";
  task.updatedAt = timestamp;
  batch.updatedAt = timestamp;
  batch.status = deriveBatchStatus(batch.tasks);
  return task;
}

export interface RegisterProjectInput {
  id?: unknown;
  name?: unknown;
  rootPath?: unknown;
  repository?: unknown;
  taskLedger?: unknown;
  taskDir?: unknown;
  integrationBranch?: unknown;
}

export function registerProject(
  state: ForgeCoreState,
  input: RegisterProjectInput,
): ForgeCoreState["projects"][number] {
  const rootPath = requiredString(input.rootPath, "rootPath");
  const existing = state.projects.find((project) => project.rootPath === rootPath);
  if (existing) return existing;

  const timestamp = now();
  const project: ForgeCoreState["projects"][number] = {
    id: optionalString(input.id) ?? randomUUID(),
    name: requiredString(input.name, "name"),
    rootPath,
    repository: optionalString(input.repository),
    taskLedger: optionalString(input.taskLedger),
    taskDir: optionalString(input.taskDir),
    integrationBranch: optionalString(input.integrationBranch) ?? "dev",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.projects.push(project);
  return project;
}

export interface CreateBatchTaskInput {
  id?: unknown;
  title?: unknown;
  builder?: unknown;
  baseSha?: unknown;
  dependsOn?: unknown;
}

export interface CreateBatchInput {
  id?: unknown;
  projectId?: unknown;
  name?: unknown;
  baseSha?: unknown;
  tasks?: unknown;
}

export function createBatch(state: ForgeCoreState, input: CreateBatchInput): ForgeBatch {
  const projectId = requiredString(input.projectId, "projectId");
  if (!state.projects.some((project) => project.id === projectId)) {
    throw new Error("projectId not found");
  }
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    throw new Error("tasks must not be empty");
  }

  const timestamp = now();
  const seen = new Set<string>();
  const tasks = input.tasks.map((rawTask) => {
    if (!rawTask || typeof rawTask !== "object" || Array.isArray(rawTask)) {
      throw new Error("task must be an object");
    }
    const task = rawTask as CreateBatchTaskInput;
    const id = requiredString(task.id, "task.id");
    if (seen.has(id)) throw new Error(`duplicate task id: ${id}`);
    seen.add(id);
    return {
      id,
      title: optionalString(task.title) ?? id,
      status: "waiting" as const,
      builder: optionalString(task.builder),
      builderSessionId: null,
      reviewerSessionId: null,
      worktree: null,
      baseSha: optionalString(task.baseSha),
      currentSha: null,
      reviewedSha: null,
      reviewRound: 0,
      dependsOn: stringList(task.dependsOn, "task.dependsOn"),
      previewUrls: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies ForgeTask;
  });

  const batch: ForgeBatch = {
    id: nextBatchId(state, input.id),
    projectId,
    name: optionalString(input.name) ?? `Batch ${state.batches.length + 1}`,
    status: "planned",
    baseSha: optionalString(input.baseSha),
    tasks,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.batches.push(batch);
  return batch;
}

export interface UpdateTaskPatch {
  status?: unknown;
  builder?: unknown;
  builderSessionId?: unknown;
  reviewerSessionId?: unknown;
  worktree?: unknown;
  baseSha?: unknown;
  currentSha?: unknown;
  reviewedSha?: unknown;
  reviewRound?: unknown;
  previewUrls?: unknown;
}

export function updateTask(
  state: ForgeCoreState,
  batchId: string,
  taskId: string,
  patch: UpdateTaskPatch,
): ForgeTask {
  const batch = state.batches.find((item) => item.id === batchId);
  if (!batch) throw new Error("batch not found");
  const task = batch.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("task not found");

  if (patch.status === "review_passed") {
    throw new Error("review_passed is managed by review handoff");
  }
  if (patch.status === "integrated") {
    throw new Error("integrated is managed by guarded integration");
  }
  if (patch.reviewedSha !== undefined) {
    throw new Error("reviewedSha is managed by review handoff");
  }
  if (patch.reviewRound !== undefined) {
    throw new Error("reviewRound is managed by review handoff");
  }

  const patchedCurrentSha =
    patch.currentSha === undefined ? task.currentSha : optionalString(patch.currentSha);
  const currentShaChanged =
    patch.currentSha !== undefined && patchedCurrentSha !== task.currentSha;

  let nextStatus = patch.status !== undefined ? requiredString(patch.status, "status") : task.status;
  let nextReviewedSha = task.reviewedSha;
  if (currentShaChanged && task.reviewedSha && task.reviewedSha !== patchedCurrentSha) {
    nextReviewedSha = null;
    const requestedReviewDerivedState = (REVIEW_DERIVED_TASK_STATUSES as readonly string[]).includes(
      nextStatus,
    );
    if (patch.status === undefined || requestedReviewDerivedState) nextStatus = "stale";
  }
  if (!(TASK_STATUSES as readonly string[]).includes(nextStatus)) {
    throw new Error(`invalid task status: ${nextStatus}`);
  }

  const timestamp = now();
  task.status = nextStatus as ForgeTaskStatus;

  const scalarFields = [
    "builder",
    "builderSessionId",
    "reviewerSessionId",
    "worktree",
    "baseSha",
    "currentSha",
  ] as const;
  for (const field of scalarFields) {
    if (patch[field] !== undefined) task[field] = optionalString(patch[field]);
  }
  task.reviewedSha = nextReviewedSha;

  if (currentShaChanged) {
    for (const review of reviews(state)) {
      if (
        review.batchId === batchId &&
        review.taskId === taskId &&
        review.status === "passed" &&
        review.actionable === true &&
        review.requestedSha !== task.currentSha
      ) {
        review.actionable = false;
        review.invalidatedAt = timestamp;
        review.updatedAt = timestamp;
      }
    }
  }

  if (patch.previewUrls !== undefined) {
    if (
      !patch.previewUrls ||
      typeof patch.previewUrls !== "object" ||
      Array.isArray(patch.previewUrls)
    ) {
      throw new Error("previewUrls must be an object");
    }
    task.previewUrls = patch.previewUrls as Record<string, unknown>;
  }

  task.updatedAt = timestamp;
  batch.updatedAt = timestamp;
  batch.status = deriveBatchStatus(batch.tasks);
  return task;
}
