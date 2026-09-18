import type { AssistantExecutionNodeEvent } from "@/services/chat-stream-events";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol";
import type { RetrievedChunk } from "@/services/rag-nodes";
import type { ContextBudgetAudit } from "@/services/context-budget/index";
import type { SandboxOutputEncoding } from "@/harness/sandbox/contract";
import type { McpInvocationFailureCode, McpToolDefinition, McpToolEvidence } from "@/mcp/core/definitions";
import type {
  AgentIntentEmbeddingConfig,
  ToolIntentResult,
} from "./intent/index";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_user"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type AgentRiskLevel = "low" | "medium" | "high";

export interface AgentGoal {
  id: string;
  text: string;
  successCriteria: string[];
  constraints: string[];
  riskLevel: AgentRiskLevel;
}

export interface AgentObservation {
  id: string;
  runId: string;
  stepId: string;
  status: "ok" | "partial" | "failed" | "blocked";
  facts: string[];
  errorMessage?: string;
  rawRef?: string;
  summary?: AgentEvidenceSummary;
  createdAt: string;
}

export interface AgentApprovalRequest {
  id: string;
  runId: string;
  stepId: string;
  toolId: string;
  toolCallId?: string;
  reason: string;
  input?: Record<string, unknown>;
  inputHash?: string;
  createdAt: string;
}

export interface AgentToolMeta {
  toolId: string;
  title: string;
  description: string;
  inputSchema?: McpToolDefinition["inputSchema"];
  domain?: McpToolDefinition["domain"];
  source?: McpToolDefinition["source"];
  tags?: string[];
  capabilities?: McpToolDefinition["capabilities"];
}

export interface PendingToolCall {
  id: string;
  toolId: string;
  args: Record<string, unknown>;
  reason?: string;
  inputHash: string;
  source: "planner";
  status: "frozen";
  toolMeta?: AgentToolMeta;
  createdAt: string;
}

export interface LegacyAgentToolCallRequest {
  toolId: string;
  args: Record<string, unknown>;
  inputHash: string;
  source: "planner_selection" | "llm_tool_call";
  /**
   * Compatibility marker for frozen invocations owned by a forked Skill Agent.
   * They participate in the existing approval persistence/resume contract but
   * must never be executed through the Parent Harness tool path.
   */
  origin?: "skill_agent";
  skillId?: string;
  createdAt: string;
}

export type AgentToolCallRequest =
  | PendingToolCall
  | LegacyAgentToolCallRequest;

export interface AgentApprovedInvocation {
  toolId: string;
  input: Record<string, unknown>;
  inputHash: string;
  approvedAt: string;
  approvalId: string;
}

export interface AgentPolicyDecision {
  type: "allow" | "require_approval" | "deny" | "skip" | "error";
  toolId?: string;
  inputHash?: string;
  reason: string;
}

export interface AgentToolExecutionResult {
  toolCallId?: string;
  toolId: string;
  inputHash?: string;
  args: Record<string, unknown>;
  invocationId?: string;
  status: "completed" | "failed" | "awaiting_approval" | "denied";
  failureKind?: "recoverable" | "terminal";
  failureCode?: McpInvocationFailureCode;
  recoveryAttemptCount?: number;
  result?: unknown;
  evidence?: McpToolEvidence;
  errorMessage?: string;
  approval?: AgentApprovalRequest;
  summary?: AgentEvidenceSummary;
  startedAt: string;
  finishedAt: string;
}

export interface AgentRetrievalEvidence {
  knowledgeBaseId?: string | null;
  query: string;
  chunkCount: number;
  chunks: Array<{
    chunkId: string | number;
    documentName: string;
    score?: number;
      content: string;
  }>;
  summary?: AgentEvidenceSummary;
  createdAt: string;
}

export interface AgentEvidencePayload {
  observations: AgentObservation[];
  toolExecutions: AgentToolExecutionResult[];
  retrievals: AgentRetrievalEvidence[];
  latestSummary?: AgentEvidenceSummary;
}

export type AgentEvidenceReference =
  | `tool:${number}`
  | `retrieval:${number}`
  | `observation:${number}`;

export interface AgentCompletionProof {
  criterion: string;
  evidenceRefs: AgentEvidenceReference[];
}

/**
 * Frozen semantic handoff from Planner to Generate.
 * Planner owns the completion decision; Generate may only render this decision
 * from the explicitly referenced Evidence records.
 */
export interface AgentFinalizationPacket {
  type: "answer";
  reason: string;
  completionProof: AgentCompletionProof[];
  unresolvedGaps: string[];
}

