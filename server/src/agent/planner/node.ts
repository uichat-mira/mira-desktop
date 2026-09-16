import { providerProxyService } from "@/services/provider-proxy.service/index";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol";
import { writeStructuredLog } from "@/logger";
import type { AgentFinalizationPacket, AgentNextAction } from "../types";
import { getEvidencePayload, getLatestEvidenceSummary } from "../evidence";
import { validateAndFreezeFinalizationPacket } from "../finalization";
import {
  buildExecutionObservationView,
  buildPlannerObservationContext,
  emitStepNode,
  getTraceAttemptMeta,
  refreshCurrentTaskFrameFromEvidence,
  getToolTraceTargetPreview,
  summarizePlannerNextAction,
  updateCurrentTaskFrameFromPlanner,
  type AgentGraphState,
  type EmitAgentExecutionNode,
} from "../node-runtime";
import { getLatestUserQuestion } from "../nodes/shared";
import {
  ALLOWED_ACTION_TYPES,
  NEXT_ACTION_PLANNER_FALLBACK_REASON,
  toNextActionFallback,
  toPreview,
} from "./action-types";
import {
  adaptPlannerProviderOutput,
} from "./decision-adapter";
import { buildNextActionPlannerMessages, normalizeToolExposure } from "./prompt";
import {
  buildPlannerAccumulatedActionLedger,
  buildPlannerLatestEvidenceContent,
} from "./runtime-memory";
import {
  applyPlannerTaskPlan,
  getPlannerTaskPlanDiagnostics,
  parsePlannerTaskPlanUpdate,
  withPlannerTaskPlanContract,
  type PlannerTaskPlanUpdate,
} from "./task-plan";
import { validateNextAction } from "./validate";

const PLANNER_EXECUTION_HISTORY_LIMIT = 12;
const PLANNER_COVERED_PROGRESS_LIMIT = 20;
const PLANNER_VISIBLE_THOUGHT_MIN_DELTA = 12;

const decodeJsonStringFragment = (value: string) => {
  let decoded = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      decoded += char;
      continue;
    }

    const escaped = value[index + 1];
    if (!escaped) {
      break;
    }

    switch (escaped) {
      case "\"":
      case "\\":
      case "/":
        decoded += escaped;
        index += 1;
        break;
      case "b":
        decoded += "\b";
        index += 1;
        break;
      case "f":
        decoded += "\f";
        index += 1;
        break;
      case "n":
        decoded += "\n";
        index += 1;
        break;
      case "r":
        decoded += "\r";
        index += 1;
        break;
      case "t":
        decoded += "\t";
        index += 1;
        break;
      case "u": {
        const codePoint = value.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(codePoint)) {
          return decoded;
        }
        decoded += String.fromCharCode(Number.parseInt(codePoint, 16));
        index += 5;
        break;
      }
      default:
        decoded += escaped;
        index += 1;
        break;
    }
  }

  return decoded;
};

/**
 * Extracts only the public `reason` field from a partially streamed Planner JSON.
 * It intentionally does not expose raw model output or hidden reasoning fields.
 */
export const extractPlannerVisibleThought = (value: string) => {
  const match = /"reason"\s*:\s*"/.exec(value);
  if (!match) {
    return null;
  }

  const startIndex = match.index + match[0].length;
  let rawReason = "";
  let escaping = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index]!;
    if (escaping) {
      rawReason += `\\${char}`;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      break;
    }
    rawReason += char;
  }

  const decoded = decodeJsonStringFragment(rawReason).replace(/\s+/g, " ").trim();
  return decoded || null;
};

const shouldEmitPlannerVisibleThought = (
  current: string,
  previous: string,
) =>
  current !== previous &&
  (current.length - previous.length >= PLANNER_VISIBLE_THOUGHT_MIN_DELTA ||
    /[。！？!?；;，,：:]$/.test(current));

const mergePlannerTaskFrameProgress = (
  previousFrame: AgentGraphState["currentTaskFrame"],
  refreshedFrame: AgentGraphState["currentTaskFrame"],
): AgentGraphState["currentTaskFrame"] => {
  if (!refreshedFrame) {
    return refreshedFrame;
  }

  const coveredProgress = [
    ...(previousFrame?.coveredProgress ?? []),
    ...(refreshedFrame.coveredProgress ?? []),
  ]
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .slice(-PLANNER_COVERED_PROGRESS_LIMIT);

  return {
    ...refreshedFrame,
    coveredProgress: coveredProgress.length > 0 ? coveredProgress : undefined,
  };
};

