/**
 * Generate: turn the Agent's accumulated runtime context into the user-facing answer.
 *
 * Pi-style rule: real tool/retrieval results are model context. Generate does not act as a
 * second semantic judge over Evidence and must not replace a grounded model answer merely
 * because an Evidence summary is partial, truncated, generic, or otherwise conservative.
 */
import type {
  NormalizedChatMessage,
  NormalizedChatMessagePart,
} from "@/services/provider-proxy.message-protocol";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import { contextBudgetService } from "@/services/context-budget/index";
import { agentGenerateTextRunnable } from "../runnables";
import { getEvidencePayload } from "../evidence";
import { materializeFinalizationEvidence } from "../finalization";
import { emitStepNode } from "../node-runtime";
import {
  createObservation,
  getLatestUserQuestion,
} from "./shared";
import type {
  AgentNodeState,
  EmitAgentExecutionNode,
} from "../node-runtime";

type ProtocolLeakReason =
  | "function_calls_xml"
  | "invoke_xml"
  | "pending_tool_call_envelope"
  | "tool_call_json_envelope";

const unwrapJsonCodeFence = (value: string) => {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(value);
  return match?.[1] ?? value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isExplicitToolCallJsonEnvelope = (value: unknown) => {
  if (!isRecord(value)) {
    return false;
  }

  if (isRecord(value.pendingToolCall)) {
    return true;
  }

  if (isRecord(value.function_call) || Array.isArray(value.tool_calls)) {
    return true;
  }

  const hasToolId = typeof value.toolId === "string" && value.toolId.trim().length > 0;
  const hasArgs = isRecord(value.args);
  return (value.type === "use_tool" && (hasToolId || hasArgs)) || (hasToolId && hasArgs);
};

const detectProtocolLeak = (answer: string): ProtocolLeakReason | undefined => {
  if (/<\/?function_calls?\b[^>]*>/i.test(answer)) {
    return "function_calls_xml";
  }
  if (/<\/?invoke\b[^>]*>/i.test(answer)) {
    return "invoke_xml";
  }
  if (/\bpendingToolCall\s*[:=]\s*\{/i.test(answer)) {
    return "pending_tool_call_envelope";
  }

  try {
    const parsed = JSON.parse(unwrapJsonCodeFence(answer));
    if (isExplicitToolCallJsonEnvelope(parsed)) {
      return isRecord(parsed) && isRecord(parsed.pendingToolCall)
        ? "pending_tool_call_envelope"
        : "tool_call_json_envelope";
    }
  } catch {
    // Only complete JSON envelopes are inspected here. Natural-language output is untouched.
  }

  return undefined;
};

const buildGenerateInstructionMessages = (
  state: AgentNodeState,
): NormalizedChatMessage[] => [
  {
    role: "system",
    content: [
      "你现在处于 Agent 的最终回答阶段，不是 Planner。",
      "Planner 已经完成唯一的任务完成判断。你只能依据 FINALIZATION PACKET 和其引用的 EVIDENCE REF 组织用户回答。",
      "请直接面向用户回答，不要输出 nextAction、toolId、args、pendingToolCall、function_calls 或其他内部协议。",
      "不要自行选择未引用证据，不要重新判断任务是否完成，不要发起或模拟工具调用。",
      "若引用证据明确包含失败、超时、截断或不可读信息，请按证据本身如实说明，不要编造。",
      `FINALIZATION PACKET:\n${JSON.stringify(state.finalizationPacket, null, 2)}`,
    ].join("\n"),
    parts: [],
  },
];

const getGenerateRequestContextMessages = (state: AgentNodeState) =>
  (state.requestContextMessages ?? []).filter(
    (message) => message.requestContextScope !== "agent-execution",
  );

const buildGenerateContextBudget = (
  state: AgentNodeState,
  evidenceMessages: NormalizedChatMessage[],
  evidenceImageParts: Array<
    Extract<NormalizedChatMessagePart, { type: "image" }>
  >,
  invocation: ReturnType<typeof providerProxyService.describeChatInvocation>,
) =>
  contextBudgetService.pack({
    policy: "agent-generate",
    roleType: "llm",
    providerCode: invocation.providerCode,
    model: invocation.model,
    params: {
      ...invocation.params,
      ...(state.params ?? {}),
    },
    sections: {
      prefaceMessages: getGenerateRequestContextMessages(state),
      instructionMessages: buildGenerateInstructionMessages(state),
      payloads: evidenceMessages.map((message, index) => ({
        id: `finalization-evidence-${index}`,
        messages: [message],
        metadata: { source: "planner_finalization" },
      })),
      historyMessages: state.messages.slice(0, -1),
      latestUserMessage: (() => {
        const content = getLatestUserQuestion(state.messages) || state.goal.text;
        return {
          role: "user" as const,
          content,
          parts: [
            { type: "text" as const, text: content },
            ...evidenceImageParts,
          ],
        };
      })(),
    },
  });

export const generateNode = async (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentNodeState>> => {
  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-generate",
    nodeType: "generate",
    phase: "start",
    label: "生成回答",
    summary:
      state.nextAction?.type === "ask_user"
        ? "正在交付 Planner 澄清问题"
        : "正在生成 Agent 最终回答",
  });

  if (state.nextAction?.type === "ask_user") {
    const answer = state.nextAction.question;
    const observation = createObservation({
      runId: state.runId,
      stepId: "generate",
      status: "ok",
      facts: [
        "Delivered the Planner ask_user question deterministically without invoking the answer model.",
      ],
    });

    await emitStepNode(emit, {
      runId: state.runId,
      nodeId: "agent-generate",
      nodeType: "generate",
      phase: "done",
      label: "生成回答",
      summary: "已向用户交付 Planner 澄清问题",
      details: {
        answerLength: Array.from(answer).length,
        answerSource: "planner_ask_user_question",
        deterministicAskUser: true,
        modelInvoked: false,
        protocolGuardTriggered: false,
      },
    });

    return {
      answer,
      observations: [...(state.observations ?? []), observation],
      schemaReplanDiagnostics: undefined,
      generatedAnswerEmptyFallback: false,
    };
  }

  if (state.nextAction?.type !== "answer" || !state.finalizationPacket) {
    const errorMessage =
      "Generate requires a frozen Planner answer finalization packet.";
    return {
      errorMessage,
      errorSourceNodeId: "agent-generate",
      blockedReason: errorMessage,
    };
  }

  const materializedEvidence = materializeFinalizationEvidence({
    packet: state.finalizationPacket,
    evidence: getEvidencePayload(state),
  });
  if (materializedEvidence.missingRefs.length > 0) {
    const errorMessage = `Generate could not resolve Planner Evidence references: ${materializedEvidence.missingRefs.join(", ")}`;
    return {
      errorMessage,
      errorSourceNodeId: "agent-generate",
      blockedReason: errorMessage,
    };
  }

  const invocationResolution = providerProxyService.describeChatInvocation(
    "default",
    [
      ...buildGenerateInstructionMessages(state),
      {
        role: "user",
        content: getLatestUserQuestion(state.messages) || state.goal.text,
      },
    ],
  );
  const budget = buildGenerateContextBudget(
    state,
    materializedEvidence.messages,
    materializedEvidence.imageParts,
    invocationResolution,
  );
  const generationMessages = budget.messages;
  const generationInvocation = providerProxyService.describeChatInvocation(
    "default",
    generationMessages,
  );

  let answer: string;
  try {
    answer = await agentGenerateTextRunnable.invoke({
      messages: generationMessages,
      params: state.params,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const observation = createObservation({
      runId: state.runId,
      stepId: "generate",
      status: "failed",
      facts: ["Agent final answer generation failed."],
      errorMessage,
    });

    await emitStepNode(emit, {
      runId: state.runId,
      nodeId: "agent-generate",
      nodeType: "generate",
      phase: "error",
      label: "生成回答",
      summary: `Agent 最终回答生成失败: ${errorMessage}`,
      details: {
        errorMessage,
        invocation: generationInvocation,
        contextBudget: budget.audit,
        messageCount: generationMessages.length,
      },
    });

    return {
      observations: [...(state.observations ?? []), observation],
      errorMessage,
      errorSourceNodeId: "agent-generate",
      contextBudget: budget.audit,
    };
  }

  const protocolLeakReason = detectProtocolLeak(answer);
  if (protocolLeakReason) {
    const errorMessage =
      "Generation model returned an internal tool-call protocol instead of a user answer.";
    const observation = createObservation({
      runId: state.runId,
      stepId: "generate",
      status: "failed",
      facts: [
        "Blocked an internal tool-call protocol envelope from the user-facing answer; the envelope did not trigger tool execution.",
      ],
    });

    await emitStepNode(emit, {
      runId: state.runId,
      nodeId: "agent-generate",
      nodeType: "generate",
      phase: "error",
      label: "生成回答",
      summary: "Generation LLM 返回了内部工具调用协议，回答交付失败",
      details: {
        answerLength: 0,
        invocation: generationInvocation,
        contextBudget: budget.audit,
        messageCount: generationMessages.length,
        outputGuardTriggered: true,
        outputGuardReason: protocolLeakReason,
        protocolGuardTriggered: true,
        modelInvoked: true,
        generatedAnswerEmptyFallback: false,
      },
    });

    return {
      observations: [...(state.observations ?? []), observation],
      contextBudget: budget.audit,
      errorMessage,
      errorSourceNodeId: "agent-generate",
      blockedReason: errorMessage,
    };
  }

  if (!answer.trim()) {
    const errorMessage = "Generation model returned an empty user answer.";
    const observation = createObservation({
      runId: state.runId,
      stepId: "generate",
      status: "failed",
      facts: ["Generation model returned an empty user answer."],
      errorMessage,
    });

    await emitStepNode(emit, {
      runId: state.runId,
      nodeId: "agent-generate",
      nodeType: "generate",
      phase: "error",
      label: "生成回答",
      summary: "Generation LLM 回答为空，回答交付失败",
      details: {
        answerLength: 0,
        invocation: generationInvocation,
        contextBudget: budget.audit,
        messageCount: generationMessages.length,
        generatedAnswerEmptyFallback: true,
      },
    });

    return {
      observations: [...(state.observations ?? []), observation],
      contextBudget: budget.audit,
      errorMessage,
      errorSourceNodeId: "agent-generate",
      blockedReason: errorMessage,
    };
  }

  const observation = createObservation({
    runId: state.runId,
    stepId: "generate",
    status: "ok",
    facts: [`Generated answer length: ${Array.from(answer).length}`],
  });

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-generate",
    nodeType: "generate",
    phase: "done",
    label: "生成回答",
    summary: "已生成 Agent 回答",
    details: {
      answerLength: Array.from(answer).length,
      invocation: generationInvocation,
      contextBudget: budget.audit,
      messageCount: generationMessages.length,
      outputGuardTriggered: false,
      protocolGuardTriggered: false,
      generatedAnswerEmptyFallback: false,
    },
  });

  return {
    answer,
    observations: [...(state.observations ?? []), observation],
    contextBudget: budget.audit,
    schemaReplanDiagnostics: undefined,
    generatedAnswerEmptyFallback: false,
  };
};
