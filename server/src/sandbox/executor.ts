import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { McpExecutionEnvironment } from "@/mcp/core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "@/mcp/core/errors.js";
import { decodeTerminalOutput } from "@/mcp/terminal/encoding.js";
import { resolveWorkspaceDirectoryPath, resolveWorkspacePath } from "@/mcp/workspace.js";
import type {
  SandboxArtifact,
  SandboxArtifactKind,
  SandboxArtifactRegistration,
  SandboxOutputEncoding,
} from "@/harness/sandbox/contract.js";
import { assertSandboxCommandPolicy } from "./policy.js";

export interface SandboxShellProfile {
  shell: string;
  argsMode: "powershell" | "cmd" | "posix";
  stdoutEncoding: string;
  stderrEncoding: string;
}

export interface SandboxExecutionInput {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  outputLimitBytes?: number;
  artifactRegistrations?: SandboxArtifactRegistration[];
  signal: AbortSignal;
  shellProfile: SandboxShellProfile;
  pushStdout?: (chunk: string) => void;
  pushStderr?: (chunk: string) => void;
}

export interface SandboxExecutionResult {
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutEncoding: SandboxOutputEncoding;
  stderrEncoding: SandboxOutputEncoding;
  output: string;
  truncated: boolean;
  binaryDetected: boolean;
  violations: string[];
  artifacts: SandboxArtifact[];
}

const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const WINDOWS_EXIT_DRAIN_GRACE_MS = 100;

const BINARY_PLACEHOLDER_TEXT = "[binary output omitted]";

const SAFE_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "LANG",
  "TERM",
] as const;

const toCombinedOutput = (stdout: string, stderr: string) =>
  [stdout, stderr].filter(Boolean).join("\n").trimEnd();

const buildShellArgs = (profile: SandboxShellProfile, command: string) => {
  if (profile.argsMode === "powershell") {
    // The L1 sandbox contract is non-interactive. Windows PowerShell can keep
    // the host process alive after ordinary cmdlets on redirected CI runners,
    // so terminate the command invocation explicitly while preserving a native
    // command's LASTEXITCODE when one exists.
    return [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        command,
        "$__mira_success = $?",
        "$__mira_native_exit = $LASTEXITCODE",
        "if ($null -ne $__mira_native_exit) { exit $__mira_native_exit }",
        "if ($__mira_success) { exit 0 }",
        "exit 1",
      ].join("; "),
    ];
  }

  if (profile.argsMode === "cmd") {
    return ["/d", "/s", "/c", command];
  }

  return ["-lc", command];
};

const hasParentSegment = (inputPath: string) =>
  inputPath
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .some((segment) => segment === "..");

const isAbsoluteInputPath = (inputPath: string) =>
  path.isAbsolute(inputPath) || path.win32.isAbsolute(inputPath) || path.posix.isAbsolute(inputPath);

export const resolveSandboxCwd = (cwd?: string) => {
  const normalizedCwd = cwd?.trim() || ".";
  if (normalizedCwd !== "." && (hasParentSegment(normalizedCwd) || isAbsoluteInputPath(normalizedCwd))) {
    throw mcpBadRequest("cwd must be a relative workspace directory without parent traversal");
  }

  return resolveWorkspaceDirectoryPath(normalizedCwd);
};

const findAllowedEnvKey = (inputKey: string) =>
  SAFE_ENV_ALLOWLIST.find((allowedKey) =>
    process.platform === "win32"
      ? allowedKey.toLowerCase() === inputKey.toLowerCase()
      : allowedKey === inputKey,
  );

const findProcessEnvValue = (inputKey: string) => {
  if (typeof process.env[inputKey] === "string") {
    return process.env[inputKey];
  }

  if (process.platform !== "win32") {
    return undefined;
  }

  const actualKey = Object.keys(process.env).find(
    (key) => key.toLowerCase() === inputKey.toLowerCase(),
  );
  return actualKey ? process.env[actualKey] : undefined;
};

