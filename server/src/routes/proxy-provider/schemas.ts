import { PUBLIC_API_ROUTES } from "@/config/public-api.js";
import {
  PROVIDER_CODE_ENUM,
  proxyProviderSchema,
} from "@/providers/catalog.js";
import {
  errorEnvelope,
  messageRoleSchema,
  successEnvelope,
} from "@/routes/schema-helpers.js";

export const chatMessagesBodySchema = {
  type: "object",
  required: ["messages"],
  properties: {
    messages: {
      type: "array",
      description: "Canonical desktop chat messages sent by the renderer.",
      items: {
        type: "object",
        required: ["role", "parts"],
        properties: {
          id: {
            type: "string",
            description: "Optional client-side message id.",
          },
          role: {
            ...messageRoleSchema,
            description: "Message author role.",
          },
          parts: {
            type: "array",
            minItems: 1,
            description:
              "Canonical message parts. Text, image and file are accepted.",
            items: {
              anyOf: [
                {
                  type: "object",
                  required: ["type", "text"],
                  additionalProperties: false,
                  properties: {
                    type: {
                      type: "string",
                      const: "text",
                    },
                    text: {
                      type: "string",
                    },
                  },
                },
                {
                  type: "object",
                  required: ["type", "image"],
                  additionalProperties: false,
                  properties: {
                    type: {
                      type: "string",
                      const: "image",
                    },
                    image: {
                      type: "string",
                      minLength: 1,
                    },
                    fileId: {
                      type: "string",
                      minLength: 1,
                    },
                    filename: {
                      type: "string",
                    },
                    mediaType: {
                      type: "string",
                    },
                  },
                },
                {
                  type: "object",
                  required: ["type", "data", "filename", "mimeType"],
                  additionalProperties: false,
                  properties: {
                    type: {
                      type: "string",
                      const: "file",
                    },
                    filename: {
                      type: "string",
                      minLength: 1,
                    },
                    data: {
                      type: "string",
                      minLength: 1,
                    },
                    fileId: {
                      type: "string",
                      minLength: 1,
                    },
                    mimeType: {
                      type: "string",
                      minLength: 1,
                    },
                  },
                },
              ],
            },
          },
        },
        additionalProperties: false,
      },
    },
    appendAtTail: {
      type: "object",
      required: ["expectedTailMessageId"],
      additionalProperties: false,
      description: "Append one new user turn only if the Host canonical tail has not changed.",
      properties: {
        expectedTailMessageId: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
        },
      },
    },
    agentEnabled: {
      type: "boolean",
      description: "Per-send Agent mode request from the desktop composer.",
    },
    requestedToolGroupIds: {
      type: "array",
      description: "Explicit tool package groups selected from the composer.",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
  },
} as const;

const providerParamsSchema = {
  type: "object",
  required: ["provider"],
  properties: {
    provider: {
      ...proxyProviderSchema,
      description: "Provider code, or `default` for the app's default model route.",
    },
  },
} as const;

const embeddingsBodySchema = {
  type: "object",
  required: ["input"],
  properties: {
    input: {
      description: "Text input or batch of text inputs to embed.",
      anyOf: [
        { type: "string", minLength: 1 },
        {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
      ],
    },
  },
} as const;

const embeddingsResponseSchema = {
  type: "object",
  required: ["providerCode", "model", "dimensions", "embeddings"],
  properties: {
    providerCode: {
      type: "string",
      description: "Resolved provider that produced the embeddings.",
      enum: PROVIDER_CODE_ENUM,
    },
    model: {
      type: "string",
      description: "Remote embedding model identifier.",
    },
    modelConfigId: {
      type: "string",
      description: "Local model config used to resolve the embedding model.",
    },
    dimensions: {
      type: "number",
      description: "Embedding vector dimension returned by the provider.",
    },
    embeddings: {
      type: "array",
      description: "Embedding vectors in the same order as request inputs.",
      items: {
        type: "array",
        items: { type: "number" },
      },
    },
  },
} as const;

const taskDefaultChatRoute = PUBLIC_API_ROUTES.taskDefaultChat;
const providerChatRoute = PUBLIC_API_ROUTES.providerChat;
const providerEmbeddingsRoute = PUBLIC_API_ROUTES.providerEmbeddings;

// OpenAPI contracts for provider proxy routes. Streaming responses are
// documented as strings because Fastify serializes the Node stream directly.
export const proxyProviderRouteSchemas = {
  taskDefaultChat: {
    tags: [taskDefaultChatRoute.tag],
    summary: taskDefaultChatRoute.summary,
    operationId: "taskDefaultChat",
    body: chatMessagesBodySchema,
    response: {
      200: {
        description: "Server-Sent Events stream delivering task chat chunks.",
        type: "string",
      },
      400: errorEnvelope,
      500: errorEnvelope,
    },
  },
  providerChat: {
    tags: [providerChatRoute.tag],
    summary: providerChatRoute.summary,
    operationId: "proxyProviderChat",
    params: providerParamsSchema,
    body: chatMessagesBodySchema,
    response: {
      200: {
        description: "Server-Sent Events or desktop chat data stream.",
        type: "string",
      },
      400: errorEnvelope,
      500: errorEnvelope,
    },
  },
  providerEmbeddings: {
    tags: [providerEmbeddingsRoute.tag],
    summary: providerEmbeddingsRoute.summary,
    operationId: "proxyProviderEmbeddings",
    params: providerParamsSchema,
    body: embeddingsBodySchema,
    response: {
      200: successEnvelope(embeddingsResponseSchema),
      400: errorEnvelope,
      500: errorEnvelope,
    },
  },
} as const;
