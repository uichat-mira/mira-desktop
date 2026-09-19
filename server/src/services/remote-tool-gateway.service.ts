import { createHash } from "node:crypto";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import {
  executeHarnessInvocation,
  getHarnessInvocation,
  type HarnessInvocationRecord,
} from "@/harness/invocations.js";
import { resolveHarnessToolExposure } from "@/harness/exposure.js";
import { initializeHarnessRuntime } from "@/mcp/bootstrap.js";
import type {
  McpInvocationFailureCode,
  McpStreamEvent,
  McpToolDefinition,
} from "@/mcp/core/definitions.js";
import {
  claimInvocationApproval,
  finalizeClaimedInvocationApproval,
  resolveInvocationApproval,
} from "@/mcp/core/invocations.js";
import { mcpBadRequest, mcpNotFound } from "@/mcp/core/errors.js";
import { resolveAgentEligibleExternalMcpCapabilities } from "@/mcp/external.js";
import { getHarnessLlmContentText } from "@/harness/llm-content.js";

const MODEL_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export type RemoteToolManifest = {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  destructive: boolean;
  requiresApproval: boolean;
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
    code: McpInvocationFailureCode | "tool_runtime_failed";
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
  { controller: AbortController; userId: number }
>();

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

const resolveRemoteToolDefinitions = async (): Promise<McpToolDefinition[]> => {
  initializeHarnessRuntime();
  const eligibleExternalToolIds = process.env.DATABASE_URL
    ? resolveAgentEligibleExternalMcpCapabilities().map((definition) => definition.id)
    : [];

  const exposure = resolveHarnessToolExposure({
    source: "agent_intent",
    allowExternal: true,
    allowedExternalToolIds: eligibleExternalToolIds,
  });

  return exposure.exposedDefinitions;
};

const getRemoteToolDefinition = async (toolId: string) => {
  const definitions = await resolveRemoteToolDefinitions();
  const definition = definitions.find((candidate) => candidate.id === toolId);
  if (!definition) {
    throw mcpBadRequest("Tool is not available to the mobile Agent surface");
  }
  return definition;
};

export const assertRemoteToolAvailable = async (toolId: string) => {
  await getRemoteToolDefinition(toolId);
};

export const listRemoteToolManifests = async (): Promise<RemoteToolManifest[]> => {
  const definitions = await resolveRemoteToolDefinitions();
  return definitions.map((definition) => ({
    id: definition.id,
    name: toModelToolName(definition.id),
    description: definition.description,
    parameters: definition.inputSchema,
    destructive: definition.capabilities.sideEffect !== "none",
    requiresApproval: definition.capabilities.requiresApproval,
  }));
};

const safeFailureMessage = (failureCode: McpInvocationFailureCode | undefined) => {
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
  event: McpStreamEvent,
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

const runRemoteToolInvocation = async (input: {
  toolId: string;
  args: Record<string, unknown>;
  userId: number;
  approvedInputHash?: string;
  aliasInvocationId?: string;
  signal?: AbortSignal;
  onEvent?: (event: RemoteToolGatewayStreamEvent) => void | Promise<void>;
}) => {
  await getRemoteToolDefinition(input.toolId);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (input.signal?.aborted) {
    controller.abort();
  } else {
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  let activeInvocationId: string | null = null;

  if (input.aliasInvocationId) {
    activeInvocationControllers.set(input.aliasInvocationId, {
      controller,
      userId: input.userId,
    });
  }

  try {
    const record = await executeHarnessInvocation({
      toolId: input.toolId,
      args: input.args,
      userId: input.userId,
      signal: controller.signal,
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
          });
        }
        const projected = toRemoteStreamEvent(event);
        if (projected) {
          await input.onEvent?.(projected);
        }
      },
    });
    return record;
  } finally {
    if (activeInvocationId) {
      activeInvocationControllers.delete(activeInvocationId);
    }
    if (input.aliasInvocationId) {
      activeInvocationControllers.delete(input.aliasInvocationId);
    }
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
};

export const executeRemoteToolInvocation = async (input: {
  toolId: string;
  args?: Record<string, unknown>;
  userId: number;
  signal?: AbortSignal;
  onEvent?: (event: RemoteToolGatewayStreamEvent) => void | Promise<void>;
}): Promise<RemoteToolInvocationProjection> => {
  const record = await runRemoteToolInvocation({
    toolId: input.toolId,
    args: input.args ?? {},
    userId: input.userId,
    signal: input.signal,
    onEvent: input.onEvent,
  });
  return projectInvocation(record);
};

export const resolveRemoteToolApproval = async (input: {
  invocationId: string;
  decision: "approved" | "rejected";
  toolId: string;
  args?: Record<string, unknown>;
  userId: number;
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

  if (input.decision === "rejected") {
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
      approvedInputHash: inputHash,
      aliasInvocationId: input.invocationId,
    });
  } catch (error) {
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
) => {
  const active = activeInvocationControllers.get(invocationId);
  if (active) {
    if (active.userId !== userId) {
      throw mcpNotFound("Tool invocation was not found");
    }
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

  if (record.status === "awaiting_approval") {
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
