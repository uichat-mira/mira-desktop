import { randomUUID } from "node:crypto";
import type {
  ForgeCoreState,
  ForgeDispatch,
  ForgeDispatchStatus,
  ForgeRuntimeEvent,
} from "./types.js";

export const DISPATCH_STATUSES = [
  "starting",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export const TERMINAL_DISPATCH_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;

const DISPATCH_TRANSITIONS: Record<ForgeDispatchStatus, ForgeDispatchStatus[]> = {
  starting: ["running", "completed", "failed", "cancelled", "interrupted"],
  running: ["completed", "failed", "cancelled", "interrupted"],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: [],
};

const now = () => new Date().toISOString();

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getDispatches(state: ForgeCoreState): ForgeDispatch[] {
  if (!Array.isArray(state.dispatches)) state.dispatches = [];
  return state.dispatches;
}

export function getRuntimeEvents(state: ForgeCoreState): ForgeRuntimeEvent[] {
  if (!Array.isArray(state.events)) state.events = [];
  return state.events;
}

export function isTerminalDispatch(
  status: string,
): status is (typeof TERMINAL_DISPATCH_STATUSES)[number] {
  return (TERMINAL_DISPATCH_STATUSES as readonly string[]).includes(status);
}

export interface CreateDispatchInput {
  id?: unknown;
  projectId?: unknown;
  batchId?: unknown;
  taskId?: unknown;
  adapterId?: unknown;
  sessionId?: unknown;
  sourceThreadId?: unknown;
  promptSource?: unknown;
  taskRef?: unknown;
  model?: unknown;
  agent?: unknown;
}

export function createDispatch(
  state: ForgeCoreState,
  input: CreateDispatchInput,
): ForgeDispatch {
  const timestamp = now();
  const dispatch: ForgeDispatch = {
    id:
      typeof input.id === "string" && input.id.trim()
        ? input.id.trim()
        : `D-${randomUUID().slice(0, 12)}`,
    projectId: requiredString(input.projectId, "projectId"),
    batchId: requiredString(input.batchId, "batchId"),
    taskId: requiredString(input.taskId, "taskId"),
    adapterId: requiredString(input.adapterId, "adapterId"),
    sessionId: requiredString(input.sessionId, "sessionId"),
    sourceThreadId: nullableString(input.sourceThreadId),
    status: "starting",
    promptSource: input.promptSource === "task_ref" ? "task_ref" : "inline",
    taskRef: nullableString(input.taskRef),
    model: nullableString(input.model),
    agent: nullableString(input.agent),
    externalSessionId: null,
    pid: null,
    exitCode: null,
    signal: null,
    error: null,
    resultText: null,
    startedAt: null,
    endedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (getDispatches(state).some((item) => item.id === dispatch.id)) {
    throw new Error(`duplicate dispatch id: ${dispatch.id}`);
  }
  getDispatches(state).push(dispatch);
  return dispatch;
}

export interface TransitionDispatchPatch {
  externalSessionId?: string | null;
  pid?: number | null;
  exitCode?: number | null;
  signal?: string | null;
  error?: string | null;
  resultText?: string | null;
}

export function transitionDispatch(
  state: ForgeCoreState,
  dispatchId: string,
  nextStatus: string,
  patch: TransitionDispatchPatch = {},
): ForgeDispatch {
  const dispatch = getDispatches(state).find((item) => item.id === dispatchId);
  if (!dispatch) throw new Error("dispatch not found");
  if (!(DISPATCH_STATUSES as readonly string[]).includes(nextStatus)) {
    throw new Error(`invalid dispatch status: ${nextStatus}`);
  }

  const typedStatus = nextStatus as ForgeDispatchStatus;
  if (
    typedStatus !== dispatch.status &&
    !DISPATCH_TRANSITIONS[dispatch.status].includes(typedStatus)
  ) {
    throw new Error(`invalid dispatch transition: ${dispatch.status} -> ${typedStatus}`);
  }

  const timestamp = now();
  if (typedStatus === "running" && !dispatch.startedAt) dispatch.startedAt = timestamp;
  if (isTerminalDispatch(typedStatus) && !dispatch.endedAt) dispatch.endedAt = timestamp;
  dispatch.status = typedStatus;

  if (patch.externalSessionId !== undefined) dispatch.externalSessionId = patch.externalSessionId;
  if (patch.pid !== undefined) dispatch.pid = patch.pid;
  if (patch.exitCode !== undefined) dispatch.exitCode = patch.exitCode;
  if (patch.signal !== undefined) dispatch.signal = patch.signal;
  if (patch.error !== undefined) dispatch.error = patch.error;
  if (patch.resultText !== undefined) dispatch.resultText = patch.resultText;
  dispatch.updatedAt = timestamp;
  return dispatch;
}

export interface AppendRuntimeEventInput {
  id?: unknown;
  type?: unknown;
  projectId?: unknown;
  batchId?: unknown;
  taskId?: unknown;
  dispatchId?: unknown;
  sessionId?: unknown;
  data?: unknown;
}

export function appendRuntimeEvent(
  state: ForgeCoreState,
  input: AppendRuntimeEventInput,
): ForgeRuntimeEvent {
  const timestamp = now();
  const event: ForgeRuntimeEvent = {
    id:
      typeof input.id === "string" && input.id.trim()
        ? input.id.trim()
        : `E-${randomUUID().slice(0, 12)}`,
    type: requiredString(input.type, "type"),
    projectId: nullableString(input.projectId),
    batchId: nullableString(input.batchId),
    taskId: nullableString(input.taskId),
    dispatchId: nullableString(input.dispatchId),
    sessionId: nullableString(input.sessionId),
    data:
      input.data && typeof input.data === "object" && !Array.isArray(input.data)
        ? (input.data as Record<string, unknown>)
        : {},
    createdAt: timestamp,
  };
  getRuntimeEvents(state).push(event);
  return event;
}
