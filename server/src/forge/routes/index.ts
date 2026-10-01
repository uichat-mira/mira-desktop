import type { FastifyPluginAsync } from "fastify";
import { success } from "@/utils/index.js";
import { routeHandler } from "@/utils/route-errors.js";
import {
  getDefaultForgeRouteService,
  type ForgeRouteService,
} from "./service.js";

const projectParams = {
  type: "object",
  required: ["projectId"],
  properties: { projectId: { type: "string", minLength: 1 } },
} as const;

const batchParams = {
  type: "object",
  required: ["batchId"],
  properties: { batchId: { type: "string", minLength: 1 } },
} as const;

const threadParams = {
  type: "object",
  required: ["threadId"],
  properties: { threadId: { type: "string", minLength: 1 } },
} as const;

const reviewParams = {
  type: "object",
  required: ["reviewId"],
  properties: { reviewId: { type: "string", minLength: 1 } },
} as const;

const dispatchParams = {
  type: "object",
  required: ["dispatchId"],
  properties: { dispatchId: { type: "string", minLength: 1 } },
} as const;

const projectTaskParams = {
  type: "object",
  required: ["projectId", "taskId"],
  properties: {
    projectId: { type: "string", minLength: 1 },
    taskId: { type: "string", minLength: 1 },
  },
} as const;

const threadTaskParams = {
  type: "object",
  required: ["threadId", "taskId"],
  properties: {
    threadId: { type: "string", minLength: 1 },
    taskId: { type: "string", minLength: 1 },
  },
} as const;

const batchTaskParams = {
  type: "object",
  required: ["batchId", "taskId"],
  properties: {
    batchId: { type: "string", minLength: 1 },
    taskId: { type: "string", minLength: 1 },
  },
} as const;

const security = [{ bearerAuth: [] }] as const;

export interface ForgeRoutesOptions {
  getService?: () => Promise<ForgeRouteService>;
}

