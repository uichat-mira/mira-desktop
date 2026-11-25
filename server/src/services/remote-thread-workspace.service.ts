import fs from "node:fs";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import { chatWorkspaceRepository } from "@/db/repositories/chat-workspace.repository.js";
import { remoteThreadWorkspaceRepository } from "@/db/repositories/remote-thread-workspace.repository.js";
import { threadRepository } from "@/db/repositories/thread.repository.js";
import {
  buildPrivateAgentWorkspacePath,
  privateAgentWorkspaceService,
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

export type RemoteThreadWorkspaceKind = "private" | "chat";

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
  | "workspace_changed";

const ERROR_STATUS: Record<RemoteThreadWorkspaceErrorCode, number> = {
  thread_context_invalid: 400,
  thread_context_required: 400,
  thread_not_found: 404,
  thread_ended: 409,
  workspace_unavailable: 409,
  workspace_changed: 409,
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

const validateChatWorkspaceRoot = (rootPath: string | null | undefined) => {
  const normalized = rootPath?.trim();
  if (!normalized || !isDirectory(normalized)) {
    throw new RemoteThreadWorkspaceError(
      "workspace_unavailable",
      "Remote thread workspace is unavailable",
    );
  }
  return path.resolve(normalized);
};

const derivePlan = (input: {
  threadId: string;
  userId: number;
}): RemoteThreadWorkspacePlan => {
  const thread = threadRepository.findById(input.threadId, input.userId);
  if (!thread) return notFound();

  if (thread.workspaceId) {
    const workspace = chatWorkspaceRepository.findById(
      thread.workspaceId,
      input.userId,
    );
    return {
      kind: "chat",
      rootPath: validateChatWorkspaceRoot(workspace?.rootPath),
      bindingExists: false,
    };
  }

  return {
    kind: "private",
    rootPath: buildPrivateAgentWorkspacePath({
      storageRoot: resolvePrivateAgentWorkspaceStorageRoot(),
      userId: input.userId,
      threadId: input.threadId,
    }),
    bindingExists: false,
  };
};

const samePlan = (
  left: Pick<RemoteThreadWorkspacePlan, "kind" | "rootPath">,
  right: Pick<RemoteThreadWorkspacePlan, "kind" | "rootPath">,
) => {
  if (left.kind !== right.kind) return false;
  // Private workspaces are deterministic for one thread. Chat workspaces are
  // user-selected roots, so compare their resolved path to detect drift.
  if (left.kind === "chat") {
    return path.resolve(left.rootPath) === path.resolve(right.rootPath);
  }
  return true;
};

const planFromBinding = (
  binding: {
    workspaceKind: string | null;
    workspaceRoot: string | null;
  },
): RemoteThreadWorkspacePlan => {
  if (
    (binding.workspaceKind !== "private" && binding.workspaceKind !== "chat") ||
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
    (input.binding.workspaceKind === "private" ||
      input.binding.workspaceKind === "chat") &&
    Boolean(input.binding.workspaceRoot);

  return {
    threadId: input.threadId,
    status: input.binding.status,
    workspace: hasWorkspace
      ? {
          // The absolute Desktop path stays inside Desktop. Mobile/remote
          // consumers locate the real space through this stable reference.
          ref: `mira-thread-workspace:${input.threadId}`,
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
    const binding = remoteThreadWorkspaceRepository.getByThread(input.threadId);
    if (binding) {
      assertIdentity(binding, input.identity, input.userId);
      assertActive(binding);
      return;
    }
    if (!threadRepository.findById(input.threadId, input.userId)) {
      notFound();
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
    const binding = remoteThreadWorkspaceRepository.getByThread(input.threadId);
    let plan: RemoteThreadWorkspacePlan;
    if (binding) {
      assertIdentity(binding, input.identity, input.userId);
      assertActive(binding);
      plan = planFromBinding(binding);
    } else {
      plan = derivePlan({ threadId: input.threadId, userId: input.userId });
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

    const rootPath =
      input.plan.kind === "private"
        ? privateAgentWorkspaceService.ensure({
            threadId: input.threadId,
            userId: input.userId,
          })
        : validateChatWorkspaceRoot(input.plan.rootPath);

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
    if (!threadRepository.findById(input.threadId, input.userId)) {
      notFound();
    }
    const binding = remoteThreadWorkspaceRepository.getByThread(input.threadId);
    if (binding) {
      assertIdentity(binding, input.identity, input.userId);
    }
    return toState({ threadId: input.threadId, binding });
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
    if (!threadRepository.findById(input.threadId, input.userId)) {
      notFound();
    }

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

    return toState({ threadId: input.threadId, binding });
  },
};
