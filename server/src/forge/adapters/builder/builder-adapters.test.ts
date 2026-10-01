import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildCodexBuilderArgs,
  createCodexBuilderRunner,
} from "./codex.js";
import {
  buildOpenCodeBuilderArgs,
  createOpenCodeBuilderRunner,
} from "./opencode.js";
import {
  buildPiAgentBuilderArgs,
  createPiAgentBuilderRunner,
} from "./piagent.js";
import type {
  BuilderExitResult,
  BuilderProviderEvent,
} from "./types.js";
import type { SpawnLike } from "./shared.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4321;
  private killed = false;

  constructor(
    private readonly lines: Array<string | Record<string, unknown>>,
    private readonly code = 0,
    private readonly stderrText = "",
  ) {
    super();
  }

  run(): void {
    queueMicrotask(() => {
      this.emit("spawn");
      if (this.stderrText) this.stderr.write(this.stderrText);
      for (const line of this.lines) {
        this.stdout.write(
          typeof line === "string" ? line + "\n" : JSON.stringify(line) + "\n",
        );
      }
      this.stdout.end();
      this.stderr.end();
      if (!this.killed) this.emit("close", this.code, null);
    });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit("close", null, signal));
    return true;
  }
}

function fakeSpawn(
  lines: Array<string | Record<string, unknown>>,
  capture: Array<{
    bin: string;
    args: readonly string[];
    options: Record<string, unknown>;
  }>,
  code = 0,
  stderr = "",
): SpawnLike {
  return ((bin, args, options) => {
    capture.push({
      bin,
      args,
      options: options as Record<string, unknown>,
    });
    const child = new FakeChild(lines, code, stderr);
    child.run();
    return child as unknown as ChildProcess;
  }) as SpawnLike;
}

function runRunner(
  start: (
    on: {
      events: BuilderProviderEvent[];
      result: BuilderExitResult | null;
      startedPid: number | null;
      resolve: () => void;
    },
  ) => void,
): Promise<{
  events: BuilderProviderEvent[];
  result: BuilderExitResult;
  startedPid: number | null;
}> {
  return new Promise((resolve, reject) => {
    const state = {
      events: [] as BuilderProviderEvent[],
      result: null as BuilderExitResult | null,
      startedPid: null as number | null,
      resolve: () => undefined,
    };
    state.resolve = () => {
      if (!state.result) return;
      resolve({
        events: state.events,
        result: state.result,
        startedPid: state.startedPid,
      });
    };

    try {
      start(state);
    } catch (error) {
      reject(error);
    }
  });
}

