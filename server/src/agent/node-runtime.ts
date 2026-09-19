import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol";
import type { RetrievedChunk } from "@/services/rag-nodes";
import type { ContextBudgetAudit } from "@/services/context-budget/index";
import { toAgentExecutionNode } from "./trace";
export {
  getToolTraceTargetPreview,
  summarizePlannerNextAction,
  summarizeToolExecutionCompleted,
  summarizeToolExecutionFailure,
  summarizeToolExecutionStart,
  summarizeToolExecutionWaitingApproval,
} from "./trace";
import { getEvidencePayload, getLatestEvidenceSummary } from "./evidence";
import { buildPlannerEvidenceCatalog } from "./finalization";
import { buildPlannerRecoveryContext } from "./recovery";
import type {
  AgentIntentEmbeddingConfig,
  ToolIntentResult,
} from "./intent/index";
import type {
  AgentApprovedInvocation,
  AgentApprovalRequest,
  AgentEvidencePayload,
  AgentExecutionObservation,
  AgentEvidenceSummary,
  AgentFinalizationPacket,
  AgentGoal,
  AgentNextAction,
  AgentObservation,
  AgentPolicyDecision,
  AgentRetrievalEvidence,
  AgentSchemaReplanDiagnostics,
  AgentToolCallRequest,
  AgentToolExecutionResult,
  AgentToolExposureState,
  ConversationWorkdirOutputDeclaration,
  CurrentTaskFrame,
  CurrentTaskFrameConfirmedObject,
  PlannerObservationContext,
} from "./types";

const getLatestUserQuestionText = (
  messages: NormalizedChatMessage[] | undefined,
) => {
  const latest = messages
    ? [...messages].reverse().find((message) => message.role === "user")
    : undefined;
  const question = latest?.content.trim();
  return question ? question : undefined;
};

const getCurrentTaskFrameGoalText = (input: {
  goal: AgentGoal;
  latestQuestion?: string;
}) => {
  const latestQuestion = input.latestQuestion?.trim();
  return latestQuestion || input.goal.text;
};

const getCurrentTaskFrameGlobalGoalText = (input: {
  frame?: CurrentTaskFrame;
  goal: AgentGoal;
}) => input.frame?.globalGoal?.trim() || input.goal.text;

export interface AgentNodeState {
  runId: string;
  runControlLeaseId?: string;
  threadId: string;
  userId: number;
  goal: AgentGoal;
  question?: string;
  currentTaskFrame?: CurrentTaskFrame;
  messages: NormalizedChatMessage[];
  requestContextMessages?: NormalizedChatMessage[];
  params?: Record<string, unknown>;
  knowledgeBaseId?: string | null;
  intentConfig?: AgentIntentEmbeddingConfig;
  workspaceRoot?: string | null;
  conversationWorkdirOutputs?: ConversationWorkdirOutputDeclaration[];
  requestedToolGroupIds?: string[];
  toolIntent?: ToolIntentResult;
  toolExposure?: AgentToolExposureState;
  nextAction?: AgentNextAction;
  finalizationPacket?: AgentFinalizationPacket;
  answer?: string;
  retrievedChunks?: RetrievedChunk[];
  observations?: AgentObservation[];
  blockedReason?: string;
  terminalReason?: string;
  pendingApproval?: AgentApprovalRequest;
  approvedInvocations?: AgentApprovedInvocation[];
  policyDecision?: AgentPolicyDecision;
  pendingToolCall?: AgentToolCallRequest;
  lastToolExecution?: AgentToolExecutionResult;
  pendingEvidenceObservation?: AgentObservation;
  pendingToolExecution?: AgentToolExecutionResult;
  pendingRetrievalEvidence?: AgentRetrievalEvidence;
  evidence?: AgentEvidencePayload;
  contextBudget?: ContextBudgetAudit;
  errorMessage?: string;
  errorSourceNodeId?: string;
  schemaReplanDiagnostics?: AgentSchemaReplanDiagnostics;
  generatedAnswerEmptyFallback?: boolean;
  iterationCount?: number;
  maxIterations?: number;
}

export type AgentGraphState = AgentNodeState;

const buildExecutionObservationId = (input: {
  actionType: AgentExecutionObservation["actionType"];
  createdAt: string;
  stepId?: string;
  toolId?: string;
  toolCallId?: string;
  inputHash?: string;
}) =>
  [
    input.actionType,
    input.toolCallId ?? input.stepId ?? input.toolId ?? input.inputHash ?? "unknown",
    input.createdAt,
  ].join(":");

const getExecutionObservationActionType = (
  stepId: string | undefined,
): AgentExecutionObservation["actionType"] => {
  switch (stepId) {
    case "retrieve":
      return "retrieve";
    case "generate":
      return "generate";
    case "approval":
      return "approval";
    case "tool":
    default:
      return "tool";
  }
};

