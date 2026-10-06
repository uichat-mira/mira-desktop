import type {
  ToolExecutionEnvironment,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import {
  createTerminalSession,
  getTerminalSession,
  removeTerminalSession,
  type TerminalSessionRecord,
  writeTerminalSession,
} from "../terminal-sessions.js";
import {
  appendPersistentTerminalOutput,
  completePersistentTerminalOutput,
  createPersistentTerminalOutput,
  readPersistentTerminalOutput,
} from "./persistent-output-store.js";
import type { TerminalRuntimeId } from "./runtime-contract.js";

export type TerminalShellProfile =
  ToolExecutionEnvironment["terminal"]["shellProfile"];

const escapeRegex = (input: string) =>
  input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildTerminalCompletionMarker = (invocationId: string) =>
  `__MIRA_TERMINAL_DONE__:${invocationId}:${crypto.randomUUID().replace(/-/g, "")}`;

const buildWrappedCommand = (
  profile: TerminalShellProfile,
  command: string,
  marker: string,
) => {
  if (profile.argsMode === "powershell") {
    return `& { ${command}; $code = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }; Write-Output "${marker}:$code" }`;
  }
  if (profile.argsMode === "cmd") {
    return `(${command}) & echo ${marker}:%errorlevel%`;
  }
  return `{ ${command}; code=$?; printf '\\n${marker}:%s\\n' "$code"; }`;
};

export const acquirePersistentSession = async (input: {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  workspaceRoot?: string | null;
  runtimeId: TerminalRuntimeId;
  shellProfile: TerminalShellProfile;
  attachSessionId?: string;
}) => {
  const session = input.attachSessionId
    ? getTerminalSession(input.attachSessionId)
    : await createTerminalSession({
        command: input.command,
        cwd: input.cwd,
        env: input.env,
        workspaceRoot: input.workspaceRoot,
        runtimeId: input.runtimeId,
        shellProfile: input.shellProfile,
      });

  if (!session) {
    throw mcpBadRequest(`terminal session not found: ${input.attachSessionId}`);
  }

  return {
    session,
    reusedSession: Boolean(input.attachSessionId),
  };
};

export const observePersistentCommandOutput = async (input: {
  continuationId: string;
  outputOffset?: number;
  outputLimitBytes?: number;
}) => {
  const page = await readPersistentTerminalOutput({
    id: input.continuationId,
    offset: input.outputOffset,
    limitBytes: input.outputLimitBytes,
  });
  const session = getTerminalSession(page.sessionId);
  if (!session) {
    throw mcpBadRequest(`terminal session not found: ${page.sessionId}`);
  }
  return {
    ...page,
    runtimeId: session.runtimeId,
    cwd: session.cwd,
    workspaceRelation: session.workspaceRelation,
    processTreeMode: session.processTreeMode,
    stdout: page.output,
    stderr: "",
    reusedSession: true,
    violations: [] as string[],
  };
};

export const runPersistentCommand = async (input: {
  invocationId: string;
  command: string;
  session: TerminalSessionRecord;
  shellProfile: TerminalShellProfile;
  reusedSession: boolean;
  timeoutMs: number;
  outputLimitBytes?: number;
  signal: AbortSignal;
  pushEvent?: (event: ToolInvocationEventInput) => void;
}) => {
  if (input.signal.aborted) {
    throw new Error("Terminal session aborted");
  }

  const marker = buildTerminalCompletionMarker(input.invocationId);
  const markerPattern = new RegExp(`${escapeRegex(marker)}:(-?\\d+)`);
  const wrappedCommand = buildWrappedCommand(
    input.shellProfile,
    input.command,
    marker,
  );
  const outputRecord = createPersistentTerminalOutput({
    sessionId: input.session.id,
    command: input.command,
  });
  const markerPrefix = `${marker}:`;
  let pendingBuffer = "";
  let exitCode: number | null = null;
  let timedOut = false;
  let commandCompleted = false;
  let invocationSettled = false;
  let completionPromise: Promise<void> = Promise.resolve();
  let dataDisposable: ReturnType<TerminalSessionRecord["process"]["onData"]>;
  let exitDisposable: ReturnType<TerminalSessionRecord["process"]["onExit"]>;
  let settleInvocation: (() => void) | null = null;

  const appendVisible = (text: string) => {
    if (!text) return;
    appendPersistentTerminalOutput(outputRecord.id, text, {
      pause: () => input.session.process.pause(),
      resume: () => input.session.process.resume(),
    });
    if (!invocationSettled) {
      input.pushEvent?.({
        type: "invocation:stdout",
        chunk: text,
        stream: "stdout",
      });
    }
  };

  const completeCollector = (nextExitCode: number | null) => {
    if (commandCompleted) return;
    commandCompleted = true;
    exitCode = nextExitCode;
    if (pendingBuffer) {
      appendVisible(pendingBuffer);
      pendingBuffer = "";
    }
    dataDisposable.dispose();
    exitDisposable.dispose();
    completionPromise = completePersistentTerminalOutput(
      outputRecord.id,
      nextExitCode,
    );
    settleInvocation?.();
  };

  const longestMarkerPrefixSuffix = (text: string) => {
    const maxLength = Math.min(text.length, markerPrefix.length);
    for (let length = maxLength; length > 0; length -= 1) {
      if (markerPrefix.startsWith(text.slice(-length))) {
        return length;
      }
    }
    return 0;
  };

  dataDisposable = input.session.process.onData((chunk) => {
    if (commandCompleted) return;
    pendingBuffer += chunk;

    const markerMatch = markerPattern.exec(pendingBuffer);
    if (markerMatch) {
      appendVisible(pendingBuffer.slice(0, markerMatch.index));
      pendingBuffer = "";
      completeCollector(Number(markerMatch[1]));
      return;
    }

    const markerStart = pendingBuffer.indexOf(markerPrefix);
    if (markerStart >= 0) {
      const afterPrefix = pendingBuffer.slice(
        markerStart + markerPrefix.length,
      );
      const plausibleIncompleteMarker =
        afterPrefix === "" ||
        afterPrefix === "-" ||
        /^-?\d*$/.test(afterPrefix);
      if (plausibleIncompleteMarker) {
        appendVisible(pendingBuffer.slice(0, markerStart));
        pendingBuffer = pendingBuffer.slice(markerStart);
        return;
      }

      const flushThrough = markerStart + markerPrefix.length;
      appendVisible(pendingBuffer.slice(0, flushThrough));
      pendingBuffer = pendingBuffer.slice(flushThrough);
    }

    const retainedLength = longestMarkerPrefixSuffix(pendingBuffer);
    const flushLength = pendingBuffer.length - retainedLength;
    if (flushLength > 0) {
      appendVisible(pendingBuffer.slice(0, flushLength));
      pendingBuffer = pendingBuffer.slice(flushLength);
    }
  });
  exitDisposable = input.session.process.onExit(
    ({ exitCode: nextExitCode }) => {
      if (commandCompleted) return;
      completeCollector(nextExitCode);
    },
  );

  writeTerminalSession(input.session.id, wrappedCommand);

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      if (invocationSettled) return;
      invocationSettled = true;
      clearTimeout(timer);
      settleInvocation = null;
      dataDisposable.dispose();
      exitDisposable.dispose();
      void completePersistentTerminalOutput(outputRecord.id, exitCode);
      if (!input.reusedSession) {
        removeTerminalSession(input.session.id);
      }
      reject(new Error("Terminal session aborted"));
    };

    const timer = setTimeout(() => {
      timedOut = true;
      invocationSettled = true;
      settleInvocation = null;
      input.pushEvent?.({
        type: "invocation:progress",
        message: `Terminal command is still running after ${input.timeoutMs}ms; persistent session ${input.session.id} remains attached to the host process.`,
      });
      input.signal.removeEventListener("abort", onAbort);
      resolve();
    }, input.timeoutMs);

    settleInvocation = () => {
      if (invocationSettled) return;
      invocationSettled = true;
      clearTimeout(timer);
      settleInvocation = null;
      input.signal.removeEventListener("abort", onAbort);
      resolve();
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
  });

  if (commandCompleted) {
    await completionPromise;
  }

  const page = await readPersistentTerminalOutput({
    id: outputRecord.id,
    offset: 0,
    limitBytes: input.outputLimitBytes,
  });
  const violations = [
    ...(input.session.workspaceRelation === "outside"
      ? [
          "cwd_outside_workspace: execution was approved and continued on the host runtime",
        ]
      : []),
    ...(input.session.processTreeMode === "windows_taskkill_tree" &&
    input.session.runtimeId === "host_spawn" &&
    process.platform === "win32"
      ? [
          "windows_job_object_unavailable: taskkill tree fallback remains active",
        ]
      : []),
    ...(page.truncated
      ? [
          `terminal output page truncated at ${page.outputLimitBytes} bytes; remaining output is available through continuation ${page.continuationId}`,
        ]
      : []),
  ];

  return {
    sessionId: input.session.id,
    runtimeId: input.session.runtimeId,
    cwd: input.session.cwd,
    workspaceRelation: input.session.workspaceRelation,
    processTreeMode: input.session.processTreeMode,
    exitCode: page.exitCode ?? exitCode,
    timedOut,
    reusedSession: input.reusedSession,
    stdout: page.output,
    stderr: "",
    output: page.output,
    truncated: page.truncated,
    continuationId: page.continuationId,
    continuationAvailable: page.continuationAvailable,
    outputOffset: page.outputOffset,
    outputEndOffset: page.outputEndOffset,
    nextOutputOffset: page.nextOutputOffset,
    outputBytesAvailable: page.outputBytesAvailable,
    outputLimitBytes: page.outputLimitBytes,
    commandCompleted: page.commandCompleted,
    violations,
  };
};
