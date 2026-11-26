import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
  readCloudRemoteThreadContext,
  RemoteThreadWorkspaceError,
  remoteThreadWorkspaceService,
  remoteThreadExecutionKey,
  type RemoteThreadIdentity,
} from "./remote-thread-workspace.service.js";
import {
  createTimestampedTestArtifactPath,
  getTestArtifactDir,
} from "@/test-support/artifacts.js";

const scope = `remote-thread-workspace-${process.pid}-${Date.now()}`;
const testRoot = getTestArtifactDir("remote-thread-workspace", scope);
const databasePath = createTimestampedTestArtifactPath(
  "db",
  "remote-thread-workspace",
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

const identity: RemoteThreadIdentity = {
  accountId: "account-a",
  hostId: "host-a",
  mobileDeviceId: "device-a",
};

const createThread = (userId: number, workspaceId?: string) =>
  threadRepository.create({
    userId,
    title: "Remote thread",
    workspaceId: workspaceId ?? null,
    status: "active",
  });

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true });
});

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

describe("remote thread workspace service", () => {
  test("reads thread identity only from the trusted Cloud caller", () => {
    const cloudRequest = {
      cloudRemoteCaller: {
        kind: "cloud",
        accountId: "account-a",
        hostId: "host-a",
        mobileDeviceId: "device-a",
        revision: 1,
        scopes: ["tools:read"],
        owner: { id: 1, username: "user", role: "user" },
      },
      headers: { "x-mira-thread-id": "thread-a" },
    } as never;

    expect(readCloudRemoteThreadContext(cloudRequest)).toEqual({
      threadId: "thread-a",
      identity: {
        accountId: "account-a",
        hostId: "host-a",
        mobileDeviceId: "device-a",
      },
    });

    expect(
      readCloudRemoteThreadContext({
        headers: { "x-mira-thread-id": "thread-a" },
        remoteDevice: { id: "direct-device" },
      } as never),
    ).toBeNull();

    expect(() =>
      readCloudRemoteThreadContext({
        ...(cloudRequest as object),
        headers: { "x-mira-thread-id": "bad thread id" },
      } as never),
    ).toThrow("Remote thread context is invalid");
  });

  test("does not create a directory for discovery or planning", () => {
    const user = userRepository.create({
      username: `remote-plan-${crypto.randomUUID()}`,
      passwordHash: "hash",
      role: "user",
      isActive: true,
    });
    const thread = { id: "mobile-only-" + crypto.randomUUID() };
    expect(threadRepository.findById(thread.id, user.id)).toBeFalsy();

    expect(
      remoteThreadWorkspaceService.getState({
        threadId: thread.id,
        userId: user.id,
        identity,
      }),
    ).toMatchObject({ status: "not_started", workspace: null });

    const plan = remoteThreadWorkspaceService.plan({
      threadId: thread.id,
      userId: user.id,
      identity,
    });
    expect(plan.kind).toBe("private");
    expect(fs.existsSync(plan.rootPath)).toBe(false);
  });

  test("activation is idempotent and binds the trusted caller identity", () => {
    const user = userRepository.create({
      username: `remote-bind-${crypto.randomUUID()}`,
      passwordHash: "hash",
      role: "user",
      isActive: true,
    });
    const thread = createThread(user.id);

    const plan = remoteThreadWorkspaceService.plan({
      threadId: thread.id,
      userId: user.id,
      identity,
    });
    const first = remoteThreadWorkspaceService.activate({
      threadId: thread.id,
      userId: user.id,
      identity,
      plan,
    });
    const second = remoteThreadWorkspaceService.activate({
      threadId: thread.id,
      userId: user.id,
      identity,
      plan: first,
    });

    expect(second.rootPath).toBe(first.rootPath);
    expect(fs.statSync(first.rootPath).isDirectory()).toBe(true);
    expect(
      remoteThreadWorkspaceService.getState({
        threadId: thread.id,
        userId: user.id,
        identity,
      }),
    ).toMatchObject({
      status: "active",
      workspace: {
        ref: `mira-thread-workspace:${remoteThreadExecutionKey({ threadId: thread.id, userId: user.id, identity })}`,
        kind: "private",
        available: true,
      },
    });

    expect(() =>
      remoteThreadWorkspaceService.plan({
        threadId: thread.id,
        userId: user.id,
        identity: { ...identity, mobileDeviceId: "device-b" },
      }),
    ).toThrow(RemoteThreadWorkspaceError);
  });

  test("separate threads stay independent and a local project with the same ID is never reused", () => {
    const user = userRepository.create({
      username: `remote-independent-${crypto.randomUUID()}`,
      passwordHash: "hash",
      role: "user",
      isActive: true,
    });
    const first = createThread(user.id);
    const second = createThread(user.id);

    const firstPlan = remoteThreadWorkspaceService.activate({
      threadId: first.id,
      userId: user.id,
      identity,
      plan: remoteThreadWorkspaceService.plan({
        threadId: first.id,
        userId: user.id,
        identity,
      }),
    });
    const secondPlan = remoteThreadWorkspaceService.activate({
      threadId: second.id,
      userId: user.id,
      identity,
      plan: remoteThreadWorkspaceService.plan({
        threadId: second.id,
        userId: user.id,
        identity,
      }),
    });

    expect(firstPlan.rootPath).not.toBe(secondPlan.rootPath);
    fs.writeFileSync(path.join(firstPlan.rootPath, "first.txt"), "one");
    expect(fs.existsSync(path.join(secondPlan.rootPath, "first.txt"))).toBe(
      false,
    );

    const explicit = chatWorkspaceRepository.create({
      userId: user.id,
      name: "Bound project",
      rootPath: path.join(testRoot, "bound-project"),
      status: "active",
    });
    fs.mkdirSync(explicit.rootPath, { recursive: true });
    const bound = createThread(user.id, explicit.id);
    const boundPlan = remoteThreadWorkspaceService.plan({
      threadId: bound.id,
      userId: user.id,
      identity,
    });

    expect(boundPlan.kind).toBe("private");
    expect(boundPlan.rootPath).not.toBe(explicit.rootPath);
    const active = remoteThreadWorkspaceService.activate({
      threadId: bound.id, userId: user.id, identity, plan: boundPlan,
    });
    expect(active.rootPath).toContain("remote-mcp-workdirs");
    fs.writeFileSync(path.join(active.rootPath, "remote-only.txt"), "remote");
    expect(fs.existsSync(path.join(explicit.rootPath, "remote-only.txt"))).toBe(false);
  });

  test("explicit end is idempotent, keeps files, and rejects new work", () => {
    const user = userRepository.create({
      username: `remote-end-${crypto.randomUUID()}`,
      passwordHash: "hash",
      role: "user",
      isActive: true,
    });
    const thread = createThread(user.id);
    const plan = remoteThreadWorkspaceService.activate({
      threadId: thread.id,
      userId: user.id,
      identity,
      plan: remoteThreadWorkspaceService.plan({
        threadId: thread.id,
        userId: user.id,
        identity,
      }),
    });
    const resultFile = path.join(plan.rootPath, "result.txt");
    fs.writeFileSync(resultFile, "retained");

    const ended = remoteThreadWorkspaceService.end({
      threadId: thread.id,
      userId: user.id,
      identity,
    });
    const endedAgain = remoteThreadWorkspaceService.end({
      threadId: thread.id,
      userId: user.id,
      identity,
    });

    expect(ended).toMatchObject({ status: "ended" });
    expect(endedAgain).toMatchObject({ status: "ended" });
    expect(fs.readFileSync(resultFile, "utf8")).toBe("retained");
    expect(() =>
      remoteThreadWorkspaceService.assertUsable({
        threadId: thread.id,
        userId: user.id,
        identity,
      }),
    ).toThrow("Remote thread has ended");
    expect(() =>
      remoteThreadWorkspaceService.activate({
        threadId: thread.id,
        userId: user.id,
        identity,
        plan,
      }),
    ).toThrow("Remote thread has ended");
  });

  test("ending a thread that never started leaves no directory", () => {
    const user = userRepository.create({
      username: `remote-end-empty-${crypto.randomUUID()}`,
      passwordHash: "hash",
      role: "user",
      isActive: true,
    });
    const thread = createThread(user.id);
    const plan = remoteThreadWorkspaceService.plan({
      threadId: thread.id,
      userId: user.id,
      identity,
    });

    const ended = remoteThreadWorkspaceService.end({
      threadId: thread.id,
      userId: user.id,
      identity,
    });

    expect(ended).toMatchObject({
      status: "ended",
      workspace: null,
      startedAt: null,
    });
    expect(fs.existsSync(plan.rootPath)).toBe(false);
  });

  test("keeps a pending remote target stable when a same-ID local project changes", () => {
    const user = userRepository.create({
      username: `remote-drift-${crypto.randomUUID()}`,
      passwordHash: "hash",
      role: "user",
      isActive: true,
    });
    const explicit = chatWorkspaceRepository.create({
      userId: user.id,
      name: "First target",
      rootPath: path.join(testRoot, "target-one"),
      status: "active",
    });
    fs.mkdirSync(explicit.rootPath, { recursive: true });
    const thread = createThread(user.id, explicit.id);
    const pendingPlan = remoteThreadWorkspaceService.plan({
      threadId: thread.id,
      userId: user.id,
      identity,
    });

    const other = chatWorkspaceRepository.create({
      userId: user.id,
      name: "Second target",
      rootPath: path.join(testRoot, "target-two"),
      status: "active",
    });
    fs.mkdirSync(other.rootPath, { recursive: true });
    threadRepository.updateById(thread.id, { workspaceId: other.id });

    expect(remoteThreadWorkspaceService.plan({
      threadId: thread.id, userId: user.id, identity, expected: pendingPlan,
    })).toEqual(pendingPlan);
    expect(() => remoteThreadWorkspaceService.plan({
      threadId: thread.id, userId: user.id, identity,
      expected: { ...pendingPlan, rootPath: explicit.rootPath },
    })).toThrow("Remote thread workspace changed since the pending approval");
  });
});
