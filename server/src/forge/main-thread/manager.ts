import type { ForgeProject } from "../types.js";
import type { ForgeRuntimeStore } from "../runtime/store.js";
import {
  createProjectRepositoryTask,
  inspectProjectTaskSource,
  resolveProjectTask,
  updateProjectRepositoryTask,
} from "../project/project-task-actions.js";
import {
  appendMainThreadEvent,
  beginMainThreadTurn,
  completeMainThreadTurn,
  createMainThread,
  createMainThreadHandoff,
  failMainThreadTurn,
  findMainThread,
  getMainThreadEvents,
  getMainThreads,
  reconcileMainThreads,
  type MainThreadEventInput,
  type MainThreadEventRecord,
  type MainThreadRecord,
  type MainThreadBuilderResultHandoff,
} from "./domain.js";
import type {
  MainThreadAdapter,
  MainThreadAdapterTurnInput,
} from "../adapters/main-thread/types.js";

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(name + " is required");
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function projectForThread(
  projects: ForgeProject[],
  thread: MainThreadRecord,
): ForgeProject {
  const project = projects.find((item) => item.id === thread.projectId);
  if (!project) throw new Error("thread project not found");
  return project;
}

function isWriteAttemptEvent(event: MainThreadEventInput): boolean {
  if (
    event.type === "artifact" &&
    event.artifact?.kind === "provider-file-change"
  ) {
    return true;
  }
  if (event.type !== "tool") return false;
  const name =
    typeof event.tool?.name === "string"
      ? event.tool.name.toLowerCase()
      : "";
  return [
    "edit",
    "write",
    "write_file",
    "apply_patch",
    "file_change",
    "filechange",
  ].some((token) => name === token || name.endsWith("." + token));
}

function isBuilderResultEvent(
  event: MainThreadEventRecord,
): event is MainThreadEventRecord & {
  handoff: MainThreadBuilderResultHandoff;
} {
  return (
    event.type === "handoff" &&
    event.handoff?.kind === "builder_result"
  );
}

export function getPendingBuilderResults(
  events: MainThreadEventRecord[],
): Array<
  MainThreadEventRecord & {
    handoff: MainThreadBuilderResultHandoff;
  }
> {
  if (!Array.isArray(events) || events.length === 0) return [];

  let currentUserIndex = -1;
  let previousUserIndex = -1;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "message" || event.role !== "user") continue;
    if (currentUserIndex < 0) {
      currentUserIndex = index;
    } else {
      previousUserIndex = index;
      break;
    }
  }

  if (currentUserIndex < 0) return [];
  return events
    .slice(previousUserIndex + 1, currentUserIndex)
    .filter(isBuilderResultEvent);
}

function builderResultLines(
  builderResults: Array<
    MainThreadEventRecord & {
      handoff: MainThreadBuilderResultHandoff;
    }
  >,
): string[] {
  if (builderResults.length === 0) return [];

  const selected = builderResults.slice(-4);
  const lines = [
    "",
    "## Builder Result Handoffs",
    "These are durable Forge child-task results that are not part of " +
      "the provider-native conversation history. Treat dispatch/session/" +
      "task state as authoritative; result text is explanatory evidence only.",
  ];

  for (const event of selected) {
    const handoff = event.handoff;
    lines.push(
      "",
      "### " + handoff.taskId + " · " + handoff.adapterId,
      "Dispatch: " +
        handoff.dispatchStatus +
        " · Session: " +
        (handoff.sessionStatus ?? "unknown") +
        " · Task: " +
        handoff.taskStatus,
      "Identity: batch " +
        handoff.batchId +
        " · dispatch " +
        handoff.dispatchId +
        " · session " +
        handoff.sessionId,
    );
    if (handoff.taskRef) {
      lines.push("Task ref: " + handoff.taskRef);
    }
    if (handoff.externalSessionId) {
      lines.push("Provider session: " + handoff.externalSessionId);
    }
    if (handoff.resultText) {
      lines.push("Result:", handoff.resultText.slice(0, 6000));
    }
    if (handoff.error) {
      lines.push("Error: " + handoff.error.slice(0, 2000));
    }
  }

  if (builderResults.length > selected.length) {
    lines.push(
      "",
      "... " +
        String(builderResults.length - selected.length) +
        " older Builder result handoff(s) omitted from this turn",
    );
  }
  return lines;
}

