import fs from "node:fs/promises";
import path from "node:path";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import { executeInvocation, resolveInvocationApproval } from "@/mcp/core/invocations.js";
import type { ToolInvocation } from "@/mcp/core/definitions.js";
import type { BrowserActInput, BrowserArtifact, BrowserAssertInput, BrowserToolResult } from "@/microapps/computer-use/browser/types.js";
import type { BrowserSessionManager, ManagedBrowserSession } from "@/microapps/computer-use/session/manager.js";
import { BrowserService } from "@/microapps/computer-use/browser/service.js";

export type ComputerUseDebuggerSessionConfig = {
  runtime: "managed" | "system";
  url: string;
  allowedDomains: string[];
  limits: { timeoutMs: number; maxSnapshotChars: number };
  approvalPolicy: "always" | "write_actions" | "never";
};

type Invocation = {
  invocationId: string;
  tool: "browser_observe" | "browser_act" | "browser_assert";
  args: Record<string, unknown>;
  status: "awaiting_approval" | "succeeded" | "failed" | "cancelled";
  error?: { code: string; message: string };
  artifactIds?: string[];
  createdAt: string;
};

type DebuggerSession = {
  sessionId: string;
  config: ComputerUseDebuggerSessionConfig;
  status: "ready" | "failed" | "stopped";
  browser: { url?: string; title?: string; snapshot?: string; visibleText?: string; screenshotArtifact?: string; snapshotHash?: string };
  invocations: Invocation[];
  evidence: { entries: Array<Record<string, unknown>>; artifacts: Array<Record<string, unknown>> };
  approval?: { status: "pending" | "approved" | "rejected"; reason?: string; approvalId?: string; invocationId?: string };
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  pending?: { invocationId: string; args: Record<string, unknown> };
};

export type ComputerUseDebuggerService = {
  getStatus(): { runtime: Record<string, unknown>; model: { status: "connected" | "unavailable"; message: string; checkedAt: string } };
  create(config: ComputerUseDebuggerSessionConfig): Promise<DebuggerSession>;
  get(sessionId: string): DebuggerSession | null;
  observe(sessionId: string): Promise<DebuggerSession>;
  act(sessionId: string, input: Omit<BrowserActInput, "sessionId">): Promise<DebuggerSession>;
  assert(sessionId: string, input: Omit<BrowserAssertInput, "sessionId">): Promise<DebuggerSession>;
  approve(sessionId: string, invocationId: string): Promise<DebuggerSession>;
  reject(sessionId: string, invocationId: string, reason?: string): Promise<DebuggerSession>;
  stop(sessionId: string): Promise<DebuggerSession>;
  readArtifact(sessionId: string, artifactId: string): Promise<{ bytes: Buffer; contentType: string }>;
};

const now = () => new Date().toISOString();
const toArtifactIds = (artifacts: BrowserArtifact[]) => artifacts.map((artifact) => artifact.id);
export const getDebuggerInvocationStatus = (invocationStatus: ToolInvocation["status"], resultOk: boolean): Invocation["status"] =>
  invocationStatus === "awaiting_approval"
    ? "awaiting_approval"
    : invocationStatus === "completed" && resultOk
      ? "succeeded"
      : "failed";
export const browserResultFromRecord = (record: ToolInvocation): BrowserToolResult => {
  const result = record.result as BrowserToolResult | { result?: BrowserToolResult } | undefined;
  if (result && "ok" in result && typeof result.ok === "boolean") return result;
  if (result && "result" in result && result.result) return result.result;
  return { ok: false, sessionId: String(record.args.sessionId ?? ""), invocationId: record.id, page: { url: String(record.args.pageUrl ?? ""), title: "" }, artifacts: [], error: { code: record.status === "awaiting_approval" ? "approval_required" : record.error?.failureCode ?? "invocation_failed", message: record.approval?.reason ?? record.error?.message ?? "Computer Use invocation failed.", retryable: record.status === "awaiting_approval" } };
};