export const resolveSandboxEnv = (overrides?: Record<string, string>) => {
  const base = Object.fromEntries(
    SAFE_ENV_ALLOWLIST.flatMap((key) => {
      const value = findProcessEnvValue(key);
      return typeof value === "string" ? [[key, value]] : [];
    }),
  );

  const allowedOverrides = Object.fromEntries(
    Object.entries(overrides ?? {}).flatMap(([key, value]) => {
      const allowedKey = findAllowedEnvKey(key);
      return allowedKey && typeof value === "string" ? [[allowedKey, value]] : [];
    }),
  );

  return {
    ...base,
    ...allowedOverrides,
  };
};

const normalizeTimeoutMs = (timeoutMs: number) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw mcpBadRequest("timeoutMs must be a positive finite number");
  }

  return Math.min(Math.trunc(timeoutMs), MAX_TIMEOUT_MS);
};

const normalizeOutputLimitBytes = (outputLimitBytes?: number) => {
  const normalized = outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw mcpBadRequest("outputLimitBytes must be a positive finite number");
  }

  return Math.min(Math.trunc(normalized), MAX_OUTPUT_LIMIT_BYTES);
};

const normalizeReportedEncoding = (encoding: string): SandboxOutputEncoding => {
  const normalized = encoding.trim().toLowerCase();
  if (normalized === "utf8" || normalized === "utf-8") {
    return "utf8";
  }

  if (
    normalized === "gbk" ||
    normalized === "gb2312" ||
    normalized === "gb18030" ||
    normalized === "cp936"
  ) {
    return "gbk";
  }

  if (normalized === "utf16le" || normalized === "utf-16le") {
    return "utf16le";
  }

  return "unknown";
};

