import type {
  ForgeBatch,
  ForgeInspectorData,
  ForgeMainThreadEvent,
  ForgeRepositoryTask,
} from "@/shared/api/forge/types";
import type {
  ForgeBuilderResultHandoff,
  ForgeEvent,
  ForgeInspectorView,
  ForgeMessage,
  ForgeProject,
  ForgeRuntimeRecord,
  ForgeTask,
  ForgeWorkspaceSnapshot,
} from "../types";
import type {
  ForgeProjectData,
  ForgeShellData,
} from "./protocol";

export interface ForgeWorkspaceModelInput {
  shell: ForgeShellData;
  projectData: ForgeProjectData | null;
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  inspector: ForgeInspectorData | null;
}

const ACTIVE_DISPATCH = new Set(["starting", "running"]);
const ATTENTION_TASK = new Set(["fixing", "interrupted", "stale"]);
const ATTENTION_DISPATCH = new Set(["failed", "interrupted"]);

const newest = <T extends { updatedAt: string }>(items: T[]) =>
  [...items].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

const displayTime = (value: string) => {
  const match = value.match(/T(\d{2}:\d{2}:\d{2})/);
  return match?.[1] ?? value;
};

const projectCounts = (
  shell: ForgeShellData,
  projectId: string,
) => {
  const dispatches = shell.dispatches.filter(
    (dispatch) => dispatch.projectId === projectId,
  );
  const tasks = shell.batches
    .filter((batch) => batch.projectId === projectId)
    .flatMap((batch) => batch.tasks);

  return {
    activeRuntimeCount: dispatches.filter((dispatch) =>
      ACTIVE_DISPATCH.has(dispatch.status),
    ).length,
    attentionCount:
      tasks.filter((task) => ATTENTION_TASK.has(task.status)).length +
      dispatches.filter((dispatch) =>
        ATTENTION_DISPATCH.has(dispatch.status),
      ).length,
  };
};

const mapProjects = (shell: ForgeShellData): ForgeProject[] =>
  shell.projects.map((project) => ({
    id: project.id,
    name: project.name,
    repositoryPath: project.rootPath,
    branch: project.integrationBranch,
    ...projectCounts(shell, project.id),
  }));

const parseBuilderResult = (
  event: ForgeMainThreadEvent,
): ForgeBuilderResultHandoff | null => {
  const handoff = event.handoff;
  if (!handoff || handoff.kind !== "builder_result") return null;

  const readString = (key: string) =>
    typeof handoff[key] === "string" ? (handoff[key] as string) : null;

  const taskId = readString("taskId");
  const adapterId = readString("adapterId");
  const dispatchId = readString("dispatchId");
  const dispatchStatus = readString("dispatchStatus");
  const taskStatus = readString("taskStatus");
  if (
    !taskId ||
    !adapterId ||
    !dispatchId ||
    !dispatchStatus ||
    !taskStatus
  ) {
    return null;
  }

  return {
    taskId,
    adapterId,
    dispatchId,
    dispatchStatus,
    taskStatus,
    sessionStatus: readString("sessionStatus"),
    resultText: readString("resultText"),
    error: readString("error"),
  };
};

const mapMessages = (
  events: ForgeMainThreadEvent[],
): ForgeMessage[] =>
  events.flatMap<ForgeMessage>((event) => {
    const result = parseBuilderResult(event);
    if (result) {
      const body =
        result.resultText ??
        result.error ??
        `Builder ${result.dispatchStatus}`;
      return [
        {
          id: event.id,
          kind: "builder-result",
          author: "mira",
          body,
          createdAt: displayTime(event.createdAt),
          handoff: result,
        },
      ];
    }

    if (event.type === "message" && event.text) {
      return [
        {
          id: event.id,
          kind: "message",
          author:
            event.role === "user"
              ? "operator"
              : event.role === "assistant"
                ? "mira"
                : "system",
          body: event.text,
          createdAt: displayTime(event.createdAt),
        },
      ];
    }

    return [];
  });

const runtimeBatchForTask = (
  batches: ForgeBatch[],
  taskId: string,
) => {
  const matching = newest(
    batches.filter((batch) =>
      batch.tasks.some((task) => task.id === taskId),
    ),
  );
  return (
    matching.find((batch) => batch.status !== "integrated") ??
    matching[0] ??
    null
  );
};

const mapTask = (
  repositoryTask: ForgeRepositoryTask | null,
  taskId: string,
  projectData: ForgeProjectData,
): ForgeTask => {
  const batch = runtimeBatchForTask(projectData.batches, taskId);
  const runtimeTask =
    batch?.tasks.find((task) => task.id === taskId) ?? null;
  const readiness = batch
    ? projectData.readiness.find((item) => item.batchId === batch.id)
    : null;
  const readinessFailure = batch
    ? projectData.readinessFailures.find((item) => item.batchId === batch.id)
    : null;
  const ready = readiness?.ready.find((item) => item.taskId === taskId);
  const blocked = readiness?.blocked.find(
    (item) => item.taskId === taskId,
  );

  const readinessState: ForgeTask["readiness"] =
    !repositoryTask
      ? "unavailable"
      : runtimeTask?.status === "stale"
        ? "stale"
        : !batch
          ? "ready"
          : ready
            ? "ready"
            : blocked
              ? "blocked"
              : "unavailable";

  return {
    id: taskId,
    title:
      repositoryTask?.title ??
      runtimeTask?.title ??
      taskId,
    batchId: batch?.id ?? null,
    repositoryState:
      repositoryTask?.cardStatus ??
      repositoryTask?.status ??
      "UNKNOWN",
    repositoryLedgerState:
      repositoryTask?.status ?? "UNKNOWN",
    runtimeState: runtimeTask?.status ?? "waiting",
    source: repositoryTask?.taskRef ?? "Repository task unavailable",
    dependencies: runtimeTask?.dependsOn ?? [],
    readiness: readinessState,
    readinessReasons: readinessFailure
      ? [`readiness_check_failed: ${readinessFailure.error}`]
      : blocked?.reasons.map((reason) => reason.code) ?? [],
    warnings: repositoryTask?.warnings ?? [],
    currentSha: runtimeTask?.currentSha ?? null,
    reviewedSha: runtimeTask?.reviewedSha ?? null,
  };
};

