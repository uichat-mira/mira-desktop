import { createArtifact } from "./artifacts.js";
import type {
  McpArtifact,
  McpExecutionEnvironment,
  McpInvocationFailureCode,
  McpInvocationRecord,
  McpStructuredInvocationErrorDetail,
  McpStreamEvent,
  McpStreamEventInput,
  McpToolExecutionResult,
} from "./definitions.js";
import { withEventMeta } from "./events.js";
import { McpApprovalRequiredError, mcpBadRequest, mcpNotFound } from "./errors.js";
import { getToolImplementation } from "./registry.js";
import {
  clearInvocationTraces,
  configureInvocationTraceRetention,
  createInvocationTrace,
  finishInvocationTrace,
  getInvocationTrace,
  startTraceSpan,
  sweepInvocationTraces,
} from "./traces.js";
import {
  DEFAULT_RETENTION_CONFIG,
  sweepRetentionMap,
  type RetentionConfig,
} from "@/utils/retention.js";
import { isAppError } from "@/utils/errors.js";
import { ErrorCodes } from "@/utils/response.js";
import { evaluateInvocationApproval, hasExactApprovedInvocation } from "./permissions.js";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import { validateInvocationArgs } from "./schema.js";
import { redactExternalMcpValue } from "../external-redaction.js";
import { computerUseRepository } from "@/db/repositories/computer-use/repository.js";

const COMPUTER_USE_TOOL_IDS = new Set([
  "browser_observe",
  "browser_act",
  "browser_assert",
]);
const isComputerUseInvocation = (toolId: string) =>
  COMPUTER_USE_TOOL_IDS.has(toolId);

const getStructuredInvocationError = (
  error: unknown,
): Omit<McpStructuredInvocationErrorDetail, "message"> | undefined => {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const value = error as Record<string, unknown>;
  if (typeof value.code !== "string" || typeof value.retryable !== "boolean") {
    return undefined;
  }

  return {
    code: value.code,
    retryable: value.retryable,
    ...(typeof value.suggestedAction === "string" || value.suggestedAction === null
      ? { suggestedAction: value.suggestedAction }
      : {}),
  };
};
const persistComputerUseInvocation = (record: McpInvocationRecord) => {
  if (!isComputerUseInvocation(record.toolId) || !process.env.DATABASE_URL) return;
  try { computerUseRepository.persistInvocation(record); } catch { /* database initialization is completed by server startup */ }
};

const invocationMap = new Map<string, McpInvocationRecord>();
const invocationEvents = new Map<string, McpStreamEvent[]>();
let invocationRetentionConfig: RetentionConfig = {
  ...DEFAULT_RETENTION_CONFIG,
};

const appendEvent = (invocationId: string, event: McpStreamEvent) => {
  const events = invocationEvents.get(invocationId) ?? [];
  events.push(event);
  invocationEvents.set(invocationId, events);
  if (isComputerUseInvocation(getInvocation(invocationId)?.toolId ?? "")) {
    try { computerUseRepository.persistEvents(invocationId, events); } catch { /* optional before database startup */ }
  }
};

const sweepInvocations = () => {
  sweepRetentionMap(invocationMap, {
    config: invocationRetentionConfig,
    getUpdatedAt: (record) => record.finishedAt ?? record.startedAt,
    keep: (record) => !record.finishedAt,
  });
  sweepRetentionMap(invocationEvents, {
    config: invocationRetentionConfig,
    getUpdatedAt: (_events) => undefined,
  });
  sweepInvocationTraces();
};

export const getInvocation = (invocationId: string) =>
  invocationMap.get(invocationId) ?? computerUseRepository.getInvocation(invocationId) ?? undefined;

export const listInvocationEvents = (invocationId: string) =>
  invocationEvents.get(invocationId) ?? computerUseRepository.getEvents(invocationId);

