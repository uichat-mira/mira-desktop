import crypto from "node:crypto";
import {
  Agent,
  type AgentMessage,
  type AgentOptions,
  type AgentTool,
  type AgentToolResult,
} from "@earendil-works/pi-agent-core";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import { createProviderVisibleInputSchema } from "@/mcp/core/provider-visible-schema.js";
import { getProviderDefinition } from "@/providers/catalog.js";
import { resolveAgentTaskProvider } from "@/services/provider-proxy.service/resolution.js";
import type {
  SkillAgentCheckpoint,
  SkillAgentExecutionInput,
  SkillAgentExecutionResult,
  SkillAgentRequirement,
  SkillAgentToolBinding,
  SkillAgentTrace,
  SubAgentRuntimeEvent,
  SubAgentTraceEvent,
  SubAgentTraceEventType,
  SubAgentWorkingPhase,
  SubAgentWorkingState,
} from "./types.js";
import { renderSkillAgentToolResult } from "./tool-adapters.js";

const asPositiveNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asNonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

type PiModel = NonNullable<NonNullable<AgentOptions["initialState"]>["model"]>;
type BindingExecution = Awaited<ReturnType<SkillAgentToolBinding["execute"]>>;

const isArkPlanProvider = (providerTemplateCode: string) =>
  providerTemplateCode === "volcengine-code-plan" ||
  providerTemplateCode === "volcengine-agent-plan";

const resolvePiModel = (): {
  model: PiModel;
  apiKey: string;
  projectComplexToolSchemas: boolean;
} => {
  const resolved = resolveAgentTaskProvider("default");
  const provider = getProviderDefinition(resolved.providerCode);
  const configuredBaseUrl = resolved.baseUrl.replace(/\/+$/, "");
  const baseUrl =
    provider.chatAdapter === "ollama" && !/\/v1$/i.test(configuredBaseUrl)
      ? `${configuredBaseUrl}/v1`
      : configuredBaseUrl;

  const contextWindow = asPositiveNumber(
    resolved.params.contextWindow ?? resolved.params.context_window,
    128_000,
  );
  const maxTokens = asPositiveNumber(
    resolved.params.maxTokens ?? resolved.params.max_tokens,
    8_192,
  );

  const projectComplexToolSchemas = isArkPlanProvider(resolved.providerTemplateCode);
  const model = {
    id: resolved.model,
    name: resolved.model,
    api: "openai-completions",
    provider: resolved.providerCode,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow,
    maxTokens,
    ...(projectComplexToolSchemas
      ? {
          // Ark Plan rejects the JSON Schema composition used by governed
          // domain tools. Runtime validation remains on the Harness binding.
          compat: {
            supportsStore: false,
            supportsUsageInStreaming: false,
            maxTokensField: "max_tokens",
            supportsStrictMode: false,
          },
        }
      : {}),
  } as PiModel;

  return { model, apiKey: resolved.apiKey, projectComplexToolSchemas };
};

const extractAssistantText = (messages: unknown[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as {
      role?: string;
      content?: unknown;
    };
    if (message?.role !== "assistant") continue;
    if (typeof message.content === "string") return message.content.trim();
    if (!Array.isArray(message.content)) continue;
    const text = message.content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const block = item as { type?: string; text?: string };
        return block.type === "text" && typeof block.text === "string" ? block.text : "";
      })
      .join("")
      .trim();
    if (text) return text;
  }
  return "";
};

const parseCompletionEnvelope = (raw: string) => {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const status = parsed.status;
      if (
        status === "completed" ||
        status === "insufficient_evidence" ||
        status === "needs_input" ||
        status === "failed"
      ) {
        return parsed;
      }
    } catch {
      // Final output is a protocol boundary: malformed JSON is not repaired by guessing.
    }
  }
  return null;
};