export const createComputerUseDebuggerService = (input: {
  sessions: BrowserSessionManager;
  browser: BrowserService;
  runtimeStatus: () => Record<string, unknown>;
  modelStatus?: () => { status: "connected" | "unavailable"; message: string };
}): ComputerUseDebuggerService => {
  const records = new Map<string, DebuggerSession>();
  const getRecord = (id: string) => records.get(id);
  const managed = (id: string): ManagedBrowserSession => {
    const value = input.sessions.get(id);
    if (!value) throw new Error("Browser session is not available.");
    return value;
  };
  const apply = (record: DebuggerSession, tool: Invocation["tool"], args: Record<string, unknown>, invocation: ToolInvocation) => {
    const result = browserResultFromRecord(invocation);
    const screenshot = result.artifacts.find((artifact) => artifact.kind === "screenshot");
    record.browser = { url: result.page.url, title: result.page.title, snapshotHash: result.page.snapshotHash, snapshot: result.observation?.snapshot, visibleText: result.observation?.visibleText, screenshotArtifact: screenshot ? `/microapps/computer-use/sessions/${record.sessionId}/artifacts/${encodeURIComponent(screenshot.id)}/content` : undefined };
    const status = getDebuggerInvocationStatus(invocation.status, result.ok);
    record.invocations.push({ invocationId: invocation.id, tool, args, status, error: result.error ? { code: result.error.code, message: result.error.message } : undefined, artifactIds: toArtifactIds(result.artifacts), createdAt: now() });
    record.evidence.artifacts.push(...result.artifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, title: artifact.title, uri: artifact.uri })));
    record.evidence.entries.push({ id: `evidence_${invocation.id}`, kind: tool === "browser_act" ? "action" : "observation", message: `${tool} completed with ${status}.`, createdAt: now(), artifactIds: toArtifactIds(result.artifacts), meta: { args, invocationId: invocation.id, traceId: invocation.traceId, status: invocation.status } });
    if (invocation.status === "awaiting_approval") record.approval = { status: "pending", approvalId: `approval_${invocation.id}`, invocationId: invocation.id, reason: invocation.approval?.reason };
    if (invocation.status === "completed" && tool === "browser_act") record.approval = record.approval ? { ...record.approval, status: "approved" } : undefined;
    if (status === "failed") record.error = result.error ? { code: result.error.code, message: result.error.message } : { code: "browser_tool_failed", message: "Computer Use browser tool returned a failed result." };
    return record;
  };
  const invoke = async (record: DebuggerSession, tool: Invocation["tool"], args: Record<string, unknown>, approvedInvocations?: Array<{ toolId: string; inputHash: string }>) => apply(record, tool, args, await executeInvocation({ toolId: tool, args, approvedInvocations, threadId: record.sessionId, turnId: `debugger-${tool}` }));

  return {
    getStatus() { const model = input.modelStatus?.() ?? { status: "unavailable" as const, message: "No Computer Use model provider is configured." }; return { runtime: input.runtimeStatus(), model: { ...model, checkedAt: now() } }; },
    async create(config) {
      const created = await input.sessions.create({ channel: config.runtime === "system" ? "chrome" : "chromium", allowedDomains: config.allowedDomains, initialUrl: config.url, headless: true, actionTimeoutMs: config.limits.timeoutMs, sessionTimeoutMs: config.limits.timeoutMs * 4 });
      const record: DebuggerSession = { sessionId: created.id, config, status: created.status === "ready" ? "ready" : "failed", browser: {}, invocations: [], evidence: { entries: [], artifacts: [] }, error: created.error };
      records.set(created.id, record);
      if (record.status === "ready") return invoke(record, "browser_observe", { sessionId: created.id, includeScreenshot: true, includeVisibleText: true, maxSnapshotChars: config.limits.maxSnapshotChars });
      return record;
    },
    get(sessionId) { return getRecord(sessionId) ?? null; },
    async observe(sessionId) { const record = getRecord(sessionId); if (!record) throw new Error("Browser session is not available."); return invoke(record, "browser_observe", { sessionId, includeScreenshot: true, includeVisibleText: true, maxSnapshotChars: record.config.limits.maxSnapshotChars }); },
    async act(sessionId, value) { const record = getRecord(sessionId); if (!record) throw new Error("Browser session is not available."); const args = { sessionId, ...value }; const requiresApproval = record.config.approvalPolicy !== "never"; const approved = requiresApproval ? undefined : [{ toolId: "browser_act", inputHash: createInvocationInputHash(args) }]; const next = await invoke(record, "browser_act", args, approved); if (next.approval?.status === "pending") next.pending = { invocationId: next.approval.invocationId!, args }; return next; },
    async assert(sessionId, value) { const record = getRecord(sessionId); if (!record) throw new Error("Browser session is not available."); return invoke(record, "browser_assert", { sessionId, ...value }, [{ toolId: "browser_assert", inputHash: createInvocationInputHash({ sessionId, ...value }) }]); },
    async approve(sessionId, invocationId) { const record = getRecord(sessionId); if (!record?.pending || record.pending.invocationId !== invocationId) throw new Error("Computer Use approval is not pending."); const args = record.pending.args; const next = await invoke(record, "browser_act", args, [{ toolId: "browser_act", inputHash: createInvocationInputHash(args) }]); resolveInvocationApproval({ invocationId, decision: "approved", resolutionInvocationId: next.invocations.at(-1)?.invocationId }); next.pending = undefined; return next; },
    async reject(sessionId, invocationId, reason) { const record = getRecord(sessionId); if (!record?.pending || record.pending.invocationId !== invocationId) throw new Error("Computer Use approval is not pending."); resolveInvocationApproval({ invocationId, decision: "rejected", reason: reason ?? "Browser action rejected." }); record.pending = undefined; record.approval = { ...record.approval, status: "rejected", invocationId, reason: reason ?? "Browser action rejected." }; record.invocations.push({ invocationId, tool: "browser_act", args: {}, status: "cancelled", error: { code: "COMPUTER_USE_APPROVAL_REJECTED", message: reason ?? "Browser action rejected." }, createdAt: now() }); record.evidence.entries.push({ id: `evidence_rejected_${invocationId}`, kind: "approval", message: reason ?? "Browser action rejected.", createdAt: now(), meta: { invocationId } }); record.result = { status: "cancelled", summary: "Browser action was rejected.", completedAt: now(), error: { code: "COMPUTER_USE_APPROVAL_REJECTED", message: reason ?? "Browser action rejected." } }; return record; },
    async stop(sessionId) {
      const record = getRecord(sessionId);
      if (!record) throw new Error("Browser session is not available.");
      if (record.status !== "stopped") await input.sessions.stop(sessionId);
      record.status = "stopped";
      record.pending = undefined;
      record.approval = record.approval?.status === "pending" ? { ...record.approval, status: "rejected", reason: "Browser session stopped." } : record.approval;
      record.result = { status: "cancelled", summary: "Browser session stopped.", completedAt: now() };
      return record;
    },
    async readArtifact(sessionId, artifactId) { const managedSession = managed(sessionId); const filePath = path.resolve(managedSession.artifactRoot, `${artifactId}.png`); if (path.dirname(filePath) !== path.resolve(managedSession.artifactRoot)) throw new Error("Artifact path is outside the session artifact root."); return { bytes: await fs.readFile(filePath), contentType: "image/png" }; },
  };
};
