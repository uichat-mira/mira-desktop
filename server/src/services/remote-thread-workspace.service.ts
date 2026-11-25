import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import { remoteThreadWorkspaceRepository } from "@/db/repositories/remote-thread-workspace.repository.js";
import {
  buildPrivateAgentWorkspacePath,
  ensureRemoteMcpWorkspaceDirectory,
  resolvePrivateAgentWorkspaceStorageRoot,
} from "@/services/agent-workspace.service.js";

export const REMOTE_THREAD_HEADER = "x-mira-thread-id";
const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

export type RemoteThreadIdentity = Readonly<{
  accountId: string;
  hostId: string;
  mobileDeviceId: string;
}>;

export type RemoteThreadContext = Readonly<{
  threadId: string;
  identity: RemoteThreadIdentity;
}>;

export type RemoteThreadWorkspaceKind = "private";

export type RemoteThreadWorkspacePlan = Readonly<{
  kind: RemoteThreadWorkspaceKind;
  rootPath: string;
  bindingExists: boolean;
}>;

export type RemoteThreadWorkspaceStatus = "not_started" | "active" | "ended";

export type RemoteThreadWorkspaceState = Readonly<{
  threadId: string;
  status: RemoteThreadWorkspaceStatus;
  workspace: null | Readonly<{
    ref: string;
    kind: RemoteThreadWorkspaceKind;
    available: boolean;
    startedAt: string;
  }>;
  startedAt: string | null;
  endedAt: string | null;
}>;

export type RemoteThreadWorkspaceErrorCode =
  | "thread_context_invalid"
  | "thread_context_required"
  | "thread_not_found"
  | "thread_ended"
  | "workspace_unavailable"
  | "workspace_changed"
  | "thread_cleanup_incomplete";

const ERROR_STATUS: Record<RemoteThreadWorkspaceErrorCode, number> = {
  thread_context_invalid: 400,
  thread_context_required: 400,
  thread_not_found: 404,
  thread_ended: 409,
  workspace_unavailable: 409,
  workspace_changed: 409,
  thread_cleanup_incomplete: 409,
};

export class RemoteThreadWorkspaceError extends Error {
  readonly code: RemoteThreadWorkspaceErrorCode;
  readonly statusCode: number;

  constructor(code: RemoteThreadWorkspaceErrorCode, message: string) {
    super(message);
    this.name = "RemoteThreadWorkspaceError";
    this.code = code;
    this.statusCode = ERROR_STATUS[code];
  }
}

const fail = (
  code: RemoteThreadWorkspaceErrorCode,
  message: string,
): never => {
  throw new RemoteThreadWorkspaceError(code, message);
};

const notFound = (): never =>
  fail("thread_not_found", "Remote thread was not found");

const assertIdentity = (
  binding: {
    userId: number;
    accountId: string;
    hostId: string;
    mobileDeviceId: string;
  },
  identity: RemoteThreadIdentity,
  userId: number,
) => {
  if (
    binding.userId !== userId ||
    binding.accountId !== identity.accountId ||
    binding.hostId !== identity.hostId ||
    binding.mobileDeviceId !== identity.mobileDeviceId
  ) {
    // Do not disclose that another account/device owns this remote thread.
    notFound();
  }
};

const assertActive = (binding: { status: string }) => {
  if (binding.status === "ended") {
    fail("thread_ended", "Remote thread has ended");
  }
};

const isDirectory = (candidate: string) => {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
};

// The client owns its conversation ID. The Desktop owns the namespace for
// execution and disk storage; it never aliases a local conversation ID.
export const remoteThreadExecutionKey = (input: {
  threadId: string;
  userId: number;
  identity: RemoteThreadIdentity;
}): string => {
  if (!THREAD_ID_PATTERN.test(input.threadId)) {
    return fail("thread_context_invalid", "Remote thread context is invalid");
  }
  return "remote-mcp-" + createHash("sha256").update(JSON.stringify([
    input.userId, input.identity.accountId, input.identity.hostId,
    input.identity.mobileDeviceId, input.threadId,
  ])).digest("hex");
};

export const isRemoteThreadExecutionKey = (value?: string) =>
  typeof value === "string" && /^remote-mcp-[0-9a-f]{64}$/u.test(value);

