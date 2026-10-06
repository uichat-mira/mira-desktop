import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { executeDefaultChatToolLoop } from "./chat-tool-loop.js";
import { initializeHarnessRuntime, resetHarnessRuntime } from "@/mcp/bootstrap.js";
import { clearHarnessRegistry } from "@/harness/registry.js";
import * as providerResolution from "@/services/provider-proxy.service/resolution.js";
import * as harnessInvocations from "@/harness/invocations.js";

test("executeDefaultChatToolLoop trims long non-system history before tool decision", async () => {
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  const resolveProviderForRoleSpy = vi
    .spyOn(providerResolution, "resolveProviderForRole")
    .mockReturnValue({
      providerCode: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      modelConfigId: "cfg-test",
      params: {},
    });

  const originalFetch = globalThis.fetch;
  const fetchBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role: string; content: string }>;
    };
    fetchBodies.push({ messages: body.messages ?? [] });

    return new Response(
      JSON.stringify({
        id: "chatcmpl-tool-1",
        object: "chat.completion",
        created: 0,
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "final answer",
            },
            finish_reason: "stop",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "inv-1",
      toolId: "web_search",
      status: "completed",
      args: {},
      artifacts: [],
      result: { ok: true },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

  try {
    const result = await executeDefaultChatToolLoop({
      requestedProvider: "default",
      threadId: "thread-1",
      userId: 1,
      agentEnabled: true,
      messages: [
        { role: "system", content: "role context" },
        { role: "system", content: "summary context" },
        { role: "system", content: "agent context" },
        { role: "user", content: "user-1" },
        { role: "assistant", content: "assistant-1" },
        { role: "user", content: "user-2" },
        { role: "assistant", content: "assistant-2" },
        { role: "user", content: "user-3" },
        { role: "assistant", content: "assistant-3" },
        { role: "user", content: "user-4" },
        { role: "assistant", content: "assistant-4" },
        { role: "user", content: "latest user" },
      ],
    });

    assert.equal(result?.answer, "final answer");
    assert.equal(fetchBodies.length, 1);
    assert.equal(fetchBodies[0]?.messages.length, 11);
    assert.deepEqual(fetchBodies[0]?.messages.slice(0, 3).map((message) => message.content), [
      "role context",
      "summary context",
      "agent context",
    ]);
    assert.deepEqual(fetchBodies[0]?.messages.at(-1), {
      role: "user",
      content: "latest user",
    });
    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 0);
  } finally {
    resolveProviderForRoleSpy.mockRestore();
    executeHarnessInvocationSpy.mockRestore();
    globalThis.fetch = originalFetch;
  }
});

test("executeDefaultChatToolLoop removes stale assistant tool prose before tool decision", async () => {
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  const resolveProviderForRoleSpy = vi
    .spyOn(providerResolution, "resolveProviderForRole")
    .mockReturnValue({
      providerCode: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      modelConfigId: "cfg-test",
      params: {},
    });

  const originalFetch = globalThis.fetch;
  const fetchBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role: string; content: string }>;
    };
    fetchBodies.push({ messages: body.messages ?? [] });

    return new Response(
      JSON.stringify({
        id: "chatcmpl-tool-clean-1",
        object: "chat.completion",
        created: 0,
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "final answer",
            },
            finish_reason: "stop",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const result = await executeDefaultChatToolLoop({
      requestedProvider: "default",
      threadId: "thread-2",
      userId: 1,
      agentEnabled: true,
      messages: [
        { role: "system", content: "role context" },
        { role: "assistant", content: "read_list <tool_input>{\"path\":\"D:\\\\testData\"}</tool_input> empty directory" },
        { role: "user", content: "帮我看看文件夹下有啥" },
      ],
    });

    assert.equal(result?.answer, "final answer");
    assert.equal(fetchBodies.length, 1);
    assert.equal(
      fetchBodies[0]?.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.includes("read_list"),
      ),
      false,
    );
  } finally {
    resolveProviderForRoleSpy.mockRestore();
    globalThis.fetch = originalFetch;
  }
});

