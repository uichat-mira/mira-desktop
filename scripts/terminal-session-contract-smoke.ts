type TerminalContents = {
  exitCode: number | null;
  output: string;
  sessionId?: string;
  reusedSession?: boolean;
  processTreeMode?: string;
  workspaceRelation?: string;
  state?: "running" | "completed" | "failed" | "cancelled";
  commandCompleted?: boolean;
  continuationId?: string;
  nextOutputOffset?: number;
  cleanupCompleted?: boolean;
};

type TerminalRunResult = {
  contents: TerminalContents;
};

export type TerminalContractSmokeConfig = {
  run: (args: Record<string, unknown>) => Promise<TerminalRunResult>;
  listSessionCount: () => number;
  commands: {
    ephemeral: Record<string, unknown>;
    firstPersistent: Record<string, unknown>;
    secondPersistent: (sessionId: string) => Record<string, unknown>;
    controlledPersistent: Record<string, unknown>;
  };
  markers: {
    ephemeral: string;
    firstPersistent: string;
    secondPersistent: string;
    controlled: string;
  };
  waitBeforeContinuationMs?: number;
  assertEphemeral?: (result: TerminalRunResult) => void | Promise<void>;
  assertFirstPersistent?: (result: TerminalRunResult) => void | Promise<void>;
  assertSecondPersistent?: (result: TerminalRunResult) => void | Promise<void>;
  afterFirstPersistent?: (
    result: TerminalRunResult,
  ) => void | Promise<void>;
  afterCompletedStop?: (
    result: TerminalRunResult,
  ) => void | Promise<void>;
  afterControlledStart?: (
    result: TerminalRunResult,
  ) => void | Promise<void>;
  afterControlledStop?: (
    result: TerminalRunResult,
  ) => void | Promise<void>;
};

export const runTerminalSessionContractSmoke = async (
  config: TerminalContractSmokeConfig,
) => {
  const ephemeral = await config.run(config.commands.ephemeral);
  if (
    ephemeral.contents.exitCode !== 0 ||
    !ephemeral.contents.output.includes(config.markers.ephemeral)
  ) {
    throw new Error(
      `Ephemeral terminal failed: ${ephemeral.contents.output}`,
    );
  }
  await config.assertEphemeral?.(ephemeral);

  const first = await config.run(config.commands.firstPersistent);
  if (
    !first.contents.sessionId ||
    !first.contents.output.includes(config.markers.firstPersistent)
  ) {
    throw new Error(
      `First persistent terminal command failed: ${first.contents.output}`,
    );
  }
  await config.assertFirstPersistent?.(first);
  await config.afterFirstPersistent?.(first);

  const second = await config.run(
    config.commands.secondPersistent(first.contents.sessionId),
  );
  if (
    !second.contents.reusedSession ||
    !second.contents.output.includes(config.markers.secondPersistent)
  ) {
    throw new Error(
      `Persistent terminal continuation failed: ${second.contents.output}`,
    );
  }
  await config.assertSecondPersistent?.(second);

  const completedStop = await config.run({
    operation: "stop",
    sessionId: first.contents.sessionId,
  });
  assertStopped(completedStop, "Completed persistent session");
  await config.afterCompletedStop?.(completedStop);

  const controlled = await config.run(config.commands.controlledPersistent);
  if (
    controlled.contents.state !== "running" ||
    controlled.contents.commandCompleted !== false ||
    !controlled.contents.sessionId ||
    !controlled.contents.continuationId ||
    typeof controlled.contents.nextOutputOffset !== "number"
  ) {
    throw new Error(
      `Persistent observation did not return a running continuation: ${JSON.stringify(controlled.contents)}`,
    );
  }
  await config.afterControlledStart?.(controlled);

  const status = await config.run({
    operation: "status",
    sessionId: controlled.contents.sessionId,
  });
  if (
    status.contents.state !== "running" ||
    status.contents.sessionId !== controlled.contents.sessionId
  ) {
    throw new Error(
      `Persistent status did not report the running session: ${JSON.stringify(status.contents)}`,
    );
  }

  await new Promise((resolve) =>
    setTimeout(resolve, config.waitBeforeContinuationMs ?? 350),
  );

  const continued = await config.run({
    continuationId: controlled.contents.continuationId,
    outputOffset: controlled.contents.nextOutputOffset,
    outputLimitBytes: 4096,
  });
  if (
    continued.contents.sessionId !== controlled.contents.sessionId ||
    !continued.contents.output.includes(config.markers.controlled)
  ) {
    throw new Error(
      `Persistent continuation did not expose later output: ${JSON.stringify(continued.contents)}`,
    );
  }

  const stopped = await config.run({
    operation: "stop",
    sessionId: controlled.contents.sessionId,
  });
  assertStopped(stopped, "Persistent session");
  await config.afterControlledStop?.(stopped);

  if (config.listSessionCount() !== 0) {
    throw new Error(
      "Persistent terminal process tree was not removed from the session registry",
    );
  }

  return {
    ephemeral,
    first,
    second,
    completedStop,
    controlled,
    status,
    continued,
    stopped,
  };
};

const assertStopped = (result: TerminalRunResult, label: string) => {
  if (
    result.contents.state !== "cancelled" ||
    result.contents.cleanupCompleted !== true
  ) {
    throw new Error(
      `${label} did not stop cleanly: ${JSON.stringify(result.contents)}`,
    );
  }
};
