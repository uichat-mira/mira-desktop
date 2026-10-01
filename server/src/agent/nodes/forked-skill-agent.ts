import crypto from "node:crypto";
import { emitStepNode } from "../node-runtime.js";
import type { AgentNodeState, EmitAgentExecutionNode } from "../node-runtime.js";
import type {
  AgentApprovalRequest,
  AgentObservation,
  AgentToolCallRequest,
} from "../types.js";
import type { SkillContext } from "@/skills/context/types.js";
import { resolveSubAgentExecutionProfile } from "@/skills/agent/profiles.js";
import { runSubAgent } from "@/skills/agent/subagent-runtime.js";
import { getAgentRunSignal } from "../run-control.js";
import type {
  SubAgentApprovedInvocation,
  SubAgentCheckpoint,
  SubAgentRequirement,
  SubAgentRuntimeEvent,
} from "@/skills/agent/types.js";

// The persisted marker remains `skill_agent` for backward compatibility with
// already frozen approvals. Product, Trace and runtime naming are subAgent.
type SkillAwareTaskFrame = NonNullable<AgentNodeState["currentTaskFrame"]> & {
  skillContext?: SkillContext;
};

type SubAgentPendingToolCall = {
  id: string;
  toolId: string;
  args: Record<string, unknown>;
  inputHash: string;
  source: "llm_tool_call";
  origin: "skill_agent";
  skillId: string;
  skillAgentCheckpoint: SubAgentCheckpoint;
  createdAt: string;
};

const getTaskFrameSkillContext = (state: AgentNodeState) =>
  (state.currentTaskFrame as SkillAwareTaskFrame | undefined)?.skillContext;

const isSubAgentPendingToolCall = (
  pendingToolCall: AgentToolCallRequest | undefined,
): pendingToolCall is AgentToolCallRequest & SubAgentPendingToolCall =>
  Boolean(
    pendingToolCall &&
      "origin" in pendingToolCall &&
      pendingToolCall.origin === "skill_agent" &&
      "id" in pendingToolCall &&
      typeof pendingToolCall.id === "string" &&
      "skillAgentCheckpoint" in pendingToolCall,
  );

const getPersistedSubAgentCheckpoint = (state: AgentNodeState) =>
  isSubAgentPendingToolCall(state.pendingToolCall)
    ? state.pendingToolCall.skillAgentCheckpoint
    : undefined;

const getSkillContext = (state: AgentNodeState) =>
  getPersistedSubAgentCheckpoint(state)?.skillContextSnapshot ??
  getTaskFrameSkillContext(state);

const getReplayApprovedInvocations = (
  state: AgentNodeState,
): SubAgentApprovedInvocation[] => {
  const pendingToolCall = state.pendingToolCall;
  if (!isSubAgentPendingToolCall(pendingToolCall)) return [];

  // Only the invocation currently frozen for this resume may cross back into
  // the subAgent. Older approvals must never become reusable grants.
  return (state.approvedInvocations ?? [])
    .filter(
      (approval) =>
        approval.toolId === pendingToolCall.toolId &&
        approval.inputHash === pendingToolCall.inputHash,
    )
    .map((approval) => ({
      toolId: approval.toolId,
      inputHash: approval.inputHash,
      input: approval.input,
    }));
};

const getReplayCheckpoint = (
  state: AgentNodeState,
  skillId: string,
): SubAgentCheckpoint | undefined => {
  const pendingToolCall = state.pendingToolCall;
  if (!pendingToolCall || !("origin" in pendingToolCall)) return undefined;
  if (pendingToolCall.origin !== "skill_agent") return undefined;
  if (!isSubAgentPendingToolCall(pendingToolCall)) {
    throw new Error(
      "Frozen subAgent approval is missing its transcript checkpoint; refusing to restart the original goal.",
    );
  }
  if (pendingToolCall.skillId !== skillId) {
    throw new Error(
      `Frozen subAgent approval belongs to ${pendingToolCall.skillId}, not active Skill ${skillId}.`,
    );
  }

  const checkpoint = pendingToolCall.skillAgentCheckpoint;
  const frozen = checkpoint.pendingInvocation;
  if (
    frozen.toolCallId !== pendingToolCall.id ||
    frozen.toolId !== pendingToolCall.toolId ||
    frozen.inputHash !== pendingToolCall.inputHash
  ) {
    throw new Error(
      "Frozen subAgent approval does not match its checkpoint invocation; resume was blocked.",
    );
  }
  return checkpoint;
};

