import type {
  ToolArtifact,
  ToolExecutionEnvironment,
  ToolInvocationContext,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { createArtifact } from "../core/artifacts.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import {
  executeHostCommand,
  toHostShellProfile,
} from "./host-spawn-runtime.js";
import {
  getTerminalSession,
  stopTerminalSession,
} from "../terminal-sessions.js";
import {
  acquirePersistentSession,
  observePersistentCommandOutput,
  runPersistentCommand,
} from "./pty-command-runtime.js";
import {
  getPersistentTerminalSessionStatus,
  normalizeTerminalOutputLimitBytes,
  normalizeTerminalOutputOffset,
  type TerminalPersistentState,
} from "./persistent-output-store.js";
import {
  resolveTerminalRuntimeId,
  type HostWorkspaceRelation,
  type TerminalProcessTreeMode,
  type TerminalRuntimeId,
} from "./runtime-contract.js";

export type TerminalExecutionContext = {
  invocationId: string;
  args: Record<string, unknown>;
  environment?: ToolExecutionEnvironment;
  signal: AbortSignal;
  pushEvent?: (event: ToolInvocationEventInput) => void;
  trace?: ToolInvocationContext["trace"];
};

type TerminalContents = {
  runtimeId: TerminalRuntimeId;
  sessionId: string;
  command: string;
  cwd: string;
  workspaceRelation: HostWorkspaceRelation;
  processTreeMode: TerminalProcessTreeMode;
  exitCode: number | null;
  output: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  reusedSession: boolean;
  sessionMode: "ephemeral" | "persistent";
  streamMode: "split" | "merged";
  stderrSeparated: boolean;
  stdoutEncoding?: "utf8" | "gbk" | "utf16le" | "unknown";
  stderrEncoding?: "utf8" | "gbk" | "utf16le" | "unknown";
  truncated?: boolean;
  binaryDetected?: boolean;
  violations?: string[];
  continuationId?: string;
  continuationAvailable?: boolean;
  outputOffset?: number;
  outputEndOffset?: number;
  nextOutputOffset?: number;
  outputBytesAvailable?: number;
  outputLimitBytes?: number;
  commandCompleted?: boolean;
  state?: TerminalPersistentState;
  cleanupCompleted?: boolean;
  operation?: "status" | "stop";
};

type TerminalExecutionResult = {
  contents: TerminalContents;
  artifacts: ToolArtifact[];
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

const assertTerminalEnvironment = (environment?: ToolExecutionEnvironment) => {
  if (!environment || environment.source !== "harness") {
    throw mcpInternalError(
      "Terminal execution requires a harness environment snapshot",
    );
  }
  return environment;
};

const normalizeCommand = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizeContinuationId = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw mcpBadRequest("continuationId must be a string");
  }
  return value;
};

const normalizeEnv = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
};

const normalizeTimeoutMs = (value: unknown) => {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw mcpBadRequest("timeoutMs must be a finite number");
  }
  return Math.min(
    Math.max(Math.trunc(value), MIN_TIMEOUT_MS),
    MAX_TIMEOUT_MS,
  );
};

const normalizeAttachSessionId = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw mcpBadRequest("attachSessionId must be a string");
  }
  return value;
};

const normalizeSessionMode = (
  value: unknown,
): "ephemeral" | "persistent" =>
  value === "persistent" ? "persistent" : "ephemeral";

const normalizeTerminalOperation = (
  value: unknown,
): "status" | "stop" | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "status" || value === "stop") {
    return value;
  }
  throw mcpBadRequest("operation must be status or stop");
};

const normalizeControlSessionId = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw mcpBadRequest("sessionId must be a string");
  }
  return value;
};

const createTerminalArtifact = (input: {
  command: string;
  output: string;
  metadata: Record<string, unknown>;
}) =>
  createArtifact({
    kind: "terminal-log",
    title: `Terminal output for ${input.command}`,
    mimeType: "text/plain",
    data: input.output,
    metadata: input.metadata,
  });

export const describeTerminalPlan = (
  environment: ToolExecutionEnvironment | undefined,
  args: Record<string, unknown> = {},
) => {
  const harnessEnvironment = assertTerminalEnvironment(environment);
  const attachSessionId = normalizeAttachSessionId(args.attachSessionId);
  const continuationId = normalizeContinuationId(args.continuationId);
  const operation = normalizeTerminalOperation(args.operation);
  const sessionId = normalizeControlSessionId(args.sessionId);
  const sessionMode = attachSessionId || continuationId || operation || sessionId
    ? "persistent"
    : normalizeSessionMode(args.sessionMode);
  const runtimeId = resolveTerminalRuntimeId();
  const preferredCapabilityId =
    sessionMode === "persistent"
      ? "pty-shell-session"
      : "child-process-shell-command";
  const chain = [...harnessEnvironment.terminal.capabilities]
    .filter(
      (capability) =>
        capability.available && capability.id === preferredCapabilityId,
    )
    .sort((left, right) => right.priority - left.priority)
    .map((capability) => ({
      id: capability.id,
      provider: capability.provider,
      priority: capability.priority,
    }));

  return {
    runtimeId,
    attachSessionId,
    operation,
    sessionId,
    sessionMode,
    preferredCapabilityId,
    chain,
  };
};

