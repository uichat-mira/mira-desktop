import { createHash } from "node:crypto";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import {
  executeHarnessInvocation,
  getHarnessInvocation,
  type HarnessInvocationRecord,
} from "@/harness/invocations.js";
import { resolveHarnessToolExposure } from "@/harness/exposure.js";
import { initializeHarnessRuntime } from "@/mcp/bootstrap.js";
import {
  resolveCoreCapabilityScope,
  resolveCoreCapabilityToolIds,
} from "@/harness/core-capability-scope.js";
import { listInternalToolDefinitions } from "@/harness/registry.js";
import type {
  ToolInvocationFailureCode,
  ToolInvocationEvent,
  ToolDefinition,
} from "@/mcp/core/definitions.js";
import {
  claimInvocationApproval,
  finalizeClaimedInvocationApproval,
  resolveInvocationApproval,
} from "@/mcp/core/invocations.js";
import { mcpBadRequest, mcpNotFound } from "@/mcp/core/errors.js";
import { getHarnessLlmContentText } from "@/harness/llm-content.js";
import { evaluateInvocationApproval } from "@/mcp/core/permissions.js";
import { validateInvocationArgs } from "@/mcp/core/schema.js";
import { createHarnessEnvironmentSnapshot } from "@/harness/environment.js";
import {
  remoteThreadWorkspaceService,
  remoteThreadExecutionKey,
  isRemoteThreadExecutionKey,
  RemoteThreadWorkspaceError,
  type RemoteThreadContext,
  type RemoteThreadWorkspacePlan,
} from "@/services/remote-thread-workspace.service.js";

const MODEL_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export type RemoteToolManifest = {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  destructive: boolean;
  requiresApproval: boolean;
};

/**
 * The single persistent Remote tool projection consumed by both Remote V1 and
 * the MCP outlet. Alias collisions fail closed instead of silently pointing one
 * MCP tool name at a different Tool Core capability.
 */
export type RemoteToolCatalog = {
  definitions: readonly ToolDefinition[];
  manifests: readonly RemoteToolManifest[];
  nameToId: ReadonlyMap<string, string>;
  idToName: ReadonlyMap<string, string>;
};

export type RemoteToolInvocationStatus =
  | "completed"
  | "awaiting_approval"
  | "failed"
  | "cancelled";

export type RemoteToolInvocationProjection = {
  invocationId: string;
  toolId: string;
  status: RemoteToolInvocationStatus;
  content?: string;
  approval?: {
    message: string;
    scope?: string;
  };
  error?: {
    code: ToolInvocationFailureCode | "tool_runtime_failed";
    message: string;
    retryable?: boolean;
    suggestedAction?: string | null;
  };
};

export type RemoteToolGatewayStreamEvent =
  | {
      type: "tool:start";
      invocationId: string;
      toolId: string;
    }
  | {
      type: "tool:progress";
      invocationId: string;
      message: string;
    }
  | {
      type: "tool:approval_required";
      invocationId: string;
      message: string;
      scope?: string;
    }
  | {
      type: "tool:error";
      code: string;
      message: string;
    }
  | {
      type: "tool:complete";
      invocation: RemoteToolInvocationProjection;
    };

const activeInvocationControllers = new Map<
  string,
  { controller: AbortController; userId: number; threadId?: string }
>();

const activeThreadControllers = new Map<string, Set<AbortController>>();

type RemoteInvocationThreadContext = {
  threadContext: RemoteThreadContext;
  plannedWorkspace?: RemoteThreadWorkspacePlan;
};

/**
 * Retains the trusted Cloud caller identity for a pending invocation so an
 * approval cannot be replayed by another account/device/Host. Invocation
 * records themselves intentionally keep only threadId.
 */
const remoteInvocationThreadContexts = new Map<
  string,
  RemoteInvocationThreadContext
>();

const threadControllerKey = (userId: number, threadId: string) =>
  `${userId}:${threadId}`;

const registerThreadController = (
  userId: number,
  threadId: string,
  controller: AbortController,
) => {
  const key = threadControllerKey(userId, threadId);
  const controllers = activeThreadControllers.get(key) ?? new Set();
  controllers.add(controller);
  activeThreadControllers.set(key, controllers);
};