const toObservationStatus = (
  status: "completed" | "insufficient_evidence" | "needs_input" | "failed",
  recoverable?: boolean,
): AgentObservation["status"] => {
  if (status === "completed") return "ok";
  if (status === "insufficient_evidence" || status === "needs_input") return "partial";
  return recoverable === false ? "blocked" : "failed";
};

const boundedJson = (value: unknown, maxChars = 8_000) => {
  try {
    const text = JSON.stringify(value);
    if (!text) return "null";
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
  } catch {
    return "[unserializable]";
  }
};

const findApprovalRequirement = (
  requirements: SubAgentRequirement[] | undefined,
): SubAgentRequirement | undefined =>
  requirements?.find(
    (requirement) =>
      requirement.kind === "approval" &&
      Boolean(requirement.toolId) &&
      Boolean(requirement.toolCallId) &&
      Boolean(requirement.inputHash) &&
      Boolean(requirement.input),
  );

const buildParentApprovalPatch = (input: {
  state: AgentNodeState;
  skillId: string;
  requirement: SubAgentRequirement;
  checkpoint: SubAgentCheckpoint;
  createdAt: string;
}): Pick<AgentNodeState, "pendingApproval" | "pendingToolCall" | "policyDecision"> => {
  const toolId = input.requirement.toolId!;
  const toolCallId = input.requirement.toolCallId!;
  const args = structuredClone(input.requirement.input!);
  const inputHash = input.requirement.inputHash!;
  const frozen = input.checkpoint.pendingInvocation;
  if (
    frozen.toolId !== toolId ||
    frozen.toolCallId !== toolCallId ||
    frozen.inputHash !== inputHash
  ) {
    throw new Error(
      "subAgent approval requirement does not match its serialized checkpoint invocation.",
    );
  }

  const subAgentPendingToolCall: SubAgentPendingToolCall = {
    id: toolCallId,
    toolId,
    args,
    inputHash,
    source: "llm_tool_call",
    origin: "skill_agent",
    skillId: input.skillId,
    skillAgentCheckpoint: structuredClone(input.checkpoint),
    createdAt: input.createdAt,
  };
  const pendingToolCall = subAgentPendingToolCall as AgentToolCallRequest;
  const pendingApproval: AgentApprovalRequest = {
    id: crypto.randomUUID(),
    runId: input.state.runId,
    stepId: `subagent:${input.skillId}`,
    toolId,
    toolCallId,
    reason: input.requirement.description,
    input: args,
    inputHash,
    createdAt: input.createdAt,
  };
  return {
    pendingToolCall,
    pendingApproval,
    policyDecision: {
      type: "require_approval",
      toolId,
      inputHash,
      reason: input.requirement.description,
    },
  };
};

const tracePhase = (
  type: Extract<SubAgentRuntimeEvent, { kind: "trace" }>["event"]["type"],
) =>
  type === "tool.failed" || type === "subagent.failed"
    ? ("error" as const)
    : ("done" as const);

const traceNodeType = (
  type: Extract<SubAgentRuntimeEvent, { kind: "trace" }>["event"]["type"],
) => {
  if (type.startsWith("tool.")) return "tool";
  if (type === "approval.required") return "approval";
  if (type === "subagent.failed") return "error";
  return "reason";
};