export const executeTerminalSessionRuntime = async ({
  invocationId,
  args,
  environment,
  signal,
  pushEvent,
  trace,
}: TerminalExecutionContext): Promise<TerminalExecutionResult> => {
  const harnessEnvironment = assertTerminalEnvironment(environment);
  const shellProfile = harnessEnvironment.terminal.shellProfile;
  const command = normalizeCommand(args.command);
  const continuationId = normalizeContinuationId(args.continuationId);
  const operation = normalizeTerminalOperation(args.operation);
  const controlSessionId = normalizeControlSessionId(args.sessionId);
  const outputLimitBytes = normalizeTerminalOutputLimitBytes(args.outputLimitBytes);
  const outputOffset = normalizeTerminalOutputOffset(args.outputOffset);
  const env = normalizeEnv(args.env);
  const timeoutMs = normalizeTimeoutMs(args.timeoutMs);
  const attachSessionId = normalizeAttachSessionId(args.attachSessionId);
  const sessionMode = attachSessionId
    ? "persistent"
    : normalizeSessionMode(args.sessionMode);
  const runtimeId = resolveTerminalRuntimeId();

  if (operation) {
    if (!controlSessionId) {
      throw mcpBadRequest("sessionId is required for terminal status/stop");
    }
    if (
      command ||
      continuationId ||
      attachSessionId ||
      args.cwd !== undefined ||
      env !== undefined ||
      args.sessionMode !== undefined ||
      args.timeoutMs !== undefined ||
      args.outputOffset !== undefined ||
      args.outputLimitBytes !== undefined
    ) {
      throw mcpBadRequest(
        "terminal status/stop only supports operation and sessionId",
      );
    }

    const session = getTerminalSession(controlSessionId);
    if (!session) {
      throw mcpBadRequest(`terminal session not found: ${controlSessionId}`);
    }
    const latest = await getPersistentTerminalSessionStatus(controlSessionId);

    if (operation === "stop") {
      const stopSpan = trace?.startSpan({
        name: "Stop persistent terminal session",
        kind: "command_execution",
        metadata: {
          sessionId: controlSessionId,
          state: latest?.state ?? "running",
        },
      });
      const stopped = await stopTerminalSession(controlSessionId);
      stopSpan?.end({
        status: "cancelled",
        metadata: {
          sessionId: stopped.sessionId,
          cleanupCompleted: stopped.cleanupCompleted,
        },
      });
      return {
        contents: {
          runtimeId: stopped.runtimeId,
          sessionId: stopped.sessionId,
          command: latest?.command ?? stopped.command,
          cwd: stopped.cwd,
          workspaceRelation: stopped.workspaceRelation,
          processTreeMode: stopped.processTreeMode,
          exitCode: latest?.exitCode ?? null,
          output: "",
          stdout: "",
          stderr: "",
          timedOut: false,
          reusedSession: true,
          sessionMode: "persistent",
          streamMode: "merged",
          stderrSeparated: false,
          stdoutEncoding: "utf8",
          stderrEncoding: "utf8",
          operation: "stop",
          state: "cancelled",
          commandCompleted: true,
          continuationAvailable: false,
          cleanupCompleted: stopped.cleanupCompleted,
        },
        artifacts: [],
      };
    }

    const state = latest?.state ?? "running";
    const statusSpan = trace?.startSpan({
      name: "Inspect persistent terminal session",
      kind: "stream_observation",
      metadata: {
        sessionId: controlSessionId,
        state,
        outputBytesAvailable: latest?.outputBytesAvailable ?? 0,
      },
    });
    statusSpan?.end();
    return {
      contents: {
        runtimeId: session.runtimeId,
        sessionId: session.id,
        command: latest?.command ?? session.command,
        cwd: session.cwd,
        workspaceRelation: session.workspaceRelation,
        processTreeMode: session.processTreeMode,
        exitCode: latest?.exitCode ?? null,
        output: "",
        stdout: "",
        stderr: "",
        timedOut: false,
        reusedSession: true,
        sessionMode: "persistent",
        streamMode: "merged",
        stderrSeparated: false,
        stdoutEncoding: "utf8",
        stderrEncoding: "utf8",
        operation: "status",
        state,
        commandCompleted: latest?.commandCompleted ?? false,
        continuationId: latest?.continuationId,
        continuationAvailable:
          Boolean(latest?.continuationId) &&
          ((latest?.outputBytesAvailable ?? 0) > 0 ||
            latest?.continuationAvailable === true),
        outputBytesAvailable: latest?.outputBytesAvailable,
        cleanupCompleted: false,
      },
      artifacts: [],
    };
  }

  if (controlSessionId) {
    throw mcpBadRequest("sessionId requires operation status or stop");
  }

  if (continuationId) {
    if (command) {
      throw mcpBadRequest("continuationId cannot be combined with command");
    }
    if (
      attachSessionId ||
      args.cwd !== undefined ||
      env !== undefined ||
      args.sessionMode !== undefined ||
      args.timeoutMs !== undefined
    ) {
      throw mcpBadRequest(
        "continuationId only supports outputOffset and outputLimitBytes",
      );
    }

    const observationSpan = trace?.startSpan({
      name: "Read persistent terminal output",
      kind: "stream_observation",
      metadata: {
        continuationId,
        outputOffset,
        outputLimitBytes,
      },
    });
    const observed = await observePersistentCommandOutput({
      continuationId,
      outputOffset,
      outputLimitBytes,
    });
    observationSpan?.end({
      metadata: {
        sessionId: observed.sessionId,
        outputOffset: observed.outputOffset,
        outputEndOffset: observed.outputEndOffset,
        outputBytesAvailable: observed.outputBytesAvailable,
        commandCompleted: observed.commandCompleted,
        continuationAvailable: observed.continuationAvailable,
      },
    });
    const contents: TerminalContents = {
      runtimeId: observed.runtimeId,
      sessionId: observed.sessionId,
      command: observed.command,
      cwd: observed.cwd,
      workspaceRelation: observed.workspaceRelation,
      processTreeMode: observed.processTreeMode,
      exitCode: observed.exitCode,
      output: observed.output,
      stdout: observed.stdout,
      stderr: observed.stderr,
      timedOut: !observed.commandCompleted,
      reusedSession: true,
      sessionMode: "persistent",
      streamMode: "merged",
      stderrSeparated: false,
      stdoutEncoding: "utf8",
      stderrEncoding: "utf8",
      truncated: observed.truncated,
      violations: observed.violations,
      continuationId: observed.continuationId,
      continuationAvailable: observed.continuationAvailable,
      outputOffset: observed.outputOffset,
      outputEndOffset: observed.outputEndOffset,
      nextOutputOffset: observed.nextOutputOffset,
      outputBytesAvailable: observed.outputBytesAvailable,
      outputLimitBytes: observed.outputLimitBytes,
      commandCompleted: observed.commandCompleted,
      state: observed.state,
    };
    return {
      contents,
      artifacts: [
        createTerminalArtifact({
          command: observed.command,
          output: observed.output,
          metadata: {
            runtimeId: observed.runtimeId,
            sessionId: observed.sessionId,
            cwd: observed.cwd,
            workspaceRelation: observed.workspaceRelation,
            processTreeMode: observed.processTreeMode,
            exitCode: observed.exitCode,
            sessionMode: "persistent",
            continuationId: observed.continuationId,
            continuationAvailable: observed.continuationAvailable,
            outputOffset: observed.outputOffset,
            outputEndOffset: observed.outputEndOffset,
            outputBytesAvailable: observed.outputBytesAvailable,
            outputLimitBytes: observed.outputLimitBytes,
            commandCompleted: observed.commandCompleted,
            state: observed.state,
            truncated: observed.truncated,
          },
        }),
      ],
    };
  }

  if (!command) {
    throw mcpBadRequest("command is required");
  }
  if (args.outputOffset !== undefined) {
    throw mcpBadRequest("outputOffset requires continuationId");
  }

  if (attachSessionId && (args.cwd !== undefined || env !== undefined)) {
    throw mcpBadRequest(
      "attachSessionId cannot be combined with cwd or env overrides",
    );
  }

  const planningSpan = trace?.startSpan({
    name: "Resolve terminal runtime",
    kind: "strategy_selection",
    metadata: {
      runtimeId,
      sessionMode,
      attachSessionId,
      timeoutMs,
      shell: shellProfile.shell,
    },
  });
  planningSpan?.end();

  pushEvent?.({
    type: "invocation:progress",
    message: `Terminal runtime: ${runtimeId} (${sessionMode})`,
  });

  if (sessionMode === "persistent") {
    const acquireSpan = trace?.startSpan({
      name: attachSessionId
        ? "Attach terminal PTY session"
        : "Create terminal PTY session",
      kind: "session_acquire",
      metadata: {
        runtimeId,
        attachSessionId,
      },
    });
    const { session, reusedSession } = await acquirePersistentSession({
      command,
      cwd: typeof args.cwd === "string" ? args.cwd : undefined,
      env,
      workspaceRoot: harnessEnvironment.workspace.rootPath,
      runtimeId,
      shellProfile,
      attachSessionId,
    });
    acquireSpan?.end({
      metadata: {
        sessionId: session.id,
        cwd: session.cwd,
        workspaceRelation: session.workspaceRelation,
        processTreeMode: session.processTreeMode,
      },
    });

    const commandSpan = trace?.startSpan({
      name: "Run persistent PTY command",
      kind: "command_execution",
      metadata: {
        runtimeId: session.runtimeId,
        sessionId: session.id,
        reusedSession,
        processTreeMode: session.processTreeMode,
      },
    });
    const result = await runPersistentCommand({
      invocationId,
      command,
      session,
      shellProfile,
      reusedSession,
      timeoutMs,
      outputLimitBytes,
      signal,
      pushEvent,
    });
    commandSpan?.end({
      status: signal.aborted ? "cancelled" : "completed",
      metadata: {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      },
    });

    const contents: TerminalContents = {
      runtimeId: result.runtimeId,
      sessionId: result.sessionId,
      command,
      cwd: result.cwd,
      workspaceRelation: result.workspaceRelation,
      processTreeMode: result.processTreeMode,
      exitCode: result.exitCode,
      output: result.output,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      reusedSession: result.reusedSession,
      sessionMode: "persistent",
      streamMode: "merged",
      stderrSeparated: false,
      stdoutEncoding: "utf8",
      stderrEncoding: "utf8",
      truncated: result.truncated,
      violations: result.violations,
      continuationId: result.continuationId,
      continuationAvailable: result.continuationAvailable,
      outputOffset: result.outputOffset,
      outputEndOffset: result.outputEndOffset,
      nextOutputOffset: result.nextOutputOffset,
      outputBytesAvailable: result.outputBytesAvailable,
      outputLimitBytes: result.outputLimitBytes,
      commandCompleted: result.commandCompleted,
      state: result.state,
    };
    return {
      contents,
      artifacts: [
        createTerminalArtifact({
          command,
          output: result.output,
          metadata: {
            runtimeId: result.runtimeId,
            sessionId: result.sessionId,
            cwd: result.cwd,
            workspaceRelation: result.workspaceRelation,
            processTreeMode: result.processTreeMode,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            reusedSession: result.reusedSession,
            sessionMode: "persistent",
            truncated: result.truncated,
            continuationId: result.continuationId,
            continuationAvailable: result.continuationAvailable,
            outputOffset: result.outputOffset,
            outputEndOffset: result.outputEndOffset,
            outputBytesAvailable: result.outputBytesAvailable,
            outputLimitBytes: result.outputLimitBytes,
            commandCompleted: result.commandCompleted,
            state: result.state,
          },
        }),
      ],
    };
  }

  const spawnSpan = trace?.startSpan({
    name: "Spawn host shell command",
    kind: "process_spawn",
    metadata: {
      runtimeId,
    },
  });
  const result = await executeHostCommand({
    command,
    cwd: typeof args.cwd === "string" ? args.cwd : undefined,
    env,
    timeoutMs,
    signal,
    shellProfile: toHostShellProfile(shellProfile),
    workspaceRoot: harnessEnvironment.workspace.rootPath,
    outputLimitBytes,
    pushStdout: (chunk) =>
      pushEvent?.({
        type: "invocation:stdout",
        chunk,
        stream: "stdout",
      }),
    pushStderr: (chunk) =>
      pushEvent?.({
        type: "invocation:stdout",
        chunk,
        stream: "stderr",
      }),
  });
  spawnSpan?.end({
    status: signal.aborted ? "cancelled" : "completed",
    metadata: {
      runtimeId,
      cwd: result.cwd,
      workspaceRelation: result.workspaceRelation,
      processTreeMode: result.processTreeMode,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    },
  });

  const contents: TerminalContents = {
    runtimeId,
    sessionId: crypto.randomUUID(),
    command,
    cwd: result.cwd,
    workspaceRelation: result.workspaceRelation,
    processTreeMode: result.processTreeMode,
    exitCode: result.exitCode,
    output: result.output,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    reusedSession: false,
    sessionMode: "ephemeral",
    streamMode: "split",
    stderrSeparated: true,
    stdoutEncoding: result.stdoutEncoding,
    stderrEncoding: result.stderrEncoding,
    truncated: result.truncated,
    binaryDetected: result.binaryDetected,
    violations: result.violations,
  };
  return {
    contents,
    artifacts: [
      createTerminalArtifact({
        command,
        output: result.output,
        metadata: {
          runtimeId,
          cwd: result.cwd,
          workspaceRelation: result.workspaceRelation,
          processTreeMode: result.processTreeMode,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          sessionMode: "ephemeral",
          truncated: result.truncated,
        },
      }),
    ],
  };
};
