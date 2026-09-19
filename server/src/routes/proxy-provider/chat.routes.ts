import type { FastifyInstance, FastifyReply } from "fastify";
import { PUBLIC_API_ROUTES } from "@/config/public-api.js";
import { getHarnessEnvironmentSnapshot } from "@/harness/environment.js";
import { threadService } from "@/services/thread.service.js";
import {
  roleService,
  type RoleLlmProfileResponse,
} from "@/services/role.service.js";
import { threadRequestContextNode } from "@/services/shared-nodes/thread-request-context.node.js";
import type { RequestContextExecutionNode } from "@/services/shared-nodes/thread-request-context.types.js";
import { assistantExecutionNodeChunk } from "@/services/chat-stream-events.js";
import {
  type ProxyProviderParam,
  providerProxyService,
} from "@/services/provider-proxy.service/index.js";
import { normalizeProxyChatMessages } from "@/services/provider-proxy.message-protocol.js";
import {
  handleValidationError,
} from "@/utils/index.js";
import { badRequest, routeHandler } from "@/utils/route-errors.js";
import { createRagAssistantStream, toRagInput } from "./rag-thread.js";
import { proxyProviderRouteSchemas } from "./schemas.js";
import {
  prepareDataStreamReply,
  prepareEventStreamReply,
} from "./stream-protocol.js";
import { executeDefaultChatToolLoop } from "./chat-tool-loop.js";
import { createAndRunAgent } from "@/agent/index.js";
import {
  getFallbackThreadTitle,
  generateThreadTitleFromMessages,
  getLatestUserTitleSeed,
  persistAssistantMessage,
  persistVisibleUserMessage,
  shouldGenerateTitle,
} from "./message-persistence.js";
import { resolveChatToolSurface } from "./chat-tool-surface.js";
import type {
  ChatMessagesBody,
  ProviderChatBody,
  ProviderChatParams,
} from "./types.js";

export const shouldUseThreadRag = (input: {
  knowledgeBaseId: string | null | undefined;
  ragInput: ReturnType<typeof toRagInput>;
  threadId?: string;
  hasAuthUser: boolean;
}) =>
  Boolean(
    input.knowledgeBaseId &&
      input.ragInput &&
      typeof input.threadId === "string" &&
      input.hasAuthUser,
  );

const resolveDefaultProviderThread = (
  threadId: string | undefined,
  userId: number | undefined,
) => {
  if (typeof threadId !== "string" || !userId) {
    return null;
  }

  return threadService.getThreadSummaryById(threadId, userId);
};

const resolveThreadWorkspaceRoot = (
  threadId: string | undefined,
  userId: number | undefined,
) => {
  if (typeof threadId !== "string" || !userId) {
    return null;
  }

  return threadService.getThreadWorkspaceRoot(threadId, userId);
};

const collectThreadRequestContext = (
  threadId: string | undefined,
  userId: number | undefined,
  options: { agentEnabled?: boolean } = {},
) => {
  if (typeof threadId !== "string" || !userId) {
    return {
      messages: [],
      executionNodes: [],
    };
  }

  const thread = threadService.getThreadSummaryById(threadId, userId);
  if (!thread) {
    return {
      messages: [],
      executionNodes: [],
    };
  }

  const harnessEnvironment = getHarnessEnvironmentSnapshot();
  const threadWorkspaceRoot = resolveThreadWorkspaceRoot(threadId, userId);
  const toolSurface = resolveChatToolSurface({
    agentEnabled:
      typeof options.agentEnabled === "boolean"
        ? options.agentEnabled
        : Boolean(thread.agentEnabled),
  });

  return threadRequestContextNode.createRequestContext(
    {
      ...thread,
      executionEnvironment: {
        platform: process.platform,
        shellFamily: harnessEnvironment.terminal.shellProfile.shellFamily,
        shellExecutable: harnessEnvironment.terminal.shellProfile.shell,
        workspaceRoot: threadWorkspaceRoot ?? harnessEnvironment.workspace.rootPath,
        cwd: threadWorkspaceRoot ?? harnessEnvironment.workspace.rootPath,
        availableTools: toolSurface.map((tool) => tool.id),
      },
    },
    userId,
  );
};

