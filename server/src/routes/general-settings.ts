import { FastifyPluginAsync } from "fastify";
import { generalSettingsRepository } from "@/db/repositories/general-settings.repository.js";
import { tailscaleRemoteAccessRepository } from "@/db/repositories/tailscale-remote-access.repository.js";
import { errorEnvelope, successEnvelope } from "@/routes/schema-helpers.js";
import remoteAccessRoute from "@/routes/remote-access.js";
import remoteRoleSummaryRoute from "@/routes/remote-role-summary.js";
import {
  TailscaleRemoteAccessError,
  tailscaleRemoteAccessService,
} from "@/services/tailscale-remote-access.service.js";
import { success } from "@/utils/index.js";
import {
  badRequest,
  notFound,
  routeHandler,
} from "@/utils/route-errors.js";
import memoryRoute from "./memory.js";

const generalSettingsSchema = {
  type: "object",
  required: ["socks5Host", "socks5Port", "socks5Username", "socks5Password"],
  properties: {
    socks5Host: { type: "string" },
    socks5Port: { type: "number" },
    socks5Username: { type: "string" },
    socks5Password: { type: "string" },
  },
} as const;

const generalSettingsUpdateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    socks5Host: { type: "string" },
    socks5Port: { type: "number" },
    socks5Username: { type: "string" },
    socks5Password: { type: "string" },
  },
} as const;

