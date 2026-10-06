import path from "node:path";
import { mcpBadRequest } from "../core/errors.js";
import { resolveWorkspaceWritePath } from "../workspace.js";
import type { FileMutationFilesystem } from "./filesystem.js";

export type MutationPathType = "file" | "directory" | "missing";

export type ResolvedMutationPath = {
  inputPath: string;
  lexicalPath: string;
  canonicalPath: string;
  type: MutationPathType;
  exists: boolean;
};

export type MutationPathVersion = {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

type ResolveMutationPathOptions = {
  mustExist?: boolean;
  expectedType?: "file" | "directory";
};

const lstatOrNull = (
  targetPath: string,
  filesystem: FileMutationFilesystem,
) => {
  try {
    return filesystem.lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const findNearestExistingEntry = (
  targetPath: string,
  filesystem: FileMutationFilesystem,
) => {
  let current = targetPath;
  while (true) {
    if (lstatOrNull(current, filesystem)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
};

const normalizeMutationIdentity = (value: string) => {
  const normalized = path.normalize(path.resolve(value)).normalize("NFC");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

const canonicalizeMissingPath = (
  targetPath: string,
  filesystem: FileMutationFilesystem,
) => {
  const ancestor = findNearestExistingEntry(targetPath, filesystem);
  if (!ancestor) {
    throw mcpBadRequest("path must stay inside workspace root");
  }

  let realAncestor: string;
  try {
    realAncestor = filesystem.realpath(ancestor);
  } catch {
    throw mcpBadRequest("path contains an unresolved symbolic link");
  }

  return path.resolve(realAncestor, path.relative(ancestor, targetPath));
};

export const resolveMutationPath = (
  rawInputPath: string,
  filesystem: FileMutationFilesystem,
  options: ResolveMutationPathOptions = {},
): ResolvedMutationPath => {
  const inputPath = rawInputPath.trim();
  if (!inputPath) {
    throw mcpBadRequest("path is required");
  }

  const lexicalPath = resolveWorkspaceWritePath(inputPath);
  const lstat = lstatOrNull(lexicalPath, filesystem);

  if (lstat?.isSymbolicLink()) {
    throw mcpBadRequest(
      "file mutation does not operate on symbolic-link targets",
    );
  }

  const exists = lstat !== null;
  if (options.mustExist && !exists) {
    throw mcpBadRequest(`path does not exist: ${inputPath}`);
  }

  let type: MutationPathType = "missing";
  if (lstat?.isFile()) {
    type = "file";
  } else if (lstat?.isDirectory()) {
    type = "directory";
  } else if (lstat) {
    throw mcpBadRequest(`unsupported filesystem target: ${inputPath}`);
  }

  if (
    options.expectedType &&
    type !== "missing" &&
    type !== options.expectedType
  ) {
    throw mcpBadRequest(
      `path must be a workspace ${options.expectedType}: ${inputPath}`,
    );
  }

  let canonicalPath: string;
  if (exists) {
    try {
      canonicalPath = filesystem.realpath(lexicalPath);
    } catch {
      throw mcpBadRequest("path contains an unresolved symbolic link");
    }
  } else {
    canonicalPath = canonicalizeMissingPath(lexicalPath, filesystem);
  }

  let workspaceRoot: string;
  try {
    workspaceRoot = filesystem.realpath(resolveWorkspaceWritePath("."));
  } catch {
    throw mcpBadRequest("workspace root could not be resolved safely");
  }
  if (
    normalizeMutationIdentity(canonicalPath) ===
    normalizeMutationIdentity(workspaceRoot)
  ) {
    throw mcpBadRequest("workspace root cannot be a file mutation target");
  }

  return {
    inputPath,
    lexicalPath,
    canonicalPath,
    type,
    exists,
  };
};

const normalizeLexicalIdentity = (value: string) =>
  path.normalize(path.resolve(value)).normalize("NFC");

export const isCaseOnlyMutationRename = (
  source: ResolvedMutationPath,
  destination: ResolvedMutationPath,
) => {
  if (!source.exists || !destination.exists || source.type !== destination.type) {
    return false;
  }

  const sourceCanonical = normalizeLexicalIdentity(source.canonicalPath);
  const destinationCanonical = normalizeLexicalIdentity(
    destination.canonicalPath,
  );
  if (sourceCanonical !== destinationCanonical) {
    return false;
  }

  const sourceLexical = normalizeLexicalIdentity(source.lexicalPath);
  const destinationLexical = normalizeLexicalIdentity(destination.lexicalPath);
  if (sourceLexical === destinationLexical) {
    return false;
  }

  return sourceLexical.toLowerCase() === destinationLexical.toLowerCase();
};

export const assertStableMutationPath = (
  before: ResolvedMutationPath,
  after: ResolvedMutationPath,
) => {
  if (
    normalizeMutationIdentity(before.canonicalPath) !==
      normalizeMutationIdentity(after.canonicalPath) ||
    before.exists !== after.exists ||
    before.type !== after.type
  ) {
    throw mcpBadRequest("file mutation target changed before commit");
  }
};

export const isSameMutationIdentity = (
  left: ResolvedMutationPath,
  right: ResolvedMutationPath,
) =>
  normalizeMutationIdentity(left.canonicalPath) ===
  normalizeMutationIdentity(right.canonicalPath);

export const captureMutationPathVersion = (
  targetPath: string,
  filesystem: FileMutationFilesystem,
): MutationPathVersion => {
  const stat = filesystem.stat(targetPath);
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
};

export const assertMutationPathVersion = (
  expected: MutationPathVersion,
  targetPath: string,
  filesystem: FileMutationFilesystem,
) => {
  const actual = captureMutationPathVersion(targetPath, filesystem);
  if (
    expected.dev !== actual.dev ||
    expected.ino !== actual.ino ||
    expected.size !== actual.size ||
    expected.mtimeMs !== actual.mtimeMs ||
    expected.ctimeMs !== actual.ctimeMs
  ) {
    throw mcpBadRequest("file changed before mutation commit");
  }
};
