import { writeStructuredLog } from "@/logger";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol";
import { streamTaskStructuredOutputText } from "@/services/provider-proxy.service/task-structured-output";
import type { AgentToolExposureState } from "../types";
import {
  bindPlannerNativeToolExposure,
  type PlannerProviderOutputKind,
  type PlannerProviderStream,
} from "./decision-adapter";
import { buildPlannerStructuredOutputJsonSchema } from "./structured-output";

const INSTALL_KEY = Symbol.for("uichat-mira.planner-structured-output-installed");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseMessagePayload = (message: NormalizedChatMessage | undefined) => {
  if (!message?.content) return null;
  try {
    const parsed = JSON.parse(message.content) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeToolMeta = (value: unknown) => {
  if (!isRecord(value) || typeof value.toolId !== "string") return null;
  return {
    toolId: value.toolId,
    title: typeof value.title === "string" ? value.title : value.toolId,
    description: typeof value.description === "string" ? value.description : "",
    ...(isRecord(value.inputSchema) ? { inputSchema: value.inputSchema } : {}),
    ...(typeof value.domain === "string" ? { domain: value.domain } : {}),
    ...(typeof value.source === "string" ? { source: value.source } : {}),
  } as AgentToolExposureState["toolMeta"][number];
};

const extractPlannerToolExposure = (
  messages: NormalizedChatMessage[],
): AgentToolExposureState => {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const payload = parseMessagePayload(lastUser);
  const toolExposure = isRecord(payload?.toolExposure) ? payload.toolExposure : null;

  if (toolExposure) {
    const exposedTools = Array.isArray(toolExposure.exposedTools)
      ? toolExposure.exposedTools.filter(
          (item): item is string => typeof item === "string" && Boolean(item.trim()),
        )
      : [];
    const toolMeta = Array.isArray(toolExposure.toolMeta)
      ? toolExposure.toolMeta
          .map(normalizeToolMeta)
          .filter(
            (item): item is AgentToolExposureState["toolMeta"][number] => Boolean(item),
          )
      : [];
    return { exposedTools, toolMeta };
  }

  const allowedTools = Array.isArray(payload?.allowedTools) ? payload.allowedTools : [];
  const toolMeta = allowedTools
    .map(normalizeToolMeta)
    .filter(
      (item): item is AgentToolExposureState["toolMeta"][number] => Boolean(item),
    );
  return {
    exposedTools: toolMeta.map((item) => item.toolId),
    toolMeta,
  };
};

const isPlannerStructuredRequest = (messages: NormalizedChatMessage[]) =>
  messages.some(
    (message) =>
      message.role === "system" && message.content.includes("RUNTIME PLAN CONTRACT:"),
  );

/**
 * Planner keeps the existing streamTaskChatText call site for compatibility.
 * Planner-marked requests use native schema-constrained generation, but the
 * provider text deltas are forwarded immediately so `reason` can drive the
 * existing plannerThought/plannerThoughtStreaming UI before the complete JSON
 * decision is validated and executed.
 */
export const installPlannerStructuredOutputHook = () => {
  const installState = providerProxyService as unknown as Record<PropertyKey, unknown>;
  if (installState[INSTALL_KEY] === true) return;

  const originalStreamTaskChatText = providerProxyService.streamTaskChatText.bind(
    providerProxyService,
  );

  providerProxyService.streamTaskChatText = ((messages: NormalizedChatMessage[]) => {
    if (!isPlannerStructuredRequest(messages)) {
      return originalStreamTaskChatText(messages);
    }

    let outputKind: PlannerProviderOutputKind = "text";
    let structuredOutput: unknown;
    const stream = (async function* () {
      let emittedNativeDelta = false;
      let nativeStreamCreated = false;
      try {
        const toolExposure = extractPlannerToolExposure(messages);
        const nativeStream = streamTaskStructuredOutputText({
          messages,
          schema: buildPlannerStructuredOutputJsonSchema(toolExposure),
          name: "planner_decision",
          description:
            "Exactly one next-action Planner decision plus a lightweight runtime todo patch.",
        });
        nativeStreamCreated = true;
        for await (const delta of nativeStream) {
          emittedNativeDelta = true;
          outputKind = "native";
          yield delta;
        }
        structuredOutput = bindPlannerNativeToolExposure(
          nativeStream.getStructuredOutput?.(),
          toolExposure,
        );
        outputKind = "native";
      } catch (error) {
        const canFallback = !nativeStreamCreated && !emittedNativeDelta;
        writeStructuredLog("warn", {
          msg: canFallback
            ? "Planner native structured output capability unavailable; falling back to text JSON"
            : emittedNativeDelta
              ? "Planner native structured output stream failed after partial output"
              : "Planner native structured output protocol failed before output",
          event: canFallback
            ? "agent-next-action-planner-structured-fallback"
            : "agent-next-action-planner-structured-failure",
          partialNativeOutput: emittedNativeDelta,
          reason: error instanceof Error ? error.message : String(error),
        });

        // Never concatenate a second JSON generation after native JSON has already
        // started streaming; that would manufacture an invalid multi-object Planner
        // response. Compatibility fallback is only safe when no native stream was
        // created, which means the catalog declared no native Planner capability.
        if (!canFallback) {
          throw error;
        }
        yield* originalStreamTaskChatText(messages);
      }
    })();

    return Object.assign(stream, {
      getOutputKind: () => outputKind,
      getStructuredOutput: () => structuredOutput,
    }) as PlannerProviderStream;
  }) as typeof providerProxyService.streamTaskChatText;

  installState[INSTALL_KEY] = true;
};

installPlannerStructuredOutputHook();
