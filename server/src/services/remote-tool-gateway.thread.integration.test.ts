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
  userRepository,
} from "@/db/repositories/index.js";
import { initializeHarnessRuntime, resetHarnessRuntime } from "@/mcp/bootstrap.js";
import { getHarnessInvocation } from "@/harness/invocations.js";
import {
  getTerminalSession,
  stopTerminalSessionsForThread,
} from "@/mcp/terminal-sessions.js";
import {
  clearWorkspaceSelection,
  selectWorkspaceRoot,
} from "@/mcp/workspace.js";
import {
  executeRemoteToolInvocation,
  cancelRemoteToolInvocation,
  resolveRemoteToolApproval,
} from "@/services/remote-tool-gateway.service.js";
import {
  remoteThreadWorkspaceService,
  remoteThreadExecutionKey,
  type RemoteThreadContext,
} from "@/services/remote-thread-workspace.service.js";
import {
  createTimestampedTestArtifactPath,
  getTestArtifactDir,
} from "@/test-support/artifacts.js";

const scope = `remote-thread-gateway-${process.pid}-${Date.now()}`;
const testRoot = getTestArtifactDir("remote-thread-gateway", scope);
const databasePath = createTimestampedTestArtifactPath(
  "db",
  "remote-thread-gateway",
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
initializeHarnessRuntime();

// The Mobile local conversation is not a Desktop thread row.
const createThread = () => ({ id: "mobile-" + crypto.randomUUID() });

const contextFor = (threadId: string, mobileDeviceId = "device-a"): RemoteThreadContext => ({
  threadId,
  identity: {
    accountId: "account-a",
    hostId: "host-a",
    mobileDeviceId,
  },
});

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true });
});

