import { randomUUID } from "node:crypto";
import type { ForgeRuntimeState } from "../runtime/state.js";

export const MAIN_THREAD_ADAPTERS = [
  "opencode",
  "codex-desktop",
  "codex",
] as const;
export type MainThreadAdapterId = (typeof MAIN_THREAD_ADAPTERS)[number];

export const MAIN_THREAD_STATUSES = ["idle", "running", "error"] as const;
export type MainThreadStatus = (typeof MAIN_THREAD_STATUSES)[number];

export const MAIN_THREAD_EVENT_TYPES = [
  "message",
  "thinking",
  "tool",
  "status",
  "artifact",
  "handoff",
] as const;
export type MainThreadEventType = (typeof MAIN_THREAD_EVENT_TYPES)[number];

export interface MainThreadToolEvent {
  name: string;
  status: string | null;
}

export interface MainThreadArtifactEvent {
  kind: string;
  ref: string | null;
}

export interface MainThreadDispatchHandoff {
  kind?: undefined;
  projectId: string;
  taskId: string;
  taskRef: string;
  preferredBuilder: string;
}

export interface MainThreadBuilderResultHandoff {
  kind: "builder_result";
  projectId: string;
  batchId: string;
  taskId: string;
  taskRef: string | null;
  dispatchId: string;
  sessionId: string;
  adapterId: string;
  dispatchStatus: string;
  sessionStatus: string | null;
  taskStatus: string;
  externalSessionId: string | null;
  resultText: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export type MainThreadHandoff =
  | MainThreadDispatchHandoff
  | MainThreadBuilderResultHandoff;

export interface MainThreadProviderEvent {
  adapter: string | null;
  eventType: string | null;
  itemType: string | null;
  status: string | null;
}

export interface MainThreadRecord {
  id: string;
  projectId: string;
  adapter: MainThreadAdapterId;
  title: string;
  model: string | null;
  status: MainThreadStatus;
  externalThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MainThreadEventRecord {
  id: string;
  threadId: string;
  projectId: string;
  type: MainThreadEventType;
  role: string | null;
  text: string | null;
  tool: MainThreadToolEvent | null;
  artifact: MainThreadArtifactEvent | null;
  handoff: MainThreadHandoff | null;
  provider: MainThreadProviderEvent | null;
  createdAt: string;
}

export interface MainThreadEventInput {
  id?: unknown;
  type?: unknown;
  role?: unknown;
  text?: unknown;
  tool?: {
    name?: unknown;
    status?: unknown;
  } | null;
  artifact?: {
    kind?: unknown;
    ref?: unknown;
  } | null;
  handoff?: Record<string, unknown> | null;
  provider?: {
    adapter?: unknown;
    eventType?: unknown;
    itemType?: unknown;
    status?: unknown;
  } | null;
}

export interface MainThreadTurnResult {
  externalThreadId?: unknown;
  responseText?: unknown;
  events?: MainThreadEventInput[];
  providerEventType?: unknown;
}

function now(): string {
  return new Date().toISOString();
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(name + " is required");
  }
  return value.trim();
}

function optionalString(value: unknown, limit = 4096): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, limit);
}

function threads(state: ForgeRuntimeState): MainThreadRecord[] {
  return state.threads as unknown as MainThreadRecord[];
}

function threadEvents(state: ForgeRuntimeState): MainThreadEventRecord[] {
  return state.threadEvents as unknown as MainThreadEventRecord[];
}

function nextUniqueId(
  items: Array<{ id: string }>,
  inputId: unknown,
  prefix: string,
  name: string,
): string {
  const explicitId =
    typeof inputId === "string" ? inputId.trim() : "";
  if (explicitId) {
    if (items.some((item) => item.id === explicitId)) {
      throw new Error("duplicate " + name + " id: " + explicitId);
    }
    return explicitId;
  }

  let id: string;
  do {
    id = prefix + "-" + randomUUID().slice(0, 12);
  } while (items.some((item) => item.id === id));
  return id;
}

function requireProject(state: ForgeRuntimeState, projectId: unknown) {
  const id = requiredString(projectId, "projectId");
  const project = state.projects.find((item) => item.id === id);
  if (!project) throw new Error("projectId not found");
  return project;
}

