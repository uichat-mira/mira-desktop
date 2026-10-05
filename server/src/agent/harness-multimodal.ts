import {
  getHarnessLlmContentImages,
  type HarnessLlmContent,
} from "@/harness/llm-content";
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

export const appendHarnessImagesToLatestUserMessage = (
  messages: NormalizedChatMessage[],
  imageParts: NormalizedImageMessagePart[],
): NormalizedChatMessage[] => {
  if (imageParts.length === 0) {
    return messages;
  }

  const latestUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === "user")?.index;

  if (latestUserIndex === undefined) {
    return messages;
  }

  return messages.map((message, index) => {
    if (index !== latestUserIndex) {
      return message;
    }
    const textParts =
      message.parts?.filter((part) => part.type === "text") ?? [];
    return {
      ...message,
      parts: [
        ...(textParts.length > 0
          ? textParts
          : message.content.trim()
            ? [{ type: "text" as const, text: message.content }]
            : []),
        ...imageParts,
      ],
    };
  });
};