export interface AgentReadListEvidenceData {
  kind: "read_list";
  path: string;
  entryCount: number;
  fileCount: number;
  directoryCount: number;
  entriesPreview: string[];
  truncated: boolean;
}

export interface AgentReadDiscoverEvidenceData {
  kind: "read_discover";
  mode: "list" | "locate";
  operation: "list" | "locate";
  path?: string;
  root?: string;
  query?: string;
  candidateCount: number;
  candidatePaths: string[];
  returnedCount: number;
  totalCount?: number;
  hasMore: boolean;
  truncated: boolean;
}

export interface AgentReadOpenEvidenceData {
  kind: "read_open";
  path: string;
  contentPreview: string;
  contentLength: number;
  truncated: boolean;
  keySections?: string[];
}

export interface AgentReadLocateEvidenceData {
  kind: "read_locate";
  scope: string;
  query: string;
  searchMode: "auto" | "path" | "content";
  matchCount: number;
  matchedPaths: string[];
  matchesPreview: string[];
  truncated: boolean;
}

export interface AgentWebSearchEvidenceData {
  kind: "web_search";
  query: string;
  resultCount: number;
  topFindings: string[];
  citationsPreview: Array<{
    title: string;
    link: string;
  }>;
}

export type AgentEvidenceResolution =
  | "true"
  | "false"
  | "unknown";

export interface AgentTerminalSessionEvidenceData {
  kind: "terminal_session";
  command: string;
  exitCode: number | null;
  processCompleted: boolean;
  commandSucceeded: AgentEvidenceResolution;
  stdoutPreview: string;
  stderrPreview: string;
  stdoutEncoding: SandboxOutputEncoding;
  stderrEncoding: SandboxOutputEncoding;
  timedOut: boolean;
  truncated: boolean;
  binaryDetected: boolean;
  violations: string[];
  outputInterpretable: boolean;
  unreadableReason?: string;
}

export interface AgentRetrievalEvidenceData {
  kind: "retrieval";
  query: string;
  chunkCount: number;
  documentsPreview: string[];
}

export interface AgentObservationEvidenceData {
  kind: "observation";
  stepId: string;
  factsPreview: string[];
}

export interface AgentWorkspaceMutationEvidenceData {
  kind: "workspace_mutation";
  operation: "create" | "overwrite" | "replace" | "delete" | "move" | "unknown";
  targetPath?: string;
  destinationPath?: string;
  dryRun?: boolean;
  changed?: boolean;
  created?: boolean;
  replaced?: boolean;
  deleted?: boolean;
  moved?: boolean;
  runtimeToolId?: string;
  actionProfileId?: string;
}

export interface AgentExternalMcpEvidenceData {
  kind: "external_mcp";
  serverId: string;
  remoteToolName: string;
  invocationStatus: "completed" | "failed";
  recoveryOccurred: boolean;
  resultPreview?: string;
}

export interface AgentEditFileEvidenceData {
  kind: "edit_file";
  operation: "create" | "overwrite" | "replace" | "delete" | "move" | "unknown";
  targetPath?: string;
  dryRun?: boolean;
  changed?: boolean;
  created?: boolean;
  replaced?: boolean;
  deleted?: boolean;
  runtimeToolId?: string;
  actionProfileId?: string;
}

export type AgentEvidenceSummaryData =
  | AgentGenericStructuredEvidenceData
  | AgentReadDiscoverEvidenceData
  | AgentReadListEvidenceData
  | AgentReadOpenEvidenceData
  | AgentReadLocateEvidenceData
  | AgentWebSearchEvidenceData
  | AgentTerminalSessionEvidenceData
  | AgentRetrievalEvidenceData
  | AgentObservationEvidenceData
  | AgentExternalMcpEvidenceData
  | AgentWorkspaceMutationEvidenceData
  | AgentEditFileEvidenceData;

export interface AgentGenericStructuredEvidenceData {
  kind: "generic_structured";
  preview: unknown;
  truncated: boolean;
  redacted: boolean;
  unsupported: boolean;
  itemCount?: number;
  total?: number;
  hasNextCursor?: boolean;
}

export interface AgentEvidenceSummary {
  source: "tool" | "retrieval" | "observation";
  status:
    | "completed"
    | "failed"
    | "partial"
    | "blocked"
    | "denied"
    | "timed_out"
    | "truncated"
    | "binaryDetected";
  toolId?: string;
  inputHash?: string;
  actionTaken: string;
  keyFindings: string[];
  facts?: string[];
  gaps?: string[];
  error?: string;
  data?: AgentEvidenceSummaryData;
  rawRef?: {
    evidenceIndex?: number;
    toolCallId?: string;
    invocationId?: string;
  };
}

