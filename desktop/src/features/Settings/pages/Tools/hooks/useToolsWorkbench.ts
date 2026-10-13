import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { message } from "@/shared/ui/Message";
import {
  executeMcpInvocationStream,
  getMcpInvocationTrace,
  getMcpTools,
  getMcpWorkspaceSelection,
  resetMcpCapabilityFixture,
  resolveMcpInvocationApproval,
  selectMcpWorkspaceRoot,
  type HarnessToolDefinition,
  type ToolArtifact,
  type ToolInvocation,
  type ToolInvocationEvent,
  type ToolTrace,
} from "@/shared/api/tools";
import {
  useWebSearchConfig,
} from "@/features/Settings/hooks/useWebSearchConfig";
import type {
  ToolGroupSummary,
  ToolWorkbenchGroupId,
  ToolWorkbenchHandoff,
  WorkbenchToolDefinition,
} from "../types";
import {
  buildToolDraft,
  findPrimaryArtifact,
  getToolGroups,
  formatToolGroup,
  getTerminalResultSummary,
} from "../utils";
const isWorkbenchTool = (tool: HarnessToolDefinition): tool is WorkbenchToolDefinition =>
  tool.source === "internal" && Boolean(tool.workbench?.groupId);

export function useToolsWorkbench(
  initialHandoff?: ToolWorkbenchHandoff | null,
  handoffKey = "initial",
) {
  const { t } = useTranslation();
  const [activeGroupId, setActiveGroupId] = useState<ToolWorkbenchGroupId | null>(null);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [argsDraft, setArgsDraft] = useState("{}");
  const [tools, setTools] = useState<WorkbenchToolDefinition[]>([]);
  const [workspaceSelection, setWorkspaceSelection] = useState<Awaited<
    ReturnType<typeof getMcpWorkspaceSelection>
  > | null>(null);
  const [workspaceRootInput, setWorkspaceRootInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true);
  const [isSelectingWorkspace, setIsSelectingWorkspace] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const webSearchConfigState = useWebSearchConfig();
  const [events, setEvents] = useState<ToolInvocationEvent[]>([]);
  const [trace, setTrace] = useState<ToolTrace | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [artifacts, setArtifacts] = useState<ToolArtifact[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<
    "idle" | "completed" | "failed" | "cancelled" | "awaiting_approval"
  >("idle");
  const [pendingApproval, setPendingApproval] = useState<{
    invocationId: string;
    toolId: string;
    args: Record<string, unknown>;
  } | null>(null);
  const [terminalContinuation, setTerminalContinuation] = useState<{
    continuationId: string;
    nextOutputOffset: number;
    outputLimitBytes?: number;
  } | null>(null);
  const [activeCase, setActiveCase] = useState<{
    id: string;
    fixture?: string;
  } | null>(null);

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      setIsLoading(true);
      setIsWorkspaceLoading(true);
      try {
        const [toolList, workspace] = await Promise.all([
          getMcpTools(),
          getMcpWorkspaceSelection(),
        ]);
        if (disposed) {
          return;
        }

        const sortedTools = [...toolList]
          .filter(isWorkbenchTool)
          .sort((left, right) =>
          left.title.localeCompare(right.title, undefined, { numeric: true }),
          );
        setTools(sortedTools);
        setWorkspaceSelection(workspace);
        setWorkspaceRootInput(workspace.rootPath ?? "");
        const handoff = initialHandoff ?? null;
        const requestedTool = handoff
          ? sortedTools.find((tool) => tool.id === handoff.toolId) ?? null
          : null;
        const nextActiveGroupId =
          requestedTool?.workbench.groupId ?? getToolGroups(sortedTools)[0] ?? null;
        const nextSelectedTool =
          requestedTool ??
          (nextActiveGroupId
            ? sortedTools.find((tool) => tool.workbench.groupId === nextActiveGroupId) ?? null
            : null);

        if (nextSelectedTool) {
          setSelectedToolId(nextSelectedTool.id);
          setActiveGroupId(nextActiveGroupId);
          setArgsDraft(
            requestedTool && handoff
              ? JSON.stringify(handoff.args, null, 2)
              : buildToolDraft(nextSelectedTool),
          );
        }
      } catch (error) {
        if (!disposed) {
          message.error(
            error instanceof Error ? error.message : t("settings.tools.messages.loadFailed"),
          );
        }
      } finally {
        if (!disposed) {
          setIsLoading(false);
          setIsWorkspaceLoading(false);
        }
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  }, [handoffKey, initialHandoff, t]);

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === selectedToolId) ?? null,
    [selectedToolId, tools],
  );

  const groupedTools = useMemo(
    () =>
      getToolGroups(tools).map((groupId) => ({
        groupId,
        tools: tools.filter((tool) => tool.workbench.groupId === groupId),
      })),
    [tools],
  );

  const groupSummaries = useMemo<ToolGroupSummary[]>(
    () =>
      groupedTools.map(({ groupId, tools: groupTools }) => {
        const metadata = groupTools[0]?.workbench;
        return {
          id: groupId,
          count: groupTools.length,
          label: metadata?.groupLabel ?? formatToolGroup(groupId),
          description: metadata?.groupDescription ?? "",
          order: metadata?.groupOrder ?? Number.MAX_SAFE_INTEGER,
          icon: metadata?.icon ?? "wrench",
        };
      }),
    [groupedTools],
  );

  const filteredTools = useMemo(
    () => tools.filter((tool) => tool.workbench.groupId === activeGroupId),
    [activeGroupId, tools],
  );

  const primaryArtifact = useMemo(() => findPrimaryArtifact(artifacts), [artifacts]);

  const resetRunState = () => {
    setEvents([]);
    setTrace(null);
    setResult(null);
    setArtifacts([]);
    setRunError(null);
    setRunStatus("idle");
    setPendingApproval(null);
  };

  const rememberTerminalContinuation = (value: unknown) => {
    const summary = getTerminalResultSummary(value);
    if (
      summary?.continuationId &&
      typeof summary.nextOutputOffset === "number"
    ) {
      setTerminalContinuation({
        continuationId: summary.continuationId,
        nextOutputOffset: summary.nextOutputOffset,
        ...(summary.outputLimitBytes
          ? { outputLimitBytes: summary.outputLimitBytes }
          : {}),
      });
    }
  };

  const appendEvent = (event: ToolInvocationEvent) => {
    setEvents((current) => [...current, event]);

    if (event.type === "invocation:artifact") {
      setArtifacts((current) => [...current, event.artifact]);
    }

    if (event.type === "invocation:result") {
      setResult(event.result);
      rememberTerminalContinuation(event.result);
    }

    if (event.type === "invocation:error") {
      setRunError(event.message);
      setRunStatus("failed");
    }

    if (event.type === "invocation:approval_required") {
      setRunError(event.message);
      setRunStatus("awaiting_approval");
    }

    if (event.type === "invocation:finish") {
      setRunStatus(event.status);
    }
  };

  const selectTool = (tool: WorkbenchToolDefinition) => {
    setTerminalContinuation(null);
    setActiveCase(null);
    setSelectedToolId(tool.id);
    setActiveGroupId(tool.workbench.groupId);
    setArgsDraft(buildToolDraft(tool));
    resetRunState();
  };

  const terminalSummary = useMemo(() => getTerminalResultSummary(result), [result]);

  const updateWorkspaceRoot = async () => {
    const nextRootPath = workspaceRootInput.trim();
    if (!nextRootPath) {
      message.error(t("settings.tools.messages.workspaceRootRequired"));
      return;
    }

    setIsSelectingWorkspace(true);
    try {
      const nextSelection = await selectMcpWorkspaceRoot(nextRootPath);
      setWorkspaceSelection(nextSelection);
      setWorkspaceRootInput(nextSelection.rootPath ?? "");
      message.success(t("settings.tools.messages.workspaceUpdated"));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("settings.tools.messages.workspaceUpdateFailed"),
      );
    } finally {
      setIsSelectingWorkspace(false);
    }
  };

  const applyResolvedInvocation = async (invocation: ToolInvocation) => {
    setResult(invocation.result ?? null);
    rememberTerminalContinuation(invocation.result);
    setArtifacts(invocation.artifacts ?? []);
    setRunError(invocation.error?.message ?? null);

    if (
      invocation.status === "completed" ||
      invocation.status === "failed" ||
      invocation.status === "cancelled" ||
      invocation.status === "awaiting_approval"
    ) {
      setRunStatus(invocation.status);
    }

    const at = new Date().toISOString();
    const syntheticEvents: ToolInvocationEvent[] = [
      ...(invocation.artifacts ?? []).map(
        (artifact): ToolInvocationEvent => ({
          type: "invocation:artifact",
          invocationId: invocation.id,
          artifact,
          at,
        }),
      ),
      ...(invocation.result !== undefined
        ? [
            {
              type: "invocation:result" as const,
              invocationId: invocation.id,
              result: invocation.result,
              at,
            },
          ]
        : []),
      ...(invocation.status === "completed" ||
      invocation.status === "failed" ||
      invocation.status === "cancelled"
        ? [
            {
              type: "invocation:finish" as const,
              invocationId: invocation.id,
              status: invocation.status,
              at,
            },
          ]
        : []),
    ];
    setEvents((current) => [...current, ...syntheticEvents]);

    const nextTrace = await getMcpInvocationTrace(invocation.id).catch(() => null);
    if (nextTrace) {
      setTrace(nextTrace);
    }
  };

  const executeToolArgs = async (args: Record<string, unknown>) => {
    if (!selectedTool) {
      message.error(t("settings.tools.messages.selectToolFirst"));
      return;
    }

    const caseFixture = activeCase?.fixture ?? null;
    if (
      selectedTool.capabilities.workspaceBound &&
      !caseFixture &&
      !workspaceSelection?.rootPath
    ) {
      message.error(t("settings.tools.messages.workspaceRootRequired"));
      return;
    }

    resetRunState();
    setIsRunning(true);
    try {
      if (caseFixture) {
        await resetMcpCapabilityFixture(caseFixture);
      }

      let invocationId = "";
      await executeMcpInvocationStream(
        {
          toolId: selectedTool.id,
          args,
          ...(caseFixture
            ? { workspaceContext: "tool_lab_managed" as const }
            : {}),
        },
        async (event) => {
          if (event.type === "invocation:done") {
            return;
          }
          if (!invocationId && event.type === "invocation:start") {
            invocationId = event.invocationId;
          }
          if (event.type === "invocation:approval_required" && invocationId) {
            setPendingApproval({
              invocationId,
              toolId: selectedTool.id,
              args,
            });
          }
          appendEvent(event);
        },
      );

      if (invocationId) {
        const nextTrace = await getMcpInvocationTrace(invocationId);
        setTrace(nextTrace);
      }
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("settings.tools.messages.runFailed"),
      );
    } finally {
      setIsRunning(false);
    }
  };

  const runSelectedTool = async () => {
    if (!selectedTool) {
      message.error(t("settings.tools.messages.selectToolFirst"));
      return;
    }

    if (
      selectedTool.id === "web_search" &&
      (webSearchConfigState.isLoading ||
        webSearchConfigState.isSaving ||
        Boolean(webSearchConfigState.loadError))
    ) {
      return;
    }

    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(argsDraft) as Record<string, unknown>;
    } catch {
      message.error(t("settings.tools.messages.invalidArgsJson"));
      return;
    }

    if (selectedTool.id === "web_search") {
      parsedArgs = {
        ...parsedArgs,
        maxResults: webSearchConfigState.config.maxResults,
      };
    }

    if (selectedTool.id === "terminal") {
      setTerminalContinuation(null);
    }
    await executeToolArgs(parsedArgs);
  };

  const resolvePendingApproval = async (decision: "approved" | "rejected") => {
    if (!pendingApproval) {
      return;
    }

    setIsRunning(true);
    try {
      const resolution = await resolveMcpInvocationApproval(
        pendingApproval.invocationId,
        {
          decision,
          toolId: pendingApproval.toolId,
          args: pendingApproval.args,
        },
      );
      setPendingApproval(null);
      await applyResolvedInvocation(
        resolution.resumedInvocation ?? resolution.originalInvocation,
      );
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : t("settings.tools.messages.approvalFailed"),
      );
    } finally {
      setIsRunning(false);
    }
  };

  const runTerminalArgs = async (args: Record<string, unknown>) => {
    setArgsDraft(JSON.stringify(args, null, 2));
    await executeToolArgs(args);
  };

  const runTerminalContinuation = async () => {
    if (!terminalContinuation) return;
    await runTerminalArgs({
      continuationId: terminalContinuation.continuationId,
      outputOffset: terminalContinuation.nextOutputOffset,
      ...(terminalContinuation.outputLimitBytes
        ? { outputLimitBytes: terminalContinuation.outputLimitBytes }
        : {}),
    });
  };

  const runTerminalStatus = async () => {
    if (!terminalSummary?.sessionId) return;
    await runTerminalArgs({
      operation: "status",
      sessionId: terminalSummary.sessionId,
    });
  };

  const runTerminalStop = async () => {
    if (!terminalSummary?.sessionId) return;
    await runTerminalArgs({
      operation: "stop",
      sessionId: terminalSummary.sessionId,
    });
  };

  const selectGroup = (groupId: ToolWorkbenchGroupId) => {
    setTerminalContinuation(null);
    setActiveCase(null);
    setActiveGroupId(groupId);
    const nextTool = tools.find((tool) => tool.workbench.groupId === groupId) ?? null;
    if (nextTool) {
      setSelectedToolId(nextTool.id);
      setArgsDraft(buildToolDraft(nextTool));
    } else {
      setSelectedToolId(null);
      setArgsDraft("{}");
    }
    resetRunState();
  };

  return {
    activeCase,
    activeGroupId,
    argsDraft,
    artifacts,
    groupSummaries,
    events,
    filteredTools,
    groupedTools,
    isLoading: isLoading || webSearchConfigState.isLoading,
    isRunning,
    isSelectingWorkspace,
    isWorkspaceLoading,
    primaryArtifact,
    result,
    pendingApproval,
    terminalContinuation,
    runError,
    runStatus,
    selectedTool,
    requiresWorkspace: Boolean(selectedTool?.capabilities.workspaceBound),
    terminalSummary,
    trace,
    tools,
    webSearchConfig: webSearchConfigState.config,
    webSearchConfigLoading: webSearchConfigState.isLoading,
    webSearchConfigSaving: webSearchConfigState.isSaving,
    webSearchConfigLoadError: webSearchConfigState.loadError,
    workspaceRootInput: selectedTool?.capabilities.workspaceBound
      ? workspaceRootInput
      : "",
    workspaceSelection: selectedTool?.capabilities.workspaceBound
      ? workspaceSelection
      : null,
    setArgsDraft,
    setWebSearchConfig: webSearchConfigState.setConfig,
    setWorkspaceRootInput,
    runSelectedTool,
    runTerminalContinuation,
    runTerminalStatus,
    runTerminalStop,
    resolvePendingApproval,
    selectGroup,
    selectTool,
    selectCase: (
      args: Record<string, unknown>,
      caseMeta?: { id: string; fixture?: string },
    ) => {
      setTerminalContinuation(null);
      setActiveCase(caseMeta ?? null);
      setArgsDraft(JSON.stringify(args, null, 2));
      resetRunState();
    },
    updateWorkspaceRoot,
    saveWebSearchConfig: webSearchConfigState.save,
    reloadWebSearchConfig: webSearchConfigState.reload,
  };
}
