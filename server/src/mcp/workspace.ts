import path from "node:path";
import fs from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { mcpBadRequest, mcpInternalError } from "./core/errors.js";
import { normalizeWorkspaceRelativePathArg } from "./workspace-path-args.js";

let selectedWorkspaceRoot: string | null = null;
const workspaceRootOverrideStorage = new AsyncLocalStorage<string | null>();

const resolveWorkspaceRootOverride = () => {
  const override = workspaceRootOverrideStorage.getStore()?.trim();
  if (override) {
    return path.resolve(override);
  }

  return null;
};

const resolveConfiguredWorkspaceRoot = () => {
  const configured = process.env.UI_CHAT_WORKSPACE_ROOT?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return null;
};

const assertWorkspaceDirectory = (targetPath: string) => {
  if (!fs.existsSync(targetPath)) {
    throw mcpBadRequest(`workspace path does not exist: ${targetPath}`);
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw mcpBadRequest(`workspace path must be a directory: ${targetPath}`);
  }
};

export const getWorkspaceRoot = () => {
  const currentRoot =
    resolveWorkspaceRootOverride() ??
    selectedWorkspaceRoot ??
    resolveConfiguredWorkspaceRoot();
  if (!currentRoot) {
    throw mcpBadRequest("workspace root is not selected");
  }

  assertWorkspaceDirectory(currentRoot);
  return currentRoot;
};

export const getWorkspaceSelection = () => {
  const configuredRoot = resolveConfiguredWorkspaceRoot();
  const overrideRoot = resolveWorkspaceRootOverride();
  const activeRoot = overrideRoot ?? selectedWorkspaceRoot ?? configuredRoot;

  return {
    rootPath: activeRoot,
    source: overrideRoot || selectedWorkspaceRoot
      ? "selected"
      : configuredRoot
        ? "configured"
        : "unset",
  } as const;
};

export const runWithWorkspaceRootOverride = async <T>(
  rootPath: string | null | undefined,
  run: () => Promise<T>,
) => {
  const normalizedRoot =
    typeof rootPath === "string" && rootPath.trim()
      ? path.resolve(rootPath.trim())
      : null;

  return await workspaceRootOverrideStorage.run(normalizedRoot, run);
};

export const selectWorkspaceRoot = (inputPath: unknown) => {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw mcpBadRequest("rootPath is required");
  }

  const resolved = path.resolve(inputPath.trim());
  assertWorkspaceDirectory(resolved);
  selectedWorkspaceRoot = resolved;

  return getWorkspaceSelection();
};

export const clearWorkspaceSelection = () => {
  selectedWorkspaceRoot = null;
  return getWorkspaceSelection();
};

export const resolveWorkspacePath = (inputPath: unknown) => {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw mcpBadRequest("path is required");
  }

  const workspaceRoot = getWorkspaceRoot();
  const normalizedPath = normalizeWorkspaceRelativePathArg(inputPath);
  if (normalizedPath.type === "reject") {
    throw mcpBadRequest("path must stay inside workspace root");
  }

  const resolved = path.resolve(workspaceRoot, normalizedPath.value);
  const relative = path.relative(workspaceRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw mcpBadRequest("path must stay inside workspace root");
  }

  return resolved;
};

const getWorkspaceRealRoot = (workspaceRoot: string) => {
  try {
    return fs.realpathSync.native(workspaceRoot);
  } catch {
    return path.resolve(workspaceRoot);
  }
};

const assertPathInsideWorkspaceRoot = (
  workspaceRoot: string,
  targetPath: string,
) => {
  const relative = path.relative(workspaceRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw mcpBadRequest("path must stay inside workspace root");
  }
};

const findNearestExistingAncestor = (targetPath: string) => {
  let current = targetPath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }

  return current;
};

export const resolveWorkspaceWritePath = (inputPath: unknown) => {
  const workspaceRoot = getWorkspaceRoot();
  const resolved = resolveWorkspacePath(inputPath);
  const workspaceRealRoot = getWorkspaceRealRoot(workspaceRoot);
  const existingAncestor = findNearestExistingAncestor(resolved);

  if (!existingAncestor) {
    throw mcpBadRequest("path must stay inside workspace root");
  }

  let resolvedAncestor = existingAncestor;
  try {
    resolvedAncestor = fs.realpathSync.native(existingAncestor);
  } catch {
    resolvedAncestor = path.resolve(existingAncestor);
  }

  assertPathInsideWorkspaceRoot(workspaceRealRoot, resolvedAncestor);
  return resolved;
};

export const resolveWorkspaceFilePath = (inputPath: unknown) => {
  const workspaceRoot = getWorkspaceRoot();
  const resolved = resolveWorkspacePath(inputPath);

  if (!fs.existsSync(resolved)) {
    throw mcpBadRequest(
      `path must be an existing workspace file: ${String(inputPath ?? "")}`,
    );
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw mcpBadRequest(
      `path must be an existing workspace file: ${String(inputPath ?? "")}`,
    );
  }

  const workspaceRealRoot = getWorkspaceRealRoot(workspaceRoot);
  let resolvedFile = resolved;
  try {
    resolvedFile = fs.realpathSync.native(resolved);
  } catch {
    resolvedFile = path.resolve(resolved);
  }

  assertPathInsideWorkspaceRoot(workspaceRealRoot, resolvedFile);
  return resolvedFile;
};

export const resolveWorkspaceDirectoryPath = (inputPath: unknown) => {
  const workspaceRoot = getWorkspaceRoot();
  const resolved = resolveWorkspacePath(inputPath);

  if (!fs.existsSync(resolved)) {
    throw mcpBadRequest(
      `cwd must be an existing workspace directory: ${String(inputPath ?? ".")}`,
    );
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw mcpBadRequest(
      `cwd must be an existing workspace directory: ${String(inputPath ?? ".")}`,
    );
  }

  const workspaceRealRoot = getWorkspaceRealRoot(workspaceRoot);
  let resolvedDirectory = resolved;
  try {
    resolvedDirectory = fs.realpathSync.native(resolved);
  } catch {
    resolvedDirectory = path.resolve(resolved);
  }

  assertPathInsideWorkspaceRoot(workspaceRealRoot, resolvedDirectory);
  return resolvedDirectory;
};

export const ensureParentDir = (targetPath: string) => {
  const parentDir = path.dirname(targetPath);
  fs.mkdirSync(parentDir, { recursive: true });
};

export const readTextFileSafe = (
  targetPath: string,
  encoding: BufferEncoding = "utf-8",
) => {
  try {
    return fs.readFileSync(targetPath, encoding);
  } catch (error) {
    throw mcpInternalError(`Failed to read file: ${targetPath}`, {
      cause: error,
    });
  }
};
