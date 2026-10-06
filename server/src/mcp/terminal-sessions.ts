import os from "node:os";
import pty from "node-pty";
import { mcpBadRequest } from "./core/errors.js";
import type { ToolExecutionEnvironment } from "./core/definitions.js";
import {
  resolveHostCwd,
  resolveHostEnv,
} from "./terminal/host-spawn-runtime.js";
import {
  resolveTerminalRuntimeId,
  type HostWorkspaceRelation,
  type TerminalProcessTreeMode,
  type TerminalRuntimeId,
} from "./terminal/runtime-contract.js";
import {
  createWindowsJobPtyArgs,
  getWindowsJobMarker,
} from "./terminal/windows-job-object.js";
import { killTerminalProcessTree } from "./terminal/process-tree.js";
import { clearPersistentTerminalOutputsForSession } from "./terminal/persistent-output-store.js";

export interface TerminalSessionRecord {
  id: string;
  command: string;
  cwd: string;
  shell: string;
  stdoutEncoding: string;
  runtimeId: TerminalRuntimeId;
  workspaceRelation: HostWorkspaceRelation;
  processTreeMode: TerminalProcessTreeMode;
  createdAt: string;
  process: pty.IPty;
}

const sessionMap = new Map<string, TerminalSessionRecord>();

export const listTerminalSessions = () =>
  Array.from(sessionMap.values()).map((session) => ({
    id: session.id,
    command: session.command,
    cwd: session.cwd,
    shell: session.shell,
    stdoutEncoding: session.stdoutEncoding,
    runtimeId: session.runtimeId,
    workspaceRelation: session.workspaceRelation,
    processTreeMode: session.processTreeMode,
    createdAt: session.createdAt,
  }));

export const getTerminalSession = (sessionId: string) => sessionMap.get(sessionId);

export const removeTerminalSession = (sessionId: string) => {
  const session = sessionMap.get(sessionId);
  if (!session) {
    return;
  }

  sessionMap.delete(sessionId);
  void clearPersistentTerminalOutputsForSession(sessionId);
  void killTerminalProcessTree({
    pid: session.process.pid,
    mode: session.processTreeMode,
  }).finally(() => {
    try {
      session.process.kill();
    } catch {
      // Process may already have exited.
    }
  });
};

export const clearTerminalSessions = () => {
  for (const sessionId of sessionMap.keys()) {
    removeTerminalSession(sessionId);
  }
};

const waitForWindowsJobBootstrap = async (process: pty.IPty) => {
  const marker = getWindowsJobMarker();
  return await new Promise<boolean>((resolve) => {
    let buffer = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let dataDisposable: ReturnType<pty.IPty["onData"]> | undefined;
    let exitDisposable: ReturnType<pty.IPty["onExit"]> | undefined;

    const finish = (assigned: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) clearTimeout(timer);
      dataDisposable?.dispose();
      exitDisposable?.dispose();
      resolve(assigned);
    };

    dataDisposable = process.onData((chunk) => {
      buffer += chunk;
      const match = buffer.match(
        new RegExp(`${marker}:(assigned|unavailable)`),
      );
      if (match) {
        finish(match[1] === "assigned");
        return;
      }

      if (buffer.length > 32_768) {
        finish(false);
      }
    });
    exitDisposable = process.onExit(() => finish(false));
    timer = setTimeout(() => finish(false), 1_500);
  });
};

export const createTerminalSession = async (input: {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  workspaceRoot?: string | null;
  runtimeId?: TerminalRuntimeId;
  shellProfile?: ToolExecutionEnvironment["terminal"]["shellProfile"];
}) => {
  const runtimeId = input.runtimeId ?? resolveTerminalRuntimeId();
  if (runtimeId !== "host_spawn") {
    throw mcpBadRequest(
      "sandbox_runtime is reserved for a future isolated provider and cannot create terminal sessions yet.",
    );
  }

  const shellProfile = input.shellProfile;
  const shell =
    shellProfile?.shell ??
    (process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash");
  const encoding = shellProfile?.stdoutEncoding ?? "utf8";
  const hostResolution = resolveHostCwd({
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
  });
  const environment = resolveHostEnv(input.env);
  const useWindowsJobObject =
    process.platform === "win32" &&
    shellProfile?.shellFamily === "powershell";
  const processTreeMode: TerminalProcessTreeMode = useWindowsJobObject
    ? "windows_job_object"
    : process.platform === "win32"
      ? "windows_taskkill_tree"
      : "posix_process_group";
  const args = useWindowsJobObject ? createWindowsJobPtyArgs() : [];
  const sessionId = crypto.randomUUID();
  const child = pty.spawn(shell, args, {
    name: "xterm-color",
    cwd: hostResolution.cwd,
    env: environment,
    encoding,
  });

  const jobAssigned = useWindowsJobObject
    ? await waitForWindowsJobBootstrap(child)
    : false;
  const effectiveProcessTreeMode =
    useWindowsJobObject && !jobAssigned
      ? "windows_taskkill_tree"
      : processTreeMode;

  const session: TerminalSessionRecord = {
    id: sessionId,
    command: input.command,
    cwd: hostResolution.cwd,
    shell,
    stdoutEncoding: encoding,
    runtimeId,
    workspaceRelation: hostResolution.workspaceRelation,
    processTreeMode: effectiveProcessTreeMode,
    createdAt: new Date().toISOString(),
    process: child,
  };
  sessionMap.set(sessionId, session);

  return session;
};

export const writeTerminalSession = (sessionId: string, command: string) => {
  const session = sessionMap.get(sessionId);
  if (!session) {
    throw mcpBadRequest(`terminal session not found: ${sessionId}`);
  }

  session.process.write(`${command}${os.EOL}`);
  return session;
};
