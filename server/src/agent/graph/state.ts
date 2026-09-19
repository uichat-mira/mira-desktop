import {
  Annotation,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol";
import type { RetrievedChunk } from "@/services/rag-nodes";
import type { ContextBudgetAudit } from "@/services/context-budget/index";
import { runWithAgentNodeSpan } from "../observability";
import type { AgentIntentEmbeddingConfig, ToolIntentResult } from "../intent/index";
import type {
  AgentGraphInput,
  AgentGraphOutput,
  AgentFinalizationPacket,
  AgentGoal,
  AgentNextAction,
  AgentObservation,
  AgentRetrievalEvidence,
  AgentSchemaReplanDiagnostics,
  AgentToolExposureState,
  ConversationWorkdirOutputDeclaration,
} from "../types";
import type { AgentRuntimeCheckpoint } from "../runtime-checkpoint";
import type { EmitAgentExecutionNode } from "../node-runtime";
import { createInitialCurrentTaskFrame } from "../node-runtime";
import { isAgentRunCancellationRequested } from "../run-control";

export const AGENT_EMIT_CONFIG_KEY = "agent:emitExecutionNode";
export const DEFAULT_AGENT_MAX_ITERATIONS = 8;

export const AgentGraphStateAnnotation = Annotation.Root({
  runId: Annotation<string>,
  runControlLeaseId: Annotation<string | undefined>,
  threadId: Annotation<string>,
  userId: Annotation<number>,
  goal: Annotation<AgentGoal>,
  currentTaskFrame: Annotation<AgentGraphOutput["currentTaskFrame"] | undefined>,
  messages: Annotation<NormalizedChatMessage[]>,
  requestContextMessages: Annotation<NormalizedChatMessage[] | undefined>,
  params: Annotation<Record<string, unknown> | undefined>,
  knowledgeBaseId: Annotation<string | null | undefined>,
  intentConfig: Annotation<AgentIntentEmbeddingConfig | undefined>,
  workspaceRoot: Annotation<string | null | undefined>,
  conversationWorkdirOutputs: Annotation<ConversationWorkdirOutputDeclaration[] | undefined>,
  requestedToolGroupIds: Annotation<string[] | undefined>,
  toolIntent: Annotation<ToolIntentResult | undefined>,
  toolExposure: Annotation<AgentToolExposureState | undefined>,
  nextAction: Annotation<AgentNextAction | undefined>,
  finalizationPacket: Annotation<AgentFinalizationPacket | undefined>,
  pendingApproval: Annotation<AgentGraphOutput["pendingApproval"] | undefined>,
  policyDecision: Annotation<AgentGraphOutput["policyDecision"] | undefined>,
  pendingToolCall: Annotation<AgentGraphOutput["pendingToolCall"] | undefined>,
  lastToolExecution: Annotation<AgentGraphOutput["lastToolExecution"] | undefined>,
  pendingEvidenceObservation: Annotation<AgentObservation | undefined>,
  pendingToolExecution: Annotation<AgentGraphOutput["lastToolExecution"] | undefined>,
  pendingRetrievalEvidence: Annotation<AgentRetrievalEvidence | undefined>,
  answer: Annotation<string | undefined>,
  retrievedChunks: Annotation<RetrievedChunk[] | undefined>,
  observations: Annotation<AgentObservation[] | undefined>,
  evidence: Annotation<AgentGraphOutput["evidence"] | undefined>,
  blockedReason: Annotation<string | undefined>,
  terminalReason: Annotation<string | undefined>,
  contextBudget: Annotation<ContextBudgetAudit | undefined>,
  errorMessage: Annotation<string | undefined>,
  errorSourceNodeId: Annotation<string | undefined>,
  schemaReplanDiagnostics: Annotation<AgentSchemaReplanDiagnostics | undefined>,
  generatedAnswerEmptyFallback: Annotation<boolean | undefined>,
  approvedInvocations: Annotation<AgentGraphInput["approvedInvocations"] | undefined>,
  iterationCount: Annotation<number | undefined>,
  maxIterations: Annotation<number | undefined>,
});

export type AgentGraphStateType = typeof AgentGraphStateAnnotation.State;

type AgentGraphInputWithCheckpoint = AgentGraphInput & AgentRuntimeCheckpoint;

export const getEmitter = (
  config?: LangGraphRunnableConfig,
): EmitAgentExecutionNode | undefined => {
  const configurable = config?.configurable as Record<string, unknown> | undefined;
  const candidate = configurable?.[AGENT_EMIT_CONFIG_KEY];
  return typeof candidate === "function"
    ? (candidate as EmitAgentExecutionNode)
    : undefined;
};

export const createAgentNode =
  (
    nodeId: string,
    handler: (
      state: AgentGraphStateType,
      emit?: EmitAgentExecutionNode,
    ) => Promise<Partial<AgentGraphStateType>>,
  ) =>
  async (state: AgentGraphStateType, config?: LangGraphRunnableConfig) => {
    if (
      nodeId !== "error" &&
      isAgentRunCancellationRequested(state.runId, state.runControlLeaseId)
    ) {
      return {
        errorMessage: "Agent run was cancelled.",
        errorSourceNodeId: "run-control",
        terminalReason: "cancelled",
      };
    }

    try {
      return await runWithAgentNodeSpan({
        nodeName: nodeId,
        state,
        run: () => handler(state, getEmitter(config)),
        mergeResult: (result) => result,
      });
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorSourceNodeId: nodeId,
      };
    }
  };

export const createInitialAgentGraphState = (
  input: AgentGraphInput,
): AgentGraphStateType => {
  const checkpointInput = input as AgentGraphInputWithCheckpoint;

  return {
    runId: input.runId,
    runControlLeaseId: input.runControlLeaseId,
    threadId: input.threadId,
    userId: input.userId,
    goal: input.goal,
    currentTaskFrame:
      checkpointInput.currentTaskFrame ??
      createInitialCurrentTaskFrame({
        goal: input.goal,
        messages: input.messages,
        workspaceRoot: input.workspaceRoot,
        knowledgeBaseId: input.knowledgeBaseId,
      }),
    messages: input.messages,
    requestContextMessages: input.requestContextMessages,
    params: input.params,
    knowledgeBaseId: input.knowledgeBaseId,
    intentConfig: input.intentConfig,
    workspaceRoot: input.workspaceRoot,
    conversationWorkdirOutputs:
      checkpointInput.conversationWorkdirOutputs ?? input.conversationWorkdirOutputs,
    requestedToolGroupIds: input.requestedToolGroupIds,
    toolIntent: undefined,
    observations: checkpointInput.observations ?? [],
    approvedInvocations: input.approvedInvocations,
    policyDecision: input.policyDecision,
    toolExposure: undefined,
    pendingToolCall: input.pendingToolCall,
    nextAction: undefined,
    finalizationPacket: checkpointInput.finalizationPacket,
    lastToolExecution: checkpointInput.lastToolExecution,
    pendingEvidenceObservation: undefined,
    pendingToolExecution: undefined,
    pendingRetrievalEvidence: undefined,
    answer: undefined,
    retrievedChunks: checkpointInput.retrievedChunks,
    evidence: checkpointInput.evidence,
    blockedReason: undefined,
    terminalReason: undefined,
    contextBudget: undefined,
    errorMessage: undefined,
    errorSourceNodeId: undefined,
    pendingApproval: undefined,
    schemaReplanDiagnostics: undefined,
    generatedAnswerEmptyFallback: false,
    iterationCount: checkpointInput.iterationCount ?? 0,
    maxIterations: input.maxIterations ?? DEFAULT_AGENT_MAX_ITERATIONS,
  };
};
