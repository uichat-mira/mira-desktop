export const HARNESS_LLM_RESULT_CHAR_LIMIT = 24_000;
export const HARNESS_LLM_MAX_DEPTH = 12;
export const HARNESS_LLM_MAX_ARRAY_ITEMS = 200;
export const HARNESS_LLM_MAX_OBJECT_KEYS = 200;
export const HARNESS_LLM_MAX_STRING_CHARS = 20_000;

export interface HarnessLlmTextBlock {
  type: "text";
  text: string;
}

export interface HarnessLlmImageBlock {
  type: "image";
  data: string;
  mimeType: string;
  filename?: string;
}

export type HarnessLlmBlock = HarnessLlmTextBlock | HarnessLlmImageBlock;

export interface HarnessLlmContent {
  version: 1;
  source: "harness_result";
  blocks: HarnessLlmBlock[];
  truncated: boolean;
  originalCharCount: number;
  includedCharCount: number;
  omittedArrayItems: number;
  omittedObjectKeys: number;
  collectionPath?: string;
  collectionItemCount?: number;
}

type ProjectionStats = {
  omittedArrayItems: number;
  omittedObjectKeys: number;
  structuralTruncation: boolean;
  budgetTruncation: boolean;
};

type ArrayCandidate = {
  value: unknown[];
  path: string[];
};