const getExecutionObservationStatusFromObservation = (
  observation: AgentObservation,
): AgentExecutionObservation["status"] => {
  switch (observation.status) {
    case "ok":
      return "completed";
    case "partial":
      return "failed_recoverable";
    case "blocked":
      return observation.stepId === "approval"
        ? "waiting_approval"
        : "failed_terminal";
    case "failed":
    default:
      return observation.stepId === "generate"
        ? "failed_terminal"
        : "failed_recoverable";
  }
};

export const toExecutionObservationFromObservation = (
  observation: AgentObservation,
): AgentExecutionObservation => ({
  id: buildExecutionObservationId({
    actionType: getExecutionObservationActionType(observation.stepId),
    createdAt: observation.createdAt,
    stepId: observation.stepId,
  }),
  source: "observation",
  actionType: getExecutionObservationActionType(observation.stepId),
  status: getExecutionObservationStatusFromObservation(observation),
  createdAt: observation.createdAt,
  stepId: observation.stepId,
  resultPreview: observation.facts.slice(0, 3),
  summary: observation.summary,
  facts: observation.facts.slice(0, 5),
  errorMessage: observation.errorMessage,
  recoverable: getExecutionObservationStatusFromObservation(observation) === "failed_recoverable",
  suggestedNextActions:
    getExecutionObservationStatusFromObservation(observation) === "failed_terminal"
      ? ["report_terminal_failure"]
      : ["review_latest_evidence", "plan_next_action"],
});

export const toExecutionObservationFromToolExecution = (
  execution: AgentToolExecutionResult,
): AgentExecutionObservation => {
  const status: AgentExecutionObservation["status"] =
    execution.status === "completed"
      ? "completed"
      : execution.status === "awaiting_approval"
        ? "waiting_approval"
        : execution.status === "denied"
          ? "failed_terminal"
          : execution.failureKind === "terminal"
            ? "failed_terminal"
            : "failed_recoverable";
  const createdAt = execution.finishedAt || execution.startedAt;

  return {
    id: buildExecutionObservationId({
      actionType: "tool",
      createdAt,
      toolId: execution.toolId,
      toolCallId: execution.toolCallId,
      inputHash: execution.inputHash,
    }),
    source: "tool_execution",
    actionType: "tool",
    status,
    createdAt,
    toolId: execution.toolId,
    toolCallId: execution.toolCallId,
    inputHash: execution.inputHash,
    argsPreview: execution.args,
    resultPreview: execution.summary?.data ?? execution.result,
    summary: execution.summary,
    errorMessage: execution.errorMessage,
    errorCode: execution.status === "denied" ? "denied" : undefined,
    recoverable: status === "failed_recoverable",
    suggestedNextActions:
      status === "completed"
        ? ["review_tool_result", "plan_next_action"]
        : status === "waiting_approval"
          ? ["wait_for_approval", "resume_after_approval"]
          : status === "failed_terminal"
            ? ["report_terminal_failure"]
            : ["inspect_failure_cause", "retry_with_adjustment", "switch_action"],
    reason: execution.approval?.reason,
  };
};

export const toExecutionObservationFromRetrievalResult = (
  retrieval: AgentRetrievalEvidence,
): AgentExecutionObservation => {
  const status: AgentExecutionObservation["status"] =
    retrieval.chunkCount > 0 ? "completed" : "failed_recoverable";

  return {
    id: buildExecutionObservationId({
      actionType: "retrieve",
      createdAt: retrieval.createdAt,
      inputHash: retrieval.query,
    }),
    source: "retrieval",
    actionType: "retrieve",
    status,
    createdAt: retrieval.createdAt,
    argsPreview: {
      query: retrieval.query,
      knowledgeBaseId: retrieval.knowledgeBaseId,
    },
    resultPreview: {
      query: retrieval.query,
      chunkCount: retrieval.chunkCount,
      documents: retrieval.chunks.slice(0, 3).map((chunk) => chunk.documentName),
    },
    summary: retrieval.summary,
    recoverable: status === "failed_recoverable",
    suggestedNextActions:
      status === "completed"
        ? ["review_retrieval_evidence", "plan_next_action"]
        : ["refine_retrieval_query", "switch_to_local_evidence_or_tool"],
  };
};

export const toExecutionObservationFromPendingApproval = (
  approval: AgentApprovalRequest,
  summary?: AgentEvidenceSummary,
): AgentExecutionObservation => ({
  id: buildExecutionObservationId({
    actionType: "approval",
    createdAt: approval.createdAt,
    stepId: approval.stepId,
    toolId: approval.toolId,
    toolCallId: approval.toolCallId,
    inputHash: approval.inputHash,
  }),
  source: "approval",
  actionType: "approval",
  status: "waiting_approval",
  createdAt: approval.createdAt,
  stepId: approval.stepId,
  toolId: approval.toolId,
  toolCallId: approval.toolCallId,
  inputHash: approval.inputHash,
  argsPreview: approval.input,
  summary,
  resultPreview: {
    toolId: approval.toolId,
    reason: approval.reason,
  },
  recoverable: false,
  suggestedNextActions: ["wait_for_approval", "resume_after_approval"],
  reason: approval.reason,
});

