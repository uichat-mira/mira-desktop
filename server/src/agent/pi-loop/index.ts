import {
  appendPendingEvidence,
  finishWithError,
  finalizeRun,
  generateNode,
  genericTaskSubAgentNode,
  nextActionPlannerNode,
  normalizeAndFreezeToolCall,
  pauseForApproval,
  policyNode,
  prepareContextNode,
  retrieveNode,
  toolNode,
} from "../nodes/index";
import { GENERIC_TASK_DELEGATE_TOOL_ID } from "../delegation/contract.js";
import { isAgentRunCancellationRequested } from "../run-control";
import { mapGraphStateToOutput } from "../graph/output";
import {
  createInitialAgentGraphState,
  type AgentGraphStateType,
} from "../graph/state";
import {
  runWithAgentNodeSpan,
  runWithAgentRunSpan,
} from "../observability";
import type {
  AgentGraphInput,
  AgentGraphOutput,
} from "../types";
import type {
  AgentNodeState,
  EmitAgentExecutionNode,
} from "../node-runtime";

export type PiAgentLoopStepHandler = (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
) => Promise<Partial<AgentNodeState>>;

/**
 * Backward-compatible name for callers that still model Pi-loop dependencies as nodes.
 */
export type PiAgentLoopNodeHandler = PiAgentLoopStepHandler;

/**
 * Pi-loop's internal single-responsibility contract.
 *
 * These are semantic runtime steps, not graph nodes. Trace node ids and external state
 * contracts remain unchanged inside the implementations for compatibility.
 */
export interface PiAgentLoopSemantics {
  prepareContext: PiAgentLoopStepHandler;
  planner: PiAgentLoopStepHandler;
  delegateTask?: PiAgentLoopStepHandler;
  normalizeAndFreeze: PiAgentLoopStepHandler;
  evaluatePolicy: PiAgentLoopStepHandler;
  pauseForApproval: PiAgentLoopStepHandler;
  retrieve: PiAgentLoopStepHandler;
  executeTool: PiAgentLoopStepHandler;
  appendEvidence: PiAgentLoopStepHandler;
  generate: PiAgentLoopStepHandler;
  finalize: PiAgentLoopStepHandler;
  finishWithError: PiAgentLoopStepHandler;
}

/**
 * Legacy dependency-injection contract retained so existing tests and adapters do not
 * need to migrate in lockstep with the Pi-loop orchestration cleanup.
 */
export interface PiAgentLoopNodes {
  prepareContext: PiAgentLoopNodeHandler;
  planner: PiAgentLoopNodeHandler;
  delegateTask?: PiAgentLoopNodeHandler;
  normalizeToolCall: PiAgentLoopNodeHandler;
  policy: PiAgentLoopNodeHandler;
  approval: PiAgentLoopNodeHandler;
  retrieve: PiAgentLoopNodeHandler;
  tool: PiAgentLoopNodeHandler;
  evidence: PiAgentLoopNodeHandler;
  generate: PiAgentLoopNodeHandler;
  evaluate: PiAgentLoopNodeHandler;
  error: PiAgentLoopNodeHandler;
}

const defaultSemantics: PiAgentLoopSemantics = {
  prepareContext: prepareContextNode,
  planner: nextActionPlannerNode,
  delegateTask: genericTaskSubAgentNode,
  normalizeAndFreeze: normalizeAndFreezeToolCall,
  evaluatePolicy: policyNode,
  pauseForApproval,
  retrieve: retrieveNode,
  executeTool: toolNode,
  appendEvidence: appendPendingEvidence,
  generate: generateNode,
  finalize: finalizeRun,
  finishWithError,
};

const isSemanticRuntime = (
  runtime: PiAgentLoopSemantics | PiAgentLoopNodes,
): runtime is PiAgentLoopSemantics => "normalizeAndFreeze" in runtime;

const resolveSemantics = (
  runtime: PiAgentLoopSemantics | PiAgentLoopNodes,
): PiAgentLoopSemantics => {
  if (isSemanticRuntime(runtime)) {
    return {
      ...runtime,
      delegateTask: runtime.delegateTask ?? genericTaskSubAgentNode,
    };
  }

  return {
    prepareContext: runtime.prepareContext,
    planner: runtime.planner,
    delegateTask: runtime.delegateTask ?? genericTaskSubAgentNode,
    normalizeAndFreeze: runtime.normalizeToolCall,
    evaluatePolicy: runtime.policy,
    pauseForApproval: runtime.approval,
    retrieve: runtime.retrieve,
    executeTool: runtime.tool,
    appendEvidence: runtime.evidence,
    generate: runtime.generate,
    finalize: runtime.evaluate,
    finishWithError: runtime.error,
  };
};