const forgeRoutes: FastifyPluginAsync<ForgeRoutesOptions> = async (
  app,
  options,
) => {
  const service = options.getService ?? getDefaultForgeRouteService;
  const useService = () => service();

  app.get(
    "/forge/meta",
    { schema: { tags: ["Tools"], security } },
    routeHandler("Failed to load Forge metadata", async () => {
      const api = await useService();
      return success(api.meta());
    }),
  );

  app.get<{
    Querystring: {
      projectId?: string;
      batchId?: string;
      taskId?: string;
      status?: string;
    };
  }>(
    "/forge/dispatches",
    {
      schema: {
        tags: ["Tools"],
        security,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            projectId: { type: "string" },
            batchId: { type: "string" },
            taskId: { type: "string" },
            status: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to list Forge dispatches", async (request) => {
      const api = await useService();
      return success(await api.listDispatches(request.query));
    }),
  );

  app.get(
    "/forge/projects",
    { schema: { tags: ["Tools"], security } },
    routeHandler("Failed to list Forge projects", async () => {
      const api = await useService();
      return success(await api.listProjects());
    }),
  );

  app.post<{
    Body: {
      id?: string;
      name: string;
      rootPath: string;
      repository?: string | null;
      integrationBranch?: string;
      taskLedger?: string | null;
      taskDir?: string | null;
    };
  }>(
    "/forge/projects",
    {
      schema: {
        tags: ["Tools"],
        security,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "rootPath"],
          properties: {
            id: { type: "string" },
            name: { type: "string", minLength: 1 },
            rootPath: { type: "string", minLength: 1 },
            repository: { type: ["string", "null"] },
            integrationBranch: { type: "string" },
            taskLedger: { type: ["string", "null"] },
            taskDir: { type: ["string", "null"] },
          },
        },
      },
    },
    routeHandler("Failed to register Forge project", async (request, reply) => {
      const api = await useService();
      const result = await api.registerProject(request.body);
      reply.code(201);
      return success(result);
    }),
  );

  app.get<{ Params: { projectId: string } }>(
    "/forge/projects/:projectId",
    { schema: { tags: ["Tools"], security, params: projectParams } },
    routeHandler("Failed to load Forge project", async (request) => {
      const api = await useService();
      return success(await api.getProject(request.params.projectId));
    }),
  );

  app.patch<{
    Params: { projectId: string };
    Body: {
      name?: string;
      repository?: string | null;
      integrationBranch?: string;
      taskLedger?: string | null;
      taskDir?: string | null;
    };
  }>(
    "/forge/projects/:projectId",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            repository: { type: ["string", "null"] },
            integrationBranch: { type: "string" },
            taskLedger: { type: ["string", "null"] },
            taskDir: { type: ["string", "null"] },
          },
        },
      },
    },
    routeHandler("Failed to update Forge project", async (request) => {
      const api = await useService();
      return success(
        await api.updateProject(request.params.projectId, request.body),
      );
    }),
  );

  app.get<{ Params: { projectId: string } }>(
    "/forge/projects/:projectId/task-source",
    { schema: { tags: ["Tools"], security, params: projectParams } },
    routeHandler("Failed to inspect Forge task source", async (request) => {
      const api = await useService();
      return success(await api.inspectTaskSource(request.params.projectId));
    }),
  );

  app.patch<{
    Params: { projectId: string };
    Body: { taskLedger: string | null; taskDir: string | null };
  }>(
    "/forge/projects/:projectId/task-source",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["taskLedger", "taskDir"],
          properties: {
            taskLedger: { type: ["string", "null"] },
            taskDir: { type: ["string", "null"] },
          },
        },
      },
    },
    routeHandler("Failed to configure Forge task source", async (request) => {
      const api = await useService();
      return success(
        await api.updateProject(request.params.projectId, request.body),
      );
    }),
  );

  app.get<{ Params: { projectId: string } }>(
    "/forge/projects/:projectId/tasks",
    { schema: { tags: ["Tools"], security, params: projectParams } },
    routeHandler("Failed to list repository tasks", async (request) => {
      const api = await useService();
      return success(await api.inspectTaskSource(request.params.projectId));
    }),
  );

  app.post<{
    Params: { projectId: string };
    Body: {
      id: string;
      title: string;
      status?: string;
      body?: string;
      content?: string;
    };
  }>(
    "/forge/projects/:projectId/tasks",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["id", "title"],
          properties: {
            id: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 },
            status: { type: "string" },
            body: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to create repository task", async (request, reply) => {
      const api = await useService();
      const result = await api.createTask(
        request.params.projectId,
        request.body,
      );
      reply.code(201);
      return success(result);
    }),
  );

  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/forge/projects/:projectId/tasks/:taskId",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: projectTaskParams,
      },
    },
    routeHandler("Failed to resolve repository task", async (request) => {
      const api = await useService();
      return success(
        await api.resolveTask(
          request.params.projectId,
          request.params.taskId,
        ),
      );
    }),
  );

  app.patch<{
    Params: { projectId: string; taskId: string };
    Body: { title?: string; status?: string; content?: string };
  }>(
    "/forge/projects/:projectId/tasks/:taskId",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: projectTaskParams,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            status: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to update repository task", async (request) => {
      const api = await useService();
      return success(
        await api.updateTask(
          request.params.projectId,
          request.params.taskId,
          request.body,
        ),
      );
    }),
  );

  app.get<{ Querystring: { projectId?: string } }>(
    "/forge/batches",
    {
      schema: {
        tags: ["Tools"],
        security,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { projectId: { type: "string" } },
        },
      },
    },
    routeHandler("Failed to list Forge batches", async (request) => {
      const api = await useService();
      return success(await api.listBatches(request.query.projectId));
    }),
  );

  app.post<{
    Params: { projectId: string };
    Body: { name?: string; taskIds: string[] };
  }>(
    "/forge/projects/:projectId/batches",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: projectParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["taskIds"],
          properties: {
            name: { type: "string" },
            taskIds: {
              type: "array",
              minItems: 1,
              items: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
    routeHandler("Failed to create Forge batch", async (request, reply) => {
      const api = await useService();
      const result = await api.createBatch(
        request.params.projectId,
        request.body,
      );
      reply.code(201);
      return success(result);
    }),
  );

  app.get<{ Params: { batchId: string } }>(
    "/forge/batches/:batchId",
    { schema: { tags: ["Tools"], security, params: batchParams } },
    routeHandler("Failed to load Forge batch", async (request) => {
      const api = await useService();
      return success(await api.getBatch(request.params.batchId));
    }),
  );

  app.get<{ Params: { batchId: string } }>(
    "/forge/batches/:batchId/readiness",
    { schema: { tags: ["Tools"], security, params: batchParams } },
    routeHandler("Failed to load Forge dispatch readiness", async (request) => {
      const api = await useService();
      return success(await api.readiness(request.params.batchId));
    }),
  );

  app.get<{ Querystring: { projectId?: string } }>(
    "/forge/threads",
    {
      schema: {
        tags: ["Tools"],
        security,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { projectId: { type: "string" } },
        },
      },
    },
    routeHandler("Failed to list Forge Main Threads", async (request) => {
      const api = await useService();
      return success(await api.mainThread.listThreads(request.query.projectId));
    }),
  );

  app.post<{
    Body: {
      id?: string;
      projectId: string;
      adapter: "opencode" | "codex-desktop" | "codex";
      title?: string;
      model?: string;
    };
  }>(
    "/forge/threads",
    {
      schema: {
        tags: ["Tools"],
        security,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["projectId", "adapter"],
          properties: {
            id: { type: "string" },
            projectId: { type: "string", minLength: 1 },
            adapter: {
              type: "string",
              enum: ["opencode", "codex-desktop", "codex"],
            },
            title: { type: "string" },
            model: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to open Forge Main Thread", async (request, reply) => {
      const api = await useService();
      const result = await api.mainThread.openThread(request.body);
      reply.code(201);
      return success(result);
    }),
  );

  app.get<{ Params: { threadId: string } }>(
    "/forge/threads/:threadId",
    { schema: { tags: ["Tools"], security, params: threadParams } },
    routeHandler("Failed to load Forge Main Thread", async (request) => {
      const api = await useService();
      return success(await api.mainThread.getThread(request.params.threadId));
    }),
  );

  app.post<{
    Params: { threadId: string };
    Body: { message: string; model?: string };
  }>(
    "/forge/threads/:threadId/messages",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: threadParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1 },
            model: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to send Forge Main Thread message", async (request) => {
      const api = await useService();
      return success(
        await api.mainThread.sendMessage(
          request.params.threadId,
          request.body,
        ),
      );
    }),
  );

  app.get<{ Params: { threadId: string } }>(
    "/forge/threads/:threadId/tasks",
    { schema: { tags: ["Tools"], security, params: threadParams } },
    routeHandler("Failed to inspect Main Thread tasks", async (request) => {
      const api = await useService();
      return success(await api.mainThread.inspectTasks(request.params.threadId));
    }),
  );

  app.post<{
    Params: { threadId: string };
    Body: {
      id: string;
      title: string;
      status?: string;
      body?: string;
      content?: string;
    };
  }>(
    "/forge/threads/:threadId/tasks",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: threadParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["id", "title"],
          properties: {
            id: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 },
            status: { type: "string" },
            body: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to create Main Thread task", async (request, reply) => {
      const api = await useService();
      const result = await api.mainThread.createTask(
        request.params.threadId,
        request.body,
      );
      reply.code(201);
      return success(result);
    }),
  );

  app.get<{ Params: { threadId: string; taskId: string } }>(
    "/forge/threads/:threadId/tasks/:taskId",
    { schema: { tags: ["Tools"], security, params: threadTaskParams } },
    routeHandler("Failed to resolve Main Thread task", async (request) => {
      const api = await useService();
      return success(
        await api.mainThread.resolveTask(
          request.params.threadId,
          request.params.taskId,
        ),
      );
    }),
  );

  app.patch<{
    Params: { threadId: string; taskId: string };
    Body: { title?: string; status?: string; content?: string };
  }>(
    "/forge/threads/:threadId/tasks/:taskId",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: threadTaskParams,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            status: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to update Main Thread task", async (request) => {
      const api = await useService();
      return success(
        await api.mainThread.updateTask(
          request.params.threadId,
          request.params.taskId,
          request.body,
        ),
      );
    }),
  );

  app.post<{
    Params: { threadId: string };
    Body: { taskId: string; taskRef?: string; preferredBuilder: string };
  }>(
    "/forge/threads/:threadId/handoffs",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: threadParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["taskId", "preferredBuilder"],
          properties: {
            taskId: { type: "string", minLength: 1 },
            taskRef: { type: "string" },
            preferredBuilder: { type: "string", minLength: 1 },
          },
        },
      },
    },
    routeHandler("Failed to create Forge handoff", async (request, reply) => {
      const api = await useService();
      const result = await api.mainThread.createHandoff(
        request.params.threadId,
        request.body,
      );
      reply.code(201);
      return success(result);
    }),
  );

  app.post<{
    Params: { batchId: string; taskId: string };
    Body: {
      adapterId?: string;
      builder?: string;
      preferredBuilder?: string;
      sourceThreadId?: string;
      prompt?: string;
      taskRef?: string;
      model?: string;
      agent?: string;
    };
  }>(
    "/forge/batches/:batchId/tasks/:taskId/dispatch",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: batchTaskParams,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            adapterId: { type: "string" },
            builder: { type: "string" },
            preferredBuilder: { type: "string" },
            sourceThreadId: { type: "string" },
            prompt: { type: "string" },
            taskRef: { type: "string" },
            model: { type: "string" },
            agent: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to dispatch Forge Builder", async (request, reply) => {
      const api = await useService();
      const result = await api.dispatch.dispatchTask({
        ...request.body,
        batchId: request.params.batchId,
        taskId: request.params.taskId,
      });
      reply.code(202);
      return success(result);
    }),
  );

  app.post<{ Params: { dispatchId: string } }>(
    "/forge/dispatches/:dispatchId/cancel",
    { schema: { tags: ["Tools"], security, params: dispatchParams } },
    routeHandler("Failed to cancel Forge dispatch", async (request) => {
      const api = await useService();
      return success(
        await api.dispatch.cancelDispatch(request.params.dispatchId),
      );
    }),
  );

  app.get<{
    Querystring: { projectId?: string; batchId?: string; taskId?: string };
  }>(
    "/forge/reviews",
    {
      schema: {
        tags: ["Tools"],
        security,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            projectId: { type: "string" },
            batchId: { type: "string" },
            taskId: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to list Forge reviews", async (request) => {
      const api = await useService();
      return success(await api.listReviews(request.query));
    }),
  );

  app.post<{
    Body: {
      projectId: string;
      batchId: string;
      taskId: string;
      reviewerSessionId: string;
      requestedSha: string;
    };
  }>(
    "/forge/reviews",
    {
      schema: {
        tags: ["Tools"],
        security,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "projectId",
            "batchId",
            "taskId",
            "reviewerSessionId",
            "requestedSha",
          ],
          properties: {
            projectId: { type: "string", minLength: 1 },
            batchId: { type: "string", minLength: 1 },
            taskId: { type: "string", minLength: 1 },
            reviewerSessionId: { type: "string", minLength: 1 },
            requestedSha: { type: "string", minLength: 1 },
          },
        },
      },
    },
    routeHandler("Failed to request Forge review", async (request, reply) => {
      const api = await useService();
      const result = await api.review.requestReview(request.body);
      reply.code(201);
      return success(result);
    }),
  );

  app.post<{
    Params: { reviewId: string };
    Body: {
      result: "passed" | "changes_requested" | "failed" | "cancelled";
      reviewedSha?: string;
    };
  }>(
    "/forge/reviews/:reviewId/result",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: reviewParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["result"],
          properties: {
            result: {
              type: "string",
              enum: ["passed", "changes_requested", "failed", "cancelled"],
            },
            reviewedSha: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to resolve Forge review", async (request) => {
      const api = await useService();
      return success(
        await api.review.resolveReview(
          request.params.reviewId,
          request.body,
        ),
      );
    }),
  );

  app.post<{
    Params: { batchId: string; taskId: string };
    Body: { projectId: string; expectedSha: string };
  }>(
    "/forge/batches/:batchId/tasks/:taskId/integrate",
    {
      schema: {
        tags: ["Tools"],
        security,
        params: batchTaskParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["projectId", "expectedSha"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            expectedSha: { type: "string", minLength: 1 },
          },
        },
      },
    },
    routeHandler("Failed to integrate reviewed Forge task", async (request) => {
      const api = await useService();
      return success(
        await api.review.integrateTask({
          projectId: request.body.projectId,
          batchId: request.params.batchId,
          taskId: request.params.taskId,
          expectedSha: request.body.expectedSha,
        }),
      );
    }),
  );

  app.get(
    "/forge/runtime/summary",
    { schema: { tags: ["Tools"], security } },
    routeHandler("Failed to load Forge runtime summary", async () => {
      const api = await useService();
      return success(await api.runtimeSummary());
    }),
  );

  app.get<{
    Querystring: {
      projectId?: string;
      batchId?: string;
      taskId?: string;
      dispatchId?: string;
      sessionId?: string;
      reviewId?: string;
      threadId?: string;
    };
  }>(
    "/forge/inspector",
    {
      schema: {
        tags: ["Tools"],
        security,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            projectId: { type: "string" },
            batchId: { type: "string" },
            taskId: { type: "string" },
            dispatchId: { type: "string" },
            sessionId: { type: "string" },
            reviewId: { type: "string" },
            threadId: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to load Forge inspector", async (request) => {
      const api = await useService();
      return success(await api.inspector(request.query));
    }),
  );

  app.get<{
    Querystring: {
      projectId?: string;
      batchId?: string;
      taskId?: string;
      dispatchId?: string;
      sessionId?: string;
    };
  }>(
    "/forge/events",
    {
      schema: {
        tags: ["Tools"],
        security,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            projectId: { type: "string" },
            batchId: { type: "string" },
            taskId: { type: "string" },
            dispatchId: { type: "string" },
            sessionId: { type: "string" },
          },
        },
      },
    },
    routeHandler("Failed to load Forge runtime events", async (request) => {
      const api = await useService();
      return success(await api.events(request.query));
    }),
  );

};

export default forgeRoutes;
