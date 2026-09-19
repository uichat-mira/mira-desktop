import { Readable } from "node:stream";
import { Ollama } from "ollama";
import { modelConfigRepository } from "@/db/repositories";
import type { ModelType, ProviderCode } from "@/db/schema.js";
import {
  type AssistantStreamFinishReason,
  assistantDoneChunk,
  assistantExecutionNodeChunk,
  assistantErrorChunk,
  assistantFinishChunks,
  assistantToolEventChunk,
  assistantTextDeltaChunk,
  assistantTextEndChunk,
  assistantTextStartChunks,
  type AssistantExecutionNodeEvent,
  type AssistantToolEvent,
} from "@/services/chat-stream-events.js";
import {
  createCloudflareEmbeddings,
  resolveCloudflareRunUrl,
} from "@/services/cloudflare-provider.js";
import {
  createOpenAICompatibleEmbeddings,
  createOpenAICompatibleEmbeddingsUrl,
  createOpenAICompatibleRerankUrl,
} from "@/services/openai-compatible-provider.js";
import { getProviderDefinition } from "@/providers/catalog.js";
import { resolveMessagesForGenerate } from "@/services/chat-file-context.service.js";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol.js";
import {
  describeResolvedChatInvocation,
  streamResolvedChat,
} from "./chat-adapters.js";
import { parseModelParams, toEmbeddingOptions } from "./params.js";
import {
  assertOllamaModelAvailable,
  resolveAgentTaskProvider,
  resolveExplicitProviderSelection,
  resolveProviderForRole,
} from "./resolution.js";
import { createUiMessageStream, filterThinkTagStream } from "./stream-normalizer.js";
import type {
  ProviderInvocationMetadata,
  ProviderResolution,
  ProxyProviderParam,
  RerankResolution,
} from "./types.js";

export type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol.js";
export type {
  ProviderInvocationMetadata,
  ProviderResolution,
  ProxyProviderParam,
  RerankResolution,
} from "./types.js";

export interface EmbeddingResult {
  providerCode: ProviderCode;
  model: string;
  modelConfigId: string;
  embeddings: number[][];
  dimensions: number;
}

export interface ExplicitProviderSelectionInput {
  providerCode: ProviderCode;
  remoteModelId: string;
  messages: NormalizedChatMessage[];
  params?: Record<string, unknown>;
}

export interface PersistedChatStreamInput {
  requestedProvider: ProxyProviderParam;
  threadId: string;
  userId: number;
  userMessageId: string;
  assistantMessageId: string;
  messages: NormalizedChatMessage[];
  params?: Record<string, unknown>;
  preludeChunks?: string[];
  executeFullAnswer?: (helpers: {
    emitToolEvent: (event: AssistantToolEvent) => Promise<void>;
    emitExecutionNode: (event: AssistantExecutionNodeEvent) => Promise<void>;
  }) => Promise<string | { answer: string; isFinal?: boolean }>;
  onToolEvent?: (event: AssistantToolEvent) => Promise<void> | void;
  onExecutionNode?: (
    event: AssistantExecutionNodeEvent,
  ) => Promise<void> | void;
  onComplete?: (input: {
    answer: string;
    finishReason: AssistantStreamFinishReason;
  }) => Promise<void> | void;
}

const syncResolvedEmbeddingDimensions = (
  resolved: ProviderResolution,
  dimensions: number,
) => {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    return;
  }

  const modelConfig = modelConfigRepository.findDefaultByType("embedding");
  if (
    !modelConfig ||
    modelConfig.id !== resolved.modelConfigId ||
    !modelConfig.params
  ) {
    return;
  }

  const currentParams = parseModelParams(modelConfig.params);
  if (currentParams.dimensions === dimensions) {
    return;
  }

  modelConfigRepository.updateDefault("embedding", {
    params: JSON.stringify({
      ...currentParams,
      dimensions,
    }),
  });
};

export const getEmbeddingInvocationUrl = (resolved: ProviderResolution) => {
  switch (getProviderDefinition(resolved.providerCode).embeddingAdapter) {
    case "ollama":
      return `${resolved.baseUrl.replace(/\/+$/, "")}/api/embed`;
    case "cloudflare":
      return resolveCloudflareRunUrl(resolved.baseUrl, resolved.model);
    case "openai-compatible":
      return createOpenAICompatibleEmbeddingsUrl(resolved.baseUrl);
    default:
      throw new Error(`Unsupported provider "${resolved.providerCode}"`);
  }
};

const createEmbeddingInvocationMetadata = (
  resolved: ProviderResolution,
  input: string[],
): ProviderInvocationMetadata => {
  const protocol = getProviderDefinition(resolved.providerCode).embeddingAdapter;
  const endpoint = getEmbeddingInvocationUrl(resolved);

  return {
    providerCode: resolved.providerCode,
    providerLabel: getProviderDefinition(resolved.providerCode).displayName,
    protocol,
    operation: "embeddings",
    endpoint,
    model: resolved.model,
    modelConfigId: resolved.modelConfigId,
    params: resolved.params,
    request: {
      method: "POST",
      url: endpoint,
      body: {
        model: resolved.model,
        inputCount: input.length,
        params: toEmbeddingOptions(resolved.params),
      },
    },
  };
};

