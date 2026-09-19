import { prepareAgentHtmlPreview } from "@/agent/html-preview.js";
import { memoryService } from "@/memory/runtime.js";
import { shouldCommitTurnToMemory } from "@/memory/turn-commit-policy.js";
import { threadService } from "@/services/thread.service.js";
import type { NormalizedChatMessage } from "@/services/provider-proxy.service/index.js";
import {
  getNormalizedMessageText,
  hasNormalizedMessageParts,
} from "@/services/provider-proxy.message-protocol.js";
import { toUserMessageMetadata } from "./rag-message-metadata.js";

const THINK_TAG_REGEX = /<think\b[^>]*>[\s\S]*?<\/think\s*>/gi;

const cleanGeneratedTitle = (title: string) =>
  title
    .replace(THINK_TAG_REGEX, "")
    .trim()
    .replace(/^["'""''"]+|["'""''"]+$/g, "")
    .slice(0, 50);

const trimTitleFallback = (title: string) => cleanGeneratedTitle(title).slice(0, 20);

export const shouldGenerateTitle = (title: string | undefined) => {
  const normalizedTitle = title?.trim();
  return !normalizedTitle || normalizedTitle === "新对话";
};

const describeMessageForTitle = (
  message: NormalizedChatMessage | undefined,
) => {
  const text = getNormalizedMessageText(message);
  if (text) {
    return text;
  }

  const parts = message?.parts ?? [];
  if (parts.length === 0) {
    return "";
  }

  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text.trim();
      }

      if (part.type === "image") {
        return part.filename?.trim()
          ? `[图片: ${part.filename.trim()}]`
          : "[图片]";
      }

      return part.filename.trim()
        ? `[文件: ${part.filename.trim()}]`
        : "[文件]";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
};

export interface PersistVisibleUserMessageInput {
  threadId: string;
  userId: number;
  userMessageId?: string;
  messages: NormalizedChatMessage[];
}

export interface PersistedUserMessageResult {
  latestUserMessageId: string;
  latestUserParentId: string | null;
  latestUserMessage: NormalizedChatMessage;
}

export const persistVisibleUserMessage = ({
  threadId,
  userId,
  userMessageId,
  messages,
}: PersistVisibleUserMessageInput): PersistedUserMessageResult => {
  const latestUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index;
  const latestUserMessage = messages[latestUserIndex ?? -1];
  const previousVisibleMessage =
    latestUserIndex !== undefined && latestUserIndex > 0
      ? messages[latestUserIndex - 1]
      : undefined;
  const latestUserMessageId =
    typeof latestUserMessage?.id === "string" && latestUserMessage.id.trim()
      ? latestUserMessage.id
      : typeof userMessageId === "string" && userMessageId.trim()
        ? userMessageId
        : crypto.randomUUID();
  const latestUserParentId =
    typeof previousVisibleMessage?.id === "string"
      ? previousVisibleMessage.id
      : null;

  if (!latestUserMessage || !hasNormalizedMessageParts(latestUserMessage)) {
    throw new Error("Latest user message is missing");
  }

  const latestUserText = getNormalizedMessageText(latestUserMessage);

  threadService.createMessage(threadId, userId, {
    id: latestUserMessageId,
    parentId: latestUserParentId,
    role: "user",
    content: latestUserText,
    parts: latestUserMessage.parts,
    metadata: toUserMessageMetadata(latestUserMessage, latestUserParentId),
  });

  return {
    latestUserMessageId,
    latestUserParentId,
    latestUserMessage,
  };
};

export interface PersistAssistantMessageInput {
  threadId: string;
  userId: number;
  assistantMessageId: string;
  parentId: string | null;
  content: string;
  parts?: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "image";
        image: string;
        filename?: string;
        fileId?: string;
        mediaType?: string;
      }
    | {
        type: "file";
        data: string;
        filename: string;
        fileId?: string;
        mimeType: string;
      }
    | {
        type: "data";
        name: string;
        value: unknown;
      }
  >;
  metadata?: Record<string, unknown>;
}

