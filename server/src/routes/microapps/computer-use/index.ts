import type { FastifyPluginAsync } from "fastify";
import type { ComputerUseRuntimeState } from "@/microapps/computer-use/index.js";
import { success } from "@/utils/index.js";
import {
  badRequest,
  notFound,
  routeHandler,
} from "@/utils/route-errors.js";
import { computerUseRouteSchemas } from "./schemas.js";
import type { ComputerUseDebuggerService } from "./debugger-service.js";

export type ComputerUseRuntimeRouteService = {
  getRuntimeState(): Promise<ComputerUseRuntimeState>;
  installRuntime(request?: { force?: boolean }): Promise<ComputerUseRuntimeState>;
};

export type ComputerUseRouteOptions = {
  computerUseRuntimeService: ComputerUseRuntimeRouteService;
  computerUseDebuggerService?: ComputerUseDebuggerService;
};

const mapComputerUseError = (error: unknown): never => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("http/https") ||
      message.includes("sha-256") ||
      message.includes("managed runtime directory") ||
      message.includes("absolute entry path") ||
      message.includes("executablerelativepath")
    ) {
      throw badRequest(error.message, { cause: error });
    }
  }

  throw error;
};

const computerUseRoutes: FastifyPluginAsync<ComputerUseRouteOptions> = async (
  app,
  options,
) => {
  const { computerUseRuntimeService } = options;
  const { computerUseDebuggerService } = options;

  if (computerUseDebuggerService) {
  app.get(
    "/microapps/computer-use/debugger/status",
    routeHandler("Failed to get Computer Use debugger status", async () =>
      success(computerUseDebuggerService.getStatus()),
    ),
  );

  app.post<{ Body: Parameters<ComputerUseDebuggerService["create"]>[0] }>(
    "/microapps/computer-use/sessions",
    { schema: computerUseRouteSchemas.debuggerCreateSession },
    routeHandler<{ Body: Parameters<ComputerUseDebuggerService["create"]>[0] }>("Failed to create Computer Use browser session", async (request) =>
      success(await computerUseDebuggerService.create(request.body)),
    ),
  );

  app.get<{ Params: { id: string } }>(
    "/microapps/computer-use/sessions/:id",
    { schema: computerUseRouteSchemas.debuggerSession },
    routeHandler<{ Params: { id: string } }>("Failed to get Computer Use browser session", async (request) => {
      const session = computerUseDebuggerService.get(request.params.id);
      if (!session) throw notFound(`Computer Use browser session was not found: ${request.params.id}`);
      return success(session);
    }),
  );

  app.post<{ Params: { id: string } }>(
    "/microapps/computer-use/sessions/:id/observe",
    { schema: computerUseRouteSchemas.debuggerSession },
    routeHandler<{ Params: { id: string } }>("Failed to observe Computer Use browser session", async (request) =>
      success(await computerUseDebuggerService.observe(request.params.id)),
    ),
  );

  app.post<{ Params: { id: string }; Body: Parameters<ComputerUseDebuggerService["act"]>[1] }>(
    "/microapps/computer-use/sessions/:id/action",
    { schema: computerUseRouteSchemas.debuggerAction },
    routeHandler<{ Params: { id: string }; Body: Parameters<ComputerUseDebuggerService["act"]>[1] }>("Failed to act on Computer Use browser session", async (request) =>
      success(await computerUseDebuggerService.act(request.params.id, request.body)),
    ),
  );

  app.post<{ Params: { id: string }; Body: Parameters<ComputerUseDebuggerService["assert"]>[1] }>(
    "/microapps/computer-use/sessions/:id/assert",
    { schema: computerUseRouteSchemas.debuggerAssertion },
    routeHandler<{ Params: { id: string }; Body: Parameters<ComputerUseDebuggerService["assert"]>[1] }>("Failed to assert Computer Use browser session", async (request) =>
      success(await computerUseDebuggerService.assert(request.params.id, request.body)),
    ),
  );

  app.post<{ Params: { id: string } }>(
    "/microapps/computer-use/sessions/:id/stop",
    { schema: computerUseRouteSchemas.debuggerSession },
    routeHandler<{ Params: { id: string } }>("Failed to stop Computer Use browser session", async (request) =>
      success(await computerUseDebuggerService.stop(request.params.id)),
    ),
  );

  app.post<{ Params: { id: string }; Body: { invocationId: string } }>(
    "/microapps/computer-use/sessions/:id/approval",
    { schema: computerUseRouteSchemas.debuggerApproval },
    routeHandler<{ Params: { id: string }; Body: { invocationId: string } }>("Failed to approve Computer Use browser action", async (request) =>
      success(await computerUseDebuggerService!.approve(request.params.id, request.body.invocationId)),
    ),
  );

  app.post<{ Params: { id: string }; Body: { invocationId: string; reason?: string } }>(
    "/microapps/computer-use/sessions/:id/approval/reject",
    { schema: computerUseRouteSchemas.debuggerRejectApproval },
    routeHandler<{ Params: { id: string }; Body: { invocationId: string; reason?: string } }>("Failed to reject Computer Use browser action", async (request) =>
      success(await computerUseDebuggerService!.reject(request.params.id, request.body.invocationId, request.body.reason)),
    ),
  );

  app.get<{ Params: { id: string; artifactId: string } }>(
    "/microapps/computer-use/sessions/:id/artifacts/:artifactId/content",
    { schema: computerUseRouteSchemas.debuggerArtifact },
    routeHandler<{ Params: { id: string; artifactId: string } }>("Failed to read Computer Use browser artifact", async (request, reply) => {
      const artifact = await computerUseDebuggerService.readArtifact(request.params.id, request.params.artifactId);
      reply.header("Cache-Control", "no-store");
      reply.type(artifact.contentType);
      return reply.send(artifact.bytes);
    }),
  );
  }

  app.get(
    "/microapps/computer-use/runtime",
    { schema: computerUseRouteSchemas.getRuntime },
    routeHandler("Failed to get computer use runtime state", async () => {
      try {
        const runtime = await computerUseRuntimeService.getRuntimeState();
        return success(runtime);
      } catch (error) {
        return mapComputerUseError(error);
      }
    }),
  );

  app.post<{ Body: { force?: boolean } }>(
    "/microapps/computer-use/runtime/install",
    { schema: computerUseRouteSchemas.installRuntime },
    routeHandler<{ Body: { force?: boolean } }>("Failed to install computer use runtime", async (request) => {
      try {
        const runtime = await computerUseRuntimeService.installRuntime(
          request.body,
        );
        return success(runtime, "Computer use runtime installed");
      } catch (error) {
        return mapComputerUseError(error);
      }
    }),
  );
};

export default computerUseRoutes;
