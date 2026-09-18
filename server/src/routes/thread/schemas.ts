import {
  MAX_MESSAGE_CONTENT_LENGTH,
  MESSAGE_ROLE_VALUES,
  THREAD_STATUS_VALUES,
} from "@/constants/domain.js";
import {
  deletedResponseSchema,
  errorEnvelope,
  idParamsSchema,
  successEnvelope,
} from "@/routes/schema-helpers.js";

// Thread summary returned by list and mutation endpoints. It intentionally
// includes message counts and the last message so list views do not need to
// fetch full message history.
export const threadSchema = {
  type: "object",
  required: [
    "id",
    "title",
    "modelName",
    "workspaceId",
    "status",
    "createdAt",
    "updatedAt",
    "messageCount",
  ],
  properties: {
    id: { type: "string", description: "Stable thread identifier." },
    title: { type: "string", description: "User-facing conversation title." },
    modelName: {
      description: "Display name of the model associated with the thread.",
      type: ["string", "null"],
    },
    workspaceId: {
      type: ["string", "null"],
      description: "Workspace bound to this thread.",
    },
    knowledgeBaseId: {
      type: ["string", "null"],
      description: "Knowledge base bound to this thread.",
    },
    roleId: {
      type: ["string", "null"],
      description: "Role bound to this thread.",
    },
    agentEnabled: {
      type: ["boolean", "null"],
      description: "Whether built-in agent tools are enabled for this thread.",
    },
    ttsEnabled: {
      type: ["boolean", "null"],
      description: "Whether assistant TTS is enabled for this thread.",
    },
    imageEnabled: {
      type: ["boolean", "null"],
      description: "Whether automatic role image generation is enabled for this thread.",
    },
    contextSummary: {
      type: ["string", "null"],
      description: "Persisted thread context summary.",
    },
    contextSummaryUpdatedAt: {
      type: ["string", "null"],
      format: "date-time",
      description: "When the thread context summary was last updated.",
    },
    status: {
      type: "string",
      description: "Thread lifecycle state.",
      enum: THREAD_STATUS_VALUES,
    },
    createdAt: {
      type: "string",
      format: "date-time",
      description: "ISO creation timestamp.",
    },
    updatedAt: {
      type: "string",
      format: "date-time",
      description: "ISO last-update timestamp.",
    },
    messageCount: {
      type: "number",
      description: "Number of persisted messages in the thread.",
    },
    lastMessage: {
      type: "string",
      description: "Latest message preview for thread list rendering.",
    },
  },
} as const;

// Message response schema. Metadata must allow nested arbitrary fields because
// RAG source payloads are stored under `metadata.rag.sources`.
export const messageSchema = {
  type: "object",
  required: ["id", "threadId", "role", "content", "parts", "createdAt"],
  additionalProperties: false,
  properties: {
    id: { type: "string", description: "Stable message identifier." },
    threadId: {
      type: "string",
      description: "Owning thread identifier.",
    },
    role: {
      type: "string",
      description: "Message author role.",
      enum: MESSAGE_ROLE_VALUES,
    },
    content: { type: "string", description: "Persisted message text." },
    parts: {
      type: "array",
      description:
        "Canonical message parts used by the desktop chat runtime for text and attachments.",
      items: {
        anyOf: [
          {
            type: "object",
            required: ["type", "text"],
            additionalProperties: false,
            properties: {
              type: { const: "text" },
              text: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["type", "image"],
            additionalProperties: false,
            properties: {
              type: { const: "image" },
              image: { type: "string" },
              filename: { type: "string" },
              fileId: { type: "string" },
              mediaType: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["type", "data", "filename", "mimeType"],
            additionalProperties: false,
            properties: {
              type: { const: "file" },
              data: { type: "string" },
              filename: { type: "string" },
              fileId: { type: "string" },
              mimeType: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["type", "name", "value"],
            additionalProperties: false,
            properties: {
              type: { const: "data" },
              name: { type: "string" },
              value: {},
            },
          },
        ],
      },
    },
    metadata: {
      type: "object",
      description: "Free-form message metadata such as RAG source details.",
      additionalProperties: true,
    },
    createdAt: {
      type: "string",
      format: "date-time",
      description: "ISO creation timestamp.",
    },
  },
} as const;

export const threadWithMessagesSchema = {
  type: "object",
  required: [...threadSchema.required, "messages"],
  properties: {
    ...threadSchema.properties,
    messages: {
      type: "array",
      description: "Messages ordered by the service for conversation display.",
      items: messageSchema,
    },
  },
} as const;

const threadMutationBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Replacement thread title." },
    modelName: {
      type: "string",
      description: "Display name of the model associated with the thread.",
    },
    workspaceId: {
      type: ["string", "null"],
      description: "Workspace bound to this thread.",
    },
    knowledgeBaseId: {
      type: ["string", "null"],
      description: "Knowledge base bound to this thread.",
    },
    roleId: {
      type: ["string", "null"],
      description: "Role bound to this thread.",
    },
    agentEnabled: {
      type: ["boolean", "null"],
      description: "Whether built-in agent tools are enabled for this thread.",
    },
    contextSummary: {
      type: ["string", "null"],
      description: "Replacement thread context summary.",
    },
    ttsEnabled: { type: ["boolean", "null"] },
    imageEnabled: { type: ["boolean", "null"] },
  },
} as const;

const threadContextSummarySchema = {
  type: "object",
  required: ["contextSummary", "contextSummaryUpdatedAt"],
  properties: {
    contextSummary: { type: ["string", "null"] },
    contextSummaryUpdatedAt: {
      type: ["string", "null"],
      format: "date-time",
    },
  },
} as const;

const attachChatMediaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["messageId", "taskId", "mediaType", "absolutePath", "mimeType"],
  properties: {
    messageId: { type: "string" },
    taskId: { type: "string" },
    mediaType: { type: "string", enum: ["audio", "image"] },
    absolutePath: { type: "string", minLength: 1 },
    mimeType: { type: "string", minLength: 1 },
  },
} as const;