const shouldClearStaleApprovalPlaceholder = (
  content: string,
  metadata: Record<string, unknown> | undefined,
) => {
  if (content.trim() !== "等待审批") {
    return false;
  }

  const agent =
    metadata?.agent &&
    typeof metadata.agent === "object" &&
    !Array.isArray(metadata.agent)
      ? (metadata.agent as { status?: unknown })
      : undefined;

  return (
    agent?.status === "queued" ||
    agent?.status === "running" ||
    agent?.status === "completed" ||
    agent?.status === "failed" ||
    agent?.status === "blocked" ||
    agent?.status === "cancelled"
  );
};

export const persistAssistantMessage = ({
  threadId,
  userId,
  assistantMessageId,
  parentId,
  content,
  parts,
  metadata,
}: PersistAssistantMessageInput) => {
  const clearApprovalPlaceholder = shouldClearStaleApprovalPlaceholder(
    content,
    metadata,
  );
  const baseContent = clearApprovalPlaceholder ? "" : content;
  const normalizedContent = prepareAgentHtmlPreview({
    content: baseContent,
    metadata,
  });
  const previewMarkerAdded = normalizedContent !== baseContent;
  const cleanedParts = clearApprovalPlaceholder
    ? parts?.filter(
        (part) => part.type !== "text" || part.text.trim() !== "等待审批",
      )
    : parts;
  const normalizedParts = previewMarkerAdded
    ? [
        {
          type: "text" as const,
          text: normalizedContent,
        },
        ...(cleanedParts ?? []).filter((part) => part.type !== "text"),
      ]
    : cleanedParts && cleanedParts.length > 0
      ? cleanedParts
      : normalizedContent.trim()
        ? [
            {
              type: "text" as const,
              text: normalizedContent,
            },
          ]
        : [];

  if (!normalizedContent.trim() && normalizedParts.length === 0) {
    return;
  }

  const agentMetadata =
    metadata?.agent &&
    typeof metadata.agent === "object" &&
    !Array.isArray(metadata.agent)
      ? metadata.agent
      : undefined;

  const persisted = threadService.createMessage(threadId, userId, {
    id: assistantMessageId,
    parentId,
    role: "assistant",
    content: normalizedContent,
    parts: normalizedParts,
    metadata,
    ...(agentMetadata ? { preserveDescendants: true } : {}),
  });

  if (shouldCommitTurnToMemory(metadata) && parentId) {
    const userMessage = threadService.getMessageById(parentId, userId);
    if (userMessage?.role === "user" && userMessage.content.trim()) {
      void memoryService
        .commitTurn({
          userId,
          source: {
            type: "conversation",
            threadId,
            userMessageId: userMessage.id,
            assistantMessageId: persisted.id,
          },
          userText: userMessage.content,
          assistantText: persisted.content,
        })
        .catch((error: unknown) => {
          console.warn("[memory] failed to consolidate committed turn", {
            threadId,
            userMessageId: userMessage.id,
            assistantMessageId: persisted.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
  }

  return persisted;
};

export const generateThreadTitleFromMessages = async ({
  question,
  answer,
  streamTaskChatText,
}: {
  question: string;
  answer: string;
  streamTaskChatText: (
    messages: Array<{
      role: "user";
      content: string;
    }>,
  ) => AsyncIterable<string>;
}) => {
  const prompt =
    "请根据以下对话内容生成一个简短的中文标题（不超过20个字符），只返回标题本身，不要解释。\n\n" +
    `用户：${question}\n助手：${answer.slice(0, 500)}`;

  let title = "";
  for await (const delta of streamTaskChatText([
    {
      role: "user",
      content: prompt,
    },
  ])) {
    title += delta;
    if (title.length >= 80) {
      break;
    }
  }

  return cleanGeneratedTitle(title) || "新对话";
};

export const getLatestUserTitleSeed = (message: NormalizedChatMessage | undefined) =>
  describeMessageForTitle(message);

export const getFallbackThreadTitle = (
  seed: string | undefined,
) => {
  const normalizedSeed = seed?.trim();
  if (!normalizedSeed) {
    return "新对话";
  }

  if (/^\[[^\]]+\]$/.test(normalizedSeed)) {
    return cleanGeneratedTitle(normalizedSeed) || "新对话";
  }

  const firstSentence =
    normalizedSeed
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.split(/(?<=[。！？!?]|\. )/)
      .map((segment) => segment.trim())
      .find(Boolean) ?? normalizedSeed;

  return trimTitleFallback(firstSentence) || "新对话";
};
