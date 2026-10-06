/**
 * 工具调用规范化节点：校验并冻结 Planner 输出的工具调用参数，生成 pending tool call。
 */
import crypto from "node:crypto";
import { validateInvocationArgs } from "@/mcp/core/schema";
import { normalizeWorkspaceBoundaryArgs } from "@/mcp/workspace-path-args";
import { toAgentExecutionNode } from "../trace";
import {
  getTraceAttemptMeta,
  type EmitAgentExecutionNode,
  type AgentGraphState,
} from "../node-runtime";
import type { AgentNextAction, AgentToolMeta, PendingToolCall } from "../types";

const nowIso = () => new Date().toISOString();

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJson(nestedValue)]),
    );
  }

  return value;
};

const createPendingToolInputHash = (input: {
  toolId: string;
  args: Record<string, unknown>;
  source: PendingToolCall["source"];
}) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(sortJson(input)))
    .digest("hex");

const emitStepNode = async (
  emit: EmitAgentExecutionNode | undefined,
  input: Parameters<typeof toAgentExecutionNode>[0],
) => {
  await emit?.(toAgentExecutionNode(input));
};

const emitNormalizeFailure = async (
  state: AgentGraphState,
  emit: EmitAgentExecutionNode | undefined,
  input: {
    reason: string;
    toolId?: string | null;
    availableToolCount: number;
    schemaReplanEligible?: boolean;
    schemaReplanAttemptCount?: number;
  },
) => {
  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-tool-call-normalize",
    ...getTraceAttemptMeta("agent-tool-call-normalize", state),
    nodeType: "tool",
    phase: "error",
    label: "工具调用规范化失败",
    summary: input.reason,
    details: {
      reason: input.reason,
      toolId: input.toolId ?? null,
      availableToolCount: input.availableToolCount,
      schemaReplanEligible: input.schemaReplanEligible ?? false,
      schemaReplanAttemptCount: input.schemaReplanAttemptCount ?? 0,
    },
  });
};

const findToolMeta = (toolMeta: AgentToolMeta[] | undefined, toolId: string) =>
  toolMeta?.find((item) => item.toolId === toolId);

const normalizeWorkspaceBoundArgs = (
  toolMeta: AgentToolMeta,
  args: Record<string, unknown>,
): { args: Record<string, unknown> } | { rejectReason: string } => {
  const normalizedArgs = normalizeWorkspaceBoundaryArgs(
    {
      capabilities: toolMeta.capabilities,
    },
    args,
  );

  if ("rejectReason" in normalizedArgs) {
    return {
      rejectReason:
        "Planner workspace tool path escaped the workspace root after normalization.",
    };
  }

  return normalizedArgs;
};

const getUseToolAction = (
  nextAction: AgentNextAction | undefined,
): Extract<AgentNextAction, { type: "use_tool" }> | null => {
  if (!nextAction) {
    return null;
  }

  return nextAction.type === "use_tool" ? nextAction : null;
};

const failNormalize = async (
  state: AgentGraphState,
  emit: EmitAgentExecutionNode | undefined,
  input: {
    reason: string;
    toolId?: string | null;
    schemaReplanEligible?: boolean;
  },
): Promise<Partial<AgentGraphState>> => {
  const nextAttemptCount = input.schemaReplanEligible
    ? (state.schemaReplanDiagnostics?.attemptCount ?? 0) + 1
    : 0;
  await emitNormalizeFailure(state, emit, {
    reason: input.reason,
    toolId: input.toolId,
    availableToolCount: state.toolExposure?.exposedTools.length ?? 0,
    schemaReplanEligible: input.schemaReplanEligible,
    schemaReplanAttemptCount: nextAttemptCount,
  });

  if (input.schemaReplanEligible) {
    return {
      pendingToolCall: undefined,
      schemaReplanDiagnostics: {
        schemaError: input.reason,
        toolId: input.toolId ?? undefined,
        invalidAction: getUseToolAction(state.nextAction) ?? undefined,
        attemptCount: nextAttemptCount,
      },
      errorMessage: undefined,
      errorSourceNodeId: undefined,
    };
  }

  return {
    pendingToolCall: undefined,
    schemaReplanDiagnostics: undefined,
    errorMessage: input.reason,
    errorSourceNodeId: "agent-tool-call-normalize",
  };
};