const normalizeCompletionRequirements = (
  value: unknown,
): SkillAgentRequirement[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;

  const allowedKinds = new Set<SkillAgentRequirement["kind"]>([
    "user_input",
    "evidence",
    "resource",
    "capability",
  ]);

  const requirements: SkillAgentRequirement[] = [];
  for (const [index, item] of value.entries()) {
    const record = asRecord(item);
    const description =
      typeof record?.description === "string" ? record.description.trim() : "";
    const requiredFor =
      typeof record?.requiredFor === "string" ? record.requiredFor.trim() : "";
    if (!record || !description || !requiredFor) return null;

    const requestedKind = record.kind;
    if (
      typeof requestedKind !== "string" ||
      !allowedKinds.has(requestedKind as SkillAgentRequirement["kind"])
    ) {
      return null;
    }

    const kind = requestedKind as Exclude<SkillAgentRequirement["kind"], "approval">;
    requirements.push({
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim()
          : `completion:${kind}:${index}`,
      kind,
      description,
      requiredFor,
    });
  }
  return requirements;
};

export const projectProviderVisibleToolSchema = (input: {
  schema: Record<string, unknown>;
  projectComplexToolSchemas: boolean;
}): Record<string, unknown> =>
  input.projectComplexToolSchemas
    ? createProviderVisibleInputSchema(input.schema)
    : input.schema;

