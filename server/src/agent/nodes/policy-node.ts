/**
 * 策略审批节点：根据工具策略判断是否需要人工审批，并生成审批请求。
 */
import { listToolDefinitions } from "@/harness/registry";
import { evaluateAgentToolPolicy } from "../policy";
import {
  emitStepNode,
  getIterativeNodeId,
  getTraceAttemptMeta,
  type AgentNodeState,
  type EmitAgentExecutionNode,
} from "../node-runtime";
import type {
  AgentApprovedInvocation,
  AgentApprovalRequest,
  AgentToolCallRequest,
  PendingToolCall,
} from "../types";

const nowIso = () => new Date().toISOString();

const createPendingApproval = (input: {
  runId: string;
  toolId: string;
  toolCallId: string;
  reason: string;
  args: Record<string, unknown>;
  inputHash: string;
}): AgentApprovalRequest => ({
  id: crypto.randomUUID(),
  runId: input.runId,
  stepId: "approval",
  toolId: input.toolId,
  toolCallId: input.toolCallId,
  reason: input.reason,
  input: input.args,
  inputHash: input.inputHash,
  createdAt: nowIso(),
});

const hasApprovedInvocation = (
  approvedInvocations: AgentApprovedInvocation[] | undefined,
  pendingToolCall: AgentToolCallRequest,
): boolean =>
  approvedInvocations?.some(
    (invocation) =>
      invocation.toolId === pendingToolCall.toolId &&
      invocation.inputHash === pendingToolCall.inputHash,
  ) ?? false;

const isFrozenPlannerPendingToolCall = (
  pendingToolCall: AgentToolCallRequest | undefined,
): pendingToolCall is PendingToolCall =>
  Boolean(
    pendingToolCall &&
      pendingToolCall.source === "planner" &&
      "status" in pendingToolCall &&
      pendingToolCall.status === "frozen",
  );

const resolvePolicyToolDefinition = (
  pendingToolCall: PendingToolCall,
) => {
  if (pendingToolCall.toolMeta) {
    return {
      id: pendingToolCall.toolMeta.toolId,
      title: pendingToolCall.toolMeta.title,
      description: pendingToolCall.toolMeta.description,
      domain: pendingToolCall.toolMeta.domain ?? "read",
      source: pendingToolCall.toolMeta.source ?? "internal",
      mode: "sync" as const,
      inputSchema: pendingToolCall.toolMeta.inputSchema ?? {},
      tags: pendingToolCall.toolMeta.tags ?? [],
      capabilities: pendingToolCall.toolMeta.capabilities ?? {
        sideEffect: "none" as const,
        requiresApproval: false,
      },
    };
  }

  return listToolDefinitions().find(
    (definition) => definition.id === pendingToolCall.toolId,
  );
};

const getPolicyRiskDetails = (
  definition: ReturnType<typeof listToolDefinitions>[number],
) => {
  const capabilities = definition.capabilities;
  const requiresApproval =
    capabilities.requiresApproval ||
    capabilities.sideEffect !== "none" ||
    definition.source === "external";

  const riskLevel =
    capabilities.sideEffect === "process" ||
    capabilities.sideEffect === "local-write" ||
    capabilities.longRunning ||
    definition.source === "external"
      ? "high"
      : capabilities.sideEffect === "network" || capabilities.workspaceBound
        ? "medium"
        : "low";

  return {
    readonly: capabilities.sideEffect === "none",
    sideEffect: capabilities.sideEffect,
    requiresApproval,
    riskLevel,
    workspaceBound: capabilities.workspaceBound ?? false,
    longRunning: capabilities.longRunning ?? false,
  } as const;
};

