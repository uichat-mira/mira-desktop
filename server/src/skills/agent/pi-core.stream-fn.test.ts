import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import type { SkillAgentExecutionInput } from "./types.js";

const mocks = vi.hoisted(() => ({
  agentOptions: undefined as AgentOptions | undefined,
  agentState: undefined as
    | { messages: unknown[]; tools: Array<Record<string, any>> }
    | undefined,
  providerResolutionCalls: 0,
  completion: "",
  promptToolCall: undefined as
    | { name: string; args: Record<string, unknown> }
    | undefined,
  promptToolResult: undefined as unknown,
}));

vi.mock("@/providers/catalog.js", () => ({
  getProviderDefinition: () => ({ chatAdapter: "openai-compatible" }),
}));

vi.mock("@/services/provider-proxy.service/resolution.js", () => ({
  resolveAgentTaskProvider: () => {
    mocks.providerResolutionCalls += 1;
    return {
      providerCode: "volcengine-code-plan",
      providerTemplateCode: "volcengine-code-plan",
      baseUrl: "http://localhost:1234/v1",
      model: "test-model",
      apiKey: "test-key",
      params: {},
    };
  },
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
    state: {
      messages: unknown[];
      tools: Array<Record<string, any>>;
    };

    constructor(options: AgentOptions) {
      mocks.agentOptions = options;
      this.state = {
        messages: structuredClone(options.initialState?.messages ?? []),
        tools: [...((options.initialState?.tools ?? []) as Array<Record<string, any>>)],
      };
      mocks.agentState = this.state;
    }

    async prompt() {
      if (mocks.promptToolCall) {
        const tool = this.state.tools.find(
          (candidate) => candidate.name === mocks.promptToolCall?.name,
        );
        if (!tool || typeof tool.execute !== "function") {
          throw new Error(`Mock Tool not found: ${mocks.promptToolCall.name}`);
        }
        mocks.promptToolResult = await tool.execute(
          "mock-tool-call",
          mocks.promptToolCall.args,
          undefined,
        );

        const nextTurn = await mocks.agentOptions?.prepareNextTurnWithContext?.(
          {
            message: {
              role: "assistant",
              content: [],
              timestamp: Date.now(),
            },
            toolResults: [],
            context: {
              messages: this.state.messages,
              tools: this.state.tools,
            },
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

import { streamSimple as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { runPiSkillAgent } from "./pi-core.js";

const execution = (): SkillAgentExecutionInput => ({
  goal: "Inspect the repository",
  skillContext: {
    instruction: "Use the GitHub Skill.",
    primary: {
      id: "github-collaboration",
      version: "0.1.0",
      name: "GitHub 协作",
      body: "Inspect with the supplied governed tools.",
    },
    resources: [],
    disclosedResources: [],
  },
  threadId: "thread-1",
});

describe("runPiSkillAgent Pi 1.0 stream boundary", () => {
  beforeEach(() => {
    mocks.agentOptions = undefined;
    mocks.agentState = undefined;
    mocks.promptToolCall = undefined;
    mocks.promptToolResult = undefined;
  });

  it("constructs the Pi Agent with the explicit OpenAI-completions streamFn", async () => {
    mocks.agentOptions = undefined;
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });

    const result = await runPiSkillAgent({ execution: execution(), tools: [] });

    expect(result.status).toBe("completed");
    expect(mocks.agentOptions?.streamFn).toBe(streamOpenAICompletions);
  });

  it("keeps Mira provider resolution as the model owner and never migrates to the Pi catalog", async () => {
    mocks.agentOptions = undefined;
    mocks.providerResolutionCalls = 0;
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });

    await runPiSkillAgent({ execution: execution(), tools: [] });

    expect(mocks.providerResolutionCalls).toBe(1);
  });

  it("preserves the custom OpenAI-compatible model and Ark compatibility overrides", async () => {
    mocks.agentOptions = undefined;
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });

    await runPiSkillAgent({ execution: execution(), tools: [] });

    expect(mocks.agentOptions?.initialState?.model).toMatchObject({
      id: "test-model",
      name: "test-model",
      api: "openai-completions",
      provider: "volcengine-code-plan",
      baseUrl: "http://localhost:1234/v1",
      reasoning: false,
      input: ["text"],
      compat: {
        supportsStore: false,
        supportsUsageInStreaming: false,
        maxTokensField: "max_tokens",
        supportsStrictMode: false,
      },
    });
  });

  it("presents a full schema only for exact-known Tools and compact metadata for the rest", async () => {
    mocks.agentOptions = undefined;
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });

    const toBinding = (id: string) => ({
      id,
      label: id,
      description: `${id} tool`,
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } },
        additionalProperties: false,
      },
      execute: async () => ({}),
    });

    await runPiSkillAgent({
      execution: execution(),
      tools: [toBinding("read"), toBinding("write")],
      disclosedToolIds: ["read"],
    });

    const tools = (mocks.agentOptions?.initialState?.tools ?? []) as Array<{
      name: string;
      parameters: unknown;
    }>;
    const read = tools.find((tool) => tool.name === "read");
    const write = tools.find((tool) => tool.name === "write");

    expect(read?.parameters).toMatchObject({
      properties: { path: { type: "string" } },
    });
    // A Tool that stayed at the metadata stage must not leak its full schema.
    expect(write?.parameters).toEqual({ type: "object" });
  });

  it("promotes a metadata-stage Tool before execution and validates the retried call", async () => {
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });
    mocks.promptToolCall = { name: "write", args: {} };

    let executionCount = 0;
    const executionInput = execution();
    const writeBinding = {
      id: "write",
      label: "write",
      description: "write tool",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } },
        additionalProperties: false,
      },
      execute: async () => {
        executionCount += 1;
        return { result: { ok: true } };
      },
    };

    const result = await runPiSkillAgent({
      execution: executionInput,
      tools: [writeBinding],
      disclosedToolIds: [],
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain(
      "subAgent completed before executing promoted Tool(s): write",
    );
    // The first exact-known call only promotes metadata -> schema. It must not
    // execute the governed binding with arguments produced from an empty schema,
    // and the runtime must reject a completion that skips the required retry.
    expect(executionCount).toBe(0);
    expect(mocks.promptToolResult).toMatchObject({
      details: {
        toolId: "write",
        disclosure: "schema",
        bindingExecuted: false,
      },
    });
    expect(executionInput.skillContext.disclosedTools).toEqual(["write"]);

    // The Pi-compatible next-turn hook swaps the provider-visible loadout only
    // after the metadata-stage call has completed.
    const promoted = mocks.agentState?.tools.find(
      (tool) => tool.name === "write",
    );
    expect(promoted?.parameters).toMatchObject({
      required: ["path"],
      properties: { path: { type: "string" } },
    });

    // Even after Pi exposes the full schema, the adapter validates canonical
    // Harness args before the real binding can execute.
    await expect(
      promoted?.execute("invalid-retry", {}, undefined),
    ).rejects.toThrow("args.path is required");
    expect(executionCount).toBe(0);

    await promoted?.execute(
      "valid-retry",
      { path: "README.md" },
      undefined,
    );
    expect(executionCount).toBe(1);
  });

  it("keeps every allowed Tool schema-disclosed when the Skill does not opt into progressive disclosure", async () => {
    mocks.agentOptions = undefined;
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });

    const binding = {
      id: "read",
      label: "read",
      description: "read tool",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } },
        additionalProperties: false,
      },
      execute: async () => ({}),
    };

    await runPiSkillAgent({ execution: execution(), tools: [binding] });

    const tools = (mocks.agentOptions?.initialState?.tools ?? []) as Array<{
      name: string;
      parameters: unknown;
    }>;
    const read = tools.find((tool) => tool.name === "read");
    expect(read?.parameters).toMatchObject({
      properties: { path: { type: "string" } },
    });
  });
});
