import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/lib/request", () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  ApiError: class MockApiError extends Error {},
}));

import { get, post, patch, del } from "@/shared/lib/request";
import {
  getThreads,
  getThreadById,
  createThread,
  updateThread,
  generateThreadContextSummary,
  archiveThread,
  restoreThread,
  deleteThread,
  cleanupThreads,
  listChatWorkspaces,
  createChatWorkspace,
  updateChatWorkspace,
  deleteChatWorkspace,
  getAgentRun,
  approveAgentRun,
  rejectAgentRun,
  cancelAgentRun,
  getMessages,
  createMessage,
  deleteMessage,
  type Thread,
  type ThreadWithMessages,
  type Message,
  type ChatWorkspace,
  type AgentRun,
} from "../thread";

const noTimeoutConfig = { timeout: 0 };

const sampleThread: Thread = {
  id: "thread-1",
  title: "对话 1",
  modelName: "gpt-4o",
  workspaceId: null,
  knowledgeBaseId: null,
  roleId: null,
  agentEnabled: false,
  contextSummary: null,
  contextSummaryUpdatedAt: null,
  status: "active",
  createdAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z",
  messageCount: 0,
};

const sampleMessage: Message = {
  id: "msg-1",
  threadId: "thread-1",
  role: "user",
  content: "hello",
  parts: [{ type: "text", text: "hello" }],
  metadata: {},
  createdAt: "2026-07-06T00:00:00.000Z",
};

const sampleThreadWithMessages: ThreadWithMessages = {
  ...sampleThread,
  messages: [sampleMessage],
};

const sampleWorkspace: ChatWorkspace = {
  id: "ws-1",
  name: "Workspace",
  rootPath: "/workspace",
  status: "active",
  createdAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z",
};

const sampleAgentRun: AgentRun = {
  id: "run-1",
  threadId: "thread-1",
  userId: 1,
  status: "running",
  traceId: "trace-1",
  createdAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z",
};

