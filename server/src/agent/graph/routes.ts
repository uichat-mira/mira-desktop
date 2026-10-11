import { END } from "@langchain/langgraph";
import { GENERIC_TASK_DELEGATE_TOOL_ID } from "../delegation/contract.js";
import type { AgentGraphStateType } from "./state";

const hasFrozenPendingToolCall = (
  pendingToolCall: AgentGraphStateType["pendingToolCall"],
) =>
  Boolean(
    pendingToolCall &&
      pendingToolCall.source === "planner" &&
      "status" in pendingToolCall &&
      pendingToolCall.status === "frozen",
  );

export const routeAfterPrepareContext = (state: AgentGraphStateType) => {
  if (state.errorMessage) {
    return "error";
  }

  if (hasFrozenPendingToolCall(state.pendingToolCall)) {
    return "policyStep";
  }

  // Approval resume may finish the delegated worker at a structured
  // needs_input boundary. Preserve that exact question and skip Main Planner.
  if (state.nextAction?.type === "ask_user") {
    return "generate";
  }

  return "nextActionPlanner";
};

export const routeAfterNextAction = (state: AgentGraphStateType) => {
  if (state.errorMessage) {
    return "error";
  }

  if (state.pendingApproval) {
    return "approval";
  }

  switch (state.nextAction?.type) {
    case "answer":
      return "generate";
    case "retrieve":
      return "retrieve";
    case "activate_skill":
      return "activateSkill";
    case "ask_user":
      return "generate";
    case "use_tool":
      return state.nextAction.toolId === GENERIC_TASK_DELEGATE_TOOL_ID
        ? "genericTaskSubAgent"
        : "toolCallNormalize";
    case "error":
      return "error";
    default:
      return "error";
  }
};

export const routeAfterGenericTaskSubAgent = (state: AgentGraphStateType) => {
  // Commit the subAgent observation before pausing so the approval screen and
  // resumed run both retain the task-local trace. routeAfterEvidence then goes
  // straight to Approval without invoking Main Planner again.
  if (state.pendingEvidenceObservation) {
    return "evidenceStage";
  }

  if (state.schemaReplanDiagnostics) {
    return "nextActionPlanner";
  }

  if (state.errorMessage) {
    return "error";
  }

  if (state.pendingApproval) {
    return "approval";
  }

  return "error";
};

export const routeAfterToolCallNormalize = (state: AgentGraphStateType) => {
  if (state.errorMessage) {
    return "error";
  }

  if (state.schemaReplanDiagnostics) {
    return "nextActionPlanner";
  }

  if (!state.pendingToolCall) {
    return "error";
  }

  return "policyStep";
};

export const routeAfterPolicy = (state: AgentGraphStateType) => {
  if (state.errorMessage) {
    return "error";
  }

  if (state.pendingApproval) {
    return "approval";
  }

  if (
    state.policyDecision?.type === "allow" &&
    state.policyDecision.toolId === state.pendingToolCall?.toolId &&
    state.policyDecision.inputHash === state.pendingToolCall?.inputHash
  ) {
    return "tool";
  }

  return "error";
};

export const routeAfterTool = (state: AgentGraphStateType) => {
  if (state.pendingApproval) {
    return "approval";
  }

  if (state.lastToolExecution?.status === "failed") {
    if (state.lastToolExecution.failureKind === "terminal") {
      return "evidenceStage";
    }
  }

  if (state.errorMessage) {
    return state.pendingToolExecution ? "evidenceStage" : "error";
  }

  return "evidenceStage";
};

export const routeAfterRetrieve = (state: AgentGraphStateType) => {
  if (state.errorMessage) {
    return "error";
  }

  return "evidenceStage";
};

export const routeAfterEvidence = (state: AgentGraphStateType) => {
  if (state.errorMessage) {
    return "error";
  }

  if (state.pendingApproval) {
    return "approval";
  }

  // A delegated needs_input action is already a governed Parent decision.
  // Evidence must be committed first, but Main Planner must not rewrite it.
  if (state.nextAction?.type === "ask_user") {
    return "generate";
  }

  return "nextActionPlanner";
};

export const routeAfterGenerate = (state: AgentGraphStateType) => {
  if (state.errorMessage) {
    return "error";
  }

  return "evaluate";
};

export const routeAfterEvaluate = (state: AgentGraphStateType) => {
  if (state.errorMessage) {
    return "error";
  }

  if (state.pendingApproval) {
    return END;
  }

  return END;
};

export const routeAfterApproval = (state: AgentGraphStateType) => {
  if (state.errorMessage) {
    return "error";
  }

  return END;
};