function normalizeHandoff(input: Record<string, unknown>): MainThreadHandoff {
  if (input.kind === "builder_result") {
    return {
      kind: "builder_result",
      projectId: requiredString(input.projectId, "handoff.projectId"),
      batchId: requiredString(input.batchId, "handoff.batchId"),
      taskId: requiredString(input.taskId, "handoff.taskId"),
      taskRef: optionalString(input.taskRef, 512),
      dispatchId: requiredString(input.dispatchId, "handoff.dispatchId"),
      sessionId: requiredString(input.sessionId, "handoff.sessionId"),
      adapterId: requiredString(input.adapterId, "handoff.adapterId"),
      dispatchStatus: requiredString(
        input.dispatchStatus,
        "handoff.dispatchStatus",
      ),
      sessionStatus: optionalString(input.sessionStatus, 80),
      taskStatus: requiredString(input.taskStatus, "handoff.taskStatus"),
      externalSessionId: optionalString(input.externalSessionId, 512),
      resultText: optionalString(input.resultText, 16_384),
      error: optionalString(input.error, 4096),
      startedAt: optionalString(input.startedAt, 80),
      endedAt: optionalString(input.endedAt, 80),
    };
  }

  return {
    projectId: requiredString(input.projectId, "handoff.projectId"),
    taskId: requiredString(input.taskId, "handoff.taskId"),
    taskRef: requiredString(input.taskRef, "handoff.taskRef"),
    preferredBuilder: requiredString(
      input.preferredBuilder,
      "handoff.preferredBuilder",
    ),
  };
}

export function findMainThread(
  state: ForgeRuntimeState,
  threadId: unknown,
): MainThreadRecord {
  const id = requiredString(threadId, "threadId");
  const thread = threads(state).find((item) => item.id === id);
  if (!thread) throw new Error("thread not found");
  return thread;
}

export function getMainThreads(
  state: ForgeRuntimeState,
  projectId: unknown = null,
): MainThreadRecord[] {
  const items = threads(state);
  if (projectId === null || projectId === undefined || projectId === "") {
    return items;
  }
  const id = requiredString(projectId, "projectId");
  return items.filter((thread) => thread.projectId === id);
}

export function getMainThreadEvents(
  state: ForgeRuntimeState,
  threadId: unknown,
): MainThreadEventRecord[] {
  const id = requiredString(threadId, "threadId");
  return threadEvents(state).filter((event) => event.threadId === id);
}

