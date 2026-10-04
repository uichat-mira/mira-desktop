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

export const runPersistentCommand = async (input: {
  invocationId: string;
  command: string;
  session: TerminalSessionRecord;
  shellProfile: TerminalShellProfile;
  reusedSession: boolean;
  timeoutMs: number;
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
  let rawBuffer = "";
  let streamedOffset = 0;
  let exitCode: number | null = null;
  let timedOut = false;
  let done = false;

  const flushVisibleOutput = () => {
    const markerMatch = markerPattern.exec(rawBuffer);
    const visibleText = markerMatch
      ? rawBuffer.slice(0, markerMatch.index)
      : rawBuffer;
    if (visibleText.length <= streamedOffset) {
      return;
    }

    const nextChunk = visibleText.slice(streamedOffset);
    if (nextChunk) {
      input.pushEvent?.({
        type: "invocation:stdout",
        chunk: nextChunk,
        stream: "stdout",
      });
      streamedOffset = visibleText.length;
    }
  };

  const dataDisposable = input.session.process.onData((chunk) => {
    rawBuffer += chunk;
    flushVisibleOutput();
    const markerMatch = markerPattern.exec(rawBuffer);
    if (markerMatch) {
      exitCode = Number(markerMatch[1]);
      done = true;
    }
  });
  const exitDisposable = input.session.process.onExit(
    ({ exitCode: nextExitCode }) => {
      if (done) {
        return;
      }
      flushVisibleOutput();
      exitCode = nextExitCode;
      done = true;
    },
  );

  writeTerminalSession(input.session.id, wrappedCommand);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      done = true;
      input.pushEvent?.({
        type: "invocation:progress",
        message: `Terminal command is still running after ${input.timeoutMs}ms; persistent session ${input.session.id} remains attached to the host process.`,
      });
      resolve();
    }, input.timeoutMs);

    const interval = setInterval(() => {
      if (!done) {
        return;
      }
      clearInterval(interval);
      clearTimeout(timer);
      resolve();
    }, 10);

    input.signal.addEventListener(
      "abort",
      () => {
        clearInterval(interval);
        clearTimeout(timer);
        if (!input.reusedSession) {
          removeTerminalSession(input.session.id);
        }
        reject(new Error("Terminal session aborted"));
      },
      { once: true },
    );
  });

  dataDisposable.dispose();
  exitDisposable.dispose();
  const stdout = rawBuffer.replace(markerPattern, "").trimEnd();
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
  ];

  return {
    sessionId: input.session.id,
    runtimeId: input.session.runtimeId,
    cwd: input.session.cwd,
    workspaceRelation: input.session.workspaceRelation,
    processTreeMode: input.session.processTreeMode,
    exitCode,
    timedOut,
    reusedSession: input.reusedSession,
    stdout,
    stderr: "",
    output: stdout,
    violations,
  };
};