const publishSubAgentRuntimeEvent = async (input: {
  parentRunId: string;
  event: SubAgentRuntimeEvent;
  emit?: EmitAgentExecutionNode;
}) => {
  if (input.event.kind === "trace") {
    const trace = input.event.event;
    await emitStepNode(input.emit, {
      runId: input.parentRunId,
      nodeId: `subagent-trace:${trace.runId}:${trace.seq}`,
      nodeType: traceNodeType(trace.type),
      phase: tracePhase(trace.type),
      label: trace.title,
      emittedAt: new Date(trace.timestamp).toISOString(),
      details: {
        subAgentTraceEvent: true,
        subAgentRunId: trace.runId,
        subAgentSeq: trace.seq,
        subAgentEventId: trace.eventId,
        subAgentEventType: trace.type,
        skillId: trace.skillId,
        ...(trace.details ? { traceDetails: trace.details } : {}),
      },
    });
    return;
  }

  const state = input.event.state;
  await emitStepNode(input.emit, {
    runId: input.parentRunId,
    nodeId: `subagent-working-state:${state.runId}:${state.updatedAt}`,
    nodeType: "reason",
    phase: "done",
    label: "subAgent 当前工作",
    emittedAt: new Date(state.updatedAt).toISOString(),
    details: {
      subAgentWorkingState: true,
      subAgentRunId: state.runId,
      skillId: state.skillId,
      workingState: state,
    },
  });
};

const safelyPublishSubAgentRuntimeEvent = async (input: {
  parentRunId: string;
  event: SubAgentRuntimeEvent;
  emit?: EmitAgentExecutionNode;
}) => {
  try {
    await publishSubAgentRuntimeEvent(input);
  } catch {
    // Observability must never become a second control plane for subAgent work.
    // The final observation still contains the bounded trace snapshot so a
    // transient SSE/persistence failure cannot change execution semantics.
  }
};