afterAll(() => {
  clearWorkspaceSelection();
  resetHarnessRuntime();
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

describe("official Cloud MCP thread workspace execution", () => {
  test("approval boundary creates the thread workspace and files stay thread-bound", async () => {
    const user = userRepository.create({
      username: `cloud-mcp-file-${crypto.randomUUID()}`,
      passwordHash: "hash",
      role: "user",
      isActive: true,
    });
    const thread = createThread();
    const context = contextFor(thread.id);
    const localProject = path.join(testRoot, "local-selected-project");
    fs.mkdirSync(localProject, { recursive: true });
    selectWorkspaceRoot(localProject);

    const pending = await executeRemoteToolInvocation({
      toolId: "write",
      args: { path: "note.txt", content: "hello-thread" },
      userId: user.id,
      threadContext: context,
      requireThreadContext: true,
    });

    expect(pending.status).toBe("awaiting_approval");
    expect(remoteThreadWorkspaceService.getState({ ...context, userId: user.id }).workspace).toBeNull();
    expect(fs.existsSync(path.join(localProject, "note.txt"))).toBe(false);
    expect(() => cancelRemoteToolInvocation(pending.invocationId, user.id))
      .toThrow("Remote thread was not found");
    expect(() => cancelRemoteToolInvocation(pending.invocationId, user.id, contextFor(thread.id, "other-device")))
      .toThrow("Remote thread was not found");

    const completed = await resolveRemoteToolApproval({
      invocationId: pending.invocationId,
      decision: "approved",
      toolId: "write",
      args: { path: "note.txt", content: "hello-thread" },
      userId: user.id,
      threadContext: context,
    });
    expect(completed.status, JSON.stringify(getHarnessInvocation(completed.invocationId)?.error ?? completed)).toBe("completed");

    const workspaceRoot = remoteThreadWorkspaceService.plan({ ...context, userId: user.id }).rootPath;
    expect(workspaceRoot).toBeTruthy();
    expect(fs.readFileSync(path.join(workspaceRoot!, "note.txt"), "utf8")).toBe(
      "hello-thread",
    );
    expect(fs.existsSync(path.join(localProject, "note.txt"))).toBe(false);

    // Switching the local Desktop project must not move the remote target.
    const otherLocalProject = path.join(testRoot, "other-local-project");
    fs.mkdirSync(otherLocalProject, { recursive: true });
    selectWorkspaceRoot(otherLocalProject);

    const read = await executeRemoteToolInvocation({
      toolId: "read",
      args: { path: "note.txt" },
      userId: user.id,
      threadContext: context,
      requireThreadContext: true,
    });
    expect(read.status).toBe("completed");
    expect(read.content).toContain("hello-thread");

    await expect(
      executeRemoteToolInvocation({
        toolId: "read",
        args: { path: "note.txt" },
        userId: user.id,
        threadContext: contextFor(thread.id, "device-b"),
        requireThreadContext: true,
      }),
    ).rejects.toMatchObject({ code: "thread_not_found" });

    const ended = remoteThreadWorkspaceService.end({
      threadId: thread.id,
      userId: user.id,
      identity: context.identity,
    });
    expect(ended.status).toBe("ended");
    expect(fs.readFileSync(path.join(workspaceRoot!, "note.txt"), "utf8")).toBe(
      "hello-thread",
    );

    await expect(
      executeRemoteToolInvocation({
        toolId: "read",
        args: { path: "note.txt" },
        userId: user.id,
        threadContext: context,
        requireThreadContext: true,
      }),
    ).rejects.toMatchObject({ code: "thread_ended" });
  });

  test("an ended thread refuses its still-pending approval without creating a workspace", async () => {
    const user = userRepository.create({
      username: `cloud-mcp-ended-${crypto.randomUUID()}`,
      passwordHash: "hash",
      role: "user",
      isActive: true,
    });
    const thread = createThread();
    const context = contextFor(thread.id);
    const args = { path: "late.txt", content: "must-not-run" };

    const pending = await executeRemoteToolInvocation({
      toolId: "write",
      args,
      userId: user.id,
      threadContext: context,
      requireThreadContext: true,
    });
    expect(pending.status).toBe("awaiting_approval");
    expect(remoteThreadWorkspaceService.getState({ ...context, userId: user.id }).workspace).toBeNull();

    remoteThreadWorkspaceService.end({
      threadId: thread.id,
      userId: user.id,
      identity: context.identity,
    });

    await expect(
      resolveRemoteToolApproval({
        invocationId: pending.invocationId,
        decision: "approved",
        toolId: "write",
        args,
        userId: user.id,
        threadContext: context,
      }),
    ).rejects.toMatchObject({ code: "thread_ended" });

    expect(remoteThreadWorkspaceService.getState({ ...context, userId: user.id }).workspace).toBeNull();
    expect(
      remoteThreadWorkspaceService.getState({
        threadId: thread.id,
        userId: user.id,
        identity: context.identity,
      }),
    ).toMatchObject({ status: "ended", workspace: null });
  });

  test("persistent terminal work starts after approval and stops on explicit end", async () => {
    const user = userRepository.create({
      username: `cloud-mcp-terminal-${crypto.randomUUID()}`,
      passwordHash: "hash",
      role: "user",
      isActive: true,
    });
    const thread = createThread();
    const context = contextFor(thread.id);

    const command = 'node -p "process.cwd()"';
    const pending = await executeRemoteToolInvocation({
      toolId: "terminal",
      args: {
        command,
        sessionMode: "persistent",
        timeoutMs: 10_000,
      },
      userId: user.id,
      threadContext: context,
      requireThreadContext: true,
    });
    expect(pending.status).toBe("awaiting_approval");
    expect(remoteThreadWorkspaceService.getState({ ...context, userId: user.id }).workspace).toBeNull();

    const completed = await resolveRemoteToolApproval({
      invocationId: pending.invocationId,
      decision: "approved",
      toolId: "terminal",
      args: {
        command,
        sessionMode: "persistent",
        timeoutMs: 10_000,
      },
      userId: user.id,
      threadContext: context,
    });
    expect(completed.status, JSON.stringify(getHarnessInvocation(completed.invocationId)?.error ?? completed)).toBe("completed");

    const workspaceRoot = remoteThreadWorkspaceService.plan({ ...context, userId: user.id }).rootPath;
    expect(workspaceRoot).toBeTruthy();
    expect(fs.statSync(workspaceRoot!).isDirectory()).toBe(true);
    expect(completed.content ?? "").toContain(workspaceRoot!);

    // The persistent PTY is still owned by the thread after the invocation
    // itself completed. Explicit end must stop it.
    const sessions = await import("@/mcp/terminal-sessions.js");
    const threadSessions = sessions
      .listTerminalSessions()
      .map((session) => session.id);
    expect(threadSessions.length).toBeGreaterThan(0);
    const sessionId = threadSessions.at(-1)!;
    const persistent = getTerminalSession(sessionId);
    expect(persistent).toBeDefined();
    expect(sessions.terminalSessionBelongsToThread(persistent!, { userId: user.id })).toBe(false);
    const pid = persistent!.process.pid;

    remoteThreadWorkspaceService.end({
      threadId: thread.id,
      userId: user.id,
      identity: context.identity,
    });
    const stopped = await stopTerminalSessionsForThread({
      userId: user.id,
      threadId: remoteThreadExecutionKey({ ...context, userId: user.id }),
    });

    expect(stopped.stopped).toBeGreaterThan(0);
    expect(getTerminalSession(sessionId)).toBeUndefined();
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }).toBe(false);
    expect(fs.statSync(workspaceRoot!).isDirectory()).toBe(true);
  });
});
