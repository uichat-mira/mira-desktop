import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  getEmbeddingInvocationUrl,
  providerProxyService,
} from "./index.js";
import { __streamNormalizerTestUtils } from "./stream-normalizer.js";
import type { ProviderResolution } from "./types.js";

test("getEmbeddingInvocationUrl reports Cloudflare native run endpoint", () => {
  const resolved: ProviderResolution = {
    providerCode: "cloudflare",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1",
    apiKey: "secret",
    model: "@cf/baai/bge-base-en-v1.5",
    modelConfigId: "cfg-embedding",
    params: {},
  };

  assert.equal(
    getEmbeddingInvocationUrl(resolved),
    "https://api.cloudflare.com/client/v4/accounts/account-1/ai/run/@cf/baai/bge-base-en-v1.5",
  );
});

test("createPersistedChatStream emits tool lifecycle events before the final answer", async () => {
  const chunks: string[] = [];

  const stream = providerProxyService.createPersistedChatStream({
    requestedProvider: "default",
    threadId: "thread-1",
    userId: 1,
    userMessageId: "user-1",
    assistantMessageId: "assistant-1",
    messages: [{ role: "user", content: "hello" }],
    executeFullAnswer: async ({ emitToolEvent }) => {
      await emitToolEvent({
        toolName: "web_search",
        status: "requested",
        input: { query: "hello" },
      });
      await emitToolEvent({
        toolName: "web_search",
        status: "succeeded",
        output: { resultCount: 1 },
      });
      return "final answer";
    },
  });

  for await (const chunk of stream) {
    chunks.push(String(chunk));
  }

  assert.ok(
    chunks.some(
      (chunk) =>
        chunk.includes('"type":"data-tool-event"') &&
        chunk.includes('"status":"requested"'),
    ),
  );
  assert.ok(
    chunks.some(
      (chunk) =>
        chunk.includes('"type":"data-tool-event"') &&
        chunk.includes('"status":"succeeded"'),
    ),
  );
  assert.ok(
    chunks.some(
      (chunk) =>
        chunk.includes('"type":"text-delta"') &&
        chunk.includes('"final answer"'),
    ),
  );
});

test("createPersistedChatStream emits execution node events before the final answer", async () => {
  const chunks: string[] = [];

  const stream = providerProxyService.createPersistedChatStream({
    requestedProvider: "default",
    threadId: "thread-1",
    userId: 1,
    userMessageId: "user-1",
    assistantMessageId: "assistant-1",
    messages: [{ role: "user", content: "hello" }],
    executeFullAnswer: async ({ emitExecutionNode }) => {
      await emitExecutionNode({
        nodeId: "tool-1",
        nodeType: "tool",
        phase: "start",
        label: "web_search",
        summary: "Running web_search",
      });
      await emitExecutionNode({
        nodeId: "tool-1",
        nodeType: "tool",
        phase: "done",
        label: "web_search",
        summary: "web_search completed",
      });
      return "final answer";
    },
  });

  for await (const chunk of stream) {
    chunks.push(String(chunk));
  }

  const firstExecutionNodeIndex = chunks.findIndex((chunk) =>
    chunk.includes('"type":"data-execution-node"'),
  );
  const textDeltaIndex = chunks.findIndex(
    (chunk) =>
      chunk.includes('"type":"text-delta"') &&
      chunk.includes('"final answer"'),
  );

  assert.notEqual(firstExecutionNodeIndex, -1);
  assert.notEqual(textDeltaIndex, -1);
  assert.ok(firstExecutionNodeIndex < textDeltaIndex);
});

test("chat stream filters think blocks even when tags span deltas", () => {
  const filter = new __streamNormalizerTestUtils.ThinkTagFilter();
  const visible = [
    ...filter.push("before <thi"),
    ...filter.push("nk>private reasoning"),
    ...filter.push("</think> after"),
    ...filter.finish(),
  ].join("");

  assert.equal(visible, "before  after");
});

test("chat stream preserves ordinary text and think-tag attributes", () => {
  const filter = new __streamNormalizerTestUtils.ThinkTagFilter();
  const visible = [
    ...filter.push("<think type=\"hidden\">secret</think>Answer"),
    ...filter.finish(),
  ].join("");

  assert.equal(visible, "Answer");
});
