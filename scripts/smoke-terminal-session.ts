import path from "node:path";

import { runTerminalSessionContractSmoke } from "./terminal-session-contract-smoke.js";

const [resourcesRoot, workspaceRoot] = process.argv.slice(2);
if (!resourcesRoot || !workspaceRoot) {
  throw new Error(
    "Usage: smoke-terminal-session.ts <resources-root> <workspace-root>",
  );
}

process.env.UI_CHAT_DESKTOP_RESOURCES_ROOT = path.resolve(resourcesRoot);

const [
  { executeTerminalSessionRuntime },
  { clearTerminalSessions, listTerminalSessions },
] = await Promise.all([
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
  workspace: {
    rootPath: path.resolve(workspaceRoot),
    source: "selected" as const,
  },
  approvals: {
    outsideWorkspace: "prompt" as const,
    persistence: "thread" as const,
  },
  trace: { streamEvents: true },
  read: { capabilities: [] },
  edit: { capabilities: [] },
  web_search: { capabilities: [] },
  terminal: {
    capabilities: [
      {
        id: "child-process-shell-command",
        kind: "write" as const,
        provider: "node-child_process",
        available: true,
        priority: 110,
      },
      {
        id: "pty-shell-session",
        kind: "write" as const,
        provider: "node-pty",
        available: true,
        priority: 100,
      },
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

const run = (args: Record<string, unknown>) =>
  executeTerminalSessionRuntime({
    invocationId: crypto.randomUUID(),
    args,
    environment,
    signal: new AbortController().signal,
  });

try {
  const result = await runTerminalSessionContractSmoke({
    run,
    listSessionCount: () => listTerminalSessions().length,
    commands: {
      ephemeral: {
        command:
          "Write-Output 'ephemeral-ok'; node --version; npm --version; git --version; rg --version; uv --version",
        cwd: workspaceRoot,
        env: { PATH: systemPath },
        timeoutMs: 30_000,
      },
      firstPersistent: {
        command: "Write-Output 'persistent-one'",
        cwd: workspaceRoot,
        env: { PATH: systemPath },
        sessionMode: "persistent",
        timeoutMs: 30_000,
      },
      secondPersistent: (sessionId) => ({
        command: "Write-Output 'persistent-two'; node --version",
        attachSessionId: sessionId,
        timeoutMs: 30_000,
      }),
      controlledPersistent: {
        command:
          "1..40 | ForEach-Object { Write-Output ('MIRA_TICK:' + $_); Start-Sleep -Milliseconds 100 }",
        cwd: workspaceRoot,
        env: { PATH: systemPath },
        sessionMode: "persistent",
        timeoutMs: 350,
        outputLimitBytes: 4096,
      },
    },
    markers: {
      ephemeral: "ephemeral-ok",
      firstPersistent: "persistent-one",
      secondPersistent: "persistent-two",
      controlled: "MIRA_TICK:",
    },
  });

  console.log(
    JSON.stringify({
      ephemeral: {
        exitCode: result.ephemeral.contents.exitCode,
        processTreeMode: result.ephemeral.contents.processTreeMode,
      },
      persistent: {
        sessionId: result.first.contents.sessionId,
        reused: result.second.contents.reusedSession,
        processTreeMode: result.first.contents.processTreeMode,
        completedSessionStopped:
          result.completedStop.contents.cleanupCompleted === true,
      },
      controlled: {
        sessionId: result.controlled.contents.sessionId,
        initialState: result.controlled.contents.state,
        statusState: result.status.contents.state,
        continuedBytes: result.continued.contents.output.length,
        stoppedState: result.stopped.contents.state,
        cleanupCompleted: result.stopped.contents.cleanupCompleted,
      },
    }),
  );
} finally {
  clearTerminalSessions();
}
