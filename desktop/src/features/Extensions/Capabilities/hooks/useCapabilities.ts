import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  executeMcpInvocationStream,
  getExternalMcpServers,
  getMcpInvocation,
  getMcpInvocationEvents,
  getMcpInvocationTrace,
  getMcpManagedCapabilityWorkspaceSelection,
  getMcpRegisteredTools,
  getMcpTools,
  resetMcpCapabilityFixture,
  resolveMcpInvocationApproval,
  type ExternalMcpServerRecord,
  type HarnessToolDefinition,
  type McpWorkspaceSelection,
} from "@/shared/api/tools";
import { buildCapabilityAcceptanceCases } from "../cases";
import type {
  CapabilityAcceptanceCase,
  CapabilityRunState,
  CapabilityTool,
} from "../types";
import {
  resolveCapabilityReadiness,
  toExternalCapabilityTools,
  toNativeCapabilityTool,
  toUnavailableNativeCapabilityTool,
} from "../utils";

const emptyRunState: CapabilityRunState = {
  isRunning: false,
  invocationId: null,
  invocation: null,
  resolutionInvocation: null,
  events: [],
  trace: null,
  transportError: null,
};

export function useCapabilities() {
  const [internalTools, setInternalTools] = useState<HarnessToolDefinition[]>([]);
  const [externalServers, setExternalServers] = useState<ExternalMcpServerRecord[]>([]);
  const [manualToolIds, setManualToolIds] = useState<Set<string>>(new Set());
  const [workspaceSelection, setWorkspaceSelection] =
    useState<McpWorkspaceSelection | null>(null);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runState, setRunState] = useState<CapabilityRunState>(emptyRunState);
  const [isPreparingCase, setIsPreparingCase] = useState(false);
  const [isResolvingApproval, setIsResolvingApproval] = useState(false);
  const runGenerationRef = useRef(0);
  const executionLockRef = useRef(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [toolDefinitions, manualTools, workspace, servers] = await Promise.all([
        getMcpRegisteredTools(),
        getMcpTools(),
        getMcpManagedCapabilityWorkspaceSelection(),
        getExternalMcpServers(),
      ]);
      setInternalTools(toolDefinitions);
      setManualToolIds(new Set(manualTools.map((tool) => tool.id)));
      setWorkspaceSelection(workspace);
      setExternalServers(servers);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cases = useMemo(
    () => buildCapabilityAcceptanceCases(externalServers),
    [externalServers],
  );

  const allTools = useMemo<CapabilityTool[]>(
    () => [
      ...internalTools.map(toNativeCapabilityTool),
      ...toExternalCapabilityTools(externalServers),
    ],
    [externalServers, internalTools],
  );

  const tools = useMemo(() => {
    const caseToolIds = [...new Set(cases.map((caseDefinition) => caseDefinition.toolId))];

    return caseToolIds.flatMap((toolId) => {
      const registered = allTools.find((tool) => tool.id === toolId);
      if (registered) return [registered];
      if (toolId.startsWith("mcp:")) return [];
      return [toUnavailableNativeCapabilityTool(toolId)];
    });
  }, [allTools, cases]);

  useEffect(() => {
    if (tools.length === 0) {
      setSelectedToolId(null);
      setSelectedCaseId(null);
      return;
    }

    const nextToolId =
      selectedToolId && tools.some((tool) => tool.id === selectedToolId)
        ? selectedToolId
        : tools[0]!.id;
    const toolCases = cases.filter(
      (caseDefinition) => caseDefinition.toolId === nextToolId,
    );
    const nextCaseId =
      selectedCaseId &&
      toolCases.some((caseDefinition) => caseDefinition.id === selectedCaseId)
        ? selectedCaseId
        : toolCases[0]?.id ?? null;

    if (nextToolId !== selectedToolId) {
      setSelectedToolId(nextToolId);
    }
    if (nextCaseId !== selectedCaseId) {
      setSelectedCaseId(nextCaseId);
    }
  }, [cases, selectedCaseId, selectedToolId, tools]);

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === selectedToolId) ?? null,
    [selectedToolId, tools],
  );

  const toolCases = useMemo(
    () =>
      selectedTool
        ? cases.filter((caseDefinition) => caseDefinition.toolId === selectedTool.id)
        : [],
    [cases, selectedTool],
  );

  const selectedCase = useMemo(
    () =>
      toolCases.find((caseDefinition) => caseDefinition.id === selectedCaseId) ??
      toolCases[0] ??
      null,
    [selectedCaseId, toolCases],
  );

  const readiness = useMemo(
    () =>
      resolveCapabilityReadiness({
        caseDefinition: selectedCase,
        tool: selectedTool,
        workspaceRoot: workspaceSelection?.rootPath ?? null,
      }),
    [selectedCase, selectedTool, workspaceSelection?.rootPath],
  );

  const resetRunState = () => {
    runGenerationRef.current += 1;
    setRunState(emptyRunState);
  };

  const hasPendingApproval =
    runState.invocation?.status === "awaiting_approval" &&
    !runState.invocation.approval?.resolution;
  const isSelectionLocked =
    executionLockRef.current ||
    isPreparingCase ||
    runState.isRunning ||
    isResolvingApproval ||
    hasPendingApproval;

  const selectTool = (toolId: string) => {
    if (executionLockRef.current || isSelectionLocked) return;
    setSelectedToolId(toolId);
    setSelectedCaseId(
      cases.find((caseDefinition) => caseDefinition.toolId === toolId)?.id ?? null,
    );
    resetRunState();
  };

  const selectCase = (caseId: string) => {
    if (executionLockRef.current || isSelectionLocked) return;
    const nextCase = cases.find((caseDefinition) => caseDefinition.id === caseId);
    if (!nextCase) return;
    setSelectedToolId(nextCase.toolId);
    setSelectedCaseId(nextCase.id);
    resetRunState();
  };

  const canOpenManual = Boolean(
    selectedTool && manualToolIds.has(selectedTool.id),
  );

  const runCase = async (caseId: string) => {
    if (executionLockRef.current || hasPendingApproval) {
      return;
    }

    const nextCase = cases.find((caseDefinition) => caseDefinition.id === caseId);
    const nextTool = nextCase
      ? tools.find((tool) => tool.id === nextCase.toolId) ?? null
      : null;
    const nextReadiness = resolveCapabilityReadiness({
      caseDefinition: nextCase ?? null,
      tool: nextTool,
      workspaceRoot: workspaceSelection?.rootPath ?? null,
    });

    if (
      !nextCase ||
      !nextTool ||
      nextReadiness.state === "unavailable" ||
      isPreparingCase ||
      runState.isRunning
    ) {
      return;
    }

    if (nextCase.fixture && nextCase.workspace !== "managed") {
      setRunState({
        ...emptyRunState,
        transportError:
          "Capability fixture configuration requires workspace=managed.",
      });
      return;
    }

    executionLockRef.current = true;
    const generation = ++runGenerationRef.current;
    const isCurrentRun = () => runGenerationRef.current === generation;
    const releaseExecutionLock = () => {
      if (isCurrentRun()) {
        executionLockRef.current = false;
      }
    };

    setSelectedToolId(nextTool.id);
    setSelectedCaseId(nextCase.id);
    setRunState(emptyRunState);

    if (nextCase.fixture) {
      setIsPreparingCase(true);
      try {
        const reset = await resetMcpCapabilityFixture(nextCase.fixture);
        if (!isCurrentRun()) return;
        setWorkspaceSelection(reset.workspace);
      } catch (error) {
        if (!isCurrentRun()) return;
        setRunState({
          ...emptyRunState,
          transportError: `Fixture preparation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        releaseExecutionLock();
        return;
      } finally {
        if (isCurrentRun()) {
          setIsPreparingCase(false);
        }
      }
    }

    if (!isCurrentRun()) return;

    let invocationId = "";
    let approvalRequired = false;
    let keepExecutionLock = false;
    setRunState({ ...emptyRunState, isRunning: true });

    try {
      await executeMcpInvocationStream(
        {
          toolId: nextCase.toolId,
          args: nextCase.args,
          ...(nextCase.workspace === "managed"
            ? { workspaceContext: "tool_lab_managed" as const }
            : {}),
        },
        (event) => {
          if (!isCurrentRun() || event.type === "invocation:done") {
            return;
          }

          if (event.type === "invocation:start") {
            invocationId = event.invocationId;
          }
          if (event.type === "invocation:approval_required") {
            approvalRequired = true;
          }

          setRunState((current) => ({
            ...current,
            invocationId:
              event.type === "invocation:start"
                ? event.invocationId
                : current.invocationId,
            events: [...current.events, event],
          }));
        },
      );

      if (!isCurrentRun()) return;
      if (!invocationId) {
        throw new Error("Invocation stream ended before an invocation id was received.");
      }

      const [invocationResult, traceResult] = await Promise.allSettled([
        getMcpInvocation(invocationId),
        getMcpInvocationTrace(invocationId),
      ]);

      if (!isCurrentRun()) return;

      keepExecutionLock =
        invocationResult.status === "fulfilled"
          ? invocationResult.value.status === "awaiting_approval" &&
            !invocationResult.value.approval?.resolution
          : approvalRequired;

      const retrievalErrors = [
        invocationResult.status === "rejected"
          ? `Invocation record: ${
              invocationResult.reason instanceof Error
                ? invocationResult.reason.message
                : String(invocationResult.reason)
            }`
          : null,
        traceResult.status === "rejected"
          ? `Trace: ${
              traceResult.reason instanceof Error
                ? traceResult.reason.message
                : String(traceResult.reason)
            }`
          : null,
      ].filter((message): message is string => Boolean(message));

      setRunState((current) => ({
        ...current,
        invocationId,
        invocation:
          invocationResult.status === "fulfilled"
            ? invocationResult.value
            : current.invocation,
        trace:
          traceResult.status === "fulfilled"
            ? traceResult.value
            : current.trace,
        transportError:
          retrievalErrors.length > 0
            ? retrievalErrors.join(" · ")
            : current.transportError,
      }));
    } catch (error) {
      if (!isCurrentRun()) return;
      setRunState((current) => ({
        ...current,
        transportError: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (isCurrentRun()) {
        setRunState((current) => ({ ...current, isRunning: false }));
        if (!keepExecutionLock) {
          releaseExecutionLock();
        }
      }
    }
  };

  const resolveApproval = async (decision: "approved" | "rejected") => {
    const originalInvocation = runState.invocation;
    if (
      !originalInvocation ||
      originalInvocation.status !== "awaiting_approval" ||
      isResolvingApproval
    ) {
      return;
    }

    const generation = runGenerationRef.current;
    const isCurrentResolution = () => runGenerationRef.current === generation;
    let approvalResolved = false;

    setIsResolvingApproval(true);
    setRunState((current) => ({ ...current, transportError: null }));

    try {
      const resolution = await resolveMcpInvocationApproval(originalInvocation.id, {
        decision,
        toolId: originalInvocation.toolId,
        args: originalInvocation.args,
      });
      if (!isCurrentResolution()) return;
      approvalResolved = true;

      const resumedInvocation = resolution.resumedInvocation;
      const [traceResult, eventsResult] = resumedInvocation
        ? await Promise.allSettled([
            getMcpInvocationTrace(resumedInvocation.id),
            getMcpInvocationEvents(resumedInvocation.id),
          ])
        : [null, null];

      if (!isCurrentResolution()) return;

      const retrievalErrors = [
        traceResult && traceResult.status === "rejected"
          ? `Trace: ${
              traceResult.reason instanceof Error
                ? traceResult.reason.message
                : String(traceResult.reason)
            }`
          : null,
        eventsResult && eventsResult.status === "rejected"
          ? `Events: ${
              eventsResult.reason instanceof Error
                ? eventsResult.reason.message
                : String(eventsResult.reason)
            }`
          : null,
      ].filter((message): message is string => Boolean(message));

      setRunState((current) => ({
        ...current,
        invocation: resolution.originalInvocation,
        resolutionInvocation: resumedInvocation,
        trace:
          traceResult?.status === "fulfilled"
            ? traceResult.value
            : current.trace,
        events:
          eventsResult?.status === "fulfilled"
            ? [...current.events, ...eventsResult.value]
            : current.events,
        transportError:
          retrievalErrors.length > 0
            ? retrievalErrors.join(" · ")
            : current.transportError,
      }));
    } catch (error) {
      if (!isCurrentResolution()) return;
      setRunState((current) => ({
        ...current,
        transportError: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (isCurrentResolution()) {
        if (approvalResolved) {
          executionLockRef.current = false;
        }
        setIsResolvingApproval(false);
      }
    }
  };

  const runSelectedCase = async () => {
    if (!selectedCase) return;
    await runCase(selectedCase.id);
  };

  return {
    canOpenManual,
    cases,
    isLoading,
    isPreparingCase,
    isResolvingApproval,
    isSelectionLocked,
    loadError,
    readiness,
    resolveApproval,
    runState,
    selectedCase,
    selectedTool,
    toolCases,
    tools,
    workspaceSelection,
    refresh: load,
    runCase,
    runSelectedCase,
    selectCase,
    selectTool,
  };
}

export type UseCapabilityReturn = ReturnType<typeof useCapabilities>;
export type CapabilityCase = CapabilityAcceptanceCase;
