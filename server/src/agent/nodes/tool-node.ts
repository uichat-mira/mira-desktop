/**
 * 工具执行节点：执行已审批或免审的工具调用，并将结果加入证据。
 */
import { executeHarnessInvocation } from "@/harness/invocations";
import { getCapabilityImplementation } from "@/harness/registry";
import { createHarnessEnvironmentSnapshot } from "@/harness/environment";
import { runWithWorkspaceRootOverride } from "@/mcp/workspace";
import type { McpInvocationFailureCode } from "@/mcp/core/definitions";
import { createInvocationInputHash } from "../approval-fingerprint";
import { getAgentRunSignal } from "../run-control";
import {
  emitStepNode,
  getToolTraceTargetPreview,
  getIterativeNodeId,
  getTraceAttemptMeta,
  summarizeToolExecutionCompleted,
  summarizeToolExecutionFailure,
  summarizeToolExecutionStart,
  summarizeToolExecutionWaitingApproval,
  type AgentNodeState,
  type EmitAgentExecutionNode,
} from "../node-runtime";
import type {
  AgentEvidenceSummary,
  AgentObservation,
  AgentRetrievalEvidence,
  AgentToolCallRequest,
  AgentToolExecutionResult,
  PendingToolCall,
} from "../types";
import type { CodebaseExploreToolResult } from "@/mcp/managed-codegraph/types";
import { redactExternalMcpValue } from "@/mcp/external-redaction";

const nowIso = () => new Date().toISOString();

const TERMINAL_FAILURE_PATTERNS = [
  /\bapproval mismatch\b/i,
  /\bpolicy denied\b/i,
  /\bsecurity\b/i,
  /\bprotocol\b/i,
  /\bschema\b/i,
  /\boutside workspace\b/i,
] as const;

const createObservation = (input: {
  runId: string;
  stepId: string;
  status: AgentObservation["status"];
  facts: string[];
  errorMessage?: string;
}): AgentObservation => ({
  id: crypto.randomUUID(),
  runId: input.runId,
  stepId: input.stepId,
  status: input.status,
  facts: input.facts,
  ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  createdAt: nowIso(),
});

const isFrozenPlannerPendingToolCall = (
  pendingToolCall: AgentToolCallRequest | undefined,
): pendingToolCall is PendingToolCall =>
  Boolean(
    pendingToolCall &&
      pendingToolCall.source === "planner" &&
      "status" in pendingToolCall &&
      pendingToolCall.status === "frozen",
  );

const buildExecutionRecord = (input: {
  pendingToolCall: PendingToolCall;
  toolId: string;
  status: AgentToolExecutionResult["status"];
  invocationId?: string;
  startedAt: string;
  finishedAt: string;
  failureKind?: AgentToolExecutionResult["failureKind"];
  failureCode?: AgentToolExecutionResult["failureCode"];
  recoveryAttemptCount?: number;
  errorMessage?: string;
  result?: unknown;
  evidence?: AgentToolExecutionResult["evidence"];
}): AgentToolExecutionResult => ({
  toolCallId: input.pendingToolCall.id,
  toolId: input.toolId,
  inputHash: input.pendingToolCall.inputHash,
  args:
    (getCapabilityImplementation(input.toolId)?.definition.source === "external" ||
      input.toolId.startsWith("mcp:"))
      ? (redactExternalMcpValue(input.pendingToolCall.args) as Record<string, unknown>)
      : input.pendingToolCall.args,
  invocationId: input.invocationId,
  status: input.status,
  failureKind: input.failureKind,
  failureCode: input.failureCode,
  recoveryAttemptCount: input.recoveryAttemptCount,
  errorMessage: input.errorMessage,
  result: input.result,
  ...(input.evidence ? { evidence: input.evidence } : {}),
  startedAt: input.startedAt,
  finishedAt: input.finishedAt,
});

const classifyHarnessFailure = (input: {
  invocationStatus: "failed" | "cancelled";
  errorMessage: string;
  failureCode?: McpInvocationFailureCode;
}): AgentToolExecutionResult["failureKind"] => {
  if (input.invocationStatus === "cancelled") {
    return "terminal";
  }

  if (input.failureCode) {
    switch (input.failureCode) {
      case "approval_mismatch":
      case "policy_denied":
      case "schema_invalid":
      case "workspace_escape":
      case "cancelled":
        return "terminal";
      case "tool_runtime_failed":
      case "command_exit_nonzero":
      case "timeout":
      case "unknown":
        return "recoverable";
    }
  }

  return TERMINAL_FAILURE_PATTERNS.some((pattern) => pattern.test(input.errorMessage))
    ? "terminal"
    : "recoverable";
};

