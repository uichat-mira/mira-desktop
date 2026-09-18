import assert from "node:assert/strict";
import fs from "node:fs";
import { afterAll, test } from "vitest";
import Fastify from "fastify";
import { initializeAuthDatabase, createAccessToken } from "@/db/auth.db";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { resetDatabaseClients } from "@/db/index.js";
import { knowledgeBaseRepository, roleRepository, userRepository } from "@/db/repositories";
import threadRoute from "@/routes/thread/index.js";
import { getLoggerConfig } from "@/logger";
import { llmService } from "@/services/llm.service.js";
import { sendRouteError } from "@/utils/route-errors.js";
import { threadService } from "@/services/thread.service.js";
import { managedMediaCleanupService } from "@/services/managed-media-cleanup.service.js";
import { logFilesService } from "@/services/log-files.service.js";
import { conversationWorkdirService } from "@/services/conversation-workdir.service.js";
import { vi } from "vitest";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const testDbPath = createTimestampedTestArtifactPath("db", "rag-demo-thread-routes", ".sqlite");

process.env.DATABASE_URL = `file:${testDbPath}`;
resetDatabaseClients();

initializeAuthDatabase();
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeRoleDatabase();
initializeThreadDatabase();

afterAll(() => {
  resetDatabaseClients();
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // ignore cleanup failure on Windows file locking
  }
});

test("PATCH /threads/:id returns 200 when unbinding knowledgeBaseId to null", async () => {
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  await app.register(threadRoute);

  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const knowledgeBase = knowledgeBaseRepository.create({
    name: `KB-${crypto.randomUUID()}`,
    description: "",
    status: "active",
    chunkingConfigJson: "{}",
    metadataJson: "{}",
  });
  const thread = threadService.createThread({
    userId: user.id,
    knowledgeBaseId: knowledgeBase.id,
  });

  const response = await app.inject({
    method: "PATCH",
    url: `/threads/${thread.id}`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      knowledgeBaseId: null,
    },
  });

  assert.equal(response.statusCode, 200, response.body);

  const body = response.json() as {
    success: boolean;
    data: {
      id: string;
      knowledgeBaseId: string | null;
    };
  };

  assert.equal(body.success, true);
  assert.equal(body.data.id, thread.id);
  assert.equal(body.data.knowledgeBaseId, null);

  await app.close();
});