const getRecoveryExhaustedPlannerConclusion = (observationContext: ReturnType<
  typeof buildPlannerObservationContext
>): AgentNextAction => {
  const latestObservation = observationContext.latestObservation;
  const failureReason =
    observationContext.recovery.errorMessage?.trim() ||
    observationContext.recovery.schemaError?.trim() ||
    latestObservation?.errorMessage?.trim() ||
    latestObservation?.reason?.trim();
  const actionLabel =
    observationContext.recovery.toolId ??
    latestObservation?.toolId ??
    (latestObservation?.actionType === "retrieve" ? "retrieval" : "the latest action");

  return {
    type: "error",
    reason: failureReason
      ? `Recovery budget exhausted after ${actionLabel} failed: ${failureReason}`
      : `Recovery budget exhausted after ${actionLabel} failed; planner must stop instead of proposing another tool action.`,
  };
};

const logPlannerDecisionDebug = (input: {
  runId: string;
  threadId: string;
  iteration: number;
  maxIterations: number;
  taskModelInvoked: boolean;
  nextAction?: AgentNextAction;
  rawOutput: string;
  sanitizedOutput: string;
  parseErrorReason?: string;
  parseWarnings?: string[];
}) => {
  writeStructuredLog(input.parseErrorReason ? "warn" : "info", {
    msg: "Planner decision debug",
    event: "agent-next-action-planner-debug",
    runId: input.runId,
    threadId: input.threadId,
    iteration: input.iteration,
    maxIterations: input.maxIterations,
    taskModelInvoked: input.taskModelInvoked,
    selectedActionType: input.nextAction?.type ?? null,
    selectedToolId:
      input.nextAction?.type === "use_tool" ? input.nextAction.toolId : null,
    reason: input.nextAction?.reason ?? null,
    parseErrorReason: input.parseErrorReason,
    parseWarnings: input.parseWarnings,
    rawOutputPreview: input.rawOutput ? toPreview(input.rawOutput) : undefined,
    sanitizedOutputPreview: input.sanitizedOutput
      ? toPreview(input.sanitizedOutput)
      : undefined,
    allowedActionTypes: [...ALLOWED_ACTION_TYPES],
  });
};

