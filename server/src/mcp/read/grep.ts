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
import { getWorkspaceRoot, resolveWorkspacePath } from "../workspace.js";
import {
  escapeGlobPath,
  loadWorkspaceIgnorePatterns,
  normalizeWorkspaceRelativePath,
} from "./path-policy.js";

export const DEFAULT_GREP_MAX_RESULTS = 20;
export const MAX_GREP_RESULTS = 100;
export const DEFAULT_GREP_TIMEOUT_MS = 30_000;
const GREP_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const PREVIEW_MAX_LENGTH = 120;

export type GrepProvider =
  | "bundled-ripgrep"
  | "system-ripgrep"
  | "node-content-scan";

export type GrepMatch = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

export type GrepProviderAttempt = {
  provider: GrepProvider;
  status: "success" | "failed" | "unavailable";
  reason?: string;
};

export type GrepResult = {
  type: "grep";
  pattern: string;
  root: string;
  matches: GrepMatch[];
  returnedCount: number;
  hasMore: boolean;
  truncated: boolean;
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

const normalizeExtensions = (value: unknown) => {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((extension) => typeof extension !== "string" || !extension.trim())
  ) {
    throw mcpBadRequest("extensions must be a non-empty string array when provided");
  }

  return [
    ...new Set(
      value.map((extension) => {
        const normalized = extension.trim().toLowerCase();
        return normalized.startsWith(".") ? normalized : `.${normalized}`;
      }),
    ),
  ];
};

const parseMaxResults = (value: unknown) => {
  if (value === undefined) return DEFAULT_GREP_MAX_RESULTS;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_GREP_RESULTS
  ) {
    throw mcpBadRequest("maxResults must be an integer between 1 and 100");
  }
  return value;
};

const parsePattern = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    throw mcpBadRequest("pattern is required");
  }
  return value.trim();
};

const buildMatcher = (pattern: string) => {
  const flags = pattern.toLocaleLowerCase() === pattern ? "iu" : "u";
  try {
    return new RegExp(pattern, flags);
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, flags);
  }
};

const matchesExtension = (filePath: string, extensions: string[]) =>
  extensions.length === 0 ||
  extensions.includes(path.extname(filePath).toLowerCase());

const sortMatches = (matches: GrepMatch[]) =>
  [...matches].sort(
    (left, right) =>
      left.path.localeCompare(right.path, undefined, { numeric: true }) ||
      left.line - right.line ||
      left.column - right.column,
  );

