import {
  chatWorkspaceRepository,
  messageRepository,
  knowledgeBaseRepository,
  threadRepository,
  type ThreadListFilters,
  type ThreadWithMessageCount,
} from "@/db/repositories";
import type { Message, MessageRole, Thread, ThreadStatus } from "@/db/schema";
import { threadContextSummaryNode } from "@/services/shared-nodes/thread-context-summary.node.js";
import { isValidWorkspaceRootPath } from "@/services/workspace-path-validation.js";
import { THREAD_ACCESS_ERROR_MESSAGE } from "@/utils/errors.js";
import { chatMediaService } from "@/services/chat-media.service.js";
import { conversationWorkdirService } from "@/services/conversation-workdir.service.js";
import { getHarnessEnvironmentSnapshot } from "@/harness/environment.js";
import {
  removeFileAttachmentsFromParts,
  removeFileAttachmentsRemovedFromParts,
} from "@/services/chat-file-context.service.js";

export interface ThreadResponse {
  id: string;
  title: string;
  modelName: string | null;
  workspaceId: string | null;
  knowledgeBaseId: string | null;
  roleId: string | null;
  agentEnabled: boolean;
  ttsEnabled: boolean;
  imageEnabled: boolean;
  contextSummary: string | null;
  contextSummaryUpdatedAt: string | null;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage?: string;
}

