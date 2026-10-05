import type { AssistantExecutionNodeEvent } from "@/services/chat-stream-events";
import type { AgentNextAction } from "./types";

export const toAgentExecutionNode = (input: {
  runId: string;
  nodeId: string;
  nodeType: string;
  phase: AssistantExecutionNodeEvent["phase"];
  label: string;
  slotKey?: string;
  attemptKey?: string;
  iteration?: number;
  emittedAt?: string;
  summary?: string;
  details?: Record<string, unknown>;
}): AssistantExecutionNodeEvent => ({
  nodeId: input.nodeId,
  nodeType: input.nodeType,
  phase: input.phase,
  label: input.label,
  traceDomain: "agent",
  ...(input.slotKey ? { slotKey: input.slotKey } : {}),
  ...(input.attemptKey ? { attemptKey: input.attemptKey } : {}),
  ...(typeof input.iteration === "number" ? { iteration: input.iteration } : {}),
  emittedAt: input.emittedAt ?? new Date().toISOString(),
  ...(input.summary ? { summary: input.summary } : {}),
  details: {
    runId: input.runId,
    ...(input.details ?? {}),
  },
});

export const toAgentErrorExecutionNode = (input: {
  runId: string;
  nodeId: string;
  label: string;
  summary: string;
  details?: Record<string, unknown>;
}) =>
  toAgentExecutionNode({
    ...input,
    nodeType: "error",
    phase: "error",
  });

export const toAgentApprovalExecutionNode = (input: {
  runId: string;
  nodeId: string;
  label: string;
  summary?: string;
  details?: Record<string, unknown>;
}) =>
  toAgentExecutionNode({
    ...input,
    nodeType: "approval",
    phase: "start",
  });

const getTraceValuePreview = (value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
};

export const getToolTraceTargetPreview = (
  toolId: string,
  args: Record<string, unknown>,
) => {
  if (
    (toolId === "read" ||
      toolId === "read_open" ||
      toolId === "list" ||
      toolId === "read_list" ||
      toolId === "read_locate") &&
    typeof args.path === "string"
  ) {
    return getTraceValuePreview(args.path);
  }

  if (toolId === "terminal_session" && typeof args.command === "string") {
    return getTraceValuePreview(args.command);
  }

  if (typeof args.query === "string") {
    return getTraceValuePreview(args.query);
  }

  return undefined;
};

export const summarizePlannerNextAction = (input: {
  nextAction?: AgentNextAction;
  pendingApprovalActive: boolean;
  recoveryExhausted: boolean;
}) => {
  if (input.pendingApprovalActive) {
    return "上一轮工具仍在等待审批，暂不生成新动作";
  }

  if (!input.nextAction) {
    return input.recoveryExhausted
      ? "恢复尝试已用尽，当前流程停止继续规划"
      : "当前没有可继续执行的新动作";
  }

  switch (input.nextAction.type) {
    case "answer":
      return "当前证据已足够，开始组织最终回答";
    case "retrieve":
      return `下一步改为检索知识库证据：${input.nextAction.query}`;
    case "use_tool": {
      const target = getToolTraceTargetPreview(
        input.nextAction.toolId,
        input.nextAction.args,
      );
      return target
        ? `下一步改为执行 ${input.nextAction.toolId}：${target}`
        : `下一步改为执行 ${input.nextAction.toolId}`;
    }
    case "ask_user":
      return `需要先向用户补问信息：${input.nextAction.question}`;
    case "error":
      return input.recoveryExhausted
        ? "恢复尝试已用尽，当前流程停止继续执行"
        : "当前流程无法安全继续，准备返回明确原因";
    default:
      return "已完成下一步动作决策";
  }
};

export const summarizeToolExecutionStart = (
  toolId: string,
  args: Record<string, unknown>,
) => {
  const target = getToolTraceTargetPreview(toolId, args);
  return target ? `开始执行 ${toolId}：${target}` : `开始执行 ${toolId}`;
};

export const summarizeToolExecutionWaitingApproval = (
  toolId: string,
  args: Record<string, unknown>,
) => {
  const target = getToolTraceTargetPreview(toolId, args);
  return target
    ? `${toolId} 需要新的人工审批，执行已暂停：${target}`
    : `${toolId} 需要新的人工审批，执行已暂停`;
};

export const summarizeToolExecutionFailure = (input: {
  toolId: string;
  failureKind: "recoverable" | "terminal" | undefined;
  args: Record<string, unknown>;
}) => {
  const target = getToolTraceTargetPreview(input.toolId, input.args);
  const prefix = target
    ? `${input.toolId} 执行失败：${target}`
    : `${input.toolId} 执行失败`;
  return input.failureKind === "recoverable"
    ? `${prefix}，正在重新判断下一步`
    : `${prefix}，当前流程已停止`;
};

export const summarizeToolExecutionCompleted = (
  toolId: string,
  args: Record<string, unknown>,
) => {
  const target = getToolTraceTargetPreview(toolId, args);
  return target
    ? `${toolId} 执行完成，开始整理结果：${target}`
    : `${toolId} 执行完成，开始整理结果`;
};

export const toAgentResumeExecutionNode = (input: {
  runId: string;
  toolId: string;
  toolCallId?: string;
  inputHash?: string;
  summary?: string;
}) =>
  toAgentExecutionNode({
    runId: input.runId,
    nodeId: "agent-resume-execution",
    nodeType: "approval",
    phase: "done",
    label: "恢复执行",
    summary:
      input.summary ?? `审批已通过，继续恢复 ${input.toolId} 的执行`,
    details: {
      toolId: input.toolId,
      toolCallId: input.toolCallId ?? null,
      inputHash: input.inputHash ?? null,
      resumedFromApproval: true,
    },
  });