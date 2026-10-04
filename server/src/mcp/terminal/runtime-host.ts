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
  acquirePersistentSession,
  runPersistentCommand,
} from "./pty-command-runtime.js";
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

const normalizeCommand = (value: unknown) => {
  const command = typeof value === "string" ? value.trim() : "";
  if (!command) {
    throw mcpBadRequest("command is required");
  }
  return command;
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
  const sessionMode = attachSessionId
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
  const env = normalizeEnv(args.env);
  const timeoutMs = normalizeTimeoutMs(args.timeoutMs);
  const attachSessionId = normalizeAttachSessionId(args.attachSessionId);
  const sessionMode = attachSessionId
    ? "persistent"
    : normalizeSessionMode(args.sessionMode);
  const runtimeId = resolveTerminalRuntimeId();

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
      violations: result.violations,
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