export const nextActionPlannerNode = async (
  state: AgentGraphState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentGraphState>> => {
  const iteration = state.iterationCount ?? 0;
  // Compatibility/diagnostic field only. Planner execution is not capped by it.
  const maxIterations = 0;
  const traceAttemptMeta = getTraceAttemptMeta(
    "agent-next-action-planner",
    state,
  );
  const question =
    state.question?.trim() || getLatestUserQuestion(state.messages) || state.goal.text;
  const toolExposure = normalizeToolExposure(state);
  const refreshedTaskFrame = refreshCurrentTaskFrameFromEvidence({
    frame: state.currentTaskFrame,
    goal: state.goal,
    latestQuestion: question,
    latestEvidenceSummary: getLatestEvidenceSummary(state),
  });
  const plannerVisibleTaskFrame = mergePlannerTaskFrameProgress(
    state.currentTaskFrame,
    refreshedTaskFrame,
  );
  const plannerState = {
    ...state,
    currentTaskFrame: plannerVisibleTaskFrame,
  };
  const allExecutionHistory = buildExecutionObservationView(plannerState);
  const executionHistory = allExecutionHistory.slice(
    -PLANNER_EXECUTION_HISTORY_LIMIT,
  );
  const baseObservationContext = buildPlannerObservationContext(plannerState);
  const observationContext = {
    ...baseObservationContext,
    executionHistory,
    evidenceHistory: executionHistory.flatMap((item) =>
      item.summary ? [item.summary] : [],
    ),
    accumulatedActionLedger: buildPlannerAccumulatedActionLedger(allExecutionHistory),
    latestEvidenceContent: buildPlannerLatestEvidenceContent(
      plannerState,
      baseObservationContext.latestObservation,
    ),
  };
  const latestEvidenceSummary = observationContext.latestEvidenceSummary;
  const currentPlanDiagnostics = getPlannerTaskPlanDiagnostics(plannerVisibleTaskFrame);
  const plannerStartDetails = {
    exposedToolCount: toolExposure.exposedTools.length,
    exposedToolIds: toolExposure.exposedTools,
    codebaseExploreExposed: toolExposure.exposedTools.includes("codebase_explore"),
    iteration,
    maxIterations,
    latestEvidenceSummary: latestEvidenceSummary ?? null,
    latestEvidenceContentSource:
      observationContext.latestEvidenceContent?.source ?? null,
    executionHistoryCount: executionHistory.length,
    evidenceHistoryCount: observationContext.evidenceHistory.length,
    accumulatedActionCount:
      observationContext.accumulatedActionLedger.totalExecutionObservations,
    uniqueSemanticActionCount:
      observationContext.accumulatedActionLedger.uniqueSemanticActions,
    repeatedSemanticActionCount:
      observationContext.accumulatedActionLedger.repeatedSemanticActions,
    ...currentPlanDiagnostics,
    schemaReplanAttemptCount: observationContext.recovery.attemptCount,
    schemaReplanError: observationContext.recovery.schemaError ?? null,
  };

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-next-action-planner",
    ...traceAttemptMeta,
    nodeType: "plan",
    phase: "start",
    label: "下一步动作决策",
    summary: "正在调用 task model 维护任务计划并决定本轮下一步动作",
    details: plannerStartDetails,
  });

  let nextAction: AgentNextAction | undefined;
  let finalizationPacket: AgentFinalizationPacket | undefined;
  let plannerTaskPlanUpdate: PlannerTaskPlanUpdate | undefined;
  let rawOutput = "";
  let sanitizedOutput = "";
  let parseErrorReason: string | undefined;
  let parseWarnings: string[] | undefined;
  const pendingApprovalActive = Boolean(observationContext.pendingApproval);
  const recoveryExhausted =
    observationContext.recovery.source !== "none" &&
    observationContext.recovery.exhausted;
  const taskModelInvoked = !pendingApprovalActive && !recoveryExhausted;

  if (pendingApprovalActive) {
    nextAction = undefined;
  } else if (recoveryExhausted) {
    nextAction = getRecoveryExhaustedPlannerConclusion(observationContext);
  } else {
    const messages: NormalizedChatMessage[] = withPlannerTaskPlanContract(
      buildNextActionPlannerMessages({
        question,
        messages: state.messages,
        observationContext,
        toolExposure,
        iteration,
        maxIterations,
      }),
    );

    const resolvePlannerModelAction = async (
      plannerMessages: NormalizedChatMessage[],
    ) => {
      let resolvedRawOutput = "";
      let lastEmittedThought = "";
      for await (const delta of providerProxyService.streamTaskChatText(plannerMessages)) {
        resolvedRawOutput += delta;
        const visibleThought = extractPlannerVisibleThought(resolvedRawOutput);
        if (
          visibleThought &&
          shouldEmitPlannerVisibleThought(visibleThought, lastEmittedThought)
        ) {
          lastEmittedThought = visibleThought;
          await emitStepNode(emit, {
            runId: state.runId,
            nodeId: "agent-next-action-planner",
            ...traceAttemptMeta,
            nodeType: "plan",
            phase: "start",
            label: "下一步动作决策",
            summary: "正在调用 task model 维护任务计划并决定本轮下一步动作",
            details: {
              ...plannerStartDetails,
              plannerThought: visibleThought,
              plannerThoughtStreaming: true,
            },
          });
        }
      }

      const adaptedPlannerDecision = adaptPlannerProviderOutput({
        kind: "text",
        text: resolvedRawOutput,
      });
      const validationResult = validateNextAction(
        adaptedPlannerDecision,
        toolExposure.exposedTools,
      );

      return {
        action: validationResult.action,
        taskPlanUpdate: parsePlannerTaskPlanUpdate(
          adaptedPlannerDecision.diagnostics.rawDecision,
        ),
        rawOutput: resolvedRawOutput,
        sanitizedOutput: validationResult.sanitizedOutput ?? "",
        parseErrorReason: validationResult.parseErrorReason,
        parseWarnings: validationResult.parseWarnings,
      };
    };

    try {
      const initialPlannerDecision = await resolvePlannerModelAction(messages);
      nextAction = initialPlannerDecision.action;
      plannerTaskPlanUpdate = initialPlannerDecision.taskPlanUpdate;
      rawOutput = initialPlannerDecision.rawOutput;
      sanitizedOutput = initialPlannerDecision.sanitizedOutput;
      parseErrorReason = initialPlannerDecision.parseErrorReason;
      parseWarnings = initialPlannerDecision.parseWarnings;
      if (nextAction.type === "answer") {
        const validation = validateAndFreezeFinalizationPacket({
          action: nextAction,
          evidence: getEvidencePayload(plannerState),
        });
        if ("error" in validation) {
          nextAction = toNextActionFallback(validation.error);
          parseErrorReason = validation.error;
        } else {
          finalizationPacket = validation.packet;
        }
      }
      if (!plannerTaskPlanUpdate && currentPlanDiagnostics.planItemCount === 0) {
        parseWarnings = [
          ...(parseWarnings ?? []),
          "planner_task_plan_missing_on_initial_turn",
        ];
      }
    } catch (error) {
      nextAction = toNextActionFallback(
        error instanceof Error && error.message.trim()
          ? `Planner task model call failed: ${error.message.trim()}`
          : NEXT_ACTION_PLANNER_FALLBACK_REASON,
      );
    }
  }

  const updatedPlannerTaskFrame = nextAction
    ? updateCurrentTaskFrameFromPlanner({
        frame: plannerVisibleTaskFrame ?? state.currentTaskFrame,
        goal: state.goal,
        nextAction,
        latestQuestion: question,
        latestEvidenceSummary: observationContext.latestEvidenceSummary,
      })
    : plannerVisibleTaskFrame ?? state.currentTaskFrame;
  const plannerTaskFrame = mergePlannerTaskFrameProgress(
    plannerVisibleTaskFrame,
    updatedPlannerTaskFrame,
  );
  const hasPriorConversationTurn =
    state.messages.filter(
      (message) => message.role === "user" || message.role === "assistant",
    ).length > 1;
  const plannedTaskFrame = applyPlannerTaskPlan(
    plannerTaskFrame,
    plannerTaskPlanUpdate,
    {
      projectTaskSemantics: hasPriorConversationTurn,
    },
  );
  const nextPlanDiagnostics = getPlannerTaskPlanDiagnostics(plannedTaskFrame);

  logPlannerDecisionDebug({
    runId: state.runId,
    threadId: state.threadId,
    iteration,
    maxIterations,
    taskModelInvoked,
    nextAction,
    rawOutput,
    sanitizedOutput,
    parseErrorReason,
    parseWarnings,
  });

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-next-action-planner",
    ...traceAttemptMeta,
    nodeType: "plan",
    phase: "done",
    label: "下一步动作决策",
    summary: summarizePlannerNextAction({
      nextAction,
      pendingApprovalActive,
      recoveryExhausted,
    }),
    details: {
      exposedToolCount: toolExposure.exposedTools.length,
      exposedToolIds: toolExposure.exposedTools,
      codebaseExploreExposed: toolExposure.exposedTools.includes("codebase_explore"),
      selectedActionType: nextAction?.type ?? null,
      selectedToolId: nextAction?.type === "use_tool" ? nextAction.toolId : null,
      selectedToolTarget:
        nextAction?.type === "use_tool"
          ? getToolTraceTargetPreview(nextAction.toolId, nextAction.args) ?? null
          : nextAction?.type === "retrieve"
            ? nextAction.query
            : nextAction?.type === "ask_user"
              ? nextAction.question
              : null,
      reason: nextAction?.reason ?? null,
      plannerThought: nextAction?.reason ?? null,
      plannerThoughtStreaming: false,
      iteration,
      maxIterations,
      latestEvidenceSummary: latestEvidenceSummary ?? null,
      latestEvidenceContentSource:
        observationContext.latestEvidenceContent?.source ?? null,
      executionHistoryCount: executionHistory.length,
      evidenceHistoryCount: observationContext.evidenceHistory.length,
      accumulatedActionCount:
        observationContext.accumulatedActionLedger.totalExecutionObservations,
      uniqueSemanticActionCount:
        observationContext.accumulatedActionLedger.uniqueSemanticActions,
      repeatedSemanticActionCount:
        observationContext.accumulatedActionLedger.repeatedSemanticActions,
      ...nextPlanDiagnostics,
      planUpdated: Boolean(plannerTaskPlanUpdate),
      boundedConversationHistoryAvailable: hasPriorConversationTurn,
      planRevisionReason: plannerTaskPlanUpdate?.revisionReason ?? null,
      rawOutputPreview: rawOutput ? toPreview(rawOutput) : undefined,
      sanitizedOutputPreview: sanitizedOutput ? toPreview(sanitizedOutput) : undefined,
      parseErrorReason,
      parseWarnings,
      schemaReplanAttemptCount: observationContext.recovery.attemptCount,
      schemaReplanError: observationContext.recovery.schemaError ?? null,
      pendingApprovalActive,
      recoveryExhausted,
      finalizationEvidenceRefs:
        finalizationPacket?.completionProof.flatMap((proof) => proof.evidenceRefs) ?? [],
      allowedActionTypes: [...ALLOWED_ACTION_TYPES],
    },
  });

  return {
    ...(nextAction ? { nextAction } : {}),
    ...(finalizationPacket ? { finalizationPacket } : {}),
    ...(plannedTaskFrame ? { currentTaskFrame: plannedTaskFrame } : {}),
    ...(nextAction?.type === "error" && observationContext.recovery.schemaError
      ? {
          schemaReplanDiagnostics: {
            schemaError: observationContext.recovery.schemaError,
            toolId: observationContext.recovery.toolId,
            invalidAction: observationContext.recovery.invalidAction,
            attemptCount: observationContext.recovery.attemptCount,
          },
        }
      : {}),
    ...(nextAction?.type === "error"
      ? {
          errorMessage: nextAction.reason,
          blockedReason: nextAction.reason,
          errorSourceNodeId: "agent-next-action-planner",
        }
      : {}),
  };
};
