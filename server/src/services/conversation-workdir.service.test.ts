import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterAll, test } from "vitest";
import { initializeAuthDatabase } from "@/db/auth.db";
import { resetDatabaseClients } from "@/db/index.js";
import { initializeThreadDatabase } from "@/db/thread.db";
import {
  agentRunRepository,
  chatWorkspaceRepository,
  conversationWorkdirRepository,
  userRepository,
} from "@/db/repositories/index.js";
import {
  buildConversationWorkdirPath,
  conversationWorkdirService,
  resolveConversationWorkdirStorageRoot,
} from "./conversation-workdir.service.js";
import { threadService } from "./thread.service.js";
import {
  createTimestampedTestArtifactPath,
  getTestArtifactDir,
} from "@/test-support/artifacts.js";

const scope = `conversation-workdir-${process.pid}-${Date.now()}`;
const testRoot = getTestArtifactDir("conversation-workdir", scope);
const databasePath = createTimestampedTestArtifactPath(
  "db",
  "conversation-workdir-foundation",
  ".sqlite",
);
const originalDatabaseUrl = process.env.DATABASE_URL;

process.env.DATABASE_URL = `file:${databasePath}`;
resetDatabaseClients();
initializeAuthDatabase();
initializeThreadDatabase();

afterAll(() => {
  resetDatabaseClients();
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.rmSync(databasePath, { force: true });
  fs.rmSync(`${databasePath}-wal`, { force: true });
  fs.rmSync(`${databasePath}-shm`, { force: true });
});

test("conversation workdir path is deterministic on POSIX and Windows semantics", () => {
  const threadId = "abc123-thread";
  assert.equal(
    buildConversationWorkdirPath(
      {
        storageRoot: "/var/lib/mira/data",
        userId: 7,
        threadId,
      },
      path.posix,
    ),
    "/var/lib/mira/data/conversation-workdirs/user-7/abc123-thread",
  );

  assert.equal(
    buildConversationWorkdirPath(
      {
        storageRoot: "C:\\Users\\Mira\\AppData\\data",
        userId: 7,
        threadId,
      },
      path.win32,
    ),
    "C:\\Users\\Mira\\AppData\\data\\conversation-workdirs\\user-7\\abc123-thread",
  );
});

test("conversation workdir rejects unsafe path identity", () => {
  assert.throws(
    () =>
      buildConversationWorkdirPath({
        storageRoot: testRoot,
        userId: 1,
        threadId: "../escape",
      }),
    /thread id is invalid/,
  );
  assert.throws(
    () =>
      buildConversationWorkdirPath({
        storageRoot: testRoot,
        userId: 0,
        threadId: "safe-thread",
      }),
    /user id is invalid/,
  );
});

test("storage root follows database app-data configuration", () => {
  const configuredRoot = path.join(testRoot, "configured-data");
  assert.equal(
    resolveConversationWorkdirStorageRoot({
      UI_CHAT_DATABASE_DIR: configuredRoot,
    }),
    path.resolve(configuredRoot),
  );

  const databaseFile = path.join(testRoot, "db-root", "mira.sqlite");
  assert.equal(
    resolveConversationWorkdirStorageRoot({
      DATABASE_URL: `file:${databaseFile}`,
    }),
    path.dirname(path.resolve(databaseFile)),
  );
});

test("ensure creates one thread-owned workdir without creating a ChatWorkspace", () => {
  const user = userRepository.create({
    username: `workdir-user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
    agentEnabled: false,
  });
  const storageRoot = path.join(testRoot, "app-data");

  assert.equal(chatWorkspaceRepository.list({ userId: user.id }).length, 0);

  const first = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
    storageRoot,
  });
  const second = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
    storageRoot,
  });

  assert.equal(first.id, second.id);
  assert.equal(first.rootPath, second.rootPath);
  assert.equal(first.threadId, thread.id);
  assert.equal(fs.statSync(first.rootPath).isDirectory(), true);
  assert.equal(chatWorkspaceRepository.list({ userId: user.id }).length, 0);

  const persisted = conversationWorkdirRepository.findByThreadId(
    thread.id,
    user.id,
  );
  assert.equal(persisted?.id, first.id);
  assert.equal(persisted?.rootPath, first.rootPath);
});

test("conversation workdir lookup is scoped to the owning user", () => {
  const owner = userRepository.create({
    username: `workdir-owner-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const other = userRepository.create({
    username: `workdir-other-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: owner.id,
  });

  conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: owner.id,
    storageRoot: path.join(testRoot, "owner-scope"),
  });

  assert.equal(conversationWorkdirService.get(thread.id, other.id), null);
  assert.throws(
    () =>
      conversationWorkdirService.ensure({
        threadId: thread.id,
        userId: other.id,
        storageRoot: path.join(testRoot, "other-scope"),
      }),
    /Thread not found/,
  );
});

test("existing workdir identity never silently rebinds to a new storage root", () => {
  const user = userRepository.create({
    username: `workdir-rebind-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });
  const firstRoot = path.join(testRoot, "first-root");

  const created = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
    storageRoot: firstRoot,
  });
  const reopened = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
    storageRoot: path.join(testRoot, "different-root"),
  });

  assert.equal(reopened.id, created.id);
  assert.equal(reopened.rootPath, created.rootPath);
});

test("AgentRun persistence snapshots the conversation workdir reference", () => {
  const user = userRepository.create({
    username: `workdir-run-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });
  const conversationWorkdir = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
    storageRoot: path.join(testRoot, "agent-run"),
  });

  const run = agentRunRepository.create({
    threadId: thread.id,
    userId: user.id,
    goal: {
      id: crypto.randomUUID(),
      text: "verify conversation workdir persistence",
      successCriteria: [],
      constraints: [],
      riskLevel: "low",
    },
    runtimeInput: {
      messages: [],
      conversationWorkdir,
    },
  });

  const reloaded = agentRunRepository.get(run.id);
  assert.deepEqual(
    reloaded?.runtimeInput?.conversationWorkdir,
    conversationWorkdir,
  );
});
