import {
  projectHarnessResultForLlm,
  type HarnessLlmContent,
} from "@/harness/llm-content";
import { getHarnessInvocation } from "@/harness/invocations";
import type { StructuredInvocationErrorDetail } from "@/mcp/core/definitions";
import type {
  AgentNodeState,
  EmitAgentExecutionNode,
} from "../node-runtime";
import type { AgentToolExecutionResult } from "../types";
import { toolNode as baseToolNode } from "./tool-node";

export type AgentToolExecutionWithLlmContent = AgentToolExecutionResult & {
  llmContent?: HarnessLlmContent;
  invocationError?: StructuredInvocationErrorDetail;
};

export const attachHarnessLlmContentToExecution = (
  execution: AgentToolExecutionResult | undefined,
): AgentToolExecutionWithLlmContent | undefined => {
  if (!execution) {
    return execution;
  }

  let enriched = execution as AgentToolExecutionWithLlmContent;
  if (execution.status === "completed" && !enriched.llmContent) {
    const llmContent = projectHarnessResultForLlm(execution.result);
    if (llmContent) {
      enriched = { ...enriched, llmContent };
    }
  }

  if (execution.status === "failed" && execution.invocationId) {
    const error = getHarnessInvocation(execution.invocationId)?.error;
    if (
      error &&
      typeof error.code === "string" &&
      typeof error.retryable === "boolean"
    ) {
      enriched = {
        ...enriched,
        invocationError: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.suggestedAction === undefined
            ? {}
            : { suggestedAction: error.suggestedAction }),
        },
      };
    }
  }

  return enriched;
};

export const harnessAwareToolNode = async (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentNodeState>> => {
  const patch = await baseToolNode(state, emit);
  const pendingToolExecution = attachHarnessLlmContentToExecution(
    patch.pendingToolExecution,
  );
  const lastToolExecution =
    patch.lastToolExecution === patch.pendingToolExecution
      ? pendingToolExecution
      : attachHarnessLlmContentToExecution(patch.lastToolExecution);

  return {
    ...patch,
    ...(Object.prototype.hasOwnProperty.call(patch, "pendingToolExecution")
      ? { pendingToolExecution }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "lastToolExecution")
      ? { lastToolExecution }
      : {}),
  };
};