export const resolveInvocationApproval = (input: {
  invocationId: string;
  decision: "approved" | "rejected";
  resolutionInvocationId?: string;
  reason?: string;
}) => {
  const record = getInvocation(input.invocationId);
  if (!record) throw new Error(`Invocation was not found: ${input.invocationId}`);
  if (record.status !== "awaiting_approval") throw new Error(`Invocation is not awaiting approval: ${input.invocationId}`);
  const resolvedAt = new Date().toISOString();
  record.status = input.decision === "approved" ? "completed" : "cancelled";
  record.finishedAt = resolvedAt;
  record.approval = {
    ...(record.approval ?? { required: true, reason: "Approval required." }),
    resolution: {
      decision: input.decision,
      resolutionInvocationId: input.resolutionInvocationId,
      resolvedAt,
      reason: input.reason,
    },
  };
  if (input.decision === "approved") {
    record.result = { approvalResolution: record.approval.resolution };
    delete record.error;
  } else {
    record.error = { message: input.reason ?? "Invocation approval was rejected.", failureCode: "cancelled" };
    record.result = { approvalResolution: record.approval.resolution };
  }
  invocationMap.set(record.id, record);
  persistComputerUseInvocation(record);
  appendEvent(record.id, { type: "invocation:finish", status: record.status, at: resolvedAt, invocationId: record.id });
  return record;
};

export const claimInvocationApproval = (input: {
  invocationId: string;
  userId?: number;
  reason?: string;
}) => {
  const record = getInvocation(input.invocationId);
  if (!record) throw new Error(`Invocation was not found: ${input.invocationId}`);
  if (
    record.status !== "awaiting_approval" ||
    record.approval?.resolution
  ) {
    throw new Error(
      `Invocation approval is no longer available: ${input.invocationId}`,
    );
  }
  if (
    typeof input.userId === "number" &&
    record.userId !== input.userId
  ) {
    throw new Error(`Invocation was not found: ${input.invocationId}`);
  }

  const resolvedAt = new Date().toISOString();
  record.status = "running";
  delete record.finishedAt;
  record.approval = {
    ...(record.approval ?? { required: true, reason: "Approval required." }),
    resolution: {
      decision: "approved",
      resolvedAt,
      reason: input.reason,
    },
  };
  delete record.error;
  invocationMap.set(record.id, record);
  persistComputerUseInvocation(record);
  return record;
};

export const finalizeClaimedInvocationApproval = (input: {
  invocationId: string;
  resolutionInvocationId?: string;
  status: "completed" | "failed" | "cancelled";
  reason?: string;
}) => {
  const record = getInvocation(input.invocationId);
  if (
    !record ||
    record.status !== "running" ||
    record.approval?.resolution?.decision !== "approved"
  ) {
    throw new Error(
      `Invocation approval claim is not active: ${input.invocationId}`,
    );
  }

  const finishedAt = new Date().toISOString();
  record.status = input.status;
  record.finishedAt = finishedAt;
  record.approval = {
    ...(record.approval ?? { required: true, reason: "Approval required." }),
    resolution: {
      ...record.approval!.resolution!,
      resolutionInvocationId: input.resolutionInvocationId,
      reason: input.reason ?? record.approval!.resolution!.reason,
    },
  };
  record.result = { approvalResolution: record.approval.resolution };
  if (input.status === "completed") {
    delete record.error;
  } else {
    record.error = {
      message:
        input.reason ??
        (input.status === "cancelled"
          ? "Approved invocation was cancelled."
          : "Approved invocation failed."),
      failureCode:
        input.status === "cancelled" ? "cancelled" : "tool_runtime_failed",
    };
  }
  invocationMap.set(record.id, record);
  persistComputerUseInvocation(record);
  appendEvent(record.id, {
    type: "invocation:finish",
    status: record.status,
    at: finishedAt,
    invocationId: record.id,
  });
  return record;
};

export const clearInvocations = () => {
  invocationMap.clear();
  invocationEvents.clear();
  clearInvocationTraces();
};

export const configureInvocationRetention = (
  config: Partial<RetentionConfig>,
) => {
  invocationRetentionConfig = {
    ...invocationRetentionConfig,
    ...config,
  };
  configureInvocationTraceRetention(config);
};

export const sweepStoredInvocations = () => {
  sweepInvocations();
};

export const getInvocationTraceRecord = (invocationId: string) => getInvocationTrace(invocationId);

