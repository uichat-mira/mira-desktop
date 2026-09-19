import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MainThreadEventInput } from "../../main-thread/domain.js";
import type {
  MainThreadAdapter,
  MainThreadAdapterTurnInput,
  MainThreadAdapterTurnResult,
} from "./types.js";

const MAX_CAPTURE = 32_768;
const MAX_STDERR = 8192;
const MAX_EVENTS = 64;
const CODEX_DESKTOP_READ_ONLY_MODE = "read-only";

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function reasoningText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return null;
  const parts = value
    .flatMap((item) => {
      if (typeof item === "string") return [item];
      const record = asRecord(item);
      return typeof record?.text === "string" ? [record.text] : [];
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

function writerConflictError(error: unknown, threadId: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (!/already has an active writer/i.test(message)) {
    return error instanceof Error ? error : new Error(message);
  }
  const id = optionalString(threadId);
  return new Error(
    "Codex Desktop thread" +
      (id ? " " + id : "") +
      " is owned by another app-server writer. Close the other " +
      "Codex/ChatGPT writer or open a new Forge Main Thread, then retry.",
  );
}

function turnTimeout(timeoutMs: number) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  let timer: NodeJS.Timeout;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            "Codex Desktop app-server timed out after " +
              timeoutMs +
              "ms",
          ),
        ),
      timeoutMs,
    );
    timer.unref?.();
  });
  return {
    promise,
    cancel: () => clearTimeout(timer),
  };
}

export function codexDesktopBinaryCandidates(
  home = homedir(),
): string[] {
  return [
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    join(
      home,
      "Applications",
      "ChatGPT.app",
      "Contents",
      "Resources",
      "codex",
    ),
    join(
      home,
      "Applications",
      "Codex.app",
      "Contents",
      "Resources",
      "codex",
    ),
  ];
}

