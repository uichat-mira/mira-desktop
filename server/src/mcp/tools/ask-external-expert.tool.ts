import type { ToolInvocationContext, ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import {
  externalExpertService,
  type ExternalExpertService,
} from "@/microapps/external-expert/index.js";

type ExternalExpertConsultationService = Pick<ExternalExpertService, "ask">;

const askExternalExpertInputSchema = {
  type: "object",
  required: ["question"],
  properties: {
    question: {
      type: "string",
      description: "Question for the configured external expert.",
    },
  },
  additionalProperties: false,
} as const;

export const createAskExternalExpertTool = (
  service: ExternalExpertConsultationService = externalExpertService,
): ToolImplementation => ({
  definition: {
    id: "ask_external_expert",
    title: "Ask External Expert",
    description:
      "Ask the configured external web expert for advice. Provider, conversation, connectivity, and Mira context are managed internally. The reply is evidence for Mira; the external expert cannot execute Mira tools.",
    domain: "external_expert",
    source: "internal",
    mode: "sync",
    inputSchema: askExternalExpertInputSchema,
    tags: [
      "external-expert",
      "expert-advice",
      "ask",
      "consult",
      "问策",
      "专家",
    ],
    outputSchema: {
      type: "object",
      required: ["answer", "status", "latencyMs"],
      properties: {
        answer: { type: "string" },
        status: { type: "string", enum: ["completed"] },
        latencyMs: { type: "number" },
      },
    },
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
      longRunning: true,
    },
  },
  execute: async (context: ToolInvocationContext) => {
    if (context.userId === undefined || !Number.isInteger(context.userId)) {
      throw mcpBadRequest(
        "External Expert requires a trusted authenticated user context",
      );
    }

    const question = context.args.question;
    if (typeof question !== "string" || !question.trim()) {
      throw mcpBadRequest("question is required");
    }

    const result = await service.ask({
      userId: context.userId,
      question,
      ...(context.threadId ? { threadId: context.threadId } : {}),
      signal: context.signal,
    });

    return {
      result,
      evidence: {
        actionTaken: "Received advice from the configured external expert.",
        facts: [
          "tool=ask_external_expert",
          `status=${result.status}`,
          `latencyMs=${result.latencyMs}`,
        ],
        status: "completed",
        data: result,
      },
    };
  },
});

export const askExternalExpertTool = createAskExternalExpertTool();