const buildSystemPrompt = (input: SkillAgentExecutionInput) => {
  const primary = input.skillContext.primary;
  if (!primary) throw new Error("subAgent requires one primary SkillContext");

  const disclosed = input.skillContext.disclosedResources
    .map((resource) => `<resource uri="${resource.uri}">\n${resource.content}\n</resource>`)
    .join("\n\n");
  const availableUris = input.skillContext.resources.map((resource) => resource.uri);

  return [
    "You are an isolated professional subAgent inside Mira, assigned to exactly one Skill.",
    "You own task-local planning, tool use, observation, evidence coverage and repair until you can return a terminal execution status.",
    "You cannot create or delegate to another agent.",
    "You are not Mira's final conversational spokesperson. Do not address the user conversationally and do not fabricate success.",
    "Only use the tools exposed to this subAgent. Never assume access to Main Agent tools that are not present.",
    "All file paths and artifacts must stay inside the bound workspace unless a provided tool explicitly returns another managed artifact reference.",
    "When deterministic runtime execution fails, treat the runtime result as authoritative. Never reinterpret failure as success.",
    "If evidence is insufficient, keep working while an allowed tool can materially close the gap. If the gap cannot be closed, return insufficient_evidence or needs_input.",
    "Approval requirements are emitted only by tools. Never invent an approval requirement in your final JSON.",
    "For needs_input, requirements must be objects with kind user_input|evidence|resource|capability, description, and requiredFor.",
    "Use subagent_report_state before substantial work, whenever your judgment or next action changes, before waiting, and before completion.",
    "subagent_report_state is a user-visible safe work summary: state your current judgment, current action and next action without revealing hidden chain-of-thought, private scratch work or secrets.",
    "At the end, output exactly one JSON object and no prose outside it:",
    '{"status":"completed|insufficient_evidence|needs_input|failed","summary":"...","missingEvidence":[],"requirements":[{"kind":"user_input","description":"...","requiredFor":"..."}],"recoverable":true}',
    "",
    `<skill id="${primary.id}" version="${primary.version}" name="${primary.name}">`,
    primary.body,
    "</skill>",
    "",
    `<available-skill-resources>${JSON.stringify(availableUris)}</available-skill-resources>`,
    disclosed ? `<preloaded-resources>\n${disclosed}\n</preloaded-resources>` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const toAgentToolResult = (
  binding: SkillAgentToolBinding,
  executed: BindingExecution,
): AgentToolResult<Record<string, unknown>> => ({
  content: [
    {
      type: "text",
      text: renderSkillAgentToolResult(executed),
    },
  ],
  details: {
    toolId: binding.id,
    result: executed.result ?? null,
    evidence: executed.evidence ?? null,
    artifacts: executed.artifacts ?? [],
    requirement: executed.requirement ?? null,
  },
  ...(executed.terminate ? { terminate: true } : {}),
});

type Ledger = {
  runId: string;
  getNextSeq: () => number;
  getWorkingState: () => SubAgentWorkingState | undefined;
  getEvents: () => SubAgentTraceEvent[];
  emitTrace: (
    type: SubAgentTraceEventType,
    title: string,
    details?: Record<string, unknown>,
  ) => Promise<SubAgentTraceEvent>;
  updateWorkingState: (input: {
    phase: SubAgentWorkingPhase;
    currentJudgement?: string;
    currentAction: string;
    nextAction?: string;
    blockingReason?: string;
  }) => Promise<SubAgentWorkingState>;
};

const createLedger = (input: {
  execution: SkillAgentExecutionInput;
  skillId: string;
}): Ledger => {
  const checkpoint = input.execution.checkpoint;
  const runId = checkpoint?.subAgentRunId ?? crypto.randomUUID();
  let nextSeq = Math.max(1, checkpoint?.nextTraceSeq ?? 1);
  let workingState = checkpoint?.workingState
    ? structuredClone(checkpoint.workingState)
    : undefined;
  const events = checkpoint?.traceEvents
    ? structuredClone(checkpoint.traceEvents)
    : [];

  const publish = async (event: SubAgentRuntimeEvent) => {
    await input.execution.onRuntimeEvent?.(event);
  };

  const emitTrace: Ledger["emitTrace"] = async (type, title, details) => {
    const event: SubAgentTraceEvent = {
      runId,
      seq: nextSeq,
      eventId: crypto.randomUUID(),
      skillId: input.skillId,
      type,
      title,
      timestamp: Date.now(),
      ...(details ? { details: structuredClone(details) } : {}),
    };
    nextSeq += 1;
    events.push(event);
    await publish({ kind: "trace", event: structuredClone(event) });
    return event;
  };

  const updateWorkingState: Ledger["updateWorkingState"] = async (stateInput) => {
    workingState = {
      runId,
      skillId: input.skillId,
      phase: stateInput.phase,
      ...(stateInput.currentJudgement
        ? { currentJudgement: stateInput.currentJudgement }
        : {}),
      currentAction: stateInput.currentAction,
      ...(stateInput.nextAction ? { nextAction: stateInput.nextAction } : {}),
      ...(stateInput.blockingReason
        ? { blockingReason: stateInput.blockingReason }
        : {}),
      updatedAt: Date.now(),
    };
    await emitTrace("working_state.updated", stateInput.currentAction, {
      phase: stateInput.phase,
    });
    await publish({ kind: "working_state", state: structuredClone(workingState) });
    return workingState;
  };

  return {
    runId,
    getNextSeq: () => nextSeq,
    getWorkingState: () =>
      workingState ? structuredClone(workingState) : undefined,
    getEvents: () => structuredClone(events),
    emitTrace,
    updateWorkingState,
  };
};

const buildTrace = (input: {
  ledger: Ledger;
  skillId: string;
  toolCalls: string[];
}): SkillAgentTrace => ({
  engine: "pi-agent-core",
  skillId: input.skillId,
  toolCalls: [...input.toolCalls],
  runId: input.ledger.runId,
  nextSeq: input.ledger.getNextSeq(),
  workingState: input.ledger.getWorkingState(),
  events: input.ledger.getEvents(),
});

const combineAbortSignals = (
  primary?: AbortSignal,
  secondary?: AbortSignal,
): { signal?: AbortSignal; cleanup: () => void } => {
  const signals = [primary, secondary].filter(
    (signal): signal is AbortSignal => Boolean(signal),
  );
  if (signals.length === 0) return { signal: undefined, cleanup: () => undefined };
  if (signals.length === 1) return { signal: signals[0], cleanup: () => undefined };

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const signal of signals) signal.removeEventListener("abort", abort);
    },
  };
};