export async function resolveCodexDesktopBinary(
  options: {
    bin?: string | null;
    accessImpl?: typeof access;
    home?: string;
    platform?: NodeJS.Platform;
  } = {},
): Promise<string> {
  const {
    bin = null,
    accessImpl = access,
    home = homedir(),
    platform = process.platform,
  } = options;
  const explicit = optionalString(bin);
  if (explicit) {
    try {
      await accessImpl(explicit, constants.X_OK);
      return explicit;
    } catch {
      throw new Error(
        "Codex Desktop bundled backend is not executable: " + explicit,
      );
    }
  }

  if (platform !== "darwin") {
    throw new Error(
      "Codex Desktop auto-discovery currently supports macOS app bundles " +
        "only; set MIRA_FORGE_CODEX_DESKTOP_BIN explicitly",
    );
  }

  for (const candidate of codexDesktopBinaryCandidates(home)) {
    try {
      await accessImpl(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue current/legacy bundle discovery.
    }
  }

  throw new Error(
    "Codex Desktop was not found. Expected ChatGPT.app or Codex.app in " +
      "/Applications (or ~/Applications); set MIRA_FORGE_CODEX_DESKTOP_BIN " +
      "to override",
  );
}

export function buildCodexDesktopThreadRequest(input: {
  projectRoot?: unknown;
  externalThreadId?: unknown;
  model?: unknown;
}) {
  const cwd = requiredString(input.projectRoot, "projectRoot");
  const threadId = optionalString(input.externalThreadId);
  const model = optionalString(input.model);
  const params: Record<string, unknown> = {
    cwd,
    approvalPolicy: "never",
    sandbox: CODEX_DESKTOP_READ_ONLY_MODE,
  };
  if (model) params.model = model;

  if (threadId) {
    return {
      method: "thread/resume",
      params: {
        ...params,
        threadId,
        excludeTurns: true,
      },
    };
  }

  return {
    method: "thread/start",
    params: {
      ...params,
      serviceName: "mira_forge",
    },
  };
}

export function buildCodexDesktopTurnRequest(input: {
  projectRoot?: unknown;
  threadId?: unknown;
  message?: unknown;
  model?: unknown;
}) {
  const cwd = requiredString(input.projectRoot, "projectRoot");
  const threadId = requiredString(input.threadId, "threadId");
  const message = requiredString(input.message, "message");
  const model = optionalString(input.model);
  const params: Record<string, unknown> = {
    threadId,
    input: [{ type: "text", text: message }],
    cwd,
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly" },
  };
  if (model) params.model = model;
  return params;
}

export function normalizeCodexDesktopNotification(
  message: unknown,
  reasoningFallback: string | null = null,
): MainThreadEventInput | null {
  const record = asRecord(message);
  if (!record) return null;
  const method = optionalString(record.method);
  if (!method || !["item/started", "item/completed"].includes(method)) {
    return null;
  }

  const params = asRecord(record.params);
  const item = asRecord(params?.item);
  const itemType = optionalString(item?.type);
  if (!itemType) return null;

  const terminal = method === "item/completed";
  const status =
    optionalString(item?.status) ?? (terminal ? "completed" : "running");

  if (itemType === "reasoning" && terminal) {
    const text =
      reasoningText(item?.summary) ??
      reasoningText(item?.content) ??
      optionalString(item?.text) ??
      optionalString(reasoningFallback);
    if (!text) return null;
    return {
      type: "thinking",
      text,
      provider: {
        adapter: "codex-desktop",
        eventType: method,
        itemType,
        status,
      },
    };
  }

  if (itemType === "plan" && terminal && optionalString(item?.text)) {
    return {
      type: "thinking",
      text: optionalString(item?.text),
      provider: {
        adapter: "codex-desktop",
        eventType: method,
        itemType,
        status,
      },
    };
  }

  if (["commandExecution", "mcpToolCall", "webSearch"].includes(itemType)) {
    const toolName =
      itemType === "mcpToolCall"
        ? [optionalString(item?.server), optionalString(item?.tool)]
            .filter(Boolean)
            .join(".") || itemType
        : itemType;
    return {
      type: "tool",
      tool: {
        name: toolName,
        status,
      },
      provider: {
        adapter: "codex-desktop",
        eventType: method,
        itemType,
        status,
      },
    };
  }

  if (itemType === "fileChange") {
    return {
      type: "artifact",
      artifact: {
        kind: "provider-file-change",
        ref: null,
      },
      provider: {
        adapter: "codex-desktop",
        eventType: method,
        itemType,
        status,
      },
    };
  }

  return null;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    return asRecord(JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}

interface AppServerCloseInfo {
  code: number | null;
  signal: string | null;
  stderr: string;
  error: Error | null;
}

interface AppServerClient {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  setNotificationHandler(
    handler: ((message: Record<string, unknown>) => void) | null,
  ): void;
  isClosed(): boolean;
  forceClose(): void;
  close(): Promise<AppServerCloseInfo | null>;
  closePromise: Promise<AppServerCloseInfo>;
}

function createAppServerProcess(input: {
  bin: string;
  prefixArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  spawnImpl: typeof spawn;
}): AppServerClient {
  const child = input.spawnImpl(
    input.bin,
    [...input.prefixArgs, "app-server", "--listen", "stdio://"],
    {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let stdoutBuffer = "";
  let stderr = "";
  let nextId = 1;
  let closed = false;
  let closeInfo: AppServerCloseInfo | null = null;
  let notificationHandler:
    | ((message: Record<string, unknown>) => void)
    | null = null;

  const pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(reason?: unknown): void;
    }
  >();
  let closeResolve!: (info: AppServerCloseInfo) => void;
  const closePromise = new Promise<AppServerCloseInfo>((resolveClose) => {
    closeResolve = resolveClose;
  });

  const rejectPending = (error: Error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  const send = (message: Record<string, unknown>) => {
    if (closed || !child.stdin?.writable) {
      throw new Error("Codex Desktop app-server stdin is closed");
    }
    child.stdin.write(JSON.stringify(message) + "\n");
  };

  const consume = (message: Record<string, unknown>) => {
    if (
      Object.prototype.hasOwnProperty.call(message, "id") &&
      !message.method
    ) {
      const waiter = pending.get(String(message.id));
      if (!waiter) return;
      pending.delete(String(message.id));
      const error = asRecord(message.error);
      if (error) {
        waiter.reject(
          new Error(
            "Codex Desktop app-server: " +
              (optionalString(error.message) ?? "unknown JSON-RPC error"),
          ),
        );
      } else {
        waiter.resolve(message.result);
      }
      return;
    }

    if (message.method && Object.prototype.hasOwnProperty.call(message, "id")) {
      try {
        send({
          id: message.id,
          error: {
            code: -32601,
            message:
              "Mira Forge read-only main thread does not handle " +
              "interactive app-server requests",
          },
        });
      } catch {
        // Process close path remains authoritative.
      }
      return;
    }

    if (message.method && notificationHandler) {
      notificationHandler(message);
    }
  };

  const consumeLine = (line: string) => {
    const parsed = parseJsonLine(line);
    if (parsed) consume(parsed);
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
    if (closed) return;
    closed = true;
    rejectPending(error);
    closeInfo = {
      code: null,
      signal: null,
      stderr: stderr.trim(),
      error,
    };
    closeResolve(closeInfo);
  });

  child.once("close", (code, signal) => {
    if (stdoutBuffer) consumeLine(stdoutBuffer);
    stdoutBuffer = "";
    if (closed) return;
    closed = true;
    const error =
      code === 0
        ? new Error("Codex Desktop app-server closed")
        : new Error(
            stderr.trim() ||
              "Codex Desktop app-server exited with code " +
                String(code ?? "unknown"),
          );
    rejectPending(error);
    closeInfo = {
      code: Number.isInteger(code) ? code : null,
      signal: typeof signal === "string" ? signal : null,
      stderr: stderr.trim(),
      error: null,
    };
    closeResolve(closeInfo);
  });

  return {
    request(method: string, params?: unknown): Promise<unknown> {
      const id = nextId++;
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(String(id), {
          resolve: resolveRequest,
          reject: rejectRequest,
        });
        try {
          send({
            id,
            method,
            ...(params === undefined ? {} : { params }),
          });
        } catch (error) {
          pending.delete(String(id));
          rejectRequest(error);
        }
      });
    },
    notify(method: string, params?: unknown) {
      send({
        method,
        ...(params === undefined ? {} : { params }),
      });
    },
    setNotificationHandler(handler) {
      notificationHandler = typeof handler === "function" ? handler : null;
    },
    isClosed() {
      return closed;
    },
    forceClose() {
      if (closed) return;
      try {
        child.kill("SIGTERM");
      } catch {
        // Best effort on process exit.
      }
    },
    async close() {
      notificationHandler = null;
      if (!closed && child.stdin?.writable) child.stdin.end();
      const grace = new Promise<void>((resolveGrace) => {
        const timer = setTimeout(resolveGrace, 1200);
        timer.unref?.();
      });
      await Promise.race([closePromise.then(() => undefined), grace]);
      if (!closed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // closePromise remains authoritative.
        }
        await closePromise;
      }
      return closeInfo;
    },
    closePromise,
  };
}

