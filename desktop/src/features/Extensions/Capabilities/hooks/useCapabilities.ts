import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createMcpToolLabBrowserRun,
  executeMcpInvocationStream,
  getExternalMcpServers,
  getMcpInvocation,
  getMcpInvocationEvents,
  getMcpInvocationTrace,
  getMcpManagedCapabilityWorkspaceSelection,
  getMcpRegisteredTools,
  getMcpTools,
  resetMcpCapabilityFixture,
  resetMcpToolLabBrowserRun,
  resolveMcpInvocationApproval,
  type ExternalMcpServerRecord,
  type HarnessToolDefinition,
  type McpWorkspaceSelection,
  type ToolInvocationApprovalResolution,
  type ToolLabBrowserRun,
} from "@/shared/api/tools";
import { getTerminalResultSummary } from "@/shared/tools/terminalResult";
import {
  BROWSER_JOURNEY_STEP_DEFINITIONS,
  createBrowserJourneyState,
  findBrowserSnapshotRef,
  readBrowserResult,
  type BrowserJourneyError,
  type BrowserJourneyState,
  type BrowserJourneyStep,
  type BrowserJourneyStepId,
} from "../browserJourney";
import { buildCapabilityAcceptanceCases } from "../cases";
import type {
  BrowserJourneySpec,
  CapabilityAcceptanceCase,
  CapabilityRunState,
  CapabilityTool,
} from "../types";
import {
  isManagedBrowserTool,
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
  const { t } = useTranslation();
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
  const [browserJourney, setBrowserJourney] = useState<BrowserJourneyState>(() =>
    createBrowserJourneyState(),
  );
  const [isPreparingCase, setIsPreparingCase] = useState(false);
  const [isResolvingApproval, setIsResolvingApproval] = useState(false);
  const [terminalContinuation, setTerminalContinuation] = useState<{
    continuationId: string;
    nextOutputOffset: number;
    outputLimitBytes?: number;
  } | null>(null);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const runGenerationRef = useRef(0);
  const executionLockRef = useRef(false);
  const browserJourneyRef = useRef<BrowserJourneyState>(createBrowserJourneyState());
  const browserJourneyStepIndexRef = useRef<number | null>(null);

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
    const caseTools = caseToolIds.flatMap((toolId) => {
      const registered = allTools.find((tool) => tool.id === toolId);
      if (registered) return [registered];
      if (toolId.startsWith("mcp:")) return [];
      return [toUnavailableNativeCapabilityTool(toolId)];
    });
    const caseToolIdSet = new Set(caseTools.map((tool) => tool.id));
    const browserTools = allTools.filter(
      (tool) => isManagedBrowserTool(tool) && !caseToolIdSet.has(tool.id),
    );

    return [...caseTools, ...browserTools];
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
        translate: t,
      }),
    [selectedCase, selectedTool, t, workspaceSelection?.rootPath],
  );

  const displayInvocation = runState.resolutionInvocation ?? runState.invocation;
  const terminalSummary = useMemo(
    () =>
      selectedTool?.id === "terminal"
        ? getTerminalResultSummary(displayInvocation?.result)
        : null,
    [displayInvocation?.result, selectedTool?.id],
  );

  const clearTerminalTracking = () => {
    setTerminalContinuation(null);
    setTerminalSessionId(null);
  };

  const rememberTerminalResult = (value: unknown) => {
    const summary = getTerminalResultSummary(value);
    if (summary?.state === "cancelled") {
      clearTerminalTracking();
      return;
    }
    if (summary?.sessionId) {
      setTerminalSessionId(summary.sessionId);
    }
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

  const resetRunState = () => {
    runGenerationRef.current += 1;
    setRunState(emptyRunState);
  };

  const commitBrowserJourney = (next: BrowserJourneyState) => {
    browserJourneyRef.current = next;
    setBrowserJourney(next);
  };

  const clearBrowserJourney = (spec: BrowserJourneySpec | null = null) => {
    browserJourneyStepIndexRef.current = null;
    commitBrowserJourney(createBrowserJourneyState(spec));
  };

  const updateBrowserJourneyStep = (
    stepId: BrowserJourneyStepId,
    patch: Partial<BrowserJourneyStep>,
  ) => {
    const current = browserJourneyRef.current;
    commitBrowserJourney({
      ...current,
      steps: current.steps.map((step) =>
        step.id === stepId ? { ...step, ...patch } : step,
      ),
    });
  };

  const setBrowserJourneyStatus = (
    patch: Partial<Pick<BrowserJourneyState, "status" | "handle" | "error" | "spec">>,
  ) => {
    commitBrowserJourney({ ...browserJourneyRef.current, ...patch });
  };

  const isBrowserJourneyActive = () =>
    browserJourneyRef.current.status === "running" ||
    browserJourneyRef.current.status === "awaiting_approval";

  const selectedCaseBrowserJourney = selectedCase?.browserJourney ?? null;

  useEffect(() => {
    if (isBrowserJourneyActive()) return;
    if (browserJourneyRef.current.spec === selectedCaseBrowserJourney) return;
    clearBrowserJourney(selectedCaseBrowserJourney);
  }, [selectedCaseBrowserJourney]);

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
    clearTerminalTracking();
    const nextCase =
      cases.find((caseDefinition) => caseDefinition.toolId === toolId) ?? null;
    clearBrowserJourney(nextCase?.browserJourney ?? null);
    setSelectedToolId(toolId);
    setSelectedCaseId(nextCase?.id ?? null);
    resetRunState();
  };

  const selectCase = (caseId: string) => {
    if (executionLockRef.current || isSelectionLocked) return;
    clearTerminalTracking();
    const nextCase = cases.find((caseDefinition) => caseDefinition.id === caseId);
    if (!nextCase) return;
    clearBrowserJourney(nextCase.browserJourney ?? null);
    setSelectedToolId(nextCase.toolId);
    setSelectedCaseId(nextCase.id);
    resetRunState();
  };

  const canOpenManual = Boolean(
    selectedTool && manualToolIds.has(selectedTool.id),
  );

  const executeInvocation = async (
    input: {
      toolId: string;
      args: Record<string, unknown>;
      workspaceContext?: "tool_lab" | "tool_lab_managed";
      browserRunHandle?: string;
    },
    generation: number,
  ) => {
    const isCurrentRun = () => runGenerationRef.current === generation;
    let invocationId = "";
    let approvalRequired = false;
    let keepExecutionLock = false;

    setRunState({ ...emptyRunState, isRunning: true });

    try {
      await executeMcpInvocationStream(input, (event) => {
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
      });

      if (!isCurrentRun()) return keepExecutionLock;
      if (!invocationId) {
        throw new Error("Invocation stream ended before an invocation id was received.");
      }

      const [invocationResult, traceResult] = await Promise.allSettled([
        getMcpInvocation(invocationId),
        getMcpInvocationTrace(invocationId),
      ]);
      if (!isCurrentRun()) return keepExecutionLock;

      keepExecutionLock =
        invocationResult.status === "fulfilled"
          ? invocationResult.value.status === "awaiting_approval" &&
            !invocationResult.value.approval?.resolution
          : approvalRequired;

      if (invocationResult.status === "fulfilled" && input.toolId === "terminal") {
        rememberTerminalResult(invocationResult.value.result);
      }

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
        resolutionInvocation: null,
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
      if (isCurrentRun()) {
        setRunState((current) => ({
          ...current,
          transportError: error instanceof Error ? error.message : String(error),
        }));
      }
    } finally {
      if (isCurrentRun()) {
        setRunState((current) => ({ ...current, isRunning: false }));
      }
    }

    return keepExecutionLock;
  };

  const toBrowserJourneyError = (error: unknown): BrowserJourneyError => ({
    code: "browser_journey_error",
    message: error instanceof Error ? error.message : String(error),
  });

  const describeBrowserStepOutcome = (
    invocation: Awaited<ReturnType<typeof getMcpInvocation>>,
  ) => {
    const view = readBrowserResult(invocation.result);
    const completed = invocation.status === "completed" && view?.ok === true;
    const error: BrowserJourneyError | null = completed
      ? null
      : invocation.error
        ? {
            code: invocation.error.failureCode ?? invocation.error.code ?? "invocation_failed",
            message: invocation.error.message,
          }
        : view?.error
          ? view.error
          : view && !view.ok
            ? { code: "browser_result_not_ok", message: "Browser Tool returned ok=false." }
            : { code: "browser_result_missing", message: "Browser Tool returned no structured result." };
    return { view, completed, error };
  };

  const finalizeBrowserJourney = async (
    status: "completed" | "failed" | "rejected",
    error: BrowserJourneyError | null,
    generation: number,
  ) => {
    if (runGenerationRef.current !== generation) return;
    let handle = browserJourneyRef.current.handle;
    if (handle) {
      try {
        await resetMcpToolLabBrowserRun(handle);
        handle = null;
      } catch {
        // Keep the handle so the operator can still reset it explicitly.
      }
    }
    if (runGenerationRef.current !== generation) return;
    browserJourneyStepIndexRef.current = null;
    commitBrowserJourney({
      ...browserJourneyRef.current,
      status,
      handle,
      error,
    });
    executionLockRef.current = false;
  };

  const failBrowserJourneyStep = async (
    stepId: BrowserJourneyStepId,
    error: BrowserJourneyError,
    generation: number,
  ) => {
    updateBrowserJourneyStep(stepId, { status: "failed", error });
    await finalizeBrowserJourney("failed", error, generation);
  };

  const executeBrowserStep = async (input: {
    stepId: BrowserJourneyStepId;
    toolId: string;
    args: Record<string, unknown>;
    handle: string;
    generation: number;
  }) => {
    const isCurrentRun = () => runGenerationRef.current === input.generation;
    let invocationId = "";
    setRunState({ ...emptyRunState, isRunning: true });

    try {
      await executeMcpInvocationStream(
        {
          toolId: input.toolId,
          args: input.args,
          browserRunHandle: input.handle,
        },
        (event) => {
          if (!isCurrentRun() || event.type === "invocation:done") return;
          if (event.type === "invocation:start") {
            invocationId = event.invocationId;
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

      if (!isCurrentRun()) return { invocation: null, invocationId };
      if (!invocationId) {
        throw new Error("Invocation stream ended before an invocation id was received.");
      }

      const [invocationResult, traceResult] = await Promise.allSettled([
        getMcpInvocation(invocationId),
        getMcpInvocationTrace(invocationId),
      ]);
      if (!isCurrentRun()) return { invocation: null, invocationId };

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
        resolutionInvocation: null,
        trace:
          traceResult.status === "fulfilled"
            ? traceResult.value
            : current.trace,
        transportError:
          retrievalErrors.length > 0
            ? retrievalErrors.join(" · ")
            : current.transportError,
      }));

      return {
        invocation:
          invocationResult.status === "fulfilled" ? invocationResult.value : null,
        invocationId,
        transportError:
          retrievalErrors.length > 0 ? retrievalErrors.join(" · ") : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isCurrentRun()) {
        setRunState((current) => ({ ...current, transportError: message }));
      }
      return {
        invocation: null,
        invocationId: invocationId || null,
        transportError: message,
      };
    } finally {
      if (isCurrentRun()) {
        setRunState((current) => ({ ...current, isRunning: false }));
      }
    }
  };

  const runBrowserJourneySteps = async (input: {
    spec: BrowserJourneySpec;
    handle: string;
    generation: number;
    startIndex: number;
  }) => {
    for (
      let index = input.startIndex;
      index < BROWSER_JOURNEY_STEP_DEFINITIONS.length;
      index += 1
    ) {
      if (runGenerationRef.current !== input.generation) return;
      const definition = BROWSER_JOURNEY_STEP_DEFINITIONS[index]!;
      browserJourneyStepIndexRef.current = index;
      updateBrowserJourneyStep(definition.id, {
        status: "running",
        invocationId: null,
        approvalInvocationId: null,
        invocationStatus: null,
        approvalDecision: null,
        resultOk: null,
        sessionId: null,
        page: null,
        ref: null,
        assertion: null,
        error: null,
      });
      setBrowserJourneyStatus({ status: "running" });

      let args: Record<string, unknown> = {};
      if (definition.id === "navigate") {
        args = { url: input.spec.startUrl };
      } else if (definition.id === "snapshot" || definition.id === "observe-after-click") {
        args = { ...(input.spec.snapshot ?? {}) };
      } else if (definition.id === "click") {
        const snapshotStep = browserJourneyRef.current.steps.find(
          (step) => step.id === "snapshot",
        );
        if (
          !snapshotStep?.page?.url ||
          !snapshotStep.page.snapshotHash ||
          !snapshotStep.ref
        ) {
          await failBrowserJourneyStep(
            definition.id,
            {
              code: "snapshot_context_missing",
              message:
                "Click cannot start without pageUrl, snapshotHash and ref from the live snapshot.",
            },
            input.generation,
          );
          return;
        }
        args = {
          pageUrl: snapshotStep.page.url,
          snapshotHash: snapshotStep.page.snapshotHash,
          ref: snapshotStep.ref,
        };
      } else {
        args = { assertion: input.spec.assertion };
      }

      const executed = await executeBrowserStep({
        stepId: definition.id,
        toolId: definition.toolId,
        args,
        handle: input.handle,
        generation: input.generation,
      });
      if (runGenerationRef.current !== input.generation) return;

      if (!executed.invocation) {
        await failBrowserJourneyStep(
          definition.id,
          {
            code: "invocation_unavailable",
            message: executed.transportError ?? "Browser Invocation could not be read.",
          },
          input.generation,
        );
        return;
      }

      if (executed.invocation.status === "awaiting_approval") {
        const view = readBrowserResult(executed.invocation.result);
        updateBrowserJourneyStep(definition.id, {
          status: "awaiting_approval",
          invocationId: executed.invocation.id,
          invocationStatus: executed.invocation.status,
          resultOk: view?.ok ?? null,
          page: view?.page ?? null,
          sessionId: view?.sessionId ?? null,
        });
        setBrowserJourneyStatus({ status: "awaiting_approval" });
        return;
      }

      const outcome = describeBrowserStepOutcome(executed.invocation);
      let stepError = outcome.error;
      if (!stepError && outcome.view) {
        if (!outcome.view.sessionId || !outcome.view.page?.url || !outcome.view.page.title) {
          stepError = {
            code: "browser_facts_missing",
            message:
              "Browser result did not include a live session and real page facts.",
          };
        } else if (
          (definition.id === "snapshot" || definition.id === "observe-after-click") &&
          !outcome.view.page.snapshotHash
        ) {
          stepError = {
            code: "snapshot_hash_missing",
            message: "Snapshot did not return a real snapshotHash.",
          };
        } else if (definition.id === "assert" && outcome.view.assertion?.passed !== true) {
          stepError = {
            code: "assertion_failed",
            message: "Browser assertion did not pass.",
          };
        }
      }

      if (stepError) {
        updateBrowserJourneyStep(definition.id, {
          status: "failed",
          invocationId: executed.invocation.id,
          invocationStatus: executed.invocation.status,
          resultOk: outcome.view?.ok ?? null,
          sessionId: outcome.view?.sessionId ?? null,
          page: outcome.view?.page ?? null,
          assertion: outcome.view?.assertion ?? null,
          error: stepError,
        });
        await finalizeBrowserJourney("failed", stepError, input.generation);
        return;
      }

      const view = outcome.view!;
      let ref: string | null = null;
      if (definition.id === "snapshot") {
        ref = findBrowserSnapshotRef(view.observationSnapshot, input.spec.clickTarget);
        if (!ref) {
          const error: BrowserJourneyError = {
            code: "snapshot_target_missing",
            message: `Snapshot did not contain ${input.spec.clickTarget.role} "${input.spec.clickTarget.name}".`,
          };
          updateBrowserJourneyStep(definition.id, {
            status: "failed",
            invocationId: executed.invocation.id,
            invocationStatus: executed.invocation.status,
            resultOk: view.ok,
            sessionId: view.sessionId,
            page: view.page,
            error,
          });
          await finalizeBrowserJourney("failed", error, input.generation);
          return;
        }
      }

      updateBrowserJourneyStep(definition.id, {
        status: "completed",
        invocationId: executed.invocation.id,
        invocationStatus: executed.invocation.status,
        resultOk: view.ok,
        sessionId: view.sessionId,
        page: view.page,
        ref,
        assertion: view.assertion,
        error: null,
      });
    }

    await finalizeBrowserJourney("completed", null, input.generation);
  };

  const startBrowserJourney = async (caseDefinition: CapabilityAcceptanceCase) => {
    const spec = caseDefinition.browserJourney;
    if (!spec) return;
    if (executionLockRef.current || hasPendingApproval || runState.isRunning) return;

    clearTerminalTracking();
    executionLockRef.current = true;
    const generation = ++runGenerationRef.current;
    const previousHandle = browserJourneyRef.current.handle;
    const isCurrentRun = () => runGenerationRef.current === generation;

    setIsPreparingCase(true);
    setRunState(emptyRunState);
    clearBrowserJourney(spec);
    setBrowserJourneyStatus({ status: "running" });

    let created: ToolLabBrowserRun;
    try {
      if (previousHandle) {
        await resetMcpToolLabBrowserRun(previousHandle);
      }
      if (!isCurrentRun()) return;
      created = await createMcpToolLabBrowserRun();
    } catch (error) {
      if (!isCurrentRun()) return;
      setIsPreparingCase(false);
      await finalizeBrowserJourney(
        "failed",
        toBrowserJourneyError(error),
        generation,
      );
      return;
    }

    if (!isCurrentRun()) {
      void resetMcpToolLabBrowserRun(created.handle).catch(() => undefined);
      return;
    }
    setIsPreparingCase(false);
    setBrowserJourneyStatus({ handle: created.handle });
    await runBrowserJourneySteps({
      spec,
      handle: created.handle,
      generation,
      startIndex: 0,
    });
  };

  const resetBrowserJourneyRun = async () => {
    if (runState.isRunning || isResolvingApproval) return;
    const handle = browserJourneyRef.current.handle;
    if (handle) {
      try {
        await resetMcpToolLabBrowserRun(handle);
      } catch (error) {
        setBrowserJourneyStatus({ error: toBrowserJourneyError(error) });
        return;
      }
    }
    runGenerationRef.current += 1;
    executionLockRef.current = false;
    browserJourneyStepIndexRef.current = null;
    setRunState(emptyRunState);
    clearBrowserJourney(
      selectedCase?.browserJourney ?? browserJourneyRef.current.spec,
    );
  };

  const resolveBrowserJourneyApproval = async (input: {
    decision: "approved" | "rejected";
    resolution: ToolInvocationApprovalResolution;
    stepIndex: number;
    generation: number;
  }) => {
    const definition = BROWSER_JOURNEY_STEP_DEFINITIONS[input.stepIndex];
    if (!definition) {
      await finalizeBrowserJourney(
        "failed",
        {
          code: "journey_step_missing",
          message: "The pending Browser journey step could not be identified.",
        },
        input.generation,
      );
      return;
    }

    if (input.decision === "rejected") {
      const error: BrowserJourneyError = {
        code:
          input.resolution.originalInvocation.error?.failureCode ??
          "approval_rejected",
        message:
          input.resolution.originalInvocation.error?.message ??
          "Browser step approval was rejected.",
      };
      updateBrowserJourneyStep(definition.id, {
        status: "rejected",
        approvalDecision: "rejected",
        approvalInvocationId: input.resolution.originalInvocation.id,
        invocationId: input.resolution.originalInvocation.id,
        invocationStatus: input.resolution.originalInvocation.status,
        resultOk: false,
        error,
      });
      await finalizeBrowserJourney("rejected", error, input.generation);
      return;
    }

    const resumed = input.resolution.resumedInvocation;
    if (!resumed) {
      const error: BrowserJourneyError = {
        code: "approval_resume_missing",
        message: "Approved Browser step returned no resumed invocation.",
      };
      updateBrowserJourneyStep(definition.id, {
        status: "failed",
        approvalDecision: "approved",
        approvalInvocationId: input.resolution.originalInvocation.id,
        error,
      });
      await finalizeBrowserJourney("failed", error, input.generation);
      return;
    }

    const outcome = describeBrowserStepOutcome(resumed);
    let stepError = outcome.error;
    if (!stepError && outcome.view) {
      if (!outcome.view.sessionId || !outcome.view.page?.url || !outcome.view.page.title) {
        stepError = {
          code: "browser_facts_missing",
          message:
            "Resumed Browser step did not include a live session and real page facts.",
        };
      }
    }
    updateBrowserJourneyStep(definition.id, {
      status: stepError ? "failed" : "completed",
      approvalDecision: "approved",
      approvalInvocationId: input.resolution.originalInvocation.id,
      invocationId: resumed.id,
      invocationStatus: resumed.status,
      resultOk: outcome.view?.ok ?? null,
      sessionId: outcome.view?.sessionId ?? null,
      page: outcome.view?.page ?? null,
      assertion: outcome.view?.assertion ?? null,
      error: stepError,
    });

    if (stepError) {
      await finalizeBrowserJourney("failed", stepError, input.generation);
      return;
    }

    const spec = browserJourneyRef.current.spec;
    const handle = browserJourneyRef.current.handle;
    if (!spec || !handle) {
      await finalizeBrowserJourney(
        "failed",
        {
          code: "journey_context_missing",
          message: "Browser run handle or journey specification is unavailable.",
        },
        input.generation,
      );
      return;
    }

    await runBrowserJourneySteps({
      spec,
      handle,
      generation: input.generation,
      startIndex: input.stepIndex + 1,
    });
  };

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
      translate: t,
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

    if (nextCase.browserJourney) {
      setSelectedToolId(nextTool.id);
      setSelectedCaseId(nextCase.id);
      await startBrowserJourney(nextCase);
      return;
    }

    clearTerminalTracking();
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

    const keepExecutionLock = await executeInvocation(
      {
        toolId: nextCase.toolId,
        args: nextCase.args,
        ...(nextCase.workspace === "managed"
          ? { workspaceContext: "tool_lab_managed" as const }
          : {}),
      },
      generation,
    );

    if (!keepExecutionLock) {
      releaseExecutionLock();
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
    const journeyStepIndex =
      browserJourneyRef.current.status === "awaiting_approval"
        ? browserJourneyStepIndexRef.current
        : null;
    const isJourneyApproval = journeyStepIndex !== null && journeyStepIndex !== undefined;
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
      if (resumedInvocation?.toolId === "terminal") {
        rememberTerminalResult(resumedInvocation.result);
      }
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

      if (isJourneyApproval) {
        await resolveBrowserJourneyApproval({
          decision,
          resolution,
          stepIndex: journeyStepIndex,
          generation,
        });
      }
    } catch (error) {
      if (!isCurrentResolution()) return;
      if (isJourneyApproval) {
        await finalizeBrowserJourney(
          "failed",
          toBrowserJourneyError(error),
          generation,
        );
        return;
      }
      setRunState((current) => ({
        ...current,
        transportError: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (isCurrentResolution()) {
        const journeyStillActive = isJourneyApproval && isBrowserJourneyActive();
        if (approvalResolved && !journeyStillActive) {
          executionLockRef.current = false;
        }
        setIsResolvingApproval(false);
      }
    }
  };

  const runTerminalControl = async (args: Record<string, unknown>) => {
    if (
      selectedTool?.id !== "terminal" ||
      executionLockRef.current ||
      hasPendingApproval ||
      isPreparingCase ||
      runState.isRunning
    ) {
      return;
    }

    executionLockRef.current = true;
    const generation = ++runGenerationRef.current;
    const keepExecutionLock = await executeInvocation(
      {
        toolId: "terminal",
        args,
        workspaceContext: "tool_lab_managed",
      },
      generation,
    );

    if (!keepExecutionLock && runGenerationRef.current === generation) {
      executionLockRef.current = false;
    }
  };

  const runTerminalContinuation = async () => {
    if (!terminalContinuation) return;
    await runTerminalControl({
      continuationId: terminalContinuation.continuationId,
      outputOffset: terminalContinuation.nextOutputOffset,
      ...(terminalContinuation.outputLimitBytes
        ? { outputLimitBytes: terminalContinuation.outputLimitBytes }
        : {}),
    });
  };

  const runTerminalStatus = async () => {
    if (!terminalSessionId) return;
    await runTerminalControl({
      operation: "status",
      sessionId: terminalSessionId,
    });
  };

  const runTerminalStop = async () => {
    if (!terminalSessionId) return;
    await runTerminalControl({
      operation: "stop",
      sessionId: terminalSessionId,
    });
  };

  const runSelectedCase = async () => {
    if (!selectedCase) return;
    await runCase(selectedCase.id);
  };

  return {
    browserJourney,
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
    terminalContinuation,
    terminalSessionId,
    terminalSummary,
    selectedCase,
    selectedTool,
    toolCases,
    tools,
    workspaceSelection,
    refresh: load,
    resetBrowserJourneyRun,
    runCase,
    runSelectedCase,
    runTerminalContinuation,
    runTerminalStatus,
    runTerminalStop,
    selectCase,
    selectTool,
  };
}

export type UseCapabilityReturn = ReturnType<typeof useCapabilities>;
export type CapabilityCase = CapabilityAcceptanceCase;
