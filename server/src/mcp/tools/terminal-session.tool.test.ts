import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { getHarnessInvocationTrace } from "../../harness/invocations.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const terminalMocks = vi.hoisted(() => ({
  createTerminalSessionMock: vi.fn(),
  getTerminalSessionMock: vi.fn(),
  writeTerminalSessionMock: vi.fn(),
  removeTerminalSessionMock: vi.fn(),
  clearTerminalSessionsMock: vi.fn(),
  spawnMock: vi.fn(),
  killTerminalProcessTreeMock: vi.fn(),
}));

vi.mock("../terminal-sessions.js", () => ({
  createTerminalSession: terminalMocks.createTerminalSessionMock,
  getTerminalSession: terminalMocks.getTerminalSessionMock,
  writeTerminalSession: terminalMocks.writeTerminalSessionMock,
  removeTerminalSession: terminalMocks.removeTerminalSessionMock,
  clearTerminalSessions: terminalMocks.clearTerminalSessionsMock,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: terminalMocks.spawnMock,
  };
});

vi.mock("../terminal/process-tree.js", () => ({
  killTerminalProcessTree: terminalMocks.killTerminalProcessTreeMock,
}));

type MockSession = {
  id: string;
  command: string;
  cwd: string;
  shell: string;
  createdAt: string;
  process: {
    onData: (handler: (chunk: string) => void) => { dispose: () => void };
    onExit: (handler: (input: { exitCode: number }) => void) => { dispose: () => void };
    kill: () => void;
  };
};

const createMockSession = (input?: {
  id?: string;
  shell?: string;
  cwd?: string;
}) => {
  let dataHandler: ((chunk: string) => void) | null = null;
  let exitHandler: ((input: { exitCode: number }) => void) | null = null;

  const session: MockSession = {
    id: input?.id ?? "session-1",
    command: "mock",
    cwd: input?.cwd ?? process.cwd(),
    shell: input?.shell ?? "powershell.exe",
    createdAt: new Date().toISOString(),
    process: {
      onData(handler) {
        dataHandler = handler;
        return { dispose() {} };
      },
      onExit(handler) {
        exitHandler = handler;
        return { dispose() {} };
      },
      kill() {},
    },
  };

  return {
    session,
    emitData(chunk: string) {
      dataHandler?.(chunk);
    },
    emitExit(exitCode: number) {
      exitHandler?.({ exitCode });
    },
  };
};

const extractMarker = () => {
  const writtenCommand = String(terminalMocks.writeTerminalSessionMock.mock.calls.at(-1)?.[1] ?? "");
  const markerMatch = writtenCommand.match(/(__MIRA_TERMINAL_DONE__:[^":\s]+:[^":\s]+):/);
  if (!markerMatch) {
    throw new Error(`Failed to extract completion marker from command: ${writtenCommand}`);
  }

  return markerMatch[1];
};

const createMockSpawnProcess = () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = 12345;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn(() => {
    child.emit("close", null);
  });
  return child;
};

const waitForSpawnedProcess = async () => {
  await vi.waitFor(() => {
    expect(terminalMocks.spawnMock).toHaveBeenCalledTimes(1);
  });
};

