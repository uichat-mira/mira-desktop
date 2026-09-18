import { get, post, patch, del, ApiError } from "../lib/request";

// 重新导出 ApiError 以便在其他模块中使用
export { ApiError };

const CHAT_REQUEST_CONFIG = { timeout: 0 } as const;
const AGENT_RUN_POLL_INTERVAL_MS = 800;
const AGENT_RUN_POLL_MAX_ATTEMPTS = 900;
const AGENT_RUN_POLL_MAX_CONSECUTIVE_FAILURES = 3;

export const AGENT_RUN_UPDATED_EVENT = "uichat:agent-run-updated";

export type ThreadStatus = "active" | "archived" | "deleted";
export type MessageRole = "user" | "assistant" | "system";

export interface Thread {
  id: string;
  title: string;
  modelName: string | null;
  workspaceId: string | null;
  knowledgeBaseId: string | null;
  roleId: string | null;
  agentEnabled?: boolean | null;
  ttsEnabled?: boolean | null;
  imageEnabled?: boolean | null;
  contextSummary: string | null;
  contextSummaryUpdatedAt: string | null;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage?: string;
}

export interface Message {
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

export interface ThreadWithMessages extends Thread {
  messages: Message[];
}

export interface CreateThreadInput {
  title?: string;
  modelName?: string;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  roleId?: string | null;
  agentEnabled?: boolean | null;
  contextSummary?: string | null;
  ttsEnabled?: boolean | null;
  imageEnabled?: boolean | null;
}

export interface CreateMessageInput {
  id?: string;
  role: MessageRole;
  content: string;
  parentId?: string | null;
  parts?: Message["parts"];
  metadata?: Record<string, unknown>;
}

export interface ThreadListFilters {
  status?: "active" | "archived";
  sortBy?: "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
}

export interface ChatWorkspace {
  id: string;
  name: string;
  rootPath: string | null;
  isDefault: boolean;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface AgentApprovalRequest {
  id: string;
  runId: string;
  stepId: string;
  toolId: string;
  toolCallId?: string;
  reason: string;
  input?: Record<string, unknown>;
  inputHash?: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  threadId: string;
  userId: number;
  status:
    | "queued"
    | "running"
    | "waiting_approval"
    | "waiting_user"
    | "completed"
    | "failed"
    | "blocked"
    | "cancelled";
  traceId: string;
  currentStepId?: string;
  blockedReason?: string;
  terminalReason?: string;
  pendingApproval?: AgentApprovalRequest;
  selectedCapabilityId?: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentRunUpdatedEventDetail = {
  run: AgentRun;
};

const activeAgentRunPolls = new Map<string, Promise<void>>();

const shouldPollAgentRun = (run: AgentRun) =>
  run.status === "queued" || run.status === "running";

const waitForAgentRunPoll = () =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, AGENT_RUN_POLL_INTERVAL_MS);
  });

const notifyAgentRunUpdated = (run: AgentRun) => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<AgentRunUpdatedEventDetail>(AGENT_RUN_UPDATED_EVENT, {
      detail: { run },
    }),
  );
};

const pollAgentRunUntilSettled = async (initialRun: AgentRun) => {
  let currentRun = initialRun;
  let consecutiveFailures = 0;

  for (
    let attempt = 0;
    attempt < AGENT_RUN_POLL_MAX_ATTEMPTS && shouldPollAgentRun(currentRun);
    attempt += 1
  ) {
    await waitForAgentRunPoll();

    try {
      currentRun = await getAgentRun(currentRun.id);
      consecutiveFailures = 0;
      notifyAgentRunUpdated(currentRun);
    } catch {
      consecutiveFailures += 1;
      if (consecutiveFailures >= AGENT_RUN_POLL_MAX_CONSECUTIVE_FAILURES) {
        return;
      }
    }
  }
};

const startAgentRunPolling = (run: AgentRun) => {
  if (typeof window === "undefined" || !shouldPollAgentRun(run)) {
    return;
  }
  if (activeAgentRunPolls.has(run.id)) {
    return;
  }

  const polling = pollAgentRunUntilSettled(run).finally(() => {
    activeAgentRunPolls.delete(run.id);
  });
  activeAgentRunPolls.set(run.id, polling);
};

// 获取对话列表
export async function getThreads(
  filters?: ThreadListFilters,
): Promise<Thread[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.append("status", filters.status);
  if (filters?.sortBy) params.append("sortBy", filters.sortBy);
  if (filters?.sortOrder) params.append("sortOrder", filters.sortOrder);

  const query = params.toString();
  return get<Thread[]>(`/threads${query ? `?${query}` : ""}`, CHAT_REQUEST_CONFIG);
}

// 获取对话详情（含消息）
export async function getThreadById(id: string): Promise<ThreadWithMessages> {
  return get<ThreadWithMessages>(`/threads/${id}`, CHAT_REQUEST_CONFIG);
}

// 创建新对话
export async function createThread(input?: CreateThreadInput): Promise<Thread> {
  return post<Thread>("/threads", input, CHAT_REQUEST_CONFIG);
}

// 更新对话
export async function updateThread(
  id: string,
  input: Partial<CreateThreadInput>,
): Promise<Thread> {
  return patch<Thread>(`/threads/${id}`, input, CHAT_REQUEST_CONFIG);
}

