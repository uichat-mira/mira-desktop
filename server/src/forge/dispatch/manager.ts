import {
  createSession,
  heartbeatAdapter,
  registerAdapter,
  updateSession,
  updateTask,
} from "../domain.js";
import {
  appendRuntimeEvent,
  createDispatch,
  getDispatches,
  isTerminalDispatch,
  transitionDispatch,
} from "../dispatch-domain.js";
import {
  BUILTIN_BUILDERS,
  CODEX_ADAPTER_ID,
  OPENCODE_ADAPTER_ID,
  PIAGENT_ADAPTER_ID,
  resolveBuilderAdapterId,
} from "../builder-contract.js";
import { getDispatchReadiness } from "../readiness.js";
import { resolveProjectTask } from "../project/project-task-actions.js";
import { appendBuilderResultHandoff } from "../main-thread/domain.js";
import type { ForgeRuntimeStore } from "../runtime/store.js";
import type {
  ForgeDispatch,
  ForgeProject,
  ForgeRuntimeEvent,
} from "../types.js";
import type {
  BuilderExitResult,
  BuilderProcessHandle,
  BuilderProviderEvent,
  BuilderRunner,
} from "../adapters/builder/types.js";

const ACTIVE_SESSION_STATUSES = ["starting", "running", "waiting"] as const;
const MAX_PROVIDER_TEXT = 8192;

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(name + " is required");
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boundedString(
  value: unknown,
  limit = 256,
): string | null {
  const text = optionalString(value);
  return text ? text.slice(0, limit) : null;
}

function findDispatch(
  state: Awaited<ReturnType<ForgeRuntimeStore["read"]>>,
  dispatchId: string,
): ForgeDispatch {
  const dispatch = getDispatches(state).find(
    (item) => item.id === dispatchId,
  );
  if (!dispatch) throw new Error("dispatch not found");
  return dispatch;
}

function resolveBinding(
  state: Awaited<ReturnType<ForgeRuntimeStore["read"]>>,
  batchId: string,
  taskId: string,
) {
  const batch = state.batches.find((item) => item.id === batchId);
  if (!batch) throw new Error("batch not found");
  const task = batch.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("task not found");
  const project = state.projects.find(
    (item) => item.id === batch.projectId,
  );
  if (!project) throw new Error("project not found");
  return { project, batch, task };
}

function resolveSourceThread(
  state: Awaited<ReturnType<ForgeRuntimeStore["read"]>>,
  projectId: string,
  sourceThreadId: unknown,
) {
  const id = optionalString(sourceThreadId);
  if (!id) return null;
  const thread = state.threads.find((item) => item.id === id);
  if (!thread) throw new Error("sourceThreadId not found");
  if (thread.projectId !== projectId) {
    throw new Error("sourceThreadId does not match dispatch project");
  }
  return thread;
}

function ensureBuilderAdapter(
  state: Awaited<ReturnType<ForgeRuntimeStore["read"]>>,
  adapterId: string,
) {
  let adapter = state.adapters.find((item) => item.id === adapterId);
  const builtin = BUILTIN_BUILDERS[adapterId];

  if (!adapter && builtin) {
    adapter = registerAdapter(state, {
      id: builtin.id,
      name: builtin.name,
      kind: builtin.kind,
      capabilities: [...builtin.capabilities],
    });
  }

  if (!adapter) throw new Error("adapterId not found");
  if (adapter.kind !== "builder") {
    throw new Error("dispatch requires a builder adapter");
  }
  return adapter;
}

function findActiveBuilderDispatch(
  state: Awaited<ReturnType<ForgeRuntimeStore["read"]>>,
): ForgeDispatch | null {
  return (
    getDispatches(state).find(
      (dispatch) => !isTerminalDispatch(dispatch.status),
    ) ?? null
  );
}

function observedExternalSessionId(
  event: BuilderProviderEvent,
): string | null {
  return (
    optionalString(event.externalSessionId) ??
    optionalString(event.sessionID) ??
    optionalString(event.thread_id) ??
    optionalString(event.threadId)
  );
}