const mergeStatePatch = (
  state: AgentGraphStateType,
  patch: Partial<AgentNodeState>,
) => {
  Object.assign(state, patch);
};

const toStepFailurePatch = (
  stepName: string,
  error: unknown,
): Partial<AgentNodeState> => ({
  errorMessage: error instanceof Error ? error.message : String(error),
  errorSourceNodeId: stepName,
});

const runStep = async (input: {
  traceNodeName: string;
  handler: PiAgentLoopStepHandler;
  state: AgentGraphStateType;
  emit?: EmitAgentExecutionNode;
}) => {
  if (
    input.traceNodeName !== "error" &&
    isAgentRunCancellationRequested(
      input.state.runId,
      input.state.runControlLeaseId,
    )
  ) {
    mergeStatePatch(input.state, {
      errorMessage: "Agent run was cancelled.",
      errorSourceNodeId: "run-control",
      terminalReason: "cancelled",
    });
    return;
  }

  try {
    const patch = await runWithAgentNodeSpan({
      nodeName: input.traceNodeName,
      state: input.state,
      run: () => input.handler(input.state, input.emit),
      mergeResult: (result) => result,
    });
    mergeStatePatch(input.state, patch);
  } catch (error) {
    mergeStatePatch(
      input.state,
      toStepFailurePatch(input.traceNodeName, error),
    );
  }
};

