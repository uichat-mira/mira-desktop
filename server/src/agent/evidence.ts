import type {
  AgentEvidencePayload,
  AgentEvidenceResolution,
  AgentEvidenceSummary,
  AgentObservation,
  AgentRetrievalEvidence,
  AgentToolExecutionResult,
} from "./types";

type EvidenceState = {
  observations?: AgentObservation[];
  evidence?: AgentEvidencePayload;
};

const PREVIEW_ITEM_LIMIT = 5;
const TEXT_PREVIEW_LIMIT = 280;
const STRUCTURED_PREVIEW_MAX_DEPTH = 3;
const STRUCTURED_PREVIEW_MAX_KEYS = 12;
const STRUCTURED_PREVIEW_MAX_SIZE = 4_000;
const SENSITIVE_KEY = /(?:token|authorization|cookie|password|secret|api[-_]?key|header|env)/iu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const preview = (value: string, limit = TEXT_PREVIEW_LIMIT) => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}...` : text;
};

const hasUnreadableTerminalText = (value: string) =>
  /[\uFFFD�]|锟|\?{3,}/u.test(value);

type StructuredPreviewState = {
  size: number;
  truncated: boolean;
  redacted: boolean;
  unsupported: boolean;
};

const boundedStructuredPreview = (value: unknown) => {
  const state: StructuredPreviewState = {
    size: 0,
    truncated: false,
    redacted: false,
    unsupported: false,
  };

  const visit = (current: unknown, depth: number): unknown => {
    if (state.size >= STRUCTURED_PREVIEW_MAX_SIZE) {
      state.truncated = true;
      return "...[truncated]";
    }
    if (current === null || typeof current === "boolean" || typeof current === "number") {
      state.size += String(current).length;
      return current;
    }
    if (typeof current === "string") {
      const result = preview(current);
      state.size += result.length;
      if (result !== current.replace(/\s+/g, " ").trim()) state.truncated = true;
      return result;
    }
    if (depth >= STRUCTURED_PREVIEW_MAX_DEPTH) {
      state.truncated = true;
      return "...[depth limit]";
    }
    if (Array.isArray(current)) {
      const result = current.slice(0, PREVIEW_ITEM_LIMIT).map((item) => visit(item, depth + 1));
      if (current.length > PREVIEW_ITEM_LIMIT) state.truncated = true;
      return result;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      const entries = Object.entries(record);
      const result: Record<string, unknown> = {};
      for (const [key, item] of entries.slice(0, STRUCTURED_PREVIEW_MAX_KEYS)) {
        if (SENSITIVE_KEY.test(key)) {
          state.redacted = true;
          state.truncated = true;
          continue;
        }
        result[key] = visit(item, depth + 1);
      }
      if (entries.length > STRUCTURED_PREVIEW_MAX_KEYS) state.truncated = true;
      return result;
    }
    state.unsupported = true;
    state.truncated = true;
    return "...[unsupported]";
  };

  let previewValue: unknown;
  try {
    previewValue = visit(value, 0);
    if (JSON.stringify(previewValue).length > STRUCTURED_PREVIEW_MAX_SIZE) {
      state.truncated = true;
      previewValue = "...[size limit]";
    }
  } catch {
    state.unsupported = true;
    state.truncated = true;
    previewValue = undefined;
  }
  return { preview: previewValue, ...state };
};

const createGenericStructuredSummary = (
  execution: AgentToolExecutionResult,
  evidenceIndex: number,
  result: Record<string, unknown>,
): AgentEvidenceSummary => {
  const bounded = boundedStructuredPreview(result);
  const items = Array.isArray(result.items) ? result.items : undefined;
  const total = typeof result.total === "number" ? result.total : undefined;
  const hasNextCursor = typeof result.nextCursor === "string" && result.nextCursor.length > 0;
  const itemCount = items?.length;
  const gaps = [
    ...(items?.length === 0 ? ["The structured result contains no items."] : []),
    ...(Object.keys(result).length === 0 ? ["The structured result contains no fields."] : []),
    ...(bounded.truncated ? ["Structured tool result is truncated to a bounded preview."] : []),
    ...(bounded.redacted ? ["Sensitive fields were removed from the structured preview."] : []),
    ...(bounded.unsupported ? ["Some result values could not be represented safely."] : []),
  ];
  const facts = [
    `resultKeys=${Object.keys(result).filter((key) => !SENSITIVE_KEY.test(key)).slice(0, STRUCTURED_PREVIEW_MAX_KEYS).join(",")}`,
    ...(typeof itemCount === "number" ? [`itemCount=${itemCount}`] : []),
    ...(typeof total === "number" ? [`total=${total}`] : []),
    ...(hasNextCursor ? ["hasNextCursor=true"] : []),
  ];
  return baseSummary({
    execution,
    evidenceIndex,
    actionTaken: `${execution.toolId} returned structured data.`,
    facts,
    gaps,
    status: gaps.length ? "partial" : "completed",
    data: {
      kind: "generic_structured",
      preview: bounded.preview,
      truncated: bounded.truncated,
      redacted: bounded.redacted,
      unsupported: bounded.unsupported,
      ...(typeof itemCount === "number" ? { itemCount } : {}),
      ...(typeof total === "number" ? { total } : {}),
      ...(hasNextCursor ? { hasNextCursor } : {}),
    },
  });
};

const rawRef = (execution: AgentToolExecutionResult, evidenceIndex: number) => ({
  evidenceIndex,
  toolCallId: execution.toolCallId,
  invocationId: execution.invocationId,
});

const statusForExecution = (
  execution: AgentToolExecutionResult,
): AgentEvidenceSummary["status"] => {
  if (execution.status === "awaiting_approval") return "blocked";
  if (execution.status === "failed") return "failed";
  return "completed";
};

const baseSummary = (input: {
  execution: AgentToolExecutionResult;
  evidenceIndex: number;
  status?: AgentEvidenceSummary["status"];
  actionTaken: string;
  facts: string[];
  gaps?: string[];
  error?: string;
  data?: unknown;
}): AgentEvidenceSummary => ({
  source: "tool",
  status: input.status ?? statusForExecution(input.execution),
  toolId: input.execution.toolId,
  inputHash: input.execution.inputHash,
  actionTaken: input.actionTaken,
  keyFindings: input.facts,
  facts: input.facts,
  ...(input.gaps?.length ? { gaps: input.gaps } : {}),
  ...(input.error ? { error: input.error } : {}),
  ...(input.data ? { data: input.data as AgentEvidenceSummary["data"] } : {}),
  rawRef: rawRef(input.execution, input.evidenceIndex),
});

export const getEvidencePayload = (state: EvidenceState): AgentEvidencePayload => ({
  observations: state.evidence?.observations ?? [],
  toolExecutions: state.evidence?.toolExecutions ?? [],
  retrievals: state.evidence?.retrievals ?? [],
  latestSummary:
    state.evidence?.latestSummary ??
    state.evidence?.toolExecutions.at(-1)?.summary ??
    state.evidence?.retrievals.at(-1)?.summary ??
    state.evidence?.observations.at(-1)?.summary,
});

export const createObservationEvidenceSummary = (input: {
  observation: AgentObservation;
  evidenceIndex: number;
}): AgentEvidenceSummary => ({
  source: "observation",
  status:
    input.observation.status === "ok"
      ? "completed"
      : input.observation.status === "partial"
        ? "partial"
        : input.observation.status,
  actionTaken: `Recorded observation for ${input.observation.stepId}.`,
  keyFindings: input.observation.facts.slice(0, PREVIEW_ITEM_LIMIT),
  facts: input.observation.facts.slice(0, PREVIEW_ITEM_LIMIT),
  ...(input.observation.errorMessage
    ? { error: input.observation.errorMessage }
    : {}),
  data: {
    kind: "observation",
    stepId: input.observation.stepId,
    factsPreview: input.observation.facts.slice(0, PREVIEW_ITEM_LIMIT),
  },
  rawRef: { evidenceIndex: input.evidenceIndex },
});

export const createRetrievalEvidenceSummary = (input: {
  retrieval: AgentRetrievalEvidence;
  question?: string;
  evidenceIndex: number;
}): AgentEvidenceSummary => {
  const documentsPreview = input.retrieval.chunks
    .slice(0, PREVIEW_ITEM_LIMIT)
    .map((chunk) => chunk.documentName);
  const facts = [
    `query=${input.retrieval.query}`,
    `chunkCount=${input.retrieval.chunkCount}`,
    ...documentsPreview.map((name) => `document=${name}`),
  ];
  return {
    source: "retrieval",
    status: input.retrieval.chunkCount > 0 ? "completed" : "partial",
    actionTaken: `Retrieved ${input.retrieval.chunkCount} knowledge chunk(s).`,
    keyFindings: facts,
    facts,
    ...(input.retrieval.chunkCount === 0
      ? { gaps: ["No retrieval chunks were returned."] }
      : {}),
    data: {
      kind: "retrieval",
      query: input.retrieval.query,
      chunkCount: input.retrieval.chunkCount,
      documentsPreview,
    },
    rawRef: { evidenceIndex: input.evidenceIndex },
  };
};

const summarizeToolResult = (
  execution: AgentToolExecutionResult,
  evidenceIndex: number,
): AgentEvidenceSummary => {
  if (execution.evidence) {
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: execution.evidence.actionTaken,
      facts: execution.evidence.facts,
      gaps: execution.evidence.gaps,
      error: execution.evidence.error,
      status: execution.evidence.status,
      data: execution.evidence.data,
    });
  }

  const result = execution.result;
  if (result === null || typeof result === "undefined") {
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: `${execution.toolId} completed.`,
      facts: [`toolId=${execution.toolId}`, `status=${execution.status}`],
      gaps: ["The tool returned no normalized evidence or structured result."],
    });
  }

  return createGenericStructuredSummary(
    execution,
    evidenceIndex,
    isRecord(result) ? result : { value: result },
  );
};

export const createToolExecutionEvidenceSummary = (input: {
  execution: AgentToolExecutionResult;
  question?: string;
  evidenceIndex: number;
}): AgentEvidenceSummary => {
  if (input.execution.status === "awaiting_approval") {
    return baseSummary({
      execution: input.execution,
      evidenceIndex: input.evidenceIndex,
      status: "blocked",
      actionTaken: `${input.execution.toolId} is waiting for approval.`,
      facts: [`toolId=${input.execution.toolId}`],
      gaps: ["Approval decision is pending."],
    });
  }
  if (input.execution.status === "failed") {
    const invocationError = (
      input.execution as AgentToolExecutionResult & {
        invocationError?: {
          code: string;
          message: string;
          retryable: boolean;
          suggestedAction?: string | null;
        };
      }
    ).invocationError;
    return baseSummary({
      execution: input.execution,
      evidenceIndex: input.evidenceIndex,
      status: "failed",
      actionTaken: `${input.execution.toolId} failed during execution.`,
      facts: [
        `toolId=${input.execution.toolId}`,
        `failureKind=${input.execution.failureKind ?? "recoverable"}`,
        ...(input.execution.failureCode ? [`failureCode=${input.execution.failureCode}`] : []),
        ...(invocationError
          ? [
              `errorCode=${invocationError.code}`,
              `retryable=${invocationError.retryable}`,
              ...(invocationError.suggestedAction
                ? [`suggestedAction=${invocationError.suggestedAction}`]
                : []),
            ]
          : []),
      ],
      error: input.execution.errorMessage,
      gaps: [
        input.execution.failureKind === "terminal"
          ? "Execution stopped after a terminal failure."
          : "A successful or adjusted execution result is still missing.",
      ],
      ...(invocationError
        ? {
            data: {
              kind: "structured_tool_error",
              code: invocationError.code,
              message: invocationError.message,
              retryable: invocationError.retryable,
              ...(invocationError.suggestedAction === undefined
                ? {}
                : { suggestedAction: invocationError.suggestedAction }),
            },
          }
        : {}),
    });
  }
  return summarizeToolResult(input.execution, input.evidenceIndex);
};

export const getLatestEvidenceSummary = (state: EvidenceState) =>
  getEvidencePayload(state).latestSummary;

export const appendObservationEvidence = (
  state: EvidenceState,
  observation: AgentObservation,
): AgentEvidencePayload => {
  const current = getEvidencePayload(state);
  if (current.observations.some((item) => item.id === observation.id)) return current;
  const observations = [...current.observations, observation];
  const summary = createObservationEvidenceSummary({
    observation,
    evidenceIndex: observations.length - 1,
  });
  return { ...current, observations: observations.map((item) => item), latestSummary: summary };
};

export const appendToolExecutionEvidence = (
  state: EvidenceState,
  execution: AgentToolExecutionResult,
): AgentEvidencePayload => {
  const current = getEvidencePayload(state);
  const executions = [...current.toolExecutions, execution];
  const summary = createToolExecutionEvidenceSummary({
    execution,
    evidenceIndex: executions.length - 1,
  });
  return {
    ...current,
    toolExecutions: [...executions.slice(0, -1), { ...execution, summary }],
    latestSummary: summary,
  };
};

export const appendRetrievalEvidence = (
  state: EvidenceState,
  retrieval: AgentRetrievalEvidence,
): AgentEvidencePayload => {
  const current = getEvidencePayload(state);
  const retrievals = [...current.retrievals, retrieval];
  const summary = createRetrievalEvidenceSummary({
    retrieval,
    evidenceIndex: retrievals.length - 1,
  });
  return {
    ...current,
    retrievals: [...retrievals.slice(0, -1), { ...retrieval, summary }],
    latestSummary: summary,
  };
};

export const getEvidenceCounts = (state: EvidenceState) => {
  const evidence = getEvidencePayload(state);
  return {
    observations: evidence.observations.length,
    toolExecutions: evidence.toolExecutions.length,
    retrievals: evidence.retrievals.length,
  };
};
