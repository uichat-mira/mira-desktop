import fs from "node:fs";
import path from "node:path";
import type { ToolInvocationEventInput } from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import {
  ensureParentDir,
  resolveWorkspaceDirectoryPath,
  resolveWorkspaceFilePath,
  resolveWorkspacePath,
  resolveWorkspaceWritePath,
} from "../workspace.js";
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

const resolveExistingMutationPath = (inputPath: string) => {
  const resolved = resolveWorkspacePath(inputPath);
  if (!fs.existsSync(resolved)) {
    throw mcpBadRequest(`path does not exist: ${inputPath}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return {
      path: resolveWorkspaceFilePath(inputPath),
      type: "file" as const,
    };
  }
  if (stat.isDirectory()) {
    return {
      path: resolveWorkspaceDirectoryPath(inputPath),
      type: "directory" as const,
    };
  }

  throw mcpBadRequest(`unsupported filesystem target: ${inputPath}`);
};

const writeBuffer = (targetPath: string, content: Buffer) => {
  try {
    fs.writeFileSync(targetPath, content);
  } catch (error) {
    throw mcpInternalError(`Failed to write workspace file: ${targetPath}`, {
      cause: error,
    });
  }
};

export const executeWriteMutation = async (
  input: WriteMutationInput,
  context: FileMutationRuntimeContext = {},
): Promise<WriteMutationResult> => {
  const inputPath = requireNonEmptyPath(input.path, "path");
  const targetPath = resolveWorkspaceWritePath(inputPath);
  const exists = fs.existsSync(targetPath);

  if (exists && fs.statSync(targetPath).isDirectory()) {
    throw mcpBadRequest("write does not support directory targets");
  }
  if (exists && input.overwrite !== true) {
    throw mcpBadRequest("path already exists; set overwrite=true to replace it");
  }

  const existingFormat = exists ? inspectMutationTextFormat(targetPath) : null;
  const encoded = existingFormat
    ? encodeMutationText(input.content, existingFormat)
    : Buffer.from(input.content, "utf8");

  context.pushEvent?.({
    type: "invocation:progress",
    message: exists ? "Prepared whole-file overwrite" : "Prepared file create",
  });
  assertNotAborted(context.signal);

  try {
    ensureParentDir(targetPath);
  } catch (error) {
    throw mcpInternalError(`Failed to create parent directory for: ${inputPath}`, {
      cause: error,
    });
  }
  writeBuffer(targetPath, encoded);

  return {
    operation: "write",
    path: inputPath,
    created: !exists,
    overwritten: exists,
    bytes: encoded.byteLength,
  };
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

const locateExactEdit = (
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

  const targetPath = resolveWorkspaceFilePath(inputPath);
  const currentFile = readMutationTextFile(targetPath);
  const located = validateNonOverlappingEdits(
    input.edits.map((edit, index) =>
      locateExactEdit(currentFile.text, edit, index),
    ),
  );
  const next = applyLocatedEdits(
    currentFile.text,
    located,
    currentFile.lineEnding,
  );

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

  const encoded = encodeMutationText(next, currentFile);
  writeBuffer(targetPath, encoded);

  return {
    operation: "edit",
    path: inputPath,
    editsApplied: located.length,
    bytes: encoded.byteLength,
  };
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
  const source = resolveExistingMutationPath(sourcePath);
  const destination = resolveWorkspaceWritePath(destinationPath);

  if (path.resolve(source.path) === path.resolve(destination)) {
    throw mcpBadRequest("path and destinationPath must be different");
  }
  if (fs.existsSync(destination)) {
    if (input.overwrite === true) {
      throw mcpBadRequest(
        "move overwrite is not enabled until atomic replacement is hardened",
      );
    }
    throw mcpBadRequest(
      "destinationPath already exists; overwrite requires the hardened move path",
    );
  }

  context.pushEvent?.({
    type: "invocation:progress",
    message: "Prepared workspace move",
  });
  assertNotAborted(context.signal);

  try {
    fs.renameSync(source.path, destination);
  } catch (error) {
    throw mcpInternalError(
      `Failed to move workspace target from ${sourcePath} to ${destinationPath}`,
      { cause: error },
    );
  }

  return {
    operation: "move",
    path: sourcePath,
    destinationPath,
    overwritten: false,
  };
};

export const executeDeleteMutation = async (
  input: DeleteMutationInput,
  context: FileMutationRuntimeContext = {},
): Promise<DeleteMutationResult> => {
  const inputPath = requireNonEmptyPath(input.path, "path");
  const target = resolveExistingMutationPath(inputPath);
  const recursive = input.recursive === true;

  if (target.type === "directory" && !recursive) {
    const entries = fs.readdirSync(target.path);
    if (entries.length > 0) {
      throw mcpBadRequest(
        "recursive=true is required to delete a non-empty directory",
      );
    }
  }

  context.pushEvent?.({
    type: "invocation:progress",
    message: `Prepared ${target.type} delete`,
  });
  assertNotAborted(context.signal);

  try {
    if (target.type === "directory") {
      if (recursive) {
        fs.rmSync(target.path, { recursive: true, force: false });
      } else {
        fs.rmdirSync(target.path);
      }
    } else {
      fs.unlinkSync(target.path);
    }
  } catch (error) {
    throw mcpInternalError(`Failed to delete workspace target: ${inputPath}`, {
      cause: error,
    });
  }

  return {
    operation: "delete",
    path: inputPath,
    deletedType: target.type,
    recursive: target.type === "directory" ? recursive : false,
  };
};