export interface AttachChatMediaInput {
  messageId: string;
  taskId: string;
  mediaType: "audio" | "image";
  absolutePath: string;
  mimeType: string;
}

export interface ChatMediaRecord extends AttachChatMediaInput {
  id: string;
  threadId: string;
  createdAt: string;
}

export function attachChatMedia(threadId: string, input: AttachChatMediaInput) {
  return post<ChatMediaRecord>(`/threads/${encodeURIComponent(threadId)}/media`, input, CHAT_REQUEST_CONFIG);
}

export function getChatMediaContentUrl(threadId: string, mediaId: string) {
  return `/threads/${encodeURIComponent(threadId)}/media/${encodeURIComponent(mediaId)}/content`;
}

export async function getChatMediaPreviewUrl(threadId: string, mediaId: string) {
  const response = await import("@/shared/lib/request").then(({ client }) =>
    client.get<Blob>(getChatMediaContentUrl(threadId, mediaId), { responseType: "blob" }),
  );
  return URL.createObjectURL(response.data);
}

export function updateChatMessageMetadata(
  threadId: string,
  messageId: string,
  metadata: Record<string, unknown>,
) {
  return patch<Record<string, unknown>>(
    `/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/metadata`,
    { metadata },
    CHAT_REQUEST_CONFIG,
  );
}

export async function generateThreadContextSummary(
  id: string,
): Promise<Pick<Thread, "contextSummary" | "contextSummaryUpdatedAt">> {
  return post<Pick<Thread, "contextSummary" | "contextSummaryUpdatedAt">>(
    `/threads/${id}/context-summary`,
    {},
    CHAT_REQUEST_CONFIG,
  );
}

// 归档对话
export async function archiveThread(id: string): Promise<Thread> {
  return post<Thread>(`/threads/${id}/archive`, undefined, CHAT_REQUEST_CONFIG);
}

// 恢复对话
export async function restoreThread(id: string): Promise<Thread> {
  return post<Thread>(`/threads/${id}/restore`, undefined, CHAT_REQUEST_CONFIG);
}

// 删除对话
export async function deleteThread(id: string): Promise<{ deleted: boolean }> {
  return del<{ deleted: boolean }>(`/threads/${id}`, CHAT_REQUEST_CONFIG);
}

export interface CleanupThreadsResult {
  deletedThreads: number;
  deletedMessages: number;
  failedThreads: number;
  failedWorkdirs: number;
  deletedWorkspaces: number;
  clearedLogBytes: number;
  media: {
    attachments: { files: number; bytes: number };
    generatedImages: { files: number; bytes: number };
    generatedAudio: { files: number; bytes: number };
    generatedVideos: { files: number; bytes: number };
  };
}

export async function cleanupThreads(): Promise<CleanupThreadsResult> {
  return del<CleanupThreadsResult>("/threads/history", CHAT_REQUEST_CONFIG);
}

export async function listChatWorkspaces(): Promise<ChatWorkspace[]> {
  return get<ChatWorkspace[]>("/chat-workspaces", CHAT_REQUEST_CONFIG);
}

export async function createChatWorkspace(input: {
  name: string;
  rootPath?: string | null;
}): Promise<ChatWorkspace> {
  return post<ChatWorkspace>("/chat-workspaces", input, CHAT_REQUEST_CONFIG);
}

export async function updateChatWorkspace(
  id: string,
  input: Partial<{ name: string; rootPath: string | null }>,
): Promise<ChatWorkspace> {
  return patch<ChatWorkspace>(`/chat-workspaces/${id}`, input, CHAT_REQUEST_CONFIG);
}

export async function deleteChatWorkspace(id: string): Promise<{ deleted: boolean }> {
  return del<{ deleted: boolean }>(`/chat-workspaces/${id}`, CHAT_REQUEST_CONFIG);
}

export async function getAgentRun(runId: string): Promise<AgentRun> {
  return get<AgentRun>(`/agent/runs/${runId}`, CHAT_REQUEST_CONFIG);
}

export async function approveAgentRun(runId: string): Promise<AgentRun> {
  const run = await post<AgentRun>(`/agent/runs/${runId}/approve`, {}, CHAT_REQUEST_CONFIG);
  notifyAgentRunUpdated(run);
  startAgentRunPolling(run);
  return run;
}

export async function rejectAgentRun(runId: string): Promise<AgentRun> {
  return post<AgentRun>(`/agent/runs/${runId}/reject`, {}, CHAT_REQUEST_CONFIG);
}

export async function cancelAgentRun(runId: string): Promise<AgentRun> {
  return post<AgentRun>(`/agent/runs/${runId}/cancel`, {}, CHAT_REQUEST_CONFIG);
}

// 获取对话消息
export async function getMessages(threadId: string): Promise<Message[]> {
  return get<Message[]>(`/threads/${threadId}/messages`, CHAT_REQUEST_CONFIG);
}

// 创建消息
export async function createMessage(
  threadId: string,
  input: CreateMessageInput,
): Promise<Message> {
  return post<Message>(`/threads/${threadId}/messages`, input, CHAT_REQUEST_CONFIG);
}

// 删除消息
export async function deleteMessage(id: string): Promise<{ deleted: boolean }> {
  return del<{ deleted: boolean }>(`/messages/${id}`, CHAT_REQUEST_CONFIG);
}