const toAssistantExecutionNodePrelude = (
  node: RequestContextExecutionNode,
) =>
  assistantExecutionNodeChunk({
    nodeId: node.nodeId,
    nodeType: node.nodeType,
    phase: node.phase,
    label: node.label,
    ...(node.summary ? { summary: node.summary } : {}),
    ...(node.details ? { details: node.details } : {}),
  });

const resolveThreadRoleLlmParams = (
  threadId: string | undefined,
  userId: number | undefined,
): Record<string, unknown> | undefined => {
  if (typeof threadId !== "string" || !userId) {
    return undefined;
  }

  const thread = threadService.getThreadSummaryById(threadId, userId);
  if (!thread?.roleId) {
    return undefined;
  }

  const role = roleService.getRoleById(thread.roleId, userId);
  if (!role) {
    return undefined;
  }

  const profile = role.llmProfile as RoleLlmProfileResponse;
  const params = Object.fromEntries(
    Object.entries({
      temperature: profile.temperature,
      topP: profile.topP,
      topK: profile.topK,
      maxTokens: profile.maxTokens,
      frequencyPenalty: profile.frequencyPenalty,
      presencePenalty: profile.presencePenalty,
    }).filter(([, value]) => typeof value === "number"),
  );

  return Object.keys(params).length > 0 ? params : undefined;
};

const resolveThreadAgentEnabled = (
  threadId: string | undefined,
  userId: number | undefined,
) => {
  if (typeof threadId !== "string" || !userId) {
    return false;
  }

  const thread = threadService.getThreadSummaryById(threadId, userId);
  return Boolean(thread?.agentEnabled);
};

const sendRagChatStream = ({
  app,
  reply,
  threadId,
  authUserId,
  userMessageId,
  ragInput,
  messages,
  requestContextMessages,
  requestContextPreludeChunks,
}: {
  app: FastifyInstance;
  reply: FastifyReply;
  threadId: string;
  authUserId: number;
  userMessageId?: string;
  ragInput: NonNullable<ReturnType<typeof toRagInput>>;
  messages: ReturnType<typeof normalizeProxyChatMessages>;
  requestContextMessages?: ReturnType<typeof normalizeProxyChatMessages>;
  requestContextPreludeChunks?: string[];
}) => {
  prepareEventStreamReply(reply);
  return reply.send(
    createRagAssistantStream({
      threadId,
      userId: authUserId,
      userMessageId,
      ragInput,
      messages,
      requestContextMessages,
      requestContextPreludeChunks,
      log: app.log,
    }),
  );
};

