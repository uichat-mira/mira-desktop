import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterAll, test, vi } from "vitest";
import { initializeAuthDatabase } from "@/db/auth.db";
import { getSqlite } from "@/db/index.js";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import {
  hostNotificationRepository,
  knowledgeBaseRepository,
  messageRepository,
  roleRepository,
  userRepository,
} from "@/db/repositories";
import { tailscaleRemoteAccessRepository } from "@/db/repositories/tailscale-remote-access.repository.js";
import { threadService } from "./thread.service.js";
import { privateAgentWorkspaceService } from "./agent-workspace.service.js";
import { chatMediaService } from "./chat-media.service.js";
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

test("notification outbox survives canonical message deletion for explicit expiry", () => {
  const sqlite = getSqlite();
  const pragma = sqlite.prepare("PRAGMA foreign_keys").get() as {
    foreign_keys: number;
  };
  assert.equal(pragma.foreign_keys, 1);

  const foreignKeys = sqlite
    .prepare("PRAGMA foreign_key_list(notification_outbox)")
    .all() as Array<{ table: string; on_delete: string }>;
  assert.equal(
    foreignKeys.some((row) => row.table === "messages"),
    false,
  );
  assert.equal(
    foreignKeys.some((row) => row.table === "host_notification_bindings"),
    false,
  );

  const user = userRepository.create({
    username: `fk-notify-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });
  const installationId = `installation-fk-${crypto.randomUUID()}`;
  const deviceId = `device-fk-${crypto.randomUUID()}`;
  tailscaleRemoteAccessRepository.createDevice({
    id: deviceId,
    userId: user.id,
    name: "Phone",
    platform: "android",
    permissions: ["threads:read"],
    tokenHash: `hash-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  });
  hostNotificationRepository.upsertBinding({
    installationId,
    originRemoteDeviceId: deviceId,
    ownerUserId: user.id,
    brokerBaseUrl: "https://push.example.test",
    deliveryToken:
      "delivery-fk-0123456789012345678901234567890123456789",
    sourceScope: [thread.id],
  });
  const assistant = threadService.createMessage(thread.id, user.id, {
    id: `assistant-fk-${crypto.randomUUID()}`,
    role: "assistant",
    content: "final",
    parts: [{ type: "text", text: "final" }],
  });

  const event = hostNotificationRepository
    .listPending()
    .find((item) => item.canonicalMessageId === assistant.id);
  const binding = hostNotificationRepository.getBinding(installationId);
  assert.ok(event);
  assert.ok(binding);
  assert.equal(
    hostNotificationRepository.isCanonicalDeliveryEligible(event, binding),
    true,
  );

  messageRepository.deleteById(assistant.id);

  const after = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM notification_outbox WHERE canonical_message_id = ?",
    )
    .get(assistant.id) as { count: number };
  assert.equal(after.count, 1);
  assert.equal(
    hostNotificationRepository.isCanonicalDeliveryEligible(event, binding),
    false,
  );

  assert.equal(
    hostNotificationRepository.markExpired(
      event.id,
      "Canonical message or binding authority is no longer eligible",
    ),
    true,
  );
  const expired = sqlite
    .prepare(
      "SELECT state FROM notification_outbox WHERE id = ?",
    )
    .get(event.id) as { state: string };
  assert.equal(expired.state, "expired");
});