describe("terminal_session tool", () => {
  const workspaceRoot = createTimestampedTestArtifactPath(
    "workspace",
    "rag-demo-terminal",
  );

  beforeEach(() => {
    fs.mkdirSync(path.join(workspaceRoot, "server"), { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = workspaceRoot;
    clearWorkspaceSelection();
    terminalMocks.createTerminalSessionMock.mockReset();
    terminalMocks.getTerminalSessionMock.mockReset();
    terminalMocks.writeTerminalSessionMock.mockReset();
    terminalMocks.removeTerminalSessionMock.mockReset();
    terminalMocks.clearTerminalSessionsMock.mockReset();
    terminalMocks.spawnMock.mockReset();
    terminalMocks.killTerminalProcessTreeMock.mockReset();
    terminalMocks.killTerminalProcessTreeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("streams split stdout/stderr for ephemeral terminal execution", async () => {
    const child = createMockSpawnProcess();
    terminalMocks.spawnMock.mockReturnValue(child);

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const events: Array<Record<string, unknown>> = [];
    const artifacts: Array<Record<string, unknown>> = [];

    const promise = terminalSessionTool.execute({
      invocationId: "inv-ephemeral",
      args: {
        command: "node script.js",
        sessionMode: "ephemeral",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event) {
        events.push(event as Record<string, unknown>);
      },
      addArtifact(artifact) {
        artifacts.push(artifact as Record<string, unknown>);
        return { id: "a", ...artifact };
      },
    });

    await waitForSpawnedProcess();

    child.stdout.emit("data", "hello stdout\n");
    child.stderr.emit("data", "__MIRA_WINDOWS_JOB_OBJECT__:assigned\n");
    child.stderr.emit("data", "oops stderr\n");
    child.emit("close", 3);

    const result = await promise;

    expect(events[0]?.message).toBe("Terminal runtime: host_spawn (ephemeral)");
    expect(events.filter((event) => event.type === "invocation:stdout")).toHaveLength(2);
    expect(events.some((event) => event.stream === "stderr")).toBe(true);
    expect((result.result as { stdout: string }).stdout).toBe("hello stdout");
    expect((result.result as { stderr: string }).stderr).toBe("oops stderr");
    expect((result.result as { streamMode: string }).streamMode).toBe("split");
    expect((result.result as { stderrSeparated: boolean }).stderrSeparated).toBe(true);
    expect((result.result as { exitCode: number }).exitCode).toBe(3);
    expect(artifacts[0]?.metadata).toMatchObject({
      runtimeId: "host_spawn",
      sessionMode: "ephemeral",
    });
  });

  it("uses a workspace-bound cwd for ephemeral terminal execution", async () => {
    const child = createMockSpawnProcess();
    terminalMocks.spawnMock.mockReturnValue(child);

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const promise = terminalSessionTool.execute({
      invocationId: "inv-cwd-inside",
      args: {
        command: "pwd",
        sessionMode: "ephemeral",
        cwd: "server",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
    });

    child.stdout.emit("data", "ok\n");
    child.emit("close", 0);
    await promise;

    const spawnOptions = terminalMocks.spawnMock.mock.calls[0]?.[2] as { cwd?: string } | undefined;
    expect(spawnOptions?.cwd).toBeDefined();
    expect(fs.realpathSync.native(spawnOptions!.cwd!)).toBe(
      fs.realpathSync.native(path.join(workspaceRoot, "server")),
    );
  });

  it("supports attaching to an existing persistent terminal session", async () => {
    const mock = createMockSession({ id: "session-existing" });
    terminalMocks.getTerminalSessionMock.mockReturnValue(mock.session);
    terminalMocks.writeTerminalSessionMock.mockImplementation((_sessionId: string) => {
      queueMicrotask(() => {
        const marker = extractMarker();
        mock.emitData("reused");
        mock.emitData(`\n${marker}:0\n`);
      });
      return mock.session;
    });

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const result = await terminalSessionTool.execute({
      invocationId: "inv-reuse",
      args: {
        command: "pwd",
        attachSessionId: "session-existing",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
    });

    expect(terminalMocks.createTerminalSessionMock).not.toHaveBeenCalled();
    expect((result.result as { reusedSession: boolean }).reusedSession).toBe(true);
    expect((result.result as { streamMode: string }).streamMode).toBe("merged");
    expect((result.result as { stderrSeparated: boolean }).stderrSeparated).toBe(false);
    expect(terminalMocks.removeTerminalSessionMock).not.toHaveBeenCalled();
  });

  it("supports creating a persistent terminal session without auto-removing it", async () => {
    const mock = createMockSession({ id: "session-persistent" });
    terminalMocks.createTerminalSessionMock.mockReturnValue(mock.session);
    terminalMocks.writeTerminalSessionMock.mockImplementation((_sessionId: string) => {
      queueMicrotask(() => {
        const marker = extractMarker();
        mock.emitData("hello");
        mock.emitData(`\n${marker}:0\n`);
      });
      return mock.session;
    });

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const events: Array<Record<string, unknown>> = [];
    const result = await terminalSessionTool.execute({
      invocationId: "inv-persistent",
      args: {
        command: "pwd",
        sessionMode: "persistent",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event) {
        events.push(event as Record<string, unknown>);
      },
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
    });

    expect(events.some((event) => event.message === "Terminal runtime: host_spawn (persistent)")).toBe(true);
    expect((result.result as { sessionMode: string }).sessionMode).toBe("persistent");
    expect((result.result as { stderrSeparated: boolean }).stderrSeparated).toBe(false);
    expect(terminalMocks.removeTerminalSessionMock).not.toHaveBeenCalled();
  });

  it("records terminal trace spans for persistent execution", async () => {
    const mock = createMockSession({ id: "session-trace" });
    terminalMocks.createTerminalSessionMock.mockReturnValue(mock.session);
    terminalMocks.writeTerminalSessionMock.mockImplementation((_sessionId: string) => {
      queueMicrotask(() => {
        const marker = extractMarker();
        mock.emitData("trace output\n");
        mock.emitData(`${marker}:0\n`);
      });
      return mock.session;
    });

    const { clearHarnessRegistry, registerCapability } = await import("../../harness/registry.js");
    const { clearHarnessInvocations, executeHarnessInvocation } = await import("../../harness/invocations.js");
    const { terminalSessionTool } = await import("./terminal-session.tool.js");

    clearHarnessRegistry();
    clearHarnessInvocations();
    registerCapability(terminalSessionTool);

    const record = await executeHarnessInvocation({
      toolId: "terminal_session",
      args: {
        command: "pwd",
        sessionMode: "persistent",
      },
      environment: createHarnessEnvironmentSnapshot(),
      approvedInvocations: [
        {
          toolId: "terminal_session",
          inputHash: createInvocationInputHash({
            command: "pwd",
            sessionMode: "persistent",
          }),
        },
      ],
    });

    const trace = getHarnessInvocationTrace(record.id);
    expect(trace?.spans.map((span) => span.kind)).toEqual([
      "invocation",
      "strategy_selection",
      "session_acquire",
      "command_execution",
      "artifact_emit",
      "result_normalization",
    ]);
  });

  it("emits persistent session progress before stdout chunks", async () => {
    const mock = createMockSession({ id: "session-progress-order" });
    terminalMocks.createTerminalSessionMock.mockReturnValue(mock.session);
    terminalMocks.writeTerminalSessionMock.mockImplementation((_sessionId: string) => {
      queueMicrotask(() => {
        const marker = extractMarker();
        mock.emitData("first line\n");
        mock.emitData(`${marker}:0\n`);
      });
      return mock.session;
    });

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const events: Array<Record<string, unknown>> = [];

    await terminalSessionTool.execute({
      invocationId: "inv-progress-order",
      args: {
        command: "pwd",
        sessionMode: "persistent",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event) {
        events.push(event as Record<string, unknown>);
      },
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
    });

    const startedIndex = events.findIndex(
      (event) => event.type === "invocation:progress" && event.message === "Terminal runtime: host_spawn (persistent)",
    );
    const stdoutIndex = events.findIndex(
      (event) => event.type === "invocation:stdout" && event.chunk === "first line\n",
    );

    expect(startedIndex).toBeGreaterThan(-1);
    expect(stdoutIndex).toBeGreaterThan(-1);
    expect(startedIndex).toBeLessThan(stdoutIndex);
  });

  it("returns a timedOut result when terminal execution exceeds timeout", async () => {
    vi.useFakeTimers();
    const child = createMockSpawnProcess();
    terminalMocks.spawnMock.mockReturnValue(child);

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const promise = terminalSessionTool.execute({
      invocationId: "inv-timeout",
      args: {
        command: "sleep",
        timeoutMs: 100,
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
    });

    await waitForSpawnedProcess();
    await vi.advanceTimersByTimeAsync(120);
    const result = await promise;

    expect((result.result as { timedOut: boolean }).timedOut).toBe(true);
    expect((result.result as { exitCode: number | null }).exitCode).toBe(null);
    expect(terminalMocks.killTerminalProcessTreeMock).toHaveBeenCalledWith({
      pid: 12345,
      mode: "windows_job_object",
    });
  });

  it("uses the default timeout when timeoutMs is omitted", async () => {
    vi.useFakeTimers();
    const child = createMockSpawnProcess();
    terminalMocks.spawnMock.mockReturnValue(child);

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const promise = terminalSessionTool.execute({
      invocationId: "inv-timeout-default",
      args: {
        command: "sleep",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
    });

    await waitForSpawnedProcess();
    terminalMocks.killTerminalProcessTreeMock.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await promise;

    expect((result.result as { timedOut: boolean }).timedOut).toBe(true);
    expect(terminalMocks.killTerminalProcessTreeMock).toHaveBeenCalled();
  });

  it("clamps timeoutMs below the lower bound", async () => {
    vi.useFakeTimers();
    const child = createMockSpawnProcess();
    terminalMocks.spawnMock.mockReturnValue(child);

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const promise = terminalSessionTool.execute({
      invocationId: "inv-timeout-min",
      args: {
        command: "sleep",
        timeoutMs: 1,
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
    });

    await waitForSpawnedProcess();
    terminalMocks.killTerminalProcessTreeMock.mockClear();
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect((result.result as { timedOut: boolean }).timedOut).toBe(true);
    expect(terminalMocks.killTerminalProcessTreeMock).toHaveBeenCalled();
  });

  it("clamps timeoutMs above the upper bound", async () => {
    vi.useFakeTimers();
    const child = createMockSpawnProcess();
    terminalMocks.spawnMock.mockReturnValue(child);

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const promise = terminalSessionTool.execute({
      invocationId: "inv-timeout-max",
      args: {
        command: "sleep",
        timeoutMs: 120000,
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
    });

    await waitForSpawnedProcess();
    terminalMocks.killTerminalProcessTreeMock.mockClear();
    await vi.advanceTimersByTimeAsync(86_400_000);
    const result = await promise;

    expect((result.result as { timedOut: boolean }).timedOut).toBe(true);
    expect(terminalMocks.killTerminalProcessTreeMock).toHaveBeenCalled();
  });

  it("rejects empty commands", async () => {
    const { terminalSessionTool } = await import("./terminal-session.tool.js");

    await expect(
      terminalSessionTool.execute({
        invocationId: "inv-empty",
        args: { command: "   " },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
      }),
    ).rejects.toThrow("command is required");
  });

  it("filters env entries to string allowlist values", async () => {
    const child = createMockSpawnProcess();
    terminalMocks.spawnMock.mockReturnValue(child);

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const promise = terminalSessionTool.execute({
      invocationId: "inv-env",
      args: {
        command: "echo hi",
        env: {
          PATH: "sandbox-path",
          OK: "1",
          BAD: 2,
          NOPE: false,
        },
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
    });
    await waitForSpawnedProcess();
    child.emit("close", 0);
    await promise;

    expect(terminalMocks.spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ PATH: "sandbox-path" }),
      }),
    );
    const spawnOptions = terminalMocks.spawnMock.mock.calls[0]?.[2] as {
      env?: Record<string, string>;
    };
    expect(spawnOptions.env).toHaveProperty("OK", "1");
    expect(spawnOptions.env).not.toHaveProperty("BAD");
    expect(spawnOptions.env).not.toHaveProperty("NOPE");
  });

  it("uses harness shell profile for Windows ephemeral pwd commands", async () => {
    const child = createMockSpawnProcess();
    terminalMocks.spawnMock.mockReturnValue(child);

    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      const { terminalSessionTool } = await import("./terminal-session.tool.js");
      const promise = terminalSessionTool.execute({
        invocationId: "inv-win-pwd",
        args: {
          command: "pwd",
          sessionMode: "ephemeral",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
      });

      await waitForSpawnedProcess();
      child.stdout.emit("data", "D:\\workspace\\rag-demo\n");
      child.emit("close", 0);
      await promise;

      expect(String(terminalMocks.spawnMock.mock.calls[0]?.[0] ?? "")).toContain("powershell.exe");
      expect(terminalMocks.spawnMock.mock.calls[0]?.[1]).toEqual(
        expect.arrayContaining(["-NoLogo", "-NoProfile", "-EncodedCommand"]),
      );
      expect(terminalMocks.spawnMock.mock.calls[0]?.[2]).toMatchObject({
        windowsHide: true,
        shell: false,
      });
    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(process, "platform", originalPlatformDescriptor);
      }
    }
  });

  it("decodes Windows terminal output using the harness shell profile encoding", async () => {
    const child = createMockSpawnProcess();
    terminalMocks.spawnMock.mockReturnValue(child);

    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      const { terminalSessionTool } = await import("./terminal-session.tool.js");
      const promise = terminalSessionTool.execute({
        invocationId: "inv-win-encoding",
        args: {
          command: "echo hello",
          sessionMode: "ephemeral",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
      });

      await waitForSpawnedProcess();
      child.stderr.emit("data", "__MIRA_WINDOWS_JOB_OBJECT__:assigned\n");
      child.stdout.emit("data", Buffer.from("hello\n", "utf16le"));
      child.emit("close", 0);
      const result = await promise;

      expect((result.result as { stdout: string }).stdout).toContain("hello");
      expect((result.result as { binaryDetected: boolean }).binaryDetected).toBe(false);
      expect((result.result as { stdoutEncoding: string }).stdoutEncoding).toBe("utf16le");
      expect(terminalMocks.spawnMock).toHaveBeenCalledTimes(1);
      expect(String(terminalMocks.spawnMock.mock.calls[0]?.[0] ?? "")).toContain("powershell.exe");
      expect(terminalMocks.spawnMock.mock.calls[0]?.[1]).toEqual(
        expect.arrayContaining(["-NoLogo", "-NoProfile", "-EncodedCommand"]),
      );
    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(process, "platform", originalPlatformDescriptor);
      }
    }
  });

  it("rejects attachSessionId combined with cwd or env overrides", async () => {
    const mock = createMockSession({ id: "session-existing" });
    terminalMocks.getTerminalSessionMock.mockReturnValue(mock.session);

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    await expect(
      terminalSessionTool.execute({
        invocationId: "inv-bad-attach",
        args: {
          command: "pwd",
          attachSessionId: "session-existing",
          cwd: "server",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
      }),
    ).rejects.toThrow("attachSessionId cannot be combined with cwd or env overrides");
  });

  it("aborts and cleans up ephemeral sessions", async () => {
    const child = createMockSpawnProcess();
    terminalMocks.spawnMock.mockReturnValue(child);

    const { terminalSessionTool } = await import("./terminal-session.tool.js");
    const controller = new AbortController();
    const promise = terminalSessionTool.execute({
      invocationId: "inv-abort",
      args: { command: "sleep" },
      signal: controller.signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
    });

    await waitForSpawnedProcess();
    controller.abort();

    await expect(promise).rejects.toThrow("Terminal session aborted");
    expect(terminalMocks.killTerminalProcessTreeMock).toHaveBeenCalledWith({
      pid: 12345,
      mode: "windows_job_object",
    });
  });

  it("surfaces approval-required requests through harness invocation status", async () => {
    const { clearHarnessRegistry, registerCapability } = await import("../../harness/registry.js");
    const { clearHarnessInvocations, executeHarnessInvocation } = await import("../../harness/invocations.js");
    const { McpApprovalRequiredError } = await import("../core/errors.js");

    clearHarnessRegistry();
    clearHarnessInvocations();
    registerCapability({
      definition: {
        id: "approval-tool",
        title: "Approval Tool",
        description: "approval",
        domain: "terminal",
        source: "internal",
        mode: "stream",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
        },
      },
      execute() {
        throw new McpApprovalRequiredError("Need explicit approval", {
          scope: "command",
        });
      },
    });

    const record = await executeHarnessInvocation({
      toolId: "approval-tool",
      args: {},
      environment: createHarnessEnvironmentSnapshot(),
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval).toEqual({
      required: true,
      reason: "approval-tool requires explicit approval before execution.",
      scope: "terminal",
    });
  });
});
