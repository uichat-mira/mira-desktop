import { mcpBadRequest } from "../core/errors.js";
import {
  nodeFileMutationFilesystem,
  type FileMutationFilesystem,
} from "./filesystem.js";
import {
  isCaseOnlyMutationRename,
  isSameMutationIdentity,
  resolveMutationPath,
  type ResolvedMutationPath,
} from "./path-policy.js";
import {
  normalizeMutationLockKey,
  withMutationLocks,
} from "./locks.js";
import { readMutationTextFile } from "./text.js";
import {
  executeDeleteMutation,
  executeMoveMutation,
  executeWriteMutation,
  type FileMutationRuntimeContext,
} from "./runtime.js";
import type {
  ApplyPatchChunk,
  ApplyPatchHunk,
  ParsedApplyPatch,
} from "./apply-patch-parser.js";
import type {
  DeleteMutationResult,
  MoveMutationResult,
  WriteMutationResult,
} from "./runtime.js";

export type ApplyPatchCommittedMutation =
  | WriteMutationResult
  | MoveMutationResult
  | DeleteMutationResult;

export type ApplyPatchCommittedStep = {
  hunkIndex: number;
  hunkType: ApplyPatchHunk["type"];
  path: string;
  destinationPath?: string;
  mutation: ApplyPatchCommittedMutation;
};

export type ApplyPatchFailure = {
  hunkIndex: number;
  hunkType: ApplyPatchHunk["type"];
  path: string;
  destinationPath?: string;
  stage: "add" | "update" | "move" | "delete";
  message: string;
};

export type ApplyPatchExecutionResult = {
  operation: "apply_patch";
  status: "completed" | "partial" | "failed";
  changed: boolean | "unknown";
  hunkCount: number;
  committed: ApplyPatchCommittedStep[];
  failed?: ApplyPatchFailure;
  unapplied: Array<{
    hunkIndex: number;
    hunkType: ApplyPatchHunk["type"];
    path: string;
    destinationPath?: string;
  }>;
  committedDeltaExact: boolean;
};

type HunkPreflight = {
  hunk: ApplyPatchHunk;
  hunkIndex: number;
  source: ResolvedMutationPath;
  destination?: ResolvedMutationPath;
};

type PreparedHunk = {
  hunk: ApplyPatchHunk;
  hunkIndex: number;
  replacementContent?: string;
};

const canonicalLine = (value: string) =>
  value
    .replace(/[\t \f\v\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/gu, " ")
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[“”„‟]/gu, '"')
    .replace(/[‐‑‒–—―−]/gu, "-");

const lineMatches = (actual: string, expected: string) =>
  actual === expected || canonicalLine(actual) === canonicalLine(expected);

const splitNormalizedLines = (text: string) => {
  const normalized = text.replace(/\r\n|\r/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const lines =
    normalized.length === 0
      ? []
      : normalized.split("\n");
  if (hasTrailingNewline) lines.pop();
  return { normalized, lines, hasTrailingNewline };
};

const sequenceMatchesAt = (
  lines: string[],
  pattern: string[],
  index: number,
) =>
  pattern.every((line, offset) =>
    lineMatches(lines[index + offset] ?? "", line),
  );

const findLine = (
  lines: string[],
  expected: string,
  startIndex: number,
) => {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lineMatches(lines[index]!, expected)) return index;
  }
  return -1;
};

const findSequence = (input: {
  lines: string[];
  pattern: string[];
  startIndex: number;
  endOfFile: boolean;
}) => {
  if (input.pattern.length === 0) {
    return input.endOfFile ? input.lines.length : input.startIndex;
  }

  if (input.endOfFile) {
    const index = input.lines.length - input.pattern.length;
    return index >= input.startIndex &&
      sequenceMatchesAt(input.lines, input.pattern, index)
      ? index
      : -1;
  }

  for (
    let index = input.startIndex;
    index <= input.lines.length - input.pattern.length;
    index += 1
  ) {
    if (sequenceMatchesAt(input.lines, input.pattern, index)) return index;
  }
  return -1;
};

