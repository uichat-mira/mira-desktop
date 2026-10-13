import crypto from "node:crypto";
import {
  Agent,
  type AgentMessage,
  type AgentOptions,
  type AgentTool,
  type AgentToolResult,
} from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import { streamSimple as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import { createProviderVisibleInputSchema } from "@/mcp/core/provider-visible-schema.js";
import { validateInvocationArgs } from "@/mcp/core/schema";
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

/**
 * Authoritative record of one governed Tool binding that actually returned
 * successfully during this Child run. It is execution state, distinct from
 * schema disclosure and from the model's own `completed` claim, and is the only
 * thing an evidence reference may point at. `targets` are the concrete
 * path/uri-like values the invocation touched, extracted deterministically so
 * a criterion that names a target can only be satisfied by the execution that
 * really operated on it.
 */
type GovernedExecutionRecord = {
  toolId: string;
  toolCallId: string;
  args: Record<string, unknown>;
  evidence?: unknown;
  artifacts: unknown[];
  targets: string[];
};

type CompletionProof = {
  criterion: string;
  evidenceRefs: string[];
};

type CompletionEvaluation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "completed_without_criterion_proof"
        | "completed_without_authoritative_execution";
      missing: string[];
      missingEvidence: string[];
      prompt: string;
    };

const TARGET_ARGUMENT_KEYS = new Set([
  "path",
  "filepath",
  "file_path",
  "inputpath",
  "outputpath",
  "input_path",
  "output_path",
  "uri",
  "target",
  "source",
  "destination",
]);