export interface ExecuteInvocationInput {
  toolId: string;
  args?: Record<string, unknown>;
  userId?: number;
  threadId?: string;
  turnId?: string;
  signal?: AbortSignal;
  environment?: McpExecutionEnvironment;
  approvedInvocations?: Array<{
    toolId: string;
    inputHash: string;
  }>;
  onEvent?: (event: McpStreamEvent) => void | Promise<void>;
}

export const executeInvocation = async (
  input: ExecuteInvocationInput,
): Promise<McpInvocationRecord> => {
  const tool = getToolImplementation(input.toolId);
  if (!tool) {
    throw mcpNotFound(`Tool not found: ${input.toolId}`);
  }

  const args = input.args ?? {};
  if (typeof args !== "object" || Array.isArray(args)) {
    throw mcpBadRequest("Invocation args must be an object");
  }
  validateInvocationArgs(args, tool.definition.inputSchema);
  const inputHash = createInvocationInputHash(args);

  const invocationId = crypto.randomUUID();
  sweepInvocations();
  const startedAt = new Date().toISOString();
  const artifacts: McpArtifact[] = [];
  const signal = input.signal ?? new AbortController().signal;
  const trace = createInvocationTrace({
    invocationId,
    toolId: input.toolId,
    startedAt,
  });

  const record: McpInvocationRecord = {
    id: invocationId,
    toolId: input.toolId,
    status: "running",
    args: tool.definition.source === "external"
      ? redactExternalMcpValue(args) as Record<string, unknown>
      : args,
    inputHash,
    ...(typeof input.userId === "number" ? { userId: input.userId } : {}),
    artifacts,
    traceId: trace.traceId,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    startedAt,
  };
  invocationMap.set(invocationId, record);
  persistComputerUseInvocation(record);

  const emit = async (event: McpStreamEventInput) => {
    const safeEvent = tool.definition.source === "external"
      ? redactExternalMcpValue(event) as McpStreamEventInput
      : event;
    const full = withEventMeta(invocationId, safeEvent);
    appendEvent(invocationId, full);
    await input.onEvent?.(full);
  };

  await emit({
    type: "invocation:start",
    toolId: input.toolId,
  });

  const invocationSpan = startTraceSpan({
    invocationId,
    name: `Invoke ${input.toolId}`,
    kind: "invocation",
    metadata: {
      toolId: input.toolId,
    },
  });

  try {
    if (signal.aborted) {
      throw new Error("Invocation cancelled before execution");
    }

    const approvalDecision = evaluateInvocationApproval({
      definition: tool.definition,
      args,
      environment: input.environment,
      approvedInvocations: input.approvedInvocations,
      inputHash,
    });
    if (approvalDecision.type === "require_approval") {
      throw new McpApprovalRequiredError(
        approvalDecision.reason ?? `${input.toolId} requires approval.`,
        {
          scope: approvalDecision.scope,
        },
      );
    }

    const approvalGranted = hasExactApprovedInvocation({
      toolId: input.toolId,
      inputHash,
      approvedInvocations: input.approvedInvocations,
    });

    const response = (await tool.execute({
      invocationId,
      args,
      userId: input.userId,
      approval: {
        inputHash,
        granted: approvalGranted,
      },
      threadId: input.threadId,
      turnId: input.turnId,
      signal,
      environment: input.environment,
      pushEvent: (event) => {
        void emit(event);
      },
      addArtifact: (artifact) => {
        const artifactSpan = startTraceSpan({
          invocationId,
          parentSpanId: invocationSpan.spanId,
          name: `Emit artifact ${artifact.kind}`,
          kind: "artifact_emit",
          metadata: {
            kind: artifact.kind,
            title: artifact.title,
          },
        });
        const next = createArtifact(artifact);
        const safeArtifact = tool.definition.source === "external"
          ? redactExternalMcpValue(next) as typeof next
          : next;
        artifacts.push(safeArtifact);
        void emit({
          type: "invocation:artifact",
          artifact: safeArtifact,
        });
        artifactSpan.end({
          metadata: {
            artifactId: safeArtifact.id,
          },
        });
        return next;
      },
      trace: {
        startSpan: (spanInput) =>
          startTraceSpan({
            invocationId,
            ...spanInput,
            ...(tool.definition.source === "external" && spanInput.metadata
              ? { metadata: redactExternalMcpValue(spanInput.metadata) as Record<string, unknown> }
              : {}),
          }),
      },
    })) as McpToolExecutionResult;

    if (response.evidence !== undefined) {
      record.evidence = tool.definition.source === "external"
        ? redactExternalMcpValue(response.evidence) as typeof response.evidence
        : response.evidence;
    }

    if (response.result !== undefined) {
      const resultSpan = startTraceSpan({
        invocationId,
        parentSpanId: invocationSpan.spanId,
        name: "Normalize result",
        kind: "result_normalization",
      });
      record.result = tool.definition.source === "external"
        ? redactExternalMcpValue(response.result)
        : response.result;
      await emit({
        type: "invocation:result",
        result: record.result,
      });
      resultSpan.end();
    }

    record.status = signal.aborted ? "cancelled" : "completed";
    record.finishedAt = new Date().toISOString();
    invocationSpan.end({
      status: signal.aborted ? "cancelled" : "completed",
      metadata: {
        status: record.status,
      },
    });
    finishInvocationTrace(invocationId);

    await emit({
      type: "invocation:finish",
      status: record.status,
    });
    sweepInvocations();
    persistComputerUseInvocation(record);

    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = tool.definition.source === "external"
      ? String(redactExternalMcpValue(message))
      : message;
    if (error instanceof McpApprovalRequiredError) {
      record.status = "awaiting_approval";
      record.approval = {
        required: true,
        reason: message,
        ...(error.scope ? { scope: error.scope } : {}),
      };
      record.finishedAt = new Date().toISOString();
      invocationSpan.end({
        status: "completed",
        metadata: {
          status: record.status,
          approvalScope: error.scope,
        },
      });
      finishInvocationTrace(invocationId);

      await emit({
        type: "invocation:approval_required",
        message,
        ...(error.scope ? { scope: error.scope } : {}),
      });
      await emit({
        type: "invocation:finish",
        status: record.status,
      });
      sweepInvocations();
      persistComputerUseInvocation(record);

      return record;
    }

    const failureCode = inferInvocationFailureCode({
      error,
      message: safeMessage,
      signal,
    });
    const structuredError = getStructuredInvocationError(error);
    record.status = signal.aborted ? "cancelled" : "failed";
    record.error = {
      message,
      failureCode,
      ...structuredError,
    };
    record.finishedAt = new Date().toISOString();
    invocationSpan.end({
      status: signal.aborted ? "cancelled" : "failed",
      metadata: {
        status: record.status,
        message: safeMessage,
        failureCode,
        ...(structuredError ?? {}),
      },
    });
    finishInvocationTrace(invocationId);

    await emit({
      type: "invocation:error",
      message: safeMessage,
    });
    await emit({
      type: "invocation:finish",
      status: record.status,
    });
    sweepInvocations();
    persistComputerUseInvocation(record);

    return record;
  }
};

const inferInvocationFailureCode = (input: {
  error: unknown;
  message: string;
  signal: AbortSignal;
}): McpInvocationFailureCode => {
  if (input.signal.aborted) {
    return "cancelled";
  }

  if (isAppError(input.error)) {
    if (
      input.error.statusCode === 400 ||
      input.error.code === ErrorCodes.VALIDATION_ERROR
    ) {
      return "schema_invalid";
    }

    if (
      input.error.statusCode === 403 ||
      input.error.code === ErrorCodes.FORBIDDEN
    ) {
      return "policy_denied";
    }
  }

  if (/\bapproval mismatch\b/i.test(input.message)) {
    return "approval_mismatch";
  }

  if (/\bpolicy denied\b/i.test(input.message)) {
    return "policy_denied";
  }

  if (
    /\boutside workspace\b/i.test(input.message) ||
    /\boutside the current workspace root\b/i.test(input.message)
  ) {
    return "workspace_escape";
  }

  if (/\bschema\b/i.test(input.message)) {
    return "schema_invalid";
  }

  if (/\btimeout\b|\btimed out\b/i.test(input.message)) {
    return "timeout";
  }

  return "tool_runtime_failed";
};
