import { randomUUID } from "node:crypto";
import {
  updateSession,
  updateTask,
} from "../domain.js";
import {
  appendRuntimeEvent,
  getDispatches,
  isTerminalDispatch,
  transitionDispatch,
} from "../dispatch-domain.js";
import type {
  ForgeRuntimeState,
  ForgeRuntimeThreadEventRecord,
  ForgeRuntimeThreadRecord,
} from "./state.js";

const ACTIVE_SESSION_STATUSES = ["starting", "running", "waiting"] as const;

export interface ForgeStartupReconcileReport {
  interruptedDispatchIds: string[];
  interruptedThreadIds: string[];
}

function resolveTaskBinding(
  state: ForgeRuntimeState,
  batchId: string,
  taskId: string,
) {
  const batch = state.batches.find((item) => item.id === batchId);
  if (!batch) throw new Error(`Forge reconcile batch not found: ${batchId}`);
  const task = batch.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Forge reconcile task not found: ${taskId}`);
  return { batch, task };
}

function appendInterruptedThreadEvent(
  state: ForgeRuntimeState,
  thread: ForgeRuntimeThreadRecord,
  timestamp: string,
): ForgeRuntimeThreadEventRecord {
  if (!thread.id?.trim() || !thread.projectId?.trim() || !thread.adapter?.trim()) {
    throw new Error("Invalid Mira Forge main-thread state during startup reconcile");
  }

  const event: ForgeRuntimeThreadEventRecord = {
    id: `TE-${randomUUID().slice(0, 12)}`,
    threadId: thread.id,
    projectId: thread.projectId,
    type: "status",
    role: null,
    text: "turn.interrupted: control plane restarted",
    tool: null,
    artifact: null,
    handoff: null,
    provider: {
      adapter: thread.adapter,
      status: "interrupted",
    },
    createdAt: timestamp,
  };
  state.threadEvents.push(event);
  return event;
}

function reconcileDispatches(state: ForgeRuntimeState): string[] {
  const interrupted: string[] = [];

  for (const dispatch of getDispatches(state)) {
    if (isTerminalDispatch(dispatch.status)) continue;

    const session = state.sessions.find((item) => item.id === dispatch.sessionId);
    if (
      session &&
      (ACTIVE_SESSION_STATUSES as readonly string[]).includes(session.status)
    ) {
      updateSession(state, session.id, { status: "disconnected" });
    }

    const { batch, task } = resolveTaskBinding(
      state,
      dispatch.batchId,
      dispatch.taskId,
    );
    if (task.status === "building") {
      updateTask(state, batch.id, task.id, { status: "interrupted" });
    }

    const adapter = state.adapters.find((item) => item.id === dispatch.adapterId);
    if (adapter) {
      adapter.status = "offline";
      adapter.updatedAt = new Date().toISOString();
    }

    transitionDispatch(state, dispatch.id, "interrupted", {
      error: "control plane restarted; process supervision was lost",
    });
    appendRuntimeEvent(state, {
      type: "dispatch.interrupted",
      projectId: dispatch.projectId,
      batchId: dispatch.batchId,
      taskId: dispatch.taskId,
      dispatchId: dispatch.id,
      sessionId: dispatch.sessionId,
      data: { reason: "control_plane_restart" },
    });
    interrupted.push(dispatch.id);
  }

  return interrupted;
}

function reconcileMainThreads(state: ForgeRuntimeState): string[] {
  const interrupted: string[] = [];

  for (const thread of state.threads) {
    if (thread.status !== "running") continue;
    const timestamp = new Date().toISOString();
    thread.status = "error";
    thread.lastError = "control plane restarted during an active turn";
    thread.updatedAt = timestamp;
    appendInterruptedThreadEvent(state, thread, timestamp);
    interrupted.push(thread.id);
  }

  return interrupted;
}

export function reconcileForgeRuntimeState(
  state: ForgeRuntimeState,
): ForgeStartupReconcileReport {
  return {
    interruptedDispatchIds: reconcileDispatches(state),
    interruptedThreadIds: reconcileMainThreads(state),
  };
}
