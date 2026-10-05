import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import fg from "fast-glob";
import { createArtifact } from "../core/artifacts.js";
import type {
  ToolArtifact,
  ToolExecutionEnvironment,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { resolveTerminalRuntimeExecutable } from "../terminal/dev-runtime.js";
import { resolveWorkspaceDirectoryPath } from "../workspace.js";
import { buildContinuation, parseBoundedLimit, parseOffset } from "./paging.js";
import {
  escapeGlobPath,
  filterGitIgnoredPaths,
  normalizeWorkspaceRelativePath,
  resolveWorkspaceIgnorePatterns,
} from "./path-policy.js";

export const DEFAULT_GREP_LIMIT = 100;
export const MAX_GREP_LIMIT = 500;
export const MAX_GREP_CONTEXT = 20;
export const DEFAULT_GREP_TIMEOUT_MS = 30_000;
const GREP_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const PREVIEW_MAX_LENGTH = 160;

export type GrepProvider =
  | "bundled-ripgrep"
  | "system-ripgrep"
  | "node-content-scan";

export type GrepMatch = {
  path: string;
  line: number;
  column: number;
  preview: string;
  before?: string[];
  after?: string[];
};

export type GrepProviderAttempt = {
  provider: GrepProvider;
  status: "success" | "failed" | "unavailable";
  reason?: string;
};

export type GrepResult = {
  type: "grep";
  pattern: string;
  path: string;
  include?: string;
  literal: boolean;
  caseSensitive?: boolean;
  context: number;
  matches: GrepMatch[];
  offset: number;
  limit: number;
  returnedCount: number;
  hasMore: boolean;
  truncated: boolean;
  nextOffset?: number;
  provider: GrepProvider;
  providerAttempts: GrepProviderAttempt[];
};

type GrepExecutionContext = {
  args: Record<string, unknown>;
  environment?: ToolExecutionEnvironment;
  signal: AbortSignal;
  pushEvent?: (event: ToolInvocationEventInput) => void;
};

type GrepExecutionResult = {
  contents: GrepResult;
  artifacts: ToolArtifact[];
};

type RipgrepResolution = {
  source: "bundled" | "system" | "unavailable";
  executablePath?: string;
};

export type BoundedProcessResult =
  | {
      status: "completed";
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }
  | {
      status: "failed";
      exitCode: number | null;
      stdout: string;
      stderr: string;
      reason: "spawn-error" | "output-limit";
    }
  | {
      status: "cancelled";
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }
  | {
      status: "timed_out";
      exitCode: number | null;
      stdout: string;
      stderr: string;
    };

export type GrepRuntimeDependencies = {
  resolveExecutable?: () => RipgrepResolution;
  runProcess?: typeof runBoundedProcess;
  timeoutMs?: number;
};

const assertHarnessEnvironment = (
  environment?: ToolExecutionEnvironment,
): ToolExecutionEnvironment => {
  if (!environment || environment.source !== "harness") {
    throw mcpInternalError("Grep execution requires a harness environment snapshot");
  }
  return environment;
};

const shortenPreview = (value: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, PREVIEW_MAX_LENGTH - 3).trimEnd()}...`;
};

const readJsonText = (value: unknown) => {
  if (!value || typeof value !== "object") return "";
  const record = value as { text?: unknown; bytes?: unknown };
  if (typeof record.text === "string") return record.text;
  if (typeof record.bytes === "string") {
    return Buffer.from(record.bytes, "base64").toString("utf8");
  }
  return "";
};

const parsePattern = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    throw mcpBadRequest("pattern is required");
  }
  return value.trim();
};

const parseOptionalBoolean = (value: unknown, name: string) => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw mcpBadRequest(`${name} must be a boolean`);
  }
  return value;
};

const parseInclude = (value: unknown) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw mcpBadRequest("include must be a non-empty glob string");
  }
  const normalized = normalizeWorkspaceRelativePath(value.trim());
  if (
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw mcpBadRequest("include must stay inside the selected path");
  }
  return normalized;
};

const parseContext = (value: unknown) => {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw mcpBadRequest("context must be a non-negative integer");
  }
  return Math.min(value, MAX_GREP_CONTEXT);
};

const regexEscape = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildMatcher = (input: {
  pattern: string;
  literal: boolean;
  caseSensitive?: boolean;
}) => {
  const source = input.literal ? regexEscape(input.pattern) : input.pattern;
  const caseSensitive =
    input.caseSensitive ??
    (input.pattern.toLocaleLowerCase() !== input.pattern);
  try {
    return new RegExp(source, caseSensitive ? "u" : "iu");
  } catch {
    throw mcpBadRequest(`Invalid grep regular expression: ${input.pattern}`);
  }
};

const sortMatches = (matches: GrepMatch[]) =>
  [...matches].sort(
    (left, right) =>
      left.path.localeCompare(right.path, undefined, { numeric: true }) ||
      left.line - right.line ||
      left.column - right.column,
  );

const assertActive = (input: {
  signal: AbortSignal;
  deadlineAt: number;
  timeoutMs: number;
}) => {
  if (input.signal.aborted) {
    throw new Error("Grep cancelled");
  }
  if (Date.now() >= input.deadlineAt) {
    throw mcpInternalError(`grep timed out after ${input.timeoutMs}ms`);
  }
};

export const runBoundedProcess = (input: {
  executablePath: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxBufferBytes: number;
  shouldStopAfterStdoutChunk?: (chunk: string) => boolean;
}): Promise<BoundedProcessResult> =>
  new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let child: ReturnType<typeof spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: BoundedProcessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      input.signal.removeEventListener("abort", abort);
      resolve(result);
    };

    const terminate = () => {
      try {
        child?.kill();
      } catch {
        // Process may already be gone.
      }
    };

    const abort = () => {
      terminate();
      finish({
        status: "cancelled",
        exitCode: child?.exitCode ?? null,
        stdout,
        stderr,
      });
    };

    timer = setTimeout(() => {
      terminate();
      finish({
        status: "timed_out",
        exitCode: child?.exitCode ?? null,
        stdout,
        stderr,
      });
    }, input.timeoutMs);

    if (input.signal.aborted) {
      abort();
      return;
    }

    try {
      child = spawn(input.executablePath, input.args, {
        cwd: input.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      finish({
        status: "failed",
        exitCode: null,
        stdout,
        stderr,
        reason: "spawn-error",
      });
      return;
    }

    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) {
      abort();
      return;
    }
    if (!child) {
      finish({
        status: "failed",
        exitCode: null,
        stdout,
        stderr,
        reason: "spawn-error",
      });
      return;
    }

    const activeChild = child;
    const stdoutStream = activeChild.stdout;
    const stderrStream = activeChild.stderr;
    if (!stdoutStream || !stderrStream) {
      finish({
        status: "failed",
        exitCode: activeChild.exitCode,
        stdout,
        stderr,
        reason: "spawn-error",
      });
      return;
    }

    stdoutStream.setEncoding("utf8");
    stderrStream.setEncoding("utf8");

    const append = (stream: "stdout" | "stderr", chunk: string) => {
      if (settled) return;
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > input.maxBufferBytes) {
        terminate();
        finish({
          status: "failed",
          exitCode: activeChild.exitCode,
          stdout,
          stderr,
          reason: "output-limit",
        });
        return;
      }
      if (stream === "stdout") {
        stdout += chunk;
        if (input.shouldStopAfterStdoutChunk?.(chunk)) {
          terminate();
          finish({
            status: "completed",
            exitCode: activeChild.exitCode,
            stdout,
            stderr,
          });
        }
      } else {
        stderr += chunk;
      }
    };

    stdoutStream.on("data", (chunk: string) => append("stdout", chunk));
    stderrStream.on("data", (chunk: string) => append("stderr", chunk));
    activeChild.on("error", () => {
      finish({
        status: "failed",
        exitCode: activeChild.exitCode,
        stdout,
        stderr,
        reason: "spawn-error",
      });
    });
    activeChild.on("close", (code) => {
      finish({
        status: "completed",
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });

const buildRipgrepArgs = (input: {
  pattern: string;
  relativePath: string;
  include?: string;
  literal: boolean;
  caseSensitive?: boolean;
  includeIgnored: boolean;
  ignorePatterns: string[];
  providerLimit: number;
}) => [
  "--json",
  "--line-number",
  "--column",
  "--hidden",
  "--no-messages",
  "--sort",
  "path",
  "--max-count",
  String(input.providerLimit),
  ...(input.literal ? ["--fixed-strings"] : []),
  ...(input.caseSensitive === true
    ? ["--case-sensitive"]
    : input.caseSensitive === false
      ? ["--ignore-case"]
      : ["--smart-case"]),
  ...(input.includeIgnored ? ["--no-ignore"] : []),
  ...(input.include ? ["--glob", input.include] : []),
  ...(!input.includeIgnored
    ? input.ignorePatterns.flatMap((pattern) => ["--glob", `!${pattern}`])
    : []),
  "--",
  input.pattern,
  input.relativePath,
];

const parseRipgrepOutput = (input: {
  stdout: string;
  providerLimit: number;
}): GrepMatch[] => {
  const matches: GrepMatch[] = [];

  for (const line of input.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const payload = JSON.parse(line) as {
      type?: string;
      data?: {
        path?: unknown;
        lines?: unknown;
        line_number?: unknown;
        submatches?: Array<{ start?: unknown }>;
      };
    };
    if (payload.type !== "match" || !payload.data) continue;

    const filePath = readJsonText(payload.data.path);
    const lineNumber = Number(payload.data.line_number);
    const firstSubmatch = payload.data.submatches?.[0];
    if (!filePath || !Number.isFinite(lineNumber)) continue;

    matches.push({
      path: normalizeWorkspaceRelativePath(filePath),
      line: lineNumber,
      column: Number(firstSubmatch?.start ?? 0) + 1,
      preview: shortenPreview(readJsonText(payload.data.lines)),
    });

    if (matches.length >= input.providerLimit) break;
  }

  return sortMatches(matches);
};

const executeNodeFallback = async (input: {
  workspaceRoot: string;
  relativePath: string;
  pattern: string;
  include?: string;
  literal: boolean;
  caseSensitive?: boolean;
  includeIgnored: boolean;
  providerLimit: number;
  signal: AbortSignal;
  deadlineAt: number;
  timeoutMs: number;
}): Promise<GrepMatch[]> => {
  assertActive(input);

  const localPattern = input.include ?? "**/*";
  const filePattern =
    input.relativePath === "."
      ? localPattern
      : `${escapeGlobPath(input.relativePath)}/${localPattern}`;
  const discoveredFiles = await fg(filePattern, {
    cwd: input.workspaceRoot,
    onlyFiles: true,
    dot: true,
    unique: true,
    suppressErrors: true,
    followSymbolicLinks: false,
    ignore: resolveWorkspaceIgnorePatterns(
      input.workspaceRoot,
      input.includeIgnored,
    ),
  });
  const files = await filterGitIgnoredPaths(
    input.workspaceRoot,
    discoveredFiles.map(normalizeWorkspaceRelativePath),
    input.includeIgnored,
    {
      signal: input.signal,
      timeoutMs: Math.max(1, input.deadlineAt - Date.now()),
    },
  );

  assertActive(input);
  const matcher = buildMatcher({
    pattern: input.pattern,
    literal: input.literal,
    caseSensitive: input.caseSensitive,
  });
  const matches: GrepMatch[] = [];

  for (const filePath of files.sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  )) {
    assertActive(input);

    const normalizedPath = normalizeWorkspaceRelativePath(filePath);
    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(
        path.resolve(input.workspaceRoot, filePath),
      );
    } catch {
      continue;
    }
    if (buffer.includes(0)) continue;

    const lines = buffer.toString("utf8").split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      assertActive(input);
      const line = lines[lineIndex] ?? "";
      const match = matcher.exec(line);
      if (!match) continue;

      matches.push({
        path: normalizedPath,
        line: lineIndex + 1,
        column: match.index + 1,
        preview: shortenPreview(line),
      });
      if (matches.length >= input.providerLimit) {
        return sortMatches(matches);
      }
    }
  }

  return sortMatches(matches);
};

const toRipgrepCandidates = (
  resolution: RipgrepResolution,
): Array<{
  provider: Exclude<GrepProvider, "node-content-scan">;
  executablePath: string;
}> => {
  if (resolution.source === "system" && resolution.executablePath) {
    return [{ provider: "system-ripgrep", executablePath: resolution.executablePath }];
  }
  if (resolution.source === "bundled" && resolution.executablePath) {
    return [
      { provider: "bundled-ripgrep", executablePath: resolution.executablePath },
      {
        provider: "system-ripgrep",
        executablePath: process.platform === "win32" ? "rg.exe" : "rg",
      },
    ];
  }
  return [];
};

const enrichContext = async (input: {
  workspaceRoot: string;
  matches: GrepMatch[];
  context: number;
  signal: AbortSignal;
  deadlineAt: number;
  timeoutMs: number;
}) => {
  if (input.context <= 0 || input.matches.length === 0) {
    return input.matches;
  }

  const cache = new Map<string, string[]>();
  const result: GrepMatch[] = [];
  for (const match of input.matches) {
    assertActive(input);
    let lines = cache.get(match.path);
    if (!lines) {
      try {
        const content = await fs.promises.readFile(
          path.resolve(input.workspaceRoot, match.path),
          "utf8",
        );
        lines = content.split(/\r?\n/);
        cache.set(match.path, lines);
      } catch {
        result.push(match);
        continue;
      }
    }

    const lineIndex = Math.max(0, match.line - 1);
    result.push({
      ...match,
      before: lines.slice(Math.max(0, lineIndex - input.context), lineIndex),
      after: lines.slice(lineIndex + 1, lineIndex + 1 + input.context),
    });
  }
  return result;
};

const finalizeResult = async (input: {
  workspaceRoot: string;
  pattern: string;
  path: string;
  include?: string;
  literal: boolean;
  caseSensitive?: boolean;
  context: number;
  matches: GrepMatch[];
  offset: number;
  limit: number;
  provider: GrepProvider;
  attempts: GrepProviderAttempt[];
  signal: AbortSignal;
  deadlineAt: number;
  timeoutMs: number;
}): Promise<GrepResult> => {
  const visible = input.matches.slice(input.offset, input.offset + input.limit);
  const continuation = buildContinuation({
    offset: input.offset,
    returnedCount: visible.length,
    hasMore: input.matches.length > input.offset + visible.length,
  });
  const matches = await enrichContext({
    workspaceRoot: input.workspaceRoot,
    matches: visible,
    context: input.context,
    signal: input.signal,
    deadlineAt: input.deadlineAt,
    timeoutMs: input.timeoutMs,
  });

  return {
    type: "grep",
    pattern: input.pattern,
    path: input.path,
    ...(input.include ? { include: input.include } : {}),
    literal: input.literal,
    ...(input.caseSensitive === undefined
      ? {}
      : { caseSensitive: input.caseSensitive }),
    context: input.context,
    matches,
    offset: input.offset,
    limit: input.limit,
    returnedCount: continuation.returnedCount,
    hasMore: continuation.hasMore,
    truncated: continuation.truncated,
    ...(continuation.nextOffset === undefined
      ? {}
      : { nextOffset: continuation.nextOffset }),
    provider: input.provider,
    providerAttempts: input.attempts,
  };
};

export const executeGrep = async (
  {
    args,
    environment,
    signal,
    pushEvent,
  }: GrepExecutionContext,
  dependencies: GrepRuntimeDependencies = {},
): Promise<GrepExecutionResult> => {
  assertHarnessEnvironment(environment);

  const pattern = parsePattern(args.pattern);
  const inputPath =
    typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
  const include = parseInclude(args.include);
  const literal = parseOptionalBoolean(args.literal, "literal") ?? false;
  const caseSensitive = parseOptionalBoolean(
    args.caseSensitive,
    "caseSensitive",
  );
  const context = parseContext(args.context);
  const offset = parseOffset(args.offset);
  const limit = parseBoundedLimit(args.limit, {
    defaultValue: DEFAULT_GREP_LIMIT,
    maxValue: MAX_GREP_LIMIT,
  });
  const includeIgnored =
    parseOptionalBoolean(args.includeIgnored, "includeIgnored") ?? false;
  const providerLimit = offset + limit + 1;

  const workspaceRoot = resolveWorkspaceDirectoryPath(".");
  const targetPath = resolveWorkspaceDirectoryPath(inputPath);

  const relativePath =
    normalizeWorkspaceRelativePath(path.relative(workspaceRoot, targetPath)) || ".";
  const ignorePatterns = resolveWorkspaceIgnorePatterns(
    workspaceRoot,
    includeIgnored,
  );
  const resolution =
    dependencies.resolveExecutable?.() ?? resolveTerminalRuntimeExecutable("ripgrep");
  const attempts: GrepProviderAttempt[] = [];
  const runProcess = dependencies.runProcess ?? runBoundedProcess;
  const timeoutMs = Math.max(
    1,
    dependencies.timeoutMs ?? DEFAULT_GREP_TIMEOUT_MS,
  );
  const deadlineAt = Date.now() + timeoutMs;
  const candidates = toRipgrepCandidates(resolution);

  const createGlobalMatchStopper = () => {
    let pending = "";
    let matchCount = 0;
    return (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const payload = JSON.parse(line) as { type?: string };
          if (payload.type === "match") {
            matchCount += 1;
            if (matchCount >= providerLimit) return true;
          }
        } catch {
          // Let the normal parser report invalid JSON after the process stops.
        }
      }
      return false;
    };
  };

  if (candidates.length === 0) {
    attempts.push({
      provider: "system-ripgrep",
      status: "unavailable",
      reason: "runtime-unavailable",
    });
  }

  for (const candidate of candidates) {
    assertActive({ signal, deadlineAt, timeoutMs });

    pushEvent?.({
      type: "invocation:progress",
      message: `Grep provider: ${candidate.provider}`,
    });

    const processResult = await runProcess({
      executablePath: candidate.executablePath,
      args: buildRipgrepArgs({
        pattern,
        relativePath,
        include,
        literal,
        caseSensitive,
        includeIgnored,
        ignorePatterns,
        providerLimit,
      }),
      cwd: workspaceRoot,
      signal,
      timeoutMs: Math.max(1, deadlineAt - Date.now()),
      maxBufferBytes: GREP_MAX_BUFFER_BYTES,
      shouldStopAfterStdoutChunk: createGlobalMatchStopper(),
    });

    if (processResult.status === "cancelled") {
      throw new Error("Grep cancelled");
    }
    if (processResult.status === "timed_out") {
      throw mcpInternalError(`grep timed out after ${timeoutMs}ms`);
    }
    if (processResult.status === "failed") {
      attempts.push({
        provider: candidate.provider,
        status: "failed",
        reason: processResult.reason,
      });
      continue;
    }
    if (processResult.exitCode !== 0 && processResult.exitCode !== 1) {
      attempts.push({
        provider: candidate.provider,
        status: "failed",
        reason: `exit-status-${processResult.exitCode ?? "unknown"}`,
      });
      continue;
    }

    let matches: GrepMatch[];
    try {
      matches = parseRipgrepOutput({
        stdout: processResult.stdout,
        providerLimit,
      });
    } catch {
      attempts.push({
        provider: candidate.provider,
        status: "failed",
        reason: "invalid-json-output",
      });
      continue;
    }

    attempts.push({ provider: candidate.provider, status: "success" });
    const contents = await finalizeResult({
      workspaceRoot,
      pattern,
      path: inputPath,
      include,
      literal,
      caseSensitive,
      context,
      matches,
      offset,
      limit,
      provider: candidate.provider,
      attempts,
      signal,
      deadlineAt,
      timeoutMs,
    });
    return {
      contents,
      artifacts: [
        createArtifact({
          kind: "search-results",
          title: `Grep ${pattern}`,
          data: contents.matches,
          metadata: {
            pattern,
            path: inputPath,
            include,
            literal,
            caseSensitive,
            context,
            offset,
            limit,
            provider: candidate.provider,
            providerAttempts: attempts,
            returnedCount: contents.returnedCount,
            hasMore: contents.hasMore,
            includeIgnored,
            ...(contents.nextOffset === undefined
              ? {}
              : { nextOffset: contents.nextOffset }),
          },
        }),
      ],
    };
  }

  assertActive({ signal, deadlineAt, timeoutMs });
  pushEvent?.({
    type: "invocation:progress",
    message: "Grep provider: node-content-scan fallback",
  });

  const nodeMatches = await executeNodeFallback({
    workspaceRoot,
    relativePath,
    pattern,
    include,
    literal,
    caseSensitive,
    includeIgnored,
    providerLimit,
    signal,
    deadlineAt,
    timeoutMs,
  });
  attempts.push({ provider: "node-content-scan", status: "success" });

  const contents = await finalizeResult({
    workspaceRoot,
    pattern,
    path: inputPath,
    include,
    literal,
    caseSensitive,
    context,
    matches: nodeMatches,
    offset,
    limit,
    provider: "node-content-scan",
    attempts,
    signal,
    deadlineAt,
    timeoutMs,
  });

  return {
    contents,
    artifacts: [
      createArtifact({
        kind: "search-results",
        title: `Grep ${pattern}`,
        data: contents.matches,
        metadata: {
          pattern,
          path: inputPath,
          include,
          literal,
          caseSensitive,
          context,
          offset,
          limit,
          provider: "node-content-scan",
          providerAttempts: attempts,
          returnedCount: contents.returnedCount,
          hasMore: contents.hasMore,
          includeIgnored,
          ...(contents.nextOffset === undefined
            ? {}
            : { nextOffset: contents.nextOffset }),
        },
      }),
    ],
  };
};