export interface MessageResponse {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  parts: Array<
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
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ThreadWithMessagesResponse extends ThreadResponse {
  messages: MessageResponse[];
}

export interface CreateThreadInput {
  userId: number;
  title?: string;
  modelName?: string;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  roleId?: string | null;
  agentEnabled?: boolean | null;
  ttsEnabled?: boolean | null;
  imageEnabled?: boolean | null;
  contextSummary?: string | null;
}

const normalizeWorkspaceRootPath = (value: string) => value.trim();

const DEFAULT_WORKSPACE_NAME = "Mira BASE";

export interface ChatWorkspaceResponse {
  id: string;
  name: string;
  rootPath: string | null;
  isDefault: boolean;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface CreateChatWorkspaceInput {
  userId: number;
  name: string;
  rootPath?: string | null;
}

export interface CreateMessageInput {
  id?: string;
  parentId?: string | null;
  role: MessageRole;
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
  /** Update this message in place without pruning later messages in the thread. */
  preserveDescendants?: boolean;
}

const parsePartsJson = (
  partsJson: string | null | undefined,
): MessageResponse["parts"] | null => {
  if (!partsJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(partsJson) as MessageResponse["parts"];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const serializeParts = (parts: CreateMessageInput["parts"]) =>
  parts ? JSON.stringify(parts) : undefined;

const pruneThreadTail = (
  threadId: string,
  anchorMessageId: string | null,
  preserveMessageId?: string,
) => {
  const threadMessages = messageRepository.listByThread(threadId);
  const anchorIndex =
    anchorMessageId === null
      ? -1
      : threadMessages.findIndex((message) => message.id === anchorMessageId);

  if (anchorMessageId !== null && anchorIndex < 0) {
    return;
  }

  const trailingMessages = threadMessages.slice(anchorIndex + 1);

  for (const message of trailingMessages) {
    if (message.id === preserveMessageId) {
      continue;
    }

    messageRepository.deleteById(message.id);
    removeFileAttachmentsFromParts(parsePartsJson(message.partsJson));
    chatMediaService.removeForMessages([message.id]);
  }
};

const getBranchParentIdFromMetadata = (
  metadata: Record<string, unknown> | undefined,
) => {
  const lineage =
    metadata?.lineage &&
    typeof metadata.lineage === "object" &&
    !Array.isArray(metadata.lineage)
      ? (metadata.lineage as { parentId?: unknown })
      : undefined;
  const lineageParentId = lineage?.parentId;
  if (typeof lineageParentId === "string" || lineageParentId === null) {
    return lineageParentId;
  }

  return undefined;
};

const isLegacyAssistantUiTextSuppressed = (
  metadata: Record<string, unknown>,
) =>
  metadata.assistantUi &&
  typeof metadata.assistantUi === "object" &&
  !Array.isArray(metadata.assistantUi) &&
  (metadata.assistantUi as { textWasEmpty?: unknown }).textWasEmpty === true;

const toThreadResponse = (
  thread: Thread,
  messages?: Message[],
): ThreadResponse => {
  const messageCount = messages?.length ?? 0;
  const lastMessage = messages?.length
    ? messages[messages.length - 1].content.substring(0, 50) +
      (messages[messages.length - 1].content.length > 50 ? "..." : "")
    : undefined;

  return {
    id: thread.id,
    title: thread.title || "新对话",
    modelName: thread.modelName ?? null,
    workspaceId: thread.workspaceId ?? null,
    knowledgeBaseId: thread.knowledgeBaseId,
    roleId: thread.roleId ?? null,
    agentEnabled: thread.agentEnabled ?? false,
    ttsEnabled: thread.ttsEnabled ?? false,
    imageEnabled: thread.imageEnabled ?? false,
    contextSummary: thread.contextSummary ?? null,
    contextSummaryUpdatedAt: thread.contextSummaryUpdatedAt ?? null,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount,
    lastMessage,
  };
};

// 优化版本：从预计算的统计数据转换
const toThreadResponseFromStats = (
  thread: ThreadWithMessageCount,
): ThreadResponse => {
  const lastMessage = thread.lastMessageContent
    ? thread.lastMessageContent.substring(0, 50) +
      (thread.lastMessageContent.length > 50 ? "..." : "")
    : undefined;

  return {
    id: thread.id,
    title: thread.title || "新对话",
    modelName: thread.modelName ?? null,
    workspaceId: thread.workspaceId ?? null,
    knowledgeBaseId: thread.knowledgeBaseId,
    roleId: thread.roleId ?? null,
    agentEnabled: thread.agentEnabled ?? false,
    ttsEnabled: thread.ttsEnabled ?? false,
    imageEnabled: thread.imageEnabled ?? false,
    contextSummary: thread.contextSummary ?? null,
    contextSummaryUpdatedAt: thread.contextSummaryUpdatedAt ?? null,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messageCount,
    lastMessage,
  };
};

const toChatWorkspaceResponse = (
  workspace: {
    id: string;
    name: string;
    rootPath: string | null;
    status: "active" | "archived";
    createdAt: string;
    updatedAt: string;
  },
): ChatWorkspaceResponse => ({
  id: workspace.id,
  name: workspace.name,
  rootPath: workspace.rootPath ?? null,
  isDefault:
    Boolean(workspace.rootPath) &&
    workspace.rootPath === getHarnessEnvironmentSnapshot().workspace.rootPath,
  status: workspace.status,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
});

const toMessageParts = (
  content: string,
  metadata: Record<string, unknown>,
): MessageResponse["parts"] => {
  const parts: MessageResponse["parts"] = [];
  const hasContent = content.trim().length > 0;
  const suppressLegacyText = isLegacyAssistantUiTextSuppressed(metadata);

  // Legacy rows without canonical parts may still carry placeholder content
  // for image-only messages. Keep honoring that metadata during readback only.
  if (hasContent && !suppressLegacyText) {
    parts.push({
      type: "text",
      text: content,
    });
  }

  return parts;
};

const toMessageResponse = (message: Message): MessageResponse => {
  let metadata: Record<string, unknown> = {};
  if (message.metadata) {
    try {
      metadata = JSON.parse(message.metadata);
    } catch {
      metadata = {};
    }
  }
  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    content: message.content,
    parts:
      parsePartsJson((message as Message & { partsJson?: string | null }).partsJson) ??
      toMessageParts(message.content, metadata),
    metadata,
    createdAt: message.createdAt,
  };
};

export interface GetThreadInput {
  id: string;
  userId?: number;
}

export const threadService = {
  listThreads(filters: ThreadListFilters): ThreadResponse[] {
    // 使用优化后的查询，一次性获取线程列表及其消息统计（避免 N+1 问题）
    const threadsWithStats = threadRepository.listWithMessageStats(filters);
    return threadsWithStats.map(toThreadResponseFromStats);
  },

  getThreadById(
    id: string,
    userId?: number,
  ): ThreadWithMessagesResponse | null {
    const result = threadRepository.findByIdWithMessages(id, userId);
    if (!result) {
      return null;
    }

    return {
      ...toThreadResponse(result.thread, result.messages),
      messages: result.messages.map(toMessageResponse),
    };
  },

  getThreadSummaryById(id: string, userId?: number): ThreadResponse | null {
    const thread = threadRepository.findById(id, userId);
    if (!thread) {
      return null;
    }

    return toThreadResponse(thread, messageRepository.listByThread(thread.id));
  },

  async generateContextSummary(
    id: string,
    userId: number,
  ): Promise<Pick<ThreadResponse, "contextSummary" | "contextSummaryUpdatedAt"> | null> {
    const thread = threadRepository.findById(id, userId);
    if (!thread) {
      return null;
    }

    const messages = messageRepository.listByThread(id).map(toMessageResponse);
    const generated = await threadContextSummaryNode.generate(messages);
    const updated = threadRepository.updateById(id, {
      contextSummary: generated.contextSummary || null,
      contextSummaryUpdatedAt: generated.contextSummaryUpdatedAt,
    });

    return {
      contextSummary: updated?.contextSummary ?? generated.contextSummary ?? null,
      contextSummaryUpdatedAt:
        updated?.contextSummaryUpdatedAt ?? generated.contextSummaryUpdatedAt ?? null,
    };
  },

  listChatWorkspaces(userId: number): ChatWorkspaceResponse[] {
    if (getHarnessEnvironmentSnapshot().workspace.rootPath?.trim()) {
      this.ensureDefaultChatWorkspace(userId);
    }
    return chatWorkspaceRepository
      .list({ userId, status: "active" })
      .map(toChatWorkspaceResponse);
  },

  ensureDefaultChatWorkspace(userId: number): ChatWorkspaceResponse {
    const rootPath = getHarnessEnvironmentSnapshot().workspace.rootPath?.trim();
    if (!rootPath) {
      throw new Error("Default workspace root is not configured");
    }

    const existing = chatWorkspaceRepository
      .list({ userId, status: "active", sortOrder: "asc" })
      .find((workspace) => workspace.rootPath === rootPath);
    if (existing) {
      if (existing.name !== DEFAULT_WORKSPACE_NAME) {
        const renamed = chatWorkspaceRepository.updateById(existing.id, {
          name: DEFAULT_WORKSPACE_NAME,
        });
        return toChatWorkspaceResponse(renamed ?? existing);
      }
      return toChatWorkspaceResponse(existing);
    }

    return toChatWorkspaceResponse(
      chatWorkspaceRepository.create({
        userId,
        name: DEFAULT_WORKSPACE_NAME,
        rootPath,
        status: "active",
      }),
    );
  },

  getThreadWorkspaceRoot(threadId: string, userId: number): string | null {
    const thread = threadRepository.findById(threadId, userId);
    if (!thread?.workspaceId) {
      return null;
    }

    const workspace = chatWorkspaceRepository.findById(thread.workspaceId, userId);
    return workspace?.rootPath ?? null;
  },

  createChatWorkspace(input: CreateChatWorkspaceInput): ChatWorkspaceResponse {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Workspace name is required");
    }

    const rootPath = input.rootPath ? normalizeWorkspaceRootPath(input.rootPath) : "";
    if (!rootPath) {
      throw new Error("Workspace root path is required");
    }
    if (!isValidWorkspaceRootPath(rootPath)) {
      throw new Error("Workspace root path is invalid");
    }
    const created = chatWorkspaceRepository.create({
      userId: input.userId,
      name,
      rootPath,
      status: "active",
    });

    return toChatWorkspaceResponse(created);
  },

  updateChatWorkspace(
    id: string,
    userId: number,
    input: {
      name?: string;
      rootPath?: string | null;
    },
  ): ChatWorkspaceResponse | null {
    const existing = chatWorkspaceRepository.findById(id, userId);
    if (!existing) {
      return null;
    }

    const updateData: Record<string, unknown> = {};

    if (typeof input.name === "string") {
      const nextName = input.name.trim();
      if (!nextName) {
        throw new Error("Workspace name is required");
      }
      updateData.name = nextName;
    }

    if (typeof input.rootPath === "string") {
      const nextRootPath = normalizeWorkspaceRootPath(input.rootPath);
      if (!nextRootPath) {
        throw new Error("Workspace root path is required");
      }
      if (!isValidWorkspaceRootPath(nextRootPath)) {
        throw new Error("Workspace root path is invalid");
      }
      updateData.rootPath = nextRootPath;
    }

    if (input.rootPath === null) {
      updateData.rootPath = null;
    }

    const updated = chatWorkspaceRepository.updateById(id, updateData);
    return updated ? toChatWorkspaceResponse(updated) : null;
  },

  deleteChatWorkspace(id: string, userId: number): boolean {
    const existing = chatWorkspaceRepository.findById(id, userId);
    if (!existing) {
      return false;
    }

    const defaultRootPath = getHarnessEnvironmentSnapshot().workspace.rootPath?.trim();
    if (defaultRootPath && existing.rootPath === defaultRootPath) {
      throw new Error("Default workspace cannot be deleted");
    }

    const activeThreads = threadRepository.list({
      userId,
      status: "active",
      sortBy: "updatedAt",
      sortOrder: "desc",
    });

    for (const thread of activeThreads) {
      if (thread.workspaceId === id) {
        threadRepository.deleteById(thread.id);
      }
    }

    return chatWorkspaceRepository.deleteById(id);
  },

  createThread(input: CreateThreadInput): ThreadResponse {
    let workspaceId = input.workspaceId?.trim();
    const knowledgeBaseId = input.knowledgeBaseId?.trim();
    const roleId = input.roleId?.trim();
    const agentEnabled = input.agentEnabled;
    if (agentEnabled === true && !workspaceId) {
      workspaceId = this.ensureDefaultChatWorkspace(input.userId).id;
    }
    const ttsEnabled = input.ttsEnabled;
    const imageEnabled = input.imageEnabled;
    const contextSummary = input.contextSummary?.trim();

    if (workspaceId && !chatWorkspaceRepository.findById(workspaceId, input.userId)) {
      throw new Error("Workspace not found");
    }

    if (knowledgeBaseId && !knowledgeBaseRepository.getById(knowledgeBaseId)) {
      throw new Error("Knowledge base not found");
    }

    const created = threadRepository.create({
      userId: input.userId,
      title: input.title?.trim() || "",
      modelName: input.modelName?.trim() || undefined,
      workspaceId: workspaceId ?? null,
      knowledgeBaseId: knowledgeBaseId ?? null,
      roleId: roleId ?? null,
      agentEnabled: typeof agentEnabled === "boolean" ? agentEnabled : false,
      ttsEnabled: typeof ttsEnabled === "boolean" ? ttsEnabled : false,
      imageEnabled: typeof imageEnabled === "boolean"
        ? imageEnabled
        : Boolean(roleId && !knowledgeBaseId),
      contextSummary: contextSummary || null,
      contextSummaryUpdatedAt: contextSummary ? new Date().toISOString() : null,
      status: "active",
    });

    return toThreadResponse(created, []);
  },

  updateThread(
    id: string,
    userId: number,
    input: Partial<Omit<CreateThreadInput, "userId">>,
  ): ThreadResponse | null {
    const existing = threadRepository.findById(id, userId);
    if (!existing) {
      return null;
    }

    // 如果没有需要更新的字段，直接返回现有数据
    if (
      input.title === undefined &&
      input.modelName === undefined &&
      input.workspaceId === undefined &&
      input.knowledgeBaseId === undefined &&
      input.roleId === undefined &&
      input.agentEnabled === undefined &&
      input.ttsEnabled === undefined &&
      input.imageEnabled === undefined &&
      input.contextSummary === undefined
    ) {
      return toThreadResponse(
        existing,
        messageRepository.listByThread(existing.id),
      );
    }

    const updateData: Record<string, unknown> = {};
    if (typeof input.title === "string") {
      updateData.title = input.title.trim();
    }
    if (typeof input.modelName === "string") {
      updateData.modelName = input.modelName.trim() || null;
    }
    if (typeof input.workspaceId === "string") {
      const workspaceId = input.workspaceId.trim();
      if (!workspaceId) {
        throw new Error("Workspace id is required");
      }

      if (!chatWorkspaceRepository.findById(workspaceId, userId)) {
        throw new Error("Workspace not found");
      }

      updateData.workspaceId = workspaceId;
    }
    if (input.workspaceId === null) {
      updateData.workspaceId =
        input.agentEnabled === true || (input.agentEnabled === undefined && existing.agentEnabled)
          ? this.ensureDefaultChatWorkspace(userId).id
          : null;
    }
    if (typeof input.knowledgeBaseId === "string") {
      const knowledgeBaseId = input.knowledgeBaseId.trim();
      if (!knowledgeBaseId) {
        throw new Error("Knowledge base id is required");
      }

      if (!knowledgeBaseRepository.getById(knowledgeBaseId)) {
        throw new Error("Knowledge base not found");
      }

      updateData.knowledgeBaseId = knowledgeBaseId;
    }
    if (input.knowledgeBaseId === null) {
      updateData.knowledgeBaseId = null;
    }
    if (typeof input.roleId === "string") {
      const normalizedRoleId = input.roleId.trim();
      updateData.roleId = normalizedRoleId || null;
    }
    if (input.roleId === null) {
      updateData.roleId = null;
    }
    if (typeof input.agentEnabled === "boolean") {
      updateData.agentEnabled = input.agentEnabled;
      if (input.agentEnabled && input.workspaceId === undefined && !existing.workspaceId) {
        updateData.workspaceId = this.ensureDefaultChatWorkspace(userId).id;
      }
    }
    if (input.agentEnabled === null) {
      updateData.agentEnabled = null;
    }
    if (typeof input.ttsEnabled === "boolean") updateData.ttsEnabled = input.ttsEnabled;
    if (input.ttsEnabled === null) updateData.ttsEnabled = false;
    if (typeof input.imageEnabled === "boolean") updateData.imageEnabled = input.imageEnabled;
    if (input.imageEnabled === null) updateData.imageEnabled = false;
    if (typeof input.contextSummary === "string") {
      const normalizedSummary = input.contextSummary.trim();
      updateData.contextSummary = normalizedSummary || null;
      updateData.contextSummaryUpdatedAt = normalizedSummary
        ? new Date().toISOString()
        : null;
    }
    if (input.contextSummary === null) {
      updateData.contextSummary = null;
      updateData.contextSummaryUpdatedAt = null;
    }

    const updated = threadRepository.updateById(id, updateData);
    if (!updated) {
      return null;
    }

    const messages = messageRepository.listByThread(updated.id);
    return toThreadResponse(updated, messages);
  },

  archiveThread(id: string, userId: number): ThreadResponse | null {
    const existing = threadRepository.findById(id, userId);
    if (!existing) {
      return null;
    }

    const updated = threadRepository.archiveById(id);
    if (!updated) {
      return null;
    }

    const messages = messageRepository.listByThread(updated.id);
    return toThreadResponse(updated, messages);
  },

  restoreThread(id: string, userId: number): ThreadResponse | null {
    const existing = threadRepository.findById(id, userId);
    if (!existing) {
      return null;
    }

    const updated = threadRepository.restoreById(id);
    if (!updated) {
      return null;
    }

    const messages = messageRepository.listByThread(updated.id);
    return toThreadResponse(updated, messages);
  },

  deleteThread(id: string, userId: number): boolean {
    const existing = threadRepository.findById(id, userId);
    if (!existing) {
      return false;
    }
    const mediaCleanup = chatMediaService.removeForThread(id);
    if (mediaCleanup.failed > 0) {
      throw new Error(`Failed to remove ${mediaCleanup.failed} media record(s): ${mediaCleanup.errors.map((item) => item.mediaId).join(", ")}`);
    }
    for (const message of messageRepository.listByThread(id)) {
      removeFileAttachmentsFromParts(parsePartsJson(message.partsJson));
    }
    conversationWorkdirService.cleanup({ threadId: id, userId });
    return threadRepository.deleteById(id);
  },

  cleanupThreads(userId: number): {
    deletedThreads: number;
    deletedMessages: number;
    failedThreads: number;
    failedWorkdirs: number;
    deletedWorkspaces: number;
  } {
    const threadsToDelete = [
      ...threadRepository.list({ userId, status: "active", sortBy: "updatedAt", sortOrder: "asc" }),
      ...threadRepository.list({ userId, status: "archived", sortBy: "updatedAt", sortOrder: "asc" }),
    ];
    let deletedThreads = 0;
    let deletedMessages = 0;
    let failedThreads = 0;
    let failedWorkdirs = 0;
    const deletedWorkspaces = 0;

    for (const thread of threadsToDelete) {
      try {
        const messages = messageRepository.listByThread(thread.id);
        const mediaCleanup = chatMediaService.removeForMessages(messages.map((message) => message.id));
        if (mediaCleanup.failed > 0) {
          throw new Error(`Failed to remove ${mediaCleanup.failed} media record(s)`);
        }
        try {
          conversationWorkdirService.cleanup({ threadId: thread.id, userId });
        } catch {
          failedWorkdirs += 1;
          failedThreads += 1;
          continue;
        }
        if (!threadRepository.deleteById(thread.id)) {
          failedThreads += 1;
          continue;
        }
        deletedThreads += 1;
        deletedMessages += messages.length;
      } catch {
        failedThreads += 1;
      }
    }

    return { deletedThreads, deletedMessages, failedThreads, failedWorkdirs, deletedWorkspaces };
  },

  createMessage(
    threadId: string,
    userId: number,
    input: CreateMessageInput,
  ): MessageResponse {
    // 验证线程属于当前用户
    const thread = threadRepository.findById(threadId, userId);
    if (!thread) {
      throw new Error(THREAD_ACCESS_ERROR_MESSAGE);
    }

    const normalizedContent = input.content;
    const normalizedParts = input.parts ?? [];
    const hasTextPart = normalizedParts.some((part) => part.type === "text");
    const hasAttachmentPart = normalizedParts.some(
      (part) => part.type === "image" || part.type === "file",
    );
    const hasDataPart = normalizedParts.some((part) => part.type === "data");
    const hasSupportedContent = hasTextPart || hasAttachmentPart || hasDataPart;
    const normalizedMetadata = input.metadata ? JSON.stringify(input.metadata) : "{}";
    const existing = input.id ? messageRepository.findById(input.id) : undefined;
    const effectiveParentId =
      input.parentId !== undefined
        ? input.parentId
        : getBranchParentIdFromMetadata(input.metadata);

    if (existing && existing.threadId !== threadId) {
      throw new Error("Message id already exists on a different thread");
    }

    if (
      effectiveParentId !== undefined &&
      (!existing || !input.preserveDescendants)
    ) {
      pruneThreadTail(
        threadId,
        existing ? existing.id : effectiveParentId ?? null,
        existing?.id,
      );
    }

    if (existing) {
      if (
      existing.role !== input.role ||
      existing.content !== normalizedContent ||
      (existing.metadata || "{}") !== normalizedMetadata ||
      JSON.stringify(
        parsePartsJson(
            (existing as Message & { partsJson?: string | null }).partsJson,
          ) ?? [],
        ) !== JSON.stringify(input.parts ?? [])
      ) {
        const mediaCleanup = chatMediaService.removeForMessages([existing.id]);
        if (mediaCleanup.failed > 0) {
          throw new Error(`Failed to remove ${mediaCleanup.failed} media record(s): ${mediaCleanup.errors.map((item) => item.mediaId).join(", ")}`);
        }
        removeFileAttachmentsRemovedFromParts(
          parsePartsJson(existing.partsJson),
          input.parts,
        );
        const updated = messageRepository.updateById(existing.id, {
          role: input.role,
          content: normalizedContent,
          partsJson: serializeParts(input.parts),
          metadata: normalizedMetadata,
        });

        if (!updated) {
          throw new Error("Failed to update existing message");
        }

        threadRepository.updateById(threadId, {});
        return toMessageResponse(updated);
      }

      threadRepository.updateById(threadId, {});
      return toMessageResponse(existing);
    }

    if (!input.id && input.role === "user") {
      const existingMessages = messageRepository.listByThread(threadId);
      if (
        existingMessages.length === 1 &&
        existingMessages[0]?.role === "user" &&
        existingMessages[0]?.content === normalizedContent
      ) {
        return toMessageResponse(existingMessages[0]);
      }
    }

    if (!hasSupportedContent) {
      throw new Error("Message content is missing");
    }

    const created = messageRepository.create({
      ...(input.id ? { id: input.id } : {}),
      threadId,
      role: input.role,
      content: normalizedContent,
      partsJson: serializeParts(input.parts),
      metadata: normalizedMetadata,
    });

    // 更新 thread 的 updatedAt
    threadRepository.updateById(threadId, {});

    return toMessageResponse(created);
  },

  updateMessageMetadata(
    threadId: string,
    messageId: string,
    userId: number,
    metadata: Record<string, unknown>,
  ): MessageResponse | null {
    const thread = threadRepository.findById(threadId, userId);
    const existing = messageRepository.findById(messageId);
    if (!thread || !existing || existing.threadId !== threadId) return null;
    const updated = messageRepository.updateById(messageId, {
      metadata: JSON.stringify(metadata),
    });
    return updated ? toMessageResponse(updated) : null;
  },

  createMessages(
    threadId: string,
    userId: number,
    inputs: CreateMessageInput[],
  ): MessageResponse[] {
    // 验证线程属于当前用户
    const thread = threadRepository.findById(threadId, userId);
    if (!thread) {
      throw new Error(THREAD_ACCESS_ERROR_MESSAGE);
    }

    const messages = messageRepository.createBatch(
      threadId,
      inputs.map((input) => ({
        role: input.role,
        content: input.content,
        metadata: input.metadata ? JSON.stringify(input.metadata) : "{}",
      })),
    );

    // 更新 thread 的 updatedAt
    threadRepository.updateById(threadId, {});

    return messages.map(toMessageResponse);
  },

  getMessages(threadId: string, userId: number): MessageResponse[] {
    // 验证线程属于当前用户
    const thread = threadRepository.findById(threadId, userId);
    if (!thread) {
      throw new Error(THREAD_ACCESS_ERROR_MESSAGE);
    }

    const messages = messageRepository.listByThread(threadId);
    return messages.map(toMessageResponse);
  },

  getMessageById(id: string, userId: number): MessageResponse | null {
    const message = messageRepository.findById(id);
    if (!message) {
      return null;
    }

    // 验证消息所属线程属于当前用户
    const thread = threadRepository.findById(message.threadId, userId);
    if (!thread) {
      return null;
    }

    return toMessageResponse(message);
  },

  deleteMessage(id: string, userId: number): boolean {
    const message = messageRepository.findById(id);
    if (!message) {
      return false;
    }

    // 验证消息所属线程属于当前用户
    const thread = threadRepository.findById(message.threadId, userId);
    if (!thread) {
      return false;
    }

    const mediaCleanup = chatMediaService.removeForMessages([id]);
    if (mediaCleanup.failed > 0) {
      throw new Error(`Failed to remove ${mediaCleanup.failed} media record(s): ${mediaCleanup.errors.map((item) => item.mediaId).join(", ")}`);
    }
    removeFileAttachmentsFromParts(parsePartsJson(message.partsJson));
    const deleted = messageRepository.deleteById(id);
    if (deleted) {
      threadRepository.updateById(message.threadId, {});
    }

    return deleted;
  },
};
