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

const writeUtf8File = (targetPath: string, content: string) => {
  try {
    fs.writeFileSync(targetPath, content, "utf8");
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
  writeUtf8File(targetPath, input.content);

  return {
    operation: "write",
    path: inputPath,
    created: !exists,
    overwritten: exists,
    bytes: Buffer.byteLength(input.content, "utf8"),
  };
};

type LocatedEdit = EditMutation & {
  start: number;
  end: number;
};

const locateExactEdit = (content: string, edit: EditMutation, index: number): LocatedEdit => {
  if (!edit.oldText.length) {
    throw mcpBadRequest(`edits[${index}].oldText must not be empty`);
  }

  const start = content.indexOf(edit.oldText);
  if (start < 0) {
    throw mcpBadRequest(`edits[${index}] target was not found`);
  }

  const duplicate = content.indexOf(edit.oldText, start + edit.oldText.length);
  if (duplicate >= 0) {
    throw mcpBadRequest(`edits[${index}] target is ambiguous`);
  }

  return {
    ...edit,
    start,
    end: start + edit.oldText.length,
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

const applyLocatedEdits = (content: string, edits: LocatedEdit[]) => {
  let cursor = 0;
  let output = "";

  for (const edit of edits) {
    output += content.slice(cursor, edit.start);
    output += edit.newText;
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
  const current = fs.readFileSync(targetPath, "utf8");
  const located = validateNonOverlappingEdits(
    input.edits.map((edit, index) => locateExactEdit(current, edit, index)),
  );
  const next = applyLocatedEdits(current, located);

  context.pushEvent?.({
    type: "invocation:progress",
    message: `Validated ${located.length} exact file edit(s)`,
  });
  assertNotAborted(context.signal);
  writeUtf8File(targetPath, next);

  return {
    operation: "edit",
    path: inputPath,
    editsApplied: located.length,
    bytes: Buffer.byteLength(next, "utf8"),
  };
};

export const executeMoveMutation = async (
  input: MoveMutationInput,
  context: FileMutationRuntimeContext = {},
): Promise<MoveMutationResult> => {
  const sourcePath = requireNonEmptyPath(input.path, "path");
  const destinationPath = requireNonEmptyPath(input.destinationPath, "destinationPath");
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
