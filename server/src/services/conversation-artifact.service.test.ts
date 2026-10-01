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
import {
  chatWorkspaceRepository,
  conversationArtifactRepository,
  threadRepository,
  userRepository,
} from "@/db/repositories";
import {
  conversationArtifactService,
  ConversationArtifactError,
} from "./conversation-artifact.service.js";
import { privateAgentWorkspaceService } from "./agent-workspace.service.js";
import {
  createTimestampedTestArtifactPath,
  getTestArtifactDir,
} from "@/test-support/artifacts.js";

const root = getTestArtifactDir(
  "conversation-artifact",
  `${process.pid}-${Date.now()}`,
);
const db = createTimestampedTestArtifactPath(
  "db",
  "conversation-artifact",
  ".sqlite",
);
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDatabaseDir = process.env.UI_CHAT_DATABASE_DIR;
process.env.DATABASE_URL = `file:${db}`;
process.env.UI_CHAT_DATABASE_DIR = root;

resetDatabaseClients();
initializeAuthDatabase();
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeRoleDatabase();
initializeThreadDatabase();

const user = userRepository.create({
  username: `artifact-${Date.now()}`,
  passwordHash: "x",
  role: "user",
});
const thread = threadRepository.create({
  userId: user.id,
  title: "artifact",
});
const privateRoot = privateAgentWorkspaceService.ensure({
  threadId: thread.id,
  userId: user.id,
});
fs.writeFileSync(path.join(privateRoot, "final.txt"), "ok");

