import assert from "node:assert/strict";
import fs from "node:fs";
import { afterAll, test } from "vitest";
import { initializeAuthDatabase } from "@/db/auth.db";
import { getSqlite } from "@/db/index.js";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import {
  knowledgeBaseRepository,
  messageRepository,
  roleRepository,
  userRepository,
} from "@/db/repositories";
import { threadService } from "./thread.service.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const testDbPath = createTimestampedTestArtifactPath("db", "rag-demo-thread-service", ".sqlite");
const hostWorkspaceRoot = (name: string) =>
  process.platform === "win32"
    ? `D:\\workspace\\${name}`
    : `/workspace/${name}`;
const otherPlatformWorkspaceRoot =
  process.platform === "win32"
    ? "/workspace/other-platform"
    : "D:\\workspace\\other-platform";

process.env.DATABASE_URL = `file:${testDbPath}`;

initializeAuthDatabase();
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeRoleDatabase();
initializeThreadDatabase();

afterAll(() => {
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // ignore cleanup failure on Windows file locking
  }
});

test("createThread stores knowledgeBaseId only when provided", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const knowledgeBase = knowledgeBaseRepository.create({
    name: `KB-${crypto.randomUUID()}`,
    description: "",
    status: "active",
    chunkingConfigJson: "{}",
    metadataJson: "{}",
  });

  const noKbThread = threadService.createThread({
    userId: user.id,
  });
  assert.equal(noKbThread.knowledgeBaseId, null);
  assert.equal(noKbThread.contextSummary, null);

  const kbThread = threadService.createThread({
    userId: user.id,
    knowledgeBaseId: knowledgeBase.id,
  });
  assert.equal(kbThread.knowledgeBaseId, knowledgeBase.id);
});

test("messages table foreign key targets threads after initialization", () => {
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare("PRAGMA foreign_key_list(messages)")
    .all() as Array<{ table: string }>;

  assert.ok(rows.length > 0);
  assert.equal(rows.some((row) => row.table === "threads"), true);
  assert.equal(rows.some((row) => row.table === "threads_legacy"), false);
});

test("createChatWorkspace validates workspace root paths", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const validRootPath = hostWorkspaceRoot("project-alpha");

  assert.throws(
    () =>
      threadService.createChatWorkspace({
        userId: user.id,
        name: "Workspace",
        rootPath: "",
      }),
    /Workspace root path is required/,
  );

  assert.throws(
    () =>
      threadService.createChatWorkspace({
        userId: user.id,
        name: "Workspace",
        rootPath: "workspace/project-alpha",
      }),
    /Workspace root path is invalid/,
  );

  assert.throws(
    () =>
      threadService.createChatWorkspace({
        userId: user.id,
        name: "Workspace",
        rootPath: otherPlatformWorkspaceRoot,
      }),
    /Workspace root path is invalid/,
  );

  const created = threadService.createChatWorkspace({
    userId: user.id,
    name: "Workspace",
    rootPath: validRootPath,
  });
  assert.equal(created.rootPath, validRootPath);

  const updatedRootPath = hostWorkspaceRoot("project-beta");
  const updated = threadService.updateChatWorkspace(created.id, user.id, {
    rootPath: updatedRootPath,
  });
  assert.equal(updated?.rootPath, updatedRootPath);

  assert.throws(
    () =>
      threadService.updateChatWorkspace(created.id, user.id, {
        rootPath: otherPlatformWorkspaceRoot,
      }),
    /Workspace root path is invalid/,
  );
});

test("createThread and updateThread persist roleId and allow clearing it", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const role = roleRepository.create({
    userId: user.id,
    name: "Programmer",
    summary: "Writes and verifies code carefully",
    avatarId: "pilot-helper",
    status: "active",
    tagsJson: "[]",
    promptJson: JSON.stringify({
      description: "A programmer role",
      worldview: "",
      persona: "",
      scenario: "",
      exampleDialogues: "",
      style: "",
      constraints: "",
    }),
  });

  const created = threadService.createThread({
    userId: user.id,
    roleId: role.id,
  });
  assert.equal(created.roleId, role.id);

  const cleared = threadService.updateThread(created.id, user.id, {
    roleId: null,
  });
  assert.equal(cleared?.roleId, null);

  const rebound = threadService.updateThread(created.id, user.id, {
    roleId: role.id,
  });
  assert.equal(rebound?.roleId, role.id);
});