const collectTargetValues = (
  value: unknown,
  key: string | undefined,
  output: Set<string>,
) => {
  if (typeof value === "string") {
    if (key && TARGET_ARGUMENT_KEYS.has(key.toLowerCase())) {
      const trimmed = value.trim();
      if (trimmed && trimmed.length <= 512 && !trimmed.includes("\n")) {
        output.add(trimmed);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTargetValues(item, undefined, output);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [nestedKey, nested] of Object.entries(record)) {
    collectTargetValues(nested, nestedKey, output);
  }
};

const extractExecutionTargets = (input: {
  args: Record<string, unknown>;
  evidence?: unknown;
  artifacts: unknown[];
}): string[] => {
  const targets = new Set<string>();
  collectTargetValues(input.args, undefined, targets);
  collectTargetValues(input.evidence, undefined, targets);
  for (const artifact of input.artifacts) {
    collectTargetValues(artifact, undefined, targets);
  }
  return [...targets].filter((target) => target.length > 1).slice(0, 16);
};

const parseEvidenceRefIndex = (ref: string): number | null => {
  const match = /^tool:(\d+)$/.exec(ref.trim());
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

const parseCompletionProof = (value: unknown): CompletionProof[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const proofs: CompletionProof[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const criterion = asNonEmptyString(record?.criterion);
    if (!record || !criterion) return null;
    const rawRefs = record.evidenceRefs;
    if (!Array.isArray(rawRefs) || rawRefs.length === 0) return null;
    const evidenceRefs: string[] = [];
    for (const ref of rawRefs) {
      const normalized = asNonEmptyString(ref);
      if (!normalized) return null;
      evidenceRefs.push(normalized);
    }
    proofs.push({ criterion, evidenceRefs });
  }
  return proofs;
};

/**
 * Concretely named targets come from the criterion text itself, never from the
 * successful-execution ledger. Deriving them from recorded targets alone would
 * let a target that was never touched silently disappear from verification, so a
 * criterion that names `a.txt` and `b.txt` could be "proven" by a single read of
 * `a.txt`. Only file/path-like tokens are treated as concrete; a criterion with
 * no concrete target stays semantically judged by the model and receives no
 * mechanical target check.
 */
const CRITERION_TARGET_PATTERN = /[A-Za-z][A-Za-z0-9_@-]*(?:\.[A-Za-z0-9]{2,})+/g;

const extractCriterionTargets = (criterion: string): string[] => {
  const targets = new Set<string>();
  for (const match of criterion.matchAll(CRITERION_TARGET_PATTERN)) {
    targets.add(match[0].toLowerCase());
  }
  return [...targets];
};

/**
 * Operation verbs a criterion can request, grouped so read-like and write-like
 * intents stay distinguishable. A successful operation on the right target that
 * is a clearly different kind of operation must not be accepted as proof of the
 * requested one when the governed Tool contract exposes enough information.
 */
const OPERATION_GROUPS: Record<string, readonly string[]> = {
  read: [
    "read",
    "open",
    "cat",
    "view",
    "inspect",
    "load",
    "show",
    "display",
    "preview",
    "fetch",
  ],
  write: [
    "write",
    "create",
    "save",
    "update",
    "modify",
    "edit",
    "append",
    "insert",
    "produce",
    "generate",
    "export",
    "render",
  ],
  delete: ["delete", "remove", "unlink", "drop", "erase", "purge"],
  list: ["list", "ls", "enumerate", "scan", "browse", "glob", "search", "find"],
  move: ["move", "rename", "copy", "duplicate"],
};

const OPERATION_BY_ALIAS = new Map<string, string>(
  Object.entries(OPERATION_GROUPS).flatMap(([group, aliases]) =>
    aliases.map((alias) => [alias, group] as const),
  ),
);

const operationGroupsFromText = (text: string): Set<string> => {
  const groups = new Set<string>();
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const group = OPERATION_BY_ALIAS.get(token);
    if (group) groups.add(group);
  }
  return groups;
};

const extractCriterionOperation = (criterion: string): string | null => {
  const groups = operationGroupsFromText(criterion);
  return groups.size === 1 ? [...groups][0]! : null;
};

const OPERATION_ARGUMENT_KEYS = new Set([
  "operation",
  "action",
  "op",
  "command",
  "mode",
  "method",
  "verb",
]);

const collectOperationValues = (value: unknown, output: Set<string>) => {
  const record = asRecord(value);
  if (!record) return;
  for (const [key, nested] of Object.entries(record)) {
    if (
      typeof nested === "string" &&
      OPERATION_ARGUMENT_KEYS.has(key.toLowerCase())
    ) {
      const trimmed = nested.trim();
      if (trimmed) output.add(trimmed);
    } else if (Array.isArray(nested) || asRecord(nested)) {
      collectOperationValues(nested, output);
    }
  }
};

const executionOperationGroups = (
  record: GovernedExecutionRecord,
): Set<string> => {
  const groups = new Set<string>();
  for (const group of operationGroupsFromText(record.toolId)) groups.add(group);
  const values = new Set<string>();
  collectOperationValues(record.args, values);
  collectOperationValues(record.evidence, values);
  for (const value of values) {
    for (const group of operationGroupsFromText(value)) groups.add(group);
  }
  return groups;
};

const normalizeTarget = (target: string) =>
  target.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");

const targetsMatch = (expected: string, actual: string): boolean => {
  const a = normalizeTarget(expected);
  const b = normalizeTarget(actual);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
};

/**
 * Deterministic provenance guard for a `completed` claim. The model still judges
 * semantic sufficiency: it decides which real execution covers which criterion
 * and writes the criterion text. The runtime enforces reference provenance
 * (existing, successful governed executions recorded in this run), concrete
 * target coverage derived from the criterion, operation compatibility where the
 * Tool contract exposes it, and that no single execution is reused to prop up
 * several criteria. Every target named by a criterion must be covered, not just
 * one of them. Ref existence alone is never treated as proof of semantic
 * coverage; an unsupported criterion is reported as missing.
 */
const validateCompletionProof = (input: {
  criteria: readonly string[];
  proof: CompletionProof[] | null;
  ledger: GovernedExecutionRecord[];
}): { ok: true } | { ok: false; missing: string[] } => {
  const missing: string[] = [];
  if (!input.proof) return { ok: false, missing: [...input.criteria] };

  const proofByCriterion = new Map<string, CompletionProof>();
  for (const proof of input.proof) {
    if (!proofByCriterion.has(proof.criterion)) {
      proofByCriterion.set(proof.criterion, proof);
    }
  }

  const executionOwner = new Map<number, string>();
  for (const criterion of input.criteria) {
    const proof = proofByCriterion.get(criterion);
    if (!proof) {
      missing.push(criterion);
      continue;
    }

    const namedTargets = extractCriterionTargets(criterion);
    const requiredOperation = extractCriterionOperation(criterion);

    const candidateIndexes: number[] = [];
    for (const ref of proof.evidenceRefs) {
      const index = parseEvidenceRefIndex(ref);
      if (index === null || index >= input.ledger.length) continue;
      const owner = executionOwner.get(index);
      if (owner !== undefined && owner !== criterion) continue;
      const record = input.ledger[index]!;
      if (requiredOperation) {
        const operationGroups = executionOperationGroups(record);
        // Only reject when the Tool contract clearly exposes an operation and it
        // is a different one; unknown operation semantics stay model-judged.
        if (operationGroups.size > 0 && !operationGroups.has(requiredOperation)) {
          continue;
        }
      }
      candidateIndexes.push(index);
    }

    if (candidateIndexes.length === 0) {
      missing.push(criterion);
      continue;
    }

    const coveredTargets: string[] = [];
    for (const index of candidateIndexes) {
      coveredTargets.push(...input.ledger[index]!.targets);
    }
    const allTargetsCovered = namedTargets.every((target) =>
      coveredTargets.some((covered) => targetsMatch(target, covered)),
    );
    if (!allTargetsCovered) {
      missing.push(criterion);
      continue;
    }

    for (const index of candidateIndexes) executionOwner.set(index, criterion);
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
};

// Pi's OpenAI-completions transport does not infer OpenCode Go's required
// x-opencode-session header from Agent.sessionId. Supply a stable ID to *each*
// request in one Skill Child run without changing other provider transports.
// The stream-function cast only bridges Pi's generic API slot to the dedicated
// OpenAI-completions implementation; the runtime remains Pi's official SDK.
const openAiCompletionsStream =
  streamOpenAICompletions as unknown as NonNullable<AgentOptions["streamFn"]>;

export const createSkillAgentStreamFn = (
  sessionId: string,
): NonNullable<AgentOptions["streamFn"]> =>
  (model, context, options) => {
    // Only the official OpenCode Go origin receives these affinity headers.
    // Never copy Go routing headers to arbitrary OpenAI-compatible endpoints.
    const isOpenCodeGo =
      typeof model.baseUrl === "string" &&
      /^https:\/\/opencode\.ai\/zen\/go\/v1(?:\/|$)/i.test(model.baseUrl);

    return openAiCompletionsStream(model, context, isOpenCodeGo
      ? {
          ...options,
          headers: {
            ...options?.headers,
            "x-opencode-session": sessionId,
            "User-Agent": "mira-pi-skill-agent/1",
          },
        }
      : options);
  };

const isArkPlanProvider = (providerTemplateCode: string) =>
  providerTemplateCode === "volcengine-code-plan" ||
  providerTemplateCode === "volcengine-agent-plan";

const isOpenAiCompatibleProvider = (chatAdapter: string) =>
  chatAdapter === "openai-compatible";

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

  // Every OpenAI-compatible endpoint requires a function `parameters` schema
  // whose top level is `type: "object"`. Governed domain tools such as
  // read_discover declare a top-level `oneOf`, so the projection must run for
  // any OpenAI-compatible provider, not only Ark Plan. Sending the raw
  // composition surfaces as a provider 500 ("got type: null") and leaves the
  // subAgent with an empty completion envelope.
  const projectComplexToolSchemas = isOpenAiCompatibleProvider(provider.chatAdapter);
  const isArkPlan = isArkPlanProvider(resolved.providerTemplateCode);
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
    ...(isArkPlan
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

const buildSystemPrompt = (
  input: SkillAgentExecutionInput,
  completionCriteria: readonly string[],
) => {
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
    ...(completionCriteria.length > 0
      ? [
          "A completed status must also carry a completionProof that covers every local acceptance criterion.",
          'Each completionProof item is {"criterion":"<exact criterion text>","evidenceRefs":["tool:<n>"]}, where the ref points at a real successful governed Tool execution marked in its result as [governed-evidence tool:<n>].',
          "Schema disclosure, approval waits, blocked attempts and failed executions are not evidence. One execution may support at most one criterion.",
          `Local acceptance criteria: ${JSON.stringify([...completionCriteria])}`,
        ]
      : []),
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
  evidenceRef?: string,
): AgentToolResult<Record<string, unknown>> => ({
  content: [
    {
      type: "text",
      text: evidenceRef
        ? `[governed-evidence ${evidenceRef}]\n${renderSkillAgentToolResult(executed)}`
        : renderSkillAgentToolResult(executed),
    },
  ],
  details: {
    toolId: binding.id,
    ...(evidenceRef ? { evidenceRef } : {}),
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
  /**
   * Records a real successful governed execution and returns the stable
   * `tool:<n>` reference the model can cite. It is never invoked for a schema
   * disclosure, an approval wait, a blocked attempt or a thrown binding.
   */
  onGovernedExecution?: (record: GovernedExecutionRecord) => string;
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

    // Only a genuine governed return is authoritative execution proof. An
    // approval requirement stops before execution, so it records no evidence ref.
    const evidenceRef = !executed.requirement
      ? input.onGovernedExecution?.({
          toolId: input.binding.id,
          toolCallId: input.toolCallId,
          args: structuredClone(input.args),
          evidence: executed.evidence,
          artifacts: structuredClone(executed.artifacts ?? []),
          targets: extractExecutionTargets({
            args: input.args,
            evidence: executed.evidence,
            artifacts: executed.artifacts ?? [],
          }),
        })
      : undefined;

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
      toolResult: toAgentToolResult(input.binding, executed, evidenceRef),
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
  /**
   * Progressive Tool disclosure: only exact-known Tools are presented to the
   * model with their full schema. Metadata-stage Tools remain callable by name,
   * but their first call only promotes the schema and never executes the binding.
   */
  schemaDisclosed: boolean;
  promoteSchema?: () => boolean;
  markSchemaExecutionAttempted?: () => void;
  /**
   * Called only after the governed binding actually returned during a real
   * (post-schema) execution. Schema disclosure and failed/blocked attempts must
   * never satisfy goal evidence coverage.
   */
  onGovernedExecution?: (record: GovernedExecutionRecord) => string;
  parentSignal?: AbortSignal;
}): AgentTool<any> => ({
  name: input.binding.id,
  label: input.binding.label,
  description: input.schemaDisclosed
    ? input.binding.description
    : `${input.binding.description} Full input details are not disclosed yet. Invoke this Tool once to disclose its schema; that metadata-stage invocation will not execute the Tool.`,
  parameters: (input.schemaDisclosed
    ? projectProviderVisibleToolSchema({
        schema: input.binding.inputSchema,
        projectComplexToolSchemas: input.projectComplexToolSchemas,
      })
    : projectProviderVisibleToolSchema({
        schema: { type: "object" },
        projectComplexToolSchemas: input.projectComplexToolSchemas,
      })) as any,
  executionMode: "sequential",
  execute: async (toolCallId, params, signal) => {
    if (!input.schemaDisclosed) {
      const promoted = input.promoteSchema?.() ?? false;
      if (!promoted) {
        throw new Error(
          `Tool schema could not be disclosed for ${input.binding.id}; execution was blocked.`,
        );
      }
      await input.ledger.emitTrace(
        "plan.revised",
        `${input.binding.label} 参数结构已披露`,
        {
          toolId: input.binding.id,
          disclosureTransition: "metadata->schema",
          bindingExecuted: false,
        },
      );
      return {
        content: [
          {
            type: "text",
            text: `The full input schema for ${input.binding.id} is now disclosed. Retry this Tool using the disclosed schema. This metadata-stage call did not execute the Tool.`,
          },
        ],
        details: {
          toolId: input.binding.id,
          disclosure: "schema",
          bindingExecuted: false,
        },
      };
    }

    const args = (params ?? {}) as Record<string, unknown>;
    // Pi validates against the provider-visible Tool schema before execute().
    // Keep the canonical Harness schema check here as the final adapter guard so
    // a provider projection can never send unchecked args into the binding.
    validateInvocationArgs(args, input.binding.inputSchema);

    // Reaching the governed binding with canonically valid args is the execution
    // attempt boundary. Pi converts binding throws into error Tool results and
    // continues the Agent loop, so clearing the disclosure guard only after a
    // successful return would later misreport a real failed execution as
    // "never executed".
    input.markSchemaExecutionAttempted?.();

    const combined = combineAbortSignals(input.parentSignal, signal);
    try {
      const { toolResult } = await executeBinding({
        binding: input.binding,
        toolCallId,
        args,
        signal: combined.signal,
        evidence: input.evidence,
        artifacts: input.artifacts,
        requirements: input.requirements,
        toolCalls: input.toolCalls,
        recordToolCall: true,
        ledger: input.ledger,
        onGovernedExecution: input.onGovernedExecution,
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
  completionCriteria: readonly string[];
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
    ...(input.completionCriteria.length > 0
      ? { completionCriteria: [...input.completionCriteria] }
      : {}),
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
      // Pi 1.0 requires transcript tool-result details to be JSON-compatible.
      // Mira keeps its existing structured tool-result shape and narrows only at
      // this engine boundary; runtime data is unchanged.
      details: structuredClone(input.result.details) as JsonValue,
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

/**
 * How many same-Child reconciliation prompts the runtime may issue after a model
 * claims `completed` while its claim is not yet supported (schema-disclosed Tools
 * remain unexecuted with no authoritative execution, or declared acceptance
 * criteria lack verified evidence references). Bounded so a stuck model cannot
 * loop forever; neither schema disclosure nor a bare claim may be accepted as
 * completion.
 */
const MAX_SCHEMA_RECONCILIATION_ROUNDS = 2;

const buildSchemaReconciliationPrompt = (pendingTools: string[]) =>
  [
    "<schema-reconciliation>",
    `These Tools had their input schema disclosed but were never actually executed: ${pendingTools.join(", ")}.`,
    "Schema disclosure is not execution and is not evidence; it must not be counted as a completed Tool call.",
    "If the task goal still requires any of these Tools, call the Tool(s) now using the disclosed schema.",
    "If they are genuinely not required, complete again only when the goal is already supported by real governed Tool results or supplied context. Schema disclosure alone cannot justify a completed status.",
    "Return exactly one terminal JSON object.",
    "</schema-reconciliation>",
  ].join("\n");

const buildCompletionProofReconciliationPrompt = (input: {
  criteria: readonly string[];
  missing: readonly string[];
  ledger: GovernedExecutionRecord[];
}) => {
  const catalog = input.ledger.map((record, index) => ({
    ref: `tool:${index}`,
    toolId: record.toolId,
    targets: record.targets,
  }));
  return [
    "<completion-proof-reconciliation>",
    "Your completed claim is not yet supported by governed execution evidence for every local acceptance criterion.",
    `Acceptance criteria: ${JSON.stringify([...input.criteria])}`,
    `Unsupported criteria: ${JSON.stringify([...input.missing])}`,
    `Available governed evidence: ${JSON.stringify(catalog)}`,
    "Call the exposed Tool(s) now so each unsupported criterion has a real successful governed execution.",
    'Then return one terminal JSON object whose completionProof covers every criterion, using the exact criterion text and evidenceRefs of the form "tool:<n>" taken only from real successful governed executions.',
    "A reference must be an execution that really touched every concrete target named in the criterion and performed the requested operation; an execution on a different target or operation cannot support it.",
    "Schema disclosure, approval waits, blocked attempts and failed executions are not evidence, and one execution may support at most one criterion.",
    "</completion-proof-reconciliation>",
  ].join("\n");
};

export const runPiSkillAgent = async (input: {
  execution: SkillAgentExecutionInput;
  tools: SkillAgentToolBinding[];
  /**
   * Exact-known Tools that may be presented to the model with their full schema.
   * Undefined means the Skill did not opt into progressive disclosure, so every
   * allowed Tool keeps its full schema (the pre-existing behavior).
   */
  disclosedToolIds?: readonly string[];
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
  const disclosedToolIds = input.disclosedToolIds
    ? new Set(input.disclosedToolIds)
    : undefined;
  // A resumed Child proves coverage against the criteria frozen into its
  // approval checkpoint, not the Parent goal the resume caller happens to hold.
  const rawCompletionCriteria =
    checkpoint?.completionCriteria ?? input.execution.completionCriteria ?? [];
  const completionCriteria = [
    ...new Set(
      rawCompletionCriteria
        .map((criterion) => criterion.trim())
        .filter(Boolean),
    ),
  ];
  const pendingSchemaExecutions = new Set<string>();
  // Tools whose governed binding actually returned during this run. This is the
  // execution state, distinct from schema disclosure and from the model's claim.
  const executedBindingIds = new Set<string>();
  // Ordered record of real successful governed executions. Completion proof
  // references are indices into this ledger, so an unexecuted binding or a
  // failed attempt can never be cited as evidence.
  const executionLedger: GovernedExecutionRecord[] = [];
  const recordGovernedExecution = (record: GovernedExecutionRecord): string => {
    executedBindingIds.add(record.toolId);
    executionLedger.push(record);
    return `tool:${executionLedger.length - 1}`;
  };
  const hasAuthoritativeExecution = () =>
    executedBindingIds.size > 0 || evidence.length > 0 || artifacts.length > 0;
  const stateReportingTool = createStateReportingTool({ ledger });
  let toolLoadoutDirty = false;

  const promoteToolSchema = (toolId: string) => {
    if (!disclosedToolIds || disclosedToolIds.has(toolId)) return false;
    disclosedToolIds.add(toolId);
    pendingSchemaExecutions.add(toolId);

    // Disclosure is execution context, not authority. Persist the newly exact-
    // known Tool into the local SkillContext so an approval checkpoint/resume
    // cannot regress it back to metadata-only.
    input.execution.skillContext.disclosedTools = [...disclosedToolIds];

    // Pi snapshots the Tool context at prompt start. Mark the loadout dirty
    // here and apply it through prepareNextTurnWithContext at the supported
    // turn boundary, so the current Tool call finishes against a stable
    // snapshot and the next provider request receives the promoted schema.
    toolLoadoutDirty = true;
    return true;
  };

  const buildAgentTools = (): AgentTool<any>[] => [
    stateReportingTool,
    ...input.tools.map((binding) => {
      const schemaDisclosed = disclosedToolIds
        ? disclosedToolIds.has(binding.id)
        : true;
      return toPiTool({
        binding,
        evidence,
        artifacts,
        requirements,
        toolCalls,
        ledger,
        projectComplexToolSchemas,
        schemaDisclosed,
        ...(disclosedToolIds && !schemaDisclosed
          ? { promoteSchema: () => promoteToolSchema(binding.id) }
          : {}),
        ...(disclosedToolIds && schemaDisclosed
          ? {
              markSchemaExecutionAttempted: () => {
                pendingSchemaExecutions.delete(binding.id);
              },
            }
          : {}),
        onGovernedExecution: recordGovernedExecution,
        parentSignal: input.execution.signal,
      });
    }),
  ];

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
        onGovernedExecution: recordGovernedExecution,
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

  const sessionId = `mira-subagent:${primary.id}:${ledger.runId}`;
  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(input.execution, completionCriteria),
      model,
      tools: buildAgentTools(),
      ...(restoredMessages ? { messages: restoredMessages } : {}),
    },
    getApiKey: () => apiKey || undefined,
    toolExecution: "sequential",
    prepareNextTurnWithContext: (turn) => {
      if (!toolLoadoutDirty) return undefined;
      const tools = buildAgentTools();
      toolLoadoutDirty = false;
      return {
        context: {
          ...turn.context,
          tools,
        },
      };
    },
    sessionId,
    streamFn: createSkillAgentStreamFn(sessionId),
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
          completionCriteria,
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
  let completion = parseCompletionEnvelope(finalText);
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

  // A `completed` claim is only accepted when it is backed by verified
  // execution evidence. When the delegation contract supplied local acceptance
  // criteria, the model still judges semantic sufficiency and writes the
  // criterion -> evidence mapping, while the runtime deterministically enforces
  // that every criterion is present, that each reference is a real successful
  // governed execution recorded in this run, that a concrete target named by the
  // criterion was actually touched, and that no single execution is reused to
  // prop up several criteria. Without declared criteria the runtime keeps its
  // earlier schema-disclosure guard.
  //
  // Schema disclosure is neither execution nor evidence, so when a claim is not
  // yet supported the *same* Child gets a bounded chance to close the gap instead
  // of handing a recoverable failure back for a fresh delegation.
  const evaluateCompletedClaim = (
    candidate: Record<string, unknown>,
  ): CompletionEvaluation => {
    if (completionCriteria.length > 0) {
      const proof = parseCompletionProof(candidate.completionProof);
      const validation = validateCompletionProof({
        criteria: completionCriteria,
        proof,
        ledger: executionLedger,
      });
      if (validation.ok) return { ok: true };
      return {
        ok: false,
        reason: "completed_without_criterion_proof",
        missing: validation.missing,
        missingEvidence: validation.missing,
        prompt: buildCompletionProofReconciliationPrompt({
          criteria: completionCriteria,
          missing: validation.missing,
          ledger: executionLedger,
        }),
      };
    }

    if (pendingSchemaExecutions.size > 0 && !hasAuthoritativeExecution()) {
      const pendingTools = [...pendingSchemaExecutions].sort();
      return {
        ok: false,
        reason: "completed_without_authoritative_execution",
        missing: pendingTools,
        missingEvidence: [
          `Unexecuted governed Tool(s) required for completion: ${pendingTools.join(", ")}`,
        ],
        prompt: buildSchemaReconciliationPrompt(pendingTools),
      };
    }

    return { ok: true };
  };

  let reconciliationRounds = 0;
  let evaluation: CompletionEvaluation =
    completion.status === "completed"
      ? evaluateCompletedClaim(completion)
      : { ok: true };
  while (
    completion.status === "completed" &&
    !evaluation.ok &&
    reconciliationRounds < MAX_SCHEMA_RECONCILIATION_ROUNDS
  ) {
    // Snapshot the unsupported claim so its discriminated failure fields stay
    // narrowed while the loop reassigns `evaluation` for the next round.
    const unsupported = evaluation;
    reconciliationRounds += 1;
    await ledger.updateWorkingState({
      phase: "working",
      currentJudgement:
        unsupported.reason === "completed_without_criterion_proof"
          ? "完成声明尚未被每一条局部验收准则的真实执行证据覆盖。"
          : "完成声明缺少受治理 Tool 的真实执行证据；Schema 披露本身不算执行。",
      currentAction: "在同一 subAgent 内继续补足证据",
      nextAction: "执行受治理 Tool 以补齐缺口，或依据真实证据重新确认完成",
      blockingReason: `Unsupported completion proof: ${unsupported.missing.join(", ")}`,
    });
    await ledger.emitTrace(
      "plan.revised",
      "在同一 subAgent 内继续执行待完成 Tool",
      {
        reason: unsupported.reason,
        missing: unsupported.missing,
        reconciliationRound: reconciliationRounds,
      },
    );

    try {
      await agent.prompt(unsupported.prompt);
    } catch (error) {
      await ledger.updateWorkingState({
        phase: "failed",
        currentAction: "subAgent 继续执行中断",
        blockingReason: error instanceof Error ? error.message : String(error),
      });
      await ledger.emitTrace("subagent.failed", "subAgent 继续执行失败");
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

    const nextCompletion = parseCompletionEnvelope(
      extractAssistantText(agent.state.messages as unknown[]),
    );
    if (!nextCompletion) {
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
    completion = nextCompletion;
    evaluation =
      completion.status === "completed"
        ? evaluateCompletedClaim(completion)
        : { ok: true };
  }

  const status = completion.status as SkillAgentExecutionResult["status"];
  const summary = asNonEmptyString(completion.summary);

  if (status === "completed" && !evaluation.ok) {
    await ledger.updateWorkingState({
      phase: "blocked",
      currentJudgement:
        evaluation.reason === "completed_without_criterion_proof"
          ? "局部验收准则缺少真实、可追溯的受治理 Tool 执行证据；完成声明不成立。"
          : "Tool schema 已披露，但没有任何受治理 Tool 的真实执行证据；完成声明不成立。",
      currentAction: "拒绝缺少可核实证据的完成声明",
      nextAction: "执行受治理 Tool 取得真实结果，或如实上报证据缺口",
      blockingReason: `Unsupported completion proof: ${evaluation.missing.join(", ")}`,
    });
    await ledger.emitTrace(
      "input.required",
      "subAgent 完成声明缺少真实执行证据",
      {
        reason: evaluation.reason,
        missing: evaluation.missing,
      },
    );
    return {
      status: "insufficient_evidence",
      summary:
        evaluation.reason === "completed_without_criterion_proof"
          ? "The subAgent declared completion without verified execution evidence covering every local acceptance criterion."
          : "The subAgent declared completion after only disclosing Tool schemas, without executing the Tools required for verified task evidence.",
      missingEvidence: evaluation.missingEvidence,
      evidence,
      artifacts,
      trace: buildTrace({ ledger, skillId: primary.id, toolCalls }),
    };
  }

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
