import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { message } from "@/shared/ui";
import type { ForgeInspectorData } from "@/shared/api/forge/types";
import type {
  ForgeRegisterProjectValues,
  ForgeTask,
} from "../types";
import {
  DesktopForgeProtocol,
  type ForgeDesktopProtocol,
  type ForgeProjectData,
  type ForgeShellData,
} from "../core/protocol";
import { buildForgeWorkspaceSnapshot } from "../core/workspaceModel";

export interface UseForgeWorkspaceOptions {
  protocol?: ForgeDesktopProtocol;
}

interface WorkspaceDataState {
  shell: ForgeShellData | null;
  projectData: ForgeProjectData | null;
  inspector: ForgeInspectorData | null;
}

const defaultMainThreadAdapter = (
  shell: ForgeShellData,
): "opencode" | "codex-desktop" | "codex" => {
  if (shell.meta.mainThreadAdapters.includes("codex-desktop")) {
    return "codex-desktop";
  }
  return shell.meta.mainThreadAdapters[0] ?? "codex";
};

export function useForgeWorkspace(
  options: UseForgeWorkspaceOptions = {},
) {
  const protocol = useMemo(
    () => options.protocol ?? new DesktopForgeProtocol(),
    [options.protocol],
  );
  const [data, setData] = useState<WorkspaceDataState>({
    shell: null,
    projectData: null,
    inspector: null,
  });
  const [selectedProjectId, setSelectedProjectId] =
    useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] =
    useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mainThreadRequestInFlight, setMainThreadRequestInFlight] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const inspectorRequestIdRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const dataRef = useRef(data);
  const selectedProjectIdRef = useRef(selectedProjectId);
  const selectedTaskIdRef = useRef(selectedTaskId);

  dataRef.current = data;
  selectedProjectIdRef.current = selectedProjectId;
  selectedTaskIdRef.current = selectedTaskId;

  const loadInspector = useCallback(
    async (
      projectData: ForgeProjectData | null,
      projectId: string | null,
      taskId: string | null,
    ) => {
      if (!projectData || !projectId || !taskId) return null;

      const matchingBatches = [...projectData.batches]
        .filter((batch) =>
          batch.tasks.some((task) => task.id === taskId),
        )
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        );
      const taskBatch =
        matchingBatches.find(
          (batch) => batch.status !== "integrated",
        ) ??
        matchingBatches[0] ??
        null;
      const dispatch = [...projectData.dispatches]
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        )
        .find((item) => item.taskId === taskId);

      return protocol
        .loadInspector({
          projectId,
          ...(taskBatch ? { batchId: taskBatch.id } : {}),
          taskId,
          ...(dispatch ? { dispatchId: dispatch.id } : {}),
          ...(projectData.threadSnapshot?.thread.id
            ? { threadId: projectData.threadSnapshot.thread.id }
            : {}),
        })
        .catch(() => null);
    },
    [protocol],
  );

  const load = useCallback(
    async ({
      preferredProjectId,
      preferredTaskId,
      quiet = false,
    }: {
      preferredProjectId?: string | null;
      preferredTaskId?: string | null;
      quiet?: boolean;
    } = {}) => {
      if (refreshInFlightRef.current && quiet) return;
      refreshInFlightRef.current = true;
      const requestId = ++requestIdRef.current;
      if (!quiet) setLoading(true);

      try {
        const shell = await protocol.loadShell();
        const projectId =
          shell.projects.find(
            (project) =>
              project.id ===
              (preferredProjectId ??
                selectedProjectIdRef.current),
          )?.id ??
          shell.projects[0]?.id ??
          null;

        const existingThreadId =
          projectId === dataRef.current.projectData?.projectId
            ? dataRef.current.projectData.threadSnapshot?.thread.id
            : null;
        const projectData = projectId
          ? await protocol.loadProject(projectId, existingThreadId)
          : null;

        const availableTaskIds = new Set([
          ...(projectData?.taskSource?.tasks.map((task) => task.id) ??
            []),
          ...(projectData?.batches.flatMap((batch) =>
            batch.tasks.map((task) => task.id),
          ) ?? []),
        ]);
        const taskIdCandidate =
          preferredTaskId ??
          selectedTaskIdRef.current;
        const taskId =
          taskIdCandidate &&
          availableTaskIds.has(taskIdCandidate)
            ? taskIdCandidate
            : [...availableTaskIds][0] ?? null;
        const inspector = await loadInspector(
          projectData,
          projectId,
          taskId,
        );

        if (requestId !== requestIdRef.current) return;

        inspectorRequestIdRef.current += 1;
        setSelectedProjectId(projectId);
        setSelectedTaskId(taskId);
        setData({ shell, projectData, inspector });
        setError(null);
      } catch (loadError) {
        if (requestId !== requestIdRef.current) return;
        const detail =
          loadError instanceof Error
            ? loadError.message
            : String(loadError);
        setError(detail);
        if (!quiet) message.error(detail);
      } finally {
        if (requestId === requestIdRef.current && !quiet) {
          setLoading(false);
        }
        refreshInFlightRef.current = false;
      }
    },
    [loadInspector, protocol],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const snapshot = useMemo(
    () =>
      data.shell
        ? buildForgeWorkspaceSnapshot({
            shell: data.shell,
            projectData: data.projectData,
            selectedProjectId,
            selectedTaskId,
            inspector: data.inspector,
          })
        : null,
    [
      data.inspector,
      data.projectData,
      data.shell,
      selectedProjectId,
      selectedTaskId,
    ],
  );

  const selectProject = useCallback(
    async (projectId: string) => {
      setSelectedProjectId(projectId);
      setSelectedTaskId(null);
      await load({
        preferredProjectId: projectId,
        preferredTaskId: null,
      });
    },
    [load],
  );

  const selectTask = useCallback(
    async (taskId: string) => {
      const requestId = ++inspectorRequestIdRef.current;
      setSelectedTaskId(taskId);
      selectedTaskIdRef.current = taskId;
      const projectData = dataRef.current.projectData;
      const projectId = selectedProjectIdRef.current;
      const inspector = await loadInspector(
        projectData,
        projectId,
        taskId,
      );
      if (requestId === inspectorRequestIdRef.current) {
        setData((current) => ({ ...current, inspector }));
      }
    },
    [loadInspector],
  );

  const registerProject = useCallback(
    async (values: ForgeRegisterProjectValues) => {
      setBusy(true);
      try {
        if (
          Boolean(values.taskLedger?.trim()) !==
          Boolean(values.taskDir?.trim())
        ) {
          throw new Error(
            "Task Ledger 与 Task Directory 必须同时填写或同时留空。",
          );
        }
        const result = await protocol.registerProject({
          name: values.name.trim(),
          rootPath: values.repositoryPath.trim(),
          integrationBranch: values.branch.trim(),
          ...(values.taskLedger?.trim()
            ? {
                taskLedger: values.taskLedger.trim(),
                taskDir: values.taskDir?.trim() ?? "",
              }
            : {}),
        });
        await load({
          preferredProjectId: result.project.id,
          preferredTaskId: null,
        });
        message.success("项目已注册到淬行");
      } catch (actionError) {
        const detail =
          actionError instanceof Error
            ? actionError.message
            : String(actionError);
        message.error(detail);
        throw actionError;
      } finally {
        setBusy(false);
      }
    },
    [load, protocol],
  );

  const ensureMainThread = useCallback(async () => {
    const current = dataRef.current;
    const projectId = selectedProjectIdRef.current;
    if (!current.shell || !projectId) {
      throw new Error("当前没有可用项目");
    }

    const existing = current.projectData?.threadSnapshot?.thread;
    if (existing) return existing;

    const thread = await protocol.openThread({
      projectId,
      adapter: defaultMainThreadAdapter(current.shell),
    });
    const projectData = await protocol.loadProject(
      projectId,
      thread.id,
    );
    setData((value) => ({ ...value, projectData }));
    return thread;
  }, [protocol]);

  const sendMessage = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text) return;
      setBusy(true);
      try {
        const thread = await ensureMainThread();
        setMainThreadRequestInFlight(true);
        const threadSnapshot = await protocol.sendMessage(
          thread.id,
          text,
        );
        setData((current) =>
          current.projectData
            ? {
                ...current,
                projectData: {
                  ...current.projectData,
                  threadSnapshot,
                },
              }
            : current,
        );
        await load({
          preferredProjectId: selectedProjectIdRef.current,
          preferredTaskId: selectedTaskIdRef.current,
          quiet: true,
        });
      } catch (actionError) {
        const detail =
          actionError instanceof Error
            ? actionError.message
            : String(actionError);
        message.error(detail);
        throw actionError;
      } finally {
        setMainThreadRequestInFlight(false);
        setBusy(false);
      }
    },
    [ensureMainThread, load, protocol],
  );

  const dispatchTask = useCallback(
    async (
      task: ForgeTask,
      builder: "opencode" | "piagent" | "codex",
    ) => {
      const projectId = selectedProjectIdRef.current;
      if (!projectId) throw new Error("当前没有可用项目");
      setBusy(true);
      try {
        const thread = await ensureMainThread();
        const batchId =
          task.batchId ??
          (await protocol.createBatch(projectId, task.id)).id;
        await protocol.dispatchTask(batchId, task.id, {
          builder,
          sourceThreadId: thread.id,
          ...(task.source !== "Repository task unavailable"
            ? { taskRef: task.source }
            : {}),
        });
        await load({
          preferredProjectId: projectId,
          preferredTaskId: task.id,
        });
        message.success(`${task.id} 已派发给 Builder`);
      } catch (actionError) {
        const detail =
          actionError instanceof Error
            ? actionError.message
            : String(actionError);
        message.error(detail);
        throw actionError;
      } finally {
        setBusy(false);
      }
    },
    [ensureMainThread, load, protocol],
  );

  const cancelDispatch = useCallback(
    async (dispatchId: string) => {
      setBusy(true);
      try {
        await protocol.cancelDispatch(dispatchId);
        await load({
          preferredProjectId: selectedProjectIdRef.current,
          preferredTaskId: selectedTaskIdRef.current,
        });
        message.success("已发送 Builder 取消请求");
      } catch (actionError) {
        const detail =
          actionError instanceof Error
            ? actionError.message
            : String(actionError);
        message.error(detail);
        throw actionError;
      } finally {
        setBusy(false);
      }
    },
    [load, protocol],
  );

  const integrateTask = useCallback(
    async (task: ForgeTask) => {
      const projectId = selectedProjectIdRef.current;
      if (
        !projectId ||
        !task.batchId ||
        !task.currentSha ||
        task.currentSha !== task.reviewedSha
      ) {
        throw new Error(
          "只有同一 SHA 已通过 Review 的 runtime task 才能确认 integrated。",
        );
      }
      setBusy(true);
      try {
        await protocol.integrateTask(
          projectId,
          task.batchId,
          task.id,
          task.currentSha,
        );
        await load({
          preferredProjectId: projectId,
          preferredTaskId: task.id,
        });
        message.success(`${task.id} 已确认 integrated`);
      } catch (actionError) {
        const detail =
          actionError instanceof Error
            ? actionError.message
            : String(actionError);
        message.error(detail);
        throw actionError;
      } finally {
        setBusy(false);
      }
    },
    [load, protocol],
  );

  useEffect(() => {
    const live =
      mainThreadRequestInFlight ||
      (snapshot?.activeRuntimeCount ?? 0) > 0 ||
      data.projectData?.threadSnapshot?.thread.status === "running";
    if (!live) return;

    const timer = window.setInterval(() => {
      void load({
        preferredProjectId: selectedProjectIdRef.current,
        preferredTaskId: selectedTaskIdRef.current,
        quiet: true,
      });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [
    data.projectData?.threadSnapshot?.thread.status,
    load,
    mainThreadRequestInFlight,
    snapshot?.activeRuntimeCount,
  ]);

  return {
    snapshot,
    loading,
    busy,
    error,
    refresh: () =>
      load({
        preferredProjectId: selectedProjectIdRef.current,
        preferredTaskId: selectedTaskIdRef.current,
      }),
    selectProject,
    selectTask,
    registerProject,
    sendMessage,
    dispatchTask,
    cancelDispatch,
    integrateTask,
  };
}

export default useForgeWorkspace;
