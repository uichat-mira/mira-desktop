import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { ToolExecutionEnvironment } from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { getWorkspaceRoot, resolveWorkspacePath } from "../workspace.js";
import {
  searchWithRipgrep,
  type RipgrepProviderDependencies,
  type RipgrepSearchProvider,
} from "./ripgrep-provider.js";
import type { ReadLocateMatch, ReadLocateResult } from "./types.js";

export type ReadLocateArgs = {
  query: string;
  path?: string;
  searchMode?: "auto" | "path" | "content";
  extensions?: string[];
  limit?: number;
};

type LocateProviderCapability = ToolExecutionEnvironment["read"]["capabilities"][number];

const DEFAULT_LIMIT = 20;
const PREVIEW_MAX_LENGTH = 120;
const DEFAULT_NODE_CONTENT_IGNORES = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/release/**",
  "**/.artifacts/**",
  "**/coverage/**",
  "**/target/**",
];

export type ReadLocateProvider =
  | "fast-glob"
  | RipgrepSearchProvider
  | "node-content-scan"
  | "unavailable";

export type ReadLocateDiagnostics = {
  provider: ReadLocateProvider;
  providers: ReadLocateProvider[];
  attempts: Array<{
    provider: ReadLocateProvider;
    status: "success" | "failed" | "unavailable";
    reason?: string;
  }>;
};

export type ReadLocateDependencies = {
  ripgrep?: RipgrepProviderDependencies;
};

const assertEnvironment = (environment?: ToolExecutionEnvironment) => {
  if (!environment || environment.source !== "harness") {
    throw mcpInternalError("Read locate requires a harness environment snapshot");
  }

  return environment;
};

const clampLimit = (limit: unknown) => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 100);
};

const normalizeExtensions = (extensions: unknown) => {
  if (!Array.isArray(extensions)) {
    return [];
  }

  return extensions
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => (value.startsWith(".") ? value.toLowerCase() : `.${value.toLowerCase()}`));
};

const resolveScope = (inputPath: unknown) => {
  const workspaceRoot = getWorkspaceRoot();
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    return {
      workspaceRoot,
      basePath: workspaceRoot,
      relativeBasePath: ".",
    };
  }

  const resolved = resolveWorkspacePath(inputPath);
  const stat = fs.statSync(resolved);
  const basePath = stat.isDirectory() ? resolved : path.dirname(resolved);
  const relativeBasePath = path.relative(workspaceRoot, basePath) || ".";

  return {
    workspaceRoot,
    basePath,
    relativeBasePath,
  };
};

const sortCapabilities = (environment: ToolExecutionEnvironment) =>
  [...environment.read.capabilities]
    .filter((capability) => capability.available)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));

const matchesExtension = (filePath: string, extensions: string[]) =>
  extensions.length === 0 || extensions.includes(path.extname(filePath).toLowerCase());

const normalizeRelativePath = (filePath: string) => filePath.replace(/\\/g, "/");

const shortenPreview = (value: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, PREVIEW_MAX_LENGTH - 3).trimEnd()}...`;
};

const buildPathPatterns = (query: string) => {
  const escaped = query.replace(/\\/g, "/");
  return [`**/*${escaped}*`];
};

const loadNodeContentIgnorePatterns = (workspaceRoot: string) => {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    return DEFAULT_NODE_CONTENT_IGNORES;
  }

  const gitignorePatterns = fs
    .readFileSync(gitignorePath, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
    .flatMap((line) => {
      const normalized = line.replace(/\\/g, "/").replace(/^\//, "");
      if (!normalized) return [];
      if (normalized.endsWith("/")) {
        return [`**/${normalized}**`];
      }
      if (normalized.includes("/")) {
        return [normalized, `**/${normalized}`];
      }
      return [`**/${normalized}`, `**/${normalized}/**`];
    });

  return [...DEFAULT_NODE_CONTENT_IGNORES, ...gitignorePatterns];
};

const buildNodeContentMatcher = (query: string) => {
  const flags = query.toLocaleLowerCase() === query ? "iu" : "u";
  try {
    return new RegExp(query, flags);
  } catch {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, flags);
  }
};

const locateByPath = async ({
  query,
  workspaceRoot,
  basePath,
  extensions,
  limit,
  provider,
}: {
  query: string;
  workspaceRoot: string;
  basePath: string;
  extensions: string[];
  limit: number;
  provider: LocateProviderCapability;
}): Promise<ReadLocateMatch[]> => {
  const entries = await fg(buildPathPatterns(query), {
    cwd: basePath,
    onlyFiles: true,
    dot: true,
    unique: true,
    suppressErrors: true,
  });

  return entries
    .map((entry) => normalizeRelativePath(path.relative(workspaceRoot, path.resolve(basePath, entry))))
    .filter((entryPath) => matchesExtension(entryPath, extensions))
    .slice(0, limit)
    .map((entryPath) => ({
      path: entryPath,
      matchType: "path" as const,
    }));
};

const locateByNodeContentScan = ({
  query,
  workspaceRoot,
  basePath,
  extensions,
  limit,
  provider,
}: {
  query: string;
  workspaceRoot: string;
  basePath: string;
  extensions: string[];
  limit: number;
  provider: LocateProviderCapability;
}): ReadLocateMatch[] => {
  const entries = fg.sync(["**/*"], {
    cwd: basePath,
    onlyFiles: true,
    dot: false,
    unique: true,
    suppressErrors: true,
    ignore: loadNodeContentIgnorePatterns(workspaceRoot),
  });
  const matcher = buildNodeContentMatcher(query);
  const matches: ReadLocateMatch[] = [];

  for (const entry of entries) {
    if (matches.length >= limit) {
      break;
    }

    const absolutePath = path.resolve(basePath, entry);
    const relativePath = normalizeRelativePath(path.relative(workspaceRoot, absolutePath));
    if (!matchesExtension(relativePath, extensions)) {
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(absolutePath);
    } catch {
      continue;
    }
    if (buffer.includes(0)) {
      continue;
    }

    const content = buffer.toString("utf-8");
    const lines = content.split(/\r?\n/);
    let matchedLine = -1;
    let matchIndex = -1;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const match = matcher.exec(lines[lineIndex] ?? "");
      if (match) {
        matchedLine = lineIndex;
        matchIndex = match.index;
        break;
      }
    }
    if (matchedLine < 0) continue;

    matches.push({
      path: relativePath,
      matchType: "content",
      line: matchedLine + 1,
      column: matchIndex + 1,
      preview: shortenPreview(lines[matchedLine] ?? ""),
    });
  }

  return matches;
};