const updateMessageMetadataSchema = {
  type: "object",
  additionalProperties: false,
  required: ["metadata"],
  properties: { metadata: { type: "object" } },
} as const;

const chatWorkspaceSchema = {
  type: "object",
  required: ["id", "name", "rootPath", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    rootPath: { type: ["string", "null"] },
    status: {
      type: "string",
      enum: ["active", "archived"],
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const createMessageBodySchema = {
  type: "object",
  required: ["role", "content"],
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      description: "Optional stable message identifier supplied by the client.",
    },
    parentId: {
      description:
        "Optional parent message identifier used to replace the tail during regenerate/edit flows.",
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    role: {
      type: "string",
      description: "Message author role.",
      enum: MESSAGE_ROLE_VALUES,
    },
    content: {
      type: "string",
      maxLength: MAX_MESSAGE_CONTENT_LENGTH,
      description: `Message text. Maximum content length is ${MAX_MESSAGE_CONTENT_LENGTH} characters.`,
    },
    parts: {
      type: "array",
      description:
        "Canonical message parts used to persist text and attachments together.",
      items: {
        anyOf: [
          {
            type: "object",
            required: ["type", "text"],
            additionalProperties: false,
            properties: {
              type: { const: "text" },
              text: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["type", "image"],
            additionalProperties: false,
            properties: {
              type: { const: "image" },
              image: { type: "string" },
              filename: { type: "string" },
              fileId: { type: "string" },
              mediaType: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["type", "data", "filename", "mimeType"],
            additionalProperties: false,
            properties: {
              type: { const: "file" },
              data: { type: "string" },
              filename: { type: "string" },
              fileId: { type: "string" },
              mimeType: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["type", "name", "value"],
            additionalProperties: false,
            properties: {
              type: { const: "data" },
              name: { type: "string" },
              value: {},
            },
          },
        ],
      },
    },
    metadata: {
      type: "object",
      description: "Free-form metadata preserved with the message.",
      additionalProperties: true,
    },
  },
} as const;

// OpenAPI route schemas grouped away from the handlers so thread routes remain
// focused on auth ownership, service calls, and response mapping.
export const threadRouteSchemas = {
  updateMessageMetadata: { body: updateMessageMetadataSchema },
  attachChatMedia: { body: attachChatMediaSchema },
  listThreads: {
    tags: ["Thread"],
    summary: "List threads",
    operationId: "listThreads",
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          description: "Filter by active or archived threads.",
          enum: ["active", "archived"],
        },
        sortBy: {
          type: "string",
          description: "Thread timestamp field used for ordering.",
          enum: ["createdAt", "updatedAt"],
        },
        sortOrder: {
          type: "string",
          description: "Sort direction.",
          enum: ["asc", "desc"],
        },
      },
    },
    response: {
      200: successEnvelope({
        type: "array",
        items: threadSchema,
      }),
      500: errorEnvelope,
    },
  },
  getThread: {
    tags: ["Thread"],
    summary: "Get thread detail with messages",
    operationId: "getThread",
    params: idParamsSchema,
    response: {
      200: successEnvelope(threadWithMessagesSchema),
      404: errorEnvelope,
      500: errorEnvelope,
    },
  },
  createThread: {
    tags: ["Thread"],
    summary: "Create a new thread",
    operationId: "createThread",
    body: threadMutationBodySchema,
    response: {
      200: successEnvelope(threadSchema),
      500: errorEnvelope,
    },
  },
  updateThread: {
    tags: ["Thread"],
    summary: "Update thread",
    operationId: "updateThread",
    params: idParamsSchema,
    body: threadMutationBodySchema,
    response: {
      200: successEnvelope(threadSchema),
      404: errorEnvelope,
      500: errorEnvelope,
    },
  },
  archiveThread: {
    tags: ["Thread"],
    summary: "Archive thread",
    operationId: "archiveThread",
    params: idParamsSchema,
    response: {
      200: successEnvelope(threadSchema),
      404: errorEnvelope,
      500: errorEnvelope,
    },
  },
  restoreThread: {
    tags: ["Thread"],
    summary: "Restore thread",
    operationId: "restoreThread",
    params: idParamsSchema,
    response: {
      200: successEnvelope(threadSchema),
      404: errorEnvelope,
      500: errorEnvelope,
    },
  },
  deleteThread: {
    tags: ["Thread"],
    summary: "Delete thread permanently",
    operationId: "deleteThread",
    params: idParamsSchema,
    response: {
      200: successEnvelope(deletedResponseSchema),
      404: errorEnvelope,
      500: errorEnvelope,
    },
  },
  cleanupThreads: {
    tags: ["Thread"],
    summary: "Delete the current user's conversation threads",
    operationId: "cleanupThreads",
    response: {
      200: successEnvelope({
        type: "object",
        required: ["deletedThreads", "deletedMessages", "failedThreads", "failedWorkdirs", "deletedWorkspaces", "clearedLogBytes"],
        properties: {
          deletedThreads: { type: "integer", minimum: 0 },
          deletedMessages: { type: "integer", minimum: 0 },
          failedThreads: { type: "integer", minimum: 0 },
          failedWorkdirs: { type: "integer", minimum: 0 },
          deletedWorkspaces: { type: "integer", minimum: 0 },
          clearedLogBytes: { type: "integer", minimum: 0 },
          media: {
            type: "object",
            required: ["attachments", "generatedImages", "generatedAudio", "generatedVideos"],
            properties: {
              attachments: {
                type: "object",
                required: ["files", "bytes"],
                properties: { files: { type: "integer", minimum: 0 }, bytes: { type: "integer", minimum: 0 } },
              },
              generatedImages: {
                type: "object",
                required: ["files", "bytes"],
                properties: { files: { type: "integer", minimum: 0 }, bytes: { type: "integer", minimum: 0 } },
              },
              generatedAudio: {
                type: "object",
                required: ["files", "bytes"],
                properties: { files: { type: "integer", minimum: 0 }, bytes: { type: "integer", minimum: 0 } },
              },
              generatedVideos: {
                type: "object",
                required: ["files", "bytes"],
                properties: { files: { type: "integer", minimum: 0 }, bytes: { type: "integer", minimum: 0 } },
              },
            },
          },
        },
      }),
      500: errorEnvelope,
    },
  },
  getMessages: {
    tags: ["Thread"],
    summary: "Get thread messages",
    operationId: "getThreadMessages",
    params: idParamsSchema,
    response: {
      200: successEnvelope({
        type: "array",
        items: messageSchema,
      }),
      500: errorEnvelope,
    },
  },
  createMessage: {
    tags: ["Thread"],
    summary: "Create a message in thread",
    operationId: "createMessage",
    params: idParamsSchema,
    body: createMessageBodySchema,
    response: {
      200: successEnvelope(messageSchema),
      400: errorEnvelope,
      500: errorEnvelope,
    },
  },
  deleteMessage: {
    tags: ["Thread"],
    summary: "Delete a message",
    operationId: "deleteMessage",
    params: idParamsSchema,
    response: {
      200: successEnvelope(deletedResponseSchema),
      404: errorEnvelope,
      500: errorEnvelope,
    },
  },
  generateContextSummary: {
    tags: ["Thread"],
    summary: "Generate thread context summary",
    operationId: "generateThreadContextSummary",
    params: idParamsSchema,
    response: {
      200: successEnvelope(threadContextSummarySchema),
      404: errorEnvelope,
      500: errorEnvelope,
    },
  },
  listChatWorkspaces: {
    tags: ["Thread"],
    summary: "List chat workspaces",
    operationId: "listChatWorkspaces",
    response: {
      200: successEnvelope({
        type: "array",
        items: chatWorkspaceSchema,
      }),
      500: errorEnvelope,
    },
  },
  createChatWorkspace: {
    tags: ["Thread"],
    summary: "Create chat workspace",
    operationId: "createChatWorkspace",
    body: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        rootPath: { type: ["string", "null"] },
      },
    },
    response: {
      200: successEnvelope(chatWorkspaceSchema),
      500: errorEnvelope,
    },
  },
  updateChatWorkspace: {
    tags: ["Thread"],
    summary: "Update chat workspace",
    operationId: "updateChatWorkspace",
    params: idParamsSchema,
    body: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        rootPath: { type: ["string", "null"] },
      },
    },
    response: {
      200: successEnvelope(chatWorkspaceSchema),
      404: errorEnvelope,
      500: errorEnvelope,
    },
  },
  deleteChatWorkspace: {
    tags: ["Thread"],
    summary: "Delete chat workspace",
    operationId: "deleteChatWorkspace",
    params: idParamsSchema,
    response: {
      200: successEnvelope(deletedResponseSchema),
      404: errorEnvelope,
      500: errorEnvelope,
    },
  },
} as const;
