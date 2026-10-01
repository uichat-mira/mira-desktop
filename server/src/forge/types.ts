export const TASK_STATUSES = [
  "waiting",
  "building",
  "reviewing",
  "fixing",
  "waiting_integration",
  "interrupted",
  "stale",
  "review_passed",
  "integrated",
] as const;

export const ADAPTER_KINDS = ["builder", "reviewer", "git"] as const;
export const ADAPTER_STATUSES = ["available", "busy", "offline", "error"] as const;
export const SESSION_ROLES = ["builder", "reviewer"] as const;
export const SESSION_STATUSES = [
  "starting",
  "running",
  "waiting",
  "completed",
  "failed",
  "disconnected",
] as const;
export const REVIEW_STATUSES = [
  "requested",
  "passed",
  "changes_requested",
  "failed",
  "cancelled",
] as const;

export type ForgeTaskStatus = (typeof TASK_STATUSES)[number];
export type ForgeAdapterKind = (typeof ADAPTER_KINDS)[number];
export type ForgeAdapterStatus = (typeof ADAPTER_STATUSES)[number];
export type ForgeSessionRole = (typeof SESSION_ROLES)[number];
export type ForgeSessionStatus = (typeof SESSION_STATUSES)[number];
export type ForgeReviewStatus = (typeof REVIEW_STATUSES)[number];
export type ForgeBatchStatus =
  | "planned"
  | "active"
  | "reviewing"
  | "waiting_integration"
  | "attention"
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
  status: ForgeBatchStatus;
  baseSha: string | null;
  tasks: ForgeTask[];
  createdAt: string;
  updatedAt: string;
}

export interface ForgeAdapter {
  id: string;
  name: string;
  kind: ForgeAdapterKind;
  capabilities: string[];
  status: ForgeAdapterStatus;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ForgeSession {
  id: string;
  role: ForgeSessionRole;
  adapterId: string;
  projectId: string;
  batchId: string;
  taskId: string;
  status: ForgeSessionStatus;
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
  status: ForgeReviewStatus;
  actionable: boolean | null;
  invalidatedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ForgeDispatchStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ForgeDispatch {
  id: string;
  projectId: string;
  batchId: string;
  taskId: string;
  adapterId: string;
  sessionId: string;
  sourceThreadId: string | null;
  status: ForgeDispatchStatus;
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

export interface ForgeCoreState {
  projects: ForgeProject[];
  batches: ForgeBatch[];
  adapters?: ForgeAdapter[];
  sessions?: ForgeSession[];
  reviews?: ForgeReview[];
  dispatches?: ForgeDispatch[];
  events?: ForgeRuntimeEvent[];
}
