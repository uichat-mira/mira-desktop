import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SkillContext } from "@/skills/context/types.js";

export type SkillAgentExecutionStatus =
  | "completed"
  | "insufficient_evidence"
  | "needs_input"
  | "failed";

export type SkillAgentRuntimeBinding = {
  id: string;
  kind: "skill-private-runtime";
  status: "ready" | "pending";
  description: string;
};

export type SkillAgentExecutionProfile = {
  skillId: string;
  mode: "forked-agent";
  engine: "pi-agent-core";
  allowedHarnessToolIds: string[];
  runtimeBindings: SkillAgentRuntimeBinding[];
  workspaceBound: boolean;
};

export type SkillAgentRequirement = {
  id: string;
  kind: "user_input" | "evidence" | "resource" | "capability" | "approval";
  description: string;
  requiredFor: string;
  toolId?: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
  inputHash?: string;
};

export type SkillAgentPendingInvocation = {
  toolCallId: string;
  toolId: string;
  input: Record<string, unknown>;
  inputHash: string;
};

export type SubAgentWorkingPhase =
  | "planning"
  | "working"
  | "waiting_approval"
  | "waiting_input"
  | "blocked"
  | "completed"
  | "failed";

/**
 * User-visible, safe work summary. This is deliberately not raw model
 * chain-of-thought. It tells the user what the subAgent currently judges,
 * does and plans to do next.
 */
export type SubAgentWorkingState = {
  runId: string;
  skillId: string;
  phase: SubAgentWorkingPhase;
  currentJudgement?: string;
  currentAction: string;
  nextAction?: string;
  blockingReason?: string;
  updatedAt: number;
};

export type SubAgentTraceEventType =
  | "subagent.started"
  | "subagent.resumed"
  | "working_state.updated"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "approval.required"
  | "input.required"
  | "plan.revised"
  | "subagent.completed"
  | "subagent.failed";

export type SubAgentTraceEvent = {
  runId: string;
  seq: number;
  eventId: string;
  skillId: string;
  type: SubAgentTraceEventType;
  title: string;
  timestamp: number;
  details?: Record<string, unknown>;
};

export type SubAgentRuntimeEvent =
  | { kind: "trace"; event: SubAgentTraceEvent }
  | { kind: "working_state"; state: SubAgentWorkingState };

/**
 * Serializable pi-agent-core transcript checkpoint captured at a governed
 * approval boundary. Product/runtime code refers to the owner as subAgent;
 * the engine-specific message type remains an implementation detail here.
 *
 * The new ledger fields are optional so already persisted v1 checkpoints can
 * still resume. New checkpoints always write them.
 */
export type SkillAgentCheckpoint = {
  version: 1;
  messages: AgentMessage[];
  pendingInvocation: SkillAgentPendingInvocation;
  evidence: unknown[];
  artifacts: unknown[];
  toolCalls: string[];
  subAgentRunId?: string;
  nextTraceSeq?: number;
  workingState?: SubAgentWorkingState;
  traceEvents?: SubAgentTraceEvent[];
  skillId?: string;
  skillVersion?: string;
  skillContextSnapshot?: SkillContext;
};

export type SkillAgentTrace = {
  engine: "pi-agent-core";
  skillId: string;
  toolCalls: string[];
  runId?: string;
  nextSeq?: number;
  workingState?: SubAgentWorkingState;
  events?: SubAgentTraceEvent[];
};

export type SkillAgentExecutionResult = {
  status: SkillAgentExecutionStatus;
  summary?: string;
  evidence: unknown[];
  artifacts: unknown[];
  missingEvidence?: unknown[];
  requirements?: SkillAgentRequirement[];
  checkpoint?: SkillAgentCheckpoint;
  recoverable?: boolean;
  error?: string;
  trace?: SkillAgentTrace;
};

export type SkillAgentApprovedInvocation = {
  toolId: string;
  inputHash: string;
  input?: Record<string, unknown>;
};

export type SkillAgentExecutionInput = {
  goal: string;
  skillContext: SkillContext;
  workspaceRoot?: string;
  userId?: number;
  threadId?: string;
  turnId?: string;
  approvedInvocations?: SkillAgentApprovedInvocation[];
  checkpoint?: SkillAgentCheckpoint;
  /** Parent AgentRun cancellation boundary, propagated into subAgent tool execution. */
  signal?: AbortSignal;
  onRuntimeEvent?: (event: SubAgentRuntimeEvent) => Promise<void> | void;
};

export type SkillAgentToolBinding = {
  id: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{
    result?: unknown;
    evidence?: unknown;
    artifacts?: unknown[];
    terminate?: boolean;
    requirement?: SkillAgentRequirement;
  }>;
};

// Public product/architecture aliases. Existing SkillAgent* imports remain
// temporarily valid so the migration does not turn into a broad rename patch.
export type SubAgentExecutionStatus = SkillAgentExecutionStatus;
export type SubAgentRuntimeBinding = SkillAgentRuntimeBinding;
export type SubAgentExecutionProfile = SkillAgentExecutionProfile;
export type SubAgentRequirement = SkillAgentRequirement;
export type SubAgentPendingInvocation = SkillAgentPendingInvocation;
export type SubAgentCheckpoint = SkillAgentCheckpoint;
export type SubAgentTrace = SkillAgentTrace;
export type SubAgentExecutionResult = SkillAgentExecutionResult;
export type SubAgentApprovedInvocation = SkillAgentApprovedInvocation;
export type SubAgentExecutionInput = SkillAgentExecutionInput;
export type SubAgentToolBinding = SkillAgentToolBinding;