const getDurationMs = (startedAt: string, finishedAt: string) => {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(finishedAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return undefined;
  }

  return Math.max(0, endMs - startMs);
};

const isCodebaseExploreToolResult = (
  value: unknown,
): value is CodebaseExploreToolResult => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.capabilityId === "codebase_explore" &&
    record.plannerExposure === "controlled_tool_only" &&
    typeof record.verifiedEvidenceInput === "object" &&
    record.verifiedEvidenceInput !== null &&
    typeof record.trace === "object" &&
    record.trace !== null
  );
};

const toCodebaseRetrievalEvidence = (
  value: CodebaseExploreToolResult["verifiedEvidenceInput"],
): AgentRetrievalEvidence => ({
  query: value.query,
  chunkCount: value.chunkCount,
  chunks: value.chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    documentId: String(chunk.documentName),
    documentName: chunk.documentName,
    score: chunk.score,
    content: chunk.content,
  })),
  summary: value.summary as AgentEvidenceSummary | undefined,
  createdAt: value.createdAt,
});

const toHarnessApprovedInvocations = (
  approvedInvocations: AgentNodeState["approvedInvocations"],
) =>
  approvedInvocations?.map((invocation) => ({
    toolId: invocation.toolId,
    inputHash: createInvocationInputHash(invocation.input),
  }));

const consumeApprovedInvocation = (
  approvedInvocations: AgentNodeState["approvedInvocations"],
  pendingToolCall: PendingToolCall,
) =>
  approvedInvocations?.filter(
    (invocation) =>
      invocation.toolId !== pendingToolCall.toolId ||
      (invocation.inputHash !== pendingToolCall.inputHash &&
        createInvocationInputHash(invocation.input) !== pendingToolCall.inputHash),
  );