const lineStarts = (normalized: string, lines: string[]) => {
  const starts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    starts.push(cursor);
    cursor += line.length;
    if (normalized[cursor] === "\n") cursor += 1;
  }
  return starts;
};

const segmentForLines = (input: {
  normalized: string;
  starts: number[];
  lineCount: number;
  startLine: number;
  endLine: number;
}) => {
  const start =
    input.startLine < input.lineCount
      ? input.starts[input.startLine]!
      : input.normalized.length;
  const end =
    input.endLine < input.lineCount
      ? input.starts[input.endLine]!
      : input.normalized.length;
  return {
    start,
    end,
    text: input.normalized.slice(start, end),
  };
};

const buildReplacement = (input: {
  newLines: string[];
  preserveTrailingSeparator: boolean;
}) =>
  input.newLines.join("\n") +
  (input.preserveTrailingSeparator && input.newLines.length > 0 ? "\n" : "");

const deriveChunkReplacement = (input: {
  chunk: ApplyPatchChunk;
  source: ReturnType<typeof splitNormalizedLines>;
  starts: number[];
  cursor: number;
}): {
  start: number;
  end: number;
  replacement: string;
  startLine: number;
  endLine: number;
  nextCursor: number;
} => {
  let searchStart = input.cursor;
  if (input.chunk.changeContext) {
    const contextIndex = findLine(
      input.source.lines,
      input.chunk.changeContext,
      searchStart,
    );
    if (contextIndex < 0) {
      throw mcpBadRequest(
        `apply_patch context was not found: ${input.chunk.changeContext}`,
      );
    }
    searchStart = contextIndex + 1;
  }

  const hasAnchor =
    input.chunk.oldLines.length > 0 || Boolean(input.chunk.changeContext);
  const matchIndex = findSequence({
    lines: input.source.lines,
    pattern: input.chunk.oldLines,
    startIndex:
      !hasAnchor && !input.chunk.isEndOfFile
        ? input.source.lines.length
        : searchStart,
    endOfFile: input.chunk.isEndOfFile || !hasAnchor,
  });
  if (matchIndex < 0) {
    throw mcpBadRequest("apply_patch update context did not match the target file");
  }

  const oldCount = input.chunk.oldLines.length;
  const endLine = matchIndex + oldCount;
  const segment = segmentForLines({
    normalized: input.source.normalized,
    starts: input.starts,
    lineCount: input.source.lines.length,
    startLine: matchIndex,
    endLine,
  });
  const preserveTrailingSeparator =
    endLine < input.source.lines.length ||
    (endLine === input.source.lines.length && input.source.hasTrailingNewline);
  const replacement = buildReplacement({
    newLines: input.chunk.newLines,
    preserveTrailingSeparator,
  });

  return {
    start: segment.start,
    end: segment.end,
    replacement,
    startLine: matchIndex,
    endLine,
    nextCursor: Math.max(endLine, matchIndex),
  };
};

const deriveUpdate = (
  sourceText: string,
  chunks: ApplyPatchChunk[],
): {
  content: string;
  changed: boolean;
} => {
  const source = splitNormalizedLines(sourceText);
  const starts = lineStarts(source.normalized, source.lines);
  const replacements: Array<{
    start: number;
    end: number;
    replacement: string;
    startLine: number;
    endLine: number;
  }> = [];
  let cursor = 0;

  for (const chunk of chunks) {
    const derived = deriveChunkReplacement({
      chunk,
      source,
      starts,
      cursor,
    });
    cursor = Math.max(cursor, derived.nextCursor);

    for (const range of replacements) {
      if (
        derived.start < range.end &&
        derived.end > range.start
      ) {
        throw mcpBadRequest("apply_patch update chunks must not overlap");
      }
      if (
        derived.start === derived.end &&
        range.start === range.end &&
        derived.start === range.start
      ) {
        throw mcpBadRequest("apply_patch update chunks must not share an insertion point");
      }
    }

    replacements.push(derived);
  }

  let content = source.normalized;
  for (const item of [...replacements].sort((left, right) => right.start - left.start)) {
    content =
      content.slice(0, item.start) +
      item.replacement +
      content.slice(item.end);
  }

  return {
    content,
    changed: content !== source.normalized,
  };
};