function providerEventData(
  event: BuilderProviderEvent,
): Record<string, unknown> | null {
  if (!event.provider || typeof event.provider !== "object") {
    return null;
  }

  const provider = {
    adapter: boundedString(event.provider.adapter, 80),
    eventType: boundedString(event.provider.eventType, 120),
    itemType: boundedString(event.provider.itemType, 120),
    status: boundedString(event.provider.status, 80),
  };
  const tool =
    event.tool && typeof event.tool === "object"
      ? {
          name: boundedString(event.tool.name, 160),
          status: boundedString(event.tool.status, 80),
        }
      : null;
  const artifact =
    event.artifact && typeof event.artifact === "object"
      ? {
          kind: boundedString(event.artifact.kind, 80),
          ref: boundedString(event.artifact.ref, 512),
        }
      : null;

  return { provider, tool, artifact };
}

export function buildTaskDispatchPrompt(input: {
  project: ForgeProject;
  batch: Awaited<ReturnType<ForgeRuntimeStore["read"]>>["batches"][number];
  task: Awaited<ReturnType<ForgeRuntimeStore["read"]>>["batches"][number]["tasks"][number];
  taskRef: unknown;
}): string {
  const ref = requiredString(input.taskRef, "taskRef");
  const base = input.task.baseSha ?? input.batch.baseSha ?? null;

  return [
    "# Task Dispatch",
    "",
    "Task: " + input.task.id,
    "Project: " + input.project.name,
    "Base: " +
      input.project.integrationBranch +
      (base ? " @ " + base : ""),
    "Goal: " + input.task.title,
    "",
    "## Must Read",
    "- AGENTS.md",
    "- " + ref,
    "",
    "## Hard Constraints",
    "- Treat the current repository files as authoritative if they " +
      "conflict with this dispatch message.",
    "- Stay inside the task scope; do not perform unrelated refactors.",
    "- Do not push, merge, deploy, publish, or broaden permissions.",
    "- If a missing fact would change implementation direction, stop at " +
      "that decision point and report it instead of guessing.",
    "",
    "## Validation",
    "- Run the repository/task-relevant checks before handoff.",
    "",
    "## Handoff",
    "- Report what changed, validation evidence, remaining risks, and " +
      "any human decision still required.",
  ].join("\n");
}

function deliverBuilderResult(
  state: Awaited<ReturnType<ForgeRuntimeStore["read"]>>,
  dispatch: ForgeDispatch,
): void {
  if (!dispatch.sourceThreadId) return;

  const { task } = resolveBinding(
    state,
    dispatch.batchId,
    dispatch.taskId,
  );
  const session = state.sessions.find(
    (item) => item.id === dispatch.sessionId,
  );

  appendBuilderResultHandoff(state, dispatch.sourceThreadId, {
    projectId: dispatch.projectId,
    batchId: dispatch.batchId,
    taskId: dispatch.taskId,
    taskRef: dispatch.taskRef,
    dispatchId: dispatch.id,
    sessionId: dispatch.sessionId,
    adapterId: dispatch.adapterId,
    dispatchStatus: dispatch.status,
    sessionStatus: session?.status ?? null,
    taskStatus: task.status,
    externalSessionId: dispatch.externalSessionId,
    resultText: dispatch.resultText,
    error: dispatch.error,
    startedAt: dispatch.startedAt,
    endedAt: dispatch.endedAt,
  });
}

function dispatchEvent(
  state: Awaited<ReturnType<ForgeRuntimeStore["read"]>>,
  dispatch: ForgeDispatch,
  type: string,
  data: Record<string, unknown> = {},
): ForgeRuntimeEvent {
  return appendRuntimeEvent(state, {
    type,
    projectId: dispatch.projectId,
    batchId: dispatch.batchId,
    taskId: dispatch.taskId,
    dispatchId: dispatch.id,
    sessionId: dispatch.sessionId,
    data,
  });
}

export interface DispatchTaskInput {
  batchId?: unknown;
  taskId?: unknown;
  adapterId?: unknown;
  builder?: unknown;
  preferredBuilder?: unknown;
  sourceThreadId?: unknown;
  prompt?: unknown;
  taskRef?: unknown;
  model?: unknown;
  agent?: unknown;
}

export interface ForgeDispatchManager {
  dispatchTask(input: DispatchTaskInput): Promise<ForgeDispatch>;
  cancelDispatch(dispatchId: unknown): Promise<ForgeDispatch>;
  getReadiness(batchId: unknown): Promise<ReturnType<typeof getDispatchReadiness>>;
  reconcile(): Promise<number>;
  shutdown(): Promise<void>;
}

