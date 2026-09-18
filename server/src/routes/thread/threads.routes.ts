import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { threadService } from "@/services/thread.service";
import { logFilesService } from "@/services/log-files.service.js";
import { managedMediaCleanupService } from "@/services/managed-media-cleanup.service.js";
import { chatMediaService } from "@/services/chat-media.service.js";
import {
  success,
  THREAD_NOT_FOUND_MESSAGE,
} from "@/utils/index.js";
import { notFound, routeHandler } from "@/utils/route-errors.js";
import { isThreadAccessError } from "./access.js";
import { threadRouteSchemas } from "./schemas.js";
import type {
  ChatWorkspaceMutationBody,
  ThreadListQuery,
  ThreadMutationBody,
} from "./types.js";

export const registerThreadRoutes = async (app: FastifyInstance) => {
  const debugLogPath = path.resolve(
    process.cwd(),
    ".artifacts",
    "thread-update-debug.log",
  );

  app.get<{ Querystring: ThreadListQuery }>(
    "/threads",
    { schema: threadRouteSchemas.listThreads },
    routeHandler("Failed to list threads", async (request) => {
      try {
        const userId = request.authUser!.id;
        const filters = {
          userId,
          status: request.query.status,
          sortBy: request.query.sortBy,
          sortOrder: request.query.sortOrder,
        };
        return success(threadService.listThreads(filters));
      } catch (err) {
        if (isThreadAccessError(err)) {
          throw notFound(THREAD_NOT_FOUND_MESSAGE, { cause: err });
        }
        throw err;
      }
    }),
  );

  app.get<{ Params: { id: string } }>(
    "/threads/:id",
    { schema: threadRouteSchemas.getThread },
    routeHandler("Failed to get thread", async (request) => {
      const userId = request.authUser!.id;
      const result = threadService.getThreadById(request.params.id, userId);
      if (!result) {
        throw notFound(THREAD_NOT_FOUND_MESSAGE);
      }
      return success(result);
    }),
  );

  app.post<{ Body: ThreadMutationBody }>(
    "/threads",
    { schema: threadRouteSchemas.createThread },
    routeHandler("Failed to create thread", async (request) => {
      const userId = request.authUser!.id;
      const result = threadService.createThread({
        userId,
        ...request.body,
      });
      return success(result, "Thread created");
    }),
  );

  app.patch<{ Params: { id: string }; Body: ThreadMutationBody }>(
    "/threads/:id",
    { schema: threadRouteSchemas.updateThread },
    routeHandler("Failed to update thread", async (request) => {
      const userId = request.authUser!.id;
      try {
        request.log.info(
          {
            scope: "thread",
            event: "update-thread-start",
            threadId: request.params.id,
            userId,
            body: request.body,
          },
          "[thread] update thread request received",
        );

        const result = threadService.updateThread(
          request.params.id,
          userId,
          request.body,
        );
        if (!result) {
          throw notFound(THREAD_NOT_FOUND_MESSAGE);
        }

        request.log.info(
          {
            scope: "thread",
            event: "update-thread-success",
            threadId: request.params.id,
            userId,
            result,
          },
          "[thread] update thread request succeeded",
        );

        return success(result, "Thread updated");
      } catch (error) {
        await fs.mkdir(path.dirname(debugLogPath), { recursive: true });
        await fs.appendFile(
          debugLogPath,
          `${JSON.stringify(
            {
              at: new Date().toISOString(),
              threadId: request.params.id,
              userId,
              body: request.body,
              error:
                error instanceof Error
                  ? {
                      name: error.name,
                      message: error.message,
                      stack: error.stack,
                    }
                  : String(error),
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        request.log.error(
          {
            scope: "thread",
            event: "update-thread-error",
            threadId: request.params.id,
            userId,
            body: request.body,
            err: error,
          },
          "[thread] update thread request failed",
        );
        throw error;
      }
    }),
  );

  app.post<{ Params: { id: string } }>(
    "/threads/:id/context-summary",
    { schema: threadRouteSchemas.generateContextSummary },
    routeHandler("Failed to generate thread context summary", async (request) => {
      const userId = request.authUser!.id;
      const result = await threadService.generateContextSummary(request.params.id, userId);
      if (!result) {
        throw notFound(THREAD_NOT_FOUND_MESSAGE);
      }
      return success(result, "Thread context summary generated");
    }),
  );

  app.post<{ Params: { id: string } }>(
    "/threads/:id/archive",
    { schema: threadRouteSchemas.archiveThread },
    routeHandler("Failed to archive thread", async (request) => {
      const userId = request.authUser!.id;
      const result = threadService.archiveThread(request.params.id, userId);
      if (!result) {
        throw notFound(THREAD_NOT_FOUND_MESSAGE);
      }
      return success(result, "Thread archived");
    }),
  );

  app.post<{ Params: { id: string } }>(
    "/threads/:id/restore",
    { schema: threadRouteSchemas.restoreThread },
    routeHandler("Failed to restore thread", async (request) => {
      const userId = request.authUser!.id;
      const result = threadService.restoreThread(request.params.id, userId);
      if (!result) {
        throw notFound(THREAD_NOT_FOUND_MESSAGE);
      }
      return success(result, "Thread restored");
    }),
  );

  app.delete(
    "/threads/history",
    { schema: threadRouteSchemas.cleanupThreads },
    routeHandler("Failed to clean conversation threads", async (request) => {
      const threadResult = threadService.cleanupThreads(request.authUser!.id);
      if (threadResult.failedWorkdirs > 0) {
        throw new Error(
          `Failed to clean ${threadResult.failedWorkdirs} conversation workdir(s)`,
        );
      }
      const logResult = await logFilesService.clearLogs();
      const mediaResult = await managedMediaCleanupService.clear();
      const clearedLogBytes = logResult.clearedFiles.reduce(
        (total, file) => total + file.previousSize,
        0,
      );
      return success(
        {
          ...threadResult,
          clearedLogBytes,
          media: mediaResult,
        },
        "Conversations, conversation workdirs, server logs, and media cleaned",
      );
    }),
  );

  app.delete<{ Params: { id: string } }>(
    "/threads/:id",
    { schema: threadRouteSchemas.deleteThread },
    routeHandler("Failed to delete thread", async (request) => {
      try {
        const userId = request.authUser!.id;
        const deleted = threadService.deleteThread(request.params.id, userId);
        if (!deleted) {
          throw notFound(THREAD_NOT_FOUND_MESSAGE);
        }
        return success({ deleted: true }, "Thread deleted");
      } catch (err) {
        if (isThreadAccessError(err)) {
          throw notFound(THREAD_NOT_FOUND_MESSAGE, { cause: err });
        }
        throw err;
      }
    }),
  );

  app.post<{
    Params: { id: string };
    Body: { messageId: string; taskId: string; mediaType: "audio" | "image"; absolutePath: string; mimeType: string };
  }>("/threads/:id/media", { schema: threadRouteSchemas.attachChatMedia }, routeHandler("Failed to attach chat media", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as { messageId: string; taskId: string; mediaType: "audio" | "image"; absolutePath: string; mimeType: string };
    const thread = threadService.getThreadById(params.id, request.authUser!.id);
    if (!thread) throw notFound(THREAD_NOT_FOUND_MESSAGE);
    return success(await chatMediaService.attach({ threadId: params.id, ...body }), "Chat media attached");
  }));

  app.get<{ Params: { id: string; mediaId: string } }>(
    "/threads/:id/media/:mediaId/content",
    routeHandler("Failed to read chat media", async (request, reply) => {
      const params = request.params as { id: string; mediaId: string };
      const media = chatMediaService.getForThreadRead(params.mediaId, params.id, request.authUser!.id);
      if (!media) throw notFound("Chat media not found");
      reply.header("Cache-Control", "no-store");
      reply.type(media.mimeType || "application/octet-stream");
      return reply.send(await fs.readFile(media.absolutePath));
    }),
  );

  app.get(
    "/chat-workspaces",
    { schema: threadRouteSchemas.listChatWorkspaces },
    routeHandler("Failed to list chat workspaces", async (request) => {
      return success(threadService.listChatWorkspaces(request.authUser!.id));
    }),
  );

  app.post<{ Body: ChatWorkspaceMutationBody }>(
    "/chat-workspaces",
    { schema: threadRouteSchemas.createChatWorkspace },
    routeHandler("Failed to create chat workspace", async (request) => {
      const result = threadService.createChatWorkspace({
        userId: request.authUser!.id,
        name: request.body.name ?? "",
        rootPath: request.body.rootPath ?? null,
      });
      return success(result, "Workspace created");
    }),
  );

  app.patch<{ Params: { id: string }; Body: ChatWorkspaceMutationBody }>(
    "/chat-workspaces/:id",
    { schema: threadRouteSchemas.updateChatWorkspace },
    routeHandler("Failed to update chat workspace", async (request) => {
      const result = threadService.updateChatWorkspace(
        request.params.id,
        request.authUser!.id,
        request.body,
      );
      if (!result) {
        throw notFound(THREAD_NOT_FOUND_MESSAGE);
      }

      return success(result, "Workspace updated");
    }),
  );

  app.delete<{ Params: { id: string } }>(
    "/chat-workspaces/:id",
    { schema: threadRouteSchemas.deleteChatWorkspace },
    routeHandler("Failed to delete chat workspace", async (request) => {
      const deleted = threadService.deleteChatWorkspace(
        request.params.id,
        request.authUser!.id,
      );
      if (!deleted) {
        throw notFound(THREAD_NOT_FOUND_MESSAGE);
      }

      return success({ deleted: true }, "Workspace deleted");
    }),
  );
};