const comparePlannerObservationItems = (
  left: AgentExecutionObservation,
  right: AgentExecutionObservation,
) => left.createdAt.localeCompare(right.createdAt);

/**
 * Fact-source boundary for T021:
 * - retrieve executor facts come from evidence.retrievals
 * - tool executor facts come from evidence.toolExecutions
 * - approval facts come from pendingApproval
 *
 * Planner must not consume those scattered structures directly.
 * Planner only consumes the unified execution-observation view built here.
 */
export const buildExecutionObservationView = (
  state: Pick<
    AgentNodeState,
    | "evidence"
    | "pendingApproval"
  >,
): AgentExecutionObservation[] => {
  const evidence = getEvidencePayload(state);
  const items: AgentExecutionObservation[] = [];

  for (const retrieval of evidence.retrievals) {
    items.push(toExecutionObservationFromRetrievalResult(retrieval));
  }

  for (const execution of evidence.toolExecutions) {
    items.push(toExecutionObservationFromToolExecution(execution));
  }

  if (state.pendingApproval) {
    items.push(toExecutionObservationFromPendingApproval(state.pendingApproval));
  }

  items.sort(comparePlannerObservationItems);
  return items;
};

export const createInitialCurrentTaskFrame = (input: {
  goal: AgentGoal;
  latestQuestion?: string;
  messages?: NormalizedChatMessage[];
  workspaceRoot?: string | null;
  knowledgeBaseId?: string | null;
}): CurrentTaskFrame => {
  const confirmedObjects: CurrentTaskFrameConfirmedObject[] = [];
  const currentGoal = getCurrentTaskFrameGoalText({
    goal: input.goal,
    latestQuestion: input.latestQuestion ?? getLatestUserQuestionText(input.messages),
  });

  if (input.workspaceRoot) {
    confirmedObjects.push({
      type: "file",
      id: input.workspaceRoot,
      label: input.workspaceRoot,
      confidence: 1,
    });
  }

  if (input.knowledgeBaseId) {
    confirmedObjects.push({
      type: "knowledge",
      id: input.knowledgeBaseId,
      label: input.knowledgeBaseId,
      confidence: 1,
    });
  }

  return {
    globalGoal: input.goal.text,
    currentGoal,
    currentSubtask: "Prepare context and determine the next action.",
    currentBlocker: undefined,
    confirmedObjects,
    completionCriteria:
      input.goal.successCriteria.length > 0 ? [...input.goal.successCriteria] : [currentGoal],
  };
};

const getPlannerSubtask = (nextAction: AgentNextAction): string => {
  switch (nextAction.type) {
    case "retrieve":
      return `Retrieve evidence for: ${nextAction.query}`;
    case "use_tool":
      return `Run ${nextAction.toolId} with reviewed parameters.`;
    case "answer":
      return "Draft the final answer from the current evidence.";
    case "ask_user":
      return "Ask the user for the missing information needed to continue.";
    case "error":
      return "Report why the planner cannot continue safely.";
    default:
      return "Determine the next action.";
  }
};

const buildCurrentTaskFrameCoverageView = (input: {
  frame: CurrentTaskFrame;
  goal: AgentGoal;
  latestQuestion?: string;
  latestEvidenceSummary?: AgentEvidenceSummary;
}) => {
  const globalGoal = getCurrentTaskFrameGlobalGoalText({
    frame: input.frame,
    goal: input.goal,
  });
  const currentGoal = getCurrentTaskFrameGoalText({
    goal: input.goal,
    latestQuestion: input.latestQuestion,
  });
  const completionCriteria =
    input.frame.completionCriteria.length > 0
      ? [...input.frame.completionCriteria]
      : input.goal.successCriteria.length > 0
        ? [...input.goal.successCriteria]
        : [globalGoal];
  const latestEvidenceSummary = input.latestEvidenceSummary;
  const coveredProgress = [
    ...(latestEvidenceSummary
      ? [
          latestEvidenceSummary.actionTaken,
          ...latestEvidenceSummary.keyFindings,
          ...(latestEvidenceSummary.facts ?? []),
        ]
      : []),
  ]
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .slice(0, 5);
  const remainingWork = [...(latestEvidenceSummary?.gaps ?? [])]
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .slice(0, 5);

  return {
    globalGoal,
    currentGoal,
    completionCriteria,
    coveredProgress,
    remainingWork,
  };
};

