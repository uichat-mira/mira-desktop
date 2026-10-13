import assert from "node:assert/strict";
import { Readable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, test, vi } from "vitest";
import Fastify from "fastify";
import { initializeAuthDatabase, createAccessToken } from "@/db/auth.db";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { initializeHarnessRuntime, resetHarnessRuntime } from "@/mcp/bootstrap.js";
import { clearHarnessRegistry } from "@/harness/registry.js";
import * as harnessInvocations from "@/harness/invocations.js";
import {
  knowledgeBaseRepository,
  roleRepository,
  userRepository,
} from "@/db/repositories";
import proxyProviderRoute from "@/routes/proxy-provider/index.js";
import { getLoggerConfig } from "@/logger";
import { knowledgeBaseService } from "@/services/knowledge-base.service.js";
import { providerProxyService } from "@/services/provider-proxy.service/index.js";
import * as providerResolution from "@/services/provider-proxy.service/resolution.js";
import { ragPipeline } from "@/services/rag-pipeline.js";
import { threadService } from "@/services/thread.service.js";
import { sendRouteError } from "@/utils/route-errors.js";
import * as agentModule from "@/agent/index.js";
import { persistAssistantMessage } from "@/routes/proxy-provider/message-persistence.js";
import { shouldUseThreadRag } from "./chat.routes.js";
import {
  resolveChatToolSurface,
  __chatToolSurfaceTestUtils,
} from "./chat-tool-surface.js";
import { executeDefaultChatToolLoop } from "./chat-tool-loop.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const testDbPath = createTimestampedTestArtifactPath(
  "db",
  "rag-demo-proxy-provider",
  ".sqlite",
);
const defaultWorkspaceRoot = createTimestampedTestArtifactPath(
  "workspace",
  "rag-demo-proxy-provider-default",
);
fs.mkdirSync(defaultWorkspaceRoot, { recursive: true });

process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.UI_CHAT_WORKSPACE_ROOT = defaultWorkspaceRoot;

const originalWebSearchEnv = {
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  SEARXNG_BASE_URL: process.env.SEARXNG_BASE_URL,
};

const restoreWebSearchEnv = () => {
  if (originalWebSearchEnv.TAVILY_API_KEY === undefined) {
    delete process.env.TAVILY_API_KEY;
  } else {
    process.env.TAVILY_API_KEY = originalWebSearchEnv.TAVILY_API_KEY;
  }
  if (originalWebSearchEnv.SEARXNG_BASE_URL === undefined) {
    delete process.env.SEARXNG_BASE_URL;
  } else {
    process.env.SEARXNG_BASE_URL = originalWebSearchEnv.SEARXNG_BASE_URL;
  }
};

const enableTestWebSearchProvider = () => {
  process.env.TAVILY_API_KEY = "chat-surface-test-key";
  delete process.env.SEARXNG_BASE_URL;
};


initializeAuthDatabase();
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeRoleDatabase();
initializeThreadDatabase();

afterEach(() => {
  restoreWebSearchEnv();
});

