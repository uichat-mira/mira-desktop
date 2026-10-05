import path from "node:path";
import type { ToolInvocationEventInput } from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { commitFileBuffer, replaceDirectorySafely } from "./commit.js";
import {
  nodeFileMutationFilesystem,
  type FileMutationFilesystem,
} from "./filesystem.js";
import { withMutationLocks } from "./locks.js";
import {
  assertMutationPathVersion,
  assertStableMutationPath,
  captureMutationPathVersion,
  isSameMutationIdentity,
  resolveMutationPath,
  type ResolvedMutationPath,
} from "./path-policy.js";
import {
  adaptLineEndings,
  encodeMutationText,
  inspectMutationTextFormat,
  readMutationTextFile,
  type MutationLineEnding,
} from "./text.js";

export type FileMutationRuntimeContext = {
  signal?: AbortSignal;
  pushEvent?: (event: ToolInvocationEventInput) => void;
  filesystem?: FileMutationFilesystem;
};

export type WriteMutationInput = {
  path: string;
  content: string;
  overwrite?: boolean;
};

export type EditMutation = {
  oldText: string;
  newText: string;
};

export type EditMutationInput = {
  path: string;
  edits: EditMutation[];
};

export type MoveMutationInput = {
  path: string;
  destinationPath: string;
  overwrite?: boolean;
};

export type DeleteMutationInput = {
  path: string;
  recursive?: boolean;
};

export type WriteMutationResult = {
  operation: "write";
  path: string;
  created: boolean;
  overwritten: boolean;
  bytes: number;
};

export type EditMutationResult = {
  operation: "edit";
  path: string;
  editsApplied: number;
  bytes: number;
};

export type MoveMutationResult = {
  operation: "move";
  path: string;
  destinationPath: string;
  overwritten: boolean;
};

export type DeleteMutationResult = {
  operation: "delete";
  path: string;
  deletedType: "file" | "directory";
  recursive: boolean;
};

const assertNotAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw mcpBadRequest("file mutation was cancelled before commit");
  }
};

const requireNonEmptyPath = (value: string, field: string) => {
  if (!value.trim()) {
    throw mcpBadRequest(`${field} is required`);
  }
  return value.trim();
};

const mutationFilesystem = (context: FileMutationRuntimeContext) =>
  context.filesystem ?? nodeFileMutationFilesystem;

const preparePath = (
  inputPath: string,
  filesystem: FileMutationFilesystem,
  options: {
    mustExist?: boolean;
    expectedType?: "file" | "directory";
  } = {},
) => resolveMutationPath(inputPath, filesystem, options);

const wrapMutationFailure = (
  message: string,
  run: () => void,
) => {
  try {
    run();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "statusCode" in error
    ) {
      throw error;
    }
    throw mcpInternalError(message, { cause: error });
  }
};