export const toolNode = async (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentNodeState>> => {
  const nodeId = getIterativeNodeId("agent-tool", state);
  const traceAttemptMeta = getTraceAttemptMeta("agent-tool", state);
  const pendingToolCall = state.pendingToolCall;

  if (!pendingToolCall) {
    const errorMessage = "No pendingToolCall available for tool execution.";
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "tool",
      phase: "error",
      label: "工具执行",
      summary: "没有冻结工具调用，已阻断执行",
      details: {
        status: "error",
        reason: errorMessage,
      },
    });
    return {
      pendingToolCall: undefined,
      errorMessage,
      errorSourceNodeId: "agent-tool",
      blockedReason: errorMessage,
    };
  }

  if (!isFrozenPlannerPendingToolCall(pendingToolCall)) {
    const errorMessage =
      "toolNode requires a frozen planner pendingToolCall before execution.";
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "tool",
      phase: "error",
      label: "工具执行",
      summary: "待执行调用不是冻结后的 planner 调用，已阻断执行",
      details: {
        toolCallId: "id" in pendingToolCall ? pendingToolCall.id : null,
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        status: "error",
        reason: errorMessage,
      },
    });
    return {
      pendingToolCall: undefined,
      errorMessage,
      errorSourceNodeId: "agent-tool",
      blockedReason: errorMessage,
    };
  }

  const policyDecision = state.policyDecision;
  if (
    policyDecision?.type !== "allow" ||
    policyDecision.toolId !== pendingToolCall.toolId ||
    policyDecision.inputHash !== pendingToolCall.inputHash
  ) {
    const errorMessage =
      policyDecision == null
        ? "No policy allow decision available for tool execution."
        : "Policy decision does not allow this frozen pendingToolCall.";
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "tool",
      phase: "error",
      label: "工具执行",
      summary: "审批结果未明确允许当前冻结调用，已阻断执行",
      details: {
        toolCallId: pendingToolCall.id,
        toolId: pendingToolCall.toolId,
        inputHash: pendingToolCall.inputHash,
        status: "error",
        reason: errorMessage,
        policyDecisionType: policyDecision?.type ?? null,
      },
    });
    return {
      pendingToolCall: undefined,
      errorMessage,
      errorSourceNodeId: "agent-tool",
      blockedReason: errorMessage,
    };
  }

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId,
    ...traceAttemptMeta,
    nodeType: "tool",
    phase: "start",
    label: "工具执行",
    summary: summarizeToolExecutionStart(
      pendingToolCall.toolId,
      pendingToolCall.args,
    ),
    details: {
      toolCallId: pendingToolCall.id,
      toolId: pendingToolCall.toolId,
      targetPreview:
        getToolTraceTargetPreview(
          pendingToolCall.toolId,
          pendingToolCall.args,
        ) ?? null,
      inputHash: pendingToolCall.inputHash,
      status: "running",
    },
  });

  const invocationEnvironment = state.workspaceRoot
    ? createHarnessEnvironmentSnapshot({
        workspace: {
          rootPath: state.workspaceRoot,
          source: "selected",
        },
      })
    : undefined;

  const invocation = await runWithWorkspaceRootOverride(
    state.workspaceRoot,
    async () =>
      await executeHarnessInvocation({
        toolId: pendingToolCall.toolId,
        args: pendingToolCall.args,
        userId: state.userId,
        threadId: state.threadId,
        ...(invocationEnvironment ? { environment: invocationEnvironment } : {}),
        approvedInvocations: toHarnessApprovedInvocations(state.approvedInvocations),
        ...(getAgentRunSignal(state.runId, state.runControlLeaseId)
          ? {
              signal: getAgentRunSignal(
                state.runId,
                state.runControlLeaseId,
              ),
            }
          : {}),
      }),
  );

  const startedAt = invocation.startedAt ?? pendingToolCall.createdAt;
  const finishedAt = nowIso();
  const durationMs = getDurationMs(startedAt, finishedAt);
  // Approval is a one-shot authorization for this exact frozen call. Consume
  // it after the Harness attempt so a later Planner iteration cannot execute
  // the same call again without a new approval.
  const remainingApprovedInvocations = consumeApprovedInvocation(
    state.approvedInvocations,
    pendingToolCall,
  );

  if (invocation.status === "awaiting_approval") {
    const approvalReason =
      invocation.approval?.reason ?? `${pendingToolCall.toolId} requires approval.`;
    const ownerContractError =
      "Harness requested approval after Policy allowed the frozen call; Policy must create pendingApproval before ToolNode execution.";

    const observation = createObservation({
      runId: state.runId,
      stepId: "tool",
      status: "blocked",
      facts: [`${pendingToolCall.toolId} paused for approval before completion.`],
      errorMessage: approvalReason,
    });

    const executionRecord = buildExecutionRecord({
      pendingToolCall,
      toolId: pendingToolCall.toolId,
      invocationId: invocation.id,
      status: "awaiting_approval",
      startedAt,
      finishedAt,
    });

    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "tool",
      phase: "done",
      label: "工具执行",
      summary: summarizeToolExecutionWaitingApproval(
        pendingToolCall.toolId,
        pendingToolCall.args,
      ),
      details: {
        toolCallId: pendingToolCall.id,
        toolId: pendingToolCall.toolId,
        targetPreview:
          getToolTraceTargetPreview(
            pendingToolCall.toolId,
            pendingToolCall.args,
          ) ?? null,
        inputHash: pendingToolCall.inputHash,
        invocationId: invocation.id,
        status: "awaiting_approval",
        durationMs: durationMs ?? null,
      },
    });
    return {
      approvedInvocations: remainingApprovedInvocations,
      pendingToolCall,
      lastToolExecution: executionRecord,
      pendingToolExecution: executionRecord,
      observations: [...(state.observations ?? []), observation],
      pendingEvidenceObservation: observation,
      errorMessage: ownerContractError,
      errorSourceNodeId: nodeId,
      blockedReason: ownerContractError,
    };
  }

  if (invocation.status !== "completed") {
    const errorMessage =
      invocation.error?.message ??
      `${pendingToolCall.toolId} failed during Harness execution.`;
    const failureCode = invocation.error?.failureCode;
    const invocationFailureStatus =
      invocation.status === "cancelled" ? "cancelled" : "failed";
    const failureKind = classifyHarnessFailure({
      invocationStatus: invocationFailureStatus,
      errorMessage,
      failureCode,
    });
    const recoveryAttemptCount =
      failureKind === "recoverable"
        ? (state.lastToolExecution?.recoveryAttemptCount ?? 0) + 1
        : undefined;
    const observation = createObservation({
      runId: state.runId,
      stepId: "tool",
      status: failureKind === "terminal" ? "blocked" : "failed",
      facts: [
        failureKind === "terminal"
          ? `${pendingToolCall.toolId} hit a terminal failure during Harness execution.`
          : `${pendingToolCall.toolId} failed during Harness execution but can be retried.`,
      ],
      errorMessage,
    });

    const executionRecord = buildExecutionRecord({
      pendingToolCall,
      toolId: pendingToolCall.toolId,
      invocationId: invocation.id,
      status: "failed",
      failureKind,
      failureCode,
      recoveryAttemptCount,
      errorMessage,
      startedAt,
      finishedAt,
    });

    await emitStepNode(emit, {
      runId: state.runId,
      nodeId,
      ...traceAttemptMeta,
      nodeType: "tool",
      phase: "error",
      label: "工具执行",
      summary: summarizeToolExecutionFailure({
        toolId: pendingToolCall.toolId,
        failureKind,
        args: pendingToolCall.args,
      }),
      details: {
        toolCallId: pendingToolCall.id,
        toolId: pendingToolCall.toolId,
        targetPreview:
          getToolTraceTargetPreview(
            pendingToolCall.toolId,
            pendingToolCall.args,
          ) ?? null,
        inputHash: pendingToolCall.inputHash,
        invocationId: invocation.id,
        status: "failed",
        failureKind,
        failureCode: failureCode ?? null,
        recoveryAttemptCount: recoveryAttemptCount ?? null,
        durationMs: durationMs ?? null,
      },
    });
    return {
      approvedInvocations: remainingApprovedInvocations,
      observations: [...(state.observations ?? []), observation],
      pendingEvidenceObservation: observation,
      pendingToolCall: undefined,
      lastToolExecution: executionRecord,
      pendingToolExecution: executionRecord,
      ...(failureKind === "terminal"
        ? {
            blockedReason: errorMessage,
            terminalReason: errorMessage,
            errorMessage,
            errorSourceNodeId: "agent-tool" as const,
          }
        : {
            blockedReason: undefined,
            terminalReason: undefined,
            errorMessage: undefined,
            errorSourceNodeId: undefined,
          }),
    };
  }

  const observation = createObservation({
    runId: state.runId,
    stepId: "tool",
    status: "ok",
    facts: [`${pendingToolCall.toolId} completed through Harness.`],
  });
  const executionRecord = buildExecutionRecord({
    pendingToolCall,
    toolId: pendingToolCall.toolId,
    invocationId: invocation.id,
    status: "completed",
    result: invocation.result,
    evidence: invocation.evidence,
    startedAt,
    finishedAt,
  });

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId,
    ...traceAttemptMeta,
    nodeType: "tool",
    phase: "done",
    label: "工具执行",
    summary: summarizeToolExecutionCompleted(
      pendingToolCall.toolId,
      pendingToolCall.args,
    ),
    details: {
      toolCallId: pendingToolCall.id,
      toolId: pendingToolCall.toolId,
      targetPreview:
        getToolTraceTargetPreview(
          pendingToolCall.toolId,
          pendingToolCall.args,
        ) ?? null,
      inputHash: pendingToolCall.inputHash,
      invocationId: invocation.id,
      status: "completed",
      durationMs: durationMs ?? null,
    },
  });
  const codebaseRetrieval =
    pendingToolCall.toolId === "codebase_explore" &&
    isCodebaseExploreToolResult(invocation.result) &&
    invocation.result.verifiedEvidenceInput.chunkCount > 0
      ? toCodebaseRetrievalEvidence(invocation.result.verifiedEvidenceInput)
      : null;
  return {
    approvedInvocations: remainingApprovedInvocations,
    observations: [...(state.observations ?? []), observation],
    pendingEvidenceObservation: observation,
    pendingRetrievalEvidence: codebaseRetrieval ?? undefined,
    pendingToolCall: undefined,
    lastToolExecution: executionRecord,
    pendingToolExecution: executionRecord,
    iterationCount: (state.iterationCount ?? 0) + 1,
  };
};
