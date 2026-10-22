import type { FastifyPluginAsync } from "fastify";
import type { ComputerUseRuntimeState } from "@/microapps/computer-use/index.js";
import { success } from "@/utils/index.js";
import {
  badRequest,
  routeHandler,
} from "@/utils/route-errors.js";
import { computerUseRouteSchemas } from "./schemas.js";

export type ComputerUseRuntimeRouteService = {
  getRuntimeState(): Promise<ComputerUseRuntimeState>;
  installRuntime(request?: { force?: boolean }): Promise<ComputerUseRuntimeState>;
};

export type ComputerUseRouteOptions = {
  computerUseRuntimeService: ComputerUseRuntimeRouteService;
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
