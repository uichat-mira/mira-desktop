import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol.js";
import type { ProviderResolution } from "@/services/provider-proxy.service/types.js";
import {
  createArkPlanAdapter,
  type ArkPlanService,
} from "@/services/ark-plan-adapter.js";
import { toOpenAICompatibleChatOptions } from "@/services/provider-proxy.service/params.js";

export type ArkPlanStructuredOutputInput = {
  messages: NormalizedChatMessage[];
  schema: Record<string, unknown>;
  name: string;
  description?: string;
};

const resolveArkPlanService = (
  providerTemplateCode: string,
): ArkPlanService | null => {
  if (providerTemplateCode === "volcengine-code-plan") {
    return "code-plan";
  }

  if (providerTemplateCode === "volcengine-agent-plan") {
    return "agent-plan";
  }

  return null;
};

export const isArkPlanStructuredOutputProvider = (
  resolved: ProviderResolution,
) => resolveArkPlanService(resolved.providerTemplateCode) !== null;

const readResponsePayload = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const getArkErrorMessage = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
};

const parseStructuredJsonObject = <T>(text: string): T => {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error("Ark Plan structured output returned an empty response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized) as unknown;
  } catch {
    throw new Error("Ark Plan structured output returned invalid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ark Plan structured output must be one JSON object.");
  }

  return parsed as T;
};

const requestArkPlanStructuredOutputText = async (
  resolved: ProviderResolution,
  input: ArkPlanStructuredOutputInput,
  requestFetch?: typeof globalThis.fetch,
) => {
  const service = resolveArkPlanService(resolved.providerTemplateCode);
  if (!service) {
    throw new Error(
      `Provider template ${resolved.providerTemplateCode} is not an Ark Plan connection.`,
    );
  }

  const adapter = createArkPlanAdapter({
    service,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    ...(requestFetch ? { fetch: requestFetch } : {}),
  });
  const response = await adapter.createChatCompletion({
    ...toOpenAICompatibleChatOptions(resolved.params),
    model: resolved.model,
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    // Ark Plan structured streaming is not documented as a stable contract.
    // Buffer one complete response so Planner never receives a partial object.
    stream: false,
    // Ark Plan requires the Thinking object shape instead of a boolean. Planner
    // agentTask decisions must stay non-thinking so reasoning text cannot leak
    // into the schema-constrained decision. Remove only if Ark changes this
    // request contract and the replacement is verified on both Plan endpoints.
    thinking: { type: "disabled" },
    response_format: {
      type: "json_schema",
      json_schema: {
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        strict: true,
        schema: input.schema,
      },
    },
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    const providerMessage = getArkErrorMessage(payload);
    throw new Error(
      `Ark ${service} structured output failed: ${response.status}${
        providerMessage ? ` ${providerMessage}` : ""
      }`,
    );
  }

  const content =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as {
          choices?: Array<{ message?: { content?: unknown } }>;
        }).choices?.[0]?.message?.content
      : undefined;

  if (typeof content !== "string") {
    throw new Error("Ark Plan structured output response did not contain message content.");
  }

  return content;
};

export const generateArkPlanStructuredOutput = async <T>(
  resolved: ProviderResolution,
  input: ArkPlanStructuredOutputInput,
  requestFetch?: typeof globalThis.fetch,
): Promise<T> =>
  parseStructuredJsonObject<T>(
    await requestArkPlanStructuredOutputText(resolved, input, requestFetch),
  );

export const streamArkPlanStructuredOutputText = async function* (
  resolved: ProviderResolution,
  input: ArkPlanStructuredOutputInput,
  requestFetch?: typeof globalThis.fetch,
): AsyncGenerator<string> {
  const completeJson = await requestArkPlanStructuredOutputText(
    resolved,
    input,
    requestFetch,
  );
  yield completeJson;
};
