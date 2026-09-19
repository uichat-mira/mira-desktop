import type { AgentGraphOutput } from "../types";
import type { AgentGraphStateType } from "./state";

export type AgentGraphOutputWithRuntimeState = AgentGraphOutput & {
  iterationCount?: number;
};

export const mapGraphStateToOutput = (
  state: AgentGraphStateType,
): AgentGraphOutputWithRuntimeState => {
  const answer = state.answer?.trim() ?? "";
  const status: AgentGraphOutput["status"] = state.pendingApproval
    ? "waiting_approval"
    : state.errorMessage
      ? "failed"
      : state.terminalReason === "waiting_user"
        ? "waiting_user"
        : state.terminalReason === "completed"
          ? "completed"
          : "blocked";
  return {
    answer,
    observations: state.observations ?? [],
    evidence: state.evidence ?? {
      observations: state.observations ?? [],
      toolExecutions: [],
      retrievals: [],
    },
    retrievedChunks: state.retrievedChunks ?? [],
    toolIntent: state.toolIntent,
    pendingApproval: state.pendingApproval,
    policyDecision: state.policyDecision,
    selectedToolId:
      state.lastToolExecution?.toolId ??
      state.pendingApproval?.toolId,
    pendingToolCall: state.pendingToolCall,
    approvedInvocations: state.approvedInvocations,
    conversationWorkdirOutputs: state.conversationWorkdirOutputs,
    lastToolExecution: state.lastToolExecution,
    currentTaskFrame: state.currentTaskFrame,
    finalizationPacket: state.finalizationPacket,
    blockedReason: state.blockedReason,
    terminalReason:
      state.terminalReason ??
      (state.pendingApproval
        ? "waiting_approval"
        : state.errorMessage
          ? "failed_error"
          : state.blockedReason
            ? "blocked"
            : "blocked_missing_planner_terminal_decision"),
    contextBudget: state.contextBudget,
    errorMessage: state.errorMessage,
    errorSourceNodeId: state.errorSourceNodeId,
    status,
    iterationCount: state.iterationCount,
  };
};
