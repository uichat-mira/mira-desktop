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
import { getWorkspaceRoot, resolveWorkspaceDirectoryPath } from "../workspace.js";
import { buildContinuation, parseBoundedLimit, parseOffset } from "./paging.js";
import {
  escapeGlobPath,
  filterGitIgnoredPaths,
  normalizeWorkspaceRelativePath,
  resolveWorkspaceIgnorePatterns,
} from "./path-policy.js";

export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 1_000;

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
  offset: number;
  limit: number;
  returnedCount: number;
  totalCount: number;
  hasMore: boolean;
  truncated: boolean;
  nextOffset?: number;
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

const parseIncludeIgnored = (value: unknown) => {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw mcpBadRequest("includeIgnored must be a boolean");
  }
  return value;
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

  const inputPath =
    typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
  const offset = parseOffset(args.offset);
  const limit = parseBoundedLimit(args.limit, {
    defaultValue: DEFAULT_LIST_LIMIT,
    maxValue: MAX_LIST_LIMIT,
  });
  const includeIgnored = parseIncludeIgnored(args.includeIgnored);

  const workspaceRoot = getWorkspaceRoot();
  const targetPath = resolveWorkspaceDirectoryPath(inputPath);

  const relativeBase =
    normalizeWorkspaceRelativePath(path.relative(workspaceRoot, targetPath)) || ".";
  const pattern =
    relativeBase === "."
      ? "*"
      : `${escapeGlobPath(relativeBase)}/*`;

  pushEvent?.({
    type: "invocation:progress",
    message: includeIgnored
      ? "List plan: direct-directory including ignored paths"
      : "List plan: direct-directory with default ignores",
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
      ignore: resolveWorkspaceIgnorePatterns(workspaceRoot, includeIgnored),
    });
  } catch (error) {
    throw mcpInternalError(`Failed to list directory: ${inputPath}`, {
      cause: error,
    });
  }

  const visibleMatches = filterGitIgnoredPaths(
    workspaceRoot,
    matches.map(normalizeWorkspaceRelativePath),
    includeIgnored,
  );

  const entries = visibleMatches
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

  const visibleEntries = entries.slice(offset, offset + limit);
  const continuation = buildContinuation({
    offset,
    returnedCount: visibleEntries.length,
    totalCount: entries.length,
  });
  const contents: ListResult = {
    type: "list",
    path: inputPath,
    entries: visibleEntries,
    offset,
    limit,
    returnedCount: continuation.returnedCount,
    totalCount: entries.length,
    hasMore: continuation.hasMore,
    truncated: continuation.truncated,
    ...(continuation.nextOffset === undefined
      ? {}
      : { nextOffset: continuation.nextOffset }),
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
          offset,
          limit,
          returnedCount: visibleEntries.length,
          totalCount: entries.length,
          hasMore: continuation.hasMore,
          includeIgnored,
          ...(continuation.nextOffset === undefined
            ? {}
            : { nextOffset: continuation.nextOffset }),
        },
      }),
    ],
  };
};