const mapTasks = (projectData: ForgeProjectData): ForgeTask[] => {
  const repositoryTasks = projectData.taskSource?.tasks ?? [];
  const repositoryById = new Map(
    repositoryTasks.map((task) => [task.id, task]),
  );
  const runtimeIds = projectData.batches.flatMap((batch) =>
    batch.tasks.map((task) => task.id),
  );
  const ids = [
    ...new Set([
      ...repositoryTasks.map((task) => task.id),
      ...runtimeIds,
    ]),
  ];

  return ids.map((taskId) =>
    mapTask(repositoryById.get(taskId) ?? null, taskId, projectData),
  );
};

const mapRuntimes = (
  projectData: ForgeProjectData,
): ForgeRuntimeRecord[] =>
  newest(projectData.dispatches).map((dispatch) => ({
    id: dispatch.id,
    taskId: dispatch.taskId,
    builder: dispatch.adapterId,
    state: dispatch.status,
    sourceThreadId: dispatch.sourceThreadId,
    externalSessionId: dispatch.externalSessionId,
    ...(dispatch.error ? { error: dispatch.error } : {}),
    ...(dispatch.resultText
      ? { summary: dispatch.resultText }
      : dispatch.error
        ? { summary: dispatch.error }
        : {}),
  }));

const mapEvents = (
  projectData: ForgeProjectData,
): ForgeEvent[] =>
  projectData.events.map((event) => ({
    id: event.id,
    timestamp: displayTime(event.createdAt),
    kind: event.type,
    message:
      typeof event.data.message === "string"
        ? event.data.message
        : event.type,
    ...(event.taskId ? { taskId: event.taskId } : {}),
  }));

const mapInspector = (
  inspector: ForgeInspectorData | null,
): ForgeInspectorView | null => {
  if (!inspector) return null;

  const detailLines = [
    inspector.project
      ? `Project · ${inspector.project.name}`
      : null,
    inspector.batch
      ? `Batch · ${inspector.batch.id} · ${inspector.batch.status}`
      : null,
    inspector.task
      ? `Task · ${inspector.task.id} · ${inspector.task.status}`
      : null,
    inspector.dispatch
      ? `Dispatch · ${inspector.dispatch.id} · ${inspector.dispatch.status}`
      : null,
    inspector.session
      ? `Session · ${inspector.session.id} · ${inspector.session.status}`
      : null,
    inspector.review
      ? `Review · round ${inspector.review.round} · ${inspector.review.status}`
      : null,
    inspector.thread
      ? `Main Thread · ${inspector.thread.adapter} · ${inspector.thread.status}`
      : null,
  ].filter((line): line is string => Boolean(line));

  return {
    taskId: inspector.task?.id ?? null,
    dispatchId: inspector.dispatch?.id ?? null,
    sessionId: inspector.session?.id ?? null,
    reviewStatus: inspector.review?.status ?? null,
    reviewedSha: inspector.task?.reviewedSha ?? null,
    currentSha: inspector.task?.currentSha ?? null,
    detailLines,
  };
};

export function buildForgeWorkspaceSnapshot(
  input: ForgeWorkspaceModelInput,
): ForgeWorkspaceSnapshot {
  const projects = mapProjects(input.shell);
  const projectData =
    input.projectData?.projectId === input.selectedProjectId
      ? input.projectData
      : null;
  const tasks = projectData ? mapTasks(projectData) : [];
  const selectedTaskId =
    tasks.find((task) => task.id === input.selectedTaskId)?.id ??
    tasks[0]?.id;
  const selectedProjectId =
    projects.find((project) => project.id === input.selectedProjectId)?.id ??
    projects[0]?.id;

  const projectRuntimeCounts = selectedProjectId
    ? projectCounts(input.shell, selectedProjectId)
    : { activeRuntimeCount: 0, attentionCount: 0 };

  return {
    projects,
    ...(selectedProjectId ? { selectedProjectId } : {}),
    tasks,
    ...(selectedTaskId ? { selectedTaskId } : {}),
    ...(projectData?.threadSnapshot?.thread.id
      ? { selectedThreadId: projectData.threadSnapshot.thread.id }
      : {}),
    mainThread: projectData?.threadSnapshot
      ? {
          adapter: projectData.threadSnapshot.thread.adapter,
          status: projectData.threadSnapshot.thread.status,
        }
      : null,
    messages: mapMessages(projectData?.threadSnapshot?.events ?? []),
    runtimes: projectData ? mapRuntimes(projectData) : [],
    events: projectData ? mapEvents(projectData) : [],
    inspector: mapInspector(input.inspector),
    activeRuntimeCount: projectRuntimeCounts.activeRuntimeCount,
    attentionCount: projectRuntimeCounts.attentionCount,
    builderChoices: input.shell.meta.builderChoices,
    mainThreadAdapters: input.shell.meta.mainThreadAdapters,
    taskSourceError: projectData?.taskSourceError ?? null,
  };
}