test("updateThread stores and clears context summary", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });

  const updated = threadService.updateThread(thread.id, user.id, {
    contextSummary: "用户希望回答更简洁，并保持当前调试上下文。",
  });
  assert.equal(
    updated?.contextSummary,
    "用户希望回答更简洁，并保持当前调试上下文。",
  );
  assert.ok(updated?.contextSummaryUpdatedAt);

  const cleared = threadService.updateThread(thread.id, user.id, {
    contextSummary: null,
  });
  assert.equal(cleared?.contextSummary, null);
  assert.equal(cleared?.contextSummaryUpdatedAt, null);
});

test("thread summary responses do not expose legacy RAG flags", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });

  const summary = threadService.getThreadSummaryById(thread.id, user.id);
  assert.ok(summary);
  assert.equal("ragEnabled" in summary, false);
});

test("updateThread unbinds and rebinds knowledge base", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const knowledgeBase = knowledgeBaseRepository.create({
    name: `KB-${crypto.randomUUID()}`,
    description: "",
    status: "active",
    chunkingConfigJson: "{}",
    metadataJson: "{}",
  });

  const created = threadService.createThread({
    userId: user.id,
    knowledgeBaseId: knowledgeBase.id,
  });

  const unbound = threadService.updateThread(created.id, user.id, {
    knowledgeBaseId: null,
  });
  assert.equal(unbound?.knowledgeBaseId, null);

  const rebound = threadService.updateThread(created.id, user.id, {
    knowledgeBaseId: knowledgeBase.id,
  });
  assert.equal(rebound?.knowledgeBaseId, knowledgeBase.id);
});

test("deleteChatWorkspace removes threads bound to that workspace", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const workspace = threadService.createChatWorkspace({
    userId: user.id,
    name: "Workspace",
    rootPath: hostWorkspaceRoot("project-delete"),
  });

  const boundThread = threadService.createThread({
    userId: user.id,
    workspaceId: workspace.id,
    agentEnabled: true,
    title: "Bound Thread",
  });
  const unboundThread = threadService.createThread({
    userId: user.id,
    title: "Loose Thread",
  });

  assert.equal(threadService.deleteChatWorkspace(workspace.id, user.id), true);
  assert.equal(threadService.getThreadById(boundThread.id, user.id), null);
  assert.ok(threadService.getThreadById(unboundThread.id, user.id));
});

test("getThreadWorkspaceRoot resolves a bound thread workspace path", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const workspaceRoot = hostWorkspaceRoot("testData");
  const workspace = threadService.createChatWorkspace({
    userId: user.id,
    name: "PW Test",
    rootPath: workspaceRoot,
  });
  const thread = threadService.createThread({
    userId: user.id,
    workspaceId: workspace.id,
    title: "Bound Thread",
  });

  assert.equal(
    threadService.getThreadWorkspaceRoot(thread.id, user.id),
    workspaceRoot,
  );
});

test("createMessage uses lineage.parentId for branch pruning", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });

  const parent = threadService.createMessage(thread.id, user.id, {
    id: `user-${crypto.randomUUID()}`,
    role: "user",
    content: "parent",
    parts: [{ type: "text", text: "parent" }],
  });
  const assistant = threadService.createMessage(thread.id, user.id, {
    id: `assistant-${crypto.randomUUID()}`,
    role: "assistant",
    content: "assistant",
    parts: [{ type: "text", text: "assistant" }],
    parentId: parent.id,
  });

  threadService.createMessage(thread.id, user.id, {
    id: "user-2",
    role: "user",
    content: "branch",
    parts: [{ type: "text", text: "branch" }],
    metadata: {
      lineage: {
        parentId: parent.id,
      },
    },
  });

  const nextThread = threadService.getThreadById(thread.id, user.id);
  assert.ok(nextThread);
  assert.equal(nextThread.messages.some((message) => message.id === assistant.id), false);
});