export const executeWriteMutation = async (
  input: WriteMutationInput,
  context: FileMutationRuntimeContext = {},
): Promise<WriteMutationResult> => {
  const inputPath = requireNonEmptyPath(input.path, "path");
  const filesystem = mutationFilesystem(context);
  const preflight = preparePath(inputPath, filesystem);

  if (preflight.type === "directory") {
    throw mcpBadRequest("write does not support directory targets");
  }
  if (preflight.exists && input.overwrite !== true) {
    throw mcpBadRequest("path already exists; set overwrite=true to replace it");
  }

  return await withMutationLocks(
    [preflight.canonicalPath],
    context.signal,
    async () => {
      const current = preparePath(inputPath, filesystem);
      if (!isSameMutationIdentity(preflight, current)) {
        throw mcpBadRequest("file mutation target changed while waiting for lock");
      }

      if (current.type === "directory") {
        throw mcpBadRequest("write does not support directory targets");
      }
      if (current.exists && input.overwrite !== true) {
        throw mcpBadRequest(
          "path already exists; set overwrite=true to replace it",
        );
      }

      let existingVersion:
        | ReturnType<typeof captureMutationPathVersion>
        | undefined;
      let existingFormat:
        | ReturnType<typeof inspectMutationTextFormat>
        | null = null;

      if (current.exists) {
        existingVersion = captureMutationPathVersion(
          current.lexicalPath,
          filesystem,
        );
        existingFormat = inspectMutationTextFormat(
          current.lexicalPath,
          filesystem,
        );
        assertMutationPathVersion(
          existingVersion,
          current.lexicalPath,
          filesystem,
        );
      }

      const encoded = existingFormat
        ? encodeMutationText(input.content, existingFormat)
        : Buffer.from(input.content, "utf8");

      context.pushEvent?.({
        type: "invocation:progress",
        message: current.exists
          ? "Prepared atomic whole-file overwrite"
          : "Prepared atomic file create",
      });
      assertNotAborted(context.signal);

      // Creating missing parents is part of canonical write semantics. Re-check
      // the target afterwards so a path redirected through a changed symlink is
      // rejected before the commit attempt.
      filesystem.mkdir(path.dirname(current.lexicalPath));
      const beforeCommit = preparePath(inputPath, filesystem);
      assertStableMutationPath(current, beforeCommit);
      if (current.exists && existingVersion) {
        assertMutationPathVersion(
          existingVersion,
          beforeCommit.lexicalPath,
          filesystem,
        );
      }

      wrapMutationFailure(
        `Failed to commit workspace file: ${inputPath}`,
        () =>
          commitFileBuffer({
            targetPath: beforeCommit.lexicalPath,
            content: encoded,
            overwrite: beforeCommit.exists,
            filesystem,
          }),
      );

      return {
        operation: "write",
        path: inputPath,
        created: !beforeCommit.exists,
        overwritten: beforeCommit.exists,
        bytes: encoded.byteLength,
      };
    },
  );
};

type LocatedEdit = EditMutation & {
  start: number;
  end: number;
  match: "exact" | "tolerant";
};

type MatchMapEntry = {
  start: number;
  end: number;
};

const HORIZONTAL_WHITESPACE = /[\t \f\v\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u;

const canonicalizeMatchCharacter = (value: string) => {
  if ("‘’‚‛".includes(value)) return "'";
  if ("“”„‟".includes(value)) return '"';
  if ("‐‑‒–—―−".includes(value)) return "-";
  return value;
};

const normalizeLineForMatch = (
  line: string,
  baseOffset: number,
): { text: string; map: MatchMapEntry[] } => {
  let text = "";
  const map: MatchMapEntry[] = [];
  let pendingWhitespaceStart: number | null = null;
  let pendingWhitespaceEnd = -1;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (HORIZONTAL_WHITESPACE.test(character)) {
      if (text.length > 0) {
        pendingWhitespaceStart ??= baseOffset + index;
        pendingWhitespaceEnd = baseOffset + index + 1;
      }
      continue;
    }

    if (pendingWhitespaceStart !== null) {
      text += " ";
      map.push({
        start: pendingWhitespaceStart,
        end: pendingWhitespaceEnd,
      });
      pendingWhitespaceStart = null;
      pendingWhitespaceEnd = -1;
    }

    text += canonicalizeMatchCharacter(character);
    map.push({
      start: baseOffset + index,
      end: baseOffset + index + 1,
    });
  }

  return { text, map };
};

const normalizeForMatch = (value: string) => {
  let text = "";
  const map: MatchMapEntry[] = [];
  let cursor = 0;

  while (cursor <= value.length) {
    let lineEnd = cursor;
    while (
      lineEnd < value.length &&
      value[lineEnd] !== "\r" &&
      value[lineEnd] !== "\n"
    ) {
      lineEnd += 1;
    }

    const normalizedLine = normalizeLineForMatch(
      value.slice(cursor, lineEnd),
      cursor,
    );
    text += normalizedLine.text;
    map.push(...normalizedLine.map);

    if (lineEnd >= value.length) {
      break;
    }

    const newlineEnd =
      value[lineEnd] === "\r" && value[lineEnd + 1] === "\n"
        ? lineEnd + 2
        : lineEnd + 1;
    text += "\n";
    map.push({
      start: lineEnd,
      end: newlineEnd,
    });
    cursor = newlineEnd;
  }

  return { text, map };
};

