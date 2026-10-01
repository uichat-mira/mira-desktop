import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  buildCodexDesktopThreadRequest,
  buildCodexDesktopTurnRequest,
  createCodexDesktopMainThreadAdapter,
} from "./codex-desktop.js";

class FakeAppServer extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4321;
  private buffer = "";
  private threadId = "thr-desktop-1";
  private turnCount = 0;

  constructor(
    private readonly capture: {
      messages: Array<Record<string, unknown>>;
      resumeId?: string;
      fileChange?: boolean;
    },
  ) {
    super();
    this.stdin.on("data", (chunk) => this.consume(chunk.toString()));
    this.stdin.on("end", () => {
      queueMicrotask(() => this.emit("close", 0, null));
    });
  }

  private write(message: Record<string, unknown>) {
    this.stdout.write(JSON.stringify(message) + "\n");
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      this.capture.messages.push(message);
      if (!Object.prototype.hasOwnProperty.call(message, "id")) continue;

      if (message.method === "initialize") {
        this.write({ id: message.id, result: { codexHome: "/tmp/.codex" } });
        continue;
      }
      if (message.method === "thread/start") {
        this.write({
          id: message.id,
          result: { thread: { id: this.threadId } },
        });
        continue;
      }
      if (message.method === "thread/resume") {
        const params = message.params as { threadId: string };
        this.capture.resumeId = params.threadId;
        this.threadId = params.threadId;
        this.write({
          id: message.id,
          result: { thread: { id: params.threadId } },
        });
        continue;
      }
      if (message.method === "turn/start") {
        this.turnCount += 1;
        const turnId = "turn-" + this.turnCount;
        this.write({
          id: message.id,
          result: {
            turn: {
              id: turnId,
              status: "inProgress",
              items: [],
              error: null,
            },
          },
        });
        queueMicrotask(() => {
          if (this.capture.fileChange) {
            this.write({
              method: "item/completed",
              params: {
                threadId: this.threadId,
                turnId,
                item: {
                  id: "fc-1",
                  type: "fileChange",
                  status: "completed",
                },
              },
            });
          }
          this.write({
            method: "item/completed",
            params: {
              threadId: this.threadId,
              turnId,
              item: {
                id: "r-1",
                type: "reasoning",
                summary: [{ text: "checked project" }],
              },
            },
          });
          this.write({
            method: "item/completed",
            params: {
              threadId: this.threadId,
              turnId,
              item: {
                id: "a-1",
                type: "agentMessage",
                text: "read-only answer",
              },
            },
          });
          this.write({
            method: "turn/completed",
            params: {
              threadId: this.threadId,
              turn: {
                id: turnId,
                status: "completed",
                error: null,
              },
            },
          });
        });
        continue;
      }
      if (message.method === "thread/unsubscribe") {
        this.write({
          id: message.id,
          result: { status: "unsubscribed" },
        });
      }
    }
  }

  kill() {
    queueMicrotask(() => this.emit("close", null, "SIGTERM"));
    return true;
  }
}

function fakeSpawn(capture: {
  messages: Array<Record<string, unknown>>;
  resumeId?: string;
  fileChange?: boolean;
}) {
  return (() =>
    new FakeAppServer(capture)) as unknown as typeof import("node:child_process").spawn;
}

describe("Codex Desktop Main Thread adapter", () => {
  it("uses read-only thread and turn contracts", () => {
    expect(
      buildCodexDesktopThreadRequest({
        projectRoot: "/repo",
        externalThreadId: "thr-9",
        model: "gpt-5.6-sol",
      }),
    ).toEqual({
      method: "thread/resume",
      params: {
        cwd: "/repo",
        approvalPolicy: "never",
        sandbox: "read-only",
        model: "gpt-5.6-sol",
        threadId: "thr-9",
        excludeTurns: true,
      },
    });

    expect(
      buildCodexDesktopTurnRequest({
        projectRoot: "/repo",
        threadId: "thr-9",
        message: "inspect",
      }),
    ).toEqual({
      threadId: "thr-9",
      input: [{ type: "text", text: "inspect" }],
      cwd: "/repo",
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
    });
  });

  it("resumes the exact durable app-server thread and streams reasoning", async () => {
    const capture: {
      messages: Array<Record<string, unknown>>;
      resumeId?: string;
    } = { messages: [] };
    const streamed: unknown[] = [];
    const adapter = createCodexDesktopMainThreadAdapter({
      spawnImpl: fakeSpawn(capture),
      resolveBin: async () =>
        "/Applications/ChatGPT.app/Contents/Resources/codex",
      timeoutMs: 1000,
    });

    const result = await adapter.runTurn({
      projectRoot: "/repo",
      message: "continue",
      externalThreadId: "thr-durable-7",
      model: null,
      onEvent: (event) => {
        streamed.push(event);
      },
    });

    expect(capture.resumeId).toBe("thr-durable-7");
    expect(result.externalThreadId).toBe("thr-durable-7");
    expect(result.responseText).toBe("read-only answer");
    expect(streamed.some((event) => (event as { type?: string }).type === "thinking")).toBe(true);
    await adapter.dispose?.();
  });

  it("rejects provider-reported file changes", async () => {
    const capture = {
      messages: [] as Array<Record<string, unknown>>,
      fileChange: true,
    };
    const adapter = createCodexDesktopMainThreadAdapter({
      spawnImpl: fakeSpawn(capture),
      resolveBin: async () =>
        "/Applications/ChatGPT.app/Contents/Resources/codex",
      timeoutMs: 1000,
    });

    await expect(
      adapter.runTurn({
        projectRoot: "/repo",
        message: "inspect only",
        externalThreadId: null,
        model: null,
      }),
    ).rejects.toThrow(/file-change attempt/);

    await adapter.dispose?.();
  });
});
