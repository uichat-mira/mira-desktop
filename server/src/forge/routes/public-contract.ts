import {
  ADAPTER_KINDS,
  ADAPTER_STATUSES,
  REVIEW_STATUSES,
  SESSION_ROLES,
  SESSION_STATUSES,
  TASK_STATUSES,
} from "../types.js";
import { DISPATCH_STATUSES } from "../dispatch-domain.js";
import {
  BUILDER_CHOICES,
  BUILTIN_BUILDER_ADAPTER_IDS,
} from "../builder-contract.js";
import {
  MAIN_THREAD_ADAPTERS,
  MAIN_THREAD_EVENT_TYPES,
  MAIN_THREAD_STATUSES,
} from "../main-thread/domain.js";
import type {
  ForgeAdapter,
  ForgeBatch,
  ForgeDispatch,
  ForgeProject,
  ForgeReview,
  ForgeRuntimeEvent,
  ForgeSession,
  ForgeTask,
} from "../types.js";
import type {
  MainThreadEventRecord,
  MainThreadRecord,
} from "../main-thread/domain.js";
import type { ForgeRuntimeState } from "../runtime/state.js";

export interface ForgeMeta {
  taskStatuses: readonly string[];
  adapterKinds: readonly string[];
  adapterStatuses: readonly string[];
  sessionRoles: readonly string[];
  sessionStatuses: readonly string[];
  reviewStatuses: readonly string[];
  dispatchStatuses: readonly string[];
  builderChoices: readonly string[];
  builtinBuilderAdapters: readonly string[];
  mainThreadAdapters: readonly string[];
  mainThreadStatuses: readonly string[];
  mainThreadEventTypes: readonly string[];
}

export function forgeMeta(): ForgeMeta {
  return {
    taskStatuses: TASK_STATUSES,
    adapterKinds: ADAPTER_KINDS,
    adapterStatuses: ADAPTER_STATUSES,
    sessionRoles: SESSION_ROLES,
    sessionStatuses: SESSION_STATUSES,
    reviewStatuses: REVIEW_STATUSES,
    dispatchStatuses: DISPATCH_STATUSES,
    builderChoices: BUILDER_CHOICES,
    builtinBuilderAdapters: BUILTIN_BUILDER_ADAPTER_IDS,
    mainThreadAdapters: MAIN_THREAD_ADAPTERS,
    mainThreadStatuses: MAIN_THREAD_STATUSES,
    mainThreadEventTypes: MAIN_THREAD_EVENT_TYPES,
  };
}

export interface ForgeRuntimeSummary {
  schemaVersion: number;
  projectCount: number;
  batchCount: number;
  activeBatchCount: number;
  threadCount: number;
  activeThreadCount: number;
  dispatchCount: number;
  activeDispatch: ForgeDispatch | null;
  reviewCount: number;
  pendingReviewCount: number;
  attentionTaskCount: number;
  adapterSummary: Array<{
    id: string;
    name: string;
    kind: string;
    status: string;
  }>;
  updatedAt: string | null;
}

export interface ForgeInspectorData {
  project: ForgeProject | null;
  batch: ForgeBatch | null;
  task: ForgeTask | null;
  dispatch: ForgeDispatch | null;
  session: ForgeSession | null;
  review: ForgeReview | null;
  thread: MainThreadRecord | null;
  threadEvents: MainThreadEventRecord[];
  events: ForgeRuntimeEvent[];
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1) ?? null;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.slice(0, 4096);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return "[bounded]";
  if (Array.isArray(value)) {
    return value.slice(0, 32).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 48)
        .map(([key, item]) => [key.slice(0, 120), sanitizeValue(item, depth + 1)]),
    );
  }
  return String(value).slice(0, 4096);
}

export function publicRuntimeEvent(event: ForgeRuntimeEvent): ForgeRuntimeEvent {
  return {
    ...event,
    data: sanitizeValue(event.data) as Record<string, unknown>,
  };
}

export function publicThreadEvent(
  event: MainThreadEventRecord,
): MainThreadEventRecord {
  return {
    ...event,
    text: event.text?.slice(0, 16_384) ?? null,
    tool: event.tool
      ? {
          name: event.tool.name.slice(0, 160),
          status: event.tool.status?.slice(0, 80) ?? null,
        }
      : null,
    artifact: event.artifact
      ? {
          kind: event.artifact.kind.slice(0, 80),
          ref: event.artifact.ref?.slice(0, 512) ?? null,
        }
      : null,
    provider: event.provider
      ? {
          adapter: event.provider.adapter?.slice(0, 80) ?? null,
          eventType: event.provider.eventType?.slice(0, 120) ?? null,
          itemType: event.provider.itemType?.slice(0, 120) ?? null,
          status: event.provider.status?.slice(0, 80) ?? null,
        }
      : null,
  };
}