const derivePlan = (input: {
  threadId: string;
  userId: number;
  identity: RemoteThreadIdentity;
}): RemoteThreadWorkspacePlan => ({
  kind: "private",
  rootPath: buildPrivateAgentWorkspacePath({
    storageRoot: resolvePrivateAgentWorkspaceStorageRoot(),
    userId: input.userId,
    threadId: remoteThreadExecutionKey(input),
    namespace: "remote-mcp",
  }),
  bindingExists: false,
});

const canonicalPath = (candidate: string) => {
  try { return fs.realpathSync(candidate); } catch { return path.resolve(candidate); }
};
const samePlan = (
  left: Pick<RemoteThreadWorkspacePlan, "kind" | "rootPath">,
  right: Pick<RemoteThreadWorkspacePlan, "kind" | "rootPath">,
) => left.kind === right.kind && canonicalPath(left.rootPath) === canonicalPath(right.rootPath);

const planFromBinding = (
  binding: {
    workspaceKind: string | null;
    workspaceRoot: string | null;
  },
): RemoteThreadWorkspacePlan => {
  if (
    binding.workspaceKind !== "private" ||
    !binding.workspaceRoot ||
    !isDirectory(binding.workspaceRoot)
  ) {
    return fail(
      "workspace_unavailable",
      "Remote thread workspace is unavailable",
    );
  }
  return {
    kind: binding.workspaceKind,
    rootPath: binding.workspaceRoot,
    bindingExists: true,
  };
};

const toState = (input: {
  threadId: string;
  executionKey: string;
  binding:
    | {
        status: "active" | "ended";
        workspaceKind: string | null;
        workspaceRoot: string | null;
        createdAt: string;
        endedAt: string | null;
      }
    | undefined;
}): RemoteThreadWorkspaceState => {
  if (!input.binding) {
    return {
      threadId: input.threadId,
      status: "not_started",
      workspace: null,
      startedAt: null,
      endedAt: null,
    };
  }

  const hasWorkspace =
    input.binding.workspaceKind === "private" &&
    Boolean(input.binding.workspaceRoot);

  return {
    threadId: input.threadId,
    status: input.binding.status,
    workspace: hasWorkspace
      ? {
          // The absolute Desktop path stays inside Desktop. Mobile/remote
          // consumers locate the real space through this stable reference.
          ref: `mira-thread-workspace:${input.executionKey}`,
          kind: input.binding.workspaceKind as RemoteThreadWorkspaceKind,
          available: isDirectory(input.binding.workspaceRoot!),
          startedAt: input.binding.createdAt,
        }
      : null,
    startedAt: hasWorkspace ? input.binding.createdAt : null,
    endedAt: input.binding.endedAt,
  };
};

export const resolveCloudRemoteIdentity = (
  request: FastifyRequest,
): RemoteThreadIdentity | null => {
  const caller = request.cloudRemoteCaller;
  if (!caller) return null;
  return {
    accountId: caller.accountId,
    hostId: caller.hostId,
    mobileDeviceId: caller.mobileDeviceId,
  };
};

export const readCloudRemoteThreadContext = (
  request: FastifyRequest,
): RemoteThreadContext | null => {
  const identity = resolveCloudRemoteIdentity(request);
  if (!identity) return null;

  const raw = request.headers[REMOTE_THREAD_HEADER];
  if (raw === undefined) return null;
  if (typeof raw !== "string" || !THREAD_ID_PATTERN.test(raw)) {
    return fail(
      "thread_context_invalid",
      "Remote thread context is invalid",
    );
  }

  return {
    threadId: raw,
    identity,
  };
};