export const policyNode = async (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentNodeState>> => {
  const nodeId = getIterativeNodeId("agent-policy", state);
  const traceAttemptMeta = getTraceAttemptMeta("agent-policy", state);
  await emitStepNode(emit, {
    runId: state.runId,
    nodeId,
    ...traceAttemptMeta,
    nodeType: "policy",
    phase: "start",
    label: "审批策略",
    summary: "正在判断冻结工具调用是否需要审批",
  });

  const pendingToolCall = state.pendingToolCall;

  if (!pendingToolCall) {
    const reason = "No pendingToolCall available for policy evaluation.";
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "policy",
      phase: "done",
      label: "审批策略",
      summary: "没有可审批的冻结工具调用",
      details: {
        decisionType: "skip",
        reason,
      },
    });
    return {
      policyDecision: {
        type: "skip",
        reason,
      },
      pendingApproval: undefined,
      blockedReason: undefined,
      errorMessage: undefined,
      errorSourceNodeId: undefined,
    };
  }

  if (!isFrozenPlannerPendingToolCall(pendingToolCall)) {
    const reason =
      "policyNode requires a frozen planner pendingToolCall before policy evaluation.";
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "policy",
      phase: "done",
      label: "审批策略",
      summary: "待审批调用不是冻结后的 planner 调用，已阻断执行",
      details: {
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        decisionType: "error",
        reason,
      },
    });
    return {
      policyDecision: {
        type: "error",
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        reason,
      },
      pendingToolCall: undefined,
      pendingApproval: undefined,
      blockedReason: reason,
      errorMessage: reason,
      errorSourceNodeId: nodeId,
    };
  }

  const selectedDefinition = resolvePolicyToolDefinition(pendingToolCall);
  if (!selectedDefinition) {
    const reason = `Pending tool call references unknown tool: ${pendingToolCall.toolId}`;
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "policy",
      phase: "done",
      label: "审批策略",
      summary: "待执行调用引用了未注册工具，已阻断执行",
      details: {
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        decisionType: "error",
        reason,
      },
    });
    return {
      policyDecision: {
        type: "error",
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        reason,
      },
      pendingToolCall: undefined,
      pendingApproval: undefined,
      blockedReason: reason,
      errorMessage: reason,
      errorSourceNodeId: nodeId,
    };
  }

  if (selectedDefinition.id !== pendingToolCall.toolId) {
    const reason =
      "Policy resolved a mismatched tool definition for the frozen pendingToolCall.";
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "policy",
      phase: "done",
      label: "审批策略",
      summary: "冻结调用与工具定义不一致，已阻断执行",
      details: {
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        decisionType: "error",
        resolvedToolId: selectedDefinition.id,
        reason,
      },
    });
    return {
      policyDecision: {
        type: "error",
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        reason,
      },
      pendingToolCall: undefined,
      pendingApproval: undefined,
      blockedReason: reason,
      errorMessage: reason,
      errorSourceNodeId: nodeId,
    };
  }

  const risk = getPolicyRiskDetails(selectedDefinition);
  const decision = evaluateAgentToolPolicy(selectedDefinition);
  if (decision.type === "allow") {
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "policy",
      phase: "done",
      label: "审批策略",
      summary: "冻结工具调用可直接执行",
      details: {
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        decisionType: decision.type,
        requiresApproval: false,
        riskLevel: risk.riskLevel,
        sideEffect: risk.sideEffect,
        reason: decision.reason,
      },
    });
    return {
      policyDecision: {
        type: "allow",
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        reason: decision.reason,
      },
      pendingApproval: undefined,
      pendingToolCall,
      blockedReason: undefined,
      errorMessage: undefined,
      errorSourceNodeId: undefined,
    };
  }

  if (decision.type === "deny") {
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "policy",
      phase: "done",
      label: "审批策略",
      summary: "冻结工具调用被策略拒绝执行",
      details: {
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        decisionType: decision.type,
        requiresApproval: risk.requiresApproval,
        riskLevel: risk.riskLevel,
        sideEffect: risk.sideEffect,
        reason: decision.reason,
      },
    });

    return {
      policyDecision: {
        type: "deny",
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        reason: decision.reason,
      },
      pendingToolCall: undefined,
      pendingApproval: undefined,
      blockedReason: decision.reason,
      errorMessage: decision.reason,
      errorSourceNodeId: nodeId,
    };
  }

  if (hasApprovedInvocation(state.approvedInvocations, pendingToolCall)) {
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "policy",
      phase: "done",
      label: "审批策略",
      summary: "冻结工具调用已获得批准，继续执行",
      details: {
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        decisionType: "allow",
        requiresApproval: true,
        riskLevel: risk.riskLevel,
        sideEffect: risk.sideEffect,
        reason: "Frozen tool call already approved for this exact inputHash.",
      },
    });
    return {
      policyDecision: {
        type: "allow",
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        reason: "Frozen tool call already approved for this exact inputHash.",
      },
      pendingApproval: undefined,
      pendingToolCall,
      blockedReason: undefined,
      errorMessage: undefined,
      errorSourceNodeId: undefined,
    };
  }

  const pendingApproval = createPendingApproval({
    runId: state.runId,
    toolId: selectedDefinition.id,
    toolCallId: pendingToolCall.id,
    reason: decision.reason,
    args: pendingToolCall.args,
    inputHash: pendingToolCall.inputHash,
  });

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId,
    ...traceAttemptMeta,
    nodeType: "policy",
    phase: "done",
    label: "审批策略",
    summary: "冻结工具调用需要审批",
    details: {
      toolId: pendingToolCall.toolId,
      inputHash: pendingToolCall.inputHash,
      decisionType: decision.type,
      requiresApproval: true,
      riskLevel: risk.riskLevel,
      sideEffect: risk.sideEffect,
      reason: decision.reason,
    },
  });

  return {
    policyDecision: {
      type: "require_approval",
      toolId: pendingToolCall.toolId,
      inputHash: pendingToolCall.inputHash,
      reason: decision.reason,
    },
    pendingApproval,
    pendingToolCall,
    blockedReason: undefined,
    errorMessage: undefined,
    errorSourceNodeId: undefined,
  };
};
