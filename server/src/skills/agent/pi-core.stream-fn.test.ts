import { describe, expect, it, vi } from "vitest";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import type { SkillAgentExecutionInput } from "./types.js";

const mocks = vi.hoisted(() => ({
  agentOptions: undefined as AgentOptions | undefined,
  providerResolutionCalls: 0,
  completion: "",
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
    state: { messages: unknown[] };

    constructor(options: AgentOptions) {
      mocks.agentOptions = options;
      this.state = {
        messages: structuredClone(options.initialState?.messages ?? []),
      };
    }

    async prompt() {
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