export const runBoundedProcess = (input: {
  executablePath: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxBufferBytes: number;
}): Promise<BoundedProcessResult> =>
  new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let child: ReturnType<typeof spawn>;

    const finish = (result: BoundedProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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

    const timer = setTimeout(() => {
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
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const append = (stream: "stdout" | "stderr", chunk: string) => {
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > input.maxBufferBytes) {
        terminate();
        finish({
          status: "failed",
          exitCode: child.exitCode,
          stdout,
          stderr,
          reason: "output-limit",
        });
        return;
      }
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
    };

    child.stdout.on("data", (chunk: string) => append("stdout", chunk));
    child.stderr.on("data", (chunk: string) => append("stderr", chunk));
    child.on("error", () => {
      finish({
        status: "failed",
        exitCode: child.exitCode,
        stdout,
        stderr,
        reason: "spawn-error",
      });
    });
    child.on("close", (code) => {
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
  relativeRoot: string;
  extensions: string[];
  ignorePatterns: string[];
  providerLimit: number;
}) => [
  "--json",
  "--line-number",
  "--column",
  "--smart-case",
  "--hidden",
  "--no-messages",
  "--max-count",
  String(input.providerLimit),
  ...input.ignorePatterns.flatMap((pattern) => ["--glob", `!${pattern}`]),
  ...input.extensions.flatMap((extension) => ["--glob", `*${extension}`]),
  "--",
  input.pattern,
  input.relativeRoot,
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
  relativeRoot: string;
  pattern: string;
  extensions: string[];
  providerLimit: number;
  signal: AbortSignal;
}): Promise<GrepMatch[]> => {
  const filePattern =
    input.relativeRoot === "."
      ? "**/*"
      : `${escapeGlobPath(input.relativeRoot)}/**/*`;
  const files = await fg(filePattern, {
    cwd: input.workspaceRoot,
    onlyFiles: true,
    dot: true,
    unique: true,
    suppressErrors: true,
    followSymbolicLinks: false,
    ignore: loadWorkspaceIgnorePatterns(input.workspaceRoot),
  });
  const matcher = buildMatcher(input.pattern);
  const matches: GrepMatch[] = [];

  for (const filePath of files.sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  )) {
    if (input.signal.aborted) {
      throw new Error("Grep cancelled");
    }

    const normalizedPath = normalizeWorkspaceRelativePath(filePath);
    if (!matchesExtension(normalizedPath, input.extensions)) continue;

    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(path.resolve(input.workspaceRoot, filePath));
    } catch {
      continue;
    }
    if (buffer.includes(0)) continue;

    const lines = buffer.toString("utf8").split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (input.signal.aborted) {
        throw new Error("Grep cancelled");
      }
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
): Array<{ provider: Exclude<GrepProvider, "node-content-scan">; executablePath: string }> => {
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

const finalizeResult = (input: {
  pattern: string;
  root: string;
  matches: GrepMatch[];
  maxResults: number;
  provider: GrepProvider;
  attempts: GrepProviderAttempt[];
}): GrepResult => {
  const visibleMatches = input.matches.slice(0, input.maxResults);
  const truncated = input.matches.length > input.maxResults;
  return {
    type: "grep",
    pattern: input.pattern,
    root: input.root,
    matches: visibleMatches,
    returnedCount: visibleMatches.length,
    hasMore: truncated,
    truncated,
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
  const root = typeof args.root === "string" && args.root.trim() ? args.root.trim() : ".";
  const extensions = normalizeExtensions(args.extensions);
  const maxResults = parseMaxResults(args.maxResults);
  const providerLimit = maxResults + 1;
  const workspaceRoot = getWorkspaceRoot();
  const rootPath = resolveWorkspacePath(root);
  if (!fs.existsSync(rootPath)) {
    throw mcpBadRequest(`Path does not exist: ${rootPath}`);
  }
  if (!fs.statSync(rootPath).isDirectory()) {
    throw mcpBadRequest("grep root must be a directory path");
  }
  const relativeRoot =
    normalizeWorkspaceRelativePath(path.relative(workspaceRoot, rootPath)) || ".";
  const ignorePatterns = loadWorkspaceIgnorePatterns(workspaceRoot);
  const resolution =
    dependencies.resolveExecutable?.() ?? resolveTerminalRuntimeExecutable("ripgrep");
  const attempts: GrepProviderAttempt[] = [];
  const runProcess = dependencies.runProcess ?? runBoundedProcess;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_GREP_TIMEOUT_MS;

  for (const candidate of toRipgrepCandidates(resolution)) {
    if (signal.aborted) throw new Error("Grep cancelled");

    pushEvent?.({
      type: "invocation:progress",
      message: `Grep provider: ${candidate.provider}`,
    });

    const processResult = await runProcess({
      executablePath: candidate.executablePath,
      args: buildRipgrepArgs({
        pattern,
        relativeRoot,
        extensions,
        ignorePatterns,
        providerLimit,
      }),
      cwd: workspaceRoot,
      signal,
      timeoutMs,
      maxBufferBytes: GREP_MAX_BUFFER_BYTES,
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
    const contents = finalizeResult({
      pattern,
      root,
      matches,
      maxResults,
      provider: candidate.provider,
      attempts,
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
            root,
            provider: candidate.provider,
            providerAttempts: attempts,
            returnedCount: contents.returnedCount,
            truncated: contents.truncated,
          },
        }),
      ],
    };
  }

  pushEvent?.({
    type: "invocation:progress",
    message: "Grep provider: node-content-scan fallback",
  });
  const nodeMatches = await executeNodeFallback({
    workspaceRoot,
    relativeRoot,
    pattern,
    extensions,
    providerLimit,
    signal,
  });
  attempts.push({ provider: "node-content-scan", status: "success" });
  const contents = finalizeResult({
    pattern,
    root,
    matches: nodeMatches,
    maxResults,
    provider: "node-content-scan",
    attempts,
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
          root,
          provider: "node-content-scan",
          providerAttempts: attempts,
          returnedCount: contents.returnedCount,
          truncated: contents.truncated,
        },
      }),
    ],
  };
};