export const toolCallNormalizeNode = async (
  state: AgentGraphState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentGraphState>> => {
  const nextAction = state.nextAction;
  const useToolAction = getUseToolAction(nextAction);

  if (!nextAction) {
    return failNormalize(state, emit, {
      reason: "Missing nextAction; cannot normalize tool call.",
    });
  }

  if (!useToolAction) {
    return {
      pendingToolCall: undefined,
      ...(state.schemaReplanDiagnostics
        ? { schemaReplanDiagnostics: undefined }
        : {}),
    };
  }

  if (
    typeof useToolAction.toolId !== "string" ||
    !useToolAction.toolId.trim()
  ) {
    return failNormalize(state, emit, {
      reason: "Planner use_tool output must include a non-empty toolId.",
      toolId:
        typeof useToolAction.toolId === "string" ? useToolAction.toolId : null,
    });
  }

  if (!isPlainObject(useToolAction.args)) {
    return failNormalize(state, emit, {
      reason: "Planner use_tool args must be a plain object.",
      toolId: useToolAction.toolId,
    });
  }

  const normalizedToolId = useToolAction.toolId.trim();
  const exposedTools = state.toolExposure?.exposedTools ?? [];
  if (!exposedTools.includes(normalizedToolId)) {
    return failNormalize(state, emit, {
      reason: `Planner selected tool is not exposed: ${normalizedToolId}`,
      toolId: normalizedToolId,
    });
  }

  const toolMeta = findToolMeta(state.toolExposure?.toolMeta, normalizedToolId);
  if (!toolMeta) {
    return failNormalize(state, emit, {
      reason: `Planner selected tool is missing exposure metadata: ${normalizedToolId}`,
      toolId: normalizedToolId,
    });
  }

  if (!toolMeta.inputSchema) {
    return failNormalize(state, emit, {
      reason: `Planner selected tool is missing inputSchema: ${normalizedToolId}`,
      toolId: normalizedToolId,
    });
  }

  const normalizedArgsResult = normalizeWorkspaceBoundArgs(
    toolMeta,
    useToolAction.args,
  );
  if ("rejectReason" in normalizedArgsResult) {
    return failNormalize(state, emit, {
      reason: normalizedArgsResult.rejectReason,
      toolId: normalizedToolId,
      schemaReplanEligible: normalizedToolId === "terminal",
    });
  }

  const normalizedArgs = normalizedArgsResult.args;

  try {
    validateInvocationArgs(normalizedArgs, toolMeta.inputSchema);
  } catch (error) {
    return failNormalize(state, emit, {
      reason:
        error instanceof Error
          ? error.message
          : `Planner tool args failed schema validation for ${normalizedToolId}.`,
      toolId: normalizedToolId,
      schemaReplanEligible: true,
    });
  }

  const pendingToolCall: PendingToolCall = {
    id: crypto.randomUUID(),
    toolId: normalizedToolId,
    args: normalizedArgs,
    source: "planner",
    reason: useToolAction.reason,
    inputHash: createPendingToolInputHash({
      toolId: normalizedToolId,
      args: normalizedArgs,
      source: "planner",
    }),
    status: "frozen",
    toolMeta,
    createdAt: nowIso(),
  };

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-tool-call-normalize",
    ...getTraceAttemptMeta("agent-tool-call-normalize", state),
    nodeType: "tool",
    phase: "done",
    label: "工具调用规范化",
    summary: `已冻结 ${normalizedToolId} 调用参数`,
    details: {
      toolId: normalizedToolId,
      source: "planner",
      argKeys: Object.keys(normalizedArgs).sort(),
      hasToolMeta: Boolean(toolMeta),
      inputHash: pendingToolCall.inputHash,
      status: "frozen",
    },
  });

  return {
    pendingToolCall,
    ...(state.schemaReplanDiagnostics
      ? { schemaReplanDiagnostics: undefined }
      : {}),
    errorMessage: undefined,
    errorSourceNodeId: undefined,
  };
};