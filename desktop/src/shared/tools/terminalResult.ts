export type TerminalResultSummary = {
  command?: string;
  cwd?: string;
  sessionId?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  reusedSession?: boolean;
  sessionMode?: "ephemeral" | "persistent";
  streamMode?: "split" | "merged";
  stderrSeparated?: boolean;
  stdout?: string;
  stderr?: string;
  state?: "running" | "completed" | "failed" | "cancelled";
  continuationId?: string;
  continuationAvailable?: boolean;
  nextOutputOffset?: number;
  outputBytesAvailable?: number;
  outputLimitBytes?: number;
  commandCompleted?: boolean;
  cleanupCompleted?: boolean;
};

export function getTerminalResultSummary(value: unknown): TerminalResultSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.command !== "string" ||
    typeof candidate.cwd !== "string" ||
    !("streamMode" in candidate)
  ) {
    return null;
  }

  return {
    command: candidate.command,
    cwd: candidate.cwd,
    sessionId: typeof candidate.sessionId === "string" ? candidate.sessionId : undefined,
    exitCode:
      typeof candidate.exitCode === "number" || candidate.exitCode === null
        ? (candidate.exitCode as number | null)
        : undefined,
    timedOut: typeof candidate.timedOut === "boolean" ? candidate.timedOut : undefined,
    reusedSession:
      typeof candidate.reusedSession === "boolean" ? candidate.reusedSession : undefined,
    sessionMode:
      candidate.sessionMode === "ephemeral" || candidate.sessionMode === "persistent"
        ? candidate.sessionMode
        : undefined,
    streamMode:
      candidate.streamMode === "split" || candidate.streamMode === "merged"
        ? candidate.streamMode
        : undefined,
    stderrSeparated:
      typeof candidate.stderrSeparated === "boolean" ? candidate.stderrSeparated : undefined,
    stdout: typeof candidate.stdout === "string" ? candidate.stdout : undefined,
    stderr: typeof candidate.stderr === "string" ? candidate.stderr : undefined,
    state:
      candidate.state === "running" ||
      candidate.state === "completed" ||
      candidate.state === "failed" ||
      candidate.state === "cancelled"
        ? candidate.state
        : undefined,
    continuationId:
      typeof candidate.continuationId === "string"
        ? candidate.continuationId
        : undefined,
    continuationAvailable:
      typeof candidate.continuationAvailable === "boolean"
        ? candidate.continuationAvailable
        : undefined,
    nextOutputOffset:
      typeof candidate.nextOutputOffset === "number"
        ? candidate.nextOutputOffset
        : undefined,
    outputBytesAvailable:
      typeof candidate.outputBytesAvailable === "number"
        ? candidate.outputBytesAvailable
        : undefined,
    outputLimitBytes:
      typeof candidate.outputLimitBytes === "number"
        ? candidate.outputLimitBytes
        : undefined,
    commandCompleted:
      typeof candidate.commandCompleted === "boolean"
        ? candidate.commandCompleted
        : undefined,
    cleanupCompleted:
      typeof candidate.cleanupCompleted === "boolean"
        ? candidate.cleanupCompleted
        : undefined,
  };
}
