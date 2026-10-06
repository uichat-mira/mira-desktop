import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  {
    clearTerminalSessions,
    getTerminalSession,
    listTerminalSessions,
    writeTerminalSession,
  },
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

try {
  const ephemeral = await run({
    command:
      "printf 'ephemeral-ok\\n'; printf 'cwd=%s\\n' \"$PWD\"; printf 'mac-workspace-ok\\n' > '终端 验证.txt'; cat '终端 验证.txt'; node --version",
    cwd: ".",
    timeoutMs: 30_000,
  });
  if (
    ephemeral.contents.exitCode !== 0 ||
    ephemeral.contents.workspaceRelation !== "inside" ||
    ephemeral.contents.processTreeMode !== "posix_process_group" ||
    !ephemeral.contents.output.includes("ephemeral-ok") ||
    !ephemeral.contents.output.includes("mac-workspace-ok") ||
    !ephemeral.contents.output.includes(`cwd=${workspaceRoot}`)
  ) {
    throw new Error(`Ephemeral terminal failed: ${ephemeral.contents.output}`);
  }

  const first = await run({
    command:
      "printf 'persistent-one\\n'; printf 'persistent-cwd=%s\\n' \"$PWD\"",
    cwd: "Nested 子目录",
    sessionMode: "persistent",
    timeoutMs: 30_000,
  });
  persistentSessionId = first.contents.sessionId;
  persistentPid = getTerminalSession(persistentSessionId)?.process.pid ?? null;
  if (
    first.contents.exitCode !== 0 ||
    first.contents.workspaceRelation !== "inside" ||
    first.contents.processTreeMode !== "posix_process_group" ||
    !first.contents.output.includes("persistent-one") ||
    !first.contents.output.includes(`persistent-cwd=${nestedWorkspace}`)
  ) {
    throw new Error(`First persistent terminal command failed: ${first.contents.output}`);
  }

  const second = await run({
    command: "printf 'persistent-two\\n'; printf 'session-cwd=%s\\n' \"$PWD\"",
    attachSessionId: persistentSessionId,
    timeoutMs: 30_000,
  });
  if (
    second.contents.exitCode !== 0 ||
    !second.contents.reusedSession ||
    !second.contents.output.includes("persistent-two") ||
    !second.contents.output.includes(`session-cwd=${nestedWorkspace}`)
  ) {
    throw new Error(
      `Persistent terminal continuation failed: ${second.contents.output}`,
    );
  }

  writeTerminalSession(persistentSessionId, "exit");
  if (persistentPid !== null) {
    await waitForPidExit(persistentPid);
  }
  clearTerminalSessions();
  if (listTerminalSessions().length !== 0) {
    throw new Error("Persistent terminal session registry was not cleared");
  }

  console.log(
    JSON.stringify({
      platform: process.platform,
      architecture: process.arch,
      workspace: {
        root: workspaceRoot,
        unicodePath: true,
        fileWrite: true,
      },
      shell: environment.terminal.shellProfile.shell,
      ephemeral: {
        exitCode: ephemeral.contents.exitCode,
        processTreeMode: ephemeral.contents.processTreeMode,
      },
      persistent: {
        reused: second.contents.reusedSession,
        processTreeMode: first.contents.processTreeMode,
        processExited: persistentPid === null || !isPidAlive(persistentPid),
        registryCleaned: true,
      },
    }),
  );
} finally {
  if (persistentSessionId && getTerminalSession(persistentSessionId)) {
    clearTerminalSessions();
  }
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}