test("notification delivery authority follows current thread owner and paired-device revoke state", () => {
  const owner = userRepository.create({
    username: `notify-owner-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const otherOwner = userRepository.create({
    username: `notify-other-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: owner.id });
  const deviceId = `device-authority-${crypto.randomUUID()}`;
  const installationId = `installation-authority-${crypto.randomUUID()}`;

  tailscaleRemoteAccessRepository.createDevice({
    id: deviceId,
    userId: owner.id,
    name: "Phone",
    platform: "android",
    permissions: ["threads:read"],
    tokenHash: `hash-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  });

  hostNotificationRepository.upsertBinding({
    installationId,
    originRemoteDeviceId: deviceId,
    ownerUserId: owner.id,
    brokerBaseUrl: "https://push.example.test",
    deliveryToken:
      "delivery-authority-0123456789012345678901234567890123456789",
    sourceScope: [thread.id],
  });

  const assistant = threadService.createMessage(thread.id, owner.id, {
    id: `assistant-authority-${crypto.randomUUID()}`,
    role: "assistant",
    content: "final",
    parts: [{ type: "text", text: "final" }],
  });

  const event = hostNotificationRepository
    .listPending()
    .find((item) => item.canonicalMessageId === assistant.id);
  const binding = hostNotificationRepository.getBinding(installationId);
  assert.ok(event);
  assert.ok(binding);
  assert.equal(
    hostNotificationRepository.isCanonicalDeliveryEligible(event, binding),
    true,
  );

  getSqlite()
    .prepare("UPDATE threads SET user_id = ? WHERE id = ?")
    .run(otherOwner.id, thread.id);
  assert.equal(
    hostNotificationRepository.isCanonicalDeliveryEligible(event, binding),
    false,
  );

  getSqlite()
    .prepare("UPDATE threads SET user_id = ? WHERE id = ?")
    .run(owner.id, thread.id);
  assert.equal(
    hostNotificationRepository.isCanonicalDeliveryEligible(event, binding),
    true,
  );

  tailscaleRemoteAccessRepository.revokeDevice(deviceId, owner.id);
  assert.equal(
    hostNotificationRepository.isCanonicalDeliveryEligible(event, binding),
    false,
  );
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
  assert.equal(
    threadService.getEffectiveAgentWorkspaceRoot(thread.id, user.id),
    workspaceRoot,
  );

  const cleared = threadService.updateThread(thread.id, user.id, {
    workspaceId: null,
  });
  assert.equal(cleared?.workspaceId, null);
});

test("unbound Agent threads resolve stable isolated private workspaces", () => {
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const first = threadService.createThread({
    userId: user.id,
    title: "Private Agent A",
    agentEnabled: true,
  });
  const second = threadService.createThread({
    userId: user.id,
    title: "Private Agent B",
    agentEnabled: true,
  });

  assert.equal(first.workspaceId, null);
  assert.equal(second.workspaceId, null);
  assert.ok(privateAgentWorkspaceService.get(first.id, user.id));
  assert.ok(privateAgentWorkspaceService.get(second.id, user.id));

  const firstRoot = threadService.getEffectiveAgentWorkspaceRoot(first.id, user.id);
  const firstRootAgain = threadService.getEffectiveAgentWorkspaceRoot(first.id, user.id);
  const secondRoot = threadService.getEffectiveAgentWorkspaceRoot(second.id, user.id);

  assert.ok(firstRoot);
  assert.ok(secondRoot);
  assert.equal(firstRootAgain, firstRoot);
  assert.notEqual(secondRoot, firstRoot);
  assert.equal(path.basename(firstRoot), first.id);
  assert.match(path.basename(firstRoot), /^[a-f0-9]{32}$/);

  const storageRoot = path.resolve(path.dirname(testDbPath));
  const relative = path.relative(storageRoot, firstRoot);
  assert.ok(relative);
  assert.equal(relative.startsWith(".."), false);
  assert.equal(path.isAbsolute(relative), false);

  const plain = threadService.createThread({
    userId: user.id,
    title: "Plain then Agent",
  });
  assert.equal(privateAgentWorkspaceService.get(plain.id, user.id), null);
  assert.equal(
    threadService.getEffectiveAgentWorkspaceRoot(plain.id, user.id),
    null,
  );
  assert.equal(privateAgentWorkspaceService.get(plain.id, user.id), null);
  const activated = threadService.updateThread(plain.id, user.id, {
    agentEnabled: true,
  });
  assert.equal(activated?.workspaceId, null);
  assert.ok(privateAgentWorkspaceService.get(plain.id, user.id));
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


const createNotificationThreadFixture = () => {
  const user = userRepository.create({
    username: `notify-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });
  const installationId = `installation-${crypto.randomUUID()}`;
  hostNotificationRepository.upsertBinding({
    installationId,
    originRemoteDeviceId: `device-${crypto.randomUUID()}`,
    ownerUserId: user.id,
    brokerBaseUrl: "https://push.example.test",
    deliveryToken: `delivery-${crypto.randomUUID()}-01234567890123456789012345678901`,
    sourceScope: [thread.id],
  });
  return { user, thread, installationId };
};

const installOutboxInsertFailureTrigger = () => {
  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TRIGGER fail_notification_outbox_insert
    BEFORE INSERT ON notification_outbox
    BEGIN
      SELECT RAISE(ABORT, 'injected notification outbox failure');
    END;
  `);
  return () => {
    sqlite.exec("DROP TRIGGER IF EXISTS fail_notification_outbox_insert");
  };
};

test("canonical assistant insert atomically creates one notification outbox row", () => {
  const { user, thread, installationId } = createNotificationThreadFixture();
  const assistantMessageId = `assistant-${crypto.randomUUID()}`;

  threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    role: "assistant",
    content: "ordinary final reply",
    parts: [{ type: "text", text: "ordinary final reply" }],
  });

  const rows = getSqlite()
    .prepare(
      `SELECT installation_id, canonical_message_id, source_id,
              eligibility_event, state
       FROM notification_outbox
       WHERE installation_id = ? AND canonical_message_id = ?`,
    )
    .all(installationId, assistantMessageId) as Array<Record<string, unknown>>;

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.canonical_message_id, assistantMessageId);
  assert.equal(rows[0]?.source_id, thread.id);
  assert.equal(rows[0]?.eligibility_event, "final_transition_first_seen");
  assert.equal(rows[0]?.state, "pending");

  threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    role: "assistant",
    content: "ordinary final reply with refreshed metadata",
    parts: [
      { type: "text", text: "ordinary final reply with refreshed metadata" },
    ],
  });

  const count = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM notification_outbox
       WHERE installation_id = ? AND canonical_message_id = ?`,
    )
    .get(installationId, assistantMessageId) as { count: number };
  assert.equal(count.count, 1);
});

