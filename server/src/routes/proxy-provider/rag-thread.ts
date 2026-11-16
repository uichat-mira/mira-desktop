import type { FastifyBaseLogger } from "fastify";
import { knowledgeBaseService } from "@/services/knowledge-base.service.js";
import {
  type NormalizedChatMessage,
  providerProxyService,
} from "@/services/provider-proxy.service/index.js";
import {
  assistantDoneChunk,
  assistantErrorChunk,
  assistantFinishChunks,
  assistantTextDeltaChunk,
  assistantTextEndChunk,
  assistantTextStartChunks,
} from "@/services/chat-stream-events.js";
import { NO_CONTEXT_ANSWER } from "@/services/rag-response-constants.js";
import type { RetrievedChunk } from "@/services/rag-nodes/index.js";
import { ragPipeline } from "@/services/rag-pipeline.js";
import { threadService } from "@/services/thread.service.js";
import {
  getFallbackThreadTitle,
  generateThreadTitleFromMessages,
  getLatestUserTitleSeed,
  persistAssistantMessage,
  persistVisibleUserMessage,
  shouldGenerateTitle,
} from "./message-persistence.js";
import { createStaticAssistantStream } from "./stream-protocol.js";
import { getNormalizedMessageText } from "@/services/provider-proxy.message-protocol.js";
import { Readable } from "node:stream";

export const toPersistedRagSources = (sources: RetrievedChunk[]) =>
  sources.map((source) => ({
    chunkId: source.chunkId,
    documentId: source.documentId,
    documentName: source.documentName,
    score: source.score,
    content: source.content,
    ...(source.matchType ? { matchType: source.matchType } : {}),
    ...(source.hitModes ? { hitModes: source.hitModes } : {}),
    ...(source.citation ? { citation: source.citation } : {}),
  }));

/** Extract the latest user question and history from normalized chat messages. */
export const toRagInput = (messages: NormalizedChatMessage[]) => {
  const latestUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index;

  if (latestUserIndex === undefined) {
    return null;
  }

  const latestUserMessage = messages[latestUserIndex];
  const latestUserText = getNormalizedMessageText(latestUserMessage);
  if (!latestUserMessage || !latestUserText) {
    return null;
  }

  const conversationHistory = messages
    .slice(0, latestUserIndex)
    .filter((message) => message.role !== "system");

  return {
    question: latestUserText,
    conversationHistory,
  };
};

export interface RagAssistantStreamInput {
  /** Thread that owns the persisted RAG conversation. */
  threadId: string;
  /** Authenticated user id used for thread/message ownership checks. */
  userId: number;
  /** Optional client-side user message id. */
  userMessageId?: string;
  /** User turn already atomically appended by Host before generating RAG. */
  prePersistedUserMessageId?: string;
  /** Latest user question and non-system history. */
  ragInput: NonNullable<ReturnType<typeof toRagInput>>;
  /** Client-visible linear history used to align persisted RAG messages. */
  messages: NormalizedChatMessage[];
  /** Request-only role/summary system messages derived from thread state. */
  requestContextMessages?: NormalizedChatMessage[];
  /** Pre-rendered request-context execution nodes shared with normal chat. */
  requestContextPreludeChunks?: string[];
  /** Logger from the Fastify route, used for route-level observability. */
  log: FastifyBaseLogger;
}

/**
 * Create the RAG chat stream and persist user/assistant messages around it.
 * Empty knowledge bases return a deterministic static stream.
 */