const findAllMatches = (haystack: string, needle: string) => {
  const matches: number[] = [];
  let offset = 0;

  while (offset <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, offset);
    if (found < 0) {
      break;
    }
    matches.push(found);
    offset = found + 1;
  }

  return matches;
};

const locateEdit = (
  content: string,
  edit: EditMutation,
  index: number,
): LocatedEdit => {
  if (!edit.oldText.length) {
    throw mcpBadRequest(`edits[${index}].oldText must not be empty`);
  }

  const exactMatches = findAllMatches(content, edit.oldText);
  if (exactMatches.length > 1) {
    throw mcpBadRequest(`edits[${index}] target is ambiguous`);
  }
  if (exactMatches.length === 1) {
    const start = exactMatches[0];
    return {
      ...edit,
      start,
      end: start + edit.oldText.length,
      match: "exact",
    };
  }

  const normalizedContent = normalizeForMatch(content);
  const normalizedTarget = normalizeForMatch(edit.oldText).text;
  if (!normalizedTarget.length) {
    throw mcpBadRequest(`edits[${index}].oldText must contain visible text`);
  }

  const tolerantMatches = findAllMatches(
    normalizedContent.text,
    normalizedTarget,
  );
  if (tolerantMatches.length === 0) {
    throw mcpBadRequest(`edits[${index}] target was not found`);
  }
  if (tolerantMatches.length > 1) {
    throw mcpBadRequest(`edits[${index}] target is ambiguous`);
  }

  const normalizedStart = tolerantMatches[0];
  const normalizedEnd = normalizedStart + normalizedTarget.length - 1;
  const startEntry = normalizedContent.map[normalizedStart];
  const endEntry = normalizedContent.map[normalizedEnd];
  if (!startEntry || !endEntry) {
    throw mcpBadRequest(`edits[${index}] target was not found`);
  }

  return {
    ...edit,
    start: startEntry.start,
    end: endEntry.end,
    match: "tolerant",
  };
};

const validateNonOverlappingEdits = (edits: LocatedEdit[]) => {
  const ordered = [...edits].sort((left, right) => left.start - right.start);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].end) {
      throw mcpBadRequest("edit targets must not overlap");
    }
  }
  return ordered;
};

const applyLocatedEdits = (
  content: string,
  edits: LocatedEdit[],
  lineEnding: MutationLineEnding | null,
) => {
  let cursor = 0;
  let output = "";

  for (const edit of edits) {
    output += content.slice(cursor, edit.start);
    output += adaptLineEndings(edit.newText, lineEnding);
    cursor = edit.end;
  }

  return output + content.slice(cursor);
};

