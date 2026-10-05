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
import { buildContinuation, parseBoundedLimit, parseOffset } from "./paging.js";
import {
  escapeGlobPath,
  normalizeWorkspaceRelativePath,
  resolveWorkspaceIgnorePatterns,
} from "./path-policy.js";

export const DEFAULT_GLOB_LIMIT = 200;
export const MAX_GLOB_LIMIT = 1_000;

export type GlobResult = {
  type: "glob";
  pattern: string;
  path: string;
  matches: string[];
  offset: number;
  limit: number;
  returnedCount: number;
  totalCount: number;
  hasMore: boolean;
  truncated: boolean;
  nextOffset?: number;
};

type GlobExecutionResult = {
  contents: GlobResult;
  artifacts: ToolArtifact[];
};

type GlobExecutionContext = {
  args: Record<string, unknown>;
  environment?: ToolExecutionEnvironment;
  pushEvent?: (event: ToolInvocationEventInput) => void;
};

const assertHarnessEnvironment = (
  environment?: ToolExecutionEnvironment,
): ToolExecutionEnvironment => {
  if (!environment || environment.source !== "harness") {
    throw mcpInternalError("Glob execution requires a harness environment snapshot");
  }
  return environment;
};

const parsePattern = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    throw mcpBadRequest("pattern is required");
  }
  const normalized = normalizeWorkspaceRelativePath(value.trim());
  if (
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw mcpBadRequest("pattern must stay inside the selected path");
  }
  return normalized;
};

const parseIncludeIgnored = (value: unknown) => {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw mcpBadRequest("includeIgnored must be a boolean");
  }
  return value;
};

export const executeGlob = async ({
  args,
  environment,
  pushEvent,
}: GlobExecutionContext): Promise<GlobExecutionResult> => {
  assertHarnessEnvironment(environment);

  const pattern = parsePattern(args.pattern);
  const inputPath =
    typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
  const offset = parseOffset(args.offset);
  const limit = parseBoundedLimit(args.limit, {
    defaultValue: DEFAULT_GLOB_LIMIT,
    maxValue: MAX_GLOB_LIMIT,
  });
  const includeIgnored = parseIncludeIgnored(args.includeIgnored);

  const workspaceRoot = getWorkspaceRoot();
  const targetPath = resolveWorkspacePath(inputPath);
  if (!fs.existsSync(targetPath)) {
    throw mcpBadRequest(`Path does not exist: ${targetPath}`);
  }
  if (!fs.statSync(targetPath).isDirectory()) {
    throw mcpBadRequest("glob path must be a directory");
  }

  const relativeBase =
    normalizeWorkspaceRelativePath(path.relative(workspaceRoot, targetPath)) || ".";
  const workspacePattern =
    relativeBase === "."
      ? pattern
      : `${escapeGlobPath(relativeBase)}/${pattern}`;

  pushEvent?.({
    type: "invocation:progress",
    message: includeIgnored
      ? "Glob plan: path pattern including ignored paths"
      : "Glob plan: path pattern with default ignores",
  });

  let discovered: string[];
  try {
    discovered = await fg(workspacePattern, {
      cwd: workspaceRoot,
      onlyFiles: true,
      dot: true,
      unique: true,
      suppressErrors: false,
      followSymbolicLinks: false,
      ignore: resolveWorkspaceIgnorePatterns(workspaceRoot, includeIgnored),
    });
  } catch (error) {
    throw mcpBadRequest(`Invalid or unreadable glob pattern: ${pattern}`, {
      cause: error,
    });
  }

  const allMatches = discovered
    .map(normalizeWorkspaceRelativePath)
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
  const visibleMatches = allMatches.slice(offset, offset + limit);
  const continuation = buildContinuation({
    offset,
    returnedCount: visibleMatches.length,
    totalCount: allMatches.length,
  });

  const contents: GlobResult = {
    type: "glob",
    pattern,
    path: inputPath,
    matches: visibleMatches,
    offset,
    limit,
    returnedCount: continuation.returnedCount,
    totalCount: allMatches.length,
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
        kind: "search-results",
        title: `Glob ${pattern}`,
        data: visibleMatches,
        metadata: {
          pattern,
          path: inputPath,
          offset,
          limit,
          returnedCount: visibleMatches.length,
          totalCount: allMatches.length,
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
