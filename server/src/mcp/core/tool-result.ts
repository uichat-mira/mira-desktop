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

const SENSITIVE_KEY = /(?:token|authorization|cookie|password|secret|api[-_]?key|header|env)/iu;
const STRUCTURED_PREVIEW_MAX_DEPTH = 3;
const STRUCTURED_PREVIEW_MAX_KEYS = 12;
const STRUCTURED_PREVIEW_MAX_SIZE = 4_000;

const boundedStructuredPreview = (value: unknown) => {
  const state = { size: 0, truncated: false, redacted: false, unsupported: false };
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
      const result = textPreview(current);
      state.size += result.length;
      if (result !== current.replace(/\s+/g, " ").trim()) state.truncated = true;
      return result;
    }
    if (depth >= STRUCTURED_PREVIEW_MAX_DEPTH) {
      state.truncated = true;
      return "...[depth limit]";
    }
    if (Array.isArray(current)) {
      const result = current.slice(0, 5).map((item) => visit(item, depth + 1));
      if (current.length > 5) state.truncated = true;
      return result;
    }
    if (current && typeof current === "object") {
      const result: Record<string, unknown> = {};
      const entries = Object.entries(current);
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
  let preview: unknown;
  try {
    preview = visit(value, 0);
    if (JSON.stringify(preview).length > STRUCTURED_PREVIEW_MAX_SIZE) {
      state.truncated = true;
      preview = "...[size limit]";
    }
  } catch {
    state.unsupported = true;
    state.truncated = true;
    preview = undefined;
  }
  return { preview, ...state };
};

const baseEvidence = (input: {
  result: unknown;
  isError: boolean;
  actionTaken: string;
  facts: string[];
  gaps?: string[];
  error?: string;
  status?: ToolEvidence["status"];
  data?: unknown;
}): ToolEvidence => ({
  actionTaken: input.actionTaken,
  facts: input.facts,
  ...(input.gaps?.length ? { gaps: input.gaps } : {}),
  ...(input.error ? { error: input.error } : {}),
  status: input.status ?? (input.isError ? "failed" : "completed"),
  ...(input.data === undefined ? {} : { data: input.data }),
});