test("thread media switches persist through create and patch", async () => {
  const app = Fastify({ logger: getLoggerConfig(), serializerOpts: { encoding: "utf8" } });
  app.setErrorHandler(sendRouteError);
  await app.register(threadRoute);
  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const token = createAccessToken({ id: user.id, username: user.username, role: user.role });
  const created = await app.inject({
    method: "POST",
    url: "/threads",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { ttsEnabled: true, imageEnabled: true },
  });
  assert.equal(created.statusCode, 200, created.body);
  const createdThread = created.json().data as { id: string; ttsEnabled: boolean; imageEnabled: boolean };
  assert.equal(createdThread.ttsEnabled, true);
  assert.equal(createdThread.imageEnabled, true);

  const updated = await app.inject({
    method: "PATCH",
    url: `/threads/${createdThread.id}`,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { ttsEnabled: false, imageEnabled: false },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().data.ttsEnabled, false);
  assert.equal(updated.json().data.imageEnabled, false);
  await app.close();
});

test("DELETE /threads/history removes all user threads and keeps workspaces", async () => {
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  await app.register(threadRoute);

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
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const workspace = threadService.createChatWorkspace({
    userId: user.id,
    name: "Keep me",
    rootPath:
      process.platform === "win32"
        ? "D:\\workspace\\keep-me"
        : "/workspace/keep-me",
  });
  const archived = threadService.createThread({
    userId: user.id,
    workspaceId: workspace.id,
  });
  threadService.createMessage(archived.id, user.id, {
    role: "user",
    content: "history",
    parts: [{ type: "text", text: "history" }],
  });
  threadService.archiveThread(archived.id, user.id);
  const active = threadService.createThread({ userId: user.id });
  const otherArchived = threadService.createThread({ userId: otherUser.id });
  threadService.archiveThread(otherArchived.id, otherUser.id);

  const mediaCleanupSpy = vi
    .spyOn(managedMediaCleanupService, "clear")
    .mockResolvedValue({
      attachments: { files: 1, bytes: 100 },
      generatedImages: { files: 1, bytes: 200 },
      generatedAudio: { files: 1, bytes: 300 },
      generatedVideos: { files: 0, bytes: 0 },
    });

  const response = await app.inject({
    method: "DELETE",
    url: "/threads/history",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 200, response.body);
  const cleanupData = response.json() as {
    data: {
      deletedThreads: number;
      deletedMessages: number;
      failedThreads: number;
      failedWorkdirs: number;
      clearedLogBytes: number;
      media: unknown;
    };
  };
  assert.deepEqual(
    {
      deletedThreads: cleanupData.data.deletedThreads,
      deletedMessages: cleanupData.data.deletedMessages,
      failedThreads: cleanupData.data.failedThreads,
      failedWorkdirs: cleanupData.data.failedWorkdirs,
    },
    { deletedThreads: 2, deletedMessages: 1, failedThreads: 0, failedWorkdirs: 0 },
  );
  assert.equal(typeof cleanupData.data.clearedLogBytes, "number");
  assert.deepEqual(cleanupData.data.media, {
    attachments: { files: 1, bytes: 100 },
    generatedImages: { files: 1, bytes: 200 },
    generatedAudio: { files: 1, bytes: 300 },
    generatedVideos: { files: 0, bytes: 0 },
  });
  assert.equal(threadService.getThreadById(archived.id, user.id), null);
  assert.equal(threadService.getThreadById(active.id, user.id), null);
  assert.ok(threadService.getThreadById(otherArchived.id, otherUser.id));
  assert.equal(threadService.listChatWorkspaces(user.id).length, 1);

  mediaCleanupSpy.mockRestore();
  await app.close();
});

test("DELETE /threads/history returns workdir cleanup failures and still clears logs/media", async () => {
  const app = Fastify({ logger: getLoggerConfig(), serializerOpts: { encoding: "utf8" } });
  app.setErrorHandler(sendRouteError);
  await app.register(threadRoute);

  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const token = createAccessToken({ id: user.id, username: user.username, role: user.role });
  const thread = threadService.createThread({ userId: user.id });
  const workdir = conversationWorkdirService.ensure({ threadId: thread.id, userId: user.id });
  const logSpy = vi.spyOn(logFilesService, "clearLogs").mockResolvedValue({ directory: "test", clearedFiles: [] });
  const mediaSpy = vi.spyOn(managedMediaCleanupService, "clear").mockResolvedValue({
    attachments: { files: 0, bytes: 0 },
    generatedImages: { files: 0, bytes: 0 },
    generatedAudio: { files: 0, bytes: 0 },
    generatedVideos: { files: 0, bytes: 0 },
  });
  const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => {
    throw Object.assign(new Error("busy"), { code: "EBUSY" });
  });

  try {
    const response = await app.inject({
      method: "DELETE",
      url: "/threads/history",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().data, {
      deletedThreads: 0,
      deletedMessages: 0,
      failedThreads: 0,
      failedWorkdirs: 1,
      clearedLogBytes: 0,
      media: {
        attachments: { files: 0, bytes: 0 },
        generatedImages: { files: 0, bytes: 0 },
        generatedAudio: { files: 0, bytes: 0 },
        generatedVideos: { files: 0, bytes: 0 },
      },
    });
    assert.ok(threadService.getThreadById(thread.id, user.id));
    assert.equal(fs.existsSync(workdir.rootPath), true);
    assert.equal(logSpy.mock.calls.length, 1);
    assert.equal(mediaSpy.mock.calls.length, 1);
  } finally {
    rmSpy.mockRestore();
    logSpy.mockRestore();
    mediaSpy.mockRestore();
    await app.close();
  }
});

test("PATCH /threads/:id persists roleId and allows clearing it", async () => {
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  await app.register(threadRoute);

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
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });

  const bindResponse = await app.inject({
    method: "PATCH",
    url: `/threads/${thread.id}`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      roleId: role.id,
    },
  });
  assert.equal(bindResponse.statusCode, 200, bindResponse.body);
  assert.equal(
    (bindResponse.json() as { data: { roleId: string | null } }).data.roleId,
    role.id,
  );

  const clearResponse = await app.inject({
    method: "PATCH",
    url: `/threads/${thread.id}`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      roleId: null,
    },
  });
  assert.equal(clearResponse.statusCode, 200, clearResponse.body);
  assert.equal(
    (clearResponse.json() as { data: { roleId: string | null } }).data.roleId,
    null,
  );

  await app.close();
});

test("POST /threads/:id/messages accepts pure image message parts with empty content", async () => {
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  await app.register(threadRoute);

  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });

  const response = await app.inject({
    method: "POST",
    url: `/threads/${thread.id}/messages`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      role: "user",
      content: "",
      parts: [
        {
          type: "image",
          image: "/attachments/thread-only.webp",
          filename: "thread-only.webp",
          fileId: "thread-image-1",
          mediaType: "image/webp",
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200, response.body);

  const body = response.json() as {
    success: boolean;
    data: {
      id: string;
      content: string;
      parts: Array<{ type: string }>;
    };
  };

  assert.equal(body.success, true);
  assert.equal(body.data.content, "");
  assert.equal(body.data.parts.length, 1);
  assert.equal(body.data.parts[0]?.type, "image");

  await app.close();
});

test("POST /threads/:id/context-summary generates and persists thread context summary", async () => {
  const generateSpy = vi
    .spyOn(llmService, "generateText")
    .mockResolvedValue("用户偏好简洁回答；当前正在继续后端改造。");
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  await app.register(threadRoute);

  const user = userRepository.create({
    username: `user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const token = createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });
  threadService.createMessage(thread.id, user.id, {
    role: "user",
    content: "请以后回答更简洁一些",
    parts: [{ type: "text", text: "请以后回答更简洁一些" }],
  });

  const response = await app.inject({
    method: "POST",
    url: `/threads/${thread.id}/context-summary`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {},
  });

  assert.equal(response.statusCode, 200, response.body);

  const body = response.json() as {
    success: boolean;
    data: {
      contextSummary: string | null;
      contextSummaryUpdatedAt: string | null;
    };
  };

  assert.equal(body.success, true);
  assert.equal(
    body.data.contextSummary,
    "用户偏好简洁回答；当前正在继续后端改造。",
  );
  assert.ok(body.data.contextSummaryUpdatedAt);
  assert.equal(generateSpy.mock.calls.length, 1);

  await app.close();
});