const tailscaleSnapshotSchema = {
  type: "object",
  additionalProperties: false,
  required: ["config", "runtime", "pairedDevices"],
  properties: {
    config: {
      type: "object",
      additionalProperties: false,
      required: ["enabled", "servePort", "updatedAt"],
      properties: {
        enabled: { type: "boolean" },
        servePort: { type: "integer" },
        updatedAt: { type: ["string", "null"] },
      },
    },
    runtime: {
      type: "object",
      additionalProperties: false,
      required: [
        "state",
        "installed",
        "backendState",
        "version",
        "deviceName",
        "dnsName",
        "tailnetName",
        "tailnetDomain",
        "tailscaleIps",
        "serveConfigured",
        "serveManagedByMira",
        "accessUrl",
        "healthOk",
        "checkedAt",
        "error",
      ],
      properties: {
        state: {
          type: "string",
          enum: [
            "not_installed",
            "needs_login",
            "connecting",
            "connected",
            "serve_conflict",
            "serve_not_configured",
            "unreachable",
            "ready",
            "error",
          ],
        },
        installed: { type: "boolean" },
        backendState: { type: ["string", "null"] },
        version: { type: ["string", "null"] },
        deviceName: { type: ["string", "null"] },
        dnsName: { type: ["string", "null"] },
        tailnetName: { type: ["string", "null"] },
        tailnetDomain: { type: ["string", "null"] },
        tailscaleIps: { type: "array", items: { type: "string" } },
        serveConfigured: { type: "boolean" },
        serveManagedByMira: { type: "boolean" },
        accessUrl: { type: ["string", "null"] },
        healthOk: { type: ["boolean", "null"] },
        checkedAt: { type: "string" },
        error: { type: ["string", "null"] },
      },
    },
    pairedDevices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "platform",
          "permissions",
          "createdAt",
          "lastSeenAt",
        ],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          platform: { type: "string" },
          permissions: { type: "array", items: { type: "string" } },
          createdAt: { type: "string" },
          lastSeenAt: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

const mapTailscaleError = (error: unknown): never => {
  if (error instanceof TailscaleRemoteAccessError) {
    throw badRequest(error.message, { cause: error });
  }

  throw error;
};

const generalSettingsRoute: FastifyPluginAsync = async (app) => {
  app.get(
    "/general-settings",
    {
      schema: {
        tags: ["General Settings"],
        summary: "Get general settings",
        description:
          "Return backend-persisted general settings used by the desktop general settings page.",
        operationId: "getGeneralSettings",
        response: {
          200: successEnvelope(generalSettingsSchema),
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to get general settings", async () =>
      success(generalSettingsRepository.get())),
  );

  app.put<{
    Body: {
      socks5Host?: string;
      socks5Port?: number;
      socks5Username?: string;
      socks5Password?: string;
    };
  }>(
    "/general-settings",
    {
      schema: {
        tags: ["General Settings"],
        summary: "Update general settings",
        description:
          "Persist backend general settings. For SOCKS5 proxy, leaving host or port empty means the proxy is not active.",
        operationId: "updateGeneralSettings",
        body: generalSettingsUpdateSchema,
        response: {
          200: successEnvelope(generalSettingsSchema),
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to update general settings", async (request) =>
      success(
        generalSettingsRepository.update(request.body),
        "General settings updated",
      )),
  );

  app.get(
    "/general-settings/tailscale-remote-access",
    {
      schema: {
        tags: ["General Settings"],
        summary: "Get Tailscale remote access status",
        description:
          "Inspect the local Tailscale runtime, Serve configuration, remote health endpoint, and persisted Mira remote-access setting.",
        operationId: "getTailscaleRemoteAccess",
        response: {
          200: successEnvelope(tailscaleSnapshotSchema),
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to inspect Tailscale remote access", async (request) => {
      const snapshot = await tailscaleRemoteAccessService.getSnapshot();
      return success({
        ...snapshot,
        pairedDevices: tailscaleRemoteAccessRepository.listDevices(
          request.authUser?.id,
        ),
      });
    }),
  );

  app.post(
    "/general-settings/tailscale-remote-access/check",
    {
      schema: {
        tags: ["General Settings"],
        summary: "Check Tailscale remote access",
        description:
          "Refresh Tailscale CLI state and verify the published Mira health endpoint over HTTPS.",
        operationId: "checkTailscaleRemoteAccess",
        response: {
          200: successEnvelope(tailscaleSnapshotSchema),
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to check Tailscale remote access", async (request) => {
      const snapshot = await tailscaleRemoteAccessService.check();
      return success({
        ...snapshot,
        pairedDevices: tailscaleRemoteAccessRepository.listDevices(
          request.authUser?.id,
        ),
      });
    }),
  );

  app.put<{ Body: { enabled: boolean } }>(
    "/general-settings/tailscale-remote-access",
    {
      schema: {
        tags: ["General Settings"],
        summary: "Enable or disable Tailscale remote access",
        description:
          "Safely apply Mira-managed Tailscale Serve state. Existing unrelated Serve configuration is never overwritten.",
        operationId: "updateTailscaleRemoteAccess",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["enabled"],
          properties: {
            enabled: { type: "boolean" },
          },
        },
        response: {
          200: successEnvelope(tailscaleSnapshotSchema),
          400: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to update Tailscale remote access", async (request) => {
      try {
        const snapshot = await tailscaleRemoteAccessService.updateEnabled(
          request.body.enabled,
        );
        return success(
          {
            ...snapshot,
            pairedDevices: tailscaleRemoteAccessRepository.listDevices(
              request.authUser?.id,
            ),
          },
          request.body.enabled
            ? "Tailscale remote access enabled"
            : "Tailscale remote access disabled",
        );
      } catch (error) {
        return mapTailscaleError(error);
      }
    }),
  );

  app.delete<{ Params: { id: string } }>(
    "/general-settings/tailscale-remote-access/devices/:id",
    {
      schema: {
        tags: ["General Settings"],
        summary: "Revoke a paired remote device",
        operationId: "revokeTailscaleRemoteDevice",
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        response: {
          200: successEnvelope({
            type: "object",
            required: ["revoked"],
            properties: { revoked: { type: "boolean" } },
          }),
          404: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to revoke remote device", async (request) => {
      const userId = request.authUser?.id;
      const revoked = tailscaleRemoteAccessService.revokeDevice(
        request.params.id,
        userId,
      );
      if (!revoked) {
        throw notFound("Remote device not found");
      }
      return success({ revoked: true }, "Remote device revoked");
    }),
  );

  await app.register(remoteAccessRoute);
  await app.register(remoteRoleSummaryRoute);
  await app.register(memoryRoute);
};

export default generalSettingsRoute;