test("corrupt delivery token does not block canonical Assistant persistence", () => {
  const { user, thread, installationId } = createNotificationThreadFixture();
  const assistantMessageId = `assistant-token-${crypto.randomUUID()}`;

  getSqlite()
    .prepare(
      "UPDATE host_notification_bindings SET delivery_token_encrypted = ? WHERE installation_id = ?",
    )
    .run("bad.bad.bad", installationId);

  const created = threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    role: "assistant",
    content: "final reply still persists",
    parts: [{ type: "text", text: "final reply still persists" }],
  });

  assert.equal(created.id, assistantMessageId);
  const outbox = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM notification_outbox
       WHERE installation_id = ? AND canonical_message_id = ?`,
    )
    .get(installationId, assistantMessageId) as { count: number };
  assert.equal(outbox.count, 1);
});

test("Agent running to completed produces one outbox event while waiting approval does not", () => {
  const { user, thread, installationId } = createNotificationThreadFixture();
  const assistantMessageId = `assistant-agent-${crypto.randomUUID()}`;

  threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    role: "assistant",
    content: "Agent 正在运行…",
    parts: [{ type: "text", text: "Agent 正在运行…" }],
    metadata: { agent: { status: "running" } },
    preserveDescendants: true,
  });

  threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    role: "assistant",
    content: "等待审批",
    parts: [{ type: "text", text: "等待审批" }],
    metadata: { agent: { status: "waiting_approval" } },
    preserveDescendants: true,
  });

  let count = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM notification_outbox
       WHERE installation_id = ? AND canonical_message_id = ?`,
    )
    .get(installationId, assistantMessageId) as { count: number };
  assert.equal(count.count, 0);

  threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    role: "assistant",
    content: "等待审批",
    parts: [{ type: "text", text: "等待审批" }],
    metadata: { agent: { status: "running" } },
    preserveDescendants: true,
  });

  threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    role: "assistant",
    content: "批准后的最终答案",
    parts: [{ type: "text", text: "批准后的最终答案" }],
    metadata: { agent: { status: "completed" } },
    preserveDescendants: true,
  });

  count = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM notification_outbox
       WHERE installation_id = ? AND canonical_message_id = ?`,
    )
    .get(installationId, assistantMessageId) as { count: number };
  assert.equal(count.count, 1);
});

test("metadata-only completion transition enqueues the canonical assistant once", () => {
  const { user, thread, installationId } = createNotificationThreadFixture();
  const assistantMessageId = `assistant-metadata-${crypto.randomUUID()}`;

  threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    role: "assistant",
    content: "final text already persisted",
    parts: [{ type: "text", text: "final text already persisted" }],
    metadata: { agent: { status: "running" } },
    preserveDescendants: true,
  });

  let count = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM notification_outbox
       WHERE installation_id = ? AND canonical_message_id = ?`,
    )
    .get(installationId, assistantMessageId) as { count: number };
  assert.equal(count.count, 0);

  const completed = threadService.updateMessageMetadata(
    thread.id,
    assistantMessageId,
    user.id,
    { agent: { status: "completed" } },
  );
  assert.equal(
    (completed?.metadata.agent as { status?: string } | undefined)?.status,
    "completed",
  );

  count = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM notification_outbox
       WHERE installation_id = ? AND canonical_message_id = ?`,
    )
    .get(installationId, assistantMessageId) as { count: number };
  assert.equal(count.count, 1);

  threadService.updateMessageMetadata(
    thread.id,
    assistantMessageId,
    user.id,
    { agent: { status: "completed" }, refreshed: true },
  );

  count = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM notification_outbox
       WHERE installation_id = ? AND canonical_message_id = ?`,
    )
    .get(installationId, assistantMessageId) as { count: number };
  assert.equal(count.count, 1);
});

