import type { FastifyPluginAsync } from "fastify";
import { errorEnvelope, successEnvelope } from "@/routes/schema-helpers.js";
import { roleService } from "@/services/role.service.js";
import { success } from "@/utils/index.js";
import { forbidden, routeHandler } from "@/utils/route-errors.js";

const remoteRoleSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
  },
} as const;

const remoteRoleSummaryRoute: FastifyPluginAsync = async (app) => {
  app.get(
    "/remote/v1/roles",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "List mobile-safe role summaries",
        operationId: "listRemoteDeviceRoleSummaries",
        response: {
          200: successEnvelope({
            type: "array",
            items: remoteRoleSummarySchema,
          }),
          401: errorEnvelope,
          403: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to list remote role summaries", async (request) => {
      const user = request.authUser;
      if (!(request.remoteDevice || request.cloudRemoteCaller) || !user) {
        throw forbidden("A paired remote device credential is required");
      }

      return success(
        roleService.listRoles({ userId: user.id }).map((role) => ({
          id: role.id,
          name: role.name,
        })),
      );
    }),
  );
};

export default remoteRoleSummaryRoute;