const assertStablePreflight = (
  before: ResolvedMutationPath,
  after: ResolvedMutationPath,
) => {
  if (
    !isSameMutationIdentity(before, after) ||
    before.exists !== after.exists ||
    before.type !== after.type
  ) {
    throw mcpBadRequest("apply_patch target changed while waiting for batch lock");
  }
};

const preflightPatch = (
  parsed: ParsedApplyPatch,
  filesystem: FileMutationFilesystem,
): {
  hunks: HunkPreflight[];
  lockPaths: string[];
} => {
  const hunks: HunkPreflight[] = parsed.hunks.map((hunk, hunkIndex) => {
    const source = resolveMutationPath(hunk.path, filesystem);
    const destination =
      hunk.type === "update" && hunk.movePath
        ? resolveMutationPath(hunk.movePath, filesystem)
        : undefined;
    return {
      hunk,
      hunkIndex,
      source,
      ...(destination ? { destination } : {}),
    };
  });

  const claimed = new Map<string, number>();
  for (const item of hunks) {
    const paths = [item.source, ...(item.destination ? [item.destination] : [])];
    for (const resolved of paths) {
      const key = normalizeMutationLockKey(resolved.canonicalPath);
      const previous = claimed.get(key);
      if (previous !== undefined && previous !== item.hunkIndex) {
        throw mcpBadRequest(
          "apply_patch contains multiple hunks for the same resolved mutation path",
        );
      }
      claimed.set(key, item.hunkIndex);
    }
  }

  return {
    hunks,
    lockPaths: [...claimed.keys()],
  };
};

const validateAndPrepare = (
  preflight: HunkPreflight[],
  filesystem: FileMutationFilesystem,
): PreparedHunk[] =>
  preflight.map((item) => {
    const current = resolveMutationPath(item.hunk.path, filesystem);
    assertStablePreflight(item.source, current);

    if (item.hunk.type === "add") {
      if (current.exists) {
        throw mcpBadRequest(
          `apply_patch Add File target already exists: ${item.hunk.path}`,
        );
      }
      return {
        hunk: item.hunk,
        hunkIndex: item.hunkIndex,
      };
    }

    if (!current.exists || current.type !== "file") {
      throw mcpBadRequest(
        `apply_patch ${item.hunk.type} target must be an existing file: ${item.hunk.path}`,
      );
    }

    if (item.hunk.type === "delete") {
      return {
        hunk: item.hunk,
        hunkIndex: item.hunkIndex,
      };
    }

    if (item.destination) {
      const destination = resolveMutationPath(
        item.hunk.movePath!,
        filesystem,
      );
      assertStablePreflight(item.destination, destination);
      const caseOnly = isCaseOnlyMutationRename(current, destination);
      if (destination.exists && !caseOnly) {
        throw mcpBadRequest(
          `apply_patch Move target already exists: ${item.hunk.movePath}`,
        );
      }
    }

    const sourceText = readMutationTextFile(
      current.canonicalPath,
      filesystem,
    ).text;
    const derived = deriveUpdate(sourceText, item.hunk.chunks);
    return {
      hunk: item.hunk,
      hunkIndex: item.hunkIndex,
      ...(derived.changed ? { replacementContent: derived.content } : {}),
    };
  });

