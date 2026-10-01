export interface ForgeMeta {
  taskStatuses: string[];
  adapterKinds: string[];
  adapterStatuses: string[];
  sessionRoles: string[];
  sessionStatuses: string[];
  reviewStatuses: string[];
  dispatchStatuses: string[];
  builderChoices: Array<"opencode" | "piagent" | "codex">;
  builtinBuilderAdapters: string[];
  mainThreadAdapters: Array<"opencode" | "codex-desktop" | "codex">;
  mainThreadStatuses: Array<"idle" | "running" | "error">;
  mainThreadEventTypes: Array<"message" | "thinking" | "tool" | "status" | "artifact" | "handoff">;
}

export type ForgeTaskStatus =
  | "waiting"
  | "building"
  | "reviewing"
  | "fixing"
  | "waiting_integration"
  | "interrupted"
  | "stale"
  | "review_passed"
  | "integrated";

export interface ForgeProject {
  id: string;
  name: string;
  rootPath: string;
  repository: string | null;
  taskLedger: string | null;
  taskDir: string | null;
  integrationBranch: string;
  createdAt: string;
  updatedAt: string;
}

export interface ForgeRepositoryTask {
  id: string;
  title: string;
  status: string;
  cardStatus: string;
  taskRef: string;
  warnings: string[];
}

export interface ForgeTaskSource {
  kind: "repository-markdown";
  ledgerRef: string;
  taskDirRef: string;
  tasks: ForgeRepositoryTask[];
}

export interface ForgeTask {
  id: string;
  title: string;
  status: ForgeTaskStatus;
  builder: string | null;
  builderSessionId: string | null;
  reviewerSessionId: string | null;
  worktree: string | null;
  baseSha: string | null;
  currentSha: string | null;
  reviewedSha: string | null;
  reviewRound: number;
  dependsOn: string[];
  previewUrls: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ForgeBatch {
  id: string;
  projectId: string;
  name: string;
  status:
    | "planned"
    | "active"
    | "reviewing"
    | "waiting_integration"
    | "attention"
    | "integrated";
  baseSha: string | null;
  tasks: ForgeTask[];
  createdAt: string;
  updatedAt: string;
}

export interface ForgeReadinessReason {
  code:
    | "task_status"
    | "active_builder_session"
    | "dependency_not_integrated";
  status?: ForgeTaskStatus;
  sessionId?: string;
  taskId?: string;
}

export interface ForgeDispatchReadiness {
  batchId: string;
  projectId: string;
  ready: Array<{
    taskId: string;
    title: string;
    status: ForgeTaskStatus;
    dependsOn: string[];
  }>;
  blocked: Array<{
    taskId: string;
    title: string;
    status: ForgeTaskStatus;
    dependsOn: string[];
    reasons: ForgeReadinessReason[];
  }>;
}

export interface ForgeMainThread {
  id: string;
  projectId: string;
  adapter: "opencode" | "codex-desktop" | "codex";
  title: string;
  model: string | null;
  status: "idle" | "running" | "error";
  externalThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ForgeMainThreadEvent {
  id: string;
  threadId: string;
  projectId: string;
  type: "message" | "thinking" | "tool" | "status" | "artifact" | "handoff";
  role: string | null;
  text: string | null;
  tool: { name: string; status: string | null } | null;
  artifact: { kind: string; ref: string | null } | null;
  handoff: Record<string, unknown> | null;
  provider: {
    adapter: string | null;
    eventType: string | null;
    itemType: string | null;
    status: string | null;
  } | null;
  createdAt: string;
}

export interface ForgeMainThreadSnapshot {
  thread: ForgeMainThread;
  events: ForgeMainThreadEvent[];
}

export interface ForgeDispatch {
  id: string;
  projectId: string;
  batchId: string;
  taskId: string;
  adapterId: string;
  sessionId: string;
  sourceThreadId: string | null;
  status:
    | "starting"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  promptSource: "task_ref" | "inline";
  taskRef: string | null;
  model: string | null;
  agent: string | null;
  externalSessionId: string | null;
  pid: number | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  resultText: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ForgeSession {
  id: string;
  role: "builder" | "reviewer";
  adapterId: string;
  projectId: string;
  batchId: string;
  taskId: string;
  status:
    | "starting"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "disconnected";
  externalSessionId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ForgeReview {
  id: string;
  projectId: string;
  batchId: string;
  taskId: string;
  reviewerSessionId: string;
  round: number;
  requestedSha: string;
  reviewedSha: string | null;
  status:
    | "requested"
    | "passed"
    | "changes_requested"
    | "failed"
    | "cancelled";
  actionable: boolean | null;
  invalidatedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ForgeRuntimeEvent {
  id: string;
  type: string;
  projectId: string | null;
  batchId: string | null;
  taskId: string | null;
  dispatchId: string | null;
  sessionId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ForgeRuntimeSummary {
  schemaVersion: number;
  projectCount: number;
  batchCount: number;
  activeBatchCount: number;
  threadCount: number;
  activeThreadCount: number;
  dispatchCount: number;
  activeDispatch: ForgeDispatch | null;
  reviewCount: number;
  pendingReviewCount: number;
  attentionTaskCount: number;
  adapterSummary: Array<{
    id: string;
    name: string;
    kind: string;
    status: string;
  }>;
  updatedAt: string | null;
}

export interface ForgeInspectorData {
  project: ForgeProject | null;
  batch: ForgeBatch | null;
  task: ForgeTask | null;
  dispatch: ForgeDispatch | null;
  session: ForgeSession | null;
  review: ForgeReview | null;
  thread: ForgeMainThread | null;
  threadEvents: ForgeMainThreadEvent[];
  events: ForgeRuntimeEvent[];
}
