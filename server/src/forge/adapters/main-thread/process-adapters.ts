import { spawn } from "node:child_process";
import type { MainThreadEventInput } from "../../main-thread/domain.js";
import type {
  MainThreadAdapter,
  MainThreadAdapterTurnInput,
  MainThreadAdapterTurnResult,
} from "./types.js";

const MAX_CAPTURE = 32_768;
const MAX_STDERR = 8192;
const MAX_EVENTS = 64;

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(name + " is required");
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function appendBounded(
  current: string,
  value: string,
  limit = MAX_CAPTURE,
): string {
  const next = current + value;
  return next.length <= limit ? next : next.slice(next.length - limit);
}

function reasoningText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return null;
  const parts = value
    .flatMap((item) => {
      if (typeof item === "string") return [item];
      if (!item || typeof item !== "object") return [];
      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    })
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

function createProgressPublisher(
  onEvent: MainThreadAdapterTurnInput["onEvent"],
) {
  let chain = Promise.resolve();
  let failure: Error | null = null;
  return {
    publish(event: MainThreadEventInput) {
      if (typeof onEvent !== "function") return;
      chain = chain
        .then(() => onEvent(event))
        .catch((cause: unknown) => {
          failure ??=
            cause instanceof Error ? cause : new Error(String(cause));
        });
    },
    async flush(): Promise<void> {
      await chain;
      if (failure) throw failure;
    },
    streamed(): boolean {
      return typeof onEvent === "function";
    },
  };
}

export function parseMainThreadPrefixArgs(
  value: unknown,
  name = "prefix args",
): string[] {
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

export function buildOpenCodeMainThreadArgs(input: {
  prefixArgs?: string[];
  projectRoot?: unknown;
  message?: unknown;
  externalThreadId?: unknown;
  model?: unknown;
}): string[] {
  const root = requiredString(input.projectRoot, "projectRoot");
  const prompt = requiredString(input.message, "message");
  const args = [
    ...(input.prefixArgs ?? []),
    "run",
    "--format",
    "json",
    "--thinking",
    "--dir",
    root,
    "--agent",
    "plan",
  ];
  const externalThreadId = optionalString(input.externalThreadId);
  const model = optionalString(input.model);
  if (externalThreadId) args.push("--session", externalThreadId);
  if (model) args.push("--model", model);
  args.push(prompt);
  return args;
}

export function buildCodexMainThreadArgs(input: {
  prefixArgs?: string[];
  projectRoot?: unknown;
  message?: unknown;
  externalThreadId?: unknown;
  model?: unknown;
}): string[] {
  const root = requiredString(input.projectRoot, "projectRoot");
  const prompt = requiredString(input.message, "message");
  const args = [
    ...(input.prefixArgs ?? []),
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "-C",
    root,
  ];
  const model = optionalString(input.model);
  const externalThreadId = optionalString(input.externalThreadId);
  if (model) args.push("--model", model);
  if (externalThreadId) {
    args.push("resume", externalThreadId, prompt);
  } else {
    args.push(prompt);
  }
  return args;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    return asRecord(JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}

export function normalizeOpenCodeThreadEvent(
  event: unknown,
): MainThreadEventInput | null {
  const record = asRecord(event);
  if (!record) return null;
  const part = asRecord(record.part);
  const partType = optionalString(part?.type);
  const state = asRecord(part?.state);
  if (partType && ["reasoning", "thinking"].includes(partType)) {
    const text =
      optionalString(part?.text) ??
      reasoningText(part?.summary) ??
      optionalString(part?.content);
    if (!text) return null;
    return {
      type: "thinking",
      text,
      provider: {
        adapter: "opencode",
        eventType: optionalString(record.type),
        itemType: partType,
        status:
          optionalString(state?.status) ?? optionalString(part?.status),
      },
    };
  }
  if (partType && ["tool", "tool_use", "tool_result"].includes(partType)) {
    return {
      type: "tool",
      tool: {
        name:
          optionalString(part?.tool) ??
          optionalString(part?.name) ??
          partType,
        status:
          optionalString(state?.status) ?? optionalString(part?.status),
      },
      provider: {
        adapter: "opencode",
        eventType: optionalString(record.type),
        itemType: partType,
        status:
          optionalString(state?.status) ?? optionalString(part?.status),
      },
    };
  }
  return null;
}

export function normalizeCodexThreadEvent(
  event: unknown,
): MainThreadEventInput | null {
  const record = asRecord(event);
  if (!record) return null;
  const item = asRecord(record.item);
  const itemType = optionalString(item?.type);
  if (!itemType) return null;

  if (itemType === "reasoning") {
    const text =
      reasoningText(item?.summary) ??
      reasoningText(item?.content) ??
      optionalString(item?.text);
    if (!text) return null;
    return {
      type: "thinking",
      text,
      provider: {
        adapter: "codex",
        eventType: optionalString(record.type),
        itemType,
        status: optionalString(item?.status),
      },
    };
  }

  if (["command_execution", "mcp_tool_call", "web_search"].includes(itemType)) {
    return {
      type: "tool",
      tool: {
        name: itemType,
        status: optionalString(item?.status),
      },
      provider: {
        adapter: "codex",
        eventType: optionalString(record.type),
        itemType,
        status: optionalString(item?.status),
      },
    };
  }

  if (itemType === "file_change") {
    return {
      type: "artifact",
      artifact: {
        kind: "provider-file-change",
        ref: null,
      },
      provider: {
        adapter: "codex",
        eventType: optionalString(record.type),
        itemType,
        status: optionalString(item?.status),
      },
    };
  }

  return null;
}

interface JsonLineRunResult {
  code: number | null;
  signal: string | null;
  stderr: string;
}

async function runJsonLines(input: {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  spawnImpl: typeof spawn;
  consumeEvent(event: Record<string, unknown>): void;
}): Promise<JsonLineRunResult> {
  return new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const child = input.spawnImpl(input.bin, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (handler: () => void): boolean => {
      if (settled) return false;
      settled = true;
      if (timer) clearTimeout(timer);
      handler();
      return true;
    };

    const consumeLine = (line: string) => {
      const event = parseJsonLine(line);
      if (event) input.consumeEvent(event);
    };

    const flush = () => {
      if (!stdoutBuffer) return;
      consumeLine(stdoutBuffer);
      stdoutBuffer = "";
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = appendBounded(stderr, chunk.toString(), MAX_STDERR);
    });

    child.once("error", (error) => {
      finish(() => reject(error));
    });
    child.once("close", (code, signal) => {
      finish(() => {
        flush();
        resolve({
          code: Number.isInteger(code) ? code : null,
          signal: typeof signal === "string" ? signal : null,
          stderr: stderr.trim(),
        });
      });
    });

    if (Number.isFinite(input.timeoutMs) && input.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill("SIGTERM");
        } catch {
          // The close/error path remains authoritative.
        }
        finish(() =>
          reject(
            new Error(
              "main thread provider timed out after " +
                input.timeoutMs +
                "ms",
            ),
          ),
        );
      }, input.timeoutMs);
      timer.unref?.();
    }
  });
}