export const describeLocatePlan = (
  environment: ToolExecutionEnvironment | undefined,
  args: ReadLocateArgs,
) => {
  const harnessEnvironment = assertEnvironment(environment);
  const mode = args.searchMode ?? "auto";
  const chain = sortCapabilities(harnessEnvironment)
    .filter((capability) => capability.kind === "locate")
    .filter((capability) => {
      if (mode === "path") {
        return capability.id === "fast-glob-locate";
      }

      if (mode === "content") {
        return capability.id !== "fast-glob-locate";
      }

      return true;
    })
    .map((capability) => ({
      id: capability.id,
      priority: capability.priority,
    }));

  return {
    mode,
    chain,
  };
};

export const executeReadLocateWithDiagnostics = async (
  environment: ToolExecutionEnvironment | undefined,
  rawArgs: Record<string, unknown>,
  dependencies: ReadLocateDependencies = {},
) => {
  const harnessEnvironment = assertEnvironment(environment);
  const query = typeof rawArgs.query === "string" ? rawArgs.query.trim() : "";
  if (!query) {
    throw mcpBadRequest("query is required");
  }

  const searchMode =
    rawArgs.searchMode === "path" || rawArgs.searchMode === "content" || rawArgs.searchMode === "auto"
      ? rawArgs.searchMode
      : "auto";
  const limit = clampLimit(rawArgs.limit);
  const providerLimit = limit + 1;
  const extensions = normalizeExtensions(rawArgs.extensions);
  const scope = resolveScope(rawArgs.path);

  const capabilities = sortCapabilities(harnessEnvironment).filter(
    (capability) => capability.kind === "locate",
  );
  const selected = capabilities.filter((capability) => {
    if (searchMode === "path") {
      return capability.id === "fast-glob-locate";
    }

    if (searchMode === "content") {
      return capability.id !== "fast-glob-locate";
    }

    return true;
  });

  const matches = new Map<string, ReadLocateMatch>();
  const providers: ReadLocateProvider[] = [];
  const attempts: ReadLocateDiagnostics["attempts"] = [];
  let contentProviderResolved = false;

  for (const capability of selected) {
    let nextMatches: ReadLocateMatch[] = [];

    if (capability.id === "fast-glob-locate") {
      nextMatches = await locateByPath({
        query,
        workspaceRoot: scope.workspaceRoot,
        basePath: scope.basePath,
        extensions,
        limit: providerLimit,
        provider: capability,
      });
      providers.push("fast-glob");
      attempts.push({ provider: "fast-glob", status: "success" });
    } else if (capability.id === "ripgrep-locate") {
      if (contentProviderResolved) continue;
      const ripgrep = searchWithRipgrep({
        query,
        workspaceRoot: scope.workspaceRoot,
        basePath: scope.basePath,
        extensions,
        limit: providerLimit,
      }, dependencies.ripgrep);
      attempts.push({
        provider: ripgrep.provider ?? "unavailable",
        status: ripgrep.status,
        ...(ripgrep.status === "success" ? {} : { reason: ripgrep.reason }),
      });
      if (ripgrep.status === "success") {
        nextMatches = ripgrep.matches;
        providers.push(ripgrep.provider);
        contentProviderResolved = true;
      }
    } else if (capability.id === "node-content-scan-locate") {
      if (contentProviderResolved) continue;
      nextMatches = locateByNodeContentScan({
        query,
        workspaceRoot: scope.workspaceRoot,
        basePath: scope.basePath,
        extensions,
        limit: providerLimit,
        provider: capability,
      });
      providers.push("node-content-scan");
      attempts.push({ provider: "node-content-scan", status: "success" });
      contentProviderResolved = true;
    }

    for (const match of nextMatches) {
      const key = `${match.path}:${match.matchType}:${match.line ?? 0}:${match.column ?? 0}`;
      if (!matches.has(key)) {
        matches.set(key, match);
      }
    }

    if (matches.size >= providerLimit) {
      break;
    }
  }

  const allMatches = [...matches.values()];
  const visibleMatches = allMatches.slice(0, limit);
  const result: ReadLocateResult = {
    type: "locate",
    matches: visibleMatches,
    scope: scope.relativeBasePath,
    query,
    searchMode,
    returnedCount: visibleMatches.length,
    hasMore: allMatches.length > limit,
    truncated: allMatches.length > limit,
  };
  const contentProvider = providers.find((provider) =>
    provider === "bundled-ripgrep" ||
    provider === "system-ripgrep" ||
    provider === "node-content-scan"
  );
  return {
    result,
    diagnostics: {
      provider: contentProvider ?? providers[0] ?? "unavailable",
      providers,
      attempts,
    } satisfies ReadLocateDiagnostics,
  };
};

export const executeReadLocate = async (
  environment: ToolExecutionEnvironment | undefined,
  rawArgs: Record<string, unknown>,
) => (await executeReadLocateWithDiagnostics(environment, rawArgs)).result;