describe("Forge Builder adapters", () => {
  it("builds OpenCode args without permission-bypass flags and captures durable evidence", async () => {
    expect(
      buildOpenCodeBuilderArgs({
        projectRoot: "/repo",
        prompt: "do task",
        model: "openai/gpt",
        agent: "build",
      }),
    ).toEqual([
      "run",
      "--format",
      "json",
      "--dir",
      "/repo",
      "--model",
      "openai/gpt",
      "--agent",
      "build",
      "do task",
    ]);

    const capture: Array<{
      bin: string;
      args: readonly string[];
      options: Record<string, unknown>;
    }> = [];
    const runner = createOpenCodeBuilderRunner({
      spawnImpl: fakeSpawn(
        [
          "{malformed-json",
          { type: "step_start", sessionID: "oc-1" },
          {
            type: "part",
            sessionID: "oc-1",
            part: {
              type: "tool",
              tool: "read",
              state: { status: "completed" },
            },
          },
          {
            type: "part",
            sessionID: "oc-1",
            part: { type: "text", text: "done" },
          },
        ],
        capture,
      ),
    });

    const observed = await runRunner((state) => {
      runner.start({
        projectRoot: "/repo",
        prompt: "do task",
        model: null,
        agent: null,
        onStarted: ({ pid }) => {
          state.startedPid = pid;
        },
        onEvent: (event) => state.events.push(event),
        onExit: (result) => {
          state.result = result;
          state.resolve();
        },
      });
    });

    expect(observed.startedPid).toBe(4321);
    expect(observed.result.code).toBe(0);
    expect(observed.result.resultText).toBe("done");
    expect(
      observed.events.some(
        (event) => event.externalSessionId === "oc-1",
      ),
    ).toBe(true);
    expect(
      observed.events.some(
        (event) => event.tool?.name === "read",
      ),
    ).toBe(true);
    expect(capture[0]?.options.cwd).toBe("/repo");
  });

  it("builds PiAgent JSON mode without session reuse or bypass flags", async () => {
    expect(
      buildPiAgentBuilderArgs({
        projectRoot: "/repo",
        prompt: "do task",
        model: "model-x",
      }),
    ).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--model",
      "model-x",
      "do task",
    ]);

    const runner = createPiAgentBuilderRunner({
      spawnImpl: fakeSpawn(
        [
          "{bad",
          { type: "session", id: "pi-1" },
          {
            type: "tool_execution_start",
            toolName: "shell",
          },
          {
            type: "tool_execution_end",
            toolName: "shell",
            isError: false,
          },
          {
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "pi done" }],
              stopReason: "end_turn",
            },
          },
        ],
        [],
      ),
    });

    const observed = await runRunner((state) => {
      runner.start({
        projectRoot: "/repo",
        prompt: "do task",
        model: null,
        agent: null,
        onEvent: (event) => state.events.push(event),
        onExit: (result) => {
          state.result = result;
          state.resolve();
        },
      });
    });

    expect(observed.result.resultText).toBe("pi done");
    expect(
      observed.events.some(
        (event) => event.externalSessionId === "pi-1",
      ),
    ).toBe(true);
    expect(
      observed.events.some(
        (event) =>
          event.tool?.name === "shell" &&
          event.tool?.status === "completed",
      ),
    ).toBe(true);
  });

  it("pins Codex Builder to workspace-write + approval never without bypass flags", async () => {
    const args = buildCodexBuilderArgs({
      projectRoot: "/repo",
      prompt: "do task",
      model: "gpt-5-codex",
    });
    expect(args).toEqual([
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--cd",
      "/repo",
      "--model",
      "gpt-5-codex",
      "do task",
    ]);
    expect(args.join(" ")).not.toMatch(/danger|bypass/i);

    const capture: Array<{
      bin: string;
      args: readonly string[];
      options: Record<string, unknown>;
    }> = [];
    const runner = createCodexBuilderRunner({
      resolveBin: () => "/Applications/ChatGPT.app/Contents/Resources/codex",
      spawnImpl: fakeSpawn(
        [
          "{bad",
          { type: "thread.started", thread_id: "codex-1" },
          {
            type: "item.started",
            item: {
              type: "command_execution",
              status: "running",
            },
          },
          {
            type: "item.completed",
            item: {
              type: "file_change",
              status: "completed",
            },
          },
          {
            type: "item.completed",
            item: {
              type: "agent_message",
              text: "codex done",
            },
          },
        ],
        capture,
      ),
    });

    const observed = await runRunner((state) => {
      runner.start({
        projectRoot: "/repo",
        prompt: "do task",
        model: null,
        agent: null,
        onEvent: (event) => state.events.push(event),
        onExit: (result) => {
          state.result = result;
          state.resolve();
        },
      });
    });

    expect(capture[0]?.bin).toContain("/Applications/ChatGPT.app");
    expect(observed.result.resultText).toBe("codex done");
    expect(
      observed.events.some(
        (event) => event.externalSessionId === "codex-1",
      ),
    ).toBe(true);
    expect(
      observed.events.some(
        (event) =>
          event.artifact?.kind === "provider-file-change",
      ),
    ).toBe(true);
  });

  it("captures provider-declared errors independently from process exit code", async () => {
    const runner = createCodexBuilderRunner({
      resolveBin: () => "/codex",
      spawnImpl: fakeSpawn(
        [
          { type: "thread.started", thread_id: "codex-2" },
          {
            type: "turn.failed",
            error: { message: "provider failure" },
          },
        ],
        [],
        0,
      ),
    });

    const observed = await runRunner((state) => {
      runner.start({
        projectRoot: "/repo",
        prompt: "do task",
        model: null,
        agent: null,
        onExit: (result) => {
          state.result = result;
          state.resolve();
        },
      });
    });

    expect(observed.result.code).toBe(0);
    expect(observed.result.errorText).toBe("provider failure");
  });
});
