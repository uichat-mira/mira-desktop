import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, test } from "vitest";
import { initializeAuthDatabase } from "@/db/auth.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { resetDatabaseClients } from "@/db/index.js";
import { imageGenerationJobsRepository } from "@/db/repositories/image-generation-jobs.repository.js";
import { messageRepository, threadRepository, userRepository } from "@/db/repositories";
import { chatMediaRepository } from "@/db/repositories/chat-media.repository.js";
import { chatMediaService } from "./chat-media.service.js";
import { threadService } from "./thread.service.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const dbPath = createTimestampedTestArtifactPath("db", "chat-media", ".sqlite");
const root = path.dirname(createTimestampedTestArtifactPath("media", "chat-media"));
const imageRoot = path.join(root, "images");
const ttsRoot = path.join(root, "audio");

beforeAll(() => {
  process.env.DATABASE_URL = `file:${dbPath}`;
  initializeAuthDatabase();
  initializeRoleDatabase();
  initializeModelConfigDatabase();
  initializeKnowledgeBaseDatabase();
  initializeThreadDatabase();
  chatMediaRepository.initialize();
  imageGenerationJobsRepository.initialize();
  fs.mkdirSync(imageRoot, { recursive: true });
  fs.mkdirSync(ttsRoot, { recursive: true });
  chatMediaService.configureRoots({ imageGenerationRoot: imageRoot, ttsRoot });
});

afterAll(() => {
  resetDatabaseClients();
  fs.rmSync(dbPath, { force: true });
});

