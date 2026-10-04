import type {
  ToolContentBlock,
  ToolDefinition,
  ToolEvidence,
  ToolResult,
} from "./definitions.js";

export type NormalizedToolResult = {
  content: ToolContentBlock[];
  structuredContent: unknown;
  isError: boolean;
};

const normalizedContentByInvocationId = new Map<string, ToolContentBlock[]>();

export const storeNormalizedToolContent = (invocationId: string, content: ToolContentBlock[]) => {
  if (content.length > 0) normalizedContentByInvocationId.set(invocationId, content);
};

export const getNormalizedToolContent = (invocationId: string) =>
  normalizedContentByInvocationId.get(invocationId);

export const deleteNormalizedToolContent = (invocationId: string) => normalizedContentByInvocationId.delete(invocationId);

export const clearNormalizedToolContent = () => normalizedContentByInvocationId.clear();

export const normalizeToolResult = (result: ToolResult): NormalizedToolResult => ({
  content: result.content ?? [],
  structuredContent: result.structuredContent,
  isError: result.isError === true,
});

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const textPreview = (value: unknown, limit = 280) => {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit).trimEnd()}...` : normalized;
};

const baseEvidence = (input: {
  result: unknown;
  isError: boolean;
  actionTaken: string;
  facts: string[];
  gaps?: string[];
  data?: unknown;
}): ToolEvidence => ({
  actionTaken: input.actionTaken,
  facts: input.facts,
  ...(input.gaps?.length ? { gaps: input.gaps } : {}),
  ...(input.isError ? { status: "failed" } : { status: "completed" }),
  ...(input.data === undefined ? {} : { data: input.data }),
});

const projectReadEvidence = (toolId: string, result: Record<string, unknown>, isError: boolean) => {
  if (toolId === "read_open" || toolId === "read") {
    const path = typeof result.path === "string" ? result.path : "unknown";
    const source = asRecord(result.source);
    const text = typeof source?.text === "string" ? source.text : "";
    const contentPreview = textPreview(text);
    const truncated = contentPreview.length < text.length;
    return baseEvidence({
      result,
      isError,
      actionTaken: `Opened file ${path}.`,
      facts: [`contentLength=${text.length}`, ...(contentPreview ? [contentPreview] : [])],
      gaps: truncated ? ["File content is truncated."] : undefined,
      data: { kind: "read_open", path, contentPreview, contentLength: text.length, truncated },
    });
  }
  if (toolId === "read_list" || toolId === "read_discover") {
    const operation = typeof result.operation === "string" ? result.operation : "list";
    const entries = Array.isArray(result.entries) ? result.entries : Array.isArray(result.matches) ? result.matches : [];
    const returnedCount = typeof result.returnedCount === "number" ? result.returnedCount : entries.length;
    const totalCount = typeof result.totalCount === "number" ? result.totalCount : undefined;
    const truncated = result.truncated === true || result.hasMore === true || (totalCount !== undefined && returnedCount < totalCount);
    return baseEvidence({
      result,
      isError,
      actionTaken: `Discovered ${returnedCount} workspace candidate(s) using ${operation}.`,
      facts: [`operation=${operation}`, `candidateCount=${returnedCount}`, `truncated=${truncated}`],
      gaps: truncated ? ["Discovery results are truncated; more candidates may exist."] : entries.length === 0 ? ["No workspace matches were returned."] : undefined,
      data: { kind: toolId === "read_list" ? "read_list" : "read_discover", operation, returnedCount, ...(totalCount === undefined ? {} : { totalCount }), truncated },
    });
  }
  if (toolId === "read_locate" || toolId === "grep") {
    const query = typeof result.query === "string" ? result.query : "";
    const matches = Array.isArray(result.matches) ? result.matches : [];
    return baseEvidence({
      result,
      isError,
      actionTaken: `Located ${matches.length} workspace match(es) for "${query}".`,
      facts: [`matchCount=${matches.length}`],
      gaps: matches.length === 0 ? ["No workspace matches were returned."] : undefined,
      data: { kind: "read_locate", query, matchCount: matches.length },
    });
  }
  return undefined;
};

export const projectToolEvidence = (
  definition: Pick<ToolDefinition, "id" | "source" | "domain">,
  normalized: NormalizedToolResult,
): ToolEvidence | undefined => {
  const result = asRecord(normalized.structuredContent);
  if (!result) {
    return baseEvidence({
      result: normalized.structuredContent,
      isError: normalized.isError,
      actionTaken: `${definition.id} completed.`,
      facts: [`toolId=${definition.id}`],
      gaps: normalized.structuredContent === undefined ? ["The tool returned no structured result."] : undefined,
      data: { kind: "generic_structured", value: normalized.structuredContent },
    });
  }

  const readEvidence = projectReadEvidence(definition.id, result, normalized.isError);
  if (readEvidence) return readEvidence;

  if (definition.id === "terminal_session") {
    const exitCode = typeof result.exitCode === "number" || result.exitCode === null ? result.exitCode : null;
    const timedOut = result.timedOut === true;
    const command = typeof result.command === "string" ? result.command : "unknown";
    const commandSucceeded = timedOut ? "unknown" : exitCode === 0 ? "true" : typeof exitCode === "number" ? "false" : "unknown";
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Executed terminal command "${command}".`,
      facts: [`exitCode=${exitCode === null ? "null" : exitCode}`, `timedOut=${timedOut}`],
      gaps: timedOut ? ["Command did not finish."] : result.truncated === true ? ["Terminal output is truncated."] : undefined,
      data: { kind: "terminal_session", command, exitCode, commandSucceeded, timedOut, truncated: result.truncated === true },
    });
  }

  if (definition.source === "external" || definition.domain === "external_mcp") {
    const serverId = typeof result.serverId === "string" ? result.serverId : "unknown";
    const remoteToolName = typeof result.remoteToolName === "string" ? result.remoteToolName : definition.id;
    const nested = result.result;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Called remote MCP tool ${remoteToolName}.`,
      facts: [`serverId=${serverId}`, `remoteToolName=${remoteToolName}`, `invocationStatus=${String(result.invocationStatus ?? "completed")}`],
      gaps: normalized.isError ? ["The remote MCP tool reported an error outcome."] : undefined,
      data: { kind: "external_mcp", serverId, remoteToolName, invocationStatus: result.invocationStatus ?? "completed", recoveryOccurred: result.recoveryOccurred === true, resultPreview: textPreview(nested) },
    });
  }

  if (definition.id.startsWith("browser_") || definition.id.startsWith("browser_attached_")) {
    const page = asRecord(result.page);
    const url = typeof result.url === "string" ? result.url : typeof page?.url === "string" ? page.url : undefined;
    const title = typeof result.title === "string" ? result.title : typeof page?.title === "string" ? page.title : undefined;
    const operation = definition.id === "browser_observe" ? "observe" : definition.id === "browser_act" ? "act" : definition.id === "browser_assert" ? "assert" : definition.id;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Called ${definition.id}.`,
      facts: [`tool=${definition.id}`, ...(url ? [`url=${url}`] : []), ...(title ? [`title=${title}`] : [])],
      gaps: normalized.isError ? ["Browser operation reported an error outcome."] : undefined,
      data: { kind: "computer_use_browser", operation, ...(url ? { url } : {}), ...(title ? { title } : {}), ...result },
    });
  }

  if (definition.id.startsWith("github_")) {
    return baseEvidence({ result, isError: normalized.isError, actionTaken: `Executed ${definition.id}.`, facts: [`toolId=${definition.id}`], data: { kind: "github", ...result } });
  }

  if (definition.id.startsWith("office_")) {
    return baseEvidence({ result, isError: normalized.isError, actionTaken: `Executed ${definition.id}.`, facts: [`toolId=${definition.id}`], data: { kind: "office", ...result } });
  }

  if (definition.id === "codebase_explore") {
    const verified = asRecord(result.verifiedEvidenceInput);
    const retrieval = result.retrievalEvidence;
    const nestedExplore = asRecord(result.exploreResult);
    const degraded = result.degraded === true || nestedExplore?.degraded === true;
    const fallbackSignal = typeof result.fallbackSignal === "string" ? result.fallbackSignal : asRecord(nestedExplore?.fallbackSignal);
    const fallbackText = typeof fallbackSignal === "string" ? fallbackSignal : fallbackSignal ? textPreview(fallbackSignal) : undefined;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: "Explored the codebase.",
      facts: [degraded ? "degraded=true" : "degraded=false", ...(fallbackText ? [`fallbackSignal=${fallbackText}`] : [])],
      gaps: degraded || result.partial === true ? ["Codebase exploration returned partial evidence."] : undefined,
      data: { kind: "codebase_explore", verifiedEvidenceInput: verified ?? null, retrievalEvidence: retrieval ?? null, exploreResult: nestedExplore ?? null },
    });
  }

  return baseEvidence({
    result,
    isError: normalized.isError,
    actionTaken: `${definition.id} returned structured data.`,
    facts: [`resultKeys=${Object.keys(result).join(",")}`],
    gaps: normalized.isError ? ["The tool reported an error outcome."] : undefined,
    data: { kind: "generic_structured", preview: result },
  });
};