afterAll(() => {
  resetDatabaseClients();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalDatabaseDir === undefined) delete process.env.UI_CHAT_DATABASE_DIR;
  else process.env.UI_CHAT_DATABASE_DIR = originalDatabaseDir;
  fs.rmSync(root, { recursive: true, force: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${db}${suffix}`, { force: true });
  }
});

test("registers a private-workspace artifact with a frozen source root", () => {
  const ref = conversationArtifactService.register({
    threadId: thread.id,
    userId: user.id,
    sourceRootPath: privateRoot,
    sourceRelativePath: "final.txt",
    lifecycle: "final",
    mimeType: "text/plain",
  });

  assert.equal(ref.threadId, thread.id);
  assert.equal("sourceRootPath" in ref, false);
  assert.equal(ref.sourceRelativePath, "final.txt");
  const persisted = conversationArtifactRepository.findById(ref.id, user.id);
  assert.equal(persisted?.sourceRootPath, fs.realpathSync(privateRoot));

  resetDatabaseClients();
  initializeAuthDatabase();
  initializeModelConfigDatabase();
  initializeKnowledgeBaseDatabase();
  initializeRoleDatabase();
  initializeThreadDatabase();

  const resolved = conversationArtifactService.resolve({
    id: ref.id,
    threadId: thread.id,
    userId: user.id,
  });
  assert.equal(resolved.absolutePath, path.join(privateRoot, "final.txt"));
  assert.equal(fs.readFileSync(resolved.absolutePath, "utf8"), "ok");
});

test("read-back stays on the creation root after the thread switches Workspace", () => {
  fs.writeFileSync(path.join(privateRoot, "stable.txt"), "private");
  const ref = conversationArtifactService.register({
    threadId: thread.id,
    userId: user.id,
    sourceRootPath: privateRoot,
    sourceRelativePath: "stable.txt",
    lifecycle: "final",
  });

  const explicitRoot = path.join(root, "explicit");
  fs.mkdirSync(explicitRoot, { recursive: true });
  fs.writeFileSync(path.join(explicitRoot, "stable.txt"), "explicit");
  const workspace = chatWorkspaceRepository.create({
    userId: user.id,
    name: "Explicit",
    rootPath: explicitRoot,
    status: "active",
  });
  threadRepository.updateById(thread.id, { workspaceId: workspace.id });

  const resolved = conversationArtifactService.resolve({
    id: ref.id,
    threadId: thread.id,
    userId: user.id,
  });
  assert.equal(fs.readFileSync(resolved.absolutePath, "utf8"), "private");
  assert.equal("sourceRootPath" in resolved.reference, false);
});

test("registers output from the thread's explicit Workspace", () => {
  const explicitRoot = path.join(root, "explicit-register");
  fs.mkdirSync(explicitRoot, { recursive: true });
  fs.writeFileSync(path.join(explicitRoot, "report.txt"), "report");
  const explicitThread = threadRepository.create({
    userId: user.id,
    title: "explicit",
  });
  const workspace = chatWorkspaceRepository.create({
    userId: user.id,
    name: "Explicit register",
    rootPath: explicitRoot,
    status: "active",
  });
  threadRepository.updateById(explicitThread.id, { workspaceId: workspace.id });

  const ref = conversationArtifactService.register({
    threadId: explicitThread.id,
    userId: user.id,
    sourceRootPath: explicitRoot,
    sourceRelativePath: "report.txt",
    lifecycle: "final",
  });
  assert.equal("sourceRootPath" in ref, false);
  assert.equal(
    conversationArtifactRepository.findById(ref.id, user.id)?.sourceRootPath,
    fs.realpathSync(explicitRoot),
  );
});

test("rejects roots that do not belong to the conversation", () => {
  const outside = path.join(root, "outside-root");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "x.txt"), "x");

  assert.throws(
    () =>
      conversationArtifactService.register({
        threadId: thread.id,
        userId: user.id,
        sourceRootPath: outside,
        sourceRelativePath: "x.txt",
        lifecycle: "final",
      }),
    (error) =>
      error instanceof ConversationArtifactError &&
      error.code === "invalid_ownership",
  );
});

test("rejects traversal, absolute, missing, temporary, and cross-thread reads", () => {
  for (const sourceRelativePath of [
    "../escape.txt",
    path.resolve(root, "absolute.txt"),
  ]) {
    assert.throws(
      () =>
        conversationArtifactService.register({
          threadId: thread.id,
          userId: user.id,
          sourceRootPath: privateRoot,
          sourceRelativePath,
          lifecycle: "final",
        }),
      ConversationArtifactError,
    );
  }

  assert.throws(
    () =>
      conversationArtifactService.register({
        threadId: thread.id,
        userId: user.id,
        sourceRootPath: privateRoot,
        sourceRelativePath: "final.txt",
        lifecycle: "temporary",
      }),
    (error) =>
      error instanceof ConversationArtifactError &&
      error.code === "invalid_source",
  );

  assert.throws(
    () =>
      conversationArtifactService.register({
        threadId: thread.id,
        userId: user.id,
        sourceRootPath: privateRoot,
        sourceRelativePath: "missing.txt",
        lifecycle: "final",
      }),
    (error) =>
      error instanceof ConversationArtifactError &&
      error.code === "missing_source",
  );

  const id = `artifact-cross-${crypto.randomUUID()}`;
  conversationArtifactRepository.create({
    id,
    threadId: thread.id,
    userId: user.id,
    sourceRootPath: privateRoot,
    sourceRelativePath: "final.txt",
    lifecycle: "final",
    mimeType: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const otherThread = threadRepository.create({
    userId: user.id,
    title: "other",
  });
  assert.throws(
    () =>
      conversationArtifactService.resolve({
        id,
        threadId: otherThread.id,
        userId: user.id,
      }),
    (error) =>
      error instanceof ConversationArtifactError &&
      error.code === "invalid_ownership",
  );
});

test("rejects a symlinked source outside the frozen root", () => {
  const outside = path.join(root, "outside.txt");
  const linked = path.join(privateRoot, "linked.txt");
  fs.writeFileSync(outside, "outside");
  try {
    fs.symlinkSync(outside, linked);
  } catch {
    return;
  }

  assert.throws(
    () =>
      conversationArtifactService.register({
        threadId: thread.id,
        userId: user.id,
        sourceRootPath: privateRoot,
        sourceRelativePath: "linked.txt",
        lifecycle: "final",
      }),
    (error) =>
      error instanceof ConversationArtifactError &&
      error.code === "containment_failure",
  );
});