export function projectRuntimeSummary(
  state: ForgeRuntimeState,
): ForgeRuntimeSummary {
  const activeDispatch =
    state.dispatches.find((dispatch) =>
      ["starting", "running"].includes(dispatch.status),
    ) ?? null;
  const attentionStatuses = new Set([
    "fixing",
    "interrupted",
    "stale",
  ]);

  return {
    schemaVersion: state.schemaVersion,
    projectCount: state.projects.length,
    batchCount: state.batches.length,
    activeBatchCount: state.batches.filter((batch) => batch.status !== "integrated").length,
    threadCount: state.threads.length,
    activeThreadCount: state.threads.filter((thread) => thread.status === "running").length,
    dispatchCount: state.dispatches.length,
    activeDispatch: activeDispatch ? { ...activeDispatch } : null,
    reviewCount: state.reviews.length,
    pendingReviewCount: state.reviews.filter((review) => review.status === "requested").length,
    attentionTaskCount: state.batches
      .flatMap((batch) => batch.tasks)
      .filter((task) => attentionStatuses.has(task.status)).length,
    adapterSummary: state.adapters.map((adapter: ForgeAdapter) => ({
      id: adapter.id,
      name: adapter.name,
      kind: adapter.kind,
      status: adapter.status,
    })),
    updatedAt: latestTimestamp([
      ...state.projects.map((item) => item.updatedAt),
      ...state.batches.map((item) => item.updatedAt),
      ...state.threads.map((item) => item.updatedAt),
      ...state.dispatches.map((item) => item.updatedAt),
      ...state.reviews.map((item) => item.updatedAt),
    ]),
  };
}

export function projectInspector(
  state: ForgeRuntimeState,
  query: {
    projectId?: string;
    batchId?: string;
    taskId?: string;
    dispatchId?: string;
    sessionId?: string;
    reviewId?: string;
    threadId?: string;
  },
): ForgeInspectorData {
  const dispatch = query.dispatchId
    ? state.dispatches.find((item) => item.id === query.dispatchId) ?? null
    : null;
  const batchId = query.batchId ?? dispatch?.batchId ?? null;
  const batch = batchId
    ? state.batches.find((item) => item.id === batchId) ?? null
    : null;
  const projectId =
    query.projectId ?? dispatch?.projectId ?? batch?.projectId ?? null;
  const project = projectId
    ? state.projects.find((item) => item.id === projectId) ?? null
    : null;
  const taskId = query.taskId ?? dispatch?.taskId ?? null;
  const task =
    batch && taskId
      ? batch.tasks.find((item) => item.id === taskId) ?? null
      : null;
  const sessionId = query.sessionId ?? dispatch?.sessionId ?? null;
  const session = sessionId
    ? state.sessions.find((item) => item.id === sessionId) ?? null
    : null;
  const review = query.reviewId
    ? state.reviews.find((item) => item.id === query.reviewId) ?? null
    : batch && taskId
      ? [...state.reviews]
          .reverse()
          .find((item) => item.batchId === batch.id && item.taskId === taskId) ?? null
      : null;
  const threadId = query.threadId ?? dispatch?.sourceThreadId ?? null;
  const thread = threadId
    ? (state.threads.find((item) => item.id === threadId) as MainThreadRecord | undefined) ?? null
    : null;

  const events = state.events
    .filter((event) => {
      if (query.projectId && event.projectId !== query.projectId) return false;
      if (query.batchId && event.batchId !== query.batchId) return false;
      if (query.taskId && event.taskId !== query.taskId) return false;
      if (query.dispatchId && event.dispatchId !== query.dispatchId) return false;
      if (query.sessionId && event.sessionId !== query.sessionId) return false;
      if (!query.projectId && project && event.projectId !== project.id) return false;
      if (!query.batchId && batch && event.batchId !== batch.id) return false;
      if (!query.taskId && task && event.taskId !== task.id) return false;
      if (!query.dispatchId && dispatch && event.dispatchId !== dispatch.id) return false;
      if (!query.sessionId && session && event.sessionId !== session.id) return false;
      return true;
    })
    .slice(-200)
    .map(publicRuntimeEvent);

  const threadEvents = thread
    ? (state.threadEvents as unknown as MainThreadEventRecord[])
        .filter((event) => event.threadId === thread.id)
        .slice(-200)
        .map(publicThreadEvent)
    : [];

  return {
    project: project ? { ...project } : null,
    batch: batch ? structuredClone(batch) : null,
    task: task ? structuredClone(task) : null,
    dispatch: dispatch ? { ...dispatch } : null,
    session: session ? { ...session } : null,
    review: review ? { ...review } : null,
    thread: thread ? { ...thread } : null,
    threadEvents,
    events,
  };
}