export interface ProcessMainThreadAdapterOptions {
  bin?: string;
  prefixArgs?: string[];
  spawnImpl?: typeof spawn;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export function createOpenCodeMainThreadAdapter(
  options: ProcessMainThreadAdapterOptions = {},
): MainThreadAdapter {
  const {
    bin = "opencode",
    prefixArgs = [],
    spawnImpl = spawn,
    environment = process.env,
    timeoutMs = 3_000_000,
  } = options;

  return {
    id: "opencode",
    async runTurn(
      input: MainThreadAdapterTurnInput,
    ): Promise<MainThreadAdapterTurnResult> {
      const args = buildOpenCodeMainThreadArgs({
        prefixArgs,
        ...input,
      });
      const events: MainThreadEventInput[] = [];
      const progress = createProgressPublisher(input.onEvent);
      let responseText = "";
      let observedThreadId: string | null = null;
      let providerError: string | null = null;

      const permissions = JSON.stringify({
        "*": "deny",
        read: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        lsp: "allow",
        webfetch: "allow",
        websearch: "allow",
      });
      const env = {
        ...environment,
        OPENCODE_PERMISSION: permissions,
      };

      const result = await runJsonLines({
        bin,
        args,
        cwd: input.projectRoot,
        env,
        timeoutMs,
        spawnImpl,
        consumeEvent(event) {
          const sessionId = optionalString(event.sessionID);
          if (sessionId) observedThreadId ??= sessionId;

          const part = asRecord(event.part);
          const text =
            part?.type === "text" && typeof part.text === "string"
              ? part.text
              : typeof event.text === "string"
                ? event.text
                : "";
          if (text) {
            responseText = appendBounded(responseText, text + "\n");
          }

          const error = asRecord(event.error);
          const errorData = asRecord(error?.data);
          const apiError =
            optionalString(errorData?.message) ??
            optionalString(error?.message);
          if (apiError) providerError = apiError;

          const normalized = normalizeOpenCodeThreadEvent(event);
          if (normalized && events.length < MAX_EVENTS) {
            events.push(normalized);
            progress.publish(normalized);
          }
        },
      });
      await progress.flush();

      if (result.code !== 0) {
        throw new Error(
          providerError ??
            result.stderr ??
            "OpenCode exited with code " + String(result.code),
        );
      }
      if (
        input.externalThreadId &&
        observedThreadId &&
        observedThreadId !== input.externalThreadId
      ) {
        throw new Error("OpenCode resumed a different session");
      }

      const externalThreadId =
        observedThreadId ?? optionalString(input.externalThreadId);
      if (!externalThreadId) {
        throw new Error("OpenCode did not report a durable session ID");
      }
      if (!responseText.trim()) {
        throw new Error(
          providerError ?? "OpenCode returned no assistant message",
        );
      }

      return {
        externalThreadId,
        responseText: responseText.trim(),
        events: progress.streamed() ? [] : events,
        providerEventType: "opencode.turn.completed",
      };
    },
  };
}

export function createCodexMainThreadAdapter(
  options: ProcessMainThreadAdapterOptions = {},
): MainThreadAdapter {
  const {
    bin = "codex",
    prefixArgs = [],
    spawnImpl = spawn,
    environment = process.env,
    timeoutMs = 3_000_000,
  } = options;

  return {
    id: "codex",
    async runTurn(
      input: MainThreadAdapterTurnInput,
    ): Promise<MainThreadAdapterTurnResult> {
      const args = buildCodexMainThreadArgs({
        prefixArgs,
        ...input,
      });
      const events: MainThreadEventInput[] = [];
      const progress = createProgressPublisher(input.onEvent);
      let responseText = "";
      let observedThreadId: string | null = null;
      let providerError: string | null = null;
      let writeAttemptObserved = false;

      const result = await runJsonLines({
        bin,
        args,
        cwd: input.projectRoot,
        env: environment,
        timeoutMs,
        spawnImpl,
        consumeEvent(event) {
          if (
            event.type === "thread.started" &&
            optionalString(event.thread_id)
          ) {
            observedThreadId ??= optionalString(event.thread_id);
          }

          const item = asRecord(event.item);
          if (
            event.type === "item.completed" &&
            item?.type === "agent_message" &&
            typeof item.text === "string"
          ) {
            responseText = appendBounded(
              responseText,
              item.text + "\n",
            );
          }
          if (item?.type === "file_change") {
            writeAttemptObserved = true;
          }

          const error = asRecord(event.error);
          const errorMessage =
            optionalString(error?.message) ??
            optionalString(event.message);
          if (event.type === "turn.failed" && errorMessage) {
            providerError = errorMessage;
          }

          const normalized = normalizeCodexThreadEvent(event);
          if (normalized && events.length < MAX_EVENTS) {
            events.push(normalized);
            progress.publish(normalized);
          }
        },
      });
      await progress.flush();

      if (result.code !== 0) {
        throw new Error(
          providerError ??
            result.stderr ??
            "Codex exited with code " + String(result.code),
        );
      }
      if (writeAttemptObserved) {
        throw new Error(
          "Codex reported a file-change attempt in a read-only main thread",
        );
      }
      if (
        input.externalThreadId &&
        observedThreadId !== input.externalThreadId
      ) {
        throw new Error(
          "Codex resume did not return the requested thread ID",
        );
      }

      const externalThreadId =
        observedThreadId ?? optionalString(input.externalThreadId);
      if (!externalThreadId) {
        throw new Error("Codex did not report a durable thread ID");
      }
      if (!responseText.trim()) {
        throw new Error(providerError ?? "Codex returned no assistant message");
      }

      return {
        externalThreadId,
        responseText: responseText.trim(),
        events: progress.streamed() ? [] : events,
        providerEventType: "codex.turn.completed",
      };
    },
  };
}
