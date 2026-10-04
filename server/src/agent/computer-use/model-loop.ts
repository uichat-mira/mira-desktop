import crypto from "node:crypto";
import { executeInvocation } from "@/mcp/core/invocations.js";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import { resolveAgentTaskProvider } from "@/services/provider-proxy.service/resolution.js";
import type { ComputerUseExecutor, ComputerUseExecutionCheckpoint, ComputerUseTask, ComputerUseRuntimeState, ComputerUseApprovalRequest, ComputerUsePlan } from "@/microapps/computer-use/core/types.js";
import { createComputerUsePlan } from "@/microapps/computer-use/core/planning.js";
import type { ToolInvocation } from "@/mcp/core/definitions.js";
import { createOpenAICompatibleChatUrl } from "@/services/openai-compatible-provider.js";
import { getProviderDefinition } from "@/providers/catalog.js";

export const COMPUTER_USE_TOOL_IDS = ["browser_observe", "browser_act", "browser_assert"] as const;
type ToolId = (typeof COMPUTER_USE_TOOL_IDS)[number];

export type ComputerUseModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: ToolId; arguments: string } }>;
};

export type ComputerUseModelResponse = {
  message: ComputerUseModelMessage;
  finishReason?: string;
};

export type ComputerUseModelProvider = {
  isAvailable?: () => Promise<boolean> | boolean;
  complete(input: { messages: ComputerUseModelMessage[]; signal?: AbortSignal }): Promise<ComputerUseModelResponse>;
};

export const COMPUTER_USE_MODEL_TIMEOUT_MS = 30_000;

export class ComputerUseModelTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Computer Use model provider timed out after ${timeoutMs}ms.`);
    this.name = "ComputerUseModelTimeoutError";
  }
}

type PendingRun = { sessionId: string; messages: ComputerUseModelMessage[]; pendingArgs: Record<string, unknown>; pendingToolId: ToolId; invocationId: string; pendingCallId: string };

const toolSchemas = COMPUTER_USE_TOOL_IDS.map((name) => {
  const common = { type: "object", additionalProperties: false };
  const parameters = name === "browser_observe"
    ? { ...common, required: ["url"], properties: { url: { type: "string" }, includeScreenshot: { type: "boolean" } } }
    : name === "browser_act"
      ? { type: "object", required: ["pageUrl", "snapshotHash", "action"], properties: { pageUrl: { type: "string" }, snapshotHash: { type: "string" }, action: { type: "object", required: ["kind"], properties: { kind: { type: "string", enum: ["navigate", "click", "type", "select", "press", "scroll", "wait"] }, url: { type: "string" }, ref: { type: "string" }, text: { type: "string" }, value: { type: "string" }, key: { type: "string" }, x: { type: "number" }, y: { type: "number" }, timeoutMs: { type: "integer" } }, additionalProperties: false } }, additionalProperties: false }
      : { type: "object", required: ["assertion"], properties: { assertion: { type: "object", required: ["kind"], properties: { kind: { type: "string", enum: ["title", "url", "text", "visible", "value"] }, expected: { type: "string" }, ref: { type: "string" } }, additionalProperties: false } }, additionalProperties: false };
  const description = name === "browser_observe"
    ? "Observe the managed browser. Provide the target url on the first call; sessionId is managed internally and must never be requested from the user. The result includes page.url, page.title, page.snapshotHash, observation.snapshot, and observation.visibleText."
    : name === "browser_act"
      ? "Perform one approved structured browser action using pageUrl and snapshotHash from the latest browser_observe result. Supported actions: navigate(url), click(ref), type(ref,text), select(ref,value), press(ref,key), scroll(x,y), wait(ref?,text?,timeoutMs?). Use exact current refs; sessionId is managed internally."
      : "Assert the managed browser using one of title(expected), url(expected), text(expected), visible(ref), or value(ref,expected). Use the latest observation. The result includes assertion.passed and current page state; do not treat a failed assertion as success.";
  return { type: "function", function: { name, description, parameters } };
});

const realProvider = (): ComputerUseModelProvider => ({
  async isAvailable() {
    try { resolveAgentTaskProvider("default"); return true; } catch { return false; }
  },
  async complete({ messages, signal }) {
    const resolved = resolveAgentTaskProvider("default");
    const protocol = getProviderDefinition(resolved.providerCode).chatAdapter;
    const endpoint = protocol === "ollama" ? `${resolved.baseUrl.replace(/\/+$/, "")}/api/chat` : createOpenAICompatibleChatUrl(resolved.baseUrl);
    const body = protocol === "ollama"
      ? { model: resolved.model, messages: messages.map(({ role, content }) => ({ role, content })), tools: toolSchemas, stream: false }
      : { model: resolved.model, messages, tools: toolSchemas, tool_choice: "auto", stream: false };
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...(resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : {}) }, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error(`Computer Use model request failed: ${response.status}`);
    const payload = await response.json() as { message?: ComputerUseModelMessage; choices?: Array<{ message?: ComputerUseModelMessage; finish_reason?: string }> };
    const message = resolved.providerCode === "ollama" ? payload.message : payload.choices?.[0]?.message;
    if (!message) throw new Error("Computer Use model returned no message");
    return { message, finishReason: payload.choices?.[0]?.finish_reason };
  },
});

const parseArgs = (raw: string) => {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Model tool arguments must be an object");
  return parsed as Record<string, unknown>;
};

const targetFromScope = (siteScope: string[]) => {
  const target = siteScope[0]?.trim();
  if (!target) return null;
  const url = target.includes("://") ? target : `https://${target}`;
  const parsed = new URL(url);
  return { url, domain: parsed.hostname };
};