test("notification outbox failure rolls back the canonical assistant message", () => {
  const { user, thread } = createNotificationThreadFixture();
  const assistantMessageId = `assistant-rollback-${crypto.randomUUID()}`;

  const removeFailureTrigger = installOutboxInsertFailureTrigger();
  try {
    assert.throws(
      () =>
        threadService.createMessage(thread.id, user.id, {
          id: assistantMessageId,
          role: "assistant",
          content: "must roll back with outbox",
          parts: [{ type: "text", text: "must roll back with outbox" }],
        }),
      /injected notification outbox failure/,
    );

    assert.equal(messageRepository.findById(assistantMessageId), undefined);
    const outbox = getSqlite()
      .prepare(
        "SELECT COUNT(*) AS count FROM notification_outbox WHERE canonical_message_id = ?",
      )
      .get(assistantMessageId) as { count: number };
    assert.equal(outbox.count, 0);
  } finally {
    removeFailureTrigger();
  }
});

test("notification failure leaves existing message descendants and media cleanup untouched", () => {
  const { user, thread } = createNotificationThreadFixture();
  const parent = threadService.createMessage(thread.id, user.id, {
    id: `user-parent-${crypto.randomUUID()}`,
    role: "user",
    content: "parent",
    parts: [{ type: "text", text: "parent" }],
  });
  const assistantMessageId = `assistant-existing-${crypto.randomUUID()}`;
  threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    parentId: parent.id,
    role: "assistant",
    content: "Agent 正在运行…",
    parts: [{ type: "text", text: "Agent 正在运行…" }],
    metadata: { agent: { status: "running" } },
    preserveDescendants: true,
  });
  const descendant = threadService.createMessage(thread.id, user.id, {
    id: `user-descendant-${crypto.randomUUID()}`,
    parentId: assistantMessageId,
    role: "user",
    content: "keep me",
    parts: [{ type: "text", text: "keep me" }],
  });

  const removeFailureTrigger = installOutboxInsertFailureTrigger();
  const cleanupSpy = vi.spyOn(chatMediaService, "removeCleanupSnapshot");
  try {
    assert.throws(
      () =>
        threadService.createMessage(thread.id, user.id, {
          id: assistantMessageId,
          parentId: parent.id,
          role: "assistant",
          content: "最终答案",
          parts: [{ type: "text", text: "最终答案" }],
          metadata: { agent: { status: "completed" } },
        }),
      /injected notification outbox failure/,
    );

    const persisted = threadService.getMessageById(assistantMessageId, user.id);
    assert.equal(persisted?.content, "Agent 正在运行…");
    assert.equal(
      (persisted?.metadata.agent as { status?: string } | undefined)?.status,
      "running",
    );
    assert.equal(
      threadService.getMessageById(descendant.id, user.id)?.content,
      "keep me",
    );
    assert.equal(cleanupSpy.mock.calls.length, 0);
  } finally {
    cleanupSpy.mockRestore();
    removeFailureTrigger();
  }
});

