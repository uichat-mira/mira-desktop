import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  killProcessTree: vi.fn(),
  cancelOutputs: vi.fn(),
  clearOutputs: vi.fn(),
}));

vi.mock("node-pty", () => ({
  default: {
    spawn: mocks.spawn,
  },
}));

vi.mock("./terminal/process-tree.js", () => ({
  killTerminalProcessTree: mocks.killProcessTree,
}));

vi.mock("./terminal/persistent-output-store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./terminal/persistent-output-store.js")>();
  return {
    ...actual,
    cancelPersistentTerminalOutputsForSession: mocks.cancelOutputs,
    clearPersistentTerminalOutputsForSession: mocks.clearOutputs,
  };
});

const createMockPty = () => ({
  pid: 4321,
  onData: vi.fn(() => ({ dispose() {} })),
  onExit: vi.fn(() => ({ dispose() {} })),
  write: vi.fn(),
  kill: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
});

describe("terminal session cleanup", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    mocks.spawn.mockReset();
    mocks.killProcessTree.mockReset();
    mocks.cancelOutputs.mockReset();
    mocks.clearOutputs.mockReset();
  });

  it("awaits owned process-tree cleanup before reporting stop complete", async () => {
    let releaseKill!: () => void;
    const killFinished = new Promise<void>((resolve) => {
      releaseKill = resolve;
    });
    mocks.killProcessTree.mockReturnValue(killFinished);
    mocks.cancelOutputs.mockResolvedValue(undefined);
    mocks.clearOutputs.mockResolvedValue(undefined);

    const pty = createMockPty();
    mocks.spawn.mockReturnValue(pty);

    const {
      createTerminalSession,
      getTerminalSession,
      stopTerminalSession,
    } = await import("./terminal-sessions.js");

    const session = await createTerminalSession({
      command: "watch",
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      runtimeId: "host_spawn",
      shellProfile: {
        shell: process.platform === "win32" ? "cmd.exe" : "bash",
        shellFamily: process.platform === "win32" ? "cmd" : "posix",
        argsMode: process.platform === "win32" ? "cmd" : "posix",
        stdoutEncoding: "utf8",
        stderrEncoding: "utf8",
      },
    });

    let settled = false;
    const pending = stopTerminalSession(session.id).then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => {
      expect(mocks.killProcessTree).toHaveBeenCalledTimes(1);
    });

    expect(settled).toBe(false);
    expect(pty.kill).not.toHaveBeenCalled();
    expect(getTerminalSession(session.id)).toBeUndefined();

    releaseKill();
    const result = await pending;

    expect(mocks.cancelOutputs).toHaveBeenCalledWith(session.id);
    expect(mocks.killProcessTree).toHaveBeenCalledWith({
      pid: 4321,
      mode:
        process.platform === "win32"
          ? "windows_taskkill_tree"
          : "posix_process_group",
    });
    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(mocks.clearOutputs).toHaveBeenCalledWith(session.id);
    expect(result).toMatchObject({
      sessionId: session.id,
      state: "cancelled",
      cleanupCompleted: true,
    });
  });

  it("rejects stop for an unknown session", async () => {
    const { stopTerminalSession } = await import("./terminal-sessions.js");

    await expect(stopTerminalSession("missing-session")).rejects.toThrow(
      "terminal session not found: missing-session",
    );
  });
});