export interface CodexDesktopMainThreadAdapterOptions {
  bin?: string | null;
  prefixArgs?: string[];
  spawnImpl?: typeof spawn;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  resolveBin?: typeof resolveCodexDesktopBinary;
}

export function createCodexDesktopMainThreadAdapter(
  options: CodexDesktopMainThreadAdapterOptions = {},
): MainThreadAdapter {
  const {
    bin = null,
    prefixArgs = [],
    spawnImpl = spawn,
    environment = process.env,
    timeoutMs = 3_000_000,
    resolveBin = resolveCodexDesktopBinary,
  } = options;

  const owners = new Map<
    string,
    {
      threadId: string;
      projectRoot: string;
      client: AppServerClient;
      busy: boolean;
    }
  >();
  let disposed = false;

  const forgetOwner = (owner: {
    threadId: string;
    client: AppServerClient;
  }) => {
    if (owners.get(owner.threadId)?.client === owner.client) {
      owners.delete(owner.threadId);
    }
  };

  const releaseOwner = async (owner: {
    threadId: string;
    client: AppServerClient;
  }) => {
    forgetOwner(owner);
    if (!owner.client.isClosed()) {
      try {
        await owner.client.request("thread/unsubscribe", {
          threadId: owner.threadId,
        });
      } catch {
        // Closing process is the authoritative writer release.
      }
    }
    await owner.client.close().catch(() => undefined);
  };

  const openOwner = async (input: {
    projectRoot: string;
    externalThreadId: string | null;
    model: string | null;
  }) => {
    const resolvedBin = await resolveBin({ bin });
    const client = createAppServerProcess({
      bin: resolvedBin,
      prefixArgs,
      cwd: input.projectRoot,
      env: environment,
      spawnImpl,
    });

    try {
      await client.request("initialize", {
        clientInfo: {
          name: "mira_forge",
          title: "Mira Forge",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: false,
        },
      });
      client.notify("initialized");

      const request = buildCodexDesktopThreadRequest({
        projectRoot: input.projectRoot,
        externalThreadId: input.externalThreadId,
        model: input.model,
      });

      let result: unknown;
      try {
        result = await client.request(request.method, request.params);
      } catch (error) {
        throw writerConflictError(error, input.externalThreadId);
      }

      const resultRecord = asRecord(result);
      const thread = asRecord(resultRecord?.thread);
      const threadId = optionalString(thread?.id);
      if (!threadId) {
        throw new Error(
          "Codex Desktop app-server did not return a durable thread ID",
        );
      }
      if (
        input.externalThreadId &&
        threadId !== input.externalThreadId
      ) {
        throw new Error("Codex Desktop resumed a different thread");
      }

      const owner = {
        threadId,
        projectRoot: input.projectRoot,
        client,
        busy: false,
      };
      owners.set(threadId, owner);
      client.closePromise
        .then(() => forgetOwner(owner))
        .catch(() => forgetOwner(owner));
      return owner;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  };

  const getOwner = async (input: {
    projectRoot: string;
    externalThreadId: string | null;
    model: string | null;
  }) => {
    if (input.externalThreadId) {
      const existing = owners.get(input.externalThreadId);
      if (existing && !existing.client.isClosed()) {
        if (existing.projectRoot !== input.projectRoot) {
          throw new Error(
            "Codex Desktop thread is bound to a different project root",
          );
        }
        return existing;
      }
    }
    return openOwner(input);
  };

  const forceCloseAll = () => {
    for (const owner of owners.values()) owner.client.forceClose();
  };
  process.once("exit", forceCloseAll);

  return {
    id: "codex-desktop",
    async runTurn(
      input: MainThreadAdapterTurnInput,
    ): Promise<MainThreadAdapterTurnResult> {
      if (disposed) {
        throw new Error("Codex Desktop adapter is shut down");
      }

      const projectRoot = requiredString(input.projectRoot, "projectRoot");
      const message = requiredString(input.message, "message");
      const owner = await getOwner({
        projectRoot,
        externalThreadId: input.externalThreadId,
        model: input.model,
      });
      if (owner.busy) {
        throw new Error(
          "Codex Desktop thread " +
            owner.threadId +
            " already has an active Forge turn",
        );
      }
      owner.busy = true;

      const events: MainThreadEventInput[] = [];
      const progress = createProgressPublisher(input.onEvent);
      const reasoningDeltas = new Map<string, string>();
      const agentDeltas = new Map<string, string>();
      let responseText = "";
      let providerError: string | null = null;
      let writeAttemptObserved = false;
      let targetTurnId: string | null = null;
      let terminal: Record<string, unknown> | null = null;
      let terminalResolve!: (value: Record<string, unknown>) => void;
      const terminalPromise = new Promise<Record<string, unknown>>(
        (resolveTerminal) => {
          terminalResolve = resolveTerminal;
        },
      );

      const publishNormalized = (
        normalized: MainThreadEventInput | null,
      ) => {
        if (!normalized || events.length >= MAX_EVENTS) return;
        events.push(normalized);
        progress.publish(normalized);
      };

      owner.client.setNotificationHandler((notification) => {
        const method = optionalString(notification.method);
        const params = asRecord(notification.params) ?? {};
        const item = asRecord(params.item);

        const itemId = optionalString(params.itemId);
        if (
          method === "item/reasoning/summaryTextDelta" &&
          itemId &&
          typeof params.delta === "string"
        ) {
          reasoningDeltas.set(
            itemId,
            appendBounded(
              reasoningDeltas.get(itemId) ?? "",
              params.delta,
              16_384,
            ),
          );
        }
        if (
          method === "item/reasoning/textDelta" &&
          itemId &&
          typeof params.delta === "string"
        ) {
          reasoningDeltas.set(
            itemId,
            appendBounded(
              reasoningDeltas.get(itemId) ?? "",
              params.delta,
              16_384,
            ),
          );
        }
        if (
          method === "item/agentMessage/delta" &&
          itemId &&
          typeof params.delta === "string"
        ) {
          agentDeltas.set(
            itemId,
            appendBounded(
              agentDeltas.get(itemId) ?? "",
              params.delta,
            ),
          );
        }

        if (item?.type === "fileChange") writeAttemptObserved = true;
        if (
          method === "item/completed" &&
          item?.type === "agentMessage" &&
          typeof item.text === "string" &&
          item.text.trim()
        ) {
          responseText = appendBounded(
            responseText,
            item.text.trim() + "\n",
          );
        }

        const fallback =
          optionalString(item?.id) &&
          reasoningDeltas.get(String(item?.id))
            ? reasoningDeltas.get(String(item?.id))!
            : null;
        publishNormalized(
          normalizeCodexDesktopNotification(notification, fallback),
        );

        if (method === "error") {
          const error = asRecord(params.error);
          providerError =
            optionalString(error?.message) ??
            optionalString(params.message) ??
            providerError;
        }

        if (method === "turn/completed") {
          const threadId = optionalString(params.threadId);
          const turn = asRecord(params.turn);
          const turnId =
            optionalString(turn?.id) ?? optionalString(params.turnId);
          if (
            (!threadId || threadId === owner.threadId) &&
            (!targetTurnId || !turnId || turnId === targetTurnId)
          ) {
            terminal = notification;
            terminalResolve(notification);
          }
        }
      });

      const timeout = turnTimeout(timeoutMs);
      try {
        const result = await owner.client.request(
          "turn/start",
          buildCodexDesktopTurnRequest({
            projectRoot,
            threadId: owner.threadId,
            message,
            model: input.model,
          }),
        );
        const resultRecord = asRecord(result);
        const turn = asRecord(resultRecord?.turn);
        targetTurnId = optionalString(turn?.id);
        if (!targetTurnId) {
          throw new Error(
            "Codex Desktop app-server did not return a turn ID",
          );
        }

        if (!terminal) {
          const waits: Promise<unknown>[] = [
            terminalPromise,
            owner.client.closePromise.then((info) => {
              throw new Error(
                info.stderr ||
                  "Codex Desktop app-server closed before the turn completed",
              );
            }),
          ];
          if (timeout) waits.push(timeout.promise);
          await Promise.race(waits);
        }

        await progress.flush();
        const terminalRecord = asRecord(terminal);
        const terminalParams = asRecord(terminalRecord?.params);
        const terminalTurn = asRecord(terminalParams?.turn);
        const terminalError = asRecord(terminalTurn?.error);
        if (terminalTurn?.status === "failed") {
          throw new Error(
            optionalString(terminalError?.message) ??
              providerError ??
              "Codex Desktop turn failed",
          );
        }
        if (writeAttemptObserved) {
          throw new Error(
            "Codex Desktop reported a file-change attempt in a read-only " +
              "main thread",
          );
        }

        if (!responseText.trim()) {
          const streamed = [...agentDeltas.values()].join("\n").trim();
          if (streamed) responseText = streamed;
        }
        if (!responseText.trim()) {
          throw new Error(
            providerError ?? "Codex Desktop returned no assistant message",
          );
        }

        return {
          externalThreadId: owner.threadId,
          responseText: responseText.trim(),
          events: progress.streamed() ? [] : events,
          providerEventType: "codex-desktop.turn.completed",
        };
      } catch (error) {
        await releaseOwner(owner);
        throw writerConflictError(error, owner.threadId);
      } finally {
        timeout?.cancel();
        owner.busy = false;
        owner.client.setNotificationHandler(null);
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      process.removeListener("exit", forceCloseAll);
      const active = [...owners.values()];
      owners.clear();
      await Promise.allSettled(active.map((owner) => releaseOwner(owner)));
    },
  };
}