export const executeEditMutation = async (
  input: EditMutationInput,
  context: FileMutationRuntimeContext = {},
): Promise<EditMutationResult> => {
  const inputPath = requireNonEmptyPath(input.path, "path");
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw mcpBadRequest("edits must contain at least one edit");
  }

  const filesystem = mutationFilesystem(context);
  const preflight = preparePath(inputPath, filesystem, {
    mustExist: true,
    expectedType: "file",
  });

  return await withMutationLocks(
    [preflight.canonicalPath],
    context.signal,
    async () => {
      const current = preparePath(inputPath, filesystem, {
        mustExist: true,
        expectedType: "file",
      });
      if (!isSameMutationIdentity(preflight, current)) {
        throw mcpBadRequest("file mutation target changed while waiting for lock");
      }

      const version = captureMutationPathVersion(
        current.lexicalPath,
        filesystem,
      );
      const currentFile = readMutationTextFile(
        current.lexicalPath,
        filesystem,
      );
      assertMutationPathVersion(
        version,
        current.lexicalPath,
        filesystem,
      );

      const located = validateNonOverlappingEdits(
        input.edits.map((edit, index) =>
          locateEdit(currentFile.text, edit, index),
        ),
      );
      const next = applyLocatedEdits(
        currentFile.text,
        located,
        currentFile.lineEnding,
      );
      const encoded = encodeMutationText(next, currentFile);

      const tolerantCount = located.filter(
        (edit) => edit.match === "tolerant",
      ).length;
      context.pushEvent?.({
        type: "invocation:progress",
        message:
          tolerantCount > 0
            ? `Validated ${located.length} file edit(s), including ${tolerantCount} deterministic tolerant match(es)`
            : `Validated ${located.length} exact file edit(s)`,
      });
      assertNotAborted(context.signal);

      const beforeCommit = preparePath(inputPath, filesystem, {
        mustExist: true,
        expectedType: "file",
      });
      assertStableMutationPath(current, beforeCommit);
      assertMutationPathVersion(
        version,
        beforeCommit.lexicalPath,
        filesystem,
      );

      wrapMutationFailure(
        `Failed to commit workspace edit: ${inputPath}`,
        () =>
          commitFileBuffer({
            targetPath: beforeCommit.lexicalPath,
            content: encoded,
            overwrite: true,
            filesystem,
          }),
      );

      return {
        operation: "edit",
        path: inputPath,
        editsApplied: located.length,
        bytes: encoded.byteLength,
      };
    },
  );
};

const assertMoveOverwriteTypes = (
  source: ResolvedMutationPath,
  destination: ResolvedMutationPath,
) => {
  if (
    destination.exists &&
    source.type !== destination.type
  ) {
    throw mcpBadRequest(
      "move overwrite requires source and destination to have the same path type",
    );
  }
};

export const executeMoveMutation = async (
  input: MoveMutationInput,
  context: FileMutationRuntimeContext = {},
): Promise<MoveMutationResult> => {
  const sourcePath = requireNonEmptyPath(input.path, "path");
  const destinationPath = requireNonEmptyPath(
    input.destinationPath,
    "destinationPath",
  );
  const filesystem = mutationFilesystem(context);
  const sourcePreflight = preparePath(sourcePath, filesystem, {
    mustExist: true,
  });
  const destinationPreflight = preparePath(destinationPath, filesystem);

  if (isSameMutationIdentity(sourcePreflight, destinationPreflight)) {
    throw mcpBadRequest("path and destinationPath must be different");
  }
  assertMoveOverwriteTypes(sourcePreflight, destinationPreflight);
  if (destinationPreflight.exists && input.overwrite !== true) {
    throw mcpBadRequest(
      "destinationPath already exists; set overwrite=true to replace it",
    );
  }

  return await withMutationLocks(
    [sourcePreflight.canonicalPath, destinationPreflight.canonicalPath],
    context.signal,
    async () => {
      const source = preparePath(sourcePath, filesystem, {
        mustExist: true,
      });
      const destination = preparePath(destinationPath, filesystem);
      if (
        !isSameMutationIdentity(sourcePreflight, source) ||
        !isSameMutationIdentity(destinationPreflight, destination)
      ) {
        throw mcpBadRequest("file mutation target changed while waiting for lock");
      }
      assertMoveOverwriteTypes(source, destination);
      const sourceVersion = captureMutationPathVersion(
        source.lexicalPath,
        filesystem,
      );
      const destinationVersion = destination.exists
        ? captureMutationPathVersion(destination.lexicalPath, filesystem)
        : undefined;

      if (destination.exists && input.overwrite !== true) {
        throw mcpBadRequest(
          "destinationPath already exists; set overwrite=true to replace it",
        );
      }

      context.pushEvent?.({
        type: "invocation:progress",
        message: destination.exists
          ? "Prepared safe workspace move with destination replacement"
          : "Prepared workspace move",
      });
      assertNotAborted(context.signal);
      filesystem.mkdir(path.dirname(destination.lexicalPath));

      const sourceBeforeCommit = preparePath(sourcePath, filesystem, {
        mustExist: true,
      });
      const destinationBeforeCommit = preparePath(
        destinationPath,
        filesystem,
      );
      assertStableMutationPath(source, sourceBeforeCommit);
      assertStableMutationPath(destination, destinationBeforeCommit);
      assertMutationPathVersion(
        sourceVersion,
        sourceBeforeCommit.lexicalPath,
        filesystem,
      );
      if (destinationVersion) {
        assertMutationPathVersion(
          destinationVersion,
          destinationBeforeCommit.lexicalPath,
          filesystem,
        );
      }

      wrapMutationFailure(
        `Failed to move workspace target from ${sourcePath} to ${destinationPath}`,
        () => {
          if (
            destinationBeforeCommit.exists &&
            sourceBeforeCommit.type === "directory"
          ) {
            replaceDirectorySafely({
              sourcePath: sourceBeforeCommit.lexicalPath,
              destinationPath: destinationBeforeCommit.lexicalPath,
              filesystem,
            });
            return;
          }

          // rename never delete-first. For file overwrite it replaces the
          // destination as one filesystem operation. EXDEV is surfaced rather
          // than hidden behind copy+delete in this phase.
          filesystem.rename(
            sourceBeforeCommit.lexicalPath,
            destinationBeforeCommit.lexicalPath,
          );
        },
      );

      return {
        operation: "move",
        path: sourcePath,
        destinationPath,
        overwritten: destinationBeforeCommit.exists,
      };
    },
  );
};

