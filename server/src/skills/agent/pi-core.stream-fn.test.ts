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
  completions: [] as string[],
  promptCount: 0,
  promptToolCall: undefined as
    | { name: string; args: Record<string, unknown> }
    | undefined,
  promptToolResult: undefined as unknown,
  promptRetryToolCall: undefined as
    | { name: string; args: Record<string, unknown> }
    | undefined,
  promptRetryToolResult: undefined as unknown,
  continuationToolCall: undefined as
    | { name: string; args: Record<string, unknown> }
    | undefined,
  continuationToolResults: [] as unknown[],
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
      const callIndex = mocks.promptCount;
      mocks.promptCount += 1;

      const scripted =
        callIndex === 0 ? mocks.promptToolCall : mocks.continuationToolCall;
      if (scripted) {
        const tool = this.state.tools.find(
          (candidate) => candidate.name === scripted.name,
        );
        if (!tool || typeof tool.execute !== "function") {
          throw new Error(`Mock Tool not found: ${scripted.name}`);
        }
        if (callIndex === 0) {
          mocks.promptToolResult = await tool.execute(
            "mock-tool-call",
            scripted.args,
            undefined,
          );
        } else {
          try {
            mocks.continuationToolResults.push(
              await tool.execute(
                "mock-continuation-call",
                scripted.args,
                undefined,
              ),
            );
          } catch (error) {
            mocks.continuationToolResults.push({
              isError: true,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

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

      if (callIndex === 0 && mocks.promptToolCall && mocks.promptRetryToolCall) {
        const retryTool = this.state.tools.find(
          (candidate) => candidate.name === mocks.promptRetryToolCall?.name,
        );
        if (!retryTool || typeof retryTool.execute !== "function") {
          throw new Error(
            `Mock retry Tool not found: ${mocks.promptRetryToolCall.name}`,
          );
        }
        try {
          mocks.promptRetryToolResult = await retryTool.execute(
            "mock-tool-retry",
            mocks.promptRetryToolCall.args,
            undefined,
          );
        } catch (error) {
          // Mirror Pi 1.0.2 executePreparedToolCall(): Tool throws become an
          // error Tool result and the Agent loop continues.
          mocks.promptRetryToolResult = {
            isError: true,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      this.state.messages.push({
        role: "assistant",
        content: [{ type: "text", text: mocks.completions[callIndex] ?? mocks.completion }],
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
    mocks.promptCount = 0;
    mocks.completions = [];
    mocks.promptToolCall = undefined;
    mocks.promptToolResult = undefined;
    mocks.promptRetryToolCall = undefined;
    mocks.promptRetryToolResult = undefined;
    mocks.continuationToolCall = undefined;
    mocks.continuationToolResults = [];
  });

  it("constructs the Pi Agent with the explicit OpenAI-completions streamFn", async () => {
    mocks.agentOptions = undefined;
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });

    const result = await runPiSkillAgent({ execution: execution(), tools: [] });

    expect(result.status).toBe("completed");
    // Pi receives the production transport wrapper, which passes through
    // unchanged for non-OpenCode providers and adds Go session affinity only
    // for the official OpenCode Go endpoint.
    expect(mocks.agentOptions?.streamFn).toEqual(expect.any(Function));
    expect(mocks.agentOptions?.streamFn).not.toBe(streamOpenAICompletions);
  });

  it("sets stable OpenCode Go affinity headers without granting them to unrelated providers", async () => {
    const { createSkillAgentStreamFn } = await import("./pi-core.js");
    const fn = createSkillAgentStreamFn("mira-subagent:skill:run-309");
    const model = { baseUrl: "https://opencode.ai/zen/go/v1" } as Parameters<typeof fn>[0];
    const context = { messages: [], tools: [] } as unknown as Parameters<typeof fn>[1];
    const options = { headers: { "X-Custom": "original" } } as Parameters<typeof fn>[2];
    vi.mocked(streamOpenAICompletions).mockClear();
    fn(model, context, options);
    fn(model, context, options);
    expect(vi.mocked(streamOpenAICompletions)).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(streamOpenAICompletions).mock.calls) {
      expect(call[0]).toBe(model);
      expect(call[1]).toBe(context);
      expect(call[2]?.headers).toEqual({
        "X-Custom": "original",
        "x-opencode-session": "mira-subagent:skill:run-309",
        "User-Agent": "mira-pi-skill-agent/1",
      });
    }
    vi.mocked(streamOpenAICompletions).mockClear();
    const unrelated = { baseUrl: "https://example.com/v1" } as Parameters<typeof fn>[0];
    fn(unrelated, context, options);
    expect(vi.mocked(streamOpenAICompletions)).toHaveBeenCalledWith(unrelated, context, options);
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

  it("reconsiders a schema-only claim in the same Child and preserves its honest unfinished status", async () => {
    mocks.completions = [
      JSON.stringify({ status: "completed", summary: "done" }),
      JSON.stringify({
        status: "insufficient_evidence",
        summary: "Tool schema disclosed, but the requested file has not been written.",
        missingEvidence: ["Requested write did not happen"],
      }),
    ];
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

    // The first exact-known call only promotes metadata -> schema. It must not
    // execute the governed binding with arguments produced from an empty schema,
    // and schema disclosure alone can never satisfy the completion contract.
    expect(executionCount).toBe(0);
    expect(result.status).toBe("insufficient_evidence");
    expect(result.missingEvidence).toEqual(["Requested write did not happen"]);
    // The model, not a fabricated Tool-count criterion, reports the gap after
    // one in-place reconsideration with the promoted schema available.
    expect(mocks.promptCount).toBe(2);
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

  it("does not report a failed governed Tool attempt as never executed after schema promotion", async () => {
    mocks.completion = JSON.stringify({
      status: "insufficient_evidence",
      summary: "Tool failed",
      missingEvidence: ["Write failed"],
    });
    mocks.promptToolCall = { name: "write", args: {} };
    mocks.promptRetryToolCall = {
      name: "write",
      args: { path: "README.md" },
    };

    let executionCount = 0;
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
        throw new Error("simulated binding failure");
      },
    };

    const result = await runPiSkillAgent({
      execution: execution(),
      tools: [writeBinding],
      disclosedToolIds: [],
    });

    expect(executionCount).toBe(1);
    expect(mocks.promptRetryToolResult).toEqual({
      isError: true,
      error: "simulated binding failure",
    });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.missingEvidence).toEqual(["Write failed"]);
    expect(result.trace?.events?.some((event) => event.type === "tool.failed")).toBe(true);
  });

  it("accepts Child completion after reconsidering an unrelated schema-only Tool", async () => {
    mocks.completion = JSON.stringify({
      status: "completed",
      summary: "Read a.txt successfully",
    });
    mocks.promptToolCall = { name: "read", args: { path: "a.txt" } };
    mocks.promptRetryToolCall = { name: "write", args: {} };

    const readExecutions: string[] = [];
    const readBinding = {
      id: "read",
      label: "read",
      description: "read tool",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } },
        additionalProperties: false,
      },
      execute: async (args: Record<string, unknown>) => {
        readExecutions.push(String(args.path));
        return { result: { content: "100" }, evidence: { path: args.path } };
      },
    };
    let writeExecutions = 0;
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
        writeExecutions += 1;
        return { result: {} };
      },
    };

    const result = await runPiSkillAgent({
      execution: execution(),
      tools: [readBinding, writeBinding],
      disclosedToolIds: ["read"],
    });

    // The unrelated Tool's disclosure does not force any execution or a new
    // Child; the existing Child gets one chance to explain why it is not needed.
    expect(result.status).toBe("completed");
    expect(readExecutions).toEqual(["a.txt"]);
    expect(writeExecutions).toBe(0);
    expect(mocks.promptCount).toBe(2);

    // The schema-only promotion is still truthfully marked as not executed.
    const disclosure = result.trace?.events?.find(
      (event) =>
        event.type === "plan.revised" && event.details?.toolId === "write",
    );
    expect(disclosure?.details).toMatchObject({ bindingExecuted: false });
  });

  it("continues the same Child after schema disclosure and accepts completion once the real binding runs", async () => {
    mocks.completion = JSON.stringify({ status: "completed", summary: "done" });
    mocks.promptToolCall = { name: "write", args: {} };
    mocks.continuationToolCall = {
      name: "write",
      args: { path: "README.md" },
    };

    let executionCount = 0;
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
      execution: execution(),
      tools: [writeBinding],
      disclosedToolIds: [],
    });

    expect(result.status).toBe("completed");
    expect(executionCount).toBe(1);
    // Initial prompt + an in-place reconsideration with the actual Tool
    // schema, without a fresh Child or a mechanically repeated retry loop.
    expect(mocks.promptCount).toBe(2);
    expect(mocks.continuationToolResults[0]).toMatchObject({
      details: { toolId: "write" },
    });
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