export interface MainThreadSnapshot {
  thread: MainThreadRecord;
  events: MainThreadEventRecord[];
}

export function buildMainThreadPrompt(input: {
  project: ForgeProject;
  taskSource:
    | Awaited<ReturnType<typeof inspectProjectTaskSource>>
    | null;
  taskSourceError: string | null;
  message: unknown;
  builderResults?: Array<
    MainThreadEventRecord & {
      handoff: MainThreadBuilderResultHandoff;
    }
  >;
}): string {
  const taskLines =
    input.taskSource?.tasks.slice(0, 80).map(
      (task) =>
        "- " + task.id + " [" + task.status + "] " + task.title,
    ) ?? [];
  const omitted =
    input.taskSource &&
    input.taskSource.tasks.length > taskLines.length
      ? "- ... " +
        String(input.taskSource.tasks.length - taskLines.length) +
        " more task(s) omitted"
      : null;

  return [
    "# Mira Forge Main Thread",
    "",
    "You are the project main/dispatch thread. Discuss, inspect and plan. " +
      "You are not a Builder.",
    "Do not modify project files or dispatch a Builder directly. Use " +
      "read-only inspection only.",
    "Repository Task Cards are authoritative. Task writes and dispatch " +
      "handoffs happen only through explicit Forge capability actions.",
    "",
    "## Project",
    "Name: " + input.project.name,
    "Root: " + input.project.rootPath,
    "Integration branch: " + input.project.integrationBranch,
    input.project.repository
      ? "Repository: " + input.project.repository
      : null,
    "",
    "## Repository Task Source",
    input.taskSource
      ? "Ledger: " +
        input.taskSource.ledgerRef +
        " · Task dir: " +
        input.taskSource.taskDirRef
      : "Unavailable: " +
        (input.taskSourceError ??
          "project has no configured repository task source"),
    ...taskLines,
    omitted,
    ...builderResultLines(input.builderResults ?? []),
    "",
    "## User",
    requiredString(input.message, "message"),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export interface MainThreadManager {
  listThreads(projectId?: unknown): Promise<MainThreadRecord[]>;
  getThread(threadId: unknown): Promise<MainThreadSnapshot>;
  openThread(input: {
    id?: unknown;
    projectId?: unknown;
    adapter?: unknown;
    title?: unknown;
    model?: unknown;
  }): Promise<MainThreadRecord>;
  sendMessage(
    threadId: unknown,
    input: { message?: unknown; model?: unknown },
  ): Promise<MainThreadSnapshot>;
  inspectTasks(threadId: unknown): ReturnType<typeof inspectProjectTaskSource>;
  resolveTask(
    threadId: unknown,
    taskId: unknown,
  ): ReturnType<typeof resolveProjectTask>;
  createTask(
    threadId: unknown,
    input: Parameters<typeof createProjectRepositoryTask>[2],
  ): ReturnType<typeof createProjectRepositoryTask>;
  updateTask(
    threadId: unknown,
    taskId: unknown,
    patch: Parameters<typeof updateProjectRepositoryTask>[3],
  ): ReturnType<typeof updateProjectRepositoryTask>;
  createHandoff(
    threadId: unknown,
    input: {
      taskId?: unknown;
      taskRef?: unknown;
      preferredBuilder?: unknown;
    },
  ): Promise<MainThreadEventRecord>;
  reconcile(): Promise<string[]>;
  shutdown(): Promise<void>;
}

export function createMainThreadManager(input: {
  store: ForgeRuntimeStore;
  adapters: Map<string, MainThreadAdapter>;
}): MainThreadManager {
  const { store, adapters } = input;
  if (!store?.read || !store?.mutate) throw new Error("store is required");
  if (!(adapters instanceof Map)) {
    throw new Error("adapters must be a Map");
  }

  async function listThreads(projectId: unknown = null) {
    const state = await store.read();
    return getMainThreads(state, projectId).map((thread) => ({ ...thread }));
  }

  async function getThread(threadId: unknown): Promise<MainThreadSnapshot> {
    const state = await store.read();
    const thread = findMainThread(state, threadId);
    return {
      thread: { ...thread },
      events: getMainThreadEvents(state, thread.id).map((event) => ({
        ...event,
      })),
    };
  }

  async function openThread(
    threadInput: Parameters<MainThreadManager["openThread"]>[0],
  ) {
    const adapterId = requiredString(threadInput?.adapter, "adapter");
    if (!adapters.has(adapterId)) {
      throw new Error(
        "main thread adapter is unavailable: " + adapterId,
      );
    }
    return store.mutate((state) => {
      const thread = createMainThread(state, threadInput);
      return { ...thread };
    });
  }

  async function sendMessage(
    threadId: unknown,
    turnInput: { message?: unknown; model?: unknown },
  ): Promise<MainThreadSnapshot> {
    const message = requiredString(turnInput?.message, "message");
    const started = await store.mutate((state) => {
      const thread = beginMainThreadTurn(state, threadId, message);
      return { ...thread };
    });

    try {
      const state = await store.read();
      const thread = findMainThread(state, started.id);
      const project = projectForThread(state.projects, thread);
      const adapter = adapters.get(thread.adapter);
      if (!adapter) {
        throw new Error(
          "main thread adapter is unavailable: " + thread.adapter,
        );
      }

      let taskSource:
        | Awaited<ReturnType<typeof inspectProjectTaskSource>>
        | null = null;
      let taskSourceError: string | null = null;
      try {
        taskSource = await inspectProjectTaskSource(store, project.id);
      } catch (error) {
        taskSourceError =
          error instanceof Error ? error.message : String(error);
      }

      const builderResults = getPendingBuilderResults(
        getMainThreadEvents(state, thread.id),
      );
      const prompt = buildMainThreadPrompt({
        project,
        taskSource,
        taskSourceError,
        builderResults,
        message,
      });
      const adapterInput: MainThreadAdapterTurnInput = {
        projectRoot: project.rootPath,
        message: prompt,
        externalThreadId: thread.externalThreadId,
        model: optionalString(turnInput?.model) ?? thread.model,
        onEvent: async (event) => {
          if (isWriteAttemptEvent(event)) {
            throw new Error(
              thread.adapter +
                " reported a project file-change attempt in a " +
                "read-only main thread",
            );
          }
          await store.mutate((nextState) => {
            appendMainThreadEvent(nextState, thread.id, event);
          });
        },
      };

      const result = await adapter.runTurn(adapterInput);
      if (result.events.some(isWriteAttemptEvent)) {
        throw new Error(
          thread.adapter +
            " reported a project file-change attempt in a read-only " +
            "main thread",
        );
      }

      await store.mutate((nextState) => {
        completeMainThreadTurn(nextState, thread.id, result);
      });
      return getThread(thread.id);
    } catch (error) {
      await store.mutate((state) => {
        failMainThreadTurn(state, started.id, error);
      });
      throw error;
    }
  }

  async function inspectTasks(threadId: unknown) {
    const state = await store.read();
    const thread = findMainThread(state, threadId);
    const source = await inspectProjectTaskSource(store, thread.projectId);
    await store.mutate((nextState) => {
      appendMainThreadEvent(nextState, thread.id, {
        type: "tool",
        tool: {
          name: "task-source.inspect",
          status: "completed",
        },
        text: String(source.tasks.length) + " repository task(s)",
      });
    });
    return source;
  }

  async function resolveTask(threadId: unknown, taskId: unknown) {
    const state = await store.read();
    const thread = findMainThread(state, threadId);
    const task = await resolveProjectTask(
      store,
      thread.projectId,
      taskId,
    );
    await store.mutate((nextState) => {
      appendMainThreadEvent(nextState, thread.id, {
        type: "artifact",
        text: "resolved " + task.id,
        artifact: {
          kind: "task-card-ref",
          ref: task.taskRef,
        },
      });
    });
    return task;
  }

  async function createTask(
    threadId: unknown,
    taskInput: Parameters<typeof createProjectRepositoryTask>[2],
  ) {
    const state = await store.read();
    const thread = findMainThread(state, threadId);
    const task = await createProjectRepositoryTask(
      store,
      thread.projectId,
      taskInput,
    );
    await store.mutate((nextState) => {
      appendMainThreadEvent(nextState, thread.id, {
        type: "tool",
        tool: {
          name: "task-source.create",
          status: "completed",
        },
        text: task.id,
      });
      appendMainThreadEvent(nextState, thread.id, {
        type: "artifact",
        text: "created " + task.id,
        artifact: {
          kind: "task-card-ref",
          ref: task.taskRef,
        },
      });
    });
    return task;
  }

  async function updateTask(
    threadId: unknown,
    taskId: unknown,
    patch: Parameters<typeof updateProjectRepositoryTask>[3],
  ) {
    const state = await store.read();
    const thread = findMainThread(state, threadId);
    const task = await updateProjectRepositoryTask(
      store,
      thread.projectId,
      taskId,
      patch,
    );
    await store.mutate((nextState) => {
      appendMainThreadEvent(nextState, thread.id, {
        type: "tool",
        tool: {
          name: "task-source.update",
          status: "completed",
        },
        text: task.id,
      });
      appendMainThreadEvent(nextState, thread.id, {
        type: "artifact",
        text: "updated " + task.id,
        artifact: {
          kind: "task-card-ref",
          ref: task.taskRef,
        },
      });
    });
    return task;
  }

  async function createHandoff(
    threadId: unknown,
    handoffInput: {
      taskId?: unknown;
      taskRef?: unknown;
      preferredBuilder?: unknown;
    },
  ) {
    const state = await store.read();
    const thread = findMainThread(state, threadId);
    const taskId = requiredString(handoffInput?.taskId, "taskId");
    const preferredBuilder = requiredString(
      handoffInput?.preferredBuilder,
      "preferredBuilder",
    );
    const task = await resolveProjectTask(
      store,
      thread.projectId,
      taskId,
    );
    const requestedRef = optionalString(handoffInput?.taskRef);
    if (requestedRef && requestedRef !== task.taskRef) {
      throw new Error(
        "handoff taskRef does not match repository task reference: " +
          task.taskRef,
      );
    }

    return store.mutate((nextState) =>
      createMainThreadHandoff(nextState, thread.id, {
        projectId: thread.projectId,
        taskId: task.id,
        taskRef: task.taskRef,
        preferredBuilder,
      }),
    );
  }

  async function reconcile() {
    return store.mutate((state) => reconcileMainThreads(state));
  }

  async function shutdown() {
    const disposals = [...adapters.values()]
      .filter((adapter) => typeof adapter.dispose === "function")
      .map((adapter) => adapter.dispose!());
    const settled = await Promise.allSettled(disposals);
    const errors = settled
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "Main Thread adapter shutdown failed",
      );
    }
  }

  return {
    listThreads,
    getThread,
    openThread,
    sendMessage,
    inspectTasks,
    resolveTask,
    createTask,
    updateTask,
    createHandoff,
    reconcile,
    shutdown,
  };
}