afterAll(() => {
  restoreWebSearchEnv();
  try {
    fs.rmSync(testDbPath, { force: true });
    fs.rmSync(defaultWorkspaceRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup failure on Windows file locking
  }
});

const createAuthedApp = async (user: {
  id: number;
  username: string;
  role: "admin" | "user";
}) => {
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  app.addHook("preHandler", async (request) => {
    request.authUser = user;
  });
  await app.register(proxyProviderRoute);
  return app;
};

test("shouldUseThreadRag only depends on knowledgeBaseId and required runtime inputs", () => {
  assert.equal(
    shouldUseThreadRag({
      knowledgeBaseId: "kb-1",
      ragInput: {
        question: "hello",
        conversationHistory: [],
      },
      threadId: "thread-1",
      hasAuthUser: true,
    }),
    true,
  );

  assert.equal(
    shouldUseThreadRag({
      knowledgeBaseId: null,
      ragInput: {
        question: "hello",
        conversationHistory: [],
      },
      threadId: "thread-1",
      hasAuthUser: true,
    }),
    false,
  );

  assert.equal(
    shouldUseThreadRag({
      knowledgeBaseId: "kb-1",
      ragInput: null,
      threadId: "thread-1",
      hasAuthUser: true,
    }),
    false,
  );

  assert.equal(
    shouldUseThreadRag({
      knowledgeBaseId: "kb-1",
      ragInput: {
        question: "hello",
        conversationHistory: [],
      },
      threadId: undefined,
      hasAuthUser: true,
    }),
    false,
  );
});

test("resolveChatToolSurface excludes the default web_search tool when its runtime is unavailable", () => {
  delete process.env.TAVILY_API_KEY;
  delete process.env.SEARXNG_BASE_URL;
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  assert.deepEqual(resolveChatToolSurface(), []);
});

test("resolveChatToolSurface exposes only allowlisted safe chat tools by default", () => {
  enableTestWebSearchProvider();
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  const toolSurface = resolveChatToolSurface();

  assert.ok(toolSurface.length > 0);
  assert.deepEqual(
    toolSurface.map((tool) => tool.id),
    [...__chatToolSurfaceTestUtils.DEFAULT_CHAT_TOOL_ALLOWLIST],
  );
  assert.ok(toolSurface.every((tool) => tool.id !== "terminal"));
});

test("resolveChatToolSurface respects custom allowlist and maxTools trimming", () => {
  enableTestWebSearchProvider();
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  const toolSurface = resolveChatToolSurface({
    allowlist: ["web_search", "read_list", "list", "read"],
    maxTools: 3,
  });

  assert.equal(toolSurface.length, 3);
  assert.deepEqual(
    new Set(toolSurface.map((tool) => tool.id)),
    new Set(["list", "read", "web_search"]),
  );
  assert.ok(toolSurface.every((tool) => tool.id !== "read_list"));
  assert.ok(toolSurface.every((tool) => tool.id !== "terminal"));
});


test("executeDefaultChatToolLoop invokes Harness when the provider returns a tool call", async () => {
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  const originalFetch = globalThis.fetch;
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

  const toolCallResponse = {
    id: "chatcmpl-tool-1",
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
              id: "call_1",
              type: "function",
              function: {
                name: "web_search",
                arguments: JSON.stringify({ query: "hello world" }),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };

  const finalResponse = {
    id: "chatcmpl-tool-2",
    object: "chat.completion",
    created: 0,
    model: "mock-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "final answer after tool",
        },
        finish_reason: "stop",
      },
    ],
  };

  let executeHarnessInvocationCalls = 0;
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockImplementation(async () => {
      executeHarnessInvocationCalls += 1;
    return {
      id: "inv-1",
      toolId: "web_search",
      status: "completed",
      args: { query: "hello world" },
      artifacts: [],
      result: {
        query: "hello world",
        provider: "tavily",
        results: [{ title: "result", link: "https://example.com", snippet: "snippet" }],
      },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    });

  let fetchCallCount = 0;
  globalThis.fetch = (async () => {
    fetchCallCount += 1;
    const payload = fetchCallCount === 1 ? toolCallResponse : finalResponse;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await executeDefaultChatToolLoop({
      requestedProvider: "default",
      threadId: "thread-1",
      userId: 1,
      agentEnabled: true,
      messages: [
        {
          role: "user",
          content: "hello",
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    });

    assert.equal(executeHarnessInvocationCalls, 1);
    assert.equal(result?.answer, "final answer after tool");
  } finally {
    resolveProviderForRoleSpy.mockRestore();
    executeHarnessInvocationSpy.mockRestore();
    globalThis.fetch = originalFetch;
  }
});


test("POST /proxy/chat/default routes knowledge-bound threads into the RAG branch", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const knowledgeBase = knowledgeBaseRepository.create({
    name: `KB-${crypto.randomUUID()}`,
    description: "",
    status: "active",
    chunkingConfigJson: "{}",
    metadataJson: "{}",
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Existing title",
    knowledgeBaseId: knowledgeBase.id,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalStreamChat = providerProxyService.streamChat;
  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  const originalAssistantStream = ragPipeline.assistantStream;
  const originalGetKnowledgeBaseById = knowledgeBaseService.getKnowledgeBaseById;
  let streamChatCalls = 0;
  let persistedStreamCalls = 0;
  let ragAssistantStreamCalls = 0;

  knowledgeBaseService.getKnowledgeBaseById = ((id: string) => {
    const current = originalGetKnowledgeBaseById(id);
    return current
      ? {
          ...current,
          enabledDocumentCount: Math.max(current.enabledDocumentCount, 1),
        }
      : null;
  }) as typeof knowledgeBaseService.getKnowledgeBaseById;

  providerProxyService.streamChat = () => {
    streamChatCalls += 1;
    return Readable.from(["unexpected"]);
  };
  providerProxyService.createPersistedChatStream = () => {
    persistedStreamCalls += 1;
    return Readable.from(["unexpected"]);
  };
  ragPipeline.assistantStream = (() => {
    ragAssistantStreamCalls += 1;
    return Readable.from(["data: [DONE]\n\n"]);
  }) as typeof ragPipeline.assistantStream;

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "hello rag" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.match(
      response.headers["content-type"] ?? "",
      /^text\/event-stream/i,
    );
    assert.equal(streamChatCalls, 0);
    assert.equal(persistedStreamCalls, 0);
    assert.equal(ragAssistantStreamCalls, 1);
  } finally {
    providerProxyService.streamChat = originalStreamChat;
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    ragPipeline.assistantStream = originalAssistantStream;
    knowledgeBaseService.getKnowledgeBaseById = originalGetKnowledgeBaseById;
    await app.close();
  }
}, 15_000);

test("POST /proxy/chat/default passes bound role request context into the RAG branch", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const knowledgeBase = knowledgeBaseRepository.create({
    name: `KB-${crypto.randomUUID()}`,
    description: "",
    status: "active",
    chunkingConfigJson: "{}",
    metadataJson: "{}",
  });
  const role = roleRepository.create({
    userId: user.id,
    name: "Programmer",
    summary: "Writes and verifies code carefully",
    avatarId: "pilot-helper",
    status: "active",
    tagsJson: JSON.stringify(["code"]),
    promptJson: JSON.stringify({
      description: "你是一个程序员人设。",
      worldview: "遇到可验证问题优先验证。",
      persona: "直接、克制、基于事实。",
      scenario: "",
      exampleDialogues: "",
      style: "简洁",
      constraints: "不要假装运行过代码。",
    }),
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Existing title",
    knowledgeBaseId: knowledgeBase.id,
    roleId: role.id,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalAssistantStream = ragPipeline.assistantStream;
  const originalGetKnowledgeBaseById = knowledgeBaseService.getKnowledgeBaseById;
  let capturedInput:
    | Parameters<typeof ragPipeline.assistantStream>[0]
    | null = null;
  knowledgeBaseService.getKnowledgeBaseById = ((id: string) => {
    const current = originalGetKnowledgeBaseById(id);
    return current
      ? {
          ...current,
          enabledDocumentCount: Math.max(current.enabledDocumentCount, 1),
        }
      : null;
  }) as typeof knowledgeBaseService.getKnowledgeBaseById;
  ragPipeline.assistantStream = ((input) => {
    capturedInput = input;
    return Readable.from([""]);
  }) as typeof ragPipeline.assistantStream;

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messages: [
          {
            role: "system",
            parts: [{ type: "text", text: "debug system prompt that should be ignored" }],
          },
          {
            role: "assistant",
            parts: [{ type: "text", text: "previous visible answer" }],
          },
          {
            role: "user",
            parts: [{ type: "text", text: "hello rag" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.match(
      response.headers["content-type"] ?? "",
      /^text\/event-stream/i,
    );
    assert.ok(capturedInput);
    assert.match(
      capturedInput?.requestContextMessages?.[0]?.content ?? "",
      /程序员人设|不要假装运行过代码/,
    );
    assert.deepEqual(capturedInput?.conversationHistory, [
      {
        role: "assistant",
        content: "previous visible answer",
        parts: [{ type: "text", text: "previous visible answer" }],
      },
    ]);
    assert.ok(
      !capturedInput?.conversationHistory?.some((message) =>
        /程序员人设|不要假装运行过代码/.test(message.content),
      ),
    );
  } finally {
    ragPipeline.assistantStream = originalAssistantStream;
    knowledgeBaseService.getKnowledgeBaseById = originalGetKnowledgeBaseById;
    await app.close();
  }
});

test("POST /proxy/chat/default routes non-RAG threads into persisted default chat", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Existing title",
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalStreamChat = providerProxyService.streamChat;
  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  const createAndRunAgentSpy = vi
    .spyOn(agentModule, "createAndRunAgent")
    .mockResolvedValue({
      run: null,
      output: {
        answer: "",
        observations: [],
        retrievedChunks: [],
        status: "completed",
      },
    } as never);
  let streamChatCalls = 0;
  let persistedStreamCalls = 0;
  let capturedThreadId = "";
  let capturedUserMessageId = "";

  providerProxyService.streamChat = () => {
    streamChatCalls += 1;
    return Readable.from(["unexpected"]);
  };
  providerProxyService.createPersistedChatStream = (input) => {
    persistedStreamCalls += 1;
    capturedThreadId = input.threadId;
    capturedUserMessageId = input.userMessageId;
    return Readable.from([""]);
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-message-1",
        messages: [
          {
            id: "user-message-1",
            role: "user",
            parts: [{ type: "text", text: "hello default" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(streamChatCalls, 0);
    assert.equal(persistedStreamCalls, 1);
    assert.equal(createAndRunAgentSpy.mock.calls.length, 0);
    assert.equal(capturedThreadId, thread.id);
    assert.equal(capturedUserMessageId, "user-message-1");
  } finally {
    providerProxyService.streamChat = originalStreamChat;
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    createAndRunAgentSpy.mockRestore();
    await app.close();
  }
});

test("POST /proxy/chat/default routes knowledge-bound agent sends through AgentRun instead of the legacy RAG branch", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const knowledgeBase = knowledgeBaseRepository.create({
    name: `KB-${crypto.randomUUID()}`,
    description: "",
    status: "active",
    chunkingConfigJson: "{}",
    metadataJson: "{}",
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Agent KB thread",
    knowledgeBaseId: knowledgeBase.id,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  const originalStreamTaskChatText = providerProxyService.streamTaskChatText;
  const originalAssistantStream = ragPipeline.assistantStream;
  const originalGetKnowledgeBaseById = knowledgeBaseService.getKnowledgeBaseById;
  let ragAssistantStreamCalls = 0;
  let capturedExecuteFullAnswer:
    | Parameters<typeof providerProxyService.createPersistedChatStream>[0]["executeFullAnswer"]
    | undefined;
  let capturedAgentInput:
    | Parameters<typeof agentModule.createAndRunAgent>[0]
    | null = null;

  knowledgeBaseService.getKnowledgeBaseById = ((id: string) => {
    const current = originalGetKnowledgeBaseById(id);
    return current
      ? {
          ...current,
          enabledDocumentCount: Math.max(current.enabledDocumentCount, 1),
        }
      : null;
  }) as typeof knowledgeBaseService.getKnowledgeBaseById;

  providerProxyService.createPersistedChatStream = (input) => {
    capturedExecuteFullAnswer = input.executeFullAnswer;
    return Readable.from([""]);
  };
  providerProxyService.streamTaskChatText = async function* () {
    yield "知识库 Agent 标题";
  };
  ragPipeline.assistantStream = (() => {
    ragAssistantStreamCalls += 1;
    return Readable.from(["unexpected"]);
  }) as typeof ragPipeline.assistantStream;
  const createAndRunAgentSpy = vi
    .spyOn(agentModule, "createAndRunAgent")
    .mockImplementation(async (input) => {
    capturedAgentInput = input;
    return {
      run: {
        id: "agent-run-1",
        threadId: input.threadId,
        userId: input.userId,
        goal: {
          id: "goal-1",
          text: input.goalText,
          successCriteria: [],
          constraints: [],
          riskLevel: "low",
        },
        plan: {
          id: "plan-1",
          goalId: "goal-1",
          version: 1,
          steps: [],
        },
        status: "completed",
        observations: [],
        traceId: "trace-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      output: {
        answer: "agent answer",
        observations: [],
        retrievedChunks: [],
        status: "completed",
      },
    };
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-agent-kb-1",
        agentEnabled: true,
        messages: [
          {
            id: "user-agent-kb-1",
            role: "user",
            parts: [{ type: "text", text: "请用知识库回答我" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(ragAssistantStreamCalls, 0);
    assert.ok(capturedExecuteFullAnswer);

    const answer = await capturedExecuteFullAnswer?.({
      emitToolEvent: async () => {},
      emitExecutionNode: async () => {},
    });

    assert.equal(answer?.answer, "agent answer");
    assert.ok(capturedAgentInput);
    assert.equal(capturedAgentInput?.threadId, thread.id);
    assert.equal(capturedAgentInput?.knowledgeBaseId, knowledgeBase.id);
    assert.equal(capturedAgentInput?.goalText, "请用知识库回答我");
    assert.equal(capturedAgentInput?.messages.length, 1);
    assert.equal(capturedAgentInput?.messages[0]?.role, "user");
    assert.equal(capturedAgentInput?.requestContextMessages?.length ?? 0, 0);
    const expectedPrivateRoot = threadService.getEffectiveAgentWorkspaceRoot(
      thread.id,
      user.id,
    );
    assert.ok(expectedPrivateRoot);
    assert.equal(capturedAgentInput?.workspaceRoot, expectedPrivateRoot);
    assert.equal(
      threadService.getThreadSummaryById(thread.id, user.id)?.workspaceId,
      null,
    );
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    providerProxyService.streamTaskChatText = originalStreamTaskChatText;
    ragPipeline.assistantStream = originalAssistantStream;
    knowledgeBaseService.getKnowledgeBaseById = originalGetKnowledgeBaseById;
    createAndRunAgentSpy.mockRestore();
    await app.close();
  }
});

test("POST /proxy/chat/default passes agentEnabled true into createAndRunAgent", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Agent enabled thread",
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  const originalStreamTaskChatText = providerProxyService.streamTaskChatText;
  let capturedExecuteFullAnswer:
    | Parameters<typeof providerProxyService.createPersistedChatStream>[0]["executeFullAnswer"]
    | undefined;
  const createAndRunAgentSpy = vi
    .spyOn(agentModule, "createAndRunAgent")
    .mockResolvedValue({
      run: {
        id: "agent-run-1",
        threadId: thread.id,
        userId: user.id,
        goal: {
          id: "goal-1",
          text: "帮我回答",
          successCriteria: [],
          constraints: [],
          riskLevel: "low",
        },
        plan: {
          id: "plan-1",
          goalId: "goal-1",
          version: 1,
          steps: [],
        },
        status: "completed",
        observations: [],
        traceId: "trace-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      output: {
        answer: "agent answer",
        observations: [],
        retrievedChunks: [],
        status: "completed",
      },
    } as never);
  providerProxyService.createPersistedChatStream = (input) => {
    capturedExecuteFullAnswer = input.executeFullAnswer;
    return Readable.from([""]);
  };
  providerProxyService.streamTaskChatText = async function* () {
    yield "Agent 标题";
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-agent-1",
        agentEnabled: true,
        messages: [
          {
            id: "user-agent-1",
            role: "user",
            parts: [{ type: "text", text: "帮我回答" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.ok(capturedExecuteFullAnswer);
    const answer = await capturedExecuteFullAnswer?.({
      emitToolEvent: async () => {},
      emitExecutionNode: async () => {},
    });

    assert.equal(answer?.answer, "agent answer");
    assert.equal(createAndRunAgentSpy.mock.calls.length, 1);
    assert.equal(createAndRunAgentSpy.mock.calls[0]?.[0].threadId, thread.id);
    assert.equal(createAndRunAgentSpy.mock.calls[0]?.[0].goalText, "帮我回答");
    assert.equal(createAndRunAgentSpy.mock.calls[0]?.[0].messages.length, 1);
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    providerProxyService.streamTaskChatText = originalStreamTaskChatText;
    createAndRunAgentSpy.mockRestore();
    await app.close();
  }
});

test("POST /proxy/chat/default passes bound thread workspaceRoot into createAndRunAgent", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const workspaceRoot = os.platform() === "win32"
    ? "D:\\testData"
    : "/tmp/test-data";
  const workspace = threadService.createChatWorkspace({
    userId: user.id,
    name: "PW Test",
    rootPath: workspaceRoot,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Agent workspace thread",
    agentEnabled: true,
    workspaceId: workspace.id,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  const originalStreamTaskChatText = providerProxyService.streamTaskChatText;
  let capturedExecuteFullAnswer:
    | Parameters<typeof providerProxyService.createPersistedChatStream>[0]["executeFullAnswer"]
    | undefined;
  const createAndRunAgentSpy = vi
    .spyOn(agentModule, "createAndRunAgent")
    .mockResolvedValue({
      run: {
        id: "agent-run-workspace-1",
        threadId: thread.id,
        userId: user.id,
        goal: {
          id: "goal-workspace-1",
          text: "看看当前 workspace 有哪些文件",
          successCriteria: [],
          constraints: [],
          riskLevel: "low",
        },
        plan: {
          id: "plan-workspace-1",
          goalId: "goal-workspace-1",
          version: 1,
          steps: [],
        },
        status: "completed",
        observations: [],
        traceId: "trace-workspace-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      output: {
        answer: "agent answer",
        observations: [],
        retrievedChunks: [],
        status: "completed",
      },
    } as never);
  providerProxyService.createPersistedChatStream = (input) => {
    capturedExecuteFullAnswer = input.executeFullAnswer;
    return Readable.from([""]);
  };
  providerProxyService.streamTaskChatText = async function* () {
    yield "Agent 工作空间标题";
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-agent-workspace-1",
        agentEnabled: true,
        messages: [
          {
            id: "user-agent-workspace-1",
            role: "user",
            parts: [{ type: "text", text: "看看当前 workspace 有哪些文件" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.ok(capturedExecuteFullAnswer);
    const answer = await capturedExecuteFullAnswer?.({
      emitToolEvent: async () => {},
      emitExecutionNode: async () => {},
    });

    assert.equal(answer?.answer, "agent answer");
    assert.equal(createAndRunAgentSpy.mock.calls.length, 1);
    assert.equal(
      createAndRunAgentSpy.mock.calls[0]?.[0].workspaceRoot,
      workspaceRoot,
    );
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    providerProxyService.streamTaskChatText = originalStreamTaskChatText;
    createAndRunAgentSpy.mockRestore();
    await app.close();
  }
});

test("POST /proxy/chat/default fails closed when an explicit Agent workspace has no root", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const workspace = threadService.createChatWorkspace({
    userId: user.id,
    name: "Unavailable Workspace",
    rootPath: os.platform() === "win32" ? "D:\\unavailable-root" : "/tmp/unavailable-root",
  });
  threadService.updateChatWorkspace(workspace.id, user.id, { rootPath: null });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Unavailable Agent workspace",
    agentEnabled: true,
    workspaceId: workspace.id,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);
  const createAndRunAgentSpy = vi.spyOn(agentModule, "createAndRunAgent");

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-agent-workspace-missing-root",
        agentEnabled: true,
        messages: [
          {
            id: "user-agent-workspace-missing-root",
            role: "user",
            parts: [{ type: "text", text: "看看当前 workspace" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.body, /Agent workspace is unavailable/);
    assert.equal(createAndRunAgentSpy.mock.calls.length, 0);
  } finally {
    createAndRunAgentSpy.mockRestore();
    await app.close();
  }
});

test("POST /proxy/chat/default persists agent metadata on completed agent responses", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Agent completed thread",
    agentEnabled: true,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalStreamTaskChatText = providerProxyService.streamTaskChatText;
  providerProxyService.streamTaskChatText = async function* () {
    yield "完成标题";
  };
  const createAndRunAgentSpy = vi
    .spyOn(agentModule, "createAndRunAgent")
    .mockImplementation(async (input) => {
      // The real runtime persists the assistant message; the stub must keep
      // that contract or the route-level persistence assertions are vacuous.
      persistAssistantMessage({
        threadId: input.threadId,
        userId: input.userId,
        assistantMessageId: input.assistantMessageId ?? crypto.randomUUID(),
        parentId: input.assistantParentId ?? null,
        content: "agent answer",
        parts: [{ type: "text", text: "agent answer" }],
        metadata: {
          agent: {
            status: "completed",
            runId: "agent-run-2",
            traceId: "trace-2",
          },
        },
      });
      return {
      run: {
        id: "agent-run-2",
        threadId: thread.id,
        userId: user.id,
        goal: {
          id: "goal-2",
          text: "帮我回答",
          successCriteria: [],
          constraints: [],
          riskLevel: "low",
        },
        plan: {
          id: "plan-2",
          goalId: "goal-2",
          version: 1,
          steps: [],
        },
        status: "completed",
        observations: [],
        traceId: "trace-2",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      output: {
        answer: "agent answer",
        observations: [],
        retrievedChunks: [],
        status: "completed",
      },
      } as never;
    });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-agent-completed-1",
        agentEnabled: true,
        messages: [
          {
            id: "user-agent-completed-1",
            role: "user",
            parts: [{ type: "text", text: "帮我回答" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(createAndRunAgentSpy.mock.calls.length, 1);

    const persistedThread = threadService.getThreadById(thread.id, user.id);
    const assistantMessage = persistedThread?.messages.at(-1);
    assert.equal(assistantMessage?.role, "assistant");
    assert.equal(assistantMessage?.content, "agent answer");
    assert.equal(
      (assistantMessage?.metadata?.agent as { status?: string } | undefined)?.status,
      "completed",
    );
    assert.equal(
      (assistantMessage?.metadata?.agent as { runId?: string } | undefined)?.runId,
      "agent-run-2",
    );
    assert.equal(
      (assistantMessage?.metadata?.agent as { traceId?: string } | undefined)?.traceId,
      "trace-2",
    );
    assert.equal(persistedThread?.messages.filter((message) => message.role === "assistant").length, 1);
  } finally {
    providerProxyService.streamTaskChatText = originalStreamTaskChatText;
    createAndRunAgentSpy.mockRestore();
    await app.close();
  }
});

test("POST /proxy/chat/default does not block stream finish on async title generation", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "新对话",
    agentEnabled: true,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalStreamTaskChatText = providerProxyService.streamTaskChatText;
  providerProxyService.streamTaskChatText = async function* () {
    await new Promise<void>(() => {});
    yield "不会到这里";
  };
  const createAndRunAgentSpy = vi
    .spyOn(agentModule, "createAndRunAgent")
    .mockImplementation(async (input) => {
      // Keep the runtime persistence contract so the assertions below observe
      // a real assistant message instead of a stub that writes nothing.
      persistAssistantMessage({
        threadId: input.threadId,
        userId: input.userId,
        assistantMessageId: input.assistantMessageId ?? crypto.randomUUID(),
        parentId: input.assistantParentId ?? null,
        content: "agent answer",
        parts: [{ type: "text", text: "agent answer" }],
        metadata: {
          agent: {
            status: "completed",
            runId: "agent-run-async-title",
            traceId: "trace-async-title",
          },
        },
      });
      return {
      run: {
        id: "agent-run-async-title",
        threadId: thread.id,
        userId: user.id,
        goal: {
          id: "goal-async-title",
          text: "hi",
          successCriteria: [],
          constraints: [],
          riskLevel: "low",
        },
        plan: {
          id: "plan-async-title",
          goalId: "goal-async-title",
          version: 1,
          steps: [],
        },
        status: "completed",
        observations: [],
        traceId: "trace-async-title",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      output: {
        answer: "agent answer",
        observations: [],
        retrievedChunks: [],
        status: "completed",
      },
      } as never;
    });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-agent-async-title-1",
        agentEnabled: true,
        messages: [
          {
            id: "user-agent-async-title-1",
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.body, /"type":"text-delta".*"delta":"agent answer"/);
    assert.match(response.body, /"type":"text-end"/);
    assert.match(response.body, /"type":"finish","finishReason":"stop"/);
    assert.match(response.body, /\[DONE\]/);

    const persistedThread = threadService.getThreadById(thread.id, user.id);
    const assistantMessage = persistedThread?.messages.at(-1);
    assert.equal(assistantMessage?.role, "assistant");
    assert.equal(assistantMessage?.content, "agent answer");
    assert.equal(createAndRunAgentSpy.mock.calls.length, 1);
  } finally {
    providerProxyService.streamTaskChatText = originalStreamTaskChatText;
    createAndRunAgentSpy.mockRestore();
    await app.close();
  }
});

test("POST /proxy/chat/default injects agent execution environment into request-only context", async () => {
  clearHarnessRegistry();
  resetHarnessRuntime();
  initializeHarnessRuntime();

  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Agent environment thread",
    agentEnabled: true,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  let capturedMessages:
    | Parameters<typeof providerProxyService.createPersistedChatStream>[0]["messages"]
    | null = null;
  providerProxyService.createPersistedChatStream = (input) => {
    capturedMessages = input.messages;
    return Readable.from([""]);
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-agent-env-1",
        messages: [
          {
            id: "user-agent-env-1",
            role: "user",
            parts: [{ type: "text", text: "帮我看看当前文件夹有哪些文件" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.ok(capturedMessages);
    assert.equal(capturedMessages?.[0]?.role, "system");
    assert.match(capturedMessages?.[0]?.content ?? "", /当前执行平台：/);
    assert.match(capturedMessages?.[0]?.content ?? "", /当前 shell：/);
    assert.match(capturedMessages?.[0]?.content ?? "", /当前可用工具：/);
    const expectedPrivateRoot = threadService.getEffectiveAgentWorkspaceRoot(
      thread.id,
      user.id,
    );
    assert.ok(expectedPrivateRoot);
    assert.ok((capturedMessages?.[0]?.content ?? "").includes(expectedPrivateRoot));
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    await app.close();
  }
});

test("POST /proxy/chat/default prepends thread context summary as a system request message", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Summary thread",
    contextSummary: "用户偏好简洁回答，并且当前正在改 shared node。",
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  let capturedMessages:
    | Parameters<typeof providerProxyService.createPersistedChatStream>[0]["messages"]
    | null = null;
  let capturedParams:
    | Parameters<typeof providerProxyService.createPersistedChatStream>[0]["params"]
    | null = null;
  providerProxyService.createPersistedChatStream = (input) => {
    capturedMessages = input.messages;
    capturedParams = input.params ?? null;
    return Readable.from([""]);
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-summary-1",
        messages: [
          {
            id: "user-summary-1",
            role: "user",
            parts: [{ type: "text", text: "继续说下去" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.ok(capturedMessages);
    assert.equal(capturedMessages?.[0]?.role, "system");
    assert.match(
      capturedMessages?.[0]?.content ?? "",
      /线程摘要|用户偏好简洁回答/,
    );
    assert.equal(capturedMessages?.[1]?.role, "user");
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    await app.close();
  }
});

test("POST /proxy/chat/default prepends bound role prompt before visible messages", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const role = roleRepository.create({
    userId: user.id,
    name: "Programmer",
    summary: "Writes and verifies code carefully",
    avatarId: "pilot-helper",
    status: "active",
    tagsJson: JSON.stringify(["code"]),
    promptJson: JSON.stringify({
      description: "你是一个程序员人设。",
      worldview: "遇到可验证问题优先验证。",
      persona: "直接、克制、基于事实。",
      scenario: "",
      exampleDialogues: "",
      style: "简洁",
      constraints: "不要假装运行过代码。",
    }),
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Role thread",
    roleId: role.id,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  let capturedMessages:
    | Parameters<typeof providerProxyService.createPersistedChatStream>[0]["messages"]
    | null = null;
  providerProxyService.createPersistedChatStream = (input) => {
    capturedMessages = input.messages;
    return Readable.from([""]);
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-role-1",
        messages: [
          {
            id: "user-role-1",
            role: "user",
            parts: [{ type: "text", text: "帮我分析一下这段代码" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.ok(capturedMessages);
    assert.equal(capturedMessages?.[0]?.role, "system");
    assert.match(capturedMessages?.[0]?.content ?? "", /程序员人设|不要假装运行过代码/);
    assert.equal(capturedMessages?.at(-1)?.role, "user");
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    await app.close();
  }
});

test("POST /proxy/chat/default applies bound role llmProfile to the default chat invocation", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const role = roleRepository.create({
    userId: user.id,
    name: "Focused Programmer",
    summary: "Uses restrained generation parameters",
    avatarId: "pilot-helper",
    status: "active",
    tagsJson: JSON.stringify(["code"]),
    promptJson: JSON.stringify({
      description: "你是一个程序员人设。",
      worldview: "",
      persona: "",
      scenario: "",
      exampleDialogues: "",
      style: "",
      constraints: "",
    }),
    llmProfileJson: JSON.stringify({
      temperature: 0.1,
      topP: 0.7,
      topK: 12,
      maxTokens: 640,
    }),
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Role model profile thread",
    roleId: role.id,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  let capturedParams:
    | Parameters<typeof providerProxyService.createPersistedChatStream>[0]["params"]
    | null = null;
  providerProxyService.createPersistedChatStream = (input) => {
    capturedParams = input.params ?? null;
    return Readable.from([""]);
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-role-profile-1",
        messages: [
          {
            id: "user-role-profile-1",
            role: "user",
            parts: [{ type: "text", text: "给我一个简洁答案" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(capturedParams, {
      temperature: 0.1,
      topP: 0.7,
      topK: 12,
      maxTokens: 640,
    });
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    await app.close();
  }
});

test("POST /proxy/chat/default passes thread requestContextMessages into createAndRunAgent", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const role = roleRepository.create({
    userId: user.id,
    name: "Programmer",
    summary: "Writes and verifies code carefully",
    avatarId: "pilot-helper",
    status: "active",
    tagsJson: JSON.stringify(["code"]),
    promptJson: JSON.stringify({
      description: "你是一个程序员人设。",
      worldview: "",
      persona: "",
      scenario: "",
      exampleDialogues: "",
      style: "",
      constraints: "不要假装运行过代码。",
    }),
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Agent role summary thread",
    roleId: role.id,
    contextSummary: "用户当前正在排查 request context 注入顺序。",
    agentEnabled: true,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  const originalStreamTaskChatText = providerProxyService.streamTaskChatText;
  let capturedExecuteFullAnswer:
    | Parameters<typeof providerProxyService.createPersistedChatStream>[0]["executeFullAnswer"]
    | undefined;
  let capturedAgentInput:
    | Parameters<typeof agentModule.createAndRunAgent>[0]
    | null = null;

  providerProxyService.createPersistedChatStream = (input) => {
    capturedExecuteFullAnswer = input.executeFullAnswer;
    return Readable.from([""]);
  };
  providerProxyService.streamTaskChatText = async function* () {
    yield "Agent 标题";
  };
  const createAndRunAgentSpy = vi
    .spyOn(agentModule, "createAndRunAgent")
    .mockImplementation(async (input) => {
      capturedAgentInput = input;
      return {
        run: {
          id: "agent-run-context-1",
          threadId: input.threadId,
          userId: input.userId,
          goal: {
            id: "goal-context-1",
            text: input.goalText,
            successCriteria: [],
            constraints: [],
            riskLevel: "low",
          },
          plan: {
            id: "plan-context-1",
            goalId: "goal-context-1",
            version: 1,
            steps: [],
          },
          status: "completed",
          observations: [],
          traceId: "trace-context-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        output: {
          answer: "agent answer",
          observations: [],
          retrievedChunks: [],
          status: "completed",
        },
      };
    });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-agent-context-1",
        agentEnabled: true,
        messages: [
          {
            id: "user-agent-context-1",
            role: "user",
            parts: [{ type: "text", text: "继续帮我排查这个问题" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.ok(capturedExecuteFullAnswer);

    const answer = await capturedExecuteFullAnswer?.({
      emitToolEvent: async () => {},
      emitExecutionNode: async () => {},
    });

    assert.equal(answer?.answer, "agent answer");
    assert.ok(capturedAgentInput);
    assert.equal(capturedAgentInput?.requestContextMessages?.length, 3);
    assert.match(
      capturedAgentInput?.requestContextMessages?.[0]?.content ?? "",
      /程序员人设|不要假装运行过代码/,
    );
    assert.match(
      capturedAgentInput?.requestContextMessages?.[1]?.content ?? "",
      /线程摘要|request context 注入顺序/,
    );
    assert.match(
      capturedAgentInput?.requestContextMessages?.[2]?.content ?? "",
      /智能体模式|当前执行平台：/,
    );
    assert.equal(
      capturedAgentInput?.requestContextMessages?.[2]?.requestContextScope,
      "agent-execution",
    );
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    providerProxyService.streamTaskChatText = originalStreamTaskChatText;
    createAndRunAgentSpy.mockRestore();
    await app.close();
  }
});

test("POST /proxy/chat/default persists canonical image parts for default chat threads", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Image thread",
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;

  providerProxyService.createPersistedChatStream = () => Readable.from([""]);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-image-1",
        messages: [
          {
            id: "user-image-1",
            role: "user",
            parts: [
              { type: "text", text: "这是什么图？" },
              {
                type: "image",
                image: "/attachments/test-image.webp",
                filename: "test-image.webp",
                fileId: "file-1",
                mediaType: "image/webp",
              },
            ],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);

    const persistedThread = threadService.getThreadById(thread.id, user.id);
    const persistedUserMessage = persistedThread?.messages.find(
      (message) => message.id === "user-image-1",
    );

    assert.ok(persistedUserMessage);
    assert.equal(persistedUserMessage?.parts.length, 2);
    assert.deepEqual(persistedUserMessage?.parts[1], {
      type: "image",
      image: "/attachments/test-image.webp",
      filename: "test-image.webp",
      fileId: "file-1",
      mediaType: "image/webp",
    });
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    await app.close();
  }
});

test("POST /proxy/chat/default persists assistant answers after image user messages", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Image answer thread",
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalGenerateTextForRole = providerProxyService.generateTextForRole;
  providerProxyService.generateTextForRole = async () => "assistant reply";

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-image-answer-1",
        messages: [
          {
            id: "user-image-answer-1",
            role: "user",
            parts: [
              { type: "text", text: "这是什么图？" },
              {
                type: "image",
                image: "/attachments/test-image-answer.webp",
                filename: "test-image-answer.webp",
                fileId: "file-answer-1",
                mediaType: "image/webp",
              },
            ],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);

    const persistedThread = threadService.getThreadById(thread.id, user.id);
    const assistantMessage = persistedThread?.messages.find(
      (message) => message.role === "assistant",
    );

    assert.ok(assistantMessage);
    assert.equal(assistantMessage?.content, "assistant reply");
    assert.equal(assistantMessage?.parts.at(0)?.type, "text");
  } finally {
    providerProxyService.generateTextForRole = originalGenerateTextForRole;
    await app.close();
  }
});

test("POST /proxy/chat/default emits an explicit error when default chat returns empty text", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Empty answer thread",
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalGenerateTextForRole = providerProxyService.generateTextForRole;
  providerProxyService.generateTextForRole = async () => "";

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-empty-answer-1",
        messages: [
          {
            id: "user-empty-answer-1",
            role: "user",
            parts: [{ type: "text", text: "hello default" }],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.body, /Model returned empty assistant response/);
    assert.match(response.body, /"finishReason":"error"/);

    const persistedThread = threadService.getThreadById(thread.id, user.id);
    const assistantMessages =
      persistedThread?.messages.filter((message) => message.role === "assistant") ?? [];

    assert.equal(assistantMessages.length, 0);
  } finally {
    providerProxyService.generateTextForRole = originalGenerateTextForRole;
    await app.close();
  }
});

test("POST /proxy/chat/default does not misroute pure image messages away from persisted default chat on non-RAG threads", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Pure image default thread",
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  providerProxyService.createPersistedChatStream = () => Readable.from([""]);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-image-default-1",
        messages: [
          {
            id: "user-image-default-1",
            role: "user",
            parts: [
              {
                type: "image",
                image: "/attachments/default-only.webp",
                filename: "default-only.webp",
                fileId: "default-image-1",
                mediaType: "image/webp",
              },
            ],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);

    const persistedThread = threadService.getThreadById(thread.id, user.id);
    const persistedUserMessage = persistedThread?.messages.find(
      (message) => message.id === "user-image-default-1",
    );

    assert.ok(persistedUserMessage);
    assert.equal(persistedUserMessage?.content, "");
    assert.equal(persistedUserMessage?.parts.length, 1);
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    await app.close();
  }
});

test("POST /proxy/chat/default preserves pure image user messages with empty content", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Pure image thread",
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalPersistedStream = providerProxyService.createPersistedChatStream;
  providerProxyService.createPersistedChatStream = () => Readable.from([""]);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-image-only-1",
        messages: [
          {
            id: "user-image-only-1",
            role: "user",
            parts: [
              {
                type: "image",
                image: "/attachments/test-image-only.webp",
                filename: "test-image-only.webp",
                fileId: "file-image-only",
                mediaType: "image/webp",
              },
            ],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);

    const persistedThread = threadService.getThreadById(thread.id, user.id);
    const persistedUserMessage = persistedThread?.messages.find(
      (message) => message.id === "user-image-only-1",
    );

    assert.ok(persistedUserMessage);
    assert.equal(persistedUserMessage?.content, "");
    assert.equal(persistedUserMessage?.parts.length, 1);
    assert.deepEqual(persistedUserMessage?.parts[0], {
      type: "image",
      image: "/attachments/test-image-only.webp",
      filename: "test-image-only.webp",
      fileId: "file-image-only",
      mediaType: "image/webp",
    });
  } finally {
    providerProxyService.createPersistedChatStream = originalPersistedStream;
    await app.close();
  }
});

test("POST /proxy/chat/default generates a thread title for pure image messages", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "新对话",
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalGenerateTextForRole = providerProxyService.generateTextForRole;
  const originalStreamTaskChatText = providerProxyService.streamTaskChatText;
  providerProxyService.generateTextForRole = async () => "这是一只猫";
  providerProxyService.streamTaskChatText = async function* () {
    yield "猫咪图片";
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-image-title-1",
        messages: [
          {
            id: "user-image-title-1",
            role: "user",
            parts: [
              {
                type: "image",
                image: "/attachments/title-only.webp",
                filename: "title-only.webp",
                fileId: "title-image-1",
                mediaType: "image/webp",
              },
            ],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);

    const persistedThread = threadService.getThreadById(thread.id, user.id);
    assert.equal(persistedThread?.title, "猫咪图片");
  } finally {
    providerProxyService.generateTextForRole = originalGenerateTextForRole;
    providerProxyService.streamTaskChatText = originalStreamTaskChatText;
    await app.close();
  }
});

test("POST /proxy/chat/default falls back to the user's first sentence when task title generation fails", async () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "新对话",
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const app = await createAuthedApp(user);

  const originalGenerateTextForRole = providerProxyService.generateTextForRole;
  const originalStreamTaskChatText = providerProxyService.streamTaskChatText;
  providerProxyService.generateTextForRole = async () => "主回复正常";
  providerProxyService.streamTaskChatText = async function* () {
    throw new Error("task model unavailable");
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/proxy/chat/default",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        id: thread.id,
        messageId: "user-title-fallback-1",
        messages: [
          {
            id: "user-title-fallback-1",
            role: "user",
            parts: [
              {
                type: "text",
                text: "第一句标题。第二句不该进标题",
              },
            ],
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);

    const persistedThread = threadService.getThreadById(thread.id, user.id);
    assert.equal(persistedThread?.title, "第一句标题。");
  } finally {
    providerProxyService.generateTextForRole = originalGenerateTextForRole;
    providerProxyService.streamTaskChatText = originalStreamTaskChatText;
    await app.close();
  }
});
