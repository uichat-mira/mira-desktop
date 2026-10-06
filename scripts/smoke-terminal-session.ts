import path from "node:path";

const [resourcesRoot, workspaceRoot] = process.argv.slice(2);
if (!resourcesRoot || !workspaceRoot) {
  throw new Error("Usage: smoke-terminal-session.ts <resources-root> <workspace-root>");
}

process.env.UI_CHAT_DESKTOP_RESOURCES_ROOT = path.resolve(resourcesRoot);

const [{ executeTerminalSessionRuntime }, { clearTerminalSessions, listTerminalSessions }] =
  await Promise.all([
    import("../server/src/mcp/terminal/runtime-host.js"),
    import("../server/src/mcp/terminal-sessions.js"),
  ]);

const shell = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const systemPath = [
  path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
  path.dirname(shell),
].join(path.delimiter);
const environment = {
  source: "harness" as const,
  workspace: { rootPath: path.resolve(workspaceRoot), source: "selected" as const },
  approvals: { outsideWorkspace: "prompt" as const, persistence: "thread" as const },
  trace: { streamEvents: true },
  read: { capabilities: [] },
  edit: { capabilities: [] },
  web_search: { capabilities: [] },
  terminal: {
    capabilities: [
      { id: "child-process-shell-command", kind: "write" as const, provider: "node-child_process", available: true, priority: 110 },
      { id: "pty-shell-session", kind: "write" as const, provider: "node-pty", available: true, priority: 100 },
    ],
    shellProfile: {
      shell,
      shellFamily: "powershell" as const,
      argsMode: "powershell" as const,
      stdoutEncoding: "utf16le",
      stderrEncoding: "utf16le",
    },
  },
};

const run = (args: Record<string, unknown>) => executeTerminalSessionRuntime({
  invocationId: crypto.randomUUID(),
  args,
  environment,
  signal: new AbortController().signal,
});

try {
  const ephemeral = await run({
    command: "Write-Output 'ephemeral-ok'; node --version; npm --version; git --version; rg --version; uv --version",
    cwd: workspaceRoot,
    env: { PATH: systemPath },
    timeoutMs: 30_000,
  });
  if (ephemeral.contents.exitCode !== 0 || !ephemeral.contents.output.includes("ephemeral-ok")) {
    throw new Error(`Ephemeral terminal failed: ${ephemeral.contents.output}`);
  }

  const first = await run({
    command: "Write-Output 'persistent-one'",
    cwd: workspaceRoot,
    env: { PATH: systemPath },
    sessionMode: "persistent",
    timeoutMs: 30_000,
  });
  if (!first.contents.output.includes("persistent-one")) {
    throw new Error(`First persistent terminal command failed: ${first.contents.output}`);
  }

  const second = await run({
    command: "Write-Output 'persistent-two'; node --version",
    attachSessionId: first.contents.sessionId,
    timeoutMs: 30_000,
  });
  if (!second.contents.reusedSession || !second.contents.output.includes("persistent-two")) {
    throw new Error(`Persistent terminal continuation failed: ${second.contents.output}`);
  }

  const completedStop = await run({
    operation: "stop",
    sessionId: first.contents.sessionId,
  });
  if (
    completedStop.contents.state !== "cancelled" ||
    completedStop.contents.cleanupCompleted !== true
  ) {
    throw new Error("Completed persistent session did not stop cleanly");
  }

  const controlled = await run({
    command:
      "1..40 | ForEach-Object { Write-Output ('MIRA_TICK:' + $_); Start-Sleep -Milliseconds 100 }",
    cwd: workspaceRoot,
    env: { PATH: systemPath },
    sessionMode: "persistent",
    timeoutMs: 350,
    outputLimitBytes: 4096,
  });
  if (
    controlled.contents.state !== "running" ||
    controlled.contents.commandCompleted !== false ||
    !controlled.contents.continuationId ||
    typeof controlled.contents.nextOutputOffset !== "number"
  ) {
    throw new Error(
      `Persistent observation did not return a running continuation: ${JSON.stringify(controlled.contents)}`,
    );
  }

  const status = await run({
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

  await new Promise((resolve) => setTimeout(resolve, 350));
  const continued = await run({
    continuationId: controlled.contents.continuationId,
    outputOffset: controlled.contents.nextOutputOffset,
    outputLimitBytes: 4096,
  });
  if (
    continued.contents.sessionId !== controlled.contents.sessionId ||
    !continued.contents.output.includes("MIRA_TICK:")
  ) {
    throw new Error(
      `Persistent continuation did not expose later output: ${JSON.stringify(continued.contents)}`,
    );
  }

  const stopped = await run({
    operation: "stop",
    sessionId: controlled.contents.sessionId,
  });
  if (
    stopped.contents.state !== "cancelled" ||
    stopped.contents.cleanupCompleted !== true
  ) {
    throw new Error(
      `Persistent stop did not verify cleanup: ${JSON.stringify(stopped.contents)}`,
    );
  }

  if (listTerminalSessions().length !== 0) {
    throw new Error("Persistent terminal process tree was not removed from the session registry");
  }

  console.log(JSON.stringify({
    ephemeral: { exitCode: ephemeral.contents.exitCode, processTreeMode: ephemeral.contents.processTreeMode },
    persistent: {
      sessionId: first.contents.sessionId,
      reused: second.contents.reusedSession,
      processTreeMode: first.contents.processTreeMode,
      completedSessionStopped: completedStop.contents.cleanupCompleted === true,
    },
    controlled: {
      sessionId: controlled.contents.sessionId,
      initialState: controlled.contents.state,
      statusState: status.contents.state,
      continuedBytes: continued.contents.output.length,
      stoppedState: stopped.contents.state,
      cleanupCompleted: stopped.contents.cleanupCompleted,
    },
  }));
} finally {
  clearTerminalSessions();
}