const executeBinding = async (input: {
  binding: SkillAgentToolBinding;
  toolCallId: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  evidence: unknown[];
  artifacts: unknown[];
  requirements: SkillAgentRequirement[];
  toolCalls: string[];
  recordToolCall: boolean;
  ledger: Ledger;
  resumedFromApproval?: boolean;
}) => {
  if (input.recordToolCall) input.toolCalls.push(input.binding.id);
  await input.ledger.emitTrace("tool.started", `正在执行 ${input.binding.label}`, {
    toolId: input.binding.id,
    toolCallId: input.toolCallId,
    resumedFromApproval: Boolean(input.resumedFromApproval),
  });

  try {
    const raw = await input.binding.execute(input.args, input.signal);
    const requirement = raw.requirement
      ? { ...raw.requirement, toolCallId: input.toolCallId }
      : undefined;
    const executed: BindingExecution = requirement
      ? { ...raw, requirement }
      : raw;

    if (executed.evidence !== undefined) input.evidence.push(executed.evidence);
    if (executed.artifacts?.length) input.artifacts.push(...executed.artifacts);
    if (executed.requirement) input.requirements.push(executed.requirement);

    if (executed.requirement?.kind === "approval") {
      await input.ledger.updateWorkingState({
        phase: "waiting_approval",
        currentJudgement: `当前动作需要对 ${input.binding.id} 的精确调用进行审批。`,
        currentAction: `等待批准 ${input.binding.label}`,
        nextAction: "审批通过后从当前检查点继续执行",
        blockingReason: executed.requirement.description,
      });
      await input.ledger.emitTrace(
        "approval.required",
        `${input.binding.label} 等待审批`,
        {
          toolId: input.binding.id,
          toolCallId: input.toolCallId,
          inputHash: executed.requirement.inputHash ?? null,
        },
      );
    } else {
      await input.ledger.emitTrace("tool.completed", `${input.binding.label} 已完成`, {
        toolId: input.binding.id,
        toolCallId: input.toolCallId,
        artifactCount: executed.artifacts?.length ?? 0,
        evidenceAdded: executed.evidence !== undefined,
      });
    }

    return {
      executed,
      toolResult: toAgentToolResult(input.binding, executed),
    };
  } catch (error) {
    await input.ledger.emitTrace("tool.failed", `${input.binding.label} 执行失败`, {
      toolId: input.binding.id,
      toolCallId: input.toolCallId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

const toPiTool = (input: {
  binding: SkillAgentToolBinding;
  evidence: unknown[];
  artifacts: unknown[];
  requirements: SkillAgentRequirement[];
  toolCalls: string[];
  ledger: Ledger;
  projectComplexToolSchemas: boolean;
  parentSignal?: AbortSignal;
}): AgentTool<any> => ({
  name: input.binding.id,
  label: input.binding.label,
  description: input.binding.description,
  parameters: projectProviderVisibleToolSchema({
    schema: input.binding.inputSchema,
    projectComplexToolSchemas: input.projectComplexToolSchemas,
  }) as any,
  executionMode: "sequential",
  execute: async (toolCallId, params, signal) => {
    const combined = combineAbortSignals(input.parentSignal, signal);
    try {
      const { toolResult } = await executeBinding({
        binding: input.binding,
        toolCallId,
        args: (params ?? {}) as Record<string, unknown>,
        signal: combined.signal,
        evidence: input.evidence,
        artifacts: input.artifacts,
        requirements: input.requirements,
        toolCalls: input.toolCalls,
        recordToolCall: true,
        ledger: input.ledger,
      });
      return toolResult;
    } finally {
      combined.cleanup();
    }
  },
});

const createStateReportingTool = (input: {
  ledger: Ledger;
}): AgentTool<any> => ({
  name: "subagent_report_state",
  label: "Report subAgent Working State",
  description:
    "Publish a concise user-visible work summary. Do not include hidden chain-of-thought, private scratch work, secrets or raw prompts.",
  parameters: {
    type: "object",
    required: ["currentAction"],
    additionalProperties: false,
    properties: {
      phase: {
        type: "string",
        enum: ["planning", "working", "waiting_input", "blocked", "completed", "failed"],
      },
      currentJudgement: { type: "string" },
      currentAction: { type: "string" },
      nextAction: { type: "string" },
      blockingReason: { type: "string" },
    },
  } as any,
  executionMode: "sequential",
  execute: async (_toolCallId, params) => {
    const record = asRecord(params) ?? {};
    const requestedPhase = asNonEmptyString(record.phase) as
      | SubAgentWorkingPhase
      | undefined;
    const currentAction =
      asNonEmptyString(record.currentAction) ?? "正在按 Skill 说明书继续处理任务";
    const state = await input.ledger.updateWorkingState({
      phase: requestedPhase ?? "working",
      currentJudgement: asNonEmptyString(record.currentJudgement),
      currentAction,
      nextAction: asNonEmptyString(record.nextAction),
      blockingReason: asNonEmptyString(record.blockingReason),
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ status: "recorded", phase: state.phase }),
        },
      ],
      details: { workingState: state },
    };
  },
});

const findApprovalRequirement = (requirements: SkillAgentRequirement[]) =>
  requirements.find(
    (requirement) =>
      requirement.kind === "approval" &&
      Boolean(requirement.toolId) &&
      Boolean(requirement.toolCallId) &&
      Boolean(requirement.inputHash) &&
      Boolean(requirement.input),
  );

const createApprovalCheckpoint = (input: {
  execution: SkillAgentExecutionInput;
  ledger: Ledger;
  messages: AgentMessage[];
  requirement: SkillAgentRequirement;
  evidence: unknown[];
  artifacts: unknown[];
  toolCalls: string[];
}): SkillAgentCheckpoint | undefined => {
  if (
    input.requirement.kind !== "approval" ||
    !input.requirement.toolId ||
    !input.requirement.toolCallId ||
    !input.requirement.inputHash ||
    !input.requirement.input
  ) {
    return undefined;
  }

  return {
    version: 1,
    messages: structuredClone(input.messages),
    pendingInvocation: {
      toolCallId: input.requirement.toolCallId,
      toolId: input.requirement.toolId,
      input: structuredClone(input.requirement.input),
      inputHash: input.requirement.inputHash,
    },
    evidence: structuredClone(input.evidence),
    artifacts: structuredClone(input.artifacts),
    toolCalls: [...input.toolCalls],
    subAgentRunId: input.ledger.runId,
    nextTraceSeq: input.ledger.getNextSeq(),
    workingState: input.ledger.getWorkingState(),
    traceEvents: input.ledger.getEvents(),
    skillId: input.execution.skillContext.primary?.id,
    skillVersion: input.execution.skillContext.primary?.version,
    skillContextSnapshot: structuredClone(input.execution.skillContext),
  };
};

const hasExactApprovedInvocation = (
  execution: SkillAgentExecutionInput,
  toolId: string,
  inputHash: string,
) =>
  Boolean(
    execution.approvedInvocations?.some(
      (approval) => approval.toolId === toolId && approval.inputHash === inputHash,
    ),
  );

const replaceApprovalPlaceholder = (input: {
  messages: AgentMessage[];
  toolCallId: string;
  toolId: string;
  result: AgentToolResult<Record<string, unknown>>;
}): AgentMessage[] => {
  const messages = structuredClone(input.messages);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role !== "toolResult" ||
      message.toolCallId !== input.toolCallId ||
      message.toolName !== input.toolId
    ) {
      continue;
    }

    messages[index] = {
      role: "toolResult",
      toolCallId: input.toolCallId,
      toolName: input.toolId,
      content: structuredClone(input.result.content),
      details: structuredClone(input.result.details),
      isError: false,
      timestamp: Date.now(),
    };
    return messages;
  }

  throw new Error(
    `subAgent checkpoint is missing the approval placeholder for ${input.toolId}:${input.toolCallId}`,
  );
};