test("updating a durable Agent message can preserve newer descendants", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });

  const userOne = threadService.createMessage(thread.id, user.id, {
    id: `user-${crypto.randomUUID()}`,
    role: "user",
    content: "first turn",
    parts: [{ type: "text", text: "first turn" }],
  });
  const durableAssistant = threadService.createMessage(thread.id, user.id, {
    id: `assistant-${crypto.randomUUID()}`,
    parentId: userOne.id,
    role: "assistant",
    content: "Agent 正在运行…",
    parts: [{ type: "text", text: "Agent 正在运行…" }],
  });
  const userTwo = threadService.createMessage(thread.id, user.id, {
    id: `user-${crypto.randomUUID()}`,
    parentId: durableAssistant.id,
    role: "user",
    content: "second turn",
    parts: [{ type: "text", text: "second turn" }],
  });

  threadService.createMessage(thread.id, user.id, {
    id: durableAssistant.id,
    parentId: userOne.id,
    role: "assistant",
    content: "Agent 已完成。",
    parts: [{ type: "text", text: "Agent 已完成。" }],
    preserveDescendants: true,
  });

  const detail = threadService.getThreadById(thread.id, user.id);
  assert.ok(detail);
  assert.equal(detail.messages.some((message) => message.id === userTwo.id), true);
  assert.equal(
    detail.messages.find((message) => message.id === durableAssistant.id)?.content,
    "Agent 已完成。",
  );
});

test("recreating a missing durable Agent message still prunes stale descendants", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });

  const parent = threadService.createMessage(thread.id, user.id, {
    id: `user-${crypto.randomUUID()}`,
    role: "user",
    content: "first turn",
    parts: [{ type: "text", text: "first turn" }],
  });
  const staleAssistant = threadService.createMessage(thread.id, user.id, {
    id: `assistant-${crypto.randomUUID()}`,
    parentId: parent.id,
    role: "assistant",
    content: "stale branch",
    parts: [{ type: "text", text: "stale branch" }],
  });
  const staleUser = threadService.createMessage(thread.id, user.id, {
    id: `user-${crypto.randomUUID()}`,
    parentId: staleAssistant.id,
    role: "user",
    content: "stale descendant",
    parts: [{ type: "text", text: "stale descendant" }],
  });

  const recreated = threadService.createMessage(thread.id, user.id, {
    id: `assistant-${crypto.randomUUID()}`,
    parentId: parent.id,
    role: "assistant",
    content: "Agent 正在运行…",
    parts: [{ type: "text", text: "Agent 正在运行…" }],
    preserveDescendants: true,
  });

  const detail = threadService.getThreadById(thread.id, user.id);
  assert.ok(detail);
  assert.equal(detail.messages.some((message) => message.id === staleAssistant.id), false);
  assert.equal(detail.messages.some((message) => message.id === staleUser.id), false);
  assert.equal(detail.messages.some((message) => message.id === recreated.id), true);
});

test("thread service list and detail views surface canonical parts and summaries", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Thread Title",
  });

  threadService.createMessage(thread.id, user.id, {
    id: `user-${crypto.randomUUID()}`,
    role: "user",
    content: "hello world",
    parts: [{ type: "text", text: "hello world" }],
  });

  const summaries = threadService.listThreads({ userId: user.id });
  assert.ok(summaries.find((item) => item.id === thread.id));

  const detail = threadService.getThreadById(thread.id, user.id);
  assert.equal(detail?.messages[0]?.parts[0]?.type, "text");
  assert.equal(detail?.messages[0]?.content, "hello world");
  assert.equal(threadService.getMessageById(detail?.messages[0]?.id ?? "", user.id)?.parts[0]?.type, "text");
  assert.equal(
    threadService.getMessages(thread.id, user.id)[0]?.id,
    detail?.messages[0]?.id,
  );
  assert.equal(threadService.getThreadSummaryById(thread.id, user.id)?.messageCount, 1);
});