export const executeDeleteMutation = async (
  input: DeleteMutationInput,
  context: FileMutationRuntimeContext = {},
): Promise<DeleteMutationResult> => {
  const inputPath = requireNonEmptyPath(input.path, "path");
  const filesystem = mutationFilesystem(context);
  const preflight = preparePath(inputPath, filesystem, {
    mustExist: true,
  });

  return await withMutationLocks(
    [preflight.canonicalPath],
    context.signal,
    async () => {
      const target = preparePath(inputPath, filesystem, {
        mustExist: true,
      });
      if (!isSameMutationIdentity(preflight, target)) {
        throw mcpBadRequest("file mutation target changed while waiting for lock");
      }
      const recursive = input.recursive === true;

      if (target.type === "directory" && !recursive) {
        const entries = filesystem.readdir(target.lexicalPath);
        if (entries.length > 0) {
          throw mcpBadRequest(
            "recursive=true is required to delete a non-empty directory",
          );
        }
      }

      const version = captureMutationPathVersion(
        target.lexicalPath,
        filesystem,
      );
      context.pushEvent?.({
        type: "invocation:progress",
        message: `Prepared ${target.type} delete`,
      });
      assertNotAborted(context.signal);

      const beforeCommit = preparePath(inputPath, filesystem, {
        mustExist: true,
      });
      assertStableMutationPath(target, beforeCommit);
      assertMutationPathVersion(
        version,
        beforeCommit.lexicalPath,
        filesystem,
      );

      wrapMutationFailure(
        `Failed to delete workspace target: ${inputPath}`,
        () => {
          if (beforeCommit.type === "directory") {
            if (recursive) {
              filesystem.remove(beforeCommit.lexicalPath, {
                recursive: true,
                force: false,
              });
            } else {
              filesystem.rmdir(beforeCommit.lexicalPath);
            }
          } else {
            filesystem.unlink(beforeCommit.lexicalPath);
          }
        },
      );

      return {
        operation: "delete",
        path: inputPath,
        deletedType:
          beforeCommit.type === "directory" ? "directory" : "file",
        recursive:
          beforeCommit.type === "directory" ? recursive : false,
      };
    },
  );
};