export const refreshCurrentTaskFrameFromEvidence = (input: {
  frame: CurrentTaskFrame | undefined;
  goal: AgentGoal;
  latestQuestion?: string;
  latestEvidenceSummary?: AgentEvidenceSummary;
}): CurrentTaskFrame | undefined => {
  if (!input.frame) {
    return input.frame;
  }

  const coverageView = buildCurrentTaskFrameCoverageView(input as {
    frame: CurrentTaskFrame;
    goal: AgentGoal;
    latestQuestion?: string;
    latestEvidenceSummary?: AgentEvidenceSummary;
  });

  return {
    ...input.frame,
    globalGoal: coverageView.globalGoal,
    currentGoal: coverageView.currentGoal,
    completionCriteria: coverageView.completionCriteria,
    coveredProgress:
      coverageView.coveredProgress.length > 0 ? coverageView.coveredProgress : undefined,
    remainingWork:
      coverageView.remainingWork.length > 0 ? coverageView.remainingWork : undefined,
  };
};

/**
 * PlannerNode is the only runtime writer for goal/subtask/completion state.
 * Executor nodes report facts through evidence and observations instead.
 */
export const updateCurrentTaskFrameFromPlanner = (input: {
  frame: CurrentTaskFrame | undefined;
  goal: AgentGoal;
  nextAction: AgentNextAction;
  latestQuestion?: string;
  latestEvidenceSummary?: AgentEvidenceSummary;
}): CurrentTaskFrame | undefined => {
  if (!input.frame) {
    return input.frame;
  }

  const coverageView = buildCurrentTaskFrameCoverageView({
    frame: input.frame,
    goal: input.goal,
    latestQuestion: input.latestQuestion,
    latestEvidenceSummary: input.latestEvidenceSummary,
  });

  return {
    ...input.frame,
    globalGoal: coverageView.globalGoal,
    currentGoal: coverageView.currentGoal,
    currentSubtask: getPlannerSubtask(input.nextAction),
    completionCriteria: coverageView.completionCriteria,
    coveredProgress:
      coverageView.coveredProgress.length > 0 ? coverageView.coveredProgress : undefined,
    remainingWork:
      coverageView.remainingWork.length > 0 ? coverageView.remainingWork : undefined,
    currentBlocker:
      input.nextAction.type === "error"
        ? input.nextAction.reason
        : input.frame.currentBlocker,
  };
};

export const buildPlannerObservationContext = (
  state: Pick<
    AgentNodeState,
    | "currentTaskFrame"
    | "observations"
    | "evidence"
    | "lastToolExecution"
    | "pendingApproval"
    | "schemaReplanDiagnostics"
  >,
): PlannerObservationContext => {
  const latestEvidenceSummary = getLatestEvidenceSummary(state);
  const evidence = getEvidencePayload(state);
  const items = buildExecutionObservationView(state);
  const recentObservations = items.slice(-5).reverse();
  const latestObservation = recentObservations[0];
  const latestToolExecution = evidence.toolExecutions.at(-1);

  return {
    currentTaskFrame: state.currentTaskFrame,
    latestObservation,
    recentObservations,
    evidenceCatalog: buildPlannerEvidenceCatalog(evidence),
    latestEvidenceSummary,
    latestToolCall: latestToolExecution
      ? {
          toolId: latestToolExecution.toolId,
          args: latestToolExecution.args,
          inputHash: latestToolExecution.inputHash,
          status: latestToolExecution.status,
          resultSummary: latestToolExecution.summary,
          failureKind: latestToolExecution.failureKind,
          failureCode: latestToolExecution.failureCode,
          retryCount: latestToolExecution.recoveryAttemptCount ?? 0,
        }
      : undefined,
    recovery: buildPlannerRecoveryContext(state),
    pendingApproval: state.pendingApproval
      ? {
          toolId: state.pendingApproval.toolId,
          inputHash: state.pendingApproval.inputHash,
          reason: state.pendingApproval.reason,
        }
      : undefined,
  };
};

export type EmitAgentExecutionNode = (
  event: ReturnType<typeof toAgentExecutionNode>,
) => Promise<void> | void;

export const getIterativeNodeId = (
  baseNodeId: string,
  state: Pick<AgentNodeState, "iterationCount">,
) => `${baseNodeId}-${state.iterationCount ?? 0}`;

export const getTraceAttemptMeta = (
  slotKey: string,
  state: Pick<AgentNodeState, "iterationCount">,
) => {
  const iteration = state.iterationCount ?? 0;
  return {
    slotKey,
    attemptKey: `${slotKey}#${iteration}`,
    iteration,
  } as const;
};

export const emitStepNode = async (
  emit: EmitAgentExecutionNode | undefined,
  input: Parameters<typeof toAgentExecutionNode>[0],
) => {
  await emit?.(toAgentExecutionNode(input));
};
