import {
  getHarnessLlmContentImages,
  type HarnessLlmContent,
} from "@/harness/llm-content";
import { getHarnessInvocationModelContent } from "@/harness/invocations";
import type {
  NormalizedChatMessage,
  NormalizedChatMessagePart,
} from "@/services/provider-proxy.message-protocol";

export type NormalizedImageMessagePart = Extract<
  NormalizedChatMessagePart,
  { type: "image" }
>;

export const projectHarnessImagesToMessageParts = (
  content: HarnessLlmContent | undefined,
): NormalizedImageMessagePart[] =>
  getHarnessLlmContentImages(content).map((block) => ({
    type: "image",
    image: `data:${block.mimeType};base64,${block.data}`,
    ...(block.filename ? { filename: block.filename } : {}),
    mediaType: block.mimeType,
  }));

export const getInvocationImageMessageParts = (
  invocationId: string | undefined,
): NormalizedImageMessagePart[] =>
  invocationId
    ? projectHarnessImagesToMessageParts(
        getHarnessInvocationModelContent(invocationId),
      )
    : [];

export const appendHarnessImagesToLatestUserMessage = (
  messages: NormalizedChatMessage[],
  imageParts: NormalizedImageMessagePart[],
): NormalizedChatMessage[] => {
  if (imageParts.length === 0) return messages;

  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (latestUserIndex < 0) return messages;

  return messages.map((message, index) => {
    if (index !== latestUserIndex) return message;
    const existingParts =
      message.parts?.length
        ? message.parts
        : message.content.trim()
          ? [{ type: "text" as const, text: message.content }]
          : [];
    return {
      ...message,
      parts: [...existingParts, ...imageParts],
    };
  });
};
