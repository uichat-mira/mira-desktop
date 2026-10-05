import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { createArtifact } from "../core/artifacts.js";
import type {
  ToolArtifact,
  ToolExecutionEnvironment,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { getWorkspaceRoot, resolveWorkspacePath } from "../workspace.js";
import {
  escapeGlobPath,
  loadWorkspaceIgnorePatterns,
  normalizeWorkspaceRelativePath,
} from "./path-policy.js";

export const DEFAULT_LIST_MAX_RESULTS = 100;
export const MAX_LIST_RESULTS = 200;

export type ListEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink";
  sizeBytes: number;
};

export type ListResult = {
  type: "list";
  path: string;
  entries: ListEntry[];
  returnedCount: number;
  totalCount: number;
  hasMore: boolean;
  truncated: boolean;
};

type ListExecutionResult = {
  contents: ListResult;
  artifacts: ToolArtifact[];
};

type ListExecutionContext = {
  args: Record<string, unknown>;
  environment?: ToolExecutionEnvironment;
  pushEvent?: (event: ToolInvocationEventInput) => void;
};

const assertHarnessEnvironment = (
  environment?: ToolExecutionEnvironment,
): ToolExecutionEnvironment => {
  if (!environment || environment.source !== "harness") {
    throw mcpInternalError("List execution requires a harness environment snapshot");
  }
  return environment;
};

const parseMaxResults = (value: unknown) => {
  if (value === undefined) return DEFAULT_LIST_MAX_RESULTS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw mcpBadRequest("maxResults must be a positive integer");
  }
  return Math.min(value, MAX_LIST_RESULTS);
};

const entryType = (stat: fs.Stats): ListEntry["type"] => {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  return "file";
};

const typeRank = (type: ListEntry["type"]) =>
  type === "directory" ? 0 : type === "file" ? 1 : 2;

export const executeList = async ({
  args,
  environment,
  pushEvent,
}: ListExecutionContext): Promise<ListExecutionResult> => {
  assertHarnessEnvironment(environment);

  const inputPath = args.path;
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw mcpBadRequest("path is required");
  }

  const workspaceRoot = getWorkspaceRoot();
  const targetPath = resolveWorkspacePath(inputPath);
  if (!fs.existsSync(targetPath)) {
    throw mcpBadRequest(`Path does not exist: ${targetPath}`);
  }
  if (!fs.statSync(targetPath).isDirectory()) {
    throw mcpBadRequest("list requires a directory path");
  }

  const maxResults = parseMaxResults(args.maxResults);
  const relativeBase =
    normalizeWorkspaceRelativePath(path.relative(workspaceRoot, targetPath)) || ".";
  const pattern =
    relativeBase === "."
      ? "*"
      : `${escapeGlobPath(relativeBase)}/*`;

  pushEvent?.({
    type: "invocation:progress",
    message: "List plan: direct-directory -> shared-ignore-policy",
  });

  let matches: string[];
  try {
    matches = await fg(pattern, {
      cwd: workspaceRoot,
      onlyFiles: false,
      dot: true,
      unique: true,
      suppressErrors: false,
      followSymbolicLinks: false,
      ignore: loadWorkspaceIgnorePatterns(workspaceRoot),
    });
  } catch (error) {
    throw mcpInternalError(`Failed to list directory: ${inputPath}`, {
      cause: error,
    });
  }

  const entries = matches
    .map((relativePath) => {
      const normalizedPath = normalizeWorkspaceRelativePath(relativePath);
      const absolutePath = path.resolve(workspaceRoot, relativePath);
      const stat = fs.lstatSync(absolutePath);
      return {
        name: path.basename(relativePath),
        path: normalizedPath,
        type: entryType(stat),
        sizeBytes: stat.size,
      } satisfies ListEntry;
    })
    .sort(
      (left, right) =>
        typeRank(left.type) - typeRank(right.type) ||
        left.name.localeCompare(right.name, undefined, { numeric: true }) ||
        left.path.localeCompare(right.path, undefined, { numeric: true }),
    );

  const totalCount = entries.length;
  const visibleEntries = entries.slice(0, maxResults);
  const truncated = visibleEntries.length < totalCount;
  const contents: ListResult = {
    type: "list",
    path: inputPath,
    entries: visibleEntries,
    returnedCount: visibleEntries.length,
    totalCount,
    hasMore: truncated,
    truncated,
  };

  return {
    contents,
    artifacts: [
      createArtifact({
        kind: "table",
        title: `Directory ${inputPath}`,
        data: visibleEntries,
        metadata: {
          path: inputPath,
          returnedCount: visibleEntries.length,
          totalCount,
          truncated,
        },
      }),
    ],
  };
};