export function createDispatchManager(input: {
  store: ForgeRuntimeStore;
  runners: Map<string, BuilderRunner>;
}): ForgeDispatchManager {
  const { store, runners } = input;
  if (!store?.read || !store?.mutate) {
    throw new Error("store is required");
  }
  if (!(runners instanceof Map)) {
    throw new Error("runners must be a Map");
  }

  const handles = new Map<string, BuilderProcessHandle>();
  const terminatingDispatches = new Set<string>();

  async function markStarted(
    dispatchId: string,
    info: { pid?: number | null } = {},
  ): Promise<void> {
    await store.mutate((state) => {
      const dispatch = findDispatch(state, dispatchId);
      if (isTerminalDispatch(dispatch.status)) return dispatch;

      transitionDispatch(state, dispatch.id, "running", {
        pid: Number.isInteger(info.pid) ? (info.pid as number) : null,
      });
      const session = state.sessions.find(
        (item) => item.id === dispatch.sessionId,
      );
      if (
        session &&
        (ACTIVE_SESSION_STATUSES as readonly string[]).includes(
          session.status,
        )
      ) {
        updateSession(state, session.id, { status: "running" });
      }
      heartbeatAdapter(state, dispatch.adapterId, { status: "busy" });
      dispatchEvent(state, dispatch, "dispatch.started", {
        pid: Number.isInteger(info.pid) ? info.pid : null,
      });
      return dispatch;
    });
  }

  async function observeEvent(
    dispatchId: string,
    event: BuilderProviderEvent,
  ): Promise<void> {
    const externalSessionId = observedExternalSessionId(event);
    const evidence = providerEventData(event);
    if (!externalSessionId && !evidence) return;

    await store.mutate((state) => {
      const dispatch = findDispatch(state, dispatchId);
      if (isTerminalDispatch(dispatch.status)) return dispatch;

      if (
        externalSessionId &&
        dispatch.externalSessionId &&
        dispatch.externalSessionId !== externalSessionId
      ) {
        dispatchEvent(state, dispatch, "dispatch.warning", {
          code: "external_session_changed",
          observedSessionId: externalSessionId,
        });
      } else if (
        externalSessionId &&
        dispatch.externalSessionId !== externalSessionId
      ) {
        transitionDispatch(state, dispatch.id, dispatch.status, {
          externalSessionId,
        });
        const session = state.sessions.find(
          (item) => item.id === dispatch.sessionId,
        );
        if (session) {
          updateSession(state, session.id, { externalSessionId });
        }
        dispatchEvent(state, dispatch, "dispatch.session_bound", {
          externalSessionId,
        });
      }

      if (evidence) {
        dispatchEvent(
          state,
          dispatch,
          "dispatch.provider_event",
          evidence,
        );
      }
      return dispatch;
    });
  }

  async function finishDispatch(
    dispatchId: string,
    result: BuilderExitResult,
  ): Promise<void> {
    if (terminatingDispatches.has(dispatchId)) return;
    handles.delete(dispatchId);
    await store.mutate((state) => {
      const dispatch = findDispatch(state, dispatchId);
      if (isTerminalDispatch(dispatch.status)) return dispatch;

      const { batch, task } = resolveBinding(
        state,
        dispatch.batchId,
        dispatch.taskId,
      );
      const session = state.sessions.find(
        (item) => item.id === dispatch.sessionId,
      );
      const providerError = boundedString(
        result.errorText,
        MAX_PROVIDER_TEXT,
      );
      const success = result.code === 0 && !providerError;

      if (
        session &&
        (ACTIVE_SESSION_STATUSES as readonly string[]).includes(
          session.status,
        )
      ) {
        updateSession(state, session.id, {
          status: success ? "completed" : "failed",
        });
      }
      updateTask(state, batch.id, task.id, {
        status: success ? "reviewing" : "interrupted",
      });
      heartbeatAdapter(state, dispatch.adapterId, {
        status: "available",
      });

      const resultText = boundedString(
        result.resultText,
        MAX_PROVIDER_TEXT,
      );

      if (success) {
        transitionDispatch(state, dispatch.id, "completed", {
          exitCode: 0,
          signal: result.signal ?? null,
          resultText,
          error: null,
        });
        dispatchEvent(state, dispatch, "dispatch.completed", {
          exitCode: 0,
          signal: result.signal ?? null,
          externalSessionId: dispatch.externalSessionId,
        });
      } else {
        const message =
          providerError ??
          boundedString(result.stderr, MAX_PROVIDER_TEXT) ??
          "Builder exited with code " + String(result.code ?? "unknown");
        transitionDispatch(state, dispatch.id, "failed", {
          exitCode: result.code ?? null,
          signal: result.signal ?? null,
          resultText,
          error: message,
        });
        dispatchEvent(state, dispatch, "dispatch.failed", {
          exitCode: result.code ?? null,
          signal: result.signal ?? null,
          message,
        });
      }

      deliverBuilderResult(state, dispatch);
      return dispatch;
    });
  }

  async function failDispatch(
    dispatchId: string,
    error: unknown,
    details: { stderr?: unknown } = {},
  ): Promise<void> {
    if (terminatingDispatches.has(dispatchId)) return;
    handles.delete(dispatchId);
    const message =
      error instanceof Error ? error.message : String(error);

    await store.mutate((state) => {
      const dispatch = findDispatch(state, dispatchId);
      if (isTerminalDispatch(dispatch.status)) return dispatch;

      const { batch, task } = resolveBinding(
        state,
        dispatch.batchId,
        dispatch.taskId,
      );
      const session = state.sessions.find(
        (item) => item.id === dispatch.sessionId,
      );
      if (
        session &&
        (ACTIVE_SESSION_STATUSES as readonly string[]).includes(
          session.status,
        )
      ) {
        updateSession(state, session.id, { status: "failed" });
      }
      updateTask(state, batch.id, task.id, {
        status: "interrupted",
      });
      heartbeatAdapter(state, dispatch.adapterId, { status: "error" });

      const persistedError =
        boundedString(details.stderr, MAX_PROVIDER_TEXT) ??
        boundedString(message, MAX_PROVIDER_TEXT) ??
        "Builder failed";
      transitionDispatch(state, dispatch.id, "failed", {
        error: persistedError,
      });
      dispatchEvent(state, dispatch, "dispatch.failed", {
        message: boundedString(message, MAX_PROVIDER_TEXT),
      });
      deliverBuilderResult(state, dispatch);
      return dispatch;
    });
  }

  async function getReadiness(batchId: unknown) {
    const id = requiredString(batchId, "batchId");
    const state = await store.read();
    return getDispatchReadiness(state, id);
  }

  async function dispatchTask(
    request: DispatchTaskInput,
  ): Promise<ForgeDispatch> {
    const batchId = requiredString(request.batchId, "batchId");
    const taskId = requiredString(request.taskId, "taskId");
    const adapterId = resolveBuilderAdapterId(request);
    const runner = runners.get(adapterId);
    if (!runner) {
      throw new Error(
        "no runner configured for adapter: " + adapterId,
      );
    }

    const before = await store.read();
    const activeBefore = findActiveBuilderDispatch(before);
    if (activeBefore) {
      throw new Error(
        "builder dispatch already active: " + activeBefore.id,
      );
    }
    const beforeBinding = resolveBinding(before, batchId, taskId);
    const repositoryTask = await resolveProjectTask(
      store,
      beforeBinding.project.id,
      taskId,
    );
    const requestedTaskRef = optionalString(request.taskRef);
    if (
      requestedTaskRef &&
      requestedTaskRef !== repositoryTask.taskRef
    ) {
      throw new Error(
        "taskRef does not match repository Task Card: " +
          repositoryTask.taskRef,
      );
    }

    const prepared = await store.mutate((state) => {
      const binding = resolveBinding(state, batchId, taskId);
      if (binding.project.id !== beforeBinding.project.id) {
        throw new Error("dispatch project binding changed");
      }

      const readiness = getDispatchReadiness(state, batchId);
      const ready = readiness.ready.find(
        (item) => item.taskId === taskId,
      );
      if (!ready) {
        const blocked = readiness.blocked.find(
          (item) => item.taskId === taskId,
        );
        throw new Error(
          "task is not dispatch-ready: " +
            JSON.stringify(blocked?.reasons ?? []),
        );
      }

      const adapter = ensureBuilderAdapter(state, adapterId);
      const activeBuilderDispatch = findActiveBuilderDispatch(state);
      if (activeBuilderDispatch) {
        throw new Error(
          "builder dispatch already active: " +
            activeBuilderDispatch.id,
        );
      }

      const sourceThread = resolveSourceThread(
        state,
        binding.project.id,
        request.sourceThreadId,
      );
      const inlinePrompt = optionalString(request.prompt);
      const canonicalPrompt = buildTaskDispatchPrompt({
        project: binding.project,
        batch: binding.batch,
        task: binding.task,
        taskRef: repositoryTask.taskRef,
      });
      const prompt = inlinePrompt
        ? [
            canonicalPrompt,
            "",
            "## Additional Operator Instruction",
            inlinePrompt,
          ].join("\n")
        : canonicalPrompt;
      const promptSource = inlinePrompt ? "inline" : "task_ref";

      const session = createSession(state, {
        role: "builder",
        adapterId: adapter.id,
        projectId: binding.project.id,
        batchId,
        taskId,
      });
      updateTask(state, batchId, taskId, {
        status: "building",
        builder: adapter.id,
      });
      const dispatch = createDispatch(state, {
        projectId: binding.project.id,
        batchId,
        taskId,
        adapterId: adapter.id,
        sessionId: session.id,
        sourceThreadId: sourceThread?.id ?? null,
        promptSource,
        taskRef: repositoryTask.taskRef,
        model: request.model,
        agent: request.agent,
      });
      dispatchEvent(state, dispatch, "dispatch.queued", {
        adapterId: adapter.id,
        promptSource,
        taskRef: repositoryTask.taskRef,
        sourceThreadId: dispatch.sourceThreadId,
      });

      return {
        dispatch: structuredClone(dispatch),
        project: structuredClone(binding.project),
        prompt,
      };
    });

    try {
      const handle = runner.start({
        projectRoot: prepared.project.rootPath,
        prompt: prepared.prompt,
        model: optionalString(request.model),
        agent: optionalString(request.agent),
        onStarted: (info) => {
          void markStarted(prepared.dispatch.id, info).catch(
            (error) => {
              void failDispatch(
                prepared.dispatch.id,
                error,
              ).catch(() => undefined);
            },
          );
        },
        onEvent: (event) => {
          void observeEvent(prepared.dispatch.id, event).catch(
            (error) => {
              void failDispatch(
                prepared.dispatch.id,
                error,
              ).catch(() => undefined);
            },
          );
        },
        onExit: (result) => {
          void finishDispatch(
            prepared.dispatch.id,
            result,
          ).catch((error) => {
            void failDispatch(
              prepared.dispatch.id,
              error,
            ).catch(() => undefined);
          });
        },
        onError: (error, details) => {
          void failDispatch(
            prepared.dispatch.id,
            error,
            details,
          ).catch(() => undefined);
        },
      });
      handles.set(prepared.dispatch.id, handle);
    } catch (error) {
      await failDispatch(prepared.dispatch.id, error);
    }

    return prepared.dispatch;
  }

  async function cancelDispatch(
    dispatchId: unknown,
  ): Promise<ForgeDispatch> {
    const id = requiredString(dispatchId, "dispatchId");
    const snapshot = await store.read();
    const current = findDispatch(snapshot, id);
    if (isTerminalDispatch(current.status)) {
      return structuredClone(current);
    }

    const handle = handles.get(id);
    if (!handle) {
      throw new Error(
        "cannot cancel dispatch without an owned live process handle: " + id,
      );
    }

    terminatingDispatches.add(id);
    const signalSent = handle.kill("SIGTERM");
    if (!signalSent) {
      terminatingDispatches.delete(id);
      await store.mutate((state) => {
        const dispatch = findDispatch(state, id);
        if (!isTerminalDispatch(dispatch.status)) {
          dispatchEvent(state, dispatch, "dispatch.warning", {
            code: "cancel_signal_failed",
            signal: "SIGTERM",
          });
        }
      });
      throw new Error(
        "failed to terminate live Builder process for dispatch: " + id,
      );
    }

    try {
      const cancelled = await store.mutate((state) => {
        const dispatch = findDispatch(state, id);
        if (isTerminalDispatch(dispatch.status)) {
          return structuredClone(dispatch);
        }

        const { batch, task } = resolveBinding(
          state,
          dispatch.batchId,
          dispatch.taskId,
        );
        const session = state.sessions.find(
          (item) => item.id === dispatch.sessionId,
        );
        if (
          session &&
          (ACTIVE_SESSION_STATUSES as readonly string[]).includes(
            session.status,
          )
        ) {
          updateSession(state, session.id, {
            status: "disconnected",
          });
        }
        updateTask(state, batch.id, task.id, {
          status: "interrupted",
        });
        heartbeatAdapter(state, dispatch.adapterId, {
          status: "available",
        });
        transitionDispatch(state, dispatch.id, "cancelled", {
          signal: "SIGTERM",
        });
        dispatchEvent(state, dispatch, "dispatch.cancelled", {
          reason: "explicit_cancel",
        });
        deliverBuilderResult(state, dispatch);
        return structuredClone(dispatch);
      });
      handles.delete(id);
      return cancelled;
    } finally {
      terminatingDispatches.delete(id);
    }
  }

  async function reconcile(): Promise<number> {
    return store.mutate((state) => {
      let count = 0;
      for (const dispatch of getDispatches(state)) {
        if (!isTerminalDispatch(dispatch.status)) {
          const session = state.sessions.find(
            (item) => item.id === dispatch.sessionId,
          );
          if (
            session &&
            (ACTIVE_SESSION_STATUSES as readonly string[]).includes(
              session.status,
            )
          ) {
            updateSession(state, session.id, {
              status: "disconnected",
            });
          }

          const binding = resolveBinding(
            state,
            dispatch.batchId,
            dispatch.taskId,
          );
          if (binding.task.status === "building") {
            updateTask(
              state,
              dispatch.batchId,
              dispatch.taskId,
              { status: "interrupted" },
            );
          }

          const adapter = state.adapters.find(
            (item) => item.id === dispatch.adapterId,
          );
          if (adapter) {
            adapter.status = "offline";
            adapter.updatedAt = new Date().toISOString();
          }

          transitionDispatch(state, dispatch.id, "interrupted", {
            error:
              "control plane restarted; process supervision was lost",
          });
          dispatchEvent(state, dispatch, "dispatch.interrupted", {
            reason: "control_plane_restart",
          });
          count += 1;
        }

        if (isTerminalDispatch(dispatch.status)) {
          deliverBuilderResult(state, dispatch);
        }
      }
      return count;
    });
  }

  async function shutdown(): Promise<void> {
    const ids = [...handles.keys()];
    const errors: unknown[] = [];

    for (const id of ids) {
      const handle = handles.get(id);
      terminatingDispatches.add(id);
      try {
        await store.mutate((state) => {
          const dispatch = findDispatch(state, id);
          if (isTerminalDispatch(dispatch.status)) return dispatch;

          const { batch, task } = resolveBinding(
            state,
            dispatch.batchId,
            dispatch.taskId,
          );
          const session = state.sessions.find(
            (item) => item.id === dispatch.sessionId,
          );
          if (
            session &&
            (ACTIVE_SESSION_STATUSES as readonly string[]).includes(
              session.status,
            )
          ) {
            updateSession(state, session.id, {
              status: "disconnected",
            });
          }
          updateTask(state, batch.id, task.id, {
            status: "interrupted",
          });
          heartbeatAdapter(state, dispatch.adapterId, {
            status: "offline",
          });
          transitionDispatch(state, dispatch.id, "interrupted", {
            signal: "SIGTERM",
            error: "control plane shutdown",
          });
          dispatchEvent(state, dispatch, "dispatch.interrupted", {
            reason: "control_plane_shutdown",
          });
          deliverBuilderResult(state, dispatch);
          return dispatch;
        });

        handles.delete(id);
        if (handle && !handle.kill("SIGTERM")) {
          await store.mutate((state) => {
            const dispatch = findDispatch(state, id);
            dispatchEvent(state, dispatch, "dispatch.warning", {
              code: "shutdown_signal_failed",
              signal: "SIGTERM",
            });
          });
          errors.push(
            new Error(
              "failed to terminate live Builder process during shutdown: " +
                id,
            ),
          );
        }
      } catch (error) {
        errors.push(error);
      } finally {
        terminatingDispatches.delete(id);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "Builder dispatch shutdown failed",
      );
    }
  }

  return {
    dispatchTask,
    cancelDispatch,
    getReadiness,
    reconcile,
    shutdown,
  };
}

export {
  CODEX_ADAPTER_ID,
  OPENCODE_ADAPTER_ID,
  PIAGENT_ADAPTER_ID,
};
