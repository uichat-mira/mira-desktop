import type { FastifyInstance } from "fastify";
import { chatWorkspaceRepository } from "@/db/repositories/chat-workspace.repository.js";
import {
  remoteWorkspaceThreadRepository,
  type RemoteWorkspaceThreadCursor,
  type RemoteWorkspaceThreadStatus,
} from "@/db/repositories/remote-workspace-thread.repository.js";
import { errorEnvelope, successEnvelope } from "@/routes/schema-helpers.js";
import { success } from "@/utils/index.js";
import {
  badRequest,
  forbidden,
  notFound,
  routeHandler,
} from "@/utils/route-errors.js";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

const remoteThreadSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "title",
    "modelName",
    "workspaceId",
    "knowledgeBaseId",
    "roleId",
    "agentEnabled",
    "status",
    "createdAt",
    "updatedAt",
    "messageCount",
  ],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    modelName: { type: ["string", "null"] },
    workspaceId: { type: ["string", "null"] },
    knowledgeBaseId: { type: ["string", "null"] },
    roleId: { type: ["string", "null"] },
    agentEnabled: { type: "boolean" },
    status: { type: "string", enum: ["active", "archived"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    messageCount: { type: "integer", minimum: 0 },
    lastMessage: { type: "string" },
  },
} as const;

const pageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "total", "nextCursor", "limit"],
  properties: {
    items: { type: "array", items: remoteThreadSchema },
    total: { type: "integer", minimum: 0 },
    nextCursor: { type: ["string", "null"] },
    limit: { type: "integer", minimum: 1, maximum: MAX_PAGE_LIMIT },
  },
} as const;

const encodeCursor = (cursor: RemoteWorkspaceThreadCursor) =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

const decodeCursor = (value: string): RemoteWorkspaceThreadCursor => {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<RemoteWorkspaceThreadCursor>;

    if (
      typeof parsed.updatedAt !== "string" ||
      !parsed.updatedAt ||
      Number.isNaN(Date.parse(parsed.updatedAt)) ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error("invalid cursor payload");
    }

    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch (error) {
    throw badRequest("Invalid workspace thread cursor", { cause: error });
  }
};

const toRemoteThread = (thread: {
  id: string;
  title: string;
  modelName: string | null;
  workspaceId: string | null;
  knowledgeBaseId: string | null;
  roleId: string | null;
  agentEnabled: boolean | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessageContent: string | null;
}) => {
  const lastMessage = thread.lastMessageContent
    ? thread.lastMessageContent.substring(0, 50) +
      (thread.lastMessageContent.length > 50 ? "..." : "")
    : undefined;

  return {
    id: thread.id,
    title: thread.title || "新对话",
    modelName: thread.modelName ?? null,
    workspaceId: thread.workspaceId ?? null,
    knowledgeBaseId: thread.knowledgeBaseId ?? null,
    roleId: thread.roleId ?? null,
    agentEnabled: thread.agentEnabled ?? false,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: Number(thread.messageCount ?? 0),
    ...(lastMessage ? { lastMessage } : {}),
  };
};

export const registerWorkspaceThreadPageRoutes = async (app: FastifyInstance) => {
  app.get<{
    Params: { workspaceId: string };
    Querystring: {
      status?: RemoteWorkspaceThreadStatus;
      cursor?: string;
      limit?: number;
    };
  }>(
    "/remote/v1/workspaces/:workspaceId/threads",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "List a workspace's threads with stable cursor pagination",
        operationId: "listRemoteWorkspaceThreads",
        params: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: {
            workspaceId: { type: "string", minLength: 1 },
          },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["active", "archived"] },
            cursor: { type: "string", minLength: 1, maxLength: 1024 },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: MAX_PAGE_LIMIT,
              default: DEFAULT_PAGE_LIMIT,
            },
          },
        },
        response: {
          200: successEnvelope(pageSchema),
          400: errorEnvelope,
          401: errorEnvelope,
          403: errorEnvelope,
          404: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to list remote workspace threads", async (request) => {
      const user = request.authUser;
      if (!(request.remoteDevice || request.cloudRemoteCaller) || !user) {
        throw forbidden("A paired remote device credential is required");
      }

      const workspace = chatWorkspaceRepository.findById(
        request.params.workspaceId,
        user.id,
      );
      if (!workspace) {
        throw notFound("Workspace not found");
      }

      const status = request.query.status ?? "active";
      const limit = Math.min(
        Math.max(request.query.limit ?? DEFAULT_PAGE_LIMIT, 1),
        MAX_PAGE_LIMIT,
      );
      const cursor = request.query.cursor
        ? decodeCursor(request.query.cursor)
        : undefined;

      const rows = remoteWorkspaceThreadRepository.listPage({
        userId: user.id,
        workspaceId: workspace.id,
        status,
        limit: limit + 1,
        cursor,
      });
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(toRemoteThread);
      const lastItem = items[items.length - 1];
      const nextCursor =
        hasMore && lastItem
          ? encodeCursor({ updatedAt: lastItem.updatedAt, id: lastItem.id })
          : null;
      const total = remoteWorkspaceThreadRepository.count({
        userId: user.id,
        workspaceId: workspace.id,
        status,
      });

      return success({ items, total, nextCursor, limit });
    }),
  );
};