const sendPersistedDefaultChatStream = ({
  app,
  reply,
  threadId,
  authUserId,
  userMessageId,
  messages,
  agentMessages,
  requestContextMessages,
  params,
  agentEnabled,
  requestedToolGroupIds,
  knowledgeBaseId,
  preludeChunks,
}: {
  app: FastifyInstance;
  reply: FastifyReply;
  threadId: string;
  authUserId: number;
  userMessageId?: string;
  messages: ReturnType<typeof normalizeProxyChatMessages>;
  agentMessages?: ReturnType<typeof normalizeProxyChatMessages>;
  requestContextMessages?: ReturnType<typeof normalizeProxyChatMessages>;
  params?: Record<string, unknown>;
  agentEnabled?: boolean;
  requestedToolGroupIds?: string[];
  knowledgeBaseId?: string | null;
  preludeChunks?: string[];
}) => {
  const workspaceRoot = resolveThreadWorkspaceRoot(threadId, authUserId);
  const { latestUserMessageId, latestUserMessage } = persistVisibleUserMessage({
    threadId,
    userId: authUserId,
    userMessageId,
    messages,
  });
  const assistantMessageId = crypto.randomUUID();
  let agentAssistantMetadata: Record<string, unknown> | undefined;

  prepareEventStreamReply(reply);
  return reply.send(
    providerProxyService.createPersistedChatStream({
      requestedProvider: "default",
      threadId,
      userId: authUserId,
      userMessageId: latestUserMessageId,
      assistantMessageId,
      messages,
      params,
      ...(preludeChunks ? { preludeChunks } : {}),
      executeFullAnswer: async ({ emitToolEvent, emitExecutionNode }) => {
        if (agentEnabled) {
          const goalText = latestUserMessage.content.trim();
          const { run, output } = await createAndRunAgent({
            threadId,
            userId: authUserId,
            goalText: goalText || "回答用户当前问题",
            assistantMessageId,
            assistantParentId: latestUserMessageId,
            messages: agentMessages ?? messages,
            requestContextMessages,
            params,
            knowledgeBaseId,
            workspaceRoot,
            requestedToolGroupIds,
            onExecutionNode: emitExecutionNode,
          });

          agentAssistantMetadata = {
            agent: {
              status: output.status,
              runId: run.id,
              traceId: run.traceId,
              ...(output.pendingApproval
                ? { pendingApproval: output.pendingApproval }
                : {}),
              ...(output.blockedReason
                ? { blockedReason: output.blockedReason }
                : {}),
              ...(output.terminalReason
                ? { terminalReason: output.terminalReason }
                : {}),
              ...(output.errorMessage ? { errorMessage: output.errorMessage } : {}),
            },
          };

          if (run.status === "cancelled") {
            return {
              answer: "Agent 运行已取消。",
              isFinal: true,
            };
          }

          if (output.pendingApproval) {
            return {
              answer: "等待审批",
              isFinal: false,
            };
          }

          const durableAnswer =
            output.answer.trim() ||
            (output.status === "waiting_user"
              ? "Agent 正在等待你的输入。"
              : output.status === "failed"
                ? "Agent 运行失败。"
                : output.status === "blocked"
                  ? "Agent 已阻断，请检查运行状态。"
                  : "Agent 已完成。");

          return {
            answer: durableAnswer,
            isFinal: true,
          };
        }

        const toolLoopResult = await executeDefaultChatToolLoop({
          requestedProvider: "default",
          threadId,
          userId: authUserId,
          agentEnabled: false,
          messages,
          params,
          onToolEvent: emitToolEvent,
          onExecutionNode: emitExecutionNode,
        });

        if (toolLoopResult) {
          return toolLoopResult.answer;
        }

        return providerProxyService.generateTextForRole("llm", messages, params);
      },
      onComplete: async ({ answer, finishReason }) => {
        if (finishReason !== "stop" || !answer.trim()) {
          return;
        }

        if (!agentEnabled) {
          persistAssistantMessage({
            threadId,
            userId: authUserId,
            assistantMessageId,
            parentId: latestUserMessageId,
            content: answer,
            ...(agentAssistantMetadata ? { metadata: agentAssistantMetadata } : {}),
          });
        }

        void (async () => {
          try {
            const currentThread = threadService.getThreadSummaryById(
              threadId,
              authUserId,
            );
            const latestUserText = getLatestUserTitleSeed(latestUserMessage);
            if (latestUserText && shouldGenerateTitle(currentThread?.title)) {
              const title = await generateThreadTitleFromMessages({
                question: latestUserText,
                answer,
                streamTaskChatText: (titleMessages) =>
                  providerProxyService.streamTaskChatText(titleMessages),
              });
              threadService.updateThread(threadId, authUserId, {
                title,
              });
            }
          } catch (titleError) {
            const fallbackTitle = getFallbackThreadTitle(
              getLatestUserTitleSeed(latestUserMessage),
            );
            if (
              shouldGenerateTitle(
                threadService.getThreadSummaryById(threadId, authUserId)?.title,
              ) &&
              fallbackTitle !== "新对话"
            ) {
              threadService.updateThread(threadId, authUserId, {
                title: fallbackTitle,
              });
            }
            app.log.warn(
              { err: titleError, threadId, fallbackTitle },
              "[proxy-provider] failed to generate non-RAG thread title",
            );
          }
        })();
      },
    }),
  );
};

