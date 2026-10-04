import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

import type { SandboxOutputEncoding } from "@/harness/sandbox/contract.js";
import type { ToolExecutionEnvironment } from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { decodeTerminalOutput } from "./encoding.js";
import { killTerminalProcessTree } from "./process-tree.js";
import type {
  HostWorkspaceRelation,
  TerminalProcessTreeMode,
} from "./runtime-contract.js";
import {
  createWindowsJobCommandArgs,
  getWindowsJobMarker,
} from "./windows-job-object.js";
import { resolveTerminalDevRuntimeEnvironment } from "./dev-runtime.js";

export interface HostShellProfile {
  shell: string;
  shellFamily: "powershell" | "cmd" | "posix";
  argsMode: "powershell" | "cmd" | "posix";
  stdoutEncoding: string;
  stderrEncoding: string;
}

export interface HostExecutionInput {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  outputLimitBytes?: number;
  signal: AbortSignal;
  shellProfile: HostShellProfile;
  workspaceRoot?: string | null;
  pushStdout?: (chunk: string) => void;
  pushStderr?: (chunk: string) => void;
}

export interface HostExecutionResult {
  runtimeId: "host_spawn";
  cwd: string;
  workspaceRelation: HostWorkspaceRelation;
  processTreeMode: TerminalProcessTreeMode;
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
}

const DEFAULT_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const BINARY_PLACEHOLDER_TEXT = "[binary output omitted]";

const normalizeOutputEncoding = (encoding: string): SandboxOutputEncoding => {
  const normalized = encoding.trim().toLowerCase();
  if (normalized === "utf8" || normalized === "utf-8") return "utf8";
  if (["gbk", "gb2312", "gb18030", "cp936"].includes(normalized)) return "gbk";
  if (normalized === "utf16le" || normalized === "utf-16le") return "utf16le";
  return "unknown";
};

const looksLikeUtf16Le = (chunk: Buffer) => {
  if (chunk.length < 2 || chunk.length % 2 !== 0) return false;
  if (chunk[0] === 0xff && chunk[1] === 0xfe) return true;

  let zeroBytesOnOddPositions = 0;
  for (let index = 1; index < chunk.length; index += 2) {
    if (chunk[index] === 0x00) zeroBytesOnOddPositions += 1;
  }
  return zeroBytesOnOddPositions / Math.ceil(chunk.length / 2) > 0.3;
};

const hasBinarySignature = (chunk: Buffer | string, encoding: string) => {
  if (typeof chunk === "string") return false;
  const reportedEncoding = normalizeOutputEncoding(encoding);
  if (chunk.includes(0)) {
    return !(reportedEncoding === "utf16le" && looksLikeUtf16Le(chunk));
  }
  if (chunk.length < 24) return false;

  let suspiciousBytes = 0;
  for (const byte of chunk) {
    const allowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    const printableAscii = byte >= 0x20 && byte <= 0x7e;
    const extendedByte = byte >= 0x80;
    if (!allowedControl && !printableAscii && !extendedByte) suspiciousBytes += 1;
  }
  return suspiciousBytes / chunk.length > 0.3;
};

