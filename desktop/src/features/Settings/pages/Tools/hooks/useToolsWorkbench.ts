import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { message } from "@/shared/ui/Message";
import {
  executeMcpInvocationStream,
  getMcpInvocationTrace,
  getMcpTools,
  getMcpWebSearchConfig,
  getMcpWorkspaceSelection,
  saveMcpWebSearchConfig,
  selectMcpWorkspaceRoot,
  type HarnessToolDefinition,
  type ToolArtifact,
  type ToolInvocationEvent,
  type ToolTrace,
} from "@/shared/api/tools";
import type {
  ToolGroupSummary,
  ToolWorkbenchGroupId,
  WorkbenchToolDefinition,
} from "../types";
import {
  buildToolDraft,
  findPrimaryArtifact,
  getToolGroups,
  formatToolGroup,
  getTerminalResultSummary,
} from "../utils";
const WEB_SEARCH_DEFAULT_MAX_RESULTS = 4;
const WEB_SEARCH_MIN_RESULTS = 1;
const WEB_SEARCH_MAX_RESULTS = 10;
type WebSearchConfig = {
  apiKey: string;
  baseUrl: string;
  maxResults: number;
};

const defaultWebSearchConfig: WebSearchConfig = {
  apiKey: "",
  baseUrl: "",
  maxResults: WEB_SEARCH_DEFAULT_MAX_RESULTS,
};

const isWorkbenchTool = (tool: HarnessToolDefinition): tool is WorkbenchToolDefinition =>
  tool.source === "internal" && Boolean(tool.workbench?.groupId);

const normalizeWebSearchMaxResults = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return WEB_SEARCH_DEFAULT_MAX_RESULTS;
  }

  return Math.min(
    WEB_SEARCH_MAX_RESULTS,
    Math.max(WEB_SEARCH_MIN_RESULTS, Math.trunc(value)),
  );
};

export function useToolsWorkbench() {
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
  const [webSearchConfig, setWebSearchConfig] = useState<WebSearchConfig>(defaultWebSearchConfig);
  const [events, setEvents] = useState<ToolInvocationEvent[]>([]);
  const [trace, setTrace] = useState<ToolTrace | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [artifacts, setArtifacts] = useState<ToolArtifact[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<
    "idle" | "completed" | "failed" | "cancelled" | "awaiting_approval"
  >(
    "idle",
  );

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      setIsLoading(true);
      setIsWorkspaceLoading(true);
      try {
        const [toolList, workspace, persistedWebSearchConfig] = await Promise.all([
          getMcpTools(),
          getMcpWorkspaceSelection(),
          getMcpWebSearchConfig().catch(() => defaultWebSearchConfig),
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
        setWebSearchConfig({
          apiKey: persistedWebSearchConfig.apiKey ?? "",
          baseUrl: persistedWebSearchConfig.baseUrl ?? "",
          maxResults: normalizeWebSearchMaxResults(persistedWebSearchConfig.maxResults),
        });

        const nextActiveGroupId = getToolGroups(sortedTools)[0] ?? null;
        const nextSelectedTool = nextActiveGroupId
          ? sortedTools.find((tool) => tool.workbench.groupId === nextActiveGroupId) ?? null
          : null;
        if (nextSelectedTool) {
          setSelectedToolId(nextSelectedTool.id);
          setActiveGroupId(nextActiveGroupId);
          setArgsDraft(buildToolDraft(nextSelectedTool));
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
  }, [t]);

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
  };

  const appendEvent = (event: ToolInvocationEvent) => {
    setEvents((current) => [...current, event]);

    if (event.type === "invocation:artifact") {
      setArtifacts((current) => [...current, event.artifact]);
    }

    if (event.type === "invocation:result") {
      setResult(event.result);
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

  const runSelectedTool = async () => {
    if (!selectedTool) {
      message.error(t("settings.tools.messages.selectToolFirst"));
      return;
    }

    if (selectedTool.capabilities.workspaceBound && !workspaceSelection?.rootPath) {
      message.error(t("settings.tools.messages.workspaceRootRequired"));
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
        maxResults: normalizeWebSearchMaxResults(webSearchConfig.maxResults),
      };
    }

    resetRunState();
    setIsRunning(true);
    try {
      let invocationId = "";
      await executeMcpInvocationStream(
        {
          toolId: selectedTool.id,
          args: parsedArgs,
        },
        async (event) => {
          if (!invocationId && event.type === "invocation:start") {
            invocationId = event.invocationId;
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

  const selectGroup = (groupId: ToolWorkbenchGroupId) => {
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
    activeGroupId,
    argsDraft,
    artifacts,
    groupSummaries,
    events,
    filteredTools,
    groupedTools,
    isLoading,
    isRunning,
    isSelectingWorkspace,
    isWorkspaceLoading,
    primaryArtifact,
    result,
    runError,
    runStatus,
    selectedTool,
    requiresWorkspace: Boolean(selectedTool?.capabilities.workspaceBound),
    terminalSummary,
    trace,
    tools,
    webSearchConfig,
    workspaceRootInput: selectedTool?.capabilities.workspaceBound
      ? workspaceRootInput
      : "",
    workspaceSelection: selectedTool?.capabilities.workspaceBound
      ? workspaceSelection
      : null,
    setArgsDraft,
    setWebSearchConfig,
    setWorkspaceRootInput,
    runSelectedTool,
    selectGroup,
    selectTool,
    updateWorkspaceRoot,
    saveWebSearchConfig: async () => {
      const saved = await saveMcpWebSearchConfig(webSearchConfig);
      setWebSearchConfig({
        apiKey: saved.apiKey,
        baseUrl: saved.baseUrl,
        maxResults: normalizeWebSearchMaxResults(saved.maxResults),
      });
      message.success(t("settings.tools.messages.webSearchConfigSaved"));
    },
  };
}