const tryParseJsonText = (value: string): unknown => {
  const text = value.trim();
  if (
    text.length < 2 ||
    !(
      (text.startsWith("{") && text.endsWith("}")) ||
      (text.startsWith("[") && text.endsWith("]"))
    )
  ) {
    return value;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
};

const findPrimaryArray = (
  value: unknown,
  depth = 0,
  path: string[] = [],
  seen = new WeakSet<object>(),
): ArrayCandidate | null => {
  if (depth > 6 || !value || typeof value !== "object") {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  let best: ArrayCandidate | null = Array.isArray(value)
    ? { value, path }
    : null;
  const entries = Array.isArray(value)
    ? value.slice(0, HARNESS_LLM_MAX_ARRAY_ITEMS).map((item, index) => [String(index), item] as const)
    : Object.entries(value).slice(0, HARNESS_LLM_MAX_OBJECT_KEYS);

  for (const [key, child] of entries) {
    const candidate = findPrimaryArray(child, depth + 1, [...path, key], seen);
    if (candidate && (!best || candidate.value.length > best.value.length)) {
      best = candidate;
    }
  }

  return best && best.value.length > 1 ? best : null;
};

const projectValue = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  stats: ProjectionStats,
  primaryArray?: unknown[],
  primaryArrayPath?: string,
): unknown => {
  if (value === primaryArray) {
    return `[${primaryArray!.length} item(s) projected separately from ${primaryArrayPath || "root"}]`;
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string") {
    const parsed = tryParseJsonText(value);
    if (parsed !== value) {
      return projectValue(
        parsed,
        depth,
        seen,
        stats,
        primaryArray,
        primaryArrayPath,
      );
    }
    if (value.length <= HARNESS_LLM_MAX_STRING_CHARS) {
      return value;
    }
    stats.structuralTruncation = true;
    return `${value.slice(0, HARNESS_LLM_MAX_STRING_CHARS)}\n...[string truncated; originalCharCount=${value.length}]`;
  }

  if (typeof value === "undefined") {
    return "[undefined]";
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }

  if (depth >= HARNESS_LLM_MAX_DEPTH) {
    stats.structuralTruncation = true;
    return "[max depth reached]";
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[circular reference]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const projected = value
      .slice(0, HARNESS_LLM_MAX_ARRAY_ITEMS)
      .map((item) =>
        projectValue(
          item,
          depth + 1,
          seen,
          stats,
          primaryArray,
          primaryArrayPath,
        ),
      );
    if (value.length > HARNESS_LLM_MAX_ARRAY_ITEMS) {
      const omitted = value.length - HARNESS_LLM_MAX_ARRAY_ITEMS;
      stats.omittedArrayItems += omitted;
      stats.structuralTruncation = true;
      projected.push(`[${omitted} array item(s) omitted]`);
    }
    return projected;
  }

  const entries = Object.entries(value);
  const projected: Record<string, unknown> = {};
  for (const [key, entryValue] of entries.slice(0, HARNESS_LLM_MAX_OBJECT_KEYS)) {
    projected[key] = projectValue(
      entryValue,
      depth + 1,
      seen,
      stats,
      primaryArray,
      primaryArrayPath,
    );
  }
  if (entries.length > HARNESS_LLM_MAX_OBJECT_KEYS) {
    const omitted = entries.length - HARNESS_LLM_MAX_OBJECT_KEYS;
    stats.omittedObjectKeys += omitted;
    stats.structuralTruncation = true;
    projected.__omittedKeys = omitted;
  }
  return projected;
};

const serializeProjectedValue = (
  value: unknown,
  stats: ProjectionStats,
  primaryArray?: unknown[],
  primaryArrayPath?: string,
): string => {
  try {
    const projected = projectValue(
      value,
      0,
      new WeakSet<object>(),
      stats,
      primaryArray,
      primaryArrayPath,
    );
    return typeof projected === "string"
      ? projected
      : JSON.stringify(projected, null, 2) ?? "[unserializable result]";
  } catch (error) {
    stats.structuralTruncation = true;
    return `[Harness result serialization failed: ${
      error instanceof Error ? error.message : String(error)
    }]`;
  }
};

const boundText = (
  text: string,
  limit: number,
  stats: ProjectionStats,
  marker: string,
) => {
  if (text.length <= limit) {
    return text;
  }
  stats.budgetTruncation = true;
  const boundedLength = Math.max(0, limit - marker.length);
  return `${text.slice(0, boundedLength).trimEnd()}${marker}`;
};

const serializeCollectionFairly = (
  result: unknown,
  candidate: ArrayCandidate,
  charLimit: number,
  stats: ProjectionStats,
) => {
  const collectionPath = candidate.path.length ? candidate.path.join(".") : "root";
  const selectedItems = candidate.value.slice(0, HARNESS_LLM_MAX_ARRAY_ITEMS);
  if (candidate.value.length > selectedItems.length) {
    const omitted = candidate.value.length - selectedItems.length;
    stats.omittedArrayItems += omitted;
    stats.structuralTruncation = true;
  }

  const metadataRaw = serializeProjectedValue(
    result,
    stats,
    candidate.value,
    collectionPath,
  );
  const metadataBudget = Math.min(4_000, Math.max(800, Math.floor(charLimit * 0.2)));
  const metadata = boundText(
    metadataRaw,
    metadataBudget,
    stats,
    "\n...[collection metadata clipped]",
  );
  const collectionHeader = [
    `collectionPath: ${collectionPath}`,
    `collectionItemCount: ${candidate.value.length}`,
    `includedCollectionItems: ${selectedItems.length}`,
    "collectionItems:",
  ].join("\n");
  const itemHeaders = selectedItems.map(
    (_item, index) => `[${index + 1}/${candidate.value.length}]`,
  );
  const fixedChars =
    metadata.length +
    collectionHeader.length +
    itemHeaders.reduce((sum, header) => sum + header.length + 2, 0) +
    selectedItems.length * 2;
  const availableForItems = Math.max(0, charLimit - fixedChars);
  const perItemBudget = selectedItems.length
    ? Math.max(32, Math.floor(availableForItems / selectedItems.length))
    : 0;
  const itemSections = selectedItems.map((item, index) => {
    const raw = serializeProjectedValue(item, stats);
    const bounded = boundText(raw, perItemBudget, stats, "...[item clipped]");
    return `${itemHeaders[index]}\n${bounded}`;
  });

  const omittedMarker =
    candidate.value.length > selectedItems.length
      ? `\n[${candidate.value.length - selectedItems.length} collection item(s) omitted]`
      : "";
  const text = [metadata, collectionHeader, ...itemSections].join("\n\n") + omittedMarker;
  return {
    text: boundText(
      text,
      charLimit,
      stats,
      "\n...[Harness collection result clipped by total LLM budget]",
    ),
    collectionPath,
    collectionItemCount: candidate.value.length,
    originalCharCount:
      metadataRaw.length +
      selectedItems.reduce<number>(
        (sum: number, item: unknown) => sum + serializeProjectedValue(item, {
          omittedArrayItems: 0,
          omittedObjectKeys: 0,
          structuralTruncation: false,
          budgetTruncation: false,
        }).length,
        0,
      ),
  };
};

export const projectHarnessResultForLlm = (
  result: unknown,
  charLimit = HARNESS_LLM_RESULT_CHAR_LIMIT,
): HarnessLlmContent | undefined => {
  if (typeof result === "undefined" || charLimit <= 0) {
    return undefined;
  }

  const normalizedResult =
    typeof result === "string" ? tryParseJsonText(result) : result;
  const stats: ProjectionStats = {
    omittedArrayItems: 0,
    omittedObjectKeys: 0,
    structuralTruncation: false,
    budgetTruncation: false,
  };
  const primaryArray = findPrimaryArray(normalizedResult);
  let text: string;
  let originalCharCount: number;
  let collectionPath: string | undefined;
  let collectionItemCount: number | undefined;

  if (primaryArray) {
    const projected = serializeCollectionFairly(
      normalizedResult,
      primaryArray,
      charLimit,
      stats,
    );
    text = projected.text;
    originalCharCount = projected.originalCharCount;
    collectionPath = projected.collectionPath;
    collectionItemCount = projected.collectionItemCount;
  } else {
    const serialized = serializeProjectedValue(normalizedResult, stats);
    originalCharCount = serialized.length;
    text = boundText(
      serialized,
      charLimit,
      stats,
      `\n...[Harness result truncated by LLM budget; originalCharCount=${serialized.length}]`,
    );
  }

  const truncated = stats.structuralTruncation || stats.budgetTruncation;
  const metadata = [
    `truncated=${truncated}`,
    `originalCharCount=${originalCharCount}`,
    `includedCharCount=${text.length}`,
    `omittedArrayItems=${stats.omittedArrayItems}`,
    `omittedObjectKeys=${stats.omittedObjectKeys}`,
    ...(collectionPath ? [`collectionPath=${collectionPath}`] : []),
    ...(typeof collectionItemCount === "number"
      ? [`collectionItemCount=${collectionItemCount}`]
      : []),
  ].join("\n");

  return {
    version: 1,
    source: "harness_result",
    blocks: [
      {
        type: "text",
        text: [metadata, "result:", text || "(empty result)"].join("\n"),
      },
    ],
    truncated,
    originalCharCount,
    includedCharCount: text.length,
    omittedArrayItems: stats.omittedArrayItems,
    omittedObjectKeys: stats.omittedObjectKeys,
    ...(collectionPath ? { collectionPath } : {}),
    ...(typeof collectionItemCount === "number"
      ? { collectionItemCount }
      : {}),
  };
};

export const projectHarnessContentForLlm = (
  content: Array<{ type: string; [key: string]: unknown }> | undefined,
  charLimit = HARNESS_LLM_RESULT_CHAR_LIMIT,
): HarnessLlmContent | undefined => {
  if (!content?.length) return undefined;

  const imageBlocks: HarnessLlmImageBlock[] = content.flatMap((block) => {
    if (
      block.type !== "image" ||
      typeof block.data !== "string" ||
      !block.data ||
      typeof block.mimeType !== "string" ||
      !block.mimeType
    ) {
      return [];
    }
    return [
      {
        type: "image" as const,
        data: block.data,
        mimeType: block.mimeType,
        ...(typeof block.filename === "string" && block.filename
          ? { filename: block.filename }
          : {}),
      },
    ];
  });

  const textualBlocks = content.filter((block) => block.type !== "image");
  const projectedText =
    textualBlocks.length === 0
      ? undefined
      : textualBlocks.every(
            (block) => block.type === "text" && typeof block.text === "string",
          )
        ? projectHarnessResultForLlm(
            textualBlocks.map((block) => block.text as string).join("\n\n"),
            charLimit,
          )
        : projectHarnessResultForLlm(
            textualBlocks.map((block) => {
              if (block.type === "text" && typeof block.text === "string") {
                return block.text;
              }
              if (block.type === "json" && "json" in block) {
                return block.json;
              }
              const { data: _data, blob: _blob, ...rest } = block;
              return rest;
            }),
            charLimit,
          );

  if (!projectedText && imageBlocks.length === 0) {
    return undefined;
  }

  return {
    version: 1,
    source: "harness_result",
    blocks: [...(projectedText?.blocks ?? []), ...imageBlocks],
    truncated: projectedText?.truncated ?? false,
    originalCharCount: projectedText?.originalCharCount ?? 0,
    includedCharCount: projectedText?.includedCharCount ?? 0,
    omittedArrayItems: projectedText?.omittedArrayItems ?? 0,
    omittedObjectKeys: projectedText?.omittedObjectKeys ?? 0,
    ...(projectedText?.collectionPath
      ? { collectionPath: projectedText.collectionPath }
      : {}),
    ...(typeof projectedText?.collectionItemCount === "number"
      ? { collectionItemCount: projectedText.collectionItemCount }
      : {}),
  };
};

export const getHarnessLlmContentText = (
  content: HarnessLlmContent | undefined,
) =>
  content?.blocks
    .filter(
      (block): block is HarnessLlmTextBlock =>
        block.type === "text" && block.text.trim().length > 0,
    )
    .map((block) => block.text)
    .join("\n\n") ?? "";

export const projectHarnessTextOnlyContent = (
  content: HarnessLlmContent | undefined,
): HarnessLlmContent | undefined => {
  if (!content) return undefined;
  const blocks = content.blocks.filter(
    (block): block is HarnessLlmTextBlock => block.type === "text",
  );
  return blocks.length > 0 ? { ...content, blocks } : undefined;
};

export const getHarnessLlmContentImages = (
  content: HarnessLlmContent | undefined,
) =>
  content?.blocks.filter(
    (block): block is HarnessLlmImageBlock => block.type === "image",
  ) ?? [];