describe("thread api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getThreads 支持过滤与排序参数", async () => {
    vi.mocked(get).mockResolvedValueOnce([sampleThread]);

    const result = await getThreads({
      status: "active",
      sortBy: "updatedAt",
      sortOrder: "desc",
    });

    expect(get).toHaveBeenCalledWith(
      "/threads?status=active&sortBy=updatedAt&sortOrder=desc",
      noTimeoutConfig,
    );
    expect(result).toEqual([sampleThread]);
  });

  it("getThreadById 获取对话详情", async () => {
    vi.mocked(get).mockResolvedValueOnce(sampleThreadWithMessages);

    const result = await getThreadById("thread-1");

    expect(get).toHaveBeenCalledWith("/threads/thread-1", noTimeoutConfig);
    expect(result).toBe(sampleThreadWithMessages);
  });

  it("createThread 创建对话", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleThread);

    const input = { title: "新对话", modelName: "gpt-4o" };
    const result = await createThread(input);

    expect(post).toHaveBeenCalledWith("/threads", input, noTimeoutConfig);
    expect(result).toBe(sampleThread);
  });

  it("updateThread 更新对话", async () => {
    vi.mocked(patch).mockResolvedValueOnce(sampleThread);

    const result = await updateThread("thread-1", { title: "已更新" });

    expect(patch).toHaveBeenCalledWith(
      "/threads/thread-1",
      { title: "已更新" },
      noTimeoutConfig,
    );
    expect(result).toBe(sampleThread);
  });

  it("generateThreadContextSummary 生成上下文摘要", async () => {
    vi.mocked(post).mockResolvedValueOnce({
      contextSummary: "summary",
      contextSummaryUpdatedAt: "2026-07-06T00:00:00.000Z",
    });

    const result = await generateThreadContextSummary("thread-1");

    expect(post).toHaveBeenCalledWith(
      "/threads/thread-1/context-summary",
      {},
      noTimeoutConfig,
    );
    expect(result.contextSummary).toBe("summary");
  });

  it("archiveThread 归档对话", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleThread);

    const result = await archiveThread("thread-1");

    expect(post).toHaveBeenCalledWith(
      "/threads/thread-1/archive",
      undefined,
      noTimeoutConfig,
    );
    expect(result).toBe(sampleThread);
  });

  it("restoreThread 恢复对话", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleThread);

    const result = await restoreThread("thread-1");

    expect(post).toHaveBeenCalledWith(
      "/threads/thread-1/restore",
      undefined,
      noTimeoutConfig,
    );
    expect(result).toBe(sampleThread);
  });

  it("deleteThread 删除对话", async () => {
    vi.mocked(del).mockResolvedValueOnce({ deleted: true });

    const result = await deleteThread("thread-1");

    expect(del).toHaveBeenCalledWith("/threads/thread-1", noTimeoutConfig);
    expect(result).toEqual({ deleted: true });
  });

  it("cleanupThreads 清理对话", async () => {
    const cleanupResult = {
      deletedThreads: 2,
      deletedMessages: 5,
      failedThreads: 0,
      failedWorkdirs: 0,
      deletedWorkspaces: 1,
      clearedLogBytes: 1024,
      media: {
        attachments: { files: 1, bytes: 100 },
        generatedImages: { files: 1, bytes: 200 },
        generatedAudio: { files: 1, bytes: 300 },
        generatedVideos: { files: 0, bytes: 0 },
      },
    };
    vi.mocked(del).mockResolvedValueOnce(cleanupResult);

    const result = await cleanupThreads();

    expect(del).toHaveBeenCalledWith("/threads/history", noTimeoutConfig);
    expect(result).toEqual(cleanupResult);
  });

  it("listChatWorkspaces 获取工作区列表", async () => {
    vi.mocked(get).mockResolvedValueOnce([sampleWorkspace]);

    const result = await listChatWorkspaces();

    expect(get).toHaveBeenCalledWith("/chat-workspaces", noTimeoutConfig);
    expect(result).toEqual([sampleWorkspace]);
  });

  it("createChatWorkspace 创建工作区", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleWorkspace);

    const result = await createChatWorkspace({ name: "New" });

    expect(post).toHaveBeenCalledWith(
      "/chat-workspaces",
      { name: "New" },
      noTimeoutConfig,
    );
    expect(result).toBe(sampleWorkspace);
  });

  it("updateChatWorkspace 更新工作区", async () => {
    vi.mocked(patch).mockResolvedValueOnce(sampleWorkspace);

    const result = await updateChatWorkspace("ws-1", { name: "Updated" });

    expect(patch).toHaveBeenCalledWith("/chat-workspaces/ws-1", {
      name: "Updated",
    }, noTimeoutConfig);
    expect(result).toBe(sampleWorkspace);
  });

  it("deleteChatWorkspace 删除工作区", async () => {
    vi.mocked(del).mockResolvedValueOnce({ deleted: true });

    const result = await deleteChatWorkspace("ws-1");

    expect(del).toHaveBeenCalledWith("/chat-workspaces/ws-1", noTimeoutConfig);
    expect(result).toEqual({ deleted: true });
  });

  it("getAgentRun 获取 Agent 运行状态", async () => {
    vi.mocked(get).mockResolvedValueOnce(sampleAgentRun);

    const result = await getAgentRun("run-1");

    expect(get).toHaveBeenCalledWith("/agent/runs/run-1", noTimeoutConfig);
    expect(result).toBe(sampleAgentRun);
  });

  it("approveAgentRun 审批通过", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleAgentRun);

    const result = await approveAgentRun("run-1");

    expect(post).toHaveBeenCalledWith(
      "/agent/runs/run-1/approve",
      {},
      noTimeoutConfig,
    );
    expect(result).toBe(sampleAgentRun);
  });

  it("rejectAgentRun 审批拒绝", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleAgentRun);

    const result = await rejectAgentRun("run-1");

    expect(post).toHaveBeenCalledWith(
      "/agent/runs/run-1/reject",
      {},
      noTimeoutConfig,
    );
    expect(result).toBe(sampleAgentRun);
  });

  it("cancelAgentRun 取消运行", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleAgentRun);

    const result = await cancelAgentRun("run-1");

    expect(post).toHaveBeenCalledWith(
      "/agent/runs/run-1/cancel",
      {},
      noTimeoutConfig,
    );
    expect(result).toBe(sampleAgentRun);
  });

  it("getMessages 获取消息列表", async () => {
    vi.mocked(get).mockResolvedValueOnce([sampleMessage]);

    const result = await getMessages("thread-1");

    expect(get).toHaveBeenCalledWith(
      "/threads/thread-1/messages",
      noTimeoutConfig,
    );
    expect(result).toEqual([sampleMessage]);
  });

  it("createMessage 创建消息", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleMessage);

    const input = { role: "user" as const, content: "hello" };
    const result = await createMessage("thread-1", input);

    expect(post).toHaveBeenCalledWith(
      "/threads/thread-1/messages",
      input,
      noTimeoutConfig,
    );
    expect(result).toBe(sampleMessage);
  });

  it("deleteMessage 删除消息", async () => {
    vi.mocked(del).mockResolvedValueOnce({ deleted: true });

    const result = await deleteMessage("msg-1");

    expect(del).toHaveBeenCalledWith("/messages/msg-1", noTimeoutConfig);
    expect(result).toEqual({ deleted: true });
  });
});
