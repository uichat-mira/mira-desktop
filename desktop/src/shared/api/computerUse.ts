import { get, post } from "@/shared/lib/request";
import { getApiBaseUrl } from "@/shared/platform/desktopRuntime";

const BASE = "/microapps/computer-use";

export function resolveComputerUseArtifactUrl(uri: string): string {
  if (/^(https?:|data:|blob:)/.test(uri)) return uri;
  return `${getApiBaseUrl()}${uri.startsWith("/") ? uri : `/${uri}`}`;
}

export type ComputerUseRuntimeStatus = "ready" | "not_installed" | "downloading" | "broken";
export type ComputerUseSessionStatus = "empty" | "ready" | "failed" | "stopped";
export type ComputerUseInvocationStatus =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ComputerUseRuntimeState {
  status: ComputerUseRuntimeStatus;
  browserEngine?: "chromium" | "chrome" | "edge";
  version?: string;
  message?: string;
  checkedAt: string;
  details?: {
    strategy?: "managed" | "system" | "download";
    source?: "managed" | "system";
    executablePath?: string;
    inspectedCandidates?: Array<{
      source: "managed" | "system";
      channel: "chromium" | "chrome" | "edge";
      executablePath: string;
      version: string;
      installedAt: string;
    }>;
  };
}

export interface ComputerUseDebuggerStatus {
  runtime: ComputerUseRuntimeState;
}

export interface ComputerUseSessionConfig {
  runtime: "managed" | "system";
  url: string;
  allowedDomains: string[];
  limits: { timeoutMs: number; maxSnapshotChars: number };
  approvalPolicy: "always" | "write_actions" | "never";
}

export interface ComputerUseBrowserState {
  url?: string;
  title?: string;
  snapshot?: string;
  visibleText?: string;
  screenshotArtifact?: string;
  snapshotHash?: string;
}

export interface ComputerUseInvocation {
  invocationId: string;
  tool: "browser_observe" | "browser_act" | "browser_assert";
  args: Record<string, unknown>;
  status: ComputerUseInvocationStatus;
  error?: { code: string; message: string };
  artifactIds?: string[];
  createdAt: string;
}

export interface ComputerUseSession {
  sessionId: string;
  status: ComputerUseSessionStatus;
  config: ComputerUseSessionConfig;
  browser: ComputerUseBrowserState;
  invocations: ComputerUseInvocation[];
  approval?: { status: "pending" | "approved" | "rejected" | "expired"; reason?: string; approvalId?: string; invocationId?: string };
  evidence?: { entries: Array<Record<string, unknown>>; artifacts: Array<Record<string, unknown>> };
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface ComputerUseActionInput {
  pageUrl: string;
  snapshotHash: string;
  action: { kind: "navigate"; url: string } | { kind: "click"; ref: string } | { kind: "type"; ref: string; text: string } | { kind: "select"; ref: string; value: string } | { kind: "press"; ref: string; key: string } | { kind: "scroll"; x?: number; y?: number } | { kind: "wait"; timeoutMs?: number };
}

export interface ComputerUseAssertionInput {
  assertion: { kind: "title" | "url" | "text"; expected: string } | { kind: "visible"; ref: string } | { kind: "value"; ref: string; expected: string };
}

export async function getComputerUseDebuggerStatus(): Promise<ComputerUseDebuggerStatus> {
  return get<ComputerUseDebuggerStatus>(`${BASE}/debugger/status`);
}

export async function installComputerUseRuntime(force = false): Promise<void> {
  await post(`${BASE}/runtime/install`, { force });
}

export async function createComputerUseSession(
  config: ComputerUseSessionConfig,
): Promise<ComputerUseSession> {
  return post<ComputerUseSession>(`${BASE}/sessions`, config);
}

export async function getComputerUseSession(sessionId: string): Promise<ComputerUseSession> {
  return get<ComputerUseSession>(`${BASE}/sessions/${encodeURIComponent(sessionId)}`);
}

export async function observeComputerUseSession(sessionId: string): Promise<ComputerUseSession> {
  return post<ComputerUseSession>(`${BASE}/sessions/${encodeURIComponent(sessionId)}/observe`);
}

export async function executeComputerUseAction(
  sessionId: string,
  input: ComputerUseActionInput,
): Promise<ComputerUseSession> {
  return post<ComputerUseSession>(`${BASE}/sessions/${encodeURIComponent(sessionId)}/action`, input);
}

export async function assertComputerUseSession(
  sessionId: string,
  input: ComputerUseAssertionInput,
): Promise<ComputerUseSession> {
  return post<ComputerUseSession>(`${BASE}/sessions/${encodeURIComponent(sessionId)}/assert`, input);
}

export async function stopComputerUseSession(sessionId: string): Promise<ComputerUseSession> {
  return post<ComputerUseSession>(`${BASE}/sessions/${encodeURIComponent(sessionId)}/stop`);
}

export async function approveComputerUseSession(sessionId: string, invocationId: string): Promise<ComputerUseSession> {
  return post<ComputerUseSession>(`${BASE}/sessions/${encodeURIComponent(sessionId)}/approval`, { invocationId });
}

export async function rejectComputerUseSession(sessionId: string, invocationId: string, reason?: string): Promise<ComputerUseSession> {
  return post<ComputerUseSession>(`${BASE}/sessions/${encodeURIComponent(sessionId)}/approval/reject`, { invocationId, reason });
}