test("attaches a verified image artifact and mirrors it to metadata.media", async () => {
  const user = userRepository.create({ username: `media-${crypto.randomUUID()}`, passwordHash: "hash", role: "user", isActive: true });
  const thread = threadRepository.create({ userId: user.id, title: "media", status: "active" });
  const message = messageRepository.create({ threadId: thread.id, role: "assistant", content: "done", metadata: "{}" });
  const absolutePath = path.join(imageRoot, "result.png");
  fs.writeFileSync(absolutePath, "png");
  await imageGenerationJobsRepository.create({
    id: "image-task-1", providerId: "test", executionKind: "sync-http", status: "succeeded",
    requestSummary: { providerId: "test", providerParamKeys: [], inputFileCount: 0, hasWorkflowApiJson: false },
    artifacts: [{ id: "artifact-1", type: "image", source: "base64", mimeType: "image/png", localPath: absolutePath }],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const record = await chatMediaService.attach({ threadId: thread.id, messageId: message.id, taskId: "image-task-1", mediaType: "image", absolutePath, mimeType: "image/png" });
  assert.equal(record.absolutePath, path.resolve(absolutePath));
  assert.match(messageRepository.findById(message.id)!.metadata!, /"media"/);
  assert.ok(chatMediaService.getForThreadRead(record.id, thread.id, user.id));
});

test("rejects relative and task-mismatched paths, and reports cleanup failures", async () => {
  const user = userRepository.create({ username: `media-${crypto.randomUUID()}`, passwordHash: "hash", role: "user", isActive: true });
  const thread = threadRepository.create({ userId: user.id, title: "media", status: "active" });
  const message = messageRepository.create({ threadId: thread.id, role: "assistant", content: "done", metadata: "{}" });
  await assert.rejects(() => chatMediaService.attach({ threadId: thread.id, messageId: message.id, taskId: "missing", mediaType: "image", absolutePath: "relative.png", mimeType: "image/png" }), /task was not found/);
  const runningPath = path.join(imageRoot, "running.png");
  fs.writeFileSync(runningPath, "partial-png");
  await imageGenerationJobsRepository.create({
    id: "running-image-task", providerId: "test", executionKind: "sync-http", status: "running",
    requestSummary: { providerId: "test", providerParamKeys: [], inputFileCount: 0, hasWorkflowApiJson: false },
    artifacts: [{ id: "running-artifact", type: "image", source: "base64", mimeType: "image/png", localPath: runningPath }],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  await assert.rejects(
    () => chatMediaService.attach({ threadId: thread.id, messageId: message.id, taskId: "running-image-task", mediaType: "image", absolutePath: runningPath, mimeType: "image/png" }),
    /must be succeeded/,
  );
  fs.rmSync(runningPath, { force: true });
  const record = chatMediaRepository.create({ id: crypto.randomUUID(), threadId: thread.id, messageId: message.id, taskId: "bad", mediaType: "image", absolutePath: path.join(root, "outside.png"), mimeType: "image/png" });
  const result = chatMediaService.removeForMessages([message.id]);
  assert.equal(result.failed, 1);
  assert.equal(result.errors[0].mediaId, record.id);
});

const createAttachedAssistantMedia = async (userId: number, label: string, withParent = false) => {
  const thread = threadService.createThread({ userId, title: label });
  const parent = withParent ? threadService.createMessage(thread.id, userId, { role: "user", content: "parent", parts: [{ type: "text", text: "parent" }] }) : null;
  const assistant = threadService.createMessage(thread.id, userId, { role: "assistant", content: label, parts: [{ type: "text", text: label }], parentId: parent?.id ?? null });
  const absolutePath = path.join(imageRoot, `${label}-${crypto.randomUUID()}.png`);
  fs.writeFileSync(absolutePath, "png");
  const taskId = `task-${crypto.randomUUID()}`;
  await imageGenerationJobsRepository.create({ id: taskId, providerId: "test", executionKind: "sync-http", status: "succeeded", requestSummary: { providerId: "test", providerParamKeys: [], inputFileCount: 0, hasWorkflowApiJson: false }, artifacts: [{ id: `artifact-${taskId}`, type: "image", source: "base64", mimeType: "image/png", localPath: absolutePath }], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  const media = await chatMediaService.attach({ threadId: thread.id, messageId: assistant.id, taskId, mediaType: "image", absolutePath, mimeType: "image/png" });
  return { thread, assistant, media, absolutePath, parent };
};

test("cleans media for regenerate, branch pruning, message deletion, and thread deletion", async () => {
  const user = userRepository.create({ username: `media-${crypto.randomUUID()}`, passwordHash: "hash", role: "user", isActive: true });

  const regenerated = await createAttachedAssistantMedia(user.id, "regenerate");
  threadService.createMessage(regenerated.thread.id, user.id, { id: regenerated.assistant.id, role: "assistant", content: "regenerated", parts: [{ type: "text", text: "regenerated" }] });
  await Promise.resolve();
  assert.equal(chatMediaRepository.getById(regenerated.media.id), null);
  assert.equal(fs.existsSync(regenerated.absolutePath), false);
  assert.equal(JSON.parse(messageRepository.findById(regenerated.assistant.id)!.metadata || "{}").media, undefined);

  const branched = await createAttachedAssistantMedia(user.id, "branch", true);
  threadService.createMessage(branched.thread.id, user.id, { role: "user", content: "new branch", parts: [{ type: "text", text: "new branch" }], metadata: { lineage: { parentId: branched.parent!.id } } });
  await Promise.resolve();
  assert.equal(chatMediaRepository.getById(branched.media.id), null);
  assert.equal(fs.existsSync(branched.absolutePath), false);
  assert.equal(messageRepository.findById(branched.assistant.id), undefined);

  const deletedMessage = await createAttachedAssistantMedia(user.id, "message-delete");
  assert.equal(threadService.deleteMessage(deletedMessage.assistant.id, user.id), true);
  assert.equal(chatMediaRepository.getById(deletedMessage.media.id), null);
  assert.equal(fs.existsSync(deletedMessage.absolutePath), false);
  assert.equal(messageRepository.findById(deletedMessage.assistant.id), undefined);

  const deletedThread = await createAttachedAssistantMedia(user.id, "thread-delete");
  assert.equal(threadService.deleteThread(deletedThread.thread.id, user.id), true);
  assert.equal(chatMediaRepository.getById(deletedThread.media.id), null);
  assert.equal(fs.existsSync(deletedThread.absolutePath), false);
  assert.equal(messageRepository.findById(deletedThread.assistant.id), undefined);
});