export type AgentNextAction =
  | AgentFinalizationPacket
  | {
      type: "retrieve";
      query: string;
      reason: string;
    }
  | {
      type: "use_tool";
      toolId: string;
      args: Record<string, unknown>;
      reason: string;
    }
  | {
      type: "ask_user";
      question: string;
      reason: string;
    }
  | {
      type: "error";
      reason: string;
    };

export interface AgentToolExposureState {
  exposedTools: string[];
  toolMeta: AgentToolMeta[];
  requestedToolGroups?: AgentRequestedToolGroupHint[];
}

export interface AgentRequestedToolGroupHint {
  groupId: string;
  groupLabel: string;
  groupDescription: string;
  toolIds: string[];
  exposedToolIds: string[];
  status: "available" | "unavailable" | "unknown";
}

export interface AgentSchemaReplanDiagnostics {
  schemaError: string;
  toolId?: string;
  invalidAction?: Extract<AgentNextAction, { type: "use_tool" }>;
  attemptCount: number;
}

export interface CurrentTaskFrameConfirmedObject {
  type: "file" | "command" | "tool" | "script" | "knowledge" | "approval";
  id?: string;
  label: string;
  confidence?: number;
}

/**
 * Runtime-minimum task board for the current agent loop.
 * PlannerNode is the only runtime writer of goal/subtask/completion inference.
 * Executor nodes report objective facts through evidence and observations.
 * Generate/Evaluate nodes are read-only.
 */
export interface CurrentTaskFrame {
  /**
   * Stable top-level task objective. Runtime hydrates this from AgentGoal.text and
   * never derives it from a follow-up user reply or a mutable plan item.
   * Optional only for compatibility with task frames persisted before this field existed.
   */
  globalGoal?: string;
  currentGoal: string;
  currentSubtask?: string;
  currentBlocker?: string;
  confirmedObjects: CurrentTaskFrameConfirmedObject[];
  completionCriteria: string[];
  coveredProgress?: string[];
  remainingWork?: string[];
}

export type AgentExecutionObservationStatus =
  | "completed"
  | "failed_recoverable"
  | "failed_terminal"
  | "waiting_approval";

export type AgentExecutionObservationActionType =
  | "retrieve"
  | "tool"
  | "generate"
  | "approval";

export interface AgentExecutionObservation {
  id: string;
  source: "observation" | "tool_execution" | "approval" | "retrieval";
  actionType: AgentExecutionObservationActionType;
  status: AgentExecutionObservationStatus;
  createdAt: string;
  stepId?: string;
  toolId?: string;
  toolCallId?: string;
  inputHash?: string;
  argsPreview?: unknown;
  resultPreview?: unknown;
  summary?: AgentEvidenceSummary;
  facts?: string[];
  errorMessage?: string;
  errorCode?: string;
  recoverable?: boolean;
  suggestedNextActions?: string[];
  reason?: string;
}

export interface PlannerObservationRecoveryContext {
  source: "tool_failure" | "schema_replan" | "none";
  attemptCount: number;
  maxAttempts: number;
  exhausted: boolean;
  inputHash?: string;
  errorMessage?: string;
  failureKind?: "recoverable" | "terminal";
  schemaError?: string;
  toolId?: string;
  invalidAction?: Extract<AgentNextAction, { type: "use_tool" }>;
}

export interface PlannerObservationContext {
  currentTaskFrame?: CurrentTaskFrame;
  latestObservation?: AgentExecutionObservation;
  recentObservations: AgentExecutionObservation[];
  evidenceCatalog: Array<{
    ref: AgentEvidenceReference;
    source: "tool" | "retrieval" | "observation";
    status: string;
    label: string;
  }>;
  latestEvidenceSummary?: AgentEvidenceSummary;
  latestToolCall?: {
    toolId: string;
    args: Record<string, unknown>;
    inputHash?: string;
    status: AgentToolExecutionResult["status"];
    resultSummary?: AgentEvidenceSummary;
    failureKind?: AgentToolExecutionResult["failureKind"];
    failureCode?: AgentToolExecutionResult["failureCode"];
    retryCount: number;
  };
  recovery: PlannerObservationRecoveryContext;
  pendingApproval?: {
    toolId: string;
    inputHash?: string;
    reason: string;
  };
}

export interface ConversationWorkdirReference {
  id: string;
  threadId: string;
  rootPath: string;
}