const createPiAgentLoopRunner = (steps: PiAgentLoopSemantics) => {
  const finishRunWithError = async (
    state: AgentGraphStateType,
    emit?: EmitAgentExecutionNode,
  ): Promise<AgentGraphOutput> => {
    await runStep({
      traceNodeName: "error",
      handler: steps.finishWithError,
      state,
      emit,
    });
    return mapGraphStateToOutput(state);
  };

  const finishRunWithAnswer = async (
    state: AgentGraphStateType,
    emit?: EmitAgentExecutionNode,
  ): Promise<AgentGraphOutput> => {
    await runStep({
      traceNodeName: "generate",
      handler: steps.generate,
      state,
      emit,
    });
    if (state.errorMessage) {
      return finishRunWithError(state, emit);
    }

    await runStep({
      traceNodeName: "evaluate",
      handler: steps.finalize,
      state,
      emit,
    });
    if (state.errorMessage) {
      return finishRunWithError(state, emit);
    }

    return mapGraphStateToOutput(state);
  };

  const pauseRunForApproval = async (
    state: AgentGraphStateType,
    emit?: EmitAgentExecutionNode,
  ): Promise<AgentGraphOutput> => {
    await runStep({
      traceNodeName: "approval",
      handler: steps.pauseForApproval,
      state,
      emit,
    });
    if (state.errorMessage) {
      return finishRunWithError(state, emit);
    }
    return mapGraphStateToOutput(state);
  };

  const commitPendingEvidence = async (
    state: AgentGraphStateType,
    emit?: EmitAgentExecutionNode,
  ) => {
    await runStep({
      traceNodeName: "evidenceStage",
      handler: steps.appendEvidence,
      state,
      emit,
    });
  };

  const executeFrozenToolCall = async (
    state: AgentGraphStateType,
    emit?: EmitAgentExecutionNode,
  ): Promise<AgentGraphOutput | null> => {
    await runStep({
      traceNodeName: "policyStep",
      handler: steps.evaluatePolicy,
      state,
      emit,
    });

    if (state.pendingApproval) {
      return pauseRunForApproval(state, emit);
    }
    if (state.errorMessage) {
      return finishRunWithError(state, emit);
    }
    if (state.policyDecision?.type !== "allow") {
      mergeStatePatch(state, {
        errorMessage: "Policy did not allow the frozen Planner tool call.",
        errorSourceNodeId: "policyStep",
      });
      return finishRunWithError(state, emit);
    }

    await runStep({
      traceNodeName: "tool",
      handler: steps.executeTool,
      state,
      emit,
    });

    if (state.pendingApproval) {
      return pauseRunForApproval(state, emit);
    }

    await commitPendingEvidence(state, emit);

    if (state.errorMessage) {
      return finishRunWithError(state, emit);
    }

    return null;
  };

  const executeDelegatedTask = async (
    state: AgentGraphStateType,
    emit?: EmitAgentExecutionNode,
  ): Promise<AgentGraphOutput | null> => {
    await runStep({
      traceNodeName: "genericTaskSubAgent",
      handler: steps.delegateTask ?? genericTaskSubAgentNode,
      state,
      emit,
    });

    // The delegated observation is part of the parent evidence ledger even when
    // the worker pauses for approval or terminates. Commit it before deciding the
    // parent boundary so resume and UI state see the same task-local facts.
    if (
      state.pendingEvidenceObservation ||
      state.pendingToolExecution ||
      state.pendingRetrievalEvidence
    ) {
      await commitPendingEvidence(state, emit);
    }

    if (state.pendingApproval) {
      return pauseRunForApproval(state, emit);
    }
    if (state.errorMessage) {
      return finishRunWithError(state, emit);
    }
    if (state.schemaReplanDiagnostics) {
      return null;
    }
    if (state.nextAction?.type === "ask_user") {
      return finishRunWithAnswer(state, emit);
    }

    // completed, insufficient_evidence and recoverable failure all return to
    // Main Planner. The worker owns only its bounded task, never global finish.
    return null;
  };

  const run = async (input: AgentGraphInput): Promise<AgentGraphOutput> =>
    runWithAgentRunSpan({
      graphInput: input,
      run: async () => {
        const state = createInitialAgentGraphState(input);
        const emit = input.onExecutionNode;

        await runStep({
          traceNodeName: "prepareContext",
          handler: steps.prepareContext,
          state,
          emit,
        });
        if (state.errorMessage) {
          return finishRunWithError(state, emit);
        }

        // A subAgent may surface an approval boundary while preparing its
        // isolated execution. Pause before the Parent loop interprets the
        // frozen Skill invocation as a normal Planner/Harness tool call.
        if (state.pendingApproval) {
          return pauseRunForApproval(state, emit);
        }

        if (state.pendingToolCall) {
          const resumedResult = await executeFrozenToolCall(state, emit);
          if (resumedResult) {
            return resumedResult;
          }
        }

        const preparedAction = state.nextAction;

        // A completed subAgent returns a frozen Parent finalization packet from
        // prepareContext. Task-local construction is already done: go straight
        // to Generate instead of handing control back to Main Planner.
        if (preparedAction?.type === "answer" && state.finalizationPacket) {
          return finishRunWithAnswer(state, emit);
        }

        // needs_input is also a terminal subAgent handoff for this turn. Generate
        // already has a deterministic ask_user path, so Main Planner must not
        // rewrite the Skill/Flow-authored question or take construction ownership.
        if (preparedAction?.type === "ask_user") {
          return finishRunWithAnswer(state, emit);
        }

        while (true) {
          await runStep({
            traceNodeName: "nextActionPlanner",
            handler: steps.planner,
            state,
            emit,
          });

          if (state.pendingApproval) {
            return pauseRunForApproval(state, emit);
          }
          if (state.errorMessage) {
            return finishRunWithError(state, emit);
          }

          switch (state.nextAction?.type) {
            case "answer":
            case "ask_user":
              return finishRunWithAnswer(state, emit);

            case "retrieve":
              await runStep({
                traceNodeName: "retrieve",
                handler: steps.retrieve,
                state,
                emit,
              });
              await commitPendingEvidence(state, emit);
              if (state.errorMessage) {
                return finishRunWithError(state, emit);
              }
              continue;

            case "use_tool": {
              if (state.nextAction.toolId === GENERIC_TASK_DELEGATE_TOOL_ID) {
                const delegatedResult = await executeDelegatedTask(state, emit);
                if (delegatedResult) {
                  return delegatedResult;
                }
                continue;
              }

              await runStep({
                traceNodeName: "toolCallNormalize",
                handler: steps.normalizeAndFreeze,
                state,
                emit,
              });

              if (state.errorMessage) {
                return finishRunWithError(state, emit);
              }
              if (state.schemaReplanDiagnostics) {
                continue;
              }
              if (!state.pendingToolCall) {
                mergeStatePatch(state, {
                  errorMessage:
                    "Pi agent loop did not receive a frozen pendingToolCall after normalization.",
                  errorSourceNodeId: "toolCallNormalize",
                });
                return finishRunWithError(state, emit);
              }

              const toolResult = await executeFrozenToolCall(state, emit);
              if (toolResult) {
                return toolResult;
              }
              continue;
            }

            case "error":
              return finishRunWithError(state, emit);

            default:
              mergeStatePatch(state, {
                errorMessage:
                  "Pi agent loop planner did not return a supported next action.",
                errorSourceNodeId: "nextActionPlanner",
              });
              return finishRunWithError(state, emit);
          }
        }
      },
      summarizeResult: (result) => result,
    });

  return { run };
};

export const createPiAgentLoop = (
  runtime: PiAgentLoopSemantics | PiAgentLoopNodes = defaultSemantics,
) => createPiAgentLoopRunner(resolveSemantics(runtime));

export const piAgentLoop = createPiAgentLoop();
