import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runTerminalSessionContractSmoke } from "./terminal-session-contract-smoke.js";

if (process.platform !== "darwin") {
  throw new Error("macOS terminal smoke requires darwin");
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const testArtifactRoot = path.join(repositoryRoot, ".test-artifact");
fs.mkdirSync(testArtifactRoot, { recursive: true });
const workspaceRoot = fs.mkdtempSync(
  path.join(testArtifactRoot, "Workspace macOS 中文-"),
);
const nestedWorkspace = path.join(workspaceRoot, "Nested 子目录");
fs.mkdirSync(nestedWorkspace);
process.env.UI_CHAT_WORKSPACE_ROOT = workspaceRoot;

const [
  { createHarnessEnvironmentSnapshot },
  { executeTerminalSessionRuntime },
  { clearTerminalSessions, getTerminalSession, listTerminalSessions },
] = await Promise.all([
  import("../server/src/harness/environment.js"),
  import("../server/src/mcp/terminal/runtime-host.js"),
  import("../server/src/mcp/terminal-sessions.js"),
]);

const environment = createHarnessEnvironmentSnapshot();
if (environment.workspace.rootPath !== workspaceRoot) {
  throw new Error(
    `Workspace root mismatch: ${environment.workspace.rootPath ?? "unset"}`,
  );
}
if (environment.terminal.shellProfile.shellFamily !== "posix") {
  throw new Error(
    `Expected POSIX shell profile, received ${environment.terminal.shellProfile.shellFamily}`,
  );
}

const run = (args: Record<string, unknown>) =>
  executeTerminalSessionRuntime({
    invocationId: randomUUID(),
    args,
    environment,
    signal: new AbortController().signal,
  });

const isPidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

const waitForPidExit = async (pid: number) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Persistent terminal process did not exit: ${pid}`);
};

let persistentSessionId: string | null = null;
let persistentPid: number | null = null;
let controlledPid: number | null = null;

try {
  const result = await runTerminalSessionContractSmoke({
    run,
    listSessionCount: () => listTerminalSessions().length,
    commands: {
      ephemeral: {
        command:
          "printf 'ephemeral-ok\\n'; printf 'cwd=%s\\n' \"$PWD\"; printf 'mac-workspace-ok\\n' > '终端 验证.txt'; cat '终端 验证.txt'; node --version",
        cwd: ".",
        timeoutMs: 30_000,
      },
      firstPersistent: {
        command:
          "printf 'persistent-one\\n'; printf 'persistent-cwd=%s\\n' \"$PWD\"",
        cwd: "Nested 子目录",
        sessionMode: "persistent",
        timeoutMs: 30_000,
      },
      secondPersistent: (sessionId) => ({
        command:
          "printf 'persistent-two\\n'; printf 'session-cwd=%s\\n' \"$PWD\"",
        attachSessionId: sessionId,
        timeoutMs: 30_000,
      }),
      controlledPersistent: {
        command:
          "i=0; while :; do i=$((i+1)); printf 'MIRA_TICK:%s\\n' \"$i\"; sleep 0.1; done",
        cwd: ".",
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
    assertEphemeral: ({ contents }) => {
      if (
        contents.workspaceRelation !== "inside" ||
        contents.processTreeMode !== "posix_process_group" ||
        !contents.output.includes("mac-workspace-ok") ||
        !contents.output.includes(`cwd=${workspaceRoot}`)
      ) {
        throw new Error(`macOS ephemeral contract failed: ${contents.output}`);
      }
    },
    assertFirstPersistent: ({ contents }) => {
      if (
        contents.exitCode !== 0 ||
        contents.workspaceRelation !== "inside" ||
        contents.processTreeMode !== "posix_process_group" ||
        !contents.output.includes(`persistent-cwd=${nestedWorkspace}`)
      ) {
        throw new Error(
          `macOS persistent contract failed: ${contents.output}`,
        );
      }
    },
    assertSecondPersistent: ({ contents }) => {
      if (
        contents.exitCode !== 0 ||
        !contents.output.includes(`session-cwd=${nestedWorkspace}`)
      ) {
        throw new Error(
          `macOS attached-session contract failed: ${contents.output}`,
        );
      }
    },
    afterFirstPersistent: ({ contents }) => {
      persistentSessionId = contents.sessionId ?? null;
      persistentPid = persistentSessionId
        ? getTerminalSession(persistentSessionId)?.process.pid ?? null
        : null;
    },
    afterCompletedStop: async () => {
      if (persistentPid !== null) {
        await waitForPidExit(persistentPid);
      }
    },
    afterControlledStart: ({ contents }) => {
      controlledPid = contents.sessionId
        ? getTerminalSession(contents.sessionId)?.process.pid ?? null
        : null;
    },
    afterControlledStop: async () => {
      if (controlledPid !== null) {
        await waitForPidExit(controlledPid);
      }
    },
  });

  const report = {
    platform: process.platform,
    architecture: process.arch,
    workspace: {
      root: workspaceRoot,
      unicodePath: true,
      fileWrite: true,
    },
    shell: environment.terminal.shellProfile.shell,
    ephemeral: {
      exitCode: result.ephemeral.contents.exitCode,
      processTreeMode: result.ephemeral.contents.processTreeMode,
    },
    persistent: {
      reused: result.second.contents.reusedSession,
      processTreeMode: result.first.contents.processTreeMode,
      processExited: persistentPid === null || !isPidAlive(persistentPid),
      completedSessionStopped:
        result.completedStop.contents.cleanupCompleted === true,
    },
    controlled: {
      initialState: result.controlled.contents.state,
      statusState: result.status.contents.state,
      continuedBytes: result.continued.contents.output.length,
      stoppedState: result.stopped.contents.state,
      cleanupCompleted: result.stopped.contents.cleanupCompleted,
      processExited: controlledPid === null || !isPidAlive(controlledPid),
    },
  };
  fs.writeFileSync(
    path.join(testArtifactRoot, "terminal-contract-smoke-macos.json"),
    `${JSON.stringify(report, null, 2)}\\n`,
  );
  console.log(JSON.stringify(report));
} finally {
  if (persistentSessionId && getTerminalSession(persistentSessionId)) {
    clearTerminalSessions();
  }
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}
