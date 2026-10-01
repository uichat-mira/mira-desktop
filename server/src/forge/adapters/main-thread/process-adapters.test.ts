import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  buildCodexMainThreadArgs,
  buildOpenCodeMainThreadArgs,
  createCodexMainThreadAdapter,
  createOpenCodeMainThreadAdapter,
} from "./process-adapters.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4321;

  constructor(
    private readonly lines: unknown[],
    private readonly code = 0,
    private readonly stderrText = "",
  ) {
    super();
  }

  run() {
    queueMicrotask(() => {
      if (this.stderrText) this.stderr.write(this.stderrText);
      for (const line of this.lines) {
        this.stdout.write(JSON.stringify(line) + "\n");
      }
      this.stdout.end();
      this.stderr.end();
      this.emit("close", this.code, null);
    });
  }

  kill() {
    return true;
  }
}

function fakeSpawn(
  plan: { lines: unknown[]; code?: number; stderr?: string },
  capture: Array<{
    bin: string;
    args: readonly string[];
    options: Record<string, unknown>;
  }>,
) {
  return ((bin: string, args: readonly string[], options: Record<string, unknown>) => {
    capture.push({ bin, args, options });
    const child = new FakeChild(
      plan.lines,
      plan.code ?? 0,
      plan.stderr ?? "",
    );
    child.run();
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

describe("Main Thread process adapters", () => {
  it("pins OpenCode to plan mode and exact durable session resume", () => {
    expect(
      buildOpenCodeMainThreadArgs({
        projectRoot: "/repo",
        message: "hello",
        externalThreadId: "ses-7",
        model: "openai/gpt-5",
      }),
    ).toEqual([
      "run",
      "--format",
      "json",
      "--thinking",
      "--dir",
      "/repo",
      "--agent",
      "plan",
      "--session",
      "ses-7",
      "--model",
      "openai/gpt-5",
      "hello",
    ]);
  });

  it("injects OpenCode read-oriented permission and streams normalized events", async () => {
    const capture: Array<{
      bin: string;
      args: readonly string[];
      options: Record<string, unknown>;
    }> = [];
    const streamed: unknown[] = [];
    const adapter = createOpenCodeMainThreadAdapter({
      spawnImpl: fakeSpawn(
        {
          lines: [
            { type: "step_start", sessionID: "ses-1" },
            {
              type: "part",
              sessionID: "ses-1",
              part: { type: "reasoning", text: "inspect ledger" },
            },
            {
              type: "part",
              sessionID: "ses-1",
              part: {
                type: "tool",
                tool: "read",
                state: { status: "completed" },
              },
            },
            {
              type: "part",
              sessionID: "ses-1",
              part: { type: "text", text: "done" },
            },
          ],
        },
        capture,
      ),
      timeoutMs: 1000,
    });

    const result = await adapter.runTurn({
      projectRoot: "/repo",
      message: "prompt",
      externalThreadId: null,
      model: null,
      onEvent: (event) => {
        streamed.push(event);
      },
    });

    expect(result.externalThreadId).toBe("ses-1");
    expect(result.responseText).toBe("done");
    expect(result.events).toEqual([]);
    expect(streamed).toHaveLength(2);

    const env = capture[0]?.options.env as Record<string, string>;
    const permissions = JSON.parse(env.OPENCODE_PERMISSION) as Record<
      string,
      string
    >;
    expect(permissions["*"]).toBe("deny");
    expect(permissions.read).toBe("allow");
    expect(permissions.glob).toBe("allow");
    expect(permissions.edit).toBeUndefined();
  });

  it("rejects OpenCode when provider reports a different resumed session", async () => {
    const adapter = createOpenCodeMainThreadAdapter({
      spawnImpl: fakeSpawn(
        {
          lines: [
            { type: "step_start", sessionID: "ses-other" },
            {
              type: "part",
              sessionID: "ses-other",
              part: { type: "text", text: "wrong thread" },
            },
          ],
        },
        [],
      ),
      timeoutMs: 1000,
    });

    await expect(
      adapter.runTurn({
        projectRoot: "/repo",
        message: "continue",
        externalThreadId: "ses-wanted",
        model: null,
      }),
    ).rejects.toThrow(/resumed a different session/);
  });

  it("forces Codex CLI to read-only sandbox with approval never", () => {
    expect(
      buildCodexMainThreadArgs({
        projectRoot: "/repo",
        message: "continue",
        externalThreadId: "thr-9",
        model: "gpt-5.2-codex",
      }),
    ).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "-C",
      "/repo",
      "--model",
      "gpt-5.2-codex",
      "resume",
      "thr-9",
      "continue",
    ]);
  });

  it("keeps exact Codex thread identity and rejects file-change evidence", async () => {
    const adapter = createCodexMainThreadAdapter({
      spawnImpl: fakeSpawn(
        {
          lines: [
            { type: "thread.started", thread_id: "thr-9" },
            {
              type: "item.completed",
              item: { type: "file_change", status: "completed" },
            },
            {
              type: "item.completed",
              item: { type: "agent_message", text: "changed" },
            },
          ],
        },
        [],
      ),
      timeoutMs: 1000,
    });

    await expect(
      adapter.runTurn({
        projectRoot: "/repo",
        message: "inspect only",
        externalThreadId: "thr-9",
        model: null,
      }),
    ).rejects.toThrow(/file-change attempt/);
  });
});
