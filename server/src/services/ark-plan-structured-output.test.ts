import assert from "node:assert/strict";
import { describe, test } from "vitest";

import type { ProviderResolution } from "./provider-proxy.service/types.js";
import {
  generateArkPlanStructuredOutput,
  isArkPlanStructuredOutputProvider,
  streamArkPlanStructuredOutputText,
  type ArkPlanStructuredOutputInput,
} from "./ark-plan-structured-output.js";

const input: ArkPlanStructuredOutputInput = {
  messages: [
    {
      id: "system",
      role: "system",
      content: "Return one decision object.",
      parts: [],
    },
    {
      id: "user",
      role: "user",
      content: "Inspect the repository.",
      parts: [],
    },
  ],
  schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["answer"] },
      reason: { type: "string" },
    },
    required: ["type", "reason"],
    additionalProperties: false,
  },
  name: "planner_decision",
  description: "One Planner decision.",
};

const createResolution = (
  providerTemplateCode:
    | "volcengine-code-plan"
    | "volcengine-agent-plan"
    | "openai",
): ProviderResolution => ({
  providerCode: providerTemplateCode === "openai" ? "openai" : "volcengine",
  providerConnectionId: providerTemplateCode,
  providerTemplateCode,
  baseUrl:
    providerTemplateCode === "volcengine-code-plan"
      ? "https://ark.cn-beijing.volces.com/api/coding/v3"
      : providerTemplateCode === "volcengine-agent-plan"
        ? "https://ark.cn-beijing.volces.com/api/plan/v3"
        : "https://api.openai.com/v1",
  apiKey: "secret-key",
  model: "ark-code-latest",
  modelConfigId: `${providerTemplateCode}-model`,
  // The Ark agentTask adapter must override any model-level thinking setting.
  params: { temperature: 0.1, thinking: true },
});

const createJsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

describe("Ark Plan structured output adapter", () => {
  test.each([
    ["volcengine-code-plan", "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions"],
    ["volcengine-agent-plan", "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions"],
  ] as const)(
    "buffers strict structured output for %s",
    async (providerTemplateCode, expectedUrl) => {
      let captured: { url: string; init?: RequestInit } | undefined;
      const result = await generateArkPlanStructuredOutput<{
        type: string;
        reason: string;
      }>(createResolution(providerTemplateCode), input, async (request, init) => {
        captured = { url: String(request), init };
        return createJsonResponse({
          choices: [
            {
              message: {
                content: '{"type":"answer","reason":"done"}',
              },
            },
          ],
        });
      });

      assert.deepEqual(result, { type: "answer", reason: "done" });
      assert.equal(captured?.url, expectedUrl);
      const requestBody = JSON.parse(String(captured?.init?.body)) as Record<
        string,
        unknown
      >;
      assert.equal(requestBody.stream, false);
      assert.equal(requestBody.model, "ark-code-latest");
      assert.equal(requestBody.temperature, 0.1);
      assert.deepEqual(requestBody.thinking, { type: "disabled" });
      assert.deepEqual(requestBody.response_format, {
        type: "json_schema",
        json_schema: {
          name: input.name,
          description: input.description,
          strict: true,
          schema: input.schema,
        },
      });
    },
  );

  test("yields one complete JSON object instead of provider stream fragments", async () => {
    const chunks: string[] = [];
    const stream = streamArkPlanStructuredOutputText(
      createResolution("volcengine-agent-plan"),
      input,
      async () =>
        createJsonResponse({
          choices: [
            {
              message: {
                content: '{"type":"answer","reason":"complete"}',
              },
            },
          ],
        }),
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, [
      '{"type":"answer","reason":"complete"}',
    ]);
  });

  test("rejects an unsupported native response before emitting fallback-blocking output", async () => {
    const stream = streamArkPlanStructuredOutputText(
      createResolution("volcengine-code-plan"),
      input,
      async () =>
        createJsonResponse(
          { error: { message: "response_format is not supported" } },
          { status: 400 },
        ),
    );

    await assert.rejects(
      stream.next(),
      /Ark code-plan structured output failed: 400 response_format is not supported/,
    );
  });

  test("keeps invalid JSON as one native result for the Planner adapter boundary", async () => {
    const stream = streamArkPlanStructuredOutputText(
      createResolution("volcengine-agent-plan"),
      input,
      async () =>
        createJsonResponse({
          choices: [{ message: { content: "not-json" } }],
        }),
    );

    assert.deepEqual(await stream.next(), { value: "not-json", done: false });
    assert.deepEqual(await stream.next(), { value: undefined, done: true });
  });

  test("only claims the two Ark Plan connection templates", () => {
    assert.equal(
      isArkPlanStructuredOutputProvider(
        createResolution("volcengine-code-plan"),
      ),
      true,
    );
    assert.equal(
      isArkPlanStructuredOutputProvider(
        createResolution("volcengine-agent-plan"),
      ),
      true,
    );
    assert.equal(
      isArkPlanStructuredOutputProvider(createResolution("openai")),
      false,
    );
  });
});
