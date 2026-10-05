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

export const DEFAULT_GLOB_MAX_RESULTS = 100;
export const MAX_GLOB_RESULTS = 200;

export type GlobResult = {
  type: "glob";
  pattern: string;
  root: string;
  matches: string[];
  returnedCount: number;
  totalCount: number;
  hasMore: boolean;
  truncated: boolean;
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

const parseMaxResults = (value: unknown) => {
  if (value === undefined) return DEFAULT_GLOB_MAX_RESULTS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw mcpBadRequest("maxResults must be a positive integer");
  }
  return Math.min(value, MAX_GLOB_RESULTS);
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
    throw mcpBadRequest("pattern must stay inside the selected root");
  }
  return normalized;
};

export const executeGlob = async ({
  args,
  environment,
  pushEvent,
}: GlobExecutionContext): Promise<GlobExecutionResult> => {
  assertHarnessEnvironment(environment);

  const pattern = parsePattern(args.pattern);
  const root = typeof args.root === "string" && args.root.trim() ? args.root.trim() : ".";
  const workspaceRoot = getWorkspaceRoot();
  const rootPath = resolveWorkspacePath(root);
  if (!fs.existsSync(rootPath)) {
    throw mcpBadRequest(`Path does not exist: ${rootPath}`);
  }
  if (!fs.statSync(rootPath).isDirectory()) {
    throw mcpBadRequest("glob root must be a directory path");
  }

  const relativeRoot =
    normalizeWorkspaceRelativePath(path.relative(workspaceRoot, rootPath)) || ".";
  const workspacePattern =
    relativeRoot === "."
      ? pattern
      : `${escapeGlobPath(relativeRoot)}/${pattern}`;
  const maxResults = parseMaxResults(args.maxResults);

  pushEvent?.({
    type: "invocation:progress",
    message: "Glob plan: fast-glob -> shared-ignore-policy",
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
      ignore: loadWorkspaceIgnorePatterns(workspaceRoot),
    });
  } catch (error) {
    throw mcpBadRequest(
      `Invalid or unreadable glob pattern: ${pattern}`,
      { cause: error },
    );
  }

  const allMatches = discovered
    .map(normalizeWorkspaceRelativePath)
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
  const visibleMatches = allMatches.slice(0, maxResults);
  const truncated = visibleMatches.length < allMatches.length;
  const contents: GlobResult = {
    type: "glob",
    pattern,
    root,
    matches: visibleMatches,
    returnedCount: visibleMatches.length,
    totalCount: allMatches.length,
    hasMore: truncated,
    truncated,
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
          root,
          returnedCount: visibleMatches.length,
          totalCount: allMatches.length,
          truncated,
        },
      }),
    ],
  };
};