const createOllamaClient = (baseUrl: string, apiKey: string) => {
  const options: ConstructorParameters<typeof Ollama>[0] = {
    host: baseUrl || undefined,
  };

  if (apiKey) {
    options.headers = {
      Authorization: `Bearer ${apiKey}`,
    };
  }

  return new Ollama(options);
};

export const providerProxyService = {
  createUiMessageStream,

  streamChatText(
    requestedProvider: ProxyProviderParam,
    messages: NormalizedChatMessage[],
    params?: Record<string, unknown>,
  ) {
    const baseResolved = resolveProviderForRole("llm", requestedProvider);
    const resolved = {
      ...baseResolved,
      params: {
        ...baseResolved.params,
        ...(params ?? {}),
      },
    };

    return streamResolvedChat(resolved, messages);
  },

  streamChat(
    requestedProvider: ProxyProviderParam,
    messages: NormalizedChatMessage[],
    params?: Record<string, unknown>,
  ) {
    return createUiMessageStream(() =>
      this.streamChatText(requestedProvider, messages, params),
    );
  },

  createPersistedChatStream(input: PersistedChatStreamInput) {
    const service = this;

    return Readable.from(
      (async function* () {
        let answer = "";
        const toolEventQueue: string[] = [];
        let queueWaiter: (() => void) | null = null;
        const flushToolEvents = function* () {
          while (toolEventQueue.length > 0) {
            const nextChunk = toolEventQueue.shift();
            if (nextChunk) {
              yield nextChunk;
            }
          }
        };
        const notifyQueue = () => {
          queueWaiter?.();
          queueWaiter = null;
        };
        const waitForQueueSignal = () =>
          new Promise<void>((resolve) => {
            queueWaiter = resolve;
          });
        const emitToolEvent = async (event: AssistantToolEvent) => {
          toolEventQueue.push(assistantToolEventChunk(event));
          notifyQueue();
          await input.onToolEvent?.(event);
        };
        const emitExecutionNode = async (event: AssistantExecutionNodeEvent) => {
          toolEventQueue.push(assistantExecutionNodeChunk(event));
          notifyQueue();
          await input.onExecutionNode?.(event);
        };

        try {
          if (input.preludeChunks?.length) {
            for (const chunk of input.preludeChunks) {
              yield chunk;
            }
          }

          yield* assistantTextStartChunks({
            messageId: input.assistantMessageId,
            includeStartStep: true,
          });

          if (input.executeFullAnswer) {
            let executeCompleted = false;
            const answerPromise = input
              .executeFullAnswer({
                emitToolEvent,
                emitExecutionNode,
              })
              .finally(() => {
                executeCompleted = true;
                notifyQueue();
              });

            while (!executeCompleted || toolEventQueue.length > 0) {
              if (toolEventQueue.length === 0) {
                await waitForQueueSignal();
                continue;
              }

              yield* flushToolEvents();
            }

            const executionResult = await answerPromise;
            if (typeof executionResult === "string") {
              answer = executionResult;
            } else {
              answer = executionResult.answer;
            }
            if (answer) {
              yield assistantTextDeltaChunk(answer);
            }

            if (
              typeof executionResult !== "string" &&
              executionResult.isFinal === false
            ) {
              yield assistantTextEndChunk();
              await input.onComplete?.({
                answer,
                finishReason: "stop",
              });
              yield* assistantFinishChunks({
                finishReason: "stop",
                isContinued: false,
                includeDone: true,
              });
              return;
            }
          } else {
            for await (const delta of filterThinkTagStream(service.streamChatText(
              input.requestedProvider,
              input.messages,
              input.params,
            ))) {
              if (!delta) {
                continue;
              }

              answer += delta;
              yield assistantTextDeltaChunk(delta);
            }
          }

          if (!answer.trim()) {
            throw new Error("Model returned empty assistant response");
          }

          yield assistantTextEndChunk();
          await input.onComplete?.({
            answer,
            finishReason: "stop",
          });
          yield* assistantFinishChunks({
            finishReason: "stop",
            isContinued: false,
            includeDone: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          yield assistantErrorChunk(message);
          yield* flushToolEvents();
          yield* assistantFinishChunks({
            finishReason: "error",
            isContinued: false,
            includeDone: false,
          });
          yield assistantDoneChunk();
        }
      })(),
    );
  },

  streamTaskChatText(messages: NormalizedChatMessage[]) {
    const resolved = resolveAgentTaskProvider("default");

    return streamResolvedChat(resolved, messages);
  },

  streamTaskChat(messages: NormalizedChatMessage[]) {
    return createUiMessageStream(() => this.streamTaskChatText(messages));
  },

  describeChatInvocation(
    requestedProvider: ProxyProviderParam,
    messages: NormalizedChatMessage[],
  ): ProviderInvocationMetadata {
    const resolved = resolveProviderForRole("llm", requestedProvider);
    return describeResolvedChatInvocation(resolved, messages, "chat");
  },

  describeTaskChatInvocation(
    messages: NormalizedChatMessage[],
  ): ProviderInvocationMetadata {
    const resolved = resolveAgentTaskProvider("default");
    return describeResolvedChatInvocation(resolved, messages, "task-chat");
  },

  describeEmbeddingInvocation(
    requestedProvider: ProxyProviderParam,
    input: string[],
  ): ProviderInvocationMetadata {
    const resolved = resolveProviderForRole("embedding", requestedProvider);
    return createEmbeddingInvocationMetadata(resolved, input);
  },

  async createEmbeddings(
    requestedProvider: ProxyProviderParam,
    input: string[],
  ): Promise<EmbeddingResult> {
    const normalizedInput = input.map((item) => item.trim()).filter(Boolean);
    if (normalizedInput.length === 0) {
      return {
        providerCode:
          requestedProvider === "default" ? "ollama" : requestedProvider,
        model: "",
        modelConfigId: "",
        embeddings: [],
        dimensions: 0,
      };
    }

    const resolved = resolveProviderForRole("embedding", requestedProvider);
    const embeddingOptions = toEmbeddingOptions(resolved.params);

    let embeddings: number[][] = [];

    switch (getProviderDefinition(resolved.providerCode).embeddingAdapter) {
      case "ollama": {
        await assertOllamaModelAvailable({
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
          model: resolved.model,
          role: "embedding",
        });

        const ollama = createOllamaClient(resolved.baseUrl, resolved.apiKey);
        const response = await ollama.embed({
          model: resolved.model,
          input: normalizedInput,
          ...embeddingOptions,
        });

        embeddings = response.embeddings ?? [];

        break;
      }
      case "cloudflare": {
        embeddings = await createCloudflareEmbeddings({
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
          model: resolved.model,
          input: normalizedInput,
          params: embeddingOptions,
        });
        break;
      }
      case "openai-compatible": {
        embeddings = await createOpenAICompatibleEmbeddings({
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
          model: resolved.model,
          input: normalizedInput,
          params: embeddingOptions,
        });
        break;
      }
      default:
        throw new Error(`Unsupported provider "${resolved.providerCode}"`);
    }

    if (embeddings.length !== normalizedInput.length) {
      throw new Error("Embedding result count does not match input count");
    }

    const dimensions = embeddings[0]?.length ?? 0;
    if (dimensions <= 0) {
      throw new Error("Embedding provider returned empty vectors");
    }

    syncResolvedEmbeddingDimensions(resolved, dimensions);

    return {
      providerCode: resolved.providerCode,
      model: resolved.model,
      modelConfigId: resolved.modelConfigId,
      embeddings,
      dimensions,
    };
  },

  resolveRerankProvider(
    requestedProvider: ProxyProviderParam = "default",
  ): RerankResolution {
    const resolved = resolveProviderForRole("rerank", requestedProvider);
    const providerDefinition = getProviderDefinition(resolved.providerCode);

    if (providerDefinition.rerankAdapter !== "openai-compatible") {
      throw new Error(
        `Provider "${resolved.providerCode}" does not support the OpenAI-compatible rerank adapter`,
      );
    }

    return {
      ...resolved,
      endpoint: createOpenAICompatibleRerankUrl(resolved.baseUrl),
    };
  },

  async generateTextWithModelSelection(
    input: ExplicitProviderSelectionInput,
  ): Promise<string> {
    const resolved = resolveExplicitProviderSelection(
      input.providerCode,
      input.remoteModelId,
      input.params ?? {},
    );

    if (getProviderDefinition(resolved.providerCode).chatAdapter === "ollama") {
      await assertOllamaModelAvailable({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        model: resolved.model,
        role: "llm",
      });
    }

    let output = "";
    for await (const delta of streamResolvedChat(resolved, input.messages)) {
      output += delta;
    }

    return output.trim();
  },

  async generateTextForRole(
    roleType: ModelType,
    messages: NormalizedChatMessage[],
    params?: Record<string, unknown>,
  ): Promise<string> {
    const baseResolved = resolveProviderForRole(roleType, "default");
    const resolved: ProviderResolution = {
      ...baseResolved,
      params: {
        ...baseResolved.params,
        ...(params ?? {}),
      },
    };

    if (getProviderDefinition(resolved.providerCode).chatAdapter === "ollama") {
      await assertOllamaModelAvailable({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        model: resolved.model,
        role: roleType,
      });
    }

    const providerMessages =
      roleType === "llm" ? await resolveMessagesForGenerate(messages) : messages;

    let output = "";
    for await (const delta of streamResolvedChat(resolved, providerMessages)) {
      output += delta;
    }

    return output.trim();
  },
};