export const forkedSkillAgentNode = async (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentNodeState>> => {
  const skillContext = getSkillContext(state);
  const primary = skillContext?.primary;
  const skillId = primary?.id;
  if (!skillContext || !primary || !skillId) return {};

  const profile = resolveSubAgentExecutionProfile(primary);
  const checkpoint = getReplayCheckpoint(state, skillId);
  const exposedHarnessToolIds = state.toolExposure?.exposedTools ?? [];
  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-forked-skill-agent",
    nodeType: "reason",
    phase: "start",
    label: "subAgent 委派",
    summary: checkpoint
      ? `正在恢复 ${skillId} Skill 的已审批 subAgent 上下文`
      : `正在把 ${skillId} Skill 委派给独立 subAgent`,
    details: {
      skillId,
      skillVersion: primary.version,
      engine: profile.engine,
      mode: profile.mode,
      allowedHarnessToolIds: profile.allowedHarnessToolIds,
      exposedHarnessToolIds,
      runtimeBindings: profile.runtimeBindings,
      workspaceBound: profile.workspaceBound,
      workspaceRoot: state.workspaceRoot ?? null,
      approvalResume: Boolean(checkpoint),
      resumeToolCallId: checkpoint?.pendingInvocation.toolCallId ?? null,
    },
  });

  const createdAt = new Date().toISOString();
  if (profile.workspaceBound && !state.workspaceRoot) {
    const observation: AgentObservation = {
      id: crypto.randomUUID(),
      runId: state.runId,
      stepId: `subagent:${skillId}`,
      status: "failed",
      facts: ["The selected Skill requires an active workspace."],
      errorMessage: "Workspace is not selected",
      summary: {
        source: "observation",
        status: "failed",
        actionTaken: `Tried to delegate ${skillId} to its subAgent`,
        keyFindings: ["Workspace is not selected"],
        gaps: ["Select a workspace before executing this workspace-bound Skill"],
        error: "Workspace is not selected",
        data: {
          kind: "generic_structured",
          preview: { skillId, engine: profile.engine },
          truncated: false,
          redacted: false,
          unsupported: false,
        },
      },
      createdAt,
    };
    return { pendingEvidenceObservation: observation };
  }

  const result = await runSubAgent({
    goal: state.question?.trim() || state.goal.text,
    skillContext,
    workspaceRoot: state.workspaceRoot ?? undefined,
    exposedHarnessToolIds,
    userId: state.userId,
    threadId: state.threadId,
    approvedInvocations: getReplayApprovedInvocations(state),
    checkpoint,
    signal: getAgentRunSignal(state.runId, state.runControlLeaseId),
    onRuntimeEvent: (event) =>
      safelyPublishSubAgentRuntimeEvent({
        parentRunId: state.runId,
        event,
        emit,
      }),
  });

  const facts = [
    `subAgent status: ${result.status}`,
    ...(result.summary ? [result.summary] : []),
    `Tool calls: ${result.trace?.toolCalls.join(", ") || "none"}`,
    `Artifacts: ${result.artifacts.length}`,
    ...(result.artifacts.length
      ? [`Artifact records: ${boundedJson(result.artifacts)}`]
      : []),
    ...(result.evidence.length
      ? [`Skill execution evidence: ${boundedJson(result.evidence)}`]
      : []),
    ...(result.requirements?.length
      ? [`Requirements: ${boundedJson(result.requirements)}`]
      : []),
    ...(result.missingEvidence?.length
      ? [`Missing evidence: ${boundedJson(result.missingEvidence)}`]
      : []),
  ];

  const observation: AgentObservation = {
    id: crypto.randomUUID(),
    runId: state.runId,
    stepId: `subagent:${skillId}`,
    status: toObservationStatus(result.status, result.recoverable),
    facts,
    ...(result.error ? { errorMessage: result.error } : {}),
    summary: {
      source: "observation",
      status:
        result.status === "completed"
          ? "completed"
          : result.status === "failed"
            ? "failed"
            : "partial",
      actionTaken: checkpoint
        ? `Resumed ${skillId} subAgent from its exact approval checkpoint`
        : `Delegated ${skillId} Skill to one subAgent`,
      keyFindings: facts.slice(0, 8),
      ...(result.missingEvidence?.length
        ? { gaps: result.missingEvidence.map((item) => String(item)) }
        : result.requirements?.length
          ? { gaps: result.requirements.map((item) => item.description) }
          : {}),
      ...(result.error ? { error: result.error } : {}),
      data: {
        kind: "generic_structured",
        preview: {
          skillId,
          skillVersion: primary.version,
          engine: profile.engine,
          status: result.status,
          resumedFromApproval: Boolean(checkpoint),
          artifacts: result.artifacts,
          requirements: result.requirements ?? [],
          missingEvidence: result.missingEvidence ?? [],
          trace: result.trace ?? null,
        },
        truncated: false,
        redacted: false,
        unsupported: false,
      },
    },
    createdAt,
  };

  const approvalRequirement = findApprovalRequirement(result.requirements);
  if (approvalRequirement && !result.checkpoint) {
    throw new Error(
      "subAgent requested approval without a resumable transcript checkpoint.",
    );
  }
  const approvalPatch = approvalRequirement
    ? buildParentApprovalPatch({
        state,
        skillId,
        requirement: approvalRequirement,
        checkpoint: result.checkpoint!,
        createdAt,
      })
    : isSubAgentPendingToolCall(state.pendingToolCall)
      ? {
          pendingApproval: undefined,
          pendingToolCall: undefined,
          policyDecision: undefined,
        }
      : {};

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-forked-skill-agent",
    nodeType: "reason",
    phase: "done",
    label: "subAgent 委派",
    summary: approvalRequirement
      ? `subAgent 等待审批：${approvalRequirement.toolId}`
      : `subAgent 已返回：${result.status}`,
    details: {
      skillId,
      skillVersion: primary.version,
      status: result.status,
      resumedFromApproval: Boolean(checkpoint),
      subAgentRunId: result.trace?.runId ?? null,
      nextTraceSeq: result.trace?.nextSeq ?? null,
      artifactCount: result.artifacts.length,
      requirementCount: result.requirements?.length ?? 0,
      missingEvidenceCount: result.missingEvidence?.length ?? 0,
      toolCalls: result.trace?.toolCalls ?? [],
      approvalToolId: approvalRequirement?.toolId ?? null,
      approvalToolCallId: approvalRequirement?.toolCallId ?? null,
      approvalInputHash: approvalRequirement?.inputHash ?? null,
    },
  });

  return {
    pendingEvidenceObservation: observation,
    ...approvalPatch,
  };
};