export function createMainThread(
  state: ForgeRuntimeState,
  input: {
    id?: unknown;
    projectId?: unknown;
    adapter?: unknown;
    title?: unknown;
    model?: unknown;
  },
): MainThreadRecord {
  const project = requireProject(state, input?.projectId);
  const adapter = requiredString(input?.adapter, "adapter");
  if (!(MAIN_THREAD_ADAPTERS as readonly string[]).includes(adapter)) {
    throw new Error("unsupported main thread adapter: " + adapter);
  }

  const timestamp = now();
  const thread: MainThreadRecord = {
    id: nextUniqueId(threads(state), input?.id, "MT", "thread"),
    projectId: project.id,
    adapter: adapter as MainThreadAdapterId,
    title:
      optionalString(input?.title, 160) ??
      project.name + " main thread",
    model: optionalString(input?.model, 160),
    status: "idle",
    externalThreadId: null,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  threads(state).push(thread);
  appendMainThreadEvent(state, thread.id, {
    type: "status",
    text: "thread.created",
    provider: { adapter },
  });
  return thread;
}

export function appendMainThreadEvent(
  state: ForgeRuntimeState,
  threadId: unknown,
  input: MainThreadEventInput,
): MainThreadEventRecord {
  const thread = findMainThread(state, threadId);
  const type = requiredString(input?.type, "event.type");
  if (!(MAIN_THREAD_EVENT_TYPES as readonly string[]).includes(type)) {
    throw new Error("unsupported main thread event type: " + type);
  }

  const timestamp = now();
  const event: MainThreadEventRecord = {
    id: nextUniqueId(
      threadEvents(state),
      input?.id,
      "TE",
      "thread event",
    ),
    threadId: thread.id,
    projectId: thread.projectId,
    type: type as MainThreadEventType,
    role: optionalString(input?.role, 32),
    text: optionalString(input?.text, 16_384),
    tool: input?.tool
      ? {
          name: requiredString(input.tool.name, "tool.name").slice(0, 160),
          status: optionalString(input.tool.status, 80),
        }
      : null,
    artifact: input?.artifact
      ? {
          kind: requiredString(input.artifact.kind, "artifact.kind").slice(
            0,
            80,
          ),
          ref: optionalString(input.artifact.ref, 512),
        }
      : null,
    handoff: input?.handoff ? normalizeHandoff(input.handoff) : null,
    provider: input?.provider
      ? {
          adapter: optionalString(input.provider.adapter, 80),
          eventType: optionalString(input.provider.eventType, 120),
          itemType: optionalString(input.provider.itemType, 120),
          status: optionalString(input.provider.status, 80),
        }
      : null,
    createdAt: timestamp,
  };
  threadEvents(state).push(event);
  thread.updatedAt = timestamp;
  return event;
}

export function beginMainThreadTurn(
  state: ForgeRuntimeState,
  threadId: unknown,
  message: unknown,
): MainThreadRecord {
  const thread = findMainThread(state, threadId);
  if (thread.status === "running") {
    throw new Error("thread already has an active turn");
  }
  const text = requiredString(message, "message");
  thread.status = "running";
  thread.lastError = null;
  thread.updatedAt = now();
  appendMainThreadEvent(state, thread.id, {
    type: "message",
    role: "user",
    text,
  });
  appendMainThreadEvent(state, thread.id, {
    type: "status",
    text: "turn.started",
    provider: { adapter: thread.adapter },
  });
  return thread;
}

export function completeMainThreadTurn(
  state: ForgeRuntimeState,
  threadId: unknown,
  result: MainThreadTurnResult = {},
): MainThreadRecord {
  const thread = findMainThread(state, threadId);
  if (thread.status !== "running") {
    throw new Error("thread has no active turn");
  }

  const externalThreadId = optionalString(result.externalThreadId, 512);
  if (
    thread.externalThreadId &&
    externalThreadId &&
    thread.externalThreadId !== externalThreadId
  ) {
    throw new Error("provider resumed a different thread");
  }
  if (!thread.externalThreadId && externalThreadId) {
    thread.externalThreadId = externalThreadId;
  }

  for (const event of Array.isArray(result.events) ? result.events : []) {
    appendMainThreadEvent(state, thread.id, event);
  }

  const responseText = optionalString(result.responseText, 32_768);
  if (responseText) {
    appendMainThreadEvent(state, thread.id, {
      type: "message",
      role: "assistant",
      text: responseText,
      provider: {
        adapter: thread.adapter,
        eventType: optionalString(result.providerEventType, 120),
      },
    });
  }

  thread.status = "idle";
  thread.lastError = null;
  thread.updatedAt = now();
  appendMainThreadEvent(state, thread.id, {
    type: "status",
    text: "turn.completed",
    provider: { adapter: thread.adapter },
  });
  return thread;
}

export function failMainThreadTurn(
  state: ForgeRuntimeState,
  threadId: unknown,
  error: unknown,
): MainThreadRecord {
  const thread = findMainThread(state, threadId);
  const message = error instanceof Error ? error.message : String(error);
  thread.status = "error";
  thread.lastError = message.slice(0, 4096);
  thread.updatedAt = now();
  appendMainThreadEvent(state, thread.id, {
    type: "status",
    text: "turn.failed: " + thread.lastError,
    provider: {
      adapter: thread.adapter,
      status: "failed",
    },
  });
  return thread;
}

export function reconcileMainThreads(
  state: ForgeRuntimeState,
): string[] {
  const interrupted: string[] = [];
  for (const thread of threads(state)) {
    if (thread.status !== "running") continue;
    thread.status = "error";
    thread.lastError = "control plane restarted during an active turn";
    thread.updatedAt = now();
    appendMainThreadEvent(state, thread.id, {
      type: "status",
      text: "turn.interrupted: control plane restarted",
      provider: {
        adapter: thread.adapter,
        status: "interrupted",
      },
    });
    interrupted.push(thread.id);
  }
  return interrupted;
}

export function appendBuilderResultHandoff(
  state: ForgeRuntimeState,
  threadId: unknown,
  input: Record<string, unknown>,
): MainThreadEventRecord {
  const thread = findMainThread(state, threadId);
  if (thread.projectId !== input?.projectId) {
    throw new Error(
      "Builder result project does not match thread project",
    );
  }

  const dispatchId = requiredString(input?.dispatchId, "dispatchId");
  const existing = getMainThreadEvents(state, thread.id).find(
    (event) =>
      event.type === "handoff" &&
      event.handoff?.kind === "builder_result" &&
      event.handoff.dispatchId === dispatchId,
  );
  if (existing) return existing;

  return appendMainThreadEvent(state, thread.id, {
    type: "handoff",
    text:
      "Builder " +
      String(input.dispatchStatus ?? "") +
      ": " +
      String(input.taskId ?? ""),
    handoff: {
      ...input,
      kind: "builder_result",
      dispatchId,
    },
  });
}

export function createMainThreadHandoff(
  state: ForgeRuntimeState,
  threadId: unknown,
  input: Record<string, unknown>,
): MainThreadEventRecord {
  const thread = findMainThread(state, threadId);
  if (thread.projectId !== input?.projectId) {
    throw new Error("handoff project does not match thread project");
  }
  return appendMainThreadEvent(state, thread.id, {
    type: "handoff",
    text: "dispatch handoff: " + String(input.taskId ?? ""),
    handoff: input,
  });
}