const projectReadEvidence = (toolId: string, result: Record<string, unknown>, isError: boolean) => {
  if (toolId === "read" && result.type === "unsupported") {
    const path = typeof result.path === "string" ? result.path : "unknown";
    const reason = typeof result.reason === "string" ? result.reason : "unsupported";
    const fileType = typeof result.fileType === "string" ? result.fileType : undefined;
    const mimeType = typeof result.mimeType === "string" ? result.mimeType : undefined;
    const sizeBytes =
      typeof result.sizeBytes === "number" ? result.sizeBytes : undefined;
    const maxBytes =
      typeof result.maxBytes === "number" ? result.maxBytes : undefined;
    const suggestedSkill =
      typeof result.suggestedSkill === "string" ? result.suggestedSkill : undefined;
    const gap =
      reason === "office_owned"
        ? `Office-native file ${path} is owned by the ${suggestedSkill ?? fileType ?? "Office"} Skill domain.`
        : reason === "file_too_large"
          ? `Image file ${path} exceeds the canonical read image transport limit.`
          : reason === "unknown_encoding"
            ? `Text encoding for ${path} could not be identified safely.`
            : `Generic read does not decode binary file ${path} as text.`;
    return baseEvidence({
      result,
      isError,
      actionTaken:
        reason === "file_too_large"
          ? `Image read was not emitted for oversized file ${path}.`
          : `Generic read did not consume ${path} as ordinary text.`,
      facts: [
        `path=${path}`,
        `reason=${reason}`,
        ...(fileType ? [`fileType=${fileType}`] : []),
        ...(mimeType ? [`mimeType=${mimeType}`] : []),
        ...(sizeBytes === undefined ? [] : [`sizeBytes=${sizeBytes}`]),
        ...(maxBytes === undefined ? [] : [`maxBytes=${maxBytes}`]),
        ...(suggestedSkill ? [`suggestedSkill=${suggestedSkill}`] : []),
      ],
      gaps: [gap],
      status: "partial",
      data: {
        kind: "generic_structured",
        preview: {
          type: "unsupported",
          path,
          reason,
          ...(fileType ? { fileType } : {}),
          ...(mimeType ? { mimeType } : {}),
          ...(sizeBytes === undefined ? {} : { sizeBytes }),
          ...(maxBytes === undefined ? {} : { maxBytes }),
          ...(suggestedSkill ? { suggestedSkill } : {}),
        },
        truncated: false,
        redacted: false,
        unsupported: true,
      },
    });
  }
  if (toolId === "read" && result.mediaType === "image") {
    const path = typeof result.path === "string" ? result.path : "unknown";
    const mimeType =
      typeof result.mimeType === "string" ? result.mimeType : "image/*";
    const sizeBytes =
      typeof result.sizeBytes === "number" ? result.sizeBytes : undefined;
    return baseEvidence({
      result,
      isError,
      actionTaken: `Read image file ${path}.`,
      facts: [
        `path=${path}`,
        "mediaType=image",
        `mimeType=${mimeType}`,
        ...(sizeBytes === undefined ? [] : [`sizeBytes=${sizeBytes}`]),
      ],
      data: {
        kind: "read",
        path,
        contentPreview: `[image ${mimeType}]`,
        contentLength: 0,
        truncated: false,
        mediaType: "image",
        mimeType,
        ...(sizeBytes === undefined ? {} : { sizeBytes }),
      },
    });
  }
  if (toolId === "read") {
    const path = typeof result.path === "string" ? result.path : "unknown";
    const source = asRecord(result.source);
    const text = typeof source?.text === "string" ? source.text : "";
    const contentPreview = textPreview(text);
    const previewTruncated = contentPreview.length < text.length;
    const resultTruncated = result.truncated === true || result.hasMore === true;
    const truncated = previewTruncated || resultTruncated;
    const offset = typeof result.offset === "number" ? result.offset : 0;
    const limit = typeof result.limit === "number" ? result.limit : undefined;
    const returnedCount =
      typeof result.returnedCount === "number" ? result.returnedCount : undefined;
    const totalLines =
      typeof result.totalLines === "number" ? result.totalLines : undefined;
    const startLine =
      typeof result.startLine === "number" ? result.startLine : undefined;
    const endLine =
      typeof result.endLine === "number" ? result.endLine : undefined;
    const nextOffset =
      typeof result.nextOffset === "number" ? result.nextOffset : undefined;
    return baseEvidence({
      result,
      isError,
      actionTaken: `Read file ${path}.`,
      facts: [
        `path=${path}`,
        `contentLength=${text.length}`,
        `offset=${offset}`,
        ...(limit === undefined ? [] : [`limit=${limit}`]),
        ...(returnedCount === undefined ? [] : [`returnedCount=${returnedCount}`]),
        ...(totalLines === undefined ? [] : [`totalLines=${totalLines}`]),
        ...(startLine === undefined ? [] : [`startLine=${startLine}`]),
        ...(endLine === undefined ? [] : [`endLine=${endLine}`]),
        ...(nextOffset === undefined ? [] : [`nextOffset=${nextOffset}`]),
        ...(contentPreview ? [contentPreview] : []),
      ],
      gaps: truncated
        ? [
            resultTruncated
              ? "File read is paged; continuation is available."
              : "File content preview is truncated.",
          ]
        : undefined,
      status: truncated ? "truncated" : undefined,
      data: {
        kind: "read",
        path,
        contentPreview,
        contentLength: text.length,
        truncated,
        pagination: {
          offset,
          ...(limit === undefined ? {} : { limit }),
          ...(returnedCount === undefined ? {} : { returnedCount }),
          ...(totalLines === undefined ? {} : { totalLines }),
          ...(startLine === undefined ? {} : { startLine }),
          ...(endLine === undefined ? {} : { endLine }),
          ...(nextOffset === undefined ? {} : { nextOffset }),
        },
        keySections: text
          .split(/\r?\n+/)
          .map((line) => line.trim())
          .filter((line) => /^#{1,6}\s+/.test(line))
          .slice(0, 5)
          .map((line) => line.replace(/^#{1,6}\s+/, "")),
      },
    });
  }
  if (toolId === "read_open") {
    const path = typeof result.path === "string" ? result.path : "unknown";
    const source = asRecord(result.source);
    const text = typeof source?.text === "string" ? source.text : "";
    const contentPreview = textPreview(text);
    const truncated = contentPreview.length < text.length;
    return baseEvidence({
      result,
      isError,
      actionTaken: `Opened file ${path}.`,
      facts: [
        `contentLength=${text.length}`,
        ...(contentPreview ? [contentPreview] : []),
      ],
      gaps: truncated ? ["File content preview is truncated."] : undefined,
      status: truncated ? "truncated" : undefined,
      data: {
        kind: "read_open",
        path,
        contentPreview,
        contentLength: text.length,
        truncated,
        keySections: text
          .split(/\r?\n+/)
          .map((line) => line.trim())
          .filter((line) => /^#{1,6}\s+/.test(line))
          .slice(0, 5)
          .map((line) => line.replace(/^#{1,6}\s+/, "")),
      },
    });
  }
  if (toolId === "list" || toolId === "read_list") {
    const path = typeof result.path === "string" ? result.path : "unknown";
    const entries = Array.isArray(result.entries)
      ? result.entries.filter(asRecord).map((entry) => ({
          name: typeof entry.name === "string" ? entry.name : "unknown",
          type:
            entry.type === "directory"
              ? "directory"
              : entry.type === "symlink"
                ? "symlink"
                : "file",
        }))
      : [];
    const returnedCount =
      typeof result.returnedCount === "number" ? result.returnedCount : entries.length;
    const totalCount =
      typeof result.totalCount === "number" ? result.totalCount : returnedCount;
    const fileCount = entries.filter((entry) => entry.type === "file").length;
    const directoryCount = entries.filter((entry) => entry.type === "directory").length;
    const symlinkCount = entries.filter((entry) => entry.type === "symlink").length;
    const entriesPreview = entries.slice(0, 5).map((entry) => {
      const prefix =
        entry.type === "directory" ? "[D]" : entry.type === "symlink" ? "[L]" : "[F]";
      return `${prefix} ${entry.name}`;
    });
    const truncated =
      result.truncated === true ||
      result.hasMore === true ||
      returnedCount < totalCount;
    return baseEvidence({
      result,
      isError,
      actionTaken: `Listed workspace directory ${path}.`,
      facts: [
        `path=${path}`,
        `entryCount=${totalCount}`,
        `fileCount=${fileCount}`,
        `directoryCount=${directoryCount}`,
        ...(toolId === "list" && typeof result.offset === "number"
          ? [`offset=${result.offset}`]
          : []),
        ...(toolId === "list" && typeof result.nextOffset === "number"
          ? [`nextOffset=${result.nextOffset}`]
          : []),
        ...(symlinkCount > 0 ? [`symlinkCount=${symlinkCount}`] : []),
        ...entriesPreview,
      ],
      gaps: truncated
        ? ["Directory listing is truncated."]
        : entries.length === 0
          ? ["Directory is empty."]
          : undefined,
      status: truncated ? "truncated" : undefined,
      data: {
        kind: toolId === "list" ? "list" : "read_list",
        path,
        entryCount: totalCount,
        fileCount,
        directoryCount,
        ...(symlinkCount > 0 ? { symlinkCount } : {}),
        entriesPreview,
        ...(toolId === "list" && typeof result.offset === "number"
          ? { offset: result.offset }
          : {}),
        ...(toolId === "list" && typeof result.nextOffset === "number"
          ? { nextOffset: result.nextOffset }
          : {}),
        truncated,
      },
    });
  }
  if (toolId === "glob") {
    const pattern = typeof result.pattern === "string" ? result.pattern : "";
    const path = typeof result.path === "string" ? result.path : ".";
    const matches = Array.isArray(result.matches)
      ? result.matches.filter((value): value is string => typeof value === "string")
      : [];
    const returnedCount =
      typeof result.returnedCount === "number" ? result.returnedCount : matches.length;
    const totalCount =
      typeof result.totalCount === "number" ? result.totalCount : returnedCount;
    const truncated =
      result.truncated === true ||
      result.hasMore === true ||
      returnedCount < totalCount;
    const matchedPaths = matches.slice(0, 20);
    const matchesPreview = matchedPaths.slice(0, 5);
    return baseEvidence({
      result,
      isError,
      actionTaken: `Matched workspace files with glob ${pattern || "(empty)"}.`,
      facts: [
        `pattern=${pattern}`,
        `path=${path}`,
        `matchCount=${totalCount}`,
        ...(typeof result.offset === "number" ? [`offset=${result.offset}`] : []),
        ...(typeof result.nextOffset === "number"
          ? [`nextOffset=${result.nextOffset}`]
          : []),
        ...matchesPreview.map((match) => `matchedPath=${match}`),
      ],
      gaps: truncated
        ? ["Glob results are truncated."]
        : matches.length === 0
          ? ["Glob pattern matched no files."]
          : undefined,
      status: truncated ? "truncated" : undefined,
      data: {
        kind: "glob",
        pattern,
        path,
        matchCount: totalCount,
        offset: typeof result.offset === "number" ? result.offset : 0,
        ...(typeof result.nextOffset === "number" ? { nextOffset: result.nextOffset } : {}),
        matchedPaths,
        matchesPreview,
        truncated,
      },
    });
  }
  if (toolId === "read_discover") {
    const operation = typeof result.operation === "string" ? result.operation : "list";
    const entries = Array.isArray(result.entries) ? result.entries : Array.isArray(result.matches) ? result.matches : [];
    const returnedCount = typeof result.returnedCount === "number" ? result.returnedCount : entries.length;
    const totalCount = typeof result.totalCount === "number" ? result.totalCount : undefined;
    const truncated = result.truncated === true || result.hasMore === true || (totalCount !== undefined && returnedCount < totalCount);
    const candidatePaths = toolId === "read_discover"
      ? (operation === "list"
        ? entries.filter(asRecord).map((entry) => typeof entry.name === "string" ? entry.name : "unknown")
        : entries.filter(asRecord).map((entry) => typeof entry.path === "string" ? entry.path : "unknown"))
      : [];
    const candidatePreview = candidatePaths.slice(0, 5);
    const path = typeof result.path === "string" ? result.path : undefined;
    const root = typeof result.root === "string" ? result.root : typeof result.scope === "string" ? result.scope : undefined;
    const query = typeof result.query === "string" ? result.query : undefined;
    return baseEvidence({
      result,
      isError,
      actionTaken: `Discovered ${returnedCount} workspace candidate(s) using ${operation}.`,
      facts: [
        `operation=${operation}`,
        ...(path ? [`path=${path}`] : []),
        ...(root ? [`root=${root}`] : []),
        ...(query ? [`query=${query}`] : []),
        `candidateCount=${returnedCount}`,
        `returnedCount=${returnedCount}`,
        ...(totalCount === undefined ? [] : [`totalCount=${totalCount}`]),
        `hasMore=${result.hasMore === true || (totalCount !== undefined && returnedCount < totalCount)}`,
        `truncated=${truncated}`,
        ...candidatePreview.map((candidate) => `candidatePath=${candidate}`),
      ],
      gaps: truncated ? ["Discovery results are truncated; more candidates may exist."] : entries.length === 0 ? ["No workspace matches were returned."] : undefined,
      status: truncated ? "truncated" : undefined,
      data: {
        kind: "read_discover",
        mode: typeof result.mode === "string" ? result.mode : operation,
        operation,
        ...(path ? { path } : {}),
        ...(root ? { root } : {}),
        ...(query ? { query } : {}),
        candidateCount: returnedCount,
        candidatePaths: candidatePreview,
        returnedCount,
        ...(totalCount === undefined ? {} : { totalCount }),
        hasMore: result.hasMore === true || (totalCount !== undefined && returnedCount < totalCount),
        truncated,
      },
    });
  }
  if (toolId === "grep") {
    const pattern = typeof result.pattern === "string" ? result.pattern : "";
    const path = typeof result.path === "string" ? result.path : ".";
    const provider = typeof result.provider === "string" ? result.provider : "unknown";
    const matches = Array.isArray(result.matches)
      ? result.matches.filter(asRecord).map((match) => ({
          path: typeof match.path === "string" ? match.path : "unknown",
          line: typeof match.line === "number" ? match.line : 0,
          column: typeof match.column === "number" ? match.column : 0,
          preview:
            typeof match.preview === "string"
              ? textPreview(match.preview, 120)
              : "",
        }))
      : [];
    const truncated = result.truncated === true || result.hasMore === true;
    const matchedPaths = [...new Set(matches.map((match) => match.path))].slice(0, 20);
    const matchesPreview = matches.slice(0, 5).map((match) =>
      `${match.path}:${match.line}:${match.column}${match.preview ? `: ${match.preview}` : ""}`,
    );
    return baseEvidence({
      result,
      isError,
      actionTaken: `Searched workspace text for "${pattern}".`,
      facts: [
        `pattern=${pattern}`,
        `path=${path}`,
        `provider=${provider}`,
        `matchCount=${matches.length}`,
        ...(typeof result.offset === "number" ? [`offset=${result.offset}`] : []),
        ...(typeof result.nextOffset === "number"
          ? [`nextOffset=${result.nextOffset}`]
          : []),
        ...matchesPreview,
      ],
      gaps: [
        ...(matches.length === 0 ? ["No workspace content matches were returned."] : []),
        ...(truncated ? ["Grep results are truncated."] : []),
      ],
      status: truncated ? "truncated" : undefined,
      data: {
        kind: "grep",
        pattern,
        path,
        matchCount: matches.length,
        offset: typeof result.offset === "number" ? result.offset : 0,
        ...(typeof result.nextOffset === "number" ? { nextOffset: result.nextOffset } : {}),
        matchedPaths,
        matchesPreview,
        provider,
        truncated,
      },
    });
  }
  if (toolId === "read_locate") {
    const query = typeof result.query === "string" ? result.query : "";
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const sortedMatches = matches.filter(asRecord).map((match) => ({
      path: typeof match.path === "string" ? match.path : "unknown",
      matchType: match.matchType === "content" ? "content" : "path",
      preview: typeof match.preview === "string" ? textPreview(match.preview, 120) : "",
    })).sort((left, right) => {
      const leftPriority = /^(docs[\\/]|readme\\.md$|agents\\.md$)/iu.test(left.path) ? 0 : 1;
      const rightPriority = /^(docs[\\/]|readme\\.md$|agents\\.md$)/iu.test(right.path) ? 0 : 1;
      return leftPriority - rightPriority || left.path.localeCompare(right.path);
    });
    const truncated = result.truncated === true || sortedMatches.length > 5;
    const matchesPreview = sortedMatches.slice(0, 5).map((match) =>
      match.preview ? `[${match.matchType}] ${match.path}: ${match.preview}` : `[${match.matchType}] ${match.path}`,
    );
    return baseEvidence({
      result,
      isError,
      actionTaken: `Located ${sortedMatches.length} workspace match(es) for "${query}".`,
      facts: [`matchCount=${sortedMatches.length}`, ...matchesPreview],
      gaps: [
        ...(sortedMatches.length === 0 ? ["No workspace matches were returned."] : []),
        ...(truncated ? ["Search results are truncated."] : []),
      ],
      status: truncated ? "truncated" : undefined,
      data: {
        kind: "read_locate",
        scope: typeof result.scope === "string" ? result.scope : "workspace",
        query,
        searchMode: result.searchMode === "path" || result.searchMode === "content" ? result.searchMode : "auto",
        matchCount: sortedMatches.length,
        matchedPaths: sortedMatches.map((match) => match.path),
        matchesPreview,
        truncated,
      },
    });
  }
  return undefined;
};

const FILE_MUTATION_TOOL_IDS = new Set([
  "write",
  "edit",
  "move",
  "delete",
]);

const projectFileMutationEvidence = (
  toolId: string,
  result: Record<string, unknown>,
  isError: boolean,
): ToolEvidence | undefined => {
  if (!FILE_MUTATION_TOOL_IDS.has(toolId)) {
    return undefined;
  }

  const operation = result.operation;
  const targetPath = result.path;
  if (
    operation !== toolId ||
    typeof targetPath !== "string" ||
    result.changed !== true
  ) {
    return undefined;
  }

  const destinationPath =
    typeof result.destinationPath === "string"
      ? result.destinationPath
      : undefined;
  const artifactId =
    typeof result.artifactId === "string" ? result.artifactId : undefined;
  const resultDiffPreview =
    typeof result.diffPreview === "string"
      ? result.diffPreview
      : undefined;
  const diffPreview =
    resultDiffPreview === undefined
      ? undefined
      : resultDiffPreview.length > 1_200
        ? `${resultDiffPreview.slice(0, 1_200)}\n... [evidence preview truncated]`
        : resultDiffPreview;
  const diffAvailable = result.diffAvailable === true;
  const diffUnavailableReason =
    typeof result.diffUnavailableReason === "string"
      ? result.diffUnavailableReason
      : undefined;
  const diffTruncated = result.diffTruncated === true;

  const facts = [
    `operation=${operation}`,
    `targetPath=${targetPath}`,
    "changed=true",
    `diffAvailable=${diffAvailable}`,
    ...(artifactId ? [`artifactId=${artifactId}`] : []),
  ];

  if (operation === "write") {
    facts.push(
      `created=${result.created === true}`,
      `overwritten=${result.overwritten === true}`,
      ...(typeof result.bytesBefore === "number"
        ? [`bytesBefore=${result.bytesBefore}`]
        : []),
      ...(typeof result.bytesAfter === "number"
        ? [`bytesAfter=${result.bytesAfter}`]
        : []),
    );
  } else if (operation === "edit") {
    facts.push(
      ...(typeof result.editsApplied === "number"
        ? [`editsApplied=${result.editsApplied}`]
        : []),
      ...(typeof result.tolerantEdits === "number"
        ? [`tolerantEdits=${result.tolerantEdits}`]
        : []),
      ...(typeof result.bytesBefore === "number"
        ? [`bytesBefore=${result.bytesBefore}`]
        : []),
      ...(typeof result.bytesAfter === "number"
        ? [`bytesAfter=${result.bytesAfter}`]
        : []),
    );
  } else if (operation === "move") {
    if (destinationPath) facts.push(`destinationPath=${destinationPath}`);
    if (typeof result.movedType === "string") {
      facts.push(`movedType=${result.movedType}`);
    }
    facts.push(`overwritten=${result.overwritten === true}`);
  } else if (operation === "delete") {
    if (typeof result.deletedType === "string") {
      facts.push(`deletedType=${result.deletedType}`);
    }
    facts.push(`recursive=${result.recursive === true}`);
  }

  const actionTaken =
    operation === "write"
      ? result.created === true
        ? `Created workspace file ${targetPath}.`
        : `Overwrote workspace file ${targetPath}.`
      : operation === "edit"
        ? `Edited workspace file ${targetPath}.`
        : operation === "move"
          ? `Moved workspace target ${targetPath} to ${destinationPath ?? "unknown destination"}.`
          : `Deleted workspace target ${targetPath}.`;

  return baseEvidence({
    result,
    isError,
    actionTaken,
    facts,
    gaps: [
      ...(diffUnavailableReason
        ? [`Content diff unavailable: ${diffUnavailableReason}.`]
        : []),
      ...(diffTruncated ? ["Content diff artifact is truncated."] : []),
    ],
    data: {
      kind: "file_mutation",
      operation,
      targetPath,
      ...(destinationPath ? { destinationPath } : {}),
      changed: true,
      ...(artifactId ? { artifactId } : {}),
      ...(typeof result.created === "boolean"
        ? { created: result.created }
        : {}),
      ...(typeof result.overwritten === "boolean"
        ? { overwritten: result.overwritten }
        : {}),
      ...(typeof result.editsApplied === "number"
        ? { editsApplied: result.editsApplied }
        : {}),
      ...(typeof result.tolerantEdits === "number"
        ? { tolerantEdits: result.tolerantEdits }
        : {}),
      ...(typeof result.movedType === "string"
        ? { movedType: result.movedType }
        : {}),
      ...(typeof result.deletedType === "string"
        ? { deletedType: result.deletedType }
        : {}),
      ...(typeof result.recursive === "boolean"
        ? { recursive: result.recursive }
        : {}),
      ...(typeof result.bytesBefore === "number"
        ? { bytesBefore: result.bytesBefore }
        : {}),
      ...(typeof result.bytesAfter === "number"
        ? { bytesAfter: result.bytesAfter }
        : {}),
      diffAvailable,
      ...(diffPreview ? { diffPreview } : {}),
      diffTruncated,
      ...(diffUnavailableReason ? { diffUnavailableReason } : {}),
    },
  });
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

  const fileMutationEvidence = projectFileMutationEvidence(
    definition.id,
    result,
    normalized.isError,
  );
  if (fileMutationEvidence) return fileMutationEvidence;

  if ((definition.id === "web_search" || definition.id === "news_search") && typeof result.query === "string" && Array.isArray(result.results)) {
    const results = result.results.filter(asRecord);
    const topFindings = results.slice(0, 5).map((item) =>
      textPreview([item.title, item.snippet].filter((part) => typeof part === "string").join(": "), 180),
    );
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Searched the web for "${result.query}".`,
      facts: [
        `query=${result.query}`,
        `resultCount=${results.length}`,
        ...(typeof result.provider === "string" ? [`provider=${result.provider}`] : []),
        ...topFindings,
      ],
      gaps: results.length === 0 ? ["No web results were returned."] : undefined,
      data: {
        kind: "web_search",
        query: result.query,
        resultCount: results.length,
        topFindings,
        citationsPreview: results.slice(0, 5).map((item) => ({
          title: typeof item.title === "string" ? textPreview(item.title, 180) : "",
          link: typeof item.link === "string" ? item.link : "",
        })),
        ...(typeof result.provider === "string" ? { provider: result.provider } : {}),
        ...(typeof result.capabilityId === "string" ? { capabilityId: result.capabilityId } : {}),
      },
    });
  }

  if (definition.id === "terminal_session") {
    const exitCode = typeof result.exitCode === "number" || result.exitCode === null ? result.exitCode : null;
    const timedOut = result.timedOut === true;
    const command = typeof result.command === "string" ? result.command : "unknown";
    const commandSucceeded = timedOut ? "unknown" : exitCode === 0 ? "true" : typeof exitCode === "number" ? "false" : "unknown";
    const stdout = typeof result.stdout === "string" ? textPreview(result.stdout) : "";
    const stderr = typeof result.stderr === "string" ? textPreview(result.stderr) : "";
    const stdoutEncoding = result.stdoutEncoding ?? "unknown";
    const stderrEncoding = result.stderrEncoding ?? "unknown";
    const binaryDetected = result.binaryDetected === true;
    const unreadableReason = binaryDetected
      ? "Terminal output contains binary data."
      : stdoutEncoding === "unknown" || stderrEncoding === "unknown"
        ? "Terminal output encoding is unknown."
        : /[\uFFFD�]|锟|\?{3,}/u.test(`${stdout} ${stderr}`)
          ? "Terminal output contains replacement, mojibake, or placeholder characters."
          : undefined;
    const outputInterpretable = unreadableReason === undefined;
    const gaps = [
      ...(timedOut ? ["Command did not finish."] : []),
      ...(result.truncated === true ? ["Terminal output is truncated."] : []),
      ...(!outputInterpretable ? ["Terminal output encoding or text is not reliably interpretable."] : []),
    ];
    const status = timedOut
      ? "timed_out"
      : result.truncated === true
        ? "truncated"
        : !outputInterpretable
          ? binaryDetected ? "binaryDetected" : "partial"
          : undefined;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Executed terminal command "${command}".`,
      facts: [
        `exitCode=${exitCode === null ? "null" : exitCode}`,
        `timedOut=${timedOut}`,
        `truncated=${result.truncated === true}`,
        ...(stdout ? [`stdout=${stdout}`] : []),
        ...(stderr ? [`stderr=${stderr}`] : []),
      ],
      gaps,
      status,
      data: {
        kind: "terminal_session",
        command,
        exitCode,
        processCompleted: !timedOut,
        commandSucceeded,
        stdoutPreview: stdout,
        stderrPreview: stderr,
        stdoutEncoding,
        stderrEncoding,
        timedOut,
        truncated: result.truncated === true,
        binaryDetected,
        violations: Array.isArray(result.violations) ? result.violations.filter((item): item is string => typeof item === "string") : [],
        outputInterpretable,
        ...(unreadableReason ? { unreadableReason } : {}),
      },
    });
  }

  if (definition.source === "external" && definition.domain === "external_mcp" && definition.id.startsWith("mcp:")) {
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
    const attached = definition.id.startsWith("browser_attached_");
    const provider = attached ? "chujie" : undefined;
    const observation = asRecord(result.observation);
    const assertion = asRecord(result.assertion);
    const visibleText = typeof observation?.visibleText === "string"
      ? observation.visibleText
      : typeof result.text === "string" ? result.text : undefined;
    const elements = Array.isArray(result.elements)
      ? result.elements.filter(asRecord).slice(0, 5).map((element) => ({
          ...(typeof element.ref === "string" ? { ref: element.ref } : {}),
          ...(typeof element.role === "string" ? { role: element.role } : {}),
          ...(typeof element.name === "string" ? { name: textPreview(element.name, 120) } : {}),
          ...(typeof element.text === "string" ? { text: textPreview(element.text, 120) } : {}),
          ...(typeof element.disabled === "boolean" ? { disabled: element.disabled } : {}),
          ...(typeof element.tag === "string" ? { tag: element.tag } : {}),
          ...(typeof element.type === "string" ? { type: element.type } : {}),
          ...(typeof element.href === "string" || element.href === null ? { href: element.href } : {}),
          ...(typeof element.value === "string" ? { value: textPreview(element.value, 120) } : {}),
        }))
      : undefined;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Called ${definition.id}.`,
      facts: [
        `operation=${operation}`,
        `ok=${result.ok === false ? "false" : "true"}`,
        ...(provider ? [`provider=${provider}`] : []),
        ...(url ? [`url=${url}`] : []),
        ...(title ? [`title=${title}`] : []),
        ...(typeof page?.snapshotHash === "string" ? [`snapshotHash=${page.snapshotHash}`] : []),
        ...(visibleText ? [`visibleText=${textPreview(visibleText)}`] : []),
        ...(typeof assertion?.kind === "string" ? [`assertion=${assertion.kind}`] : []),
        ...(typeof assertion?.passed === "boolean" ? [`passed=${assertion.passed}`] : []),
      ],
      gaps: normalized.isError ? ["Browser operation reported an error outcome."] : undefined,
      error: typeof asRecord(result.error)?.message === "string" ? String(asRecord(result.error)?.message) : undefined,
      status: normalized.isError || result.ok === false ? "failed" : undefined,
      data: {
        kind: "computer_use_browser",
        operation,
        ...(provider ? { provider } : {}),
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
        ...(typeof page?.snapshotHash === "string" ? { snapshotHash: page.snapshotHash } : {}),
        ...(page ? {
          page: {
            ...(url ? { url } : {}),
            ...(title ? { title } : {}),
            ...(typeof page.snapshotHash === "string" ? { snapshotHash: page.snapshotHash } : {}),
          },
        } : {}),
        ...(typeof result.version === "number" ? { version: result.version } : {}),
        ...(typeof result.tabId === "number" ? { tabId: result.tabId } : {}),
        ...(visibleText ? { visibleTextPreview: textPreview(visibleText) } : {}),
        ...(visibleText ? { observation: { visibleText: textPreview(visibleText) } } : {}),
        ...(elements ? { elementCount: Array.isArray(result.elements) ? result.elements.length : elements.length, elements } : {}),
        ...(assertion ? {
          assertion: {
            ...(typeof assertion.kind === "string" ? { kind: assertion.kind } : {}),
            ...(typeof assertion.passed === "boolean" ? { passed: assertion.passed } : {}),
          },
        } : {}),
        ...(Array.isArray(result.artifacts) ? { artifactCount: result.artifacts.length } : {}),
      },
    });
  }

  if (definition.id.startsWith("github_")) {
    const repository = typeof result.repository === "string" ? result.repository : "unknown";
    const operation = typeof result.operation === "string" ? result.operation : undefined;
    const metadata = asRecord(result.metadata);
    const issue = asRecord(result.issue);
    const pullRequest = asRecord(result.pullRequest);
    const run = asRecord(result.run);
    const comments = Array.isArray(result.comments) ? result.comments.length : 0;
    const files = Array.isArray(result.files) ? result.files.length : 0;
    const reviews = Array.isArray(result.reviews) ? result.reviews.length : 0;
    const facts = [`toolId=${definition.id}`, `repository=${repository}`];
    if (definition.id === "github_repo_read") {
      facts.push(`Default branch is ${typeof metadata?.defaultBranch === "string" && metadata.defaultBranch ? metadata.defaultBranch : "unknown"}.`);
      facts.push(`Returned ${Array.isArray(result.commits) ? result.commits.length : 0} commit(s) and ${Array.isArray(result.branches) ? result.branches.length : 0} branch(es).`);
    } else if (issue) {
      facts.push(`Issue state is ${String(issue.state ?? "unknown")}.`, `Returned ${comments} comment(s).`);
    } else if (pullRequest) {
      facts.push(`Pull Request state is ${String(pullRequest.state ?? "unknown")}.`, `Returned ${files} file(s), ${comments} comment(s), and ${reviews} review(s).`);
    } else if (run) {
      facts.push(`Run status is ${String(run.status ?? "unknown")}.`, `Run conclusion is ${String(run.conclusion ?? "not completed")}.`, `Returned ${Array.isArray(result.jobs) ? result.jobs.length : 0} Job(s).`);
    } else if (operation) {
      facts.push(`operation=${operation}`);
    }
    const issueSummary = issue ? {
      ...(typeof issue.number === "number" ? { number: issue.number } : {}),
      ...(typeof issue.title === "string" ? { title: textPreview(issue.title, 180) } : {}),
      ...(typeof issue.state === "string" ? { state: issue.state } : {}),
    } : undefined;
    const pullRequestSummary = pullRequest ? {
      ...(typeof pullRequest.number === "number" ? { number: pullRequest.number } : {}),
      ...(typeof pullRequest.title === "string" ? { title: textPreview(pullRequest.title, 180) } : {}),
      ...(typeof pullRequest.state === "string" ? { state: pullRequest.state } : {}),
    } : undefined;
    const runSummary = run ? {
      ...(typeof run.id === "number" || typeof run.id === "string" ? { id: run.id } : {}),
      ...(typeof run.status === "string" ? { status: run.status } : {}),
      ...(typeof run.conclusion === "string" ? { conclusion: run.conclusion } : {}),
    } : undefined;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Executed ${definition.id}.`,
      facts,
      data: {
        kind: "github",
        repository,
        ...(operation ? { operation } : {}),
        ...(typeof metadata?.defaultBranch === "string" ? { defaultBranch: metadata.defaultBranch } : {}),
        ...(issueSummary ? { issue: issueSummary } : {}),
        ...(pullRequestSummary ? { pullRequest: pullRequestSummary } : {}),
        ...(runSummary ? { run: runSummary } : {}),
        ...(Array.isArray(result.commits) ? { commitCount: result.commits.length } : {}),
        ...(Array.isArray(result.branches) ? { branchCount: result.branches.length } : {}),
        ...(Array.isArray(result.jobs) ? { jobCount: result.jobs.length } : {}),
        ...(Array.isArray(result.files) ? { fileCount: files } : {}),
        ...(Array.isArray(result.comments) ? { commentCount: comments } : {}),
        ...(Array.isArray(result.reviews) ? { reviewCount: reviews } : {}),
      },
    });
  }

  const unwrapped = asRecord(result.result) ?? result;
  if (definition.id === "edit_file" || definition.id === "write_file" || definition.id === "replace_block") {
    if (typeof unwrapped.path === "string" && (unwrapped.operation === "write_file" || unwrapped.operation === "replace_block")) {
      const dryRun = unwrapped.dryRun === true;
      const operation = unwrapped.operation === "replace_block" ? "replace" : "create";
      const actionProfileId = typeof result.actionProfileId === "string" ? result.actionProfileId : undefined;
      const runtimeToolId = typeof result.runtimeToolId === "string" ? result.runtimeToolId : undefined;
      return baseEvidence({
        result,
        isError: normalized.isError,
        actionTaken: dryRun ? `Prepared a dry-run edit for workspace file ${unwrapped.path}.` : `Changed workspace file ${unwrapped.path}.`,
        facts: [`operation=${operation}`, `targetPath=${unwrapped.path}`, `dryRun=${dryRun}`, `changed=${!dryRun}`],
        data: { kind: "edit_file", operation, targetPath: unwrapped.path, dryRun, changed: !dryRun, created: !dryRun && operation === "create", replaced: !dryRun && operation === "replace", ...(actionProfileId ? { actionProfileId } : {}), ...(runtimeToolId ? { runtimeToolId } : {}) },
      });
    }
  }

  if (definition.id === "workspace_mutation" && typeof unwrapped.targetPath === "string" && (unwrapped.operation === "write" || unwrapped.operation === "delete" || unwrapped.operation === "move")) {
    const dryRun = unwrapped.dryRun === true;
    const operation = unwrapped.operation === "write" ? unwrapped.overwrite === true ? "overwrite" : "create" : unwrapped.operation;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: dryRun ? `Prepared a dry-run workspace mutation for ${unwrapped.targetPath}.` : `Applied workspace mutation to ${unwrapped.targetPath}.`,
      facts: [`operation=${operation}`, `targetPath=${unwrapped.targetPath}`, `dryRun=${dryRun}`, `changed=${!dryRun}`],
      data: { kind: "workspace_mutation", operation, targetPath: unwrapped.targetPath, ...(typeof unwrapped.destinationPath === "string" ? { destinationPath: unwrapped.destinationPath } : {}), dryRun, changed: !dryRun, created: !dryRun && operation === "create", replaced: !dryRun && operation === "overwrite", deleted: !dryRun && operation === "delete", moved: !dryRun && operation === "move" },
    });
  }

  if (definition.id.startsWith("office_")) {
    const operation = typeof result.operation === "string" ? result.operation : "unknown";
    const pathFacts = [
      typeof result.inputPath === "string" ? `Source: ${result.inputPath}` : undefined,
      typeof result.outputPath === "string" ? `Output: ${result.outputPath}` : undefined,
    ].filter((value): value is string => Boolean(value));
    const detail = result.summary ?? result.runtime ?? result.validation ?? result.verification ?? result.recalculation ?? result.data;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Executed ${definition.id} operation ${operation}.`,
      facts: [`toolId=${definition.id}`, ...pathFacts, ...(detail === undefined ? [] : [`Result: ${textPreview(detail)}`])],
      data: {
        kind: definition.id,
        operation,
        ...(typeof result.inputPath === "string" ? { inputPath: result.inputPath } : {}),
        ...(typeof result.outputPath === "string" ? { outputPath: result.outputPath } : {}),
        ...(detail === undefined ? {} : { detailPreview: textPreview(detail) }),
        ...(typeof result.count === "number" ? { count: result.count } : {}),
      },
    });
  }

  if (definition.id === "ask_external_expert") {
    const status = typeof result.status === "string" ? result.status : "completed";
    const latencyMs = typeof result.latencyMs === "number" ? result.latencyMs : undefined;
    return baseEvidence({ result, isError: normalized.isError, actionTaken: "Received advice from the configured external expert.", facts: ["tool=ask_external_expert", `status=${status}`, ...(latencyMs === undefined ? [] : [`latencyMs=${latencyMs}`])], data: result });
  }

  if (definition.id === "codebase_explore") {
    const verified = asRecord(result.verifiedEvidenceInput);
    const retrieval = asRecord(result.retrievalEvidence);
    const nestedExplore = asRecord(result.exploreResult);
    const verificationResult = asRecord(result.verificationResult);
    const trace = asRecord(result.trace);
    const degraded = result.degraded === true || nestedExplore?.degraded === true;
    const query =
      typeof result.query === "string"
        ? result.query
        : typeof retrieval?.query === "string"
          ? retrieval.query
          : typeof verified?.query === "string"
            ? verified.query
            : "";
    const verifiedChunkCount =
      typeof retrieval?.chunkCount === "number"
        ? retrieval.chunkCount
        : typeof verified?.chunkCount === "number"
          ? verified.chunkCount
          : 0;
    const runtimeMode =
      typeof trace?.runtimeMode === "string"
        ? trace.runtimeMode
        : degraded
          ? "unavailable"
          : "unknown";
    const workspaceRoot =
      typeof result.workspaceRoot === "string" ? result.workspaceRoot : undefined;
    const fallbackSignal =
      typeof result.fallbackSignal === "string"
        ? result.fallbackSignal
        : asRecord(nestedExplore?.fallbackSignal);
    const fallbackRequired =
      degraded || result.partial === true || asRecord(fallbackSignal)?.required === true;
    const fallbackReason =
      typeof fallbackSignal === "string"
        ? fallbackSignal
        : typeof asRecord(fallbackSignal)?.reason === "string"
          ? String(asRecord(fallbackSignal)?.reason)
          : undefined;
    const exploreStatus =
      typeof nestedExplore?.status === "string" ? nestedExplore.status : undefined;
    const verifiedCandidateCount =
      typeof verificationResult?.verifiedCount === "number"
        ? verificationResult.verifiedCount
        : undefined;
    const rejectedCandidateCount =
      typeof verificationResult?.rejectedCount === "number"
        ? verificationResult.rejectedCount
        : undefined;
    const unverifiableCandidateCount =
      typeof verificationResult?.unverifiableCount === "number"
        ? verificationResult.unverifiableCount
        : undefined;

    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: degraded
        ? `Attempted controlled CodeGraph exploration for "${query}".`
        : `Codebase explore verified ${verifiedChunkCount} workspace chunk(s) for "${query}".`,
      facts: [
        "capabilityId=codebase_explore",
        `degraded=${degraded}`,
        `verifiedChunkCount=${verifiedChunkCount}`,
        `runtimeMode=${runtimeMode}`,
        ...(verifiedCandidateCount === undefined
          ? []
          : [`verifiedCandidateCount=${verifiedCandidateCount}`]),
        ...(rejectedCandidateCount === undefined
          ? []
          : [`rejectedCandidateCount=${rejectedCandidateCount}`]),
        ...(unverifiableCandidateCount === undefined
          ? []
          : [`unverifiableCandidateCount=${unverifiableCandidateCount}`]),
        ...(exploreStatus ? [`exploreStatus=${exploreStatus}`] : []),
        ...(fallbackReason ? [`fallbackReason=${fallbackReason}`] : []),
      ],
      gaps: fallbackRequired
        ? [
            "Codebase exploration returned partial evidence.",
            ...(fallbackReason ? [`CodeGraph fallback reason: ${fallbackReason}`] : []),
          ]
        : undefined,
      status: fallbackRequired ? "partial" : undefined,
      data: {
        kind: "codebase_explore",
        runtimeMode,
        ...(workspaceRoot ? { workspaceRoot } : {}),
        query,
        verifiedChunkCount,
        fallbackRequired,
      },
    });
  }

  const bounded = boundedStructuredPreview(result);
  return baseEvidence({
    result,
    isError: normalized.isError,
    actionTaken: `${definition.id} returned structured data.`,
    facts: [`resultKeys=${Object.keys(result).join(",")}`],
    gaps: normalized.isError ? ["The tool reported an error outcome."] : undefined,
    data: {
      kind: "generic_structured",
      preview: bounded.preview,
      truncated: bounded.truncated,
      redacted: bounded.redacted,
      unsupported: bounded.unsupported,
    },
  });
};