export const registerProxyProviderChatRoutes = async (
  app: FastifyInstance,
) => {
  const taskDefaultChatRoute = PUBLIC_API_ROUTES.taskDefaultChat;
  const providerChatRoute = PUBLIC_API_ROUTES.providerChat;

  app.post<{ Body: ChatMessagesBody }>(
    taskDefaultChatRoute.path,
    {
      attachValidation: true,
      schema: proxyProviderRouteSchemas.taskDefaultChat,
    },
    routeHandler("Task chat failed", async (request, reply) => {
      const validationResponse = handleValidationError(request, reply);
      if (validationResponse) {
        return validationResponse;
      }

      const messages = normalizeProxyChatMessages(request.body.messages);

      if (messages.length === 0) {
        throw badRequest("No valid task messages provided");
      }

      prepareEventStreamReply(reply);

      return reply.send(providerProxyService.streamTaskChat(messages));
    }),
  );

  app.post<{
    Params: ProviderChatParams;
    Body: ProviderChatBody;
  }>(
    providerChatRoute.path,
    {
      attachValidation: true,
      schema: proxyProviderRouteSchemas.providerChat,
    },
    routeHandler("Provider chat failed", async (request, reply) => {
      const validationResponse = handleValidationError(request, reply);
      if (validationResponse) {
        return validationResponse;
      }

      const messages = normalizeProxyChatMessages(request.body.messages);

      if (messages.length === 0) {
        throw badRequest("No valid chat messages provided");
      }

      if (request.params.provider === "default") {
        const threadId = request.body.id;
        const authUser = request.authUser;
        const thread = resolveDefaultProviderThread(threadId, authUser?.id);
        const agentEnabled =
          typeof request.body.agentEnabled === "boolean"
            ? request.body.agentEnabled
            : resolveThreadAgentEnabled(threadId, authUser?.id);
        const requestContextContext = collectThreadRequestContext(
          threadId,
          authUser?.id,
          { agentEnabled },
        );
        const requestContextMessages = requestContextContext.messages;
        const ragInput = toRagInput(messages);
        const roleLlmParams = resolveThreadRoleLlmParams(threadId, authUser?.id);
        const useThreadRag = shouldUseThreadRag({
          knowledgeBaseId: thread?.knowledgeBaseId,
          ragInput,
          threadId,
          hasAuthUser: Boolean(authUser),
        });

        if (!agentEnabled && useThreadRag && authUser && ragInput && typeof threadId === "string") {
          return sendRagChatStream({
            app,
            reply,
            threadId,
            authUserId: authUser.id,
            userMessageId: request.body.messageId,
            ragInput,
            messages,
            requestContextMessages,
            requestContextPreludeChunks: requestContextContext.executionNodes.map(
              (node) => toAssistantExecutionNodePrelude(node),
            ),
          });
        }

        const defaultChatMessages = [
          ...requestContextMessages,
          ...messages,
        ];

        if (thread?.knowledgeBaseId) {
          app.log.warn(
            {
              scope: "proxy-provider",
              event: "rag-branch-skipped",
              hasThreadId: typeof threadId === "string",
              hasAuthUser: Boolean(authUser),
              hasRagInput: Boolean(ragInput),
              threadFound: Boolean(thread),
              knowledgeBaseId: thread.knowledgeBaseId,
              threadId,
            },
            "[proxy-provider] knowledge-base thread skipped RAG branch",
          );
        }

        if (typeof threadId === "string" && authUser) {
          return sendPersistedDefaultChatStream({
            app,
            reply,
            threadId,
            authUserId: authUser.id,
            userMessageId: request.body.messageId,
            messages: defaultChatMessages,
            agentMessages: messages,
            requestContextMessages,
            params: roleLlmParams,
            agentEnabled,
            requestedToolGroupIds: request.body.requestedToolGroupIds,
            knowledgeBaseId: thread?.knowledgeBaseId ?? null,
            preludeChunks: [],
          });
        }
      }

      prepareEventStreamReply(reply);
      return reply.send(
        providerProxyService.streamChat(
          request.params.provider as ProxyProviderParam,
          messages,
        ),
      );
    }),
  );
};
