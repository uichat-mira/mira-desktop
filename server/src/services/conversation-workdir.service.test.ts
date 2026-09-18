import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterAll, test, vi } from "vitest";
import { initializeAuthDatabase } from "@/db/auth.db";
import { getSqlite, resetDatabaseClients } from "@/db/index.js";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import {
  agentRunRepository,
  chatWorkspaceRepository,
  conversationWorkdirRepository,
  threadRepository,
  userRepository,
} from "@/db/repositories/index.js";
import {
  buildConversationWorkdirPath,
  ConversationWorkdirError,
  conversationWorkdirService,
  isConversationWorkdirPathContained,
  resolveConversationWorkdirQuotaBytes,
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
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeRoleDatabase();
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

test("conversation workdir containment treats Windows paths case-insensitively", () => {
  assert.equal(
    isConversationWorkdirPathContained(
      "C:\\Users\\Mira\\Data",
      "c:\\users\\mira\\data\\conversation-workdirs\\user-7\\thread",
      path.win32,
      true,
    ),
    true,
  );
  assert.equal(
    isConversationWorkdirPathContained(
      "C:\\Users\\Mira\\Data",
      "D:\\Users\\Mira\\Data\\conversation-workdirs\\user-7\\thread",
      path.win32,
      true,
    ),
    false,
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

test("ensure reuses persisted identity when the configured storage root is linked", ({ skip }) => {
  const user = userRepository.create({
    username: `workdir-linked-root-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });
  const realRoot = path.join(testRoot, "linked-root-target");
  const configuredRoot = path.join(testRoot, "linked-root-configured");
  fs.mkdirSync(realRoot, { recursive: true });
  try {
    fs.symlinkSync(
      realRoot,
      configuredRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (["EACCES", "EPERM", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      skip("This platform does not permit creating a directory link");
    }
    throw error;
  }

  const first = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
    storageRoot: configuredRoot,
  });
  const second = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
    storageRoot: configuredRoot,
  });

  assert.equal(first.id, second.id);
  assert.equal(first.rootPath, second.rootPath);
  assert.equal(first.rootPath, fs.realpathSync(first.rootPath));
  assert.equal(
    first.rootPath,
    buildConversationWorkdirPath({
      storageRoot: fs.realpathSync(configuredRoot),
      userId: user.id,
      threadId: thread.id,
    }),
  );
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

test("existing workdir identity refuses to rebind when the storage root changes", () => {
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
  assert.throws(
    () =>
      conversationWorkdirService.ensure({
        threadId: thread.id,
        userId: user.id,
        storageRoot: path.join(testRoot, "different-root"),
      }),
    /conflicts with current app-data root/,
  );

  const persisted = conversationWorkdirRepository.findByThreadId(
    thread.id,
    user.id,
  );
  assert.equal(persisted?.id, created.id);
  assert.equal(persisted?.rootPath, created.rootPath);
});

test("conversation workdir rejects a symlinked directory component", () => {
  const user = userRepository.create({
    username: `workdir-symlink-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({
    userId: user.id,
  });
  const storageRoot = path.join(testRoot, "symlink-root");
  const outsideRoot = path.join(testRoot, "symlink-outside");
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.symlinkSync(
    outsideRoot,
    path.join(storageRoot, "conversation-workdirs"),
    process.platform === "win32" ? "junction" : "dir",
  );

  assert.throws(
    () =>
      conversationWorkdirService.ensure({
        threadId: thread.id,
        userId: user.id,
        storageRoot,
      }),
    /contains a symbolic link/,
  );
  assert.equal(
    conversationWorkdirRepository.findByThreadId(thread.id, user.id),
    undefined,
  );
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

test("reopen fails closed when the persisted workdir is missing or corrupt", () => {
  const user = userRepository.create({
    username: `workdir-reopen-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });
  const storageRoot = path.join(testRoot, "reopen");
  const reference = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
    storageRoot,
  });

  fs.rmSync(reference.rootPath, { recursive: true, force: true });
  assert.throws(
    () => conversationWorkdirService.reopen({ threadId: thread.id, userId: user.id, reference, storageRoot }),
    (error) => error instanceof ConversationWorkdirError && error.code === "missing",
  );

  fs.writeFileSync(reference.rootPath, "not-a-directory");
  assert.throws(
    () => conversationWorkdirService.reopen({ threadId: thread.id, userId: user.id, reference, storageRoot }),
    (error) => error instanceof ConversationWorkdirError && error.code === "invalid",
  );
});

test("reopen classifies unavailable filesystem access without changing persisted identity", () => {
  const user = userRepository.create({
    username: `workdir-unavailable-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });
  const storageRoot = path.join(testRoot, "unavailable");
  const reference = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
    storageRoot,
  });
  const originalReaddirSync = fs.readdirSync;
  const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementation((...args) => {
    const directory = String(args[0]);
    if (path.resolve(directory) === path.resolve(reference.rootPath)) {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    }
    return Reflect.apply(originalReaddirSync, fs, args as never) as never;
  });
  try {
    assert.throws(
      () => conversationWorkdirService.reopen({ threadId: thread.id, userId: user.id, reference, storageRoot }),
      (error) => error instanceof ConversationWorkdirError && error.code === "unavailable",
    );
    assert.equal(conversationWorkdirRepository.findByThreadId(thread.id, user.id)?.rootPath, reference.rootPath);
  } finally {
    readdirSpy.mockRestore();
  }
});

test("reopen and cleanup reject a tampered persisted path", () => {
  const user = userRepository.create({
    username: `workdir-tampered-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });
  const storageRoot = path.join(testRoot, "tampered");
  const reference = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
    storageRoot,
  });
  const outsidePath = path.join(testRoot, "outside-tampered");
  fs.mkdirSync(outsidePath, { recursive: true });
  getSqlite()
    .prepare("UPDATE conversation_workdirs SET root_path = ? WHERE thread_id = ?")
    .run(outsidePath, thread.id);

  assert.throws(
    () => conversationWorkdirService.reopen({ threadId: thread.id, userId: user.id, reference, storageRoot }),
    (error) => error instanceof ConversationWorkdirError && error.code === "identity_conflict",
  );
  assert.throws(
    () => conversationWorkdirService.cleanup({ threadId: thread.id, userId: user.id, storageRoot }),
    (error) => error instanceof ConversationWorkdirError && error.code === "identity_conflict",
  );
  assert.equal(fs.existsSync(outsidePath), true);
  assert.equal(conversationWorkdirRepository.findByThreadId(thread.id, user.id)?.rootPath, outsidePath);
});

test("per-user aggregate quota rejects a new workdir without deleting existing data", () => {
  const user = userRepository.create({
    username: `workdir-quota-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const firstThread = threadService.createThread({ userId: user.id });
  const secondThread = threadService.createThread({ userId: user.id });
  const storageRoot = path.join(testRoot, "quota");
  const first = conversationWorkdirService.ensure({
    threadId: firstThread.id,
    userId: user.id,
    storageRoot,
    quotaBytes: 2,
  });
  fs.writeFileSync(path.join(first.rootPath, "data.txt"), "123");

  assert.throws(
    () => conversationWorkdirService.ensure({
      threadId: secondThread.id,
      userId: user.id,
      storageRoot,
      quotaBytes: 2,
    }),
    (error) => error instanceof ConversationWorkdirError && error.code === "quota_exhausted",
  );
  assert.equal(fs.existsSync(first.rootPath), true);
  assert.equal(resolveConversationWorkdirQuotaBytes({ UI_CHAT_CONVERSATION_WORKDIR_QUOTA_BYTES: "7" }), 7);
});

test("cleanup removes only the deterministic workdir and is idempotent", () => {
  const user = userRepository.create({
    username: `workdir-cleanup-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });
  const storageRoot = path.join(testRoot, "cleanup");
  const reference = conversationWorkdirService.ensure({ threadId: thread.id, userId: user.id, storageRoot });
  fs.writeFileSync(path.join(reference.rootPath, "temporary.txt"), "temporary");

  const cleaned = conversationWorkdirService.cleanup({ threadId: thread.id, userId: user.id, storageRoot });
  assert.deepEqual(cleaned, { threadId: thread.id, userId: user.id, existed: true, removed: true });
  assert.equal(fs.existsSync(reference.rootPath), false);
  assert.ok(conversationWorkdirRepository.findByThreadId(thread.id, user.id));

  const repeated = conversationWorkdirService.cleanup({ threadId: thread.id, userId: user.id, storageRoot });
  assert.deepEqual(repeated, { threadId: thread.id, userId: user.id, existed: true, removed: false });
  assert.equal(threadRepository.deleteById(thread.id), true);
  assert.equal(conversationWorkdirRepository.findByThreadId(thread.id, user.id), undefined);
});

test("cleanup reports filesystem failures instead of pretending success", () => {
  const user = userRepository.create({
    username: `workdir-cleanup-failure-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });
  const storageRoot = path.join(testRoot, "cleanup-failure");
  conversationWorkdirService.ensure({ threadId: thread.id, userId: user.id, storageRoot });
  const removeSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => {
    const error = Object.assign(new Error("busy"), { code: "EBUSY" });
    throw error;
  });
  try {
    assert.throws(
      () => conversationWorkdirService.cleanup({ threadId: thread.id, userId: user.id, storageRoot }),
      (error) => error instanceof ConversationWorkdirError && error.code === "cleanup_failed",
    );
    assert.ok(conversationWorkdirRepository.findByThreadId(thread.id, user.id));
    const result = threadService.cleanupThreads(user.id);
    assert.equal(result.failedWorkdirs, 1);
    assert.equal(result.failedThreads, 0);
    assert.ok(threadRepository.findById(thread.id, user.id));
  } finally {
    removeSpy.mockRestore();
  }
});

test("cleanup fails closed when the app-data root itself is unavailable", () => {
  const user = userRepository.create({
    username: `workdir-cleanup-root-missing-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });
  const storageRoot = path.join(testRoot, "cleanup-root-missing");
  conversationWorkdirService.ensure({ threadId: thread.id, userId: user.id, storageRoot });
  fs.rmSync(storageRoot, { recursive: true, force: true });

  assert.throws(
    () => conversationWorkdirService.cleanup({ threadId: thread.id, userId: user.id, storageRoot }),
    (error) => error instanceof ConversationWorkdirError && error.code === "missing",
  );
  assert.ok(conversationWorkdirRepository.findByThreadId(thread.id, user.id));
});

test("thread hard delete cleans the default conversation workdir before cascading the row", () => {
  const user = userRepository.create({
    username: `workdir-thread-delete-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const thread = threadService.createThread({ userId: user.id });
  const reference = conversationWorkdirService.ensure({
    threadId: thread.id,
    userId: user.id,
  });

  assert.equal(threadService.deleteThread(thread.id, user.id), true);
  assert.equal(fs.existsSync(reference.rootPath), false);
  assert.equal(conversationWorkdirRepository.findByThreadId(thread.id, user.id), undefined);
});

test("explicit history cleanup removes conversation workdirs without deleting ChatWorkspace", () => {
  const user = userRepository.create({
    username: `workdir-history-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  const workspace = chatWorkspaceRepository.create({
    userId: user.id,
    name: "Persistent workspace",
    rootPath: path.join(testRoot, "persistent-workspace"),
    status: "active",
  });
  const thread = threadService.createThread({ userId: user.id, workspaceId: workspace.id });
  const reference = conversationWorkdirService.ensure({ threadId: thread.id, userId: user.id });
  const result = threadService.cleanupThreads(user.id);

  assert.equal(result.failedWorkdirs, 0);
  assert.equal(result.deletedThreads >= 1, true);
  assert.equal(fs.existsSync(reference.rootPath), false);
  assert.ok(chatWorkspaceRepository.findById(workspace.id, user.id));
});
