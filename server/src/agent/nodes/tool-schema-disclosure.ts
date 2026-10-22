import {
  createMainAgentCapabilityScope,
  projectAgentCapabilityView,
} from "@/harness/capability-view";
import { promoteCapabilitySchema } from "@/harness/capability-disclosure";
import { listToolDefinitions } from "@/harness/registry";
import type { ToolDefinition } from "@/mcp/core/definitions";
import {
  createProgressiveResolutionState,
  reconcileProgressiveResolutionState,
  resolveAndDiscloseCapability,
} from "@/harness/progressive-resolution-state";
import {
  emitStepNode,
  getTraceAttemptMeta,
  type AgentNodeState,
  type EmitAgentExecutionNode,
} from "../node-runtime";

const getRequestedToolId = (state: AgentNodeState) =>
  state.nextAction?.type === "use_tool" ? state.nextAction.toolId.trim() : "";

const materializeAgentIntentDefinition = (
  definition: ToolDefinition,
): ToolDefinition => {
  const inputSchema = definition.inputSchemaByExposure?.agent_intent;
  return inputSchema ? { ...definition, inputSchema } : definition;
};

const failDisclosure = async (
  state: AgentNodeState,
  emit: EmitAgentExecutionNode | undefined,
  reason: string,
  toolId?: string,
  progressiveResolution = state.progressiveResolution,
): Promise<Partial<AgentNodeState>> => {
  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-tool-schema-disclosure",
    ...getTraceAttemptMeta("agent-tool-schema-disclosure", state),
    nodeType: "reason",
    phase: "error",
    label: "工具 Schema 披露失败",
    summary: reason,
    details: {
      toolId: toolId ?? null,
      progressiveResolutionBudget: progressiveResolution?.budget ?? null,
      unresolvedCapabilityGap:
        progressiveResolution?.unresolvedCapabilityGap ?? null,
    },
  });

  return {
    toolSchemaDisclosure: undefined,
    progressiveResolution,
    errorMessage: reason,
    blockedReason: reason,
    errorSourceNodeId: "agent-tool-schema-disclosure",
  };
};

/**
 * Mid-run metadata -> schema promotion for an exact Planner Tool request.
 *
 * A Planner may name a Tool that is discoverable as compact metadata but does
 * not yet have a full schema in `exposedTools`. This node consumes one
 * Progressive Resolution step, promotes only that exact Tool schema, and forces
 * a bounded Planner replan. It never freezes or executes the request that
 * triggered disclosure; the next Planner turn must emit a fresh exact
 * invocation that still passes Normalize -> Policy -> Approval -> Harness.
 */
export const toolSchemaDisclosureNode = async (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentNodeState>> => {
  const toolId = getRequestedToolId(state);
  if (!toolId) {
    return { toolSchemaDisclosure: undefined };
  }

  const exposure = state.toolExposure;
  if (!exposure) {
    return failDisclosure(
      state,
      emit,
      "Planner requested a Tool before Tool Exposure was prepared.",
      toolId,
    );
  }

  if (exposure.exposedTools.includes(toolId)) {
    return {
      toolSchemaDisclosure: undefined,
      errorMessage: undefined,
      errorSourceNodeId: undefined,
    };
  }

  const metadata = exposure.toolMeta.find((tool) => tool.toolId === toolId);
  const eligibleToolIds = exposure.eligibleTools ?? [];
  if (!metadata || !eligibleToolIds.includes(toolId)) {
    return failDisclosure(
      state,
      emit,
      `Planner requested Tool detail outside the current capability envelope: ${toolId}`,
      toolId,
    );
  }

  // Mid-run disclosure must materialize the same schema shape that the Main
  // Agent would have received during initial agent_intent exposure. Several
  // Tools (notably Terminal and Managed Browser) deliberately hide runtime-only
  // fields such as session ids from that model-facing schema.
  const definitions = listToolDefinitions().map(materializeAgentIntentDefinition);
  const definition = definitions.find((candidate) => candidate.id === toolId);
  if (!definition) {
    return failDisclosure(
      state,
      emit,
      `Planner requested Tool detail for an unregistered Tool: ${toolId}`,
      toolId,
    );
  }

  const currentEligibleToolIds = eligibleToolIds.filter((candidate) =>
    definitions.some((definition) => definition.id === candidate),
  );
  let progressiveResolution = reconcileProgressiveResolutionState({
    state:
      state.progressiveResolution ?? createProgressiveResolutionState(),
    definitions,
    eligibleCapabilityIds: currentEligibleToolIds,
  });

  const view = projectAgentCapabilityView({
    scope: createMainAgentCapabilityScope({
      scopeId: "main_agent",
      eligibleCapabilityIds: currentEligibleToolIds,
      discoverableCapabilityIds: currentEligibleToolIds,
    }),
    definitions,
  });
  const promoted = promoteCapabilitySchema({
    view,
    capabilityId: toolId,
    definitions,
  });
  if (!promoted.transition.schemaMaterialized || !promoted.schema) {
    return failDisclosure(
      state,
      emit,
      `Tool schema cannot be disclosed in the current capability view: ${toolId} (${promoted.transition.reason})`,
      toolId,
      progressiveResolution,
    );
  }

  const disclosure = resolveAndDiscloseCapability(progressiveResolution, {
    capabilityId: toolId,
    target: "schema",
    path: "exact",
    detail: "Planner requested exact Tool schema during the active Agent run",
  });
  progressiveResolution = disclosure.state;
  if (!disclosure.applied) {
    return failDisclosure(
      state,
      emit,
      progressiveResolution.unresolvedCapabilityGap ??
        `Progressive resolution budget blocked Tool schema disclosure: ${toolId}`,
      toolId,
      progressiveResolution,
    );
  }

  const nextToolMeta = exposure.toolMeta.map((tool) =>
    tool.toolId === toolId
      ? { ...tool, inputSchema: promoted.schema!.inputSchema }
      : tool,
  );
  const nextExposure = {
    ...exposure,
    exposedTools: [...exposure.exposedTools, toolId],
    toolMeta: nextToolMeta,
  };
  const reason =
    `Disclosed ${toolId} schema; Planner must replan before invocation.`;

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-tool-schema-disclosure",
    ...getTraceAttemptMeta("agent-tool-schema-disclosure", state),
    nodeType: "reason",
    phase: "done",
    label: "披露工具 Schema",
    summary: reason,
    details: {
      toolId,
      schemaMaterialized: true,
      invokesTool: false,
      progressiveResolutionBudget: progressiveResolution.budget,
    },
  });

  return {
    toolExposure: nextExposure,
    progressiveResolution,
    pendingToolCall: undefined,
    toolSchemaDisclosure: {
      toolId,
      status: "disclosed",
      reason,
    },
    errorMessage: undefined,
    errorSourceNodeId: undefined,
  };
};