test("thread service createMessage handles empty payloads and updates existing messages", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });

  assert.throws(
    () =>
      threadService.createMessage(thread.id, user.id, {
        role: "assistant",
        content: "",
        parts: [],
      }),
    /Message content is missing/,
  );

  const created = threadService.createMessage(thread.id, user.id, {
    id: `message-${crypto.randomUUID()}`,
    role: "user",
    content: "old",
    parts: [{ type: "text", text: "old" }],
  });
  const updated = threadService.createMessage(thread.id, user.id, {
    id: created.id,
    role: "user",
    content: "new",
    parts: [{ type: "text", text: "new" }],
  });

  assert.equal(updated.content, "new");
});

test("thread service batch create archive restore delete and deleteMessage work", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });

  const batch = threadService.createMessages(thread.id, user.id, [
    {
      role: "user",
      content: "one",
    },
    {
      role: "assistant",
      content: "two",
    },
  ]);
  assert.equal(batch.length, 2);

  assert.equal(threadService.deleteMessage(batch[0].id, user.id), true);
  assert.equal(threadService.archiveThread(thread.id, user.id)?.status, "archived");
  assert.equal(threadService.restoreThread(thread.id, user.id)?.status, "active");
  assert.equal(threadService.deleteThread(thread.id, user.id), true);
  assert.equal(threadService.getThreadById(thread.id, user.id), null);
});

test("thread service returns null or false for inaccessible resources", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });

  assert.equal(threadService.getThreadSummaryById("missing", user.id), null);
  assert.equal(threadService.getThreadById("missing", user.id), null);
  assert.equal(threadService.updateThread("missing", user.id, { title: "x" }), null);
  assert.equal(threadService.archiveThread("missing", user.id), null);
  assert.equal(threadService.restoreThread("missing", user.id), null);
  assert.equal(threadService.deleteThread("missing", user.id), false);
  assert.equal(threadService.deleteMessage("missing", user.id), false);
});

test("thread service keeps canonical parts and ignores assistantUi attachment fallback", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });

  const created = threadService.createMessage(thread.id, user.id, {
    id: `message-${crypto.randomUUID()}`,
    role: "assistant",
    content: "hello",
    parts: [{ type: "text", text: "hello" }],
    metadata: {
      assistantUi: {
        textWasEmpty: true,
      },
    },
  });

  assert.equal(created.parts[0]?.type, "text");
  assert.equal(created.parts.length, 1);

  const duplicate = threadService.createMessage(thread.id, user.id, {
    id: created.id,
    role: "assistant",
    content: "hello",
    parts: [{ type: "text", text: "hello" }],
    metadata: created.metadata,
  });
  assert.equal(duplicate.id, created.id);
});

test("thread service fallback read suppresses legacy assistantUi placeholder text", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });

  const created = messageRepository.create({
    threadId: thread.id,
    role: "user",
    content: "[Image attachment]",
    metadata: JSON.stringify({
      assistantUi: {
        textWasEmpty: true,
      },
    }),
  });

  const hydrated = threadService.getMessageById(created.id, user.id);
  assert.deepEqual(hydrated?.parts, []);
});

test("thread service createMessages and getMessageById handle ownership and nulls", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const otherUser = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });

  assert.throws(
    () =>
      threadService.createMessages("missing", user.id, [
        {
          role: "user",
          content: "one",
        },
      ]),
    /Thread not found or not accessible/,
  );

  const messages = threadService.createMessages(thread.id, user.id, [
    {
      role: "user",
      content: "one",
    },
  ]);

  assert.equal(threadService.getMessageById(messages[0].id, otherUser.id), null);
});

test("thread service updateThread with no changes returns current snapshot and deleteMessage updates thread", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    title: "Thread Title",
  });

  const noChange = threadService.updateThread(thread.id, user.id, {});
  assert.equal(noChange?.title, "Thread Title");

  const message = threadService.createMessage(thread.id, user.id, {
    id: `message-${crypto.randomUUID()}`,
    role: "user",
    content: "bye",
    parts: [{ type: "text", text: "bye" }],
  });

  assert.equal(threadService.deleteMessage(message.id, user.id), true);
});