const failResult = (input: {
  skillId: string;
  error: unknown;
  recoverable: boolean;
  evidence: unknown[];
  artifacts: unknown[];
  toolCalls: string[];
  ledger?: Ledger;
}): SkillAgentExecutionResult => ({
  status: "failed",
  recoverable: input.recoverable,
  error: input.error instanceof Error ? input.error.message : String(input.error),
  evidence: input.evidence,
  artifacts: input.artifacts,
  trace: input.ledger
    ? buildTrace({
        ledger: input.ledger,
        skillId: input.skillId,
        toolCalls: input.toolCalls,
      })
    : {
        engine: "pi-agent-core",
        skillId: input.skillId,
        toolCalls: input.toolCalls,
      },
});

export const runPiSkillAgent = async (input: {
  execution: SkillAgentExecutionInput;
  tools: SkillAgentToolBinding[];
}): Promise<SkillAgentExecutionResult> => {
  const primary = input.execution.skillContext.primary;
  if (!primary) {
    return {
      status: "failed",
      recoverable: false,
      error: "subAgent cannot start without a primary SkillContext",
      evidence: [],
      artifacts: [],
    };
  }

  const checkpoint = input.execution.checkpoint;
  const evidence: unknown[] = checkpoint
    ? structuredClone(checkpoint.evidence)
    : [];
  const artifacts: unknown[] = checkpoint
    ? structuredClone(checkpoint.artifacts)
    : [];
  const requirements: SkillAgentRequirement[] = [];
  const toolCalls: string[] = checkpoint ? [...checkpoint.toolCalls] : [];
  const ledger = createLedger({ execution: input.execution, skillId: primary.id });
  const { model, apiKey, projectComplexToolSchemas } = resolvePiModel();
  const tools: AgentTool<any>[] = [createStateReportingTool({ ledger })];
  tools.push(
    ...input.tools.map((binding) =>
      toPiTool({
        binding,
        evidence,
        artifacts,
        requirements,
        toolCalls,
        ledger,
        projectComplexToolSchemas,
        parentSignal: input.execution.signal,
      }),
    ),
  );

  let restoredMessages: AgentMessage[] | undefined;
  if (checkpoint) {
    const pending = checkpoint.pendingInvocation;
    if (checkpoint.version !== 1) {
      await ledger.updateWorkingState({
        phase: "failed",
        currentAction: "无法恢复 subAgent",
        blockingReason: `Unsupported checkpoint version: ${String(checkpoint.version)}`,
      });
      await ledger.emitTrace("subagent.failed", "subAgent 恢复失败");
      return failResult({
        skillId: primary.id,
        error: `Unsupported subAgent checkpoint version: ${String(checkpoint.version)}`,
        recoverable: false,
        evidence,
        artifacts,
        toolCalls,
        ledger,
      });
    }
    if (checkpoint.skillId && checkpoint.skillId !== primary.id) {
      return failResult({
        skillId: primary.id,
        error: `subAgent checkpoint belongs to Skill ${checkpoint.skillId}, not ${primary.id}.`,
        recoverable: false,
        evidence,
        artifacts,
        toolCalls,
        ledger,
      });
    }
    if (checkpoint.skillVersion && checkpoint.skillVersion !== primary.version) {
      return failResult({
        skillId: primary.id,
        error: `subAgent checkpoint is bound to Skill ${primary.id}@${checkpoint.skillVersion}, not ${primary.version}.`,
        recoverable: false,
        evidence,
        artifacts,
        toolCalls,
        ledger,
      });
    }
    if (createInvocationInputHash(pending.input) !== pending.inputHash) {
      return failResult({
        skillId: primary.id,
        error: "subAgent checkpoint inputHash does not match its frozen invocation input.",
        recoverable: false,
        evidence,
        artifacts,
        toolCalls,
        ledger,
      });
    }
    if (!hasExactApprovedInvocation(input.execution, pending.toolId, pending.inputHash)) {
      return failResult({
        skillId: primary.id,
        error: "subAgent checkpoint resume is missing approval for the exact frozen invocation.",
        recoverable: false,
        evidence,
        artifacts,
        toolCalls,
        ledger,
      });
    }

    const binding = input.tools.find((candidate) => candidate.id === pending.toolId);
    if (!binding) {
      return failResult({
        skillId: primary.id,
        error: `subAgent checkpoint runtime is unavailable: ${pending.toolId}`,
        recoverable: false,
        evidence,
        artifacts,
        toolCalls,
        ledger,
      });
    }

    await ledger.emitTrace("subagent.resumed", "审批已通过，继续执行");
    await ledger.updateWorkingState({
      phase: "working",
      currentJudgement: "精确审批与冻结调用一致，可以从原检查点继续。",
      currentAction: `继续执行 ${binding.label}`,
      nextAction: "读取执行结果并按 Skill 计划继续",
    });

    try {
      const resumed = await executeBinding({
        binding,
        toolCallId: pending.toolCallId,
        args: structuredClone(pending.input),
        evidence,
        artifacts,
        requirements,
        toolCalls,
        recordToolCall: false,
        ledger,
        resumedFromApproval: true,
        signal: input.execution.signal,
      });
      if (resumed.executed.requirement || resumed.executed.terminate) {
        return failResult({
          skillId: primary.id,
          error:
            "Approved subAgent invocation did not consume its exact approval; resume was blocked to prevent an approval loop.",
          recoverable: false,
          evidence,
          artifacts,
          toolCalls,
          ledger,
        });
      }
      restoredMessages = replaceApprovalPlaceholder({
        messages: checkpoint.messages,
        toolCallId: pending.toolCallId,
        toolId: pending.toolId,
        result: resumed.toolResult,
      });
    } catch (error) {
      await ledger.updateWorkingState({
        phase: "failed",
        currentAction: `恢复执行 ${binding.label} 失败`,
        blockingReason: error instanceof Error ? error.message : String(error),
      });
      await ledger.emitTrace("subagent.failed", "subAgent 恢复执行失败");
      return failResult({
        skillId: primary.id,
        error,
        recoverable: true,
        evidence,
        artifacts,
        toolCalls,
        ledger,
      });
    }
  } else {
    await ledger.emitTrace("subagent.started", `${primary.name} subAgent 已启动`, {
      skillId: primary.id,
      skillVersion: primary.version,
    });
    await ledger.updateWorkingState({
      phase: "planning",
      currentJudgement: "已读取当前 Skill 说明书，正在把用户目标转换为本次执行顺序。",
      currentAction: "梳理任务目标与可用能力",
      nextAction: "按说明书选择所需资源或工具",
    });
  }

  if (input.execution.signal?.aborted) {
    return failResult({
      skillId: primary.id,
      error: new Error("Parent AgentRun was cancelled before subAgent execution."),
      recoverable: true,
      evidence,
      artifacts,
      toolCalls,
      ledger,
    });
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(input.execution),
      model,
      tools,
      ...(restoredMessages ? { messages: restoredMessages } : {}),
    },
    getApiKey: () => apiKey || undefined,
    toolExecution: "sequential",
    sessionId: `mira-subagent:${primary.id}:${ledger.runId}`,
  });

  try {
    if (restoredMessages) {
      await agent.continue();
    } else {
      await agent.prompt(
        [
          `<goal>${input.execution.goal}</goal>`,
          input.execution.workspaceRoot
            ? `<workspace>${input.execution.workspaceRoot}</workspace>`
            : "<workspace>not-required</workspace>",
          "Execute the goal using only the supplied Skill context and tools.",
        ].join("\n"),
      );
    }
  } catch (error) {
    await ledger.updateWorkingState({
      phase: "failed",
      currentAction: "subAgent 执行中断",
      blockingReason: error instanceof Error ? error.message : String(error),
    });
    await ledger.emitTrace("subagent.failed", "subAgent 执行失败");
    return failResult({
      skillId: primary.id,
      error,
      recoverable: true,
      evidence,
      artifacts,
      toolCalls,
      ledger,
    });
  }

  // Tool-produced requirements are authoritative governance boundaries. This is
  // the only path allowed to carry an approval requirement with exact invocation
  // metadata; model-authored completion JSON cannot mint approval authority.
  if (requirements.length > 0) {
    const approvalRequirement = findApprovalRequirement(requirements);
    const approvalCheckpoint = approvalRequirement
      ? createApprovalCheckpoint({
          execution: input.execution,
          ledger,
          messages: agent.state.messages,
          requirement: approvalRequirement,
          evidence,
          artifacts,
          toolCalls,
        })
      : undefined;

    if (approvalRequirement && !approvalCheckpoint) {
      return failResult({
        skillId: primary.id,
        error: "subAgent approval boundary did not produce a resumable exact checkpoint.",
        recoverable: false,
        evidence,
        artifacts,
        toolCalls,
        ledger,
      });
    }

    return {
      status: "needs_input",
      summary: "subAgent stopped at a governed requirement boundary.",
      requirements,
      ...(approvalCheckpoint ? { checkpoint: approvalCheckpoint } : {}),
      evidence,
      artifacts,
      trace: buildTrace({ ledger, skillId: primary.id, toolCalls }),
    };
  }

  const finalText = extractAssistantText(agent.state.messages as unknown[]);
  const completion = parseCompletionEnvelope(finalText);
  if (!completion) {
    await ledger.updateWorkingState({
      phase: "failed",
      currentAction: "无法确认 subAgent 的最终交付状态",
      blockingReason: "Invalid completion envelope",
    });
    await ledger.emitTrace("subagent.failed", "subAgent 返回格式无效");
    return {
      status: "failed",
      recoverable: true,
      error: "subAgent returned an invalid completion envelope",
      evidence,
      artifacts,
      trace: buildTrace({ ledger, skillId: primary.id, toolCalls }),
    };
  }

  const status = completion.status as SkillAgentExecutionResult["status"];
  const summary = asNonEmptyString(completion.summary);
  const completionRequirements =
    status === "needs_input"
      ? normalizeCompletionRequirements(completion.requirements)
      : [];

  if (status === "needs_input" && !completionRequirements) {
    await ledger.updateWorkingState({
      phase: "failed",
      currentAction: "拒绝无效的 subAgent 补充信息请求",
      blockingReason: "needs_input requires at least one valid requirement",
    });
    await ledger.emitTrace("subagent.failed", "subAgent needs_input 协议无效");
    return failResult({
      skillId: primary.id,
      error: "subAgent returned needs_input without valid requirements",
      recoverable: true,
      evidence,
      artifacts,
      toolCalls,
      ledger,
    });
  }
  const validatedCompletionRequirements = completionRequirements ?? [];

  if (status === "completed") {
    await ledger.updateWorkingState({
      phase: "completed",
      currentJudgement: summary ?? "Skill 的完成条件已经满足。",
      currentAction: "subAgent 已完成本次任务",
      nextAction: "把 Evidence 与 Artifact 交还给 Main Agent",
    });
    await ledger.emitTrace("subagent.completed", `${primary.name} subAgent 已完成`);
  } else if (status === "needs_input") {
    await ledger.updateWorkingState({
      phase: "waiting_input",
      currentJudgement: summary,
      currentAction: "等待补充继续执行所需的信息",
      nextAction: "收到缺失信息后继续原任务",
      blockingReason:
        validatedCompletionRequirements.map((item) => item.description).join("；") || undefined,
    });
    await ledger.emitTrace("input.required", "subAgent 等待用户补充信息");
  } else if (status === "insufficient_evidence") {
    await ledger.updateWorkingState({
      phase: "blocked",
      currentJudgement: summary,
      currentAction: "当前证据不足，不能宣称任务完成",
      nextAction: "补充证据或调整目标后继续",
      blockingReason: Array.isArray(completion.missingEvidence)
        ? completion.missingEvidence.map(String).join("；")
        : undefined,
    });
    await ledger.emitTrace("input.required", "subAgent 发现证据缺口");
  } else {
    await ledger.updateWorkingState({
      phase: "failed",
      currentJudgement: summary,
      currentAction: "subAgent 未能完成任务",
      blockingReason:
        typeof completion.error === "string"
          ? completion.error
          : "Skill agent reported failure",
    });
    await ledger.emitTrace("subagent.failed", `${primary.name} subAgent 执行失败`);
  }

  return {
    status,
    ...(summary ? { summary } : {}),
    evidence,
    artifacts,
    ...(status === "insufficient_evidence"
      ? {
          missingEvidence: Array.isArray(completion.missingEvidence)
            ? completion.missingEvidence
            : [],
        }
      : {}),
    ...(status === "needs_input"
      ? { requirements: validatedCompletionRequirements }
      : {}),
    ...(status === "failed"
      ? {
          recoverable: completion.recoverable !== false,
          error:
            typeof completion.error === "string"
              ? completion.error
              : "Skill agent reported failure",
        }
      : {}),
    trace: buildTrace({ ledger, skillId: primary.id, toolCalls }),
  };
};