const unregisterThreadController = (
  userId: number,
  threadId: string,
  controller: AbortController,
) => {
  const key = threadControllerKey(userId, threadId);
  const controllers = activeThreadControllers.get(key);
  if (!controllers) return;
  controllers.delete(controller);
  if (controllers.size === 0) {
    activeThreadControllers.delete(key);
  }
};

export const cancelRemoteToolInvocationsForThread = (
  userId: number,
  threadId: string,
) => {
  const controllers = activeThreadControllers.get(
    threadControllerKey(userId, threadId),
  );
  if (!controllers) return 0;
  let cancelled = 0;
  for (const controller of [...controllers]) {
    controller.abort();
    cancelled += 1;
  }
  return cancelled;
};

/** End is only confirmed after already-dispatched invocations have drained. */
export const waitForRemoteThreadInvocations = async (
  userId: number,
  executionThreadId: string,
  timeoutMs = 10_000,
) => {
  const key = threadControllerKey(userId, executionThreadId);
  const deadline = Date.now() + timeoutMs;
  while (activeThreadControllers.has(key)) {
    if (Date.now() >= deadline) {
      throw new RemoteThreadWorkspaceError(
        "thread_cleanup_incomplete", "Remote thread execution has not stopped yet",
      );
    }
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
};

const toModelToolName = (toolId: string) => {
  if (MODEL_TOOL_NAME_PATTERN.test(toolId)) {
    return toolId;
  }

  const readable =
    toolId
      .replace(/[^A-Za-z0-9_-]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 48) || "tool";
  const suffix = createHash("sha256").update(toolId, "utf8").digest("hex").slice(0, 10);
  return `${readable}_${suffix}`.slice(0, 64);
};

const resolveRemoteToolDefinitions = async (): Promise<ToolDefinition[]> => {
  initializeHarnessRuntime();
  const coreToolIds = resolveCoreCapabilityToolIds(listInternalToolDefinitions());

  // Remote MCP consumes the same authored core capability scope as the Desktop
  // capability surface. `editFacade: "all"` keeps a core write tool such as
  // apply_patch from being dropped by a second, unrelated presentation filter;
  // readiness and legacy-alias blocking still come from the existing exposure.
  const exposure = resolveHarnessToolExposure({
    source: "agent_intent",
    editFacade: "all",
  });

  return exposure.exposedDefinitions.filter(
    (definition) =>
      definition.source === "internal" && coreToolIds.has(definition.id),
  );
};

export type RemoteToolAdmissionDiagnostic = {
  coreProfiles: Array<{ id: string; title: string; toolIds: string[] }>;
  exposedCoreToolIds: string[];
  excludedCoreTools: Array<{ toolId: string; reason: string }>;
  nonCoreRegisteredToolIds: string[];
};

/**
 * Reports the exact core admission mapping and why a registered core Tool is
 * not currently in the remote catalog. It is diagnostic evidence, not a second
 * gate: the catalog and invocation path both consume the same core scope plus
 * the existing exposure/readiness checks.
 */
export const describeRemoteToolAdmission = async (): Promise<RemoteToolAdmissionDiagnostic> => {
  initializeHarnessRuntime();
  const internalDefinitions = listInternalToolDefinitions();
  const coreScope = resolveCoreCapabilityScope(internalDefinitions);
  const exposure = resolveHarnessToolExposure({
    source: "agent_intent",
    editFacade: "all",
  });
  const exposedToolIds = new Set(exposure.exposedToolIds);

  return {
    coreProfiles: coreScope.profiles,
    exposedCoreToolIds: internalDefinitions
      .filter(
        (definition) =>
          coreScope.toolIds.has(definition.id) &&
          exposedToolIds.has(definition.id),
      )
      .map((definition) => definition.id),
    excludedCoreTools: internalDefinitions
      .filter(
        (definition) =>
          coreScope.toolIds.has(definition.id) &&
          !exposedToolIds.has(definition.id),
      )
      .map((definition) => ({
        toolId: definition.id,
        reason:
          exposure.blockedCapabilityReasons[definition.id] ??
          "Tool is not in the current Agent exposure.",
      })),
    nonCoreRegisteredToolIds: internalDefinitions
      .filter((definition) => !coreScope.toolIds.has(definition.id))
      .map((definition) => definition.id),
  };
};

const buildRemoteToolAliases = (definitions: readonly ToolDefinition[]) => {
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();

  for (const definition of definitions) {
    const name = toModelToolName(definition.id);
    const existingId = nameToId.get(name);
    if (existingId && existingId !== definition.id) {
      throw new Error(
        `Remote tool alias collision between "${existingId}" and "${definition.id}"`,
      );
    }
    const existingName = idToName.get(definition.id);
    if (existingName && existingName !== name) {
      throw new Error(`Remote tool has conflicting aliases: ${definition.id}`);
    }
    nameToId.set(name, definition.id);
    idToName.set(definition.id, name);
  }

  return { nameToId, idToName };
};

export const resolveRemoteToolCatalog = async (): Promise<RemoteToolCatalog> => {
  const definitions = await resolveRemoteToolDefinitions();
  const aliases = buildRemoteToolAliases(definitions);
  const manifests = definitions.map((definition) => ({
    id: definition.id,
    name: aliases.idToName.get(definition.id)!,
    description: definition.description,
    parameters: definition.inputSchema,
    destructive: definition.capabilities.sideEffect !== "none",
    requiresApproval: definition.capabilities.requiresApproval,
  }));

  return {
    definitions,
    manifests,
    nameToId: aliases.nameToId,
    idToName: aliases.idToName,
  };
};

const getRemoteToolDefinition = async (toolId: string) => {
  const catalog = await resolveRemoteToolCatalog();
  const definition = catalog.definitions.find(
    (candidate) => candidate.id === toolId,
  );
  if (!definition) {
    throw mcpBadRequest("Tool is not available to the mobile Agent surface");
  }
  return definition;
};

export const assertRemoteToolAvailable = async (toolId: string) => {
  await getRemoteToolDefinition(toolId);
};

export const listRemoteToolManifests = async (): Promise<RemoteToolManifest[]> =>
  [...(await resolveRemoteToolCatalog()).manifests];

const safeFailureMessage = (failureCode: ToolInvocationFailureCode | undefined) => {
  switch (failureCode) {
    case "schema_invalid":
      return "Tool arguments are invalid.";
    case "policy_denied":
      return "Tool execution was denied by policy.";
    case "approval_mismatch":
      return "Tool approval no longer matches the requested invocation.";
    case "workspace_escape":
      return "Tool execution was blocked by the workspace boundary.";
    case "cancelled":
      return "Tool invocation was cancelled.";
    case "timeout":
      return "Tool invocation timed out.";
    default:
      return "Remote tool execution failed.";
  }
};

const projectInvocation = (
  record: HarnessInvocationRecord,
): RemoteToolInvocationProjection => {
  if (
    record.status !== "completed" &&
    record.status !== "awaiting_approval" &&
    record.status !== "failed" &&
    record.status !== "cancelled"
  ) {
    throw new Error(`Remote tool invocation ended in unsupported status: ${record.status}`);
  }

  const content = getHarnessLlmContentText(record.llmContent);
  const failureCode = record.error?.failureCode;

  return {
    invocationId: record.id,
    toolId: record.toolId,
    status: record.status,
    ...(record.status === "completed" && content ? { content } : {}),
    ...(record.status === "awaiting_approval" && record.approval
      ? {
          approval: {
            message: record.approval.reason,
            ...(record.approval.scope ? { scope: record.approval.scope } : {}),
          },
        }
      : {}),
    ...(record.status === "failed" || record.status === "cancelled"
      ? {
          error: {
            code: failureCode ?? "tool_runtime_failed",
            message: safeFailureMessage(failureCode),
            ...(typeof record.error?.retryable === "boolean"
              ? { retryable: record.error.retryable }
              : {}),
            ...(typeof record.error?.suggestedAction === "string" ||
            record.error?.suggestedAction === null
              ? { suggestedAction: record.error.suggestedAction }
              : {}),
          },
        }
      : {}),
  };
};

const toRemoteStreamEvent = (
  event: ToolInvocationEvent,
): RemoteToolGatewayStreamEvent | null => {
  if (event.type === "invocation:start") {
    return {
      type: "tool:start",
      invocationId: event.invocationId,
      toolId: event.toolId,
    };
  }
  if (event.type === "invocation:progress") {
    return {
      type: "tool:progress",
      invocationId: event.invocationId,
      message: event.message,
    };
  }
  if (event.type === "invocation:approval_required") {
    return {
      type: "tool:approval_required",
      invocationId: event.invocationId,
      message: event.message,
      ...(event.scope ? { scope: event.scope } : {}),
    };
  }
  return null;
};

const buildRemoteThreadEnvironment = (rootPath: string | null) =>
  createHarnessEnvironmentSnapshot({
    workspace: {
      rootPath,
      source: rootPath ? "selected" : "unset",
    },
  });

const runRemoteToolInvocation = async (input: {
  toolId: string;
  args: Record<string, unknown>;
  userId: number;
  threadContext?: RemoteThreadContext;
  plannedWorkspace?: RemoteThreadWorkspacePlan;
  approvedInputHash?: string;
  aliasInvocationId?: string;
  signal?: AbortSignal;
  onEvent?: (event: RemoteToolGatewayStreamEvent) => void | Promise<void>;
}) => {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (input.signal?.aborted) {
    controller.abort();
  } else {
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  let activeInvocationId: string | null = null;
  const executionThreadId = input.threadContext
    ? remoteThreadExecutionKey({ ...input.threadContext, userId: input.userId })
    : undefined;

  if (input.aliasInvocationId) {
    activeInvocationControllers.set(input.aliasInvocationId, {
      controller,
      userId: input.userId,
      ...(input.threadContext ? { threadId: executionThreadId! } : {}),
    });
  }
  if (input.threadContext) {
    registerThreadController(
      input.userId,
      executionThreadId!,
      controller,
    );
  }

  try {
    const definition = await getRemoteToolDefinition(input.toolId);
    validateInvocationArgs(input.args, definition.inputSchema);
    if (controller.signal.aborted) throw mcpBadRequest("Remote tool execution was cancelled");

    let environment = createHarnessEnvironmentSnapshot();
    let plannedWorkspace = input.plannedWorkspace;

    if (input.threadContext) {
      // The binding is checked before any approval result is settled. An ended
      // thread cannot execute even its already-pending approval.
      remoteThreadWorkspaceService.assertUsable({
        threadId: input.threadContext.threadId,
        userId: input.userId,
        identity: input.threadContext.identity,
      });

      if (definition.capabilities.workspaceBound) {
        const plan = remoteThreadWorkspaceService.plan({
          threadId: input.threadContext.threadId,
          userId: input.userId,
          identity: input.threadContext.identity,
          ...(input.plannedWorkspace
            ? { expected: input.plannedWorkspace }
            : {}),
        });
        plannedWorkspace = plan;
        environment = buildRemoteThreadEnvironment(plan.rootPath);

        // Match the approval decision that Harness will make. A call that
        // still needs approval must not create the target directory.
        const inputHash = createInvocationInputHash(input.args);
        const approvalDecision = evaluateInvocationApproval({
          definition,
          args: input.args,
          environment,
          inputHash,
          ...(input.approvedInputHash
            ? {
                approvedInvocations: [
                  {
                    toolId: input.toolId,
                    inputHash: input.approvedInputHash,
                  },
                ],
              }
            : {}),
        });
        if (approvalDecision.type === "allow") {
          plannedWorkspace = remoteThreadWorkspaceService.activate({
            threadId: input.threadContext.threadId,
            userId: input.userId,
            identity: input.threadContext.identity,
            plan,
          });
          environment = buildRemoteThreadEnvironment(
            plannedWorkspace.rootPath,
          );
        }
      } else {
        // Non-workspace tools never inherit the locally selected Desktop
        // project merely because they came through a thread.
        environment = buildRemoteThreadEnvironment(null);
      }
    }

    const record = await executeHarnessInvocation({
      toolId: input.toolId,
      args: input.args,
      userId: input.userId,
      ...(input.threadContext
        ? { threadId: executionThreadId! }
        : {}),
      signal: controller.signal,
      environment,
      ...(input.approvedInputHash
        ? {
            approvedInvocations: [
              {
                toolId: input.toolId,
                inputHash: input.approvedInputHash,
              },
            ],
          }
        : {}),
      async onEvent(event) {
        if (!activeInvocationId) {
          activeInvocationId = event.invocationId;
          activeInvocationControllers.set(activeInvocationId, {
            controller,
            userId: input.userId,
            ...(input.threadContext
              ? { threadId: executionThreadId! }
              : {}),
          });
        }
        const projected = toRemoteStreamEvent(event);
        if (projected) {
          await input.onEvent?.(projected);
        }
      },
    });

    if (input.threadContext && record.status === "awaiting_approval") {
      remoteInvocationThreadContexts.set(record.id, {
        threadContext: input.threadContext,
        ...(plannedWorkspace ? { plannedWorkspace } : {}),
      });
    } else {
      remoteInvocationThreadContexts.delete(record.id);
    }
    return record;
  } finally {
    if (activeInvocationId) {
      activeInvocationControllers.delete(activeInvocationId);
    }
    if (input.aliasInvocationId) {
      activeInvocationControllers.delete(input.aliasInvocationId);
    }
    if (input.threadContext) {
      unregisterThreadController(
        input.userId,
        executionThreadId!,
        controller,
      );
    }
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
};

export const executeRemoteToolInvocation = async (input: {
  toolId: string;
  args?: Record<string, unknown>;
  userId: number;
  threadContext?: RemoteThreadContext;
  /**
   * Set only by the official Cloud MCP outlet. Direct/legacy Remote V1 calls
   * keep using the pre-existing Desktop-selected workspace behavior.
   */
  requireThreadContext?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: RemoteToolGatewayStreamEvent) => void | Promise<void>;
}): Promise<RemoteToolInvocationProjection> => {
  const definition = await getRemoteToolDefinition(input.toolId);
  if (
    input.requireThreadContext &&
    input.threadContext === undefined &&
    definition.capabilities.workspaceBound
  ) {
    // Official Cloud MCP workspace work must be attributable to a real thread.
    // Direct/legacy callers do not pass threadContext and keep existing local
    // workspace behavior through the Remote V1 compatibility path.
    throw new RemoteThreadWorkspaceError(
      "thread_context_required",
      "Official Cloud MCP workspace execution requires a remote thread context",
    );
  }

  const record = await runRemoteToolInvocation({
    toolId: input.toolId,
    args: input.args ?? {},
    userId: input.userId,
    ...(input.threadContext
      ? { threadContext: input.threadContext }
      : {}),
    signal: input.signal,
    onEvent: input.onEvent,
  });
  return projectInvocation(record);
};

const sameRemoteThreadContext = (
  left: RemoteThreadContext,
  right: RemoteThreadContext,
) =>
  left.threadId === right.threadId &&
  left.identity.accountId === right.identity.accountId &&
  left.identity.hostId === right.identity.hostId &&
  left.identity.mobileDeviceId === right.identity.mobileDeviceId;

export const resolveRemoteToolApproval = async (input: {
  invocationId: string;
  decision: "approved" | "rejected";
  toolId: string;
  args?: Record<string, unknown>;
  userId: number;
  threadContext?: RemoteThreadContext;
}): Promise<RemoteToolInvocationProjection> => {
  const original = getHarnessInvocation(input.invocationId);
  if (!original) {
    throw mcpNotFound("Tool invocation was not found");
  }
  if (original.userId !== input.userId) {
    throw mcpNotFound("Tool invocation was not found");
  }
  if (original.status !== "awaiting_approval") {
    throw mcpBadRequest("Tool invocation is not awaiting approval");
  }
  if (original.toolId !== input.toolId) {
    throw mcpBadRequest("Tool approval does not match the original tool");
  }

  const frozenThreadContext = remoteInvocationThreadContexts.get(
    input.invocationId,
  );
  if (frozenThreadContext) {
    if (!input.threadContext) {
      throw new RemoteThreadWorkspaceError(
        "thread_context_required",
        "Remote thread approval requires the original remote thread context",
      );
    }
    if (!sameRemoteThreadContext(frozenThreadContext.threadContext, input.threadContext)) {
      throw new RemoteThreadWorkspaceError(
        "thread_not_found",
        "Remote thread was not found",
      );
    }
  }
  if (!frozenThreadContext && (input.threadContext || isRemoteThreadExecutionKey(original.threadId))) {
    throw new RemoteThreadWorkspaceError(
      "thread_not_found", "Remote thread approval does not match the original invocation",
    );
  }
  const resumeThreadContext = frozenThreadContext?.threadContext;

  if (input.decision === "rejected") {
    remoteInvocationThreadContexts.delete(input.invocationId);
    const rejected = resolveInvocationApproval({
      invocationId: input.invocationId,
      decision: "rejected",
      reason: "Rejected from Mira Mobile",
    });
    return projectInvocation(rejected);
  }

  const args = input.args ?? {};
  const inputHash = createInvocationInputHash(args);
  if (!original.inputHash || original.inputHash !== inputHash) {
    throw mcpBadRequest("Tool approval does not match the original invocation arguments");
  }

  claimInvocationApproval({
    invocationId: input.invocationId,
    userId: input.userId,
    reason: "Approved from Mira Mobile",
  });

  let resumed: HarnessInvocationRecord;
  try {
    resumed = await runRemoteToolInvocation({
      toolId: input.toolId,
      args,
      userId: input.userId,
      ...(resumeThreadContext ? { threadContext: resumeThreadContext } : {}),
      ...(frozenThreadContext?.plannedWorkspace
        ? { plannedWorkspace: frozenThreadContext.plannedWorkspace }
        : {}),
      approvedInputHash: inputHash,
      aliasInvocationId: input.invocationId,
    });
  } catch (error) {
    remoteInvocationThreadContexts.delete(input.invocationId);
    finalizeClaimedInvocationApproval({
      invocationId: input.invocationId,
      status: "failed",
      reason:
        error instanceof Error
          ? error.message
          : "Approved remote tool invocation failed.",
    });
    throw error;
  }

  remoteInvocationThreadContexts.delete(input.invocationId);
  finalizeClaimedInvocationApproval({
    invocationId: input.invocationId,
    resolutionInvocationId: resumed.id,
    status:
      resumed.status === "completed"
        ? "completed"
        : resumed.status === "cancelled"
          ? "cancelled"
          : "failed",
    reason: resumed.error?.message,
  });
  return projectInvocation(resumed);
};

export const cancelRemoteToolInvocation = (
  invocationId: string,
  userId: number,
  threadContext?: RemoteThreadContext,
) => {
  const assertThread = (threadId?: string) => {
    if (isRemoteThreadExecutionKey(threadId)) {
      if (!threadContext || remoteThreadExecutionKey({ ...threadContext, userId }) !== threadId) {
        throw new RemoteThreadWorkspaceError("thread_not_found", "Remote thread was not found");
      }
    } else if (threadContext) {
      throw new RemoteThreadWorkspaceError("thread_not_found", "Remote thread was not found");
    }
  };
  const active = activeInvocationControllers.get(invocationId);
  if (active) {
    if (active.userId !== userId) {
      throw mcpNotFound("Tool invocation was not found");
    }
    assertThread(active.threadId);
    active.controller.abort();
    return {
      invocationId,
      accepted: true,
      status: "cancelling" as const,
    };
  }

  const record = getHarnessInvocation(invocationId);
  if (!record || record.userId !== userId) {
    throw mcpNotFound("Tool invocation was not found");
  }

  assertThread(record.threadId);
  if (record.status === "awaiting_approval") {
    remoteInvocationThreadContexts.delete(invocationId);
    const cancelled = resolveInvocationApproval({
      invocationId,
      decision: "rejected",
      reason: "Cancelled from Mira Mobile",
    });
    return {
      invocationId,
      accepted: true,
      status: cancelled.status,
    };
  }

  return {
    invocationId,
    accepted: false,
    status: record.status,
  };
};