const summarizeUnapplied = (
  prepared: PreparedHunk[],
  failedIndex: number,
) =>
  prepared
    .filter((item) => item.hunkIndex > failedIndex)
    .map((item) => ({
      hunkIndex: item.hunkIndex,
      hunkType: item.hunk.type,
      path: item.hunk.path,
      ...(item.hunk.type === "update" && item.hunk.movePath
        ? { destinationPath: item.hunk.movePath }
        : {}),
    }));

export const executeApplyPatchMutation = async (
  parsed: ParsedApplyPatch,
  context: FileMutationRuntimeContext = {},
): Promise<ApplyPatchExecutionResult> => {
  const filesystem = context.filesystem ?? nodeFileMutationFilesystem;
  const preflight = preflightPatch(parsed, filesystem);

  return await withMutationLocks(
    preflight.lockPaths,
    context.signal,
    async (lockScope) => {
      const prepared = validateAndPrepare(preflight.hunks, filesystem);
      const committed: ApplyPatchCommittedStep[] = [];
      const batchContext: FileMutationRuntimeContext = {
        ...context,
        filesystem,
        lockScope,
      };

      for (const item of prepared) {
        let stage: ApplyPatchFailure["stage"] =
          item.hunk.type === "add"
            ? "add"
            : item.hunk.type === "delete"
              ? "delete"
              : "update";
        try {
          if (item.hunk.type === "add") {
            const mutation = await executeWriteMutation(
              {
                path: item.hunk.path,
                content: item.hunk.contents,
              },
              batchContext,
            );
            committed.push({
              hunkIndex: item.hunkIndex,
              hunkType: item.hunk.type,
              path: item.hunk.path,
              mutation,
            });
            continue;
          }

          if (item.hunk.type === "delete") {
            const mutation = await executeDeleteMutation(
              { path: item.hunk.path },
              batchContext,
            );
            committed.push({
              hunkIndex: item.hunkIndex,
              hunkType: item.hunk.type,
              path: item.hunk.path,
              mutation,
            });
            continue;
          }

          if (item.replacementContent !== undefined) {
            const mutation = await executeWriteMutation(
              {
                path: item.hunk.path,
                content: item.replacementContent,
                overwrite: true,
              },
              batchContext,
            );
            committed.push({
              hunkIndex: item.hunkIndex,
              hunkType: item.hunk.type,
              path: item.hunk.path,
              ...(item.hunk.movePath
                ? { destinationPath: item.hunk.movePath }
                : {}),
              mutation,
            });
          }

          if (item.hunk.movePath) {
            stage = "move";
            const mutation = await executeMoveMutation(
              {
                path: item.hunk.path,
                destinationPath: item.hunk.movePath,
              },
              batchContext,
            );
            committed.push({
              hunkIndex: item.hunkIndex,
              hunkType: item.hunk.type,
              path: item.hunk.path,
              destinationPath: item.hunk.movePath,
              mutation,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            operation: "apply_patch",
            status: committed.length > 0 ? "partial" : "failed",
            changed: committed.length > 0 ? true : "unknown",
            hunkCount: prepared.length,
            committed,
            failed: {
              hunkIndex: item.hunkIndex,
              hunkType: item.hunk.type,
              path: item.hunk.path,
              ...(item.hunk.type === "update" && item.hunk.movePath
                ? { destinationPath: item.hunk.movePath }
                : {}),
              stage,
              message,
            },
            unapplied: summarizeUnapplied(prepared, item.hunkIndex),
            // The failed runtime operation may have reached its OS commit point
            // before surfacing an I/O error. Earlier returned results are
            // definitely committed; the failed operation is conservatively
            // marked uncertain instead of inventing rollback semantics.
            committedDeltaExact: false,
          };
        }
      }

      return {
        operation: "apply_patch",
        status: "completed",
        changed: committed.length > 0,
        hunkCount: prepared.length,
        committed,
        unapplied: [],
        committedDeltaExact: true,
      };
    },
  );
};
