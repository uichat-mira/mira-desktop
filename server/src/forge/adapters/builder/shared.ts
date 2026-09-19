import type { ChildProcess, SpawnOptions } from "node:child_process";
import type {
  BuilderExitResult,
  BuilderProcessHandle,
  BuilderProviderEvent,
  BuilderStartInput,
} from "./types.js";

export const BUILDER_MAX_CAPTURE = 8192;

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(name + " is required");
  }
  return value.trim();
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function appendBounded(
  current: string,
  value: string,
  limit = BUILDER_MAX_CAPTURE,
): string {
  const next = current + value;
  return next.length <= limit ? next : next.slice(next.length - limit);
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parsePrefixArgs(value: unknown, name: string): string[] {
  if (value === undefined || value === null || value === "") return [];
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new Error(name + " must be a JSON array of strings");
  }
  return parsed;
}

export function runBuilderJsonProcess(input: {
  child: ChildProcess;
  consumeEvent(event: Record<string, unknown>): BuilderProviderEvent | null;
  consumeResult?(event: Record<string, unknown>): {
    resultText?: string | null;
    errorText?: string | null;
  };
  callbacks: BuilderStartInput;
}): BuilderProcessHandle {
  const { child, callbacks } = input;
  let settled = false;
  let stdoutBuffer = "";
  let stderr = "";
  let resultText = "";
  let errorText = "";

  const consumeLine = (line: string) => {
    const event = parseJsonLine(line);
    if (!event) return;

    const extracted = input.consumeResult?.(event);
    if (extracted?.resultText) {
      resultText = appendBounded(resultText, extracted.resultText);
    }
    if (extracted?.errorText) {
      errorText = appendBounded(errorText, extracted.errorText);
    }

    const normalized = input.consumeEvent(event);
    if (normalized) callbacks.onEvent?.(normalized);
  };

  const flushStdout = () => {
    if (!stdoutBuffer) return;
    consumeLine(stdoutBuffer);
    stdoutBuffer = "";
  };

  child.once("spawn", () => {
    callbacks.onStarted?.({
      pid: Number.isInteger(child.pid) ? (child.pid as number) : null,
    });
  });

  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
  });

  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr = appendBounded(stderr, chunk.toString());
  });

  child.once("error", (error) => {
    if (settled) return;
    settled = true;
    callbacks.onError?.(error, { stderr });
  });

  child.once("close", (code, signal) => {
    if (settled) return;
    settled = true;
    flushStdout();
    const result: BuilderExitResult = {
      code: Number.isInteger(code) ? code : null,
      signal: typeof signal === "string" ? signal : null,
      stderr,
      resultText: resultText.trim() || null,
      errorText: errorText.trim() || null,
    };
    callbacks.onExit?.(result);
  });

  return {
    get pid() {
      return Number.isInteger(child.pid) ? (child.pid as number) : null;
    },
    kill(signal: NodeJS.Signals = "SIGTERM") {
      try {
        return child.kill(signal);
      } catch {
        return false;
      }
    },
  };
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;