test("post-commit cleanup failure is journaled for retry without corrupting canonical notification state", () => {
  const { user, thread, installationId } = createNotificationThreadFixture();
  const assistantMessageId = `assistant-cleanup-${crypto.randomUUID()}`;

  threadService.createMessage(thread.id, user.id, {
    id: assistantMessageId,
    role: "assistant",
    content: "Agent 正在运行…",
    parts: [
      { type: "text", text: "Agent 正在运行…" },
      {
        type: "file",
        data: "/attachments/old-file.txt",
        filename: "old-file.txt",
        mimeType: "text/plain",
      },
    ],
    metadata: { agent: { status: "running" } },
    preserveDescendants: true,
  });

  const cleanupSpy = vi
    .spyOn(chatMediaService, "removeCleanupSnapshot")
    .mockImplementation(() => {
      throw new Error("injected cleanup failure");
    });

  try {
    const completed = threadService.createMessage(thread.id, user.id, {
      id: assistantMessageId,
      role: "assistant",
      content: "最终答案",
      parts: [{ type: "text", text: "最终答案" }],
      metadata: { agent: { status: "completed" } },
      preserveDescendants: true,
    });

    assert.equal(completed.content, "最终答案");
    assert.equal(
      (completed.metadata.agent as { status?: string } | undefined)?.status,
      "completed",
    );

    const outbox = getSqlite()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM notification_outbox
         WHERE installation_id = ? AND canonical_message_id = ?`,
      )
      .get(installationId, assistantMessageId) as { count: number };
    assert.equal(outbox.count, 1);

    const cleanupJob = getSqlite()
      .prepare(
        `SELECT state, attempt_count, last_error
         FROM canonical_message_cleanup_jobs
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get() as
      | {
          state: string;
          attempt_count: number;
          last_error: string | null;
        }
      | undefined;

    assert.ok(cleanupJob);
    assert.equal(cleanupJob.state, "pending");
    assert.equal(cleanupJob.attempt_count, 1);
    assert.match(cleanupJob.last_error ?? "", /injected cleanup failure/);
  } finally {
    cleanupSpy.mockRestore();
  }
});

test("notification outbox stores identity only and never persists Assistant text", () => {
  const columns = getSqlite()
    .prepare("PRAGMA table_info(notification_outbox)")
    .all() as Array<{ name: string }>;

  const names = new Set(columns.map((column) => column.name));
  assert.equal(names.has("content"), false);
  assert.equal(names.has("body"), false);
  assert.equal(names.has("prompt"), false);
  assert.equal(names.has("tool_output"), false);
});
