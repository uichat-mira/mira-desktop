import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterAll, test } from "vitest";
import { initializeAuthDatabase } from "@/db/auth.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { resetDatabaseClients } from "@/db";
import { threadRepository, userRepository } from "@/db/repositories";
import { conversationWorkdirService } from "./conversation-workdir.service.js";
import { conversationArtifactService, ConversationArtifactError } from "./conversation-artifact.service.js";
import { createTimestampedTestArtifactPath, getTestArtifactDir } from "@/test-support/artifacts.js";

const root = getTestArtifactDir("conversation-artifact", `${process.pid}-${Date.now()}`);
const db = createTimestampedTestArtifactPath("db", "conversation-artifact", ".sqlite");
process.env.DATABASE_URL = `file:${db}`;
resetDatabaseClients(); initializeAuthDatabase(); initializeModelConfigDatabase(); initializeKnowledgeBaseDatabase(); initializeRoleDatabase(); initializeThreadDatabase();
const user = userRepository.create({ username: `artifact-${Date.now()}`, passwordHash: "x", role: "user" });
const thread = threadRepository.create({ userId: user.id, title: "artifact" });
const workdir = conversationWorkdirService.ensure({ threadId: thread.id, userId: user.id, storageRoot: root });
fs.writeFileSync(path.join(workdir.rootPath, "final.txt"), "ok");
let registeredId = "";

afterAll(() => { resetDatabaseClients(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(db, { force: true }); fs.rmSync(`${db}-wal`, { force: true }); fs.rmSync(`${db}-shm`, { force: true }); });

test("registers stable final identity and resolves after reload", () => {
  const ref = conversationArtifactService.register({ threadId: thread.id, userId: user.id, sourceRelativePath: "final.txt", lifecycle: "final", mimeType: "text/plain" });
  registeredId = ref.id;
  assert.equal(ref.threadId, thread.id); assert.equal(ref.workdirId, workdir.id); assert.equal(ref.lifecycle, "final");
  resetDatabaseClients(); initializeAuthDatabase(); initializeModelConfigDatabase(); initializeKnowledgeBaseDatabase(); initializeRoleDatabase(); initializeThreadDatabase();
  const resolved = conversationArtifactService.resolve({ id: ref.id, threadId: thread.id, userId: user.id, storageRoot: root });
  assert.equal(resolved.reference.id, ref.id); assert.equal(resolved.absolutePath, path.join(workdir.rootPath, "final.txt"));
});

test("fails closed for temporary, traversal, absolute path, ownership and stale source", () => {
  assert.throws(() => conversationArtifactService.register({ threadId: thread.id, userId: user.id, sourceRelativePath: "tmp.txt", lifecycle: "temporary" }), (e) => e instanceof ConversationArtifactError && e.code === "invalid_source");
  for (const sourceRelativePath of ["../escape.txt", path.resolve(root, "final.txt")]) assert.throws(() => conversationArtifactService.register({ threadId: thread.id, userId: user.id, sourceRelativePath, lifecycle: "final" }), ConversationArtifactError);
  assert.throws(() => conversationArtifactService.resolve({ id: "missing", threadId: thread.id, userId: user.id }), (e) => e instanceof ConversationArtifactError && e.code === "invalid_ownership");
  fs.rmSync(path.join(workdir.rootPath, "final.txt"));
  assert.throws(() => conversationArtifactService.resolve({ id: registeredId, threadId: thread.id, userId: user.id, storageRoot: root }), (e) => e instanceof ConversationArtifactError && e.code === "missing_source");
  assert.throws(() => conversationArtifactService.register({ threadId: thread.id, userId: user.id, sourceRelativePath: "missing.txt", lifecycle: "final" }), (e) => e instanceof ConversationArtifactError && e.code === "missing_source");
});

test("rejects symlinked source outside the workdir", () => {
  const outside = path.join(root, "outside.txt");
  const linked = path.join(workdir.rootPath, "linked.txt");
  fs.writeFileSync(outside, "outside");
  try {
    fs.symlinkSync(outside, linked);
  } catch {
    return;
  }
  assert.throws(() => conversationArtifactService.register({ threadId: thread.id, userId: user.id, sourceRelativePath: "linked.txt", lifecycle: "final" }), (e) => e instanceof ConversationArtifactError && e.code === "containment_failure");
});
