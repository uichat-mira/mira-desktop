import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterAll, test } from "vitest";
import { initializeAuthDatabase } from "@/db/auth.db";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { resetDatabaseClients } from "@/db/index.js";
import {
  chatWorkspaceRepository,
  threadRepository,
  userRepository,
} from "@/db/repositories/index.js";
import {
  AgentWorkspaceError,
  buildPrivateAgentWorkspacePath,
  isPrivateAgentWorkspacePathContained,
  privateAgentWorkspaceService,
  resolvePrivateAgentWorkspaceStorageRoot,
} from "./agent-workspace.service.js";
import { threadService } from "./thread.service.js";
import {
  createTimestampedTestArtifactPath,
  getTestArtifactDir,
} from "@/test-support/artifacts.js";

const scope = `agent-workspace-${process.pid}-${Date.now()}`;
const testRoot = getTestArtifactDir("agent-workspace", scope);
const databasePath = createTimestampedTestArtifactPath(
  "db",
  "agent-workspace",
  ".sqlite",
);
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDatabaseDir = process.env.UI_CHAT_DATABASE_DIR;

process.env.DATABASE_URL = `file:${databasePath}`;
process.env.UI_CHAT_DATABASE_DIR = testRoot;
resetDatabaseClients();
initializeAuthDatabase();
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeRoleDatabase();
initializeThreadDatabase();

afterAll(() => {
  resetDatabaseClients();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalDatabaseDir === undefined) delete process.env.UI_CHAT_DATABASE_DIR;
  else process.env.UI_CHAT_DATABASE_DIR = originalDatabaseDir;
  fs.rmSync(testRoot, { recursive: true, force: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

test("private Agent workspace path is deterministic and contained", () => {
  assert.equal(
    buildPrivateAgentWorkspacePath(
      { storageRoot: "/var/lib/mira/data", userId: 7, threadId: "thread-a" },
      path.posix,
    ),
    "/var/lib/mira/data/conversation-workdirs/user-7/thread-a",
  );
  assert.equal(
    isPrivateAgentWorkspacePathContained(
      "C:\\Users\\Mira\\Data",
      "c:\\users\\mira\\data\\conversation-workdirs\\user-7\\thread",
      path.win32,
      true,
    ),
    true,
  );
});

test("two unbound Agent conversations receive different stable roots", () => {
  const user = userRepository.create({
    username: `workspace-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const first = threadService.createThread({
    userId: user.id,
    agentEnabled: true,
  });
  const second = threadService.createThread({
    userId: user.id,
    agentEnabled: true,
  });

  const firstRoot = threadService.getEffectiveAgentWorkspaceRoot(
    first.id,
    user.id,
  );
  const firstAgain = threadService.getEffectiveAgentWorkspaceRoot(
    first.id,
    user.id,
  );
  const secondRoot = threadService.getEffectiveAgentWorkspaceRoot(
    second.id,
    user.id,
  );

  assert.ok(firstRoot);
  assert.ok(secondRoot);
  assert.equal(firstAgain, firstRoot);
  assert.notEqual(secondRoot, firstRoot);
  assert.equal(path.basename(firstRoot), first.id);
  assert.equal(path.basename(secondRoot), second.id);

  fs.writeFileSync(path.join(firstRoot, "A-only.txt"), "hello-175");
  assert.equal(fs.existsSync(path.join(secondRoot, "A-only.txt")), false);
});

test("private workspace creation does not create a ChatWorkspace row", () => {
  const user = userRepository.create({
    username: `private-no-row-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const before = chatWorkspaceRepository.list({ userId: user.id }).length;
  const thread = threadRepository.create({ userId: user.id, title: "private" });
  const root = privateAgentWorkspaceService.ensure({
    threadId: thread.id,
    userId: user.id,
  });
  assert.equal(fs.statSync(root).isDirectory(), true);
  assert.equal(chatWorkspaceRepository.list({ userId: user.id }).length, before);
});

test("explicit Workspace remains authoritative", () => {
  const user = userRepository.create({
    username: `explicit-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const explicitRoot = path.join(testRoot, "explicit", crypto.randomUUID());
  fs.mkdirSync(explicitRoot, { recursive: true });
  const workspace = chatWorkspaceRepository.create({
    userId: user.id,
    name: "Explicit",
    rootPath: explicitRoot,
    status: "active",
  });
  const thread = threadService.createThread({
    userId: user.id,
    workspaceId: workspace.id,
    agentEnabled: true,
  });
  assert.equal(
    threadService.ensureEffectiveAgentWorkspaceRoot(thread.id, user.id),
    explicitRoot,
  );
});

test("private workspace rejects wrong owner and symlinked storage", () => {
  const owner = userRepository.create({
    username: `owner-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const other = userRepository.create({
    username: `other-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadRepository.create({ userId: owner.id, title: "owned" });

  assert.throws(
    () =>
      privateAgentWorkspaceService.ensure({
        threadId: thread.id,
        userId: other.id,
      }),
    (error) =>
      error instanceof AgentWorkspaceError &&
      error.code === "thread_not_found",
  );

  const linkedRoot = path.join(testRoot, "linked-root");
  const outside = path.join(testRoot, "linked-outside");
  fs.mkdirSync(linkedRoot, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  try {
    fs.symlinkSync(
      outside,
      path.join(linkedRoot, "conversation-workdirs"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch {
    return;
  }
  assert.throws(
    () =>
      privateAgentWorkspaceService.ensure({
        threadId: thread.id,
        userId: owner.id,
        storageRoot: linkedRoot,
      }),
    (error) =>
      error instanceof AgentWorkspaceError && error.code === "linked_path",
  );
});

test("thread deletion removes only its private Agent workspace", () => {
  const user = userRepository.create({
    username: `cleanup-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const first = threadService.createThread({ userId: user.id, agentEnabled: true });
  const second = threadService.createThread({ userId: user.id, agentEnabled: true });
  const firstRoot = privateAgentWorkspaceService.get(first.id, user.id);
  const secondRoot = privateAgentWorkspaceService.get(second.id, user.id);
  assert.ok(firstRoot);
  assert.ok(secondRoot);

  assert.equal(threadService.deleteThread(first.id, user.id), true);
  assert.equal(fs.existsSync(firstRoot), false);
  assert.equal(fs.existsSync(secondRoot), true);
});

test("storage root still follows the app-data configuration", () => {
  assert.equal(
    resolvePrivateAgentWorkspaceStorageRoot({
      UI_CHAT_DATABASE_DIR: testRoot,
    }),
    path.resolve(testRoot),
  );
});
