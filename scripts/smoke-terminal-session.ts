import path from "node:path";

const [resourcesRoot, workspaceRoot] = process.argv.slice(2);
if (!resourcesRoot || !workspaceRoot) {
  throw new Error("Usage: smoke-terminal-session.ts <resources-root> <workspace-root>");
}

process.env.UI_CHAT_DESKTOP_RESOURCES_ROOT = path.resolve(resourcesRoot);

const [{ executeTerminalSessionRuntime }, { clearTerminalSessions, listTerminalSessions, writeTerminalSession }] =
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

  writeTerminalSession(first.contents.sessionId, "exit");
  await new Promise((resolve) => setTimeout(resolve, 750));
  clearTerminalSessions();
  if (listTerminalSessions().length !== 0) {
    throw new Error("Persistent terminal process tree was not removed from the session registry");
  }

  console.log(JSON.stringify({
    ephemeral: { exitCode: ephemeral.contents.exitCode, processTreeMode: ephemeral.contents.processTreeMode },
    persistent: {
      sessionId: first.contents.sessionId,
      reused: second.contents.reusedSession,
      processTreeMode: first.contents.processTreeMode,
      cleaned: true,
    },
  }));
} finally {
  clearTerminalSessions();
}
