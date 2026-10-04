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
      gaps: ["The tool returned no structured result."],
    });
  }
  if (!isRecord(result)) {
    return createGenericStructuredSummary(execution, evidenceIndex, { value: result });
  }

  const type = typeof result.type === "string" ? result.type : undefined;
  if (execution.toolId.startsWith("mcp:") && type === "external_mcp") {
    const nestedResult = result.result;
    const resultPreview =
      typeof nestedResult === "string"
        ? preview(nestedResult)
        : nestedResult && typeof nestedResult === "object"
          ? preview(JSON.stringify(nestedResult))
          : undefined;
    const recoveryOccurred = result.recoveryOccurred === true;
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: `Called remote MCP tool ${result.remoteToolName}.`,
      facts: [
        `serverId=${result.serverId}`,
        `remoteToolName=${result.remoteToolName}`,
        "invocationStatus=completed",
        `recoveryOccurred=${recoveryOccurred}`,
        ...(resultPreview ? [`result=${resultPreview}`] : []),
      ],
      data: {
        kind: "external_mcp",
        serverId: result.serverId,
        remoteToolName: result.remoteToolName,
        invocationStatus: "completed",
        recoveryOccurred,
        ...(resultPreview ? { resultPreview } : {}),
      },
    });
  }
  if (execution.toolId.startsWith("browser_") && isRecord(result.page)) {
    const page = result.page;
    const url = typeof page.url === "string" ? page.url : undefined;
    const title = typeof page.title === "string" ? page.title : undefined;
    const operation = execution.toolId === "browser_observe" ? "observe" : execution.toolId === "browser_act" ? "act" : execution.toolId === "browser_assert" ? "assert" : execution.toolId;
    const observation = isRecord(result.observation) ? result.observation : undefined;
    const assertion = isRecord(result.assertion) ? result.assertion : undefined;
    const facts = [
      `tool=${execution.toolId}`,
      ...(url ? [`url=${url}`] : []),
      ...(title ? [`title=${title}`] : []),
      ...(typeof observation?.visibleText === "string" ? [`visibleText=${preview(observation.visibleText)}`] : []),
      ...(typeof assertion?.kind === "string" ? [`assertion=${assertion.kind}`] : []),
      ...(typeof assertion?.passed === "boolean" ? [`passed=${assertion.passed}`] : []),
    ];
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: `Called ${execution.toolId}.`,
      facts,
      ...(result.ok === false ? { status: "failed", gaps: ["Browser operation reported an error outcome."] } : {}),
      data: {
        kind: "computer_use_browser",
        operation,
        page,
        ...(observation ? { observation } : {}),
        ...(assertion ? { assertion } : {}),
        ...(Array.isArray(result.artifacts) ? { artifacts: result.artifacts.slice(0, PREVIEW_ITEM_LIMIT) } : {}),
      },
    });
  }

  if (execution.toolId === "read_discover" && type === "discover") {
    const candidates = result.operation === "list"
      ? (Array.isArray(result.entries) ? result.entries.filter(isRecord).map((entry) =>
          typeof entry.name === "string" ? entry.name : "unknown",
        ) : [])
      : (Array.isArray(result.matches) ? result.matches.filter(isRecord).map((match) =>
          typeof match.path === "string" ? match.path : "unknown",
        ) : []);
    const returnedCount = typeof result.returnedCount === "number"
      ? result.returnedCount
      : candidates.length;
    const totalCount = typeof result.totalCount === "number"
      ? result.totalCount
      : undefined;
    const candidatePreview = candidates.slice(0, PREVIEW_ITEM_LIMIT);
    const hasMore =
      result.hasMore === true ||
      (typeof totalCount === "number" && returnedCount < totalCount);
    const truncated =
      result.truncated === true ||
      hasMore ||
      (typeof totalCount === "number" && returnedCount < totalCount);
    const path = typeof result.path === "string" ? result.path : undefined;
    const root = typeof result.root === "string"
      ? result.root
      : typeof result.scope === "string" ? result.scope : undefined;
    const query = typeof result.query === "string" ? result.query : undefined;
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: `Discovered ${returnedCount} workspace candidate(s) using ${result.operation}.`,
      facts: [
        `toolId=${execution.toolId}`,
        `operation=${result.operation}`,
        ...(path ? [`path=${path}`] : []),
        ...(root ? [`root=${root}`] : []),
        ...(query ? [`query=${query}`] : []),
        `candidateCount=${returnedCount}`,
        `returnedCount=${returnedCount}`,
        ...(typeof totalCount === "number" ? [`totalCount=${totalCount}`] : []),
        `hasMore=${hasMore}`,
        `truncated=${truncated}`,
        ...candidatePreview.map((candidate) => `candidatePath=${candidate}`),
      ],
      ...(truncated ? { gaps: ["Discovery results are truncated; more candidates may exist."] } : {}),
      status: truncated ? "truncated" : "completed",
      data: {
        kind: "read_discover",
        mode: result.operation,
        operation: result.operation,
        ...(path ? { path } : {}),
        ...(root ? { root } : {}),
        ...(query ? { query } : {}),
        candidateCount: returnedCount,
        candidatePaths: candidatePreview,
        returnedCount,
        ...(typeof totalCount === "number" ? { totalCount } : {}),
        hasMore,
        truncated,
      },
    });
  }

  if (execution.toolId === "read_list" && type === "list" && typeof result.path === "string" && Array.isArray(result.entries)) {
    const entries = result.entries.filter(isRecord).map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "unknown",
      type: entry.type === "directory" ? "directory" : "file",
    }));
    const entriesPreview = entries.slice(0, PREVIEW_ITEM_LIMIT).map((entry) =>
      `${entry.type === "directory" ? "[D]" : "[F]"} ${entry.name}`,
    );
    const truncated = result.truncated === true || entries.length > PREVIEW_ITEM_LIMIT;
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: `Listed workspace directory ${result.path}.`,
      facts: [
        `entryCount=${entries.length}`,
        `fileCount=${entries.filter((entry) => entry.type === "file").length}`,
        `directoryCount=${entries.filter((entry) => entry.type === "directory").length}`,
        ...entriesPreview,
      ],
      ...(truncated ? { gaps: ["Directory listing is truncated."] } : {}),
      status: truncated ? "truncated" : "completed",
      data: {
        kind: "read_list",
        path: result.path,
        entryCount: typeof result.totalCount === "number" ? result.totalCount : entries.length,
        fileCount: entries.filter((entry) => entry.type === "file").length,
        directoryCount: entries.filter((entry) => entry.type === "directory").length,
        entriesPreview,
        truncated,
      },
    });
  }

  if ((execution.toolId === "read_open" || execution.toolId === "read") && type === "open" && typeof result.path === "string" && isRecord(result.source)) {
    const text = typeof result.source.text === "string" ? result.source.text : "";
    const contentPreview = preview(text);
    const truncated = contentPreview.length < text.length;
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: `Opened file ${result.path}.`,
      facts: [`contentLength=${text.length}`, ...(contentPreview ? [contentPreview] : [])],
      ...(truncated ? { gaps: ["File content is truncated."] } : {}),
      status: truncated ? "truncated" : "completed",
      data: {
        kind: "read_open",
        path: result.path,
        contentPreview,
        contentLength: text.length,
        truncated,
        keySections: text
          .split(/\r?\n+/)
          .map((line) => line.trim())
          .filter((line) => /^#{1,6}\s+/.test(line))
          .slice(0, PREVIEW_ITEM_LIMIT)
          .map((line) => line.replace(/^#{1,6}\s+/, "")),
      },
    });
  }

  if ((execution.toolId === "read_locate" || execution.toolId === "grep") && type === "locate" && typeof result.query === "string" && Array.isArray(result.matches)) {
    const matches = result.matches.filter(isRecord).map((match) => ({
      path: typeof match.path === "string" ? match.path : "unknown",
      matchType: match.matchType === "content" ? "content" : "path",
      preview: typeof match.preview === "string" ? preview(match.preview, 120) : "",
    })).sort((left, right) => {
      const leftPriority = /^(docs[\\/]|readme\.md$|agents\.md$)/iu.test(left.path) ? 0 : 1;
      const rightPriority = /^(docs[\\/]|readme\.md$|agents\.md$)/iu.test(right.path) ? 0 : 1;
      return leftPriority - rightPriority || left.path.localeCompare(right.path);
    });
    const truncated = result.truncated === true || matches.length > PREVIEW_ITEM_LIMIT;
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: `Located ${matches.length} workspace match(es) for "${result.query}".`,
      facts: [
        `matchCount=${matches.length}`,
        ...matches.slice(0, PREVIEW_ITEM_LIMIT).map((match) =>
          match.preview ? `[${match.matchType}] ${match.path}: ${match.preview}` : `[${match.matchType}] ${match.path}`,
        ),
      ],
      ...(matches.length === 0 ? { gaps: ["No workspace matches were returned."] } : {}),
      ...(truncated ? { status: "truncated" } : {}),
      data: {
        kind: "read_locate",
        scope: typeof result.scope === "string" ? result.scope : "workspace",
        query: result.query,
        searchMode:
          result.searchMode === "path" || result.searchMode === "content"
            ? result.searchMode
            : "auto",
        matchCount: matches.length,
        matchedPaths: matches.map((match) => match.path),
        matchesPreview: matches.slice(0, PREVIEW_ITEM_LIMIT).map((match) =>
          match.preview ? `[${match.matchType}] ${match.path}: ${match.preview}` : `[${match.matchType}] ${match.path}`,
        ),
        truncated,
      },
    });
  }

  const unwrapped = isRecord(result.result) ? result.result : result;
  if (
    (execution.toolId === "edit_file" || execution.toolId === "write_file" || execution.toolId === "replace_block") &&
    isRecord(unwrapped) &&
    typeof unwrapped.path === "string" &&
    (unwrapped.operation === "write_file" || unwrapped.operation === "replace_block")
  ) {
    const dryRun = unwrapped.dryRun === true;
    const operation = unwrapped.operation === "replace_block" ? "replace" : "create";
    const meta = isRecord(result.result) ? result : {};
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: dryRun
        ? `Prepared a dry-run edit for workspace file ${unwrapped.path}.`
        : `Changed workspace file ${unwrapped.path}.`,
      facts: [
        `operation=${operation}`,
        `targetPath=${unwrapped.path}`,
        `dryRun=${dryRun}`,
        `changed=${!dryRun}`,
      ],
      data: {
        kind: "edit_file",
        operation,
        targetPath: unwrapped.path,
        dryRun,
        changed: !dryRun,
        created: !dryRun && operation === "create",
        replaced: !dryRun && operation === "replace",
        ...(typeof meta.actionProfileId === "string" ? { actionProfileId: meta.actionProfileId } : {}),
        ...(typeof meta.runtimeToolId === "string" ? { runtimeToolId: meta.runtimeToolId } : {}),
      },
    });
  }

  if (
    execution.toolId === "workspace_mutation" &&
    isRecord(unwrapped) &&
    typeof unwrapped.targetPath === "string" &&
    (unwrapped.operation === "write" ||
      unwrapped.operation === "delete" ||
      unwrapped.operation === "move")
  ) {
    const dryRun = unwrapped.dryRun === true;
    const operation = unwrapped.operation === "write"
      ? unwrapped.overwrite === true ? "overwrite" : "create"
      : unwrapped.operation;
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: dryRun
        ? `Prepared a dry-run workspace mutation for ${unwrapped.targetPath}.`
        : `Applied workspace mutation to ${unwrapped.targetPath}.`,
      facts: [
        `operation=${operation}`,
        `targetPath=${unwrapped.targetPath}`,
        `dryRun=${dryRun}`,
        `changed=${!dryRun}`,
      ],
      data: {
        kind: "workspace_mutation",
        operation,
        targetPath: unwrapped.targetPath,
        ...(typeof unwrapped.destinationPath === "string"
          ? { destinationPath: unwrapped.destinationPath }
          : {}),
        dryRun,
        changed: !dryRun,
        created: !dryRun && operation === "create",
        replaced: !dryRun && operation === "overwrite",
        deleted: !dryRun && operation === "delete",
        moved: !dryRun && operation === "move",
      },
    });
  }

  if ((execution.toolId === "web_search" || execution.toolId === "news_search") && typeof result.query === "string" && Array.isArray(result.results)) {
    const results = result.results.filter(isRecord);
    const topFindings = results.slice(0, PREVIEW_ITEM_LIMIT).map((item) =>
      preview([item.title, item.snippet].filter((part) => typeof part === "string").join(": "), 180),
    );
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: `Searched the web for "${result.query}".`,
      facts: [`resultCount=${results.length}`, ...topFindings],
      ...(results.length === 0 ? { gaps: ["No web results were returned."] } : {}),
      data: {
        kind: "web_search",
        query: result.query,
        resultCount: results.length,
        topFindings,
        citationsPreview: results.slice(0, PREVIEW_ITEM_LIMIT).map((item) => ({
          title: typeof item.title === "string" ? item.title : "",
          link: typeof item.link === "string" ? item.link : "",
        })),
      },
    });
  }

  if (execution.toolId === "terminal_session" && typeof result.command === "string" && "timedOut" in result) {
    const timedOut = result.timedOut === true;
    const truncated = result.truncated === true;
    const exitCode = typeof result.exitCode === "number" || result.exitCode === null
      ? result.exitCode
      : null;
    const stdout = typeof result.stdout === "string" ? preview(result.stdout) : "";
    const stderr = typeof result.stderr === "string" ? preview(result.stderr) : "";
    const stdoutEncoding = result.stdoutEncoding ?? "unknown";
    const stderrEncoding = result.stderrEncoding ?? "unknown";
    const binaryDetected = result.binaryDetected === true;
    const unreadableReason = binaryDetected
      ? "Terminal output contains binary data."
      : stdoutEncoding === "unknown" || stderrEncoding === "unknown"
        ? "Terminal output encoding is unknown."
        : hasUnreadableTerminalText(stdout) || hasUnreadableTerminalText(stderr)
          ? "Terminal output contains replacement, mojibake, or placeholder characters."
          : undefined;
    const outputInterpretable =
      unreadableReason === undefined;
    const commandSucceeded: AgentEvidenceResolution = timedOut
      ? "unknown"
      : exitCode === 0
        ? "true"
        : typeof exitCode === "number"
          ? "false"
          : "unknown";
    const gaps = [
      ...(timedOut ? ["Command did not finish."] : []),
      ...(truncated ? ["Terminal output is truncated."] : []),
      ...(!outputInterpretable
        ? ["Terminal output encoding or text is not reliably interpretable."]
        : []),
    ];
    return baseSummary({
      execution,
      evidenceIndex,
      actionTaken: `Executed terminal command "${result.command}".`,
      facts: [
        `exitCode=${exitCode === null ? "null" : exitCode}`,
        `timedOut=${timedOut}`,
        `truncated=${truncated}`,
        ...(stdout ? [`stdout=${stdout}`] : []),
        ...(stderr ? [`stderr=${stderr}`] : []),
      ],
      ...(timedOut
        ? { status: "timed_out" as const }
        : truncated
          ? { status: "truncated" as const }
          : !outputInterpretable
            ? { status: binaryDetected ? "binaryDetected" as const : "partial" as const }
            : {}),
      ...(gaps.length ? { gaps } : {}),
      data: {
        kind: "terminal_session",
        command: result.command,
        exitCode,
        processCompleted: !timedOut,
        commandSucceeded,
        stdoutPreview: stdout,
        stderrPreview: stderr,
        stdoutEncoding,
        stderrEncoding,
        timedOut,
        truncated,
        binaryDetected,
        violations: Array.isArray(result.violations)
          ? result.violations.filter((item): item is string => typeof item === "string")
          : [],
        outputInterpretable,
        ...(unreadableReason ? { unreadableReason } : {}),
      },
    });
  }

  return createGenericStructuredSummary(execution, evidenceIndex, result);
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
