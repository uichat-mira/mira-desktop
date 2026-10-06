import OpenAI from "openai";
import { createOpenAICompatibleClient } from "@/services/openai-compatible-provider.js";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol.js";
import { ConversationTrimmer } from "@/services/conversation-trimmer.js";
import { executeHarnessInvocation } from "@/harness/invocations.js";
import { getHarnessLlmContentText } from "@/harness/llm-content.js";
import { resolveProviderForRole } from "@/services/provider-proxy.service/resolution.js";
import { getProviderDefinition } from "@/providers/catalog.js";
import { toOpenAICompatibleChatOptions } from "@/services/provider-proxy.service/params.js";
import {
  resolveChatToolSurface,
  type ChatToolSurfaceDefinition,
} from "./chat-tool-surface.js";
import type {
  AssistantExecutionNodeEvent,
  AssistantToolEvent,
} from "@/services/chat-stream-events.js";

const MAX_TOOL_LOOP_STEPS = 3;
const MAX_TOOL_LOOP_NON_SYSTEM_MESSAGES = 8;
const TOOL_LOOP_SYNTHESIS_PROMPT =
  "You already have enough tool results for this turn. Do not call more tools. Write the final answer for the user using the collected evidence, and clearly mention any uncertainty instead of making another tool request.";

interface ExecuteChatToolLoopInput {
  requestedProvider: "default";
  threadId: string;
  userId: number;
  agentEnabled?: boolean;
  messages: NormalizedChatMessage[];
  params?: Record<string, unknown>;
  onToolEvent?: (event: AssistantToolEvent) => Promise<void> | void;
  onExecutionNode?: (
    event: AssistantExecutionNodeEvent,
  ) => Promise<void> | void;
}

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

const toOpenAIMessageContent = (message: NormalizedChatMessage) => {
  const textParts = (message.parts ?? [])
    .filter(
      (
        part,
      ): part is Extract<NonNullable<NormalizedChatMessage["parts"]>[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text);

  return textParts.join("\n").trim() || message.content;
};

const toOpenAIMessages = (messages: NormalizedChatMessage[]) =>
  messages.map((message) => ({
    role: message.role,
    content: toOpenAIMessageContent(message),
  })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

const buildToolLoopSynthesisMessage =
  (): OpenAI.Chat.Completions.ChatCompletionSystemMessageParam => ({
    role: "system",
    content: TOOL_LOOP_SYNTHESIS_PROMPT,
  });

/**
 * Tool-loop requests should stay compact.
 *
 * We keep all request-only system context intact, but only the most recent
 * non-system turns. This prevents Agent mode from sending a full thread history
 * into compact providers like Ollama on the first tool-decision request.
 */
const trimToolLoopMessages = (messages: NormalizedChatMessage[]) => {
  const systemMessages = messages.filter((message) => message.role === "system");
  const nonSystemMessages = messages.filter(
    (message) => message.role !== "system",
  );
  const sanitizedNonSystemMessages = nonSystemMessages.filter((message) => {
    if (message.role !== "assistant") {
      return true;
    }

    const content = message.content.toLowerCase();
    return !(
      content.includes("<tool>") ||
      content.includes("<parameter>") ||
      content.includes("read_list") ||
      content.includes("read_locate") ||
      content.includes("terminal")
    );
  });

  return [
    ...systemMessages,
    ...ConversationTrimmer.take(
      sanitizedNonSystemMessages,
      MAX_TOOL_LOOP_NON_SYSTEM_MESSAGES,
      "tail",
    ),
  ];
};

const toOpenAITools = (tools: ChatToolSurfaceDefinition[]) =>
  tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

const parseToolArguments = (raw: string) => {
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object");
  }

  return parsed as Record<string, unknown>;
};

const buildToolResultMessage = (
  toolCallId: string,
  toolName: string,
  result: unknown,
  modelContent?: string,
): OpenAI.Chat.Completions.ChatCompletionToolMessageParam => ({
  role: "tool",
  tool_call_id: toolCallId,
  content: modelContent || JSON.stringify({ toolName, result }),
});

const buildAssistantToolCallMessage = (
  toolCalls: OpenAIToolCall[],
): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam => ({
  role: "assistant",
  content: "",
  tool_calls: toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    },
  })),
});

const toToolExecutionNodeEvent = (input: {
  toolCallId?: string;
  toolName: string;
  phase: "start" | "done" | "error";
  summary: string;
  toolArgs?: Record<string, unknown>;
  output?: unknown;
  errorMessage?: string;
}) => ({
  nodeId: input.toolCallId ?? `tool-${input.toolName}`,
  nodeType: "tool",
  phase: input.phase,
  label: input.toolName,
  summary: input.summary,
  details: {
    toolName: input.toolName,
    ...(input.toolCallId ? { callId: input.toolCallId } : {}),
    ...(input.toolArgs ? { input: input.toolArgs } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "output")
      ? { output: input.output }
      : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  },
});

/**
 * Minimal Phase 2 normal-chat tool loop.
 *
 * Scope:
 * - openai-compatible providers only
 * - allowlisted Harness-backed tools only
 * - synchronous completion API, no tool streaming yet
 * - single request completes the whole tool loop before returning final answer
 */