export class ComputerUseModelExecutor implements ComputerUseExecutor {
  private readonly pending = new Map<string, PendingRun>();
  constructor(private readonly input: { browserSessionManager: { create(config: any): Promise<{ id: string; status: string; error?: { message: string } }> }; modelProvider?: ComputerUseModelProvider; approvedInvocations?: (task: ComputerUseTask) => Array<{ toolId: string; inputHash: string }>; modelTimeoutMs?: number }) {}

  async createPlan(input: { goal: string; siteScope: string[]; runtime: ComputerUseRuntimeState }): Promise<ComputerUsePlan> {
    return createComputerUsePlan({ createdAt: new Date().toISOString(), summary: `Use the managed browser to complete: ${input.goal}`, riskSummary: "Browser actions are model-selected; browser_act requires exact invocation approval.", steps: [{ id: "model-loop", title: "Run Computer Use model", description: "Observe the page, select structured browser tools, and return evidence.", status: "pending", requiresApproval: true }] });
  }

  async runTask(input: { task: ComputerUseTask; runtime: ComputerUseRuntimeState }): Promise<ComputerUseExecutionCheckpoint> {
    return this.run(input.task, undefined);
  }

  async resumeTask(input: { task: ComputerUseTask; approval: ComputerUseApprovalRequest; runtime: ComputerUseRuntimeState }): Promise<ComputerUseExecutionCheckpoint> {
    return this.run(input.task, input.approval);
  }

  async cancelTask({ task }: { task: ComputerUseTask }) { this.pending.delete(task.id); }

