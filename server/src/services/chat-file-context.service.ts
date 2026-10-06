import fs from "node:fs/promises";
import { getHarnessEnvironmentSnapshot } from "@/harness/environment.js";
import { readStructuredDocument } from "@/mcp/document-readers.js";
import path from "node:path";
import { attachmentStorageService } from "./attachment-storage.service.js";
import type {
  NormalizedChatMessage,
  NormalizedChatMessagePart,
} from "./provider-proxy.message-protocol.js";

type FilePart = Extract<NormalizedChatMessagePart, { type: "file" }>;

export type MaterializedChatFileAttachment = {
  fileId?: string;
  filename: string;
  mimeType: string;
  relativePath: string;
  absolutePath: string;
};

const AGENT_ATTACHMENT_STAGING_ROOT = [
  ".mira",
  "staging",
  "chat-attachments",
] as const;
const ASSISTANT_CLARIFICATION_PATTERN =
  /(?:请(?:提供|告诉|补充|确认|选择)|需要(?:你|您).*?(?:提供|确认|选择|补充)|为了.*?(?:请|需要)|以下(?:信息|参数)|[?？])/i;
const TASK_RESET_OR_SWITCH_PATTERN =
  /(?:新话题|换个话题|另外问|另一个问题|顺便问|算了吧?|不用了|取消|停止|结束|别做了)/i;
const NEW_TASK_ACTION_PATTERN =
  /^(?:帮我|请(?:你)?|给我|做(?:一个|一份|个)?|生成|创建|写(?:一|个|份)?|查(?:一|下)?|搜索|分析|整理|设计|制作|开发|实现|解释|告诉我)/i;

export const chatFileContextNode = {
  process(input: { text: string }) {
    return input.text;
  },
};

const getAttachmentFileName = (source: string) => {
  if (!attachmentStorageService.isInternalAttachmentUrl(source)) {
    return null;
  }

  const parsed = new URL(source, "http://localhost");
  return decodeURIComponent(parsed.pathname.slice("/attachments/".length));
};

const getLatestUserMessageIndex = (messages: NormalizedChatMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
};

const getPreviousUserMessage = (
  messages: NormalizedChatMessage[],
  beforeIndex: number,
) => {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index];
  }
  return undefined;
};

const getPreviousAssistantContent = (
  messages: NormalizedChatMessage[],
  beforeIndex: number,
) => {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message.content.trim();
  }
  return "";
};

const getFileParts = (message: NormalizedChatMessage | undefined): FilePart[] =>
  (message?.parts ?? []).filter(
    (part): part is FilePart => part.type === "file",
  );

const isImmediateClarificationReply = (input: {
  query: string;
  previousAssistantContent: string;
}) => {
  const query = input.query.trim();
  if (!query || query.length > 500) return false;
  if (TASK_RESET_OR_SWITCH_PATTERN.test(query)) return false;
  if (NEW_TASK_ACTION_PATTERN.test(query)) return false;
  return ASSISTANT_CLARIFICATION_PATTERN.test(input.previousAssistantContent);
};

/**
 * Selects only files belonging to the current user action:
 * - files attached to the latest user message; or
 * - files from the immediately preceding user message when the latest message
 *   is a direct clarification reply (for example a Skill style selection).
 *
 * It intentionally does not scan the full thread, so unrelated historical
 * attachments never become implicit Agent inputs.
 */
export const selectAgentTaskFileParts = (
  messages: NormalizedChatMessage[],
): FilePart[] => {
  const latestUserIndex = getLatestUserMessageIndex(messages);
  if (latestUserIndex < 0) return [];

  const latestUserMessage = messages[latestUserIndex];
  const latestFileParts = getFileParts(latestUserMessage);
  if (latestFileParts.length > 0) return latestFileParts;

  const previousAssistantContent = getPreviousAssistantContent(
    messages,
    latestUserIndex,
  );
  if (
    !isImmediateClarificationReply({
      query: latestUserMessage?.content ?? "",
      previousAssistantContent,
    })
  ) {
    return [];
  }

  return getFileParts(getPreviousUserMessage(messages, latestUserIndex));
};

const sanitizeMaterializedFileName = (
  fileName: string,
  fallback: string,
) => {
  const baseName = path.basename(fileName).trim();
  const safeName = baseName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "");
  return safeName || fallback;
};

const toPortableRelativePath = (value: string) =>
  value.split(path.sep).join("/");

/**
 * Copies the current task's managed chat attachments into the active workspace
 * so existing workspace-bound tools and forked Skills can consume them.
 * Manually placed workspace files are untouched and require no materialization.
 */