test("executeDefaultChatToolLoop keeps ordinary assistant prose that mentions terminal", async () => {
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  const resolveProviderForRoleSpy = vi
    .spyOn(providerResolution, "resolveProviderForRole")
    .mockReturnValue({
      providerCode: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      modelConfigId: "cfg-test",
      params: {},
    });

  const originalFetch = globalThis.fetch;
  const fetchBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role: string; content: string }>;
    };
    fetchBodies.push({ messages: body.messages ?? [] });
    return new Response(
      JSON.stringify({
        id: "chatcmpl-terminal-prose",
        object: "chat.completion",
        created: 0,
        model: "mock-model",
        choices: [{ index: 0, message: { role: "assistant", content: "final answer" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await executeDefaultChatToolLoop({
      requestedProvider: "default",
      threadId: "thread-terminal-prose",
      userId: 1,
      agentEnabled: true,
      messages: [
        { role: "assistant", content: "The terminal runtime is available when a real command is needed." },
        { role: "user", content: "continue" },
      ],
    });

    assert.equal(
      fetchBodies[0]?.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.includes("terminal runtime"),
      ),
      true,
    );
  } finally {
    resolveProviderForRoleSpy.mockRestore();
    globalThis.fetch = originalFetch;
  }
});

test("executeDefaultChatToolLoop removes stale canonical terminal tool prose", async () => {
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  const resolveProviderForRoleSpy = vi
    .spyOn(providerResolution, "resolveProviderForRole")
    .mockReturnValue({
      providerCode: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      modelConfigId: "cfg-test",
      params: {},
    });

  const originalFetch = globalThis.fetch;
  const fetchBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role: string; content: string }>;
    };
    fetchBodies.push({ messages: body.messages ?? [] });
    return new Response(
      JSON.stringify({
        id: "chatcmpl-terminal-clean",
        object: "chat.completion",
        created: 0,
        model: "mock-model",
        choices: [{ index: 0, message: { role: "assistant", content: "final answer" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await executeDefaultChatToolLoop({
      requestedProvider: "default",
      threadId: "thread-terminal-clean",
      userId: 1,
      agentEnabled: true,
      messages: [
        { role: "assistant", content: 'terminal <tool_input>{"command":"pwd"}</tool_input>' },
        { role: "user", content: "continue" },
      ],
    });

    assert.equal(
      fetchBodies[0]?.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.includes("<tool_input>"),
      ),
      false,
    );
  } finally {
    resolveProviderForRoleSpy.mockRestore();
    globalThis.fetch = originalFetch;
  }
});

test("executeDefaultChatToolLoop forces a final synthesis answer after hitting the tool-step limit", async () => {
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  const resolveProviderForRoleSpy = vi
    .spyOn(providerResolution, "resolveProviderForRole")
    .mockReturnValue({
      providerCode: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      modelConfigId: "cfg-test",
      params: {},
    });

  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];
  let fetchCallCount = 0;
  globalThis.fetch = (async (_input, init) => {
    fetchCallCount += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requestBodies.push(body);

    if (fetchCallCount <= 3) {
      return new Response(
        JSON.stringify({
          id: `chatcmpl-tool-${fetchCallCount}`,
          object: "chat.completion",
          created: 0,
          model: "mock-model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: `call_${fetchCallCount}`,
                    type: "function",
                    function: {
                      name: "read_list",
                      arguments: JSON.stringify({ path: "." }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: "chatcmpl-synthesis",
        object: "chat.completion",
        created: 0,
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "final synthesized answer",
            },
            finish_reason: "stop",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "inv-1",
      toolId: "read_list",
      status: "completed",
      args: { path: "." },
      artifacts: [],
      result: { entries: ["a.txt"] },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

  try {
    const result = await executeDefaultChatToolLoop({
      requestedProvider: "default",
      threadId: "thread-limit-1",
      userId: 1,
      agentEnabled: true,
      messages: [
        {
          role: "user",
          content: "delete acceptance-eval.zip",
          parts: [{ type: "text", text: "delete acceptance-eval.zip" }],
        },
      ],
    });

    assert.equal(result?.answer, "final synthesized answer");
    assert.equal(fetchCallCount, 4);
    const synthesisMessages = requestBodies.at(-1)?.messages as
      | Array<{ role: string; content?: string }>
      | undefined;
    assert.ok(synthesisMessages);
    assert.equal(synthesisMessages?.at(-1)?.role, "system");
    assert.match(synthesisMessages?.at(-1)?.content ?? "", /Do not call more tools/);
    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 3);
  } finally {
    resolveProviderForRoleSpy.mockRestore();
    executeHarnessInvocationSpy.mockRestore();
    globalThis.fetch = originalFetch;
  }
});

test("executeDefaultChatToolLoop returns early when Harness requires approval", async () => {
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  const resolveProviderForRoleSpy = vi
    .spyOn(providerResolution, "resolveProviderForRole")
    .mockReturnValue({
      providerCode: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      modelConfigId: "cfg-test",
      params: {},
    });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-tool-approval",
        object: "chat.completion",
        created: 0,
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_approval_1",
                  type: "function",
                  function: {
                    name: "web_search",
                    arguments: JSON.stringify({ query: "latest news today" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;

  const toolEvents: Array<{ status: string; errorMessage?: string }> = [];
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "inv-approval",
      toolId: "web_search",
      status: "awaiting_approval",
      args: { query: "latest news today" },
      artifacts: [],
      approval: {
        required: true,
        reason: "web_search requires explicit approval before execution.",
        scope: "web_search",
      },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

  try {
    const result = await executeDefaultChatToolLoop({
      requestedProvider: "default",
      threadId: "thread-approval-1",
      userId: 1,
      agentEnabled: true,
      messages: [
        {
          role: "user",
          content: "latest news today",
          parts: [{ type: "text", text: "latest news today" }],
        },
      ],
      onToolEvent: async (event) => {
        toolEvents.push({
          status: event.status,
          errorMessage: event.errorMessage,
        });
      },
    });

    assert.equal(result?.awaitingApproval, true);
    assert.match(result?.answer ?? "", /requires explicit approval/i);
    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(
      toolEvents.some((event) => event.status === "awaiting_approval"),
      true,
    );
  } finally {
    resolveProviderForRoleSpy.mockRestore();
    executeHarnessInvocationSpy.mockRestore();
    globalThis.fetch = originalFetch;
  }
});