  private async run(task: ComputerUseTask, approval?: ComputerUseApprovalRequest): Promise<ComputerUseExecutionCheckpoint> {
    const provider = this.input.modelProvider ?? realProvider();
    if (provider.isAvailable && !(await provider.isAvailable())) return { status: "blocked", currentStepId: "model-loop", result: { status: "blocked", summary: "Computer Use model is unavailable because no real provider is configured.", completedAt: new Date().toISOString(), error: { code: "COMPUTER_USE_MODEL_UNAVAILABLE", message: "Configure an agentTask or task provider before starting a Computer Use run." } } };
    const target = targetFromScope(task.siteScope);
    if (!target) return { status: "blocked", currentStepId: "model-loop", result: { status: "blocked", summary: "Computer Use requires a URL or site scope.", completedAt: new Date().toISOString(), error: { code: "COMPUTER_USE_TARGET_REQUIRED", message: "Provide an HTTP or HTTPS siteScope entry." } } };
    const runEvidence: NonNullable<ComputerUseExecutionCheckpoint["evidenceEntries"]> = [];
    let pending = this.pending.get(task.id);
    if (!pending) {
      const session = await this.input.browserSessionManager.create({ allowedDomains: [target.domain], initialUrl: target.url, headless: true });
      if (session.status !== "ready") return { status: "blocked", currentStepId: "model-loop", result: { status: "blocked", summary: "Browser session could not be created.", completedAt: new Date().toISOString(), error: { code: "COMPUTER_USE_SESSION_UNAVAILABLE", message: session.error?.message ?? "Browser session is unavailable." } } };
      pending = { sessionId: session.id, messages: [{ role: "system", content: "You are a Computer Use agent. Use only structured browser tools. Stop with a concise answer when the goal is complete." }, { role: "user", content: task.goal }], pendingArgs: {}, pendingToolId: "browser_observe", invocationId: "", pendingCallId: "" };
      this.pending.set(task.id, pending);
      const initialObservation = await executeInvocation({
        toolId: "browser_observe",
        args: { sessionId: pending.sessionId },
        threadId: task.id,
        turnId: "computer-use-observe",
      });
      runEvidence.push({ id: crypto.randomUUID(), kind: "observation", message: "Initial browser observation returned.", createdAt: new Date().toISOString(), meta: { invocationId: initialObservation.id, toolId: initialObservation.toolId, status: initialObservation.status, result: initialObservation.result } });
      pending.messages.push({
        role: "user",
        content: `Structured browser observation:\n${JSON.stringify(initialObservation.result ?? initialObservation.error ?? {})}`,
      });
    }
    const approved = this.input.approvedInvocations?.(task) ?? [];
    if (approval) {
      if (!pending.pendingCallId || !pending.pendingArgs || pending.pendingToolId !== "browser_act") {
        this.pending.delete(task.id);
        return { status: "failed", currentStepId: "model-loop", result: { status: "failed", summary: "The frozen Computer Use approval state is unavailable.", completedAt: new Date().toISOString(), error: { code: "COMPUTER_USE_APPROVAL_STATE_MISSING", message: "The original approved browser invocation could not be restored." } } };
      }
      const expectedHash = createInvocationInputHash(pending.pendingArgs);
      if (approval.meta?.inputHash !== expectedHash) {
        this.pending.delete(task.id);
        return { status: "failed", currentStepId: "model-loop", result: { status: "failed", summary: "The Computer Use approval does not match the frozen invocation.", completedAt: new Date().toISOString(), error: { code: "COMPUTER_USE_APPROVAL_MISMATCH", message: "The approved browser invocation changed before resume." } } };
      }
      const frozenRecord = await executeInvocation({ toolId: pending.pendingToolId, args: pending.pendingArgs, approvedInvocations: approved, threadId: task.id, turnId: "computer-use-approval-resume" });
      runEvidence.push({ id: crypto.randomUUID(), kind: "action", message: `${frozenRecord.toolId} frozen invocation ${frozenRecord.status}.`, createdAt: new Date().toISOString(), meta: { invocationId: frozenRecord.id, traceId: frozenRecord.traceId, toolId: frozenRecord.toolId, args: frozenRecord.args, status: frozenRecord.status, result: frozenRecord.result, error: frozenRecord.error, resumedFromApprovalId: approval.id } });
      const frozenToolMessage = [...pending.messages].reverse().find((message: ComputerUseModelMessage) => message.role === "tool" && message.tool_call_id === pending?.pendingCallId);
      if (frozenToolMessage) frozenToolMessage.content = JSON.stringify(frozenRecord.result ?? frozenRecord.error ?? {});
      if (frozenRecord.status !== "completed") {
        this.pending.delete(task.id);
        return { status: frozenRecord.status === "cancelled" ? "cancelled" : "failed", currentStepId: "model-loop", evidenceEntries: runEvidence, result: { status: frozenRecord.status === "cancelled" ? "cancelled" : "failed", summary: frozenRecord.error?.message ?? "The approved Computer Use action failed.", completedAt: new Date().toISOString(), error: { code: frozenRecord.error?.failureCode ?? "COMPUTER_USE_APPROVED_TOOL_FAILED", message: frozenRecord.error?.message ?? "Approved browser action failed." } } };
      }
      pending.pendingArgs = {};
      pending.invocationId = "";
    }
    for (let round = 0; round < 12; round += 1) {
      let response: ComputerUseModelResponse;
      try {
        response = await this.completeWithTimeout(provider, pending.messages);
      } catch (error) {
        this.pending.delete(task.id);
        const timedOut = error instanceof ComputerUseModelTimeoutError;
        return { status: "failed", currentStepId: "model-loop", result: { status: "failed", summary: timedOut ? "Computer Use model timed out." : "Computer Use model request failed.", completedAt: new Date().toISOString(), error: { code: timedOut ? "COMPUTER_USE_MODEL_TIMEOUT" : "COMPUTER_USE_MODEL_FAILED", message: error instanceof Error ? error.message : String(error) } } };
      }
      pending.messages.push(response.message);
      const call = response.message.tool_calls?.[0];
      if (!call) { this.pending.delete(task.id); return { status: "succeeded", currentStepId: "model-loop", evidenceEntries: [...runEvidence, { id: crypto.randomUUID(), kind: "observation", message: response.message.content || "Model completed the browser task.", createdAt: new Date().toISOString(), meta: { model: true } }], result: { status: "succeeded", summary: response.message.content || "Computer Use model completed the task.", completedAt: new Date().toISOString(), meta: { invocationCount: runEvidence.length } } }; }
      const args = parseArgs(call.function.arguments);
      if (args.sessionId === undefined) args.sessionId = pending.sessionId;
      const record: ToolInvocation = await executeInvocation({ toolId: call.function.name, args, approvedInvocations: approved, threadId: task.id, turnId: `computer-use-${round}` });
      runEvidence.push({ id: crypto.randomUUID(), kind: call.function.name === "browser_act" ? "action" : "observation", message: `${call.function.name} invocation ${record.status}.`, createdAt: new Date().toISOString(), meta: { invocationId: record.id, traceId: record.traceId, toolId: record.toolId, args: record.args, status: record.status, result: record.result, error: record.error } });
      pending.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(record.result ?? record.error ?? record.approval ?? {}) });
      if (record.status === "awaiting_approval") {
        pending.pendingArgs = args; pending.pendingToolId = call.function.name; pending.invocationId = record.id; pending.pendingCallId = call.id;
        return { status: "awaiting_approval", currentStepId: "model-loop", evidenceEntries: [...runEvidence, { id: crypto.randomUUID(), kind: "approval", message: record.approval?.reason ?? "Browser action requires approval.", createdAt: new Date().toISOString(), meta: { invocationId: record.id, toolId: call.function.name, inputHash: createInvocationInputHash(args), args } }], approvalRequest: { id: crypto.randomUUID(), stepId: "model-loop", status: "pending", title: "Approve Computer Use browser action", reason: record.approval?.reason ?? "The model selected a browser action.", requestedAt: new Date().toISOString(), meta: { invocationId: record.id, toolId: call.function.name, inputHash: createInvocationInputHash(args), args } } };
      }
      if (record.status !== "completed") { this.pending.delete(task.id); return { status: record.status === "cancelled" ? "cancelled" : "failed", currentStepId: "model-loop", evidenceEntries: runEvidence, result: { status: record.status === "cancelled" ? "cancelled" : "failed", summary: record.error?.message ?? "Computer Use tool invocation failed.", completedAt: new Date().toISOString(), error: { code: record.error?.failureCode ?? "COMPUTER_USE_TOOL_FAILED", message: record.error?.message ?? "Tool invocation failed." } } }; }
    }
    this.pending.delete(task.id);
    return { status: "failed", currentStepId: "model-loop", result: { status: "failed", summary: "Computer Use model exceeded the tool-loop limit.", completedAt: new Date().toISOString(), error: { code: "COMPUTER_USE_MODEL_LOOP_LIMIT", message: "The model exceeded 12 structured tool rounds." } } };
  }

  private async completeWithTimeout(provider: ComputerUseModelProvider, messages: ComputerUseModelMessage[]) {
    const timeoutMs = this.input.modelTimeoutMs ?? COMPUTER_USE_MODEL_TIMEOUT_MS;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = provider.complete({ messages, signal: controller.signal });
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ComputerUseModelTimeoutError(timeoutMs));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