export const remoteThreadWorkspaceService = {
  assertUsable(input: {
    threadId: string;
    userId: number;
    identity: RemoteThreadIdentity;
  }): void {
    remoteThreadExecutionKey(input);
    const binding = remoteThreadWorkspaceRepository.getByThread(input.threadId);
    if (binding) {
      assertIdentity(binding, input.identity, input.userId);
      assertActive(binding);
      return;
    }
  },

  /**
   * Resolves the target without creating it. Approval evaluation can therefore
   * run against the exact future root, and an awaiting/rejected call never
   * creates a directory.
   */
  plan(input: {
    threadId: string;
    userId: number;
    identity: RemoteThreadIdentity;
    expected?: RemoteThreadWorkspacePlan;
  }): RemoteThreadWorkspacePlan {
    remoteThreadExecutionKey(input);
    const binding = remoteThreadWorkspaceRepository.getByThread(input.threadId);
    let plan: RemoteThreadWorkspacePlan;
    if (binding) {
      assertIdentity(binding, input.identity, input.userId);
      assertActive(binding);
      plan = planFromBinding(binding);
    } else {
      plan = derivePlan(input);
    }

    if (input.expected && !samePlan(input.expected, plan)) {
      fail(
        "workspace_changed",
        "Remote thread workspace changed since the pending approval",
      );
    }
    return plan;
  },

  /**
   * Creates the private workspace and/or persists the authoritative binding.
   * Call only after the exact invocation is allowed to execute.
   */
  activate(input: {
    threadId: string;
    userId: number;
    identity: RemoteThreadIdentity;
    plan: RemoteThreadWorkspacePlan;
  }): RemoteThreadWorkspacePlan {
    const executionKey = remoteThreadExecutionKey(input);
    const existing = remoteThreadWorkspaceRepository.getByThread(input.threadId);
    if (existing) {
      assertIdentity(existing, input.identity, input.userId);
      assertActive(existing);
      const plan = planFromBinding(existing);
      if (!samePlan(input.plan, plan)) {
        fail(
          "workspace_changed",
          "Remote thread workspace changed since the pending approval",
        );
      }
      return plan;
    }

    const current = derivePlan(input);
    if (!samePlan(input.plan, current)) {
      fail("workspace_changed", "Remote thread workspace changed since the pending approval");
    }
    const rootPath = ensureRemoteMcpWorkspaceDirectory({
      threadId: executionKey,
      userId: input.userId,
    });

    const stored = remoteThreadWorkspaceRepository.insertIfAbsent({
      threadId: input.threadId,
      userId: input.userId,
      accountId: input.identity.accountId,
      hostId: input.identity.hostId,
      mobileDeviceId: input.identity.mobileDeviceId,
      workspaceKind: input.plan.kind,
      workspaceRoot: rootPath,
      status: "active",
      endedAt: null,
    });

    assertIdentity(stored, input.identity, input.userId);
    assertActive(stored);
    const plan = planFromBinding(stored);
    if (!samePlan(input.plan, plan)) {
      fail(
        "workspace_changed",
        "Remote thread workspace changed before execution started",
      );
    }
    return plan;
  },

  getState(input: {
    threadId: string;
    userId: number;
    identity: RemoteThreadIdentity;
  }): RemoteThreadWorkspaceState {
    remoteThreadExecutionKey(input);
    const binding = remoteThreadWorkspaceRepository.getByThread(input.threadId);
    if (binding) {
      assertIdentity(binding, input.identity, input.userId);
    }
    return toState({ threadId: input.threadId, executionKey: remoteThreadExecutionKey(input), binding });
  },

  /**
   * Explicit thread end is the only operation that changes lifecycle state.
   * Transport disconnects, round completion, or closing the Desktop app do not
   * call this path. Files are never removed here.
   */
  end(input: {
    threadId: string;
    userId: number;
    identity: RemoteThreadIdentity;
  }): RemoteThreadWorkspaceState {

    remoteThreadExecutionKey(input);
    let binding = remoteThreadWorkspaceRepository.getByThread(input.threadId);
    if (!binding) {
      binding = remoteThreadWorkspaceRepository.insertIfAbsent({
        threadId: input.threadId,
        userId: input.userId,
        accountId: input.identity.accountId,
        hostId: input.identity.hostId,
        mobileDeviceId: input.identity.mobileDeviceId,
        workspaceKind: null,
        workspaceRoot: null,
        status: "ended",
        endedAt: new Date().toISOString(),
      });
    }

    assertIdentity(binding, input.identity, input.userId);
    if (binding.status !== "ended") {
      binding =
        remoteThreadWorkspaceRepository.markEnded({
          threadId: input.threadId,
          userId: input.userId,
          endedAt: new Date().toISOString(),
        }) ?? binding;
    }

    return toState({ threadId: input.threadId, executionKey: remoteThreadExecutionKey(input), binding });
  },
};