const hasBinarySignature = (chunk: Buffer | string, encoding: string) => {
  if (typeof chunk === "string") {
    return false;
  }

  const reportedEncoding = normalizeReportedEncoding(encoding);
  if (chunk.includes(0)) {
    if (reportedEncoding === "utf16le" && looksLikeUtf16Le(chunk)) {
      return false;
    }
    return true;
  }

  if (chunk.length < 24) {
    return false;
  }

  let suspiciousBytes = 0;
  for (const byte of chunk) {
    const isAllowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    const isPrintableAscii = byte >= 0x20 && byte <= 0x7e;
    const isExtendedByte = byte >= 0x80;
    if (!isAllowedControl && !isPrintableAscii && !isExtendedByte) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes / chunk.length > 0.3;
};

const looksLikeUtf16Le = (chunk: Buffer) => {
  if (chunk.length < 2 || chunk.length % 2 !== 0) {
    return false;
  }

  if (chunk[0] === 0xff && chunk[1] === 0xfe) {
    return true;
  }

  let zeroBytesOnOddPositions = 0;
  for (let index = 1; index < chunk.length; index += 2) {
    if (chunk[index] === 0x00) {
      zeroBytesOnOddPositions += 1;
    }
  }

  return zeroBytesOnOddPositions / Math.ceil(chunk.length / 2) > 0.3;
};

const decodeChunk = (
  chunk: Buffer | string,
  encoding: string,
): { text: string; encoding: SandboxOutputEncoding; failed: boolean } => {
  if (typeof chunk === "string") {
    return {
      text: chunk,
      encoding: normalizeReportedEncoding(encoding),
      failed: false,
    };
  }

  const reportedEncoding = normalizeReportedEncoding(encoding);
  try {
    if (reportedEncoding === "utf16le" && !looksLikeUtf16Le(chunk)) {
      return {
        text: chunk.toString("utf8"),
        encoding: "utf8",
        failed: false,
      };
    }

    return {
      text: decodeTerminalOutput({
        chunk,
        encoding,
      }),
      encoding: reportedEncoding,
      failed: false,
    };
  } catch {
    return {
      text: "",
      encoding: "unknown",
      failed: true,
    };
  }
};

const inferMimeTypeFromPath = (targetPath: string) => {
  const extension = path.extname(targetPath).toLowerCase();
  switch (extension) {
    case ".txt":
    case ".log":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".html":
      return "text/html";
    case ".csv":
      return "text/csv";
    case ".patch":
    case ".diff":
      return "text/x-diff";
    default:
      return "application/octet-stream";
  }
};

const resolveRegisteredArtifactKind = (
  registration: SandboxArtifactRegistration,
  isDirectory: boolean,
): SandboxArtifactKind => {
  if (registration.kind) {
    return registration.kind;
  }

  return isDirectory ? "directory" : "file";
};

const buildRegisteredArtifacts = async (
  registrations: SandboxArtifactRegistration[] | undefined,
  violations: string[],
): Promise<SandboxArtifact[]> => {
  if (!registrations?.length) {
    return [];
  }

  const artifacts: SandboxArtifact[] = [];
  for (const registration of registrations) {
    try {
      const resolvedPath = resolveWorkspacePath(registration.path);
      const stats = await stat(resolvedPath);
      const kind = resolveRegisteredArtifactKind(registration, stats.isDirectory());
      artifacts.push({
        id: crypto.randomUUID(),
        kind,
        path: resolvedPath,
        size: stats.size,
        ...(stats.isFile()
          ? { mime: inferMimeTypeFromPath(resolvedPath) }
          : {}),
        createdAt: stats.birthtime.toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      violations.push(`artifact registration skipped: ${registration.path} (${message})`);
    }
  }

  return artifacts;
};

const killProcessTree = async (pid: number | undefined) => {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
};

const bestEffortKillChild = (child: ReturnType<typeof spawn>) => {
  try {
    child.kill();
  } catch {
    // ignore
  }
};

export const executeSandboxedCommand = async (
  input: SandboxExecutionInput,
): Promise<SandboxExecutionResult> => {
  if (input.signal.aborted) {
    throw new Error("Terminal session aborted");
  }

  assertSandboxCommandPolicy(input.command);
  const cwd = resolveSandboxCwd(input.cwd);
  const env = resolveSandboxEnv(input.env);
  const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
  const outputLimitBytes = normalizeOutputLimitBytes(input.outputLimitBytes);

  const child = spawn(
    input.shellProfile.shell,
    buildShellArgs(input.shellProfile, input.command),
    {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      // L1 Sandbox commands are non-interactive. Keeping the default piped
      // stdin open can leave powershell.exe waiting on Windows CI after the
      // command has produced its output, so close stdin explicitly.
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutBinaryDetected = false;
  let stderrBinaryDetected = false;
  let stdoutDetectedEncoding = normalizeReportedEncoding(input.shellProfile.stdoutEncoding);
  let stderrDetectedEncoding = normalizeReportedEncoding(input.shellProfile.stderrEncoding);
  let exitCode: number | null = null;
  let timedOut = false;
  let truncated = false;
  const violations: string[] = [];
  let settled = false;
  let failExecution: ((error: Error) => void) | null = null;
  let windowsExitDrainTimer: NodeJS.Timeout | null = null;
  let exitObserved = false;
  let stdoutEnded = !child.stdout;
  let stderrEnded = !child.stderr;

  const appendChunk = (
    target: string[],
    chunk: Buffer | string,
    stream: "stdout" | "stderr",
    encoding: string,
  ) => {
    const nextBytes = typeof chunk === "string" ? Buffer.byteLength(chunk, "utf-8") : chunk.length;
    if (stream === "stdout") {
      stdoutBytes += nextBytes;
    } else {
      stderrBytes += nextBytes;
    }

    if (stdoutBytes + stderrBytes > outputLimitBytes) {
      truncated = true;
      violations.push(`terminal output exceeded limit of ${outputLimitBytes} bytes`);
      failExecution?.(
        mcpBadRequest(`terminal output exceeded limit of ${outputLimitBytes} bytes`),
      );
      bestEffortKillChild(child);
      void killProcessTree(child.pid);
      return;
    }

    const decoded = decodeChunk(chunk, encoding);
    if (decoded.failed || hasBinarySignature(chunk, encoding)) {
      if (stream === "stdout") {
        stdoutBinaryDetected = true;
      } else {
        stderrBinaryDetected = true;
      }
      target.length = 0;
      target.push(BINARY_PLACEHOLDER_TEXT);
      return;
    }

    if ((stream === "stdout" && stdoutBinaryDetected) || (stream === "stderr" && stderrBinaryDetected)) {
      return;
    }

    if (stream === "stdout") {
      stdoutDetectedEncoding = decoded.encoding;
    } else {
      stderrDetectedEncoding = decoded.encoding;
    }
    const text = decoded.text;
    target.push(text);
  };

  await new Promise<void>((resolve, reject) => {
    const clearWindowsExitDrainTimer = () => {
      if (windowsExitDrainTimer) {
        clearTimeout(windowsExitDrainTimer);
        windowsExitDrainTimer = null;
      }
    };

    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearWindowsExitDrainTimer();
      resolve();
    };

    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearWindowsExitDrainTimer();
      reject(error);
    };
    failExecution = finishReject;

    const timer = setTimeout(() => {
      timedOut = true;
      violations.push(`terminal execution timed out after ${timeoutMs}ms`);
      if (process.platform === "win32") {
        violations.push(
          "windows_kill_tree_best_effort: taskkill /t /f is used after timeout, but descendant cleanup cannot be guaranteed",
        );
      }
      bestEffortKillChild(child);
      void killProcessTree(child.pid);
      finishResolve();
    }, timeoutMs);

    const finishAfterWindowsExit = () => {
      if (
        process.platform !== "win32" ||
        !exitObserved ||
        settled ||
        !stdoutEnded ||
        !stderrEnded
      ) {
        return;
      }
      clearTimeout(timer);
      finishResolve();
    };

    child.stdout?.once("end", () => {
      stdoutEnded = true;
      finishAfterWindowsExit();
    });
    child.stderr?.once("end", () => {
      stderrEnded = true;
      finishAfterWindowsExit();
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      try {
        appendChunk(stdoutChunks, chunk, "stdout", input.shellProfile.stdoutEncoding);
        if (!stdoutBinaryDetected) {
          input.pushStdout?.(stdoutChunks[stdoutChunks.length - 1] ?? "");
        }
      } catch (error) {
        clearTimeout(timer);
        finishReject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      try {
        appendChunk(stderrChunks, chunk, "stderr", input.shellProfile.stderrEncoding);
        if (!stderrBinaryDetected) {
          input.pushStderr?.(stderrChunks[stderrChunks.length - 1] ?? "");
        }
      } catch (error) {
        clearTimeout(timer);
        finishReject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    child.once("error", (error) => {
      clearTimeout(timer);
      finishReject(error instanceof Error ? error : new Error(String(error)));
    });

    child.once("exit", (code) => {
      exitObserved = true;
      exitCode = code;

      if (process.platform !== "win32" || settled) {
        return;
      }

      finishAfterWindowsExit();
      if (settled) {
        return;
      }

      clearWindowsExitDrainTimer();
      windowsExitDrainTimer = setTimeout(() => {
        if (settled) {
          return;
        }
        clearTimeout(timer);
        child.stdout?.destroy();
        child.stderr?.destroy();
        finishResolve();
      }, WINDOWS_EXIT_DRAIN_GRACE_MS);
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      exitCode = code ?? exitCode;
      finishResolve();
    });

    if (input.signal.aborted) {
      clearTimeout(timer);
      finishReject(new Error("Terminal session aborted"));
      bestEffortKillChild(child);
      void killProcessTree(child.pid);
      return;
    }

    input.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        finishReject(new Error("Terminal session aborted"));
        bestEffortKillChild(child);
        void killProcessTree(child.pid);
      },
      { once: true },
    );
  }).catch((error) => {
    throw error instanceof Error ? error : mcpInternalError(String(error));
  });

  const stdout = stdoutChunks.join("").trimEnd();
  const stderr = stderrChunks.join("").trimEnd();
  const artifacts = await buildRegisteredArtifacts(input.artifactRegistrations, violations);

  return {
    cwd,
    exitCode,
    timedOut,
    stdout,
    stderr,
    stdoutEncoding: stdoutBinaryDetected ? "unknown" : stdoutDetectedEncoding,
    stderrEncoding: stderrBinaryDetected ? "unknown" : stderrDetectedEncoding,
    output: toCombinedOutput(stdout, stderr),
    truncated,
    binaryDetected: stdoutBinaryDetected || stderrBinaryDetected,
    violations,
    artifacts,
  };
};

export const createSandboxShellProfile = (
  environment: McpExecutionEnvironment["terminal"]["shellProfile"],
): SandboxShellProfile => ({
  shell: environment.shell,
  argsMode: environment.argsMode,
  stdoutEncoding: environment.stdoutEncoding,
  stderrEncoding: environment.stderrEncoding,
});
