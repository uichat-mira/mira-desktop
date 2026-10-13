import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import type { SkillAgentExecutionInput } from "./types.js";

type ScriptedCall = { name: string; args: Record<string, unknown> };

const mocks = vi.hoisted(() => ({
  agentOptions: undefined as AgentOptions | undefined,
  agentState: undefined as
    | { messages: unknown[]; tools: Array<Record<string, any>> }
    | undefined,
  completion: "",
  script: [] as ScriptedCall[][],
  promptCount: 0,
  toolResults: [] as unknown[],
  toolErrors: [] as Array<{ name: string; error: string }>,
}));

vi.mock("@/providers/catalog.js", () => ({
  getProviderDefinition: () => ({ chatAdapter: "openai-compatible" }),
}));

vi.mock("@/services/provider-proxy.service/resolution.js", () => ({
  resolveAgentTaskProvider: () => ({
    providerCode: "test-provider",
    providerTemplateCode: "openai-compatible-custom",
    baseUrl: "http://localhost:1234/v1",
    model: "test-model",
    apiKey: "test-key",
    params: {},
  }),
}));

vi.mock("@earendil-works/pi-ai/api/openai-completions", () => ({
  streamSimple: vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      yield* [];
    },
  })),
}));

vi.mock("@earendil-works/pi-agent-core", () => {
  class Agent {
    state: { messages: unknown[]; tools: Array<Record<string, any>> };

    constructor(options: AgentOptions) {
      mocks.agentOptions = options;
      this.state = {
        messages: structuredClone(options.initialState?.messages ?? []),
        tools: [
          ...((options.initialState?.tools ?? []) as Array<Record<string, any>>),
        ],
      };
      mocks.agentState = this.state;
    }

    async prompt() {
      const round = mocks.promptCount;
      const calls = mocks.script[round] ?? [];
      mocks.promptCount += 1;

      for (const call of calls) {
        const tool = this.state.tools.find(
          (candidate) => candidate.name === call.name,
        );
        if (!tool || typeof tool.execute !== "function") {
          throw new Error(`Mock Tool not found: ${call.name}`);
        }
        try {
          mocks.toolResults.push(
            await tool.execute(`mock-${round}-${call.name}`, call.args, undefined),
          );
        } catch (error) {
          mocks.toolErrors.push({
            name: call.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        const nextTurn = await mocks.agentOptions?.prepareNextTurnWithContext?.(
          {
            message: { role: "assistant", content: [], timestamp: Date.now() },
            toolResults: [],
            context: { messages: this.state.messages, tools: this.state.tools },
            newMessages: [],
          } as any,
          undefined,
        );
        if (nextTurn?.context?.tools) {
          this.state.tools = [
            ...(nextTurn.context.tools as Array<Record<string, any>>),
          ];
        }
      }

      this.state.messages.push({
        role: "assistant",
        content: [{ type: "text", text: mocks.completion }],
      });
    }
  }
  return { Agent };
});

import { runPiSkillAgent } from "./pi-core.js";

const execution = (): SkillAgentExecutionInput => ({
  goal: "Compare a.txt and b.txt",
  skillContext: {
    instruction: "Use the supplied governed tools.",
    primary: {
      id: "generic-task",
      version: "0.1.0",
      name: "Generic Task",
      body: "Read and compare the requested files with the supplied governed tools.",
    },
    resources: [],
    disclosedResources: [],
  },
  threadId: "thread-1",
});

const pathSchema = {
  type: "object",
  required: ["path"],
  properties: { path: { type: "string" } },
  additionalProperties: false,
};

const toReadBinding = (paths: string[]) => ({
  id: "read",
  label: "read",
  description: "read tool",
  inputSchema: pathSchema,
  execute: async (args: Record<string, unknown>) => {
    paths.push(String(args.path));
    return {
      result: { content: `${args.path}=${paths.length * 100}` },
      evidence: { path: args.path },
    };
  },
});

const toWriteBinding = (counter: { executions: number }) => ({
  id: "write",
  label: "write",
  description: "write tool",
  inputSchema: pathSchema,
  execute: async () => {
    counter.executions += 1;
    return { result: { ok: true } };
  },
});

describe("runPiSkillAgent schema disclosure vs verified task evidence", () => {
  beforeEach(() => {
    mocks.agentOptions = undefined;
    mocks.agentState = undefined;
    mocks.completion = "";
    mocks.script = [];
    mocks.promptCount = 0;
    mocks.toolResults = [];
    mocks.toolErrors = [];
  });

  it("accepts multiple real read results plus a schema-only Tool as a correct completion", async () => {
    mocks.completion = JSON.stringify({
      status: "completed",
      summary: "a.txt is smaller than b.txt",
    });
    const readPaths: string[] = [];
    const writeCounter = { executions: 0 };
    mocks.script = [
      [
        { name: "read", args: { path: "a.txt" } },
        { name: "read", args: { path: "b.txt" } },
        { name: "write", args: {} },
      ],
    ];

    const result = await runPiSkillAgent({
      execution: execution(),
      tools: [toReadBinding(readPaths), toWriteBinding(writeCounter)],
      disclosedToolIds: ["read"],
    });

    // The goal is already supported by two real governed reads. The `write`
    // Tool only disclosed its schema and is not required, so it is neither an
    // automatic evidence gap nor a reason to restart the Child.
    expect(result.status).toBe("completed");
    expect(readPaths).toEqual(["a.txt", "b.txt"]);
    expect(writeCounter.executions).toBe(0);
    expect(mocks.promptCount).toBe(1);

    // Disclosure is still reported truthfully as a non-execution.
    const disclosure = result.trace?.events?.find(
      (event) =>
        event.type === "plan.revised" && event.details?.toolId === "write",
    );
    expect(disclosure?.details).toMatchObject({ bindingExecuted: false });
  });

  it("does not accept completion and reconciles in the same Child when only a schema was disclosed", async () => {
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });
    const readPaths: string[] = [];
    mocks.script = [
      [{ name: "read", args: { path: "a.txt" } }],
      [],
      [],
    ];

    const result = await runPiSkillAgent({
      execution: execution(),
      tools: [toReadBinding(readPaths)],
      disclosedToolIds: [],
    });

    // Schema disclosure never executed the governed binding, so the completion
    // claim is rejected. The runtime kept the work inside the same Child before
    // reporting the concrete gap instead of faking success.
    expect(result.status).toBe("insufficient_evidence");
    expect(result.missingEvidence).toEqual([
      "Unexecuted governed Tool(s) required for completion: read",
    ]);
    expect(readPaths).toEqual([]);
    expect(mocks.promptCount).toBe(3);
  });

  it("continues the same Child and accepts completion after the disclosed binding really runs", async () => {
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });
    const readPaths: string[] = [];
    mocks.script = [
      [{ name: "read", args: { path: "a.txt" } }],
      [{ name: "read", args: { path: "a.txt" } }],
    ];

    const result = await runPiSkillAgent({
      execution: execution(),
      tools: [toReadBinding(readPaths)],
      disclosedToolIds: [],
    });

    expect(result.status).toBe("completed");
    expect(readPaths).toEqual(["a.txt"]);
    // Initial prompt + exactly one reconciliation round; no re-delegation.
    expect(mocks.promptCount).toBe(2);
    expect(mocks.toolErrors).toEqual([]);
  });

  it("keeps governed execution blocked until a valid retry after schema disclosure", async () => {
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });
    const readPaths: string[] = [];
    mocks.script = [
      [{ name: "read", args: { path: "a.txt" } }],
      [{ name: "read", args: {} }],
    ];

    const result = await runPiSkillAgent({
      execution: execution(),
      tools: [toReadBinding(readPaths)],
      disclosedToolIds: [],
    });

    // The metadata-stage call promoted the schema without executing; the retry
    // carried invalid args, so the canonical Harness validation still blocked
    // the binding. No execution evidence may be fabricated from that.
    expect(readPaths).toEqual([]);
    expect(result.status).toBe("insufficient_evidence");
    expect(mocks.toolErrors).toHaveLength(1);
    expect(mocks.toolErrors[0]?.name).toBe("read");
    expect(mocks.toolErrors[0]?.error).toContain("args.path is required");
  });
});
