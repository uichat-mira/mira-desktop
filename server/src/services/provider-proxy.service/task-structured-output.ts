import { Ollama } from "ollama";

import {
  getPlannerStructuredOutputAdapter,
  type PlannerStructuredOutputAdapter,
} from "@/providers/catalog.js";
import {
  generateArkPlanStructuredOutput,
  streamArkPlanStructuredOutputText,
} from "@/services/ark-plan-structured-output.js";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol.js";
import { assertOllamaModelAvailable, resolveAgentTaskProvider } from "./resolution.js";
import { toOllamaChatOptions } from "./params.js";
import type { ProviderResolution } from "./types.js";

export type TaskStructuredOutputInput = {
  messages: NormalizedChatMessage[];
  schema: Record<string, unknown>;
  name: string;
  description?: string;
};

const parseStructuredJson = <T>(text: string): T => {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error("Structured task model returned an empty response.");
  }
  const parsed = JSON.parse(normalized) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Structured task model response must be one JSON object.");
  }
  return parsed as T;
};

const toTextOnlyMessages = (messages: NormalizedChatMessage[]) =>
  messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

const createOllamaClient = async (resolved: ProviderResolution) => {
  await assertOllamaModelAvailable({
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    role: "llm",
  });

  const options: ConstructorParameters<typeof Ollama>[0] = {
    host: resolved.baseUrl || undefined,
  };
  if (resolved.apiKey) {
    options.headers = {
      Authorization: `Bearer ${resolved.apiKey}`,
    };
  }

  return {
    resolved,
    client: new Ollama(options),
  };
};

const generateOllamaStructuredOutput = async <T>(
  input: TaskStructuredOutputInput,
  resolved: ProviderResolution,
) => {
  const { client } = await createOllamaClient(resolved);
  const response = (await client.chat({
    model: resolved.model,
    messages: toTextOnlyMessages(input.messages),
    stream: false,
    format: input.schema,
    options: toOllamaChatOptions(resolved.params),
    ...(resolved.params.think !== undefined
      ? { think: resolved.params.think }
      : {}),
  } as any)) as any;

  return parseStructuredJson<T>(response.message?.content ?? "");
};

const streamOllamaStructuredOutputText = async function* (
  input: TaskStructuredOutputInput,
  resolved: ProviderResolution,
): AsyncGenerator<string> {
  const { client } = await createOllamaClient(resolved);
  const response = (await client.chat({
    model: resolved.model,
    messages: toTextOnlyMessages(input.messages),
    stream: true,
    format: input.schema,
    options: toOllamaChatOptions(resolved.params),
    ...(resolved.params.think !== undefined
      ? { think: resolved.params.think }
      : {}),
  } as any)) as any;

  for await (const chunk of response) {
    const delta = chunk?.message?.content;
    if (typeof delta !== "string" || !delta) {
      continue;
    }
    yield delta;
  }
};

/**
 * Uses the provider's native schema-constrained response mechanism and exposes
 * text deltas as they arrive. Planner can surface the public `reason` field as
 * live narration while still waiting for the complete decision object before
 * validation/execution.
 */
export const streamTaskStructuredOutputText = (
  input: TaskStructuredOutputInput,
  capability = resolveTaskStructuredOutputCapability(),
): TaskStructuredOutputTextStream => {
  const { adapter, resolved } = capability;

  switch (adapter) {
    case "ark-json-schema":
      return captureStructuredOutputStream(
        streamArkPlanStructuredOutputText(resolved, input),
      );
    case "ollama-json-schema":
      return captureStructuredOutputStream(
        streamOllamaStructuredOutputText(input, resolved),
      );
    case "none":
      throw new Error(
        `Task provider ${resolved.providerCode} does not expose native Planner structured output through its declared capability.`,
      );
    default:
      throw new Error(
        `Task provider ${resolved.providerCode} has an unknown Planner structured output adapter.`,
      );
  }
};

const captureStructuredOutputStream = (
  source: AsyncGenerator<string>,
): TaskStructuredOutputTextStream => {
  let structuredOutput: unknown;
  const stream = (async function* () {
    let output = "";
    for await (const delta of source) {
      output += delta;
      yield delta;
    }
    try {
      structuredOutput = parseStructuredJson<Record<string, unknown>>(output);
    } catch {
      // Keep a protocol-invalid native response on the native adapter path.
      // The Planner decision adapter owns the deterministic failure result.
      structuredOutput = output;
    }
  })();

  return Object.assign(stream, {
    getStructuredOutput: () => structuredOutput,
  });
};

export const resolveTaskStructuredOutputCapability =
  (): ResolvedTaskStructuredOutputCapability => {
    const resolved = resolveAgentTaskProvider("default");
    return {
      resolved,
      adapter: getPlannerStructuredOutputAdapter(resolved.providerTemplateCode),
    };
  };

export type ResolvedTaskStructuredOutputCapability = {
  adapter: PlannerStructuredOutputAdapter;
  resolved: ProviderResolution;
};

export interface TaskStructuredOutputTextStream extends AsyncGenerator<string> {
  getStructuredOutput: () => unknown;
}

/**
 * Non-streaming native structured output remains available for callers that
 * need the parsed object directly.
 */
export const generateTaskStructuredOutput = async <T>(
  input: TaskStructuredOutputInput,
  capability = resolveTaskStructuredOutputCapability(),
): Promise<T> => {
  const { adapter, resolved } = capability;

  switch (adapter) {
    case "ark-json-schema":
      return await generateArkPlanStructuredOutput<T>(resolved, input);
    case "ollama-json-schema":
      return await generateOllamaStructuredOutput<T>(input, resolved);
    case "none":
      throw new Error(
        `Task provider ${resolved.providerCode} does not expose native Planner structured output through its declared capability.`,
      );
    default:
      throw new Error(
        `Task provider ${resolved.providerCode} has an unknown Planner structured output adapter.`,
      );
  }
};