const decodeChunk = (
  chunk: Buffer | string,
  encoding: string,
): { text: string; encoding: SandboxOutputEncoding; failed: boolean } => {
  if (typeof chunk === "string") {
    return {
      text: chunk,
      encoding: normalizeOutputEncoding(encoding),
      failed: false,
    };
  }

  const reportedEncoding = normalizeOutputEncoding(encoding);
  try {
    if (reportedEncoding === "utf16le" && !looksLikeUtf16Le(chunk)) {
      return {
        text: chunk.toString("utf8"),
        encoding: "utf8",
        failed: false,
      };
    }
    return {
      text: decodeTerminalOutput({ chunk, encoding }),
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

const normalizeComparablePath = (value: string) => {
  const resolved = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

export const resolveHostCwd = (input: {
  cwd?: string;
  workspaceRoot?: string | null;
}) => {
  const workspaceRoot = input.workspaceRoot?.trim()
    ? path.resolve(input.workspaceRoot.trim())
    : null;
  const requested = input.cwd?.trim();
  const absoluteRequested = Boolean(
    requested &&
      (path.isAbsolute(requested) ||
        path.win32.isAbsolute(requested) ||
        path.posix.isAbsolute(requested)),
  );
  const cwd = requested
    ? absoluteRequested
      ? path.resolve(requested)
      : path.resolve(workspaceRoot ?? process.cwd(), requested)
    : workspaceRoot ?? process.cwd();

  let stats;
  try {
    stats = statSync(cwd);
  } catch {
    throw mcpBadRequest(`terminal cwd does not exist: ${cwd}`);
  }
  if (!stats.isDirectory()) {
    throw mcpBadRequest(`terminal cwd is not a directory: ${cwd}`);
  }

  if (!workspaceRoot) {
    return {
      cwd,
      workspaceRelation: "unresolved" as const,
    };
  }

  const relative = path.relative(
    normalizeComparablePath(workspaceRoot),
    normalizeComparablePath(cwd),
  );
  const outside = relative.startsWith("..") || path.isAbsolute(relative);
  return {
    cwd,
    workspaceRelation: outside ? "outside" as const : "inside" as const,
  };
};

export const resolveHostEnv = (overrides?: Record<string, string>) =>
  resolveTerminalDevRuntimeEnvironment(
    Object.fromEntries(
    Object.entries({
      ...process.env,
      ...(overrides ?? {}),
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  );

const normalizeOutputLimitBytes = (value?: number) => {
  const normalized = value ?? DEFAULT_OUTPUT_LIMIT_BYTES;
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw mcpBadRequest("outputLimitBytes must be a positive finite number");
  }
  return Math.min(Math.trunc(normalized), MAX_OUTPUT_LIMIT_BYTES);
};

const buildNormalShellArgs = (profile: HostShellProfile, command: string) => {
  if (profile.argsMode === "powershell") return ["-NoProfile", "-Command", command];
  if (profile.argsMode === "cmd") return ["/d", "/s", "/c", command];
  return ["-lc", command];
};

const resolveLaunchSpec = (profile: HostShellProfile, command: string) => {
  const useWindowsJobObject =
    process.platform === "win32" && profile.shellFamily === "powershell";
  const processTreeMode: TerminalProcessTreeMode = useWindowsJobObject
    ? "windows_job_object"
    : process.platform === "win32"
      ? "windows_taskkill_tree"
      : "posix_process_group";

  return {
    command: profile.shell,
    args: useWindowsJobObject
      ? createWindowsJobCommandArgs(command)
      : buildNormalShellArgs(profile, command),
    processTreeMode,
    detached: process.platform !== "win32",
  };
};

const toCombinedOutput = (stdout: string, stderr: string) =>
  [stdout, stderr].filter(Boolean).join("\n").trimEnd();

export const executeHostCommand = async (
  input: HostExecutionInput,
): Promise<HostExecutionResult> => {
  if (input.signal.aborted) {
    throw new Error("Terminal session aborted");
  }

  const { cwd, workspaceRelation } = resolveHostCwd({
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
  });
  const outputLimitBytes = normalizeOutputLimitBytes(input.outputLimitBytes);
  const launch = resolveLaunchSpec(input.shellProfile, input.command);
  const child: ChildProcess = spawn(launch.command, launch.args, {
    cwd,
    env: resolveHostEnv(input.env),
    windowsHide: true,
    shell: false,
    detached: launch.detached,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let capturedBytes = 0;
  let truncated = false;
  let stdoutBinaryDetected = false;
  let stderrBinaryDetected = false;
  let stdoutEncoding = normalizeOutputEncoding(input.shellProfile.stdoutEncoding);
  let stderrEncoding = normalizeOutputEncoding(input.shellProfile.stderrEncoding);
  let jobObjectAssigned = launch.processTreeMode !== "windows_job_object";
  let jobMarkerResolved = launch.processTreeMode !== "windows_job_object";
  let pendingJobMarkerText = "";
  let exitCode: number | null = null;
  let timedOut = false;
  let settled = false;
  const violations: string[] = [];

  if (workspaceRelation === "outside") {
    violations.push(
      "cwd_outside_workspace: execution was approved and continued on the host runtime",
    );
  }

  const captureText = (target: string[], text: string) => {
    if (!text) return "";
    const remaining = Math.max(0, outputLimitBytes - capturedBytes);
    if (remaining === 0) {
      truncated = true;
      return "";
    }

    const bytes = Buffer.from(text, "utf8");
    const capturedBuffer = bytes.length <= remaining ? bytes : bytes.subarray(0, remaining);
    const captured = capturedBuffer.toString("utf8");
    capturedBytes += capturedBuffer.length;
    if (capturedBuffer.length < bytes.length) truncated = true;
    target.push(captured);
    return captured;
  };

  const appendChunk = (
    target: string[],
    chunk: Buffer | string,
    stream: "stdout" | "stderr",
    encoding: string,
  ) => {
    const decoded = decodeChunk(chunk, encoding);
    if (decoded.failed || hasBinarySignature(chunk, encoding)) {
      if (stream === "stdout") stdoutBinaryDetected = true;
      else stderrBinaryDetected = true;
      return target.includes(BINARY_PLACEHOLDER_TEXT)
        ? ""
        : captureText(target, BINARY_PLACEHOLDER_TEXT);
    }

    let text = decoded.text;
    if (stream === "stderr" && !jobMarkerResolved) {
      pendingJobMarkerText += text;
      const marker = getWindowsJobMarker();
      const markerPattern = new RegExp(`${marker}:(assigned|unavailable)\\r?\\n?`);
      const markerMatch = pendingJobMarkerText.match(markerPattern);
      if (!markerMatch) {
        return "";
      }
      jobObjectAssigned = markerMatch[1] === "assigned";
      jobMarkerResolved = true;
      text = pendingJobMarkerText.replace(markerPattern, "");
      pendingJobMarkerText = "";
    }

    if (stream === "stdout") stdoutEncoding = decoded.encoding;
    else stderrEncoding = decoded.encoding;
    return captureText(target, text);
  };

  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      violations.push(`terminal execution timed out after ${input.timeoutMs}ms`);
      void killTerminalProcessTree({
        pid: child.pid,
        mode: launch.processTreeMode,
      }).finally(() => finish());
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const visible = appendChunk(
        stdoutChunks,
        chunk,
        "stdout",
        input.shellProfile.stdoutEncoding,
      );
      if (visible) input.pushStdout?.(visible);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const visible = appendChunk(
        stderrChunks,
        chunk,
        "stderr",
        input.shellProfile.stderrEncoding,
      );
      if (visible) input.pushStderr?.(visible);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      finish(error instanceof Error ? error : new Error(String(error)));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      exitCode = code;
      finish();
    });

    input.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        void killTerminalProcessTree({
          pid: child.pid,
          mode: launch.processTreeMode,
        }).finally(() => finish(new Error("Terminal session aborted")));
      },
      { once: true },
    );
  }).catch((error) => {
    throw error instanceof Error ? error : mcpInternalError(String(error));
  });

  if (!jobMarkerResolved && pendingJobMarkerText) {
    captureText(stderrChunks, pendingJobMarkerText);
  }
  if (launch.processTreeMode === "windows_job_object" && !jobObjectAssigned) {
    violations.push(
      "windows_job_object_unavailable: taskkill tree fallback remains active",
    );
  }
  if (truncated) {
    violations.push(
      `terminal output truncated after ${outputLimitBytes} bytes; process execution was not stopped`,
    );
  }

  const stdout = stdoutChunks.join("").trimEnd();
  const stderr = stderrChunks.join("").trimEnd();
  return {
    runtimeId: "host_spawn",
    cwd,
    workspaceRelation,
    processTreeMode:
      launch.processTreeMode === "windows_job_object" && !jobObjectAssigned
        ? "windows_taskkill_tree"
        : launch.processTreeMode,
    exitCode,
    timedOut,
    stdout,
    stderr,
    stdoutEncoding: stdoutBinaryDetected ? "unknown" : stdoutEncoding,
    stderrEncoding: stderrBinaryDetected ? "unknown" : stderrEncoding,
    output: toCombinedOutput(stdout, stderr),
    truncated,
    binaryDetected: stdoutBinaryDetected || stderrBinaryDetected,
    violations,
  };
};

export const toHostShellProfile = (
  profile: ToolExecutionEnvironment["terminal"]["shellProfile"],
): HostShellProfile => ({ ...profile });