export interface AgentRun {
  id: string;
  threadId: string;
  userId: number;
  goal: AgentGoal;
  status: AgentRunStatus;
  observations: AgentObservation[];
  traceId: string;
  blockedReason?: string;
  terminalReason?: string;
  pendingApproval?: AgentApprovalRequest;
  approvedInvocations?: AgentApprovedInvocation[];
  policyDecision?: AgentPolicyDecision;
  contextBudget?: ContextBudgetAudit;
  /**
   * Legacy / trace / UI compatibility only.
   * It must not be treated as a tool execution entry.
   * Real execution must always use pendingToolCall.toolId.
   */
  selectedToolId?: string;
  pendingToolCall?: AgentToolCallRequest;
  lastToolExecution?: AgentToolExecutionResult;
  evidence?: AgentEvidencePayload;
  currentTaskFrame?: CurrentTaskFrame;
  finalizationPacket?: AgentFinalizationPacket;
  assistantMessageId?: string;
  assistantParentId?: string | null;
  runtimeInput?: Pick<
    AgentGraphInput,
    | "messages"
    | "requestContextMessages"
    | "params"
    | "knowledgeBaseId"
    | "intentConfig"
    | "workspaceRoot"
    | "conversationWorkdir"
    | "requestedToolGroupIds"
  >;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunStore {
  create(input: {
    threadId: string;
    userId: number;
    goal: AgentGoal;
    assistantMessageId?: string;
    assistantParentId?: string | null;
    runtimeInput?: Pick<
      AgentGraphInput,
      | "messages"
      | "requestContextMessages"
      | "params"
      | "knowledgeBaseId"
      | "intentConfig"
      | "workspaceRoot"
      | "conversationWorkdir"
      | "requestedToolGroupIds"
    >;
  }): AgentRun;
  get(runId: string): AgentRun | undefined;
  update(runId: string, patch: Partial<Omit<AgentRun, "id" | "createdAt">>): AgentRun;
  addObservation(runId: string, observation: AgentObservation): AgentRun;
  complete(
    runId: string,
    patch: Partial<Omit<AgentRun, "id" | "createdAt" | "status">> & {
      status: Extract<
        AgentRun["status"],
        | "completed"
        | "failed"
        | "blocked"
        | "cancelled"
        | "waiting_approval"
        | "waiting_user"
      >;
    },
  ): AgentRun;
  configureRetention?(config: { maxEntries?: number; ttlMs?: number }): void;
  sweep?(): void;
  clear(): void;
}

export interface AgentGraphInput {
  runId: string;
  runControlLeaseId?: string;
  threadId: string;
  userId: number;
  goal: AgentGoal;
  messages: NormalizedChatMessage[];
  requestContextMessages?: NormalizedChatMessage[];
  params?: Record<string, unknown>;
  knowledgeBaseId?: string | null;
  intentConfig?: AgentIntentEmbeddingConfig;
  workspaceRoot?: string | null;
  conversationWorkdir?: ConversationWorkdirReference;
  requestedToolGroupIds?: string[];
  approvedInvocations?: AgentApprovedInvocation[];
  policyDecision?: AgentPolicyDecision;
  /**
   * Legacy / trace / UI compatibility only.
   * Graph routing, policy approval and tool execution must not derive execution
   * from this field.
   */
  selectedToolId?: string;
  pendingToolCall?: AgentToolCallRequest;
  currentTaskFrame?: CurrentTaskFrame;
  finalizationPacket?: AgentFinalizationPacket;
  maxIterations?: number;
  onExecutionNode?: (
    event: AssistantExecutionNodeEvent,
  ) => Promise<void> | void;
}

export interface AgentGraphOutput {
  answer: string;
  observations: AgentObservation[];
  evidence: AgentEvidencePayload;
  retrievedChunks: RetrievedChunk[];
  toolIntent?: ToolIntentResult;
  pendingApproval?: AgentApprovalRequest;
  policyDecision?: AgentPolicyDecision;
  /**
   * Legacy / trace / UI compatibility only.
   * This can be surfaced for diagnostics or UI continuity, but execution must
   * remain bound to pendingToolCall.toolId.
   */
  selectedToolId?: string;
  pendingToolCall?: AgentToolCallRequest;
  approvedInvocations?: AgentApprovedInvocation[];
  lastToolExecution?: AgentToolExecutionResult;
  currentTaskFrame?: CurrentTaskFrame;
  finalizationPacket?: AgentFinalizationPacket;
  blockedReason?: string;
  terminalReason?: string;
  errorMessage?: string;
  errorSourceNodeId?: string;
  contextBudget?: ContextBudgetAudit;
  status: Extract<
    AgentRunStatus,
    "completed" | "failed" | "blocked" | "waiting_approval" | "waiting_user"
  >;
}