export const executeDefaultChatToolLoop = async (
  input: ExecuteChatToolLoopInput,
) => {
  const resolved = resolveProviderForRole("llm", input.requestedProvider);
  const providerDefinition = getProviderDefinition(resolved.providerCode);

  if (
    providerDefinition.chatAdapter !== "openai-compatible" &&
    providerDefinition.chatAdapter !== "ollama"
  ) {
    return null;
  }

  if (!input.agentEnabled) {
    return null;
  }

  const toolSurface = resolveChatToolSurface({
    agentEnabled: input.agentEnabled,
  });
  if (toolSurface.length === 0) {
    return null;
  }

  const client = createOpenAICompatibleClient(resolved.baseUrl, resolved.apiKey);
  const openAiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    toOpenAIMessages(trimToolLoopMessages(input.messages));
  const tools = toOpenAITools(toolSurface);
  const mergedParams = {
    ...resolved.params,
    ...(input.params ?? {}),
  };
  let usedToolCount = 0;

  for (let step = 0; step < MAX_TOOL_LOOP_STEPS; step += 1) {
    const completion = await client.chat.completions.create({
      model: resolved.model,
      messages: openAiMessages,
      tools,
      tool_choice: "auto",
      stream: false,
      ...toOpenAICompatibleChatOptions(mergedParams),
    });

    const choice = completion.choices[0];
    const message = choice?.message;
    const toolCalls = (message?.tool_calls ?? []) as OpenAIToolCall[];
    const finalText = message?.content?.trim() ?? "";

    if (toolCalls.length === 0) {
      return {
        answer: finalText,
        toolCallsUsed: step,
      };
    }

    openAiMessages.push(buildAssistantToolCallMessage(toolCalls));

    for (const toolCall of toolCalls) {
      const toolArgs = parseToolArguments(toolCall.function.arguments ?? "");
      await input.onToolEvent?.({
        callId: toolCall.id,
        toolName: toolCall.function.name,
        status: "requested",
        input: toolArgs,
      });
      await input.onExecutionNode?.(
        toToolExecutionNodeEvent({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          phase: "start",
          summary: `Requesting ${toolCall.function.name}`,
          toolArgs,
        }),
      );
      await input.onToolEvent?.({
        callId: toolCall.id,
        toolName: toolCall.function.name,
        status: "running",
        input: toolArgs,
      });
      await input.onExecutionNode?.(
        toToolExecutionNodeEvent({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          phase: "start",
          summary: `Running ${toolCall.function.name}`,
          toolArgs,
        }),
      );
      const invocation = await executeHarnessInvocation({
        toolId: toolCall.function.name,
        args: toolArgs,
        userId: input.userId,
        threadId: input.threadId,
      });

      if (invocation.status === "awaiting_approval") {
        const approvalMessage =
          invocation.approval?.reason ??
          `${toolCall.function.name} requires approval before execution.`;
        await input.onToolEvent?.({
          callId: toolCall.id,
          toolName: toolCall.function.name,
          status: "awaiting_approval",
          input: toolArgs,
          errorMessage: approvalMessage,
        });
        await input.onExecutionNode?.(
          toToolExecutionNodeEvent({
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            phase: "done",
            summary: `${toolCall.function.name} is waiting for approval`,
            toolArgs,
            errorMessage: approvalMessage,
          }),
        );
        return {
          answer: approvalMessage,
          toolCallsUsed: usedToolCount,
          awaitingApproval: true,
        };
      }

      if (invocation.status !== "completed") {
        await input.onToolEvent?.({
          callId: toolCall.id,
          toolName: toolCall.function.name,
          status: "failed",
          input: toolArgs,
          errorMessage:
            invocation.error?.message ??
            `Tool invocation failed: ${toolCall.function.name}`,
        });
        await input.onExecutionNode?.(
          toToolExecutionNodeEvent({
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            phase: "error",
            summary: `${toolCall.function.name} failed`,
            toolArgs,
            errorMessage:
              invocation.error?.message ??
              `Tool invocation failed: ${toolCall.function.name}`,
          }),
        );
        throw new Error(
          invocation.error?.message ??
            `Tool invocation failed: ${toolCall.function.name}`,
        );
      }

      await input.onToolEvent?.({
        callId: toolCall.id,
        toolName: toolCall.function.name,
        status: "succeeded",
        input: toolArgs,
        output: invocation.result ?? null,
      });
      await input.onExecutionNode?.(
        toToolExecutionNodeEvent({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          phase: "done",
          summary: `${toolCall.function.name} completed`,
          toolArgs,
          output: invocation.result ?? null,
        }),
      );

      openAiMessages.push(
        buildToolResultMessage(
          toolCall.id,
          toolCall.function.name,
          invocation.result ?? null,
          getHarnessLlmContentText(invocation.llmContent),
        ),
      );
      usedToolCount += 1;
    }
  }

  const synthesisCompletion = await client.chat.completions.create({
    model: resolved.model,
    messages: [...openAiMessages, buildToolLoopSynthesisMessage()],
    stream: false,
    ...toOpenAICompatibleChatOptions(mergedParams),
  });

  const synthesisChoice = synthesisCompletion.choices[0];
  const synthesisText = synthesisChoice?.message?.content?.trim() ?? "";

  if (synthesisText) {
    return {
      answer: synthesisText,
      toolCallsUsed: usedToolCount,
    };
  }

  throw new Error("Tool loop exceeded maximum step limit");
};
