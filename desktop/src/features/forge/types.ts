import type {
  ForgeDispatch as ApiForgeDispatch,
  ForgeTaskStatus,
} from "@/shared/api/forge/types";

export type ForgeDispatchStatus = ApiForgeDispatch["status"];

export type ForgeRepositoryState = string;
export type ForgeRuntimeState = ForgeTaskStatus;

export interface ForgeProject {
  id: string;
  name: string;
  repositoryPath: string;
  branch: string;
  activeRuntimeCount: number;
  attentionCount: number;
}

export interface ForgeTask {
  id: string;
  title: string;
  batchId: string | null;
  repositoryState: ForgeRepositoryState;
  repositoryLedgerState: string;
  runtimeState: ForgeRuntimeState;
  source: string;
  dependencies: string[];
  readiness: "ready" | "blocked" | "stale" | "unavailable";
  readinessReasons: string[];
  warnings: string[];
  currentSha: string | null;
  reviewedSha: string | null;
}

export interface ForgeBuilderResultHandoff {
  taskId: string;
  adapterId: string;
  dispatchId: string;
  dispatchStatus: string;
  taskStatus: string;
  sessionStatus: string | null;
  resultText: string | null;
  error: string | null;
}

export interface ForgeMessage {
  id: string;
  kind: "message" | "builder-result";
  author: "operator" | "mira" | "system";
  body: string;
  createdAt: string;
  trace?: string[];
  handoff?: ForgeBuilderResultHandoff;
}

export interface ForgeRuntimeRecord {
  id: string;
  taskId: string;
  builder: string;
  state: ForgeDispatchStatus;
  sourceThreadId: string | null;
  externalSessionId: string | null;
  error?: string;
  summary?: string;
}

export interface ForgeEvent {
  id: string;
  timestamp: string;
  kind: string;
  message: string;
  taskId?: string;
}

export interface ForgeInspectorView {
  taskId: string | null;
  dispatchId: string | null;
  sessionId: string | null;
  reviewStatus: string | null;
  reviewedSha: string | null;
  currentSha: string | null;
  detailLines: string[];
}

export interface ForgeRegisterProjectValues {
  name: string;
  repositoryPath: string;
  branch: string;
  taskLedger?: string;
  taskDir?: string;
}

export interface ForgeWorkspaceSnapshot {
  projects: ForgeProject[];
  selectedProjectId?: string;
  tasks: ForgeTask[];
  selectedTaskId?: string;
  selectedThreadId?: string;
  mainThread: {
    adapter: "opencode" | "codex-desktop" | "codex";
    status: "idle" | "running" | "error";
  } | null;
  messages: ForgeMessage[];
  runtimes: ForgeRuntimeRecord[];
  events: ForgeEvent[];
  inspector: ForgeInspectorView | null;
  activeRuntimeCount: number;
  attentionCount: number;
  builderChoices: Array<"opencode" | "piagent" | "codex">;
  mainThreadAdapters: Array<"opencode" | "codex-desktop" | "codex">;
  taskSourceError: string | null;
}