export const materializeAgentTaskFileAttachments = async (input: {
  messages: NormalizedChatMessage[];
  workspaceRoot?: string | null;
}): Promise<MaterializedChatFileAttachment[]> => {
  const workspaceRoot = input.workspaceRoot?.trim();
  if (!workspaceRoot) return [];

  const selectedParts = selectAgentTaskFileParts(input.messages);
  if (selectedParts.length === 0) return [];

  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const results: MaterializedChatFileAttachment[] = [];

  for (const part of selectedParts) {
    const storedFileName = getAttachmentFileName(part.data);
    if (!storedFileName) continue;

    const stored = await attachmentStorageService.read(storedFileName);
    const stableId = (
      part.fileId?.trim() || path.parse(storedFileName).name || "attachment"
    ).replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeName = sanitizeMaterializedFileName(
      part.filename,
      storedFileName,
    );
    const relativePath = path.join(
      ...AGENT_ATTACHMENT_STAGING_ROOT,
      stableId,
      safeName,
    );
    const absolutePath = path.resolve(resolvedWorkspaceRoot, relativePath);
    const relativeToWorkspace = path.relative(
      resolvedWorkspaceRoot,
      absolutePath,
    );
    if (
      relativeToWorkspace.startsWith("..") ||
      path.isAbsolute(relativeToWorkspace)
    ) {
      throw new Error(`Attachment path escapes workspace: ${part.filename}`);
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, stored.buffer);
    results.push({
      ...(part.fileId ? { fileId: part.fileId } : {}),
      filename: part.filename,
      mimeType: part.mimeType,
      relativePath: toPortableRelativePath(relativeToWorkspace),
      absolutePath,
    });
  }

  return results;
};

export const buildAgentAttachmentGoalContext = (
  attachments: MaterializedChatFileAttachment[],
) => {
  if (attachments.length === 0) return "";

  return [
    "[本轮任务可用上传附件]",
    ...attachments.map(
      (attachment) =>
        `- ${attachment.filename} (${attachment.mimeType}) -> ${attachment.relativePath}`,
    ),
    "这些路径位于当前工作区内，已知文件应直接交给 canonical read；只有真实命令、进程、git、build 或 test 才需要 terminal。用户若明确指定工作区已有文件，仍按用户提供的路径处理，不要改用上传附件。",
  ].join("\n");
};

export const parseChatFilePart = async (part: FilePart) => {
  const fileName = getAttachmentFileName(part.data);
  if (!fileName) {
    throw new Error(`File attachment is not managed by the local parser: ${part.filename}`);
  }

  const filePath = path.join(attachmentStorageService.root, fileName);
  const parsed = await readStructuredDocument(
    getHarnessEnvironmentSnapshot(),
    filePath,
  );

  return chatFileContextNode.process({
    text: [
      `[文件: ${part.filename}]`,
      `[类型: ${part.mimeType}]`,
      parsed.text,
      `[文件结束: ${part.filename}]`,
    ].join("\n"),
  });
};

export const resolveMessagesForGenerate = async (
  messages: NormalizedChatMessage[],
) => {
  const latestUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index;

  if (latestUserIndex === undefined) {
    return messages;
  }

  const latestUserMessage = messages[latestUserIndex];
  if (!latestUserMessage?.parts?.some((part) => part.type === "file")) {
    return messages;
  }

  const fileContext = await Promise.all(
    latestUserMessage.parts
      .filter((part): part is FilePart => part.type === "file")
      .map(parseChatFilePart),
  );

  const textPart = fileContext.join("\n\n");
  const nextParts = latestUserMessage.parts
    .filter((part) => part.type !== "file")
    .concat({ type: "text", text: textPart });

  return messages.map((message, index) => {
    if (index !== latestUserIndex) {
      return message;
    }

    return {
      ...message,
      content: nextParts
        .filter((part): part is Extract<NormalizedChatMessagePart, { type: "text" }> =>
          part.type === "text",
        )
        .map((part) => part.text)
        .join("\n"),
      parts: nextParts,
    };
  });
};

export const removeFileAttachmentsFromParts = (parts: unknown) => {
  if (!Array.isArray(parts)) {
    return;
  }

  for (const part of parts) {
    if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "file") {
      continue;
    }

    const source = (part as { data?: unknown }).data;
    if (typeof source !== "string" || !attachmentStorageService.isInternalAttachmentUrl(source)) {
      continue;
    }

    const fileName = getAttachmentFileName(source);
    if (fileName) {
      attachmentStorageService.removeSync(fileName);
    }
  }
};

export const removeFileAttachmentsRemovedFromParts = (
  previousParts: unknown,
  nextParts: unknown,
) => {
  const retainedSources = new Set(
    Array.isArray(nextParts)
      ? nextParts.flatMap((part) => {
          if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "file") {
            return [];
          }
          const source = (part as { data?: unknown }).data;
          return typeof source === "string" ? [source] : [];
        })
      : [],
  );

  if (!Array.isArray(previousParts)) {
    return;
  }

  removeFileAttachmentsFromParts(
    previousParts.filter((part) => {
      if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "file") {
        return false;
      }
      const source = (part as { data?: unknown }).data;
      return typeof source === "string" && !retainedSources.has(source);
    }),
  );
};