export const createRagAssistantStream = (input: RagAssistantStreamInput) => {
  const {
    threadId,
    userId,
    userMessageId,
    prePersistedUserMessageId,
    ragInput,
    messages,
    requestContextMessages,
    requestContextPreludeChunks,
    log,
  } = input;

  log.info(
    {
      scope: "proxy-provider",
      event: "rag-branch-enter",
      threadId,
      userId,
      question: ragInput.question,
      historyCount: ragInput.conversationHistory?.length ?? 0,
    },
    "[proxy-provider] starting RAG chat stream",
  );

  const latestUserMessageId = prePersistedUserMessageId ??
    persistVisibleUserMessage({ threadId, userId, userMessageId, messages })
      .latestUserMessageId;
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const assistantMessageId = crypto.randomUUID();
  const latestThread = threadService.getThreadSummaryById(threadId, userId);
  const knowledgeBaseId = latestThread?.knowledgeBaseId;

  const persistRagAssistantMessage = async ({
    answer,
    sources,
    finishReason,
    routeReason,
  }: {
    answer: string;
    sources: RetrievedChunk[];
    finishReason: "stop" | "error";
    routeReason?: string;
  }) => {
    if (finishReason !== "stop" || !threadId || !answer.trim()) {
      if (finishReason === "error" && prePersistedUserMessageId) {
        threadService.markAppendMessageFailed(
          threadId, userId, prePersistedUserMessageId,
        );
      }
      return;
    }

    persistAssistantMessage({
      threadId,
      userId,
      assistantMessageId,
      parentId: latestUserMessageId,
      content: answer,
      metadata: {
        rag: {
          enabled: true,
          question: ragInput.question,
          topK: 10,
          topN: 4,
          sources: toPersistedRagSources(sources),
          ...(routeReason ? { routeReason } : {}),
        },
      },
    });

    try {
      const currentThread = threadService.getThreadSummaryById(threadId, userId);
      if (shouldGenerateTitle(currentThread?.title)) {
        const title = await generateThreadTitleFromMessages({
          question: getLatestUserTitleSeed(latestUserMessage) || ragInput.question,
          answer,
          streamTaskChatText: (titleMessages) =>
            providerProxyService.streamTaskChatText(titleMessages),
        });
        threadService.updateThread(threadId, userId, {
          title,
        });
      }
    } catch (titleError) {
      const fallbackTitle = getFallbackThreadTitle(
        getLatestUserTitleSeed(latestUserMessage) || ragInput.question,
      );
      if (
        shouldGenerateTitle(threadService.getThreadSummaryById(threadId, userId)?.title) &&
        fallbackTitle !== "新对话"
      ) {
        threadService.updateThread(threadId, userId, {
          title: fallbackTitle,
        });
      }
      log.warn(
        { err: titleError, threadId, fallbackTitle },
        "[proxy-provider] failed to generate RAG thread title",
      );
    }
  };

  const currentKnowledgeBase = knowledgeBaseId
    ? knowledgeBaseService.getKnowledgeBaseById(knowledgeBaseId)
    : null;

  if (!currentKnowledgeBase) {
    throw new Error("Thread knowledge base is missing or no longer available");
  }

  if (currentKnowledgeBase.enabledDocumentCount === 0) {
    log.info(
      {
        scope: "proxy-provider",
        event: "rag-route-empty-knowledge-base",
        threadId,
        userId,
        knowledgeBaseId: currentKnowledgeBase.id,
      },
      "[proxy-provider] knowledge base empty, returning fixed RAG fallback",
    );

    return createStaticAssistantStream({
      messageId: assistantMessageId,
      answer: NO_CONTEXT_ANSWER,
      ragNode: {
        nodeId: "routeKnowledgeBase",
        nodeType: "route",
        label: "检查知识库可用性",
        summary: "知识库为空，直接返回固定拒答",
        details: {
          knowledgeBaseId: currentKnowledgeBase.id,
          enabledDocumentCount: currentKnowledgeBase.enabledDocumentCount,
          documentCount: currentKnowledgeBase.documentCount,
        },
        environment: {
          result: {
            success: true,
            finishReason: "knowledge-base-empty",
            metrics: {
              candidateCount: 0,
              returnedCount: 0,
            },
            response: {
              summary: {
                answerLength: Array.from(NO_CONTEXT_ANSWER).length,
                routeReason: "knowledge-base-empty",
              },
            },
          },
          retrieval: {
            knowledgeBaseId: currentKnowledgeBase.id,
            candidateCount: 0,
            returnedCount: 0,
          },
          timing: {
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 0,
          },
        },
      },
      onComplete: () =>
        persistRagAssistantMessage({
          answer: NO_CONTEXT_ANSWER,
          sources: [],
          finishReason: "stop",
          routeReason: "knowledge-base-empty",
        }),
    });
  }

  return Readable.from(
    (async function* () {
      try {
        if (requestContextPreludeChunks?.length) {
          for (const chunk of requestContextPreludeChunks) {
            yield chunk;
          }
        }

        const ragStream = ragPipeline.assistantStream(
          {
            question: ragInput.question,
            conversationHistory: ragInput.conversationHistory,
            knowledgeBaseId: currentKnowledgeBase.id,
            requestContextMessages,
          },
          {
            messageId: assistantMessageId,
            onComplete: async ({ answer, sources, finishReason }) =>
              persistRagAssistantMessage({
                answer,
                sources,
                finishReason,
              }),
          },
        );

        for await (const chunk of ragStream) {
          yield chunk;
        }
      } catch (streamError) {
        if (prePersistedUserMessageId) {
          threadService.markAppendMessageFailed(
            threadId, userId, prePersistedUserMessageId,
          );
        }
        const message =
          streamError instanceof Error ? streamError.message : String(streamError);
        yield* assistantTextStartChunks({ messageId: assistantMessageId });
        yield assistantTextDeltaChunk("");
        yield assistantTextEndChunk();
        yield assistantErrorChunk(message);
        yield* assistantFinishChunks({
          finishReason: "error",
          isContinued: false,
          includeDone: false,
        });
        yield assistantDoneChunk();
      }
    })(),
  );
};
