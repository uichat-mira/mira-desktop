import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSandboxedCommand } from "./executor.js";
import { clearWorkspaceSelection } from "@/mcp/workspace.js";
import { getTestArtifactDir } from "@/test-support/artifacts.js";

const shellProfile = {
  shell: "powershell.exe",
  argsMode: "powershell" as const,
  stdoutEncoding: "utf8",
  stderrEncoding: "utf8",
};

const sandboxMocks = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: sandboxMocks.spawnMock,
  };
});

const createMockSpawnProcess = () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.pid = 1234;
  child.kill = vi.fn(() => {
    child.emit("close", null);
  });
  return child;
};

const executeAllowedCommand = async (command: string, stdoutText = "ok\n") => {
  const child = createMockSpawnProcess();
  sandboxMocks.spawnMock.mockReturnValue(child);

  const promise = executeSandboxedCommand({
    command,
    timeoutMs: 500,
    signal: new AbortController().signal,
    shellProfile,
  });

  child.stdout.emit("data", stdoutText);
  child.emit("close", 0);

  const result = await promise;
  expect(result.stdout).toBe(stdoutText.trim());
  expect(sandboxMocks.spawnMock).toHaveBeenCalledWith(
    expect.stringContaining("powershell.exe"),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `${command}; exit $LASTEXITCODE`,
    ],
    expect.objectContaining({
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
};

describe("SandboxExecutor", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    process.env.UI_CHAT_WORKSPACE_ROOT = process.cwd();
    clearWorkspaceSelection();
    sandboxMocks.spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("rejects cwd outside workspace root", async () => {
    await expect(
      executeSandboxedCommand({
        command: "pwd",
        cwd: "..\\..\\outside",
        timeoutMs: 500,
        signal: new AbortController().signal,
        shellProfile,
      }),
    ).rejects.toThrow("cwd must be a relative workspace directory without parent traversal");
  });

  it("limits output size", async () => {
    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const promise = executeSandboxedCommand({
      command: "pwd",
      timeoutMs: 500,
      outputLimitBytes: 4,
      signal: new AbortController().signal,
      shellProfile,
    });

    child.stdout.emit("data", "12345");

    await expect(promise).rejects.toThrow("terminal output exceeded limit");
  });

  it("allows inline Node execution", async () => {
    await executeAllowedCommand("node -e \"console.log('hi')\"", "hi\n");
  });

  it("blocks git config --global", async () => {
    await expect(
      executeSandboxedCommand({
        command: "git config --global user.name test",
        timeoutMs: 500,
        signal: new AbortController().signal,
        shellProfile,
      }),
    ).rejects.toThrow("git config outside local workspace scope is blocked by sandbox policy");
  });

  it("allows inline Python execution", async () => {
    await executeAllowedCommand("python -c \"print('hi')\"", "hi\n");
  });

  it("allows Python module execution", async () => {
    await executeAllowedCommand("python -m pytest --version", "pytest 9.0\n");
  });

  it("allows npm exec, create, and init commands", async () => {
    await executeAllowedCommand("npm exec prettier --version", "3.0.0\n");
    sandboxMocks.spawnMock.mockReset();
    await executeAllowedCommand("npm create vite@latest demo", "created\n");
    sandboxMocks.spawnMock.mockReset();
    await executeAllowedCommand("npm init -y", "written\n");
  });

  it("rejects cwd that is not an existing directory", async () => {
    await expect(
      executeSandboxedCommand({
        command: "pwd",
        cwd: "this-path-should-not-exist",
        timeoutMs: 500,
        signal: new AbortController().signal,
        shellProfile,
      }),
    ).rejects.toThrow("cwd must be an existing workspace directory");
  });

  it("aborts and rejects active executions", async () => {
    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const controller = new AbortController();
    const promise = executeSandboxedCommand({
      command: "node script.js",
      timeoutMs: 500,
      signal: controller.signal,
      shellProfile,
    });

    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toThrow("Terminal session aborted");
    expect(child.kill).toHaveBeenCalled();
  });

  it("returns timedOut=true when execution exceeds timeout", async () => {
    vi.useFakeTimers();
    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const promise = executeSandboxedCommand({
      command: "node script.js",
      timeoutMs: 100,
      signal: new AbortController().signal,
      shellProfile,
    });

    await vi.advanceTimersByTimeAsync(120);
    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.binaryDetected).toBe(false);
    expect(child.kill).toHaveBeenCalled();
  });

  it("allows workspace-scoped node script execution", async () => {
    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const promise = executeSandboxedCommand({
      command: "node script.js",
      timeoutMs: 500,
      signal: new AbortController().signal,
      shellProfile,
    });

    child.stdout.emit("data", "ok\n");
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("ok");
    expect(result.stdoutEncoding).toBe("utf8");
    expect(sandboxMocks.spawnMock).toHaveBeenCalledWith(
      expect.stringContaining("powershell.exe"),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "node script.js; exit $LASTEXITCODE",
      ],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  it("allows dot cwd and defaults empty cwd to workspace root", async () => {
    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const promise = executeSandboxedCommand({
      command: "pwd",
      cwd: "",
      timeoutMs: 500,
      signal: new AbortController().signal,
      shellProfile,
    });

    child.emit("close", 0);
    const result = await promise;

    expect(result.cwd).toBe(process.cwd());
    expect(sandboxMocks.spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cwd: process.cwd(),
      }),
    );
  });

  it("allows child directory cwd inside workspace", async () => {
    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const promise = executeSandboxedCommand({
      command: "pwd",
      cwd: "src",
      timeoutMs: 500,
      signal: new AbortController().signal,
      shellProfile,
    });

    child.emit("close", 0);
    const result = await promise;

    expect(result.cwd).toBe(path.join(process.cwd(), "src"));
  });

  it("rejects absolute cwd input before execution", async () => {
    await expect(
      executeSandboxedCommand({
        command: "pwd",
        cwd: process.platform === "win32" ? "C:\\" : "/tmp",
        timeoutMs: 500,
        signal: new AbortController().signal,
        shellProfile,
      }),
    ).rejects.toThrow("cwd must be a relative workspace directory without parent traversal");
    expect(sandboxMocks.spawnMock).not.toHaveBeenCalled();
  });

  it("filters env overrides to the sandbox allowlist", async () => {
    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const promise = executeSandboxedCommand({
      command: "pwd",
      env: {
        PATH: "sandbox-path",
        RAG_DEMO_UNLISTED_SECRET: "should-not-pass",
      },
      timeoutMs: 500,
      signal: new AbortController().signal,
      shellProfile,
    });

    child.emit("close", 0);
    await promise;

    const spawnOptions = sandboxMocks.spawnMock.mock.calls[0]?.[2] as {
      env?: Record<string, string>;
    };
    expect(spawnOptions.env?.PATH).toBe("sandbox-path");
    expect(spawnOptions.env).not.toHaveProperty("RAG_DEMO_UNLISTED_SECRET");
  });

  it("caps timeoutMs at the sandbox hard maximum", async () => {
    vi.useFakeTimers();
    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const promise = executeSandboxedCommand({
      command: "node script.js",
      timeoutMs: 600_000,
      signal: new AbortController().signal,
      shellProfile,
    });

    await vi.advanceTimersByTimeAsync(60_001);
    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(result.violations).toContain("terminal execution timed out after 60000ms");
  });

  it("marks binary stdout instead of decoding it as text", async () => {
    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const promise = executeSandboxedCommand({
      command: "node script.js",
      timeoutMs: 500,
      signal: new AbortController().signal,
      shellProfile,
    });

    child.stdout.emit("data", Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]));
    child.emit("close", 0);

    const result = await promise;
    expect(result.binaryDetected).toBe(true);
    expect(result.stdout).toBe("[binary output omitted]");
    expect(result.stdoutEncoding).toBe("unknown");
  });

  it("decodes utf16le stdout before applying binary detection", async () => {
    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const promise = executeSandboxedCommand({
      command: "Write-Output '中文'",
      timeoutMs: 500,
      signal: new AbortController().signal,
      shellProfile: {
        ...shellProfile,
        stdoutEncoding: "utf16le",
      },
    });

    child.stdout.emit("data", Buffer.from("中文\n", "utf16le"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.binaryDetected).toBe(false);
    expect(result.stdout).toContain("中文");
    expect(result.stdoutEncoding).toBe("utf16le");
  });

  it("collects registered artifacts after command completion", async () => {
    const tempRoot = await mkdtemp(path.join(getTestArtifactDir("workspace"), "mira-sandbox-executor-"));
    tempDirs.push(tempRoot);
    await mkdir(path.join(tempRoot, "workspace"), { recursive: true });
    const workspaceRoot = path.join(tempRoot, "workspace");
    const artifactPath = path.join(workspaceRoot, "report.txt");
    await writeFile(artifactPath, "report body", "utf8");
    process.env.UI_CHAT_WORKSPACE_ROOT = workspaceRoot;

    const child = createMockSpawnProcess();
    sandboxMocks.spawnMock.mockReturnValue(child);

    const promise = executeSandboxedCommand({
      command: "node script.js",
      timeoutMs: 500,
      artifactRegistrations: [{ path: "report.txt", kind: "report" }],
      signal: new AbortController().signal,
      shellProfile,
    });

    child.emit("close", 0);
    const result = await promise;

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      kind: "report",
      path: artifactPath,
      mime: "text/plain",
    });
  });
});