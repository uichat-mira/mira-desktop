import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { Readable } from "node:stream";
import {
  PairingServiceError,
  remoteAccessPairingService,
} from "@/services/remote-access-pairing.service.js";
import {
  RemoteRelayConnectorService,
  type RelaySocketFactory,
} from "@/services/remote-relay-connector.service.js";
import {
  RemoteRelayConfigError,
  getRemoteRelayPairingMetadata,
  getRemoteRelayUserConfig,
  resolvePersistedRemoteRelayConnectorConfig,
  updateRemoteRelayUserConfig,
} from "@/services/remote-relay-config.service.js";
import { tailscaleRemoteAccessService } from "@/services/tailscale-remote-access.service.js";
import { threadService } from "@/services/thread.service.js";
import { successEnvelope, errorEnvelope } from "@/routes/schema-helpers.js";
import { success } from "@/utils/index.js";
import {
  badRequest,
  forbidden,
  notFound,
  routeHandler,
} from "@/utils/route-errors.js";
import { chatWorkspaceRepository } from "@/db/repositories/chat-workspace.repository.js";
import {
  REMOTE_DEVICE_SCOPES,
  REMOTE_PAIRING_TRANSPORTS,
} from "@/db/repositories/tailscale-remote-access.repository.js";
import {
  assertRemoteToolAvailable,
  cancelRemoteToolInvocation,
  executeRemoteToolInvocation,
  listRemoteToolManifests,
  resolveRemoteToolApproval,
  type RemoteToolGatewayStreamEvent,
} from "@/services/remote-tool-gateway.service.js";

const looseObjectSchema = {
  type: "object",
  additionalProperties: true,
} as const;

const toRemoteToolSseChunk = (event: RemoteToolGatewayStreamEvent) =>
  `data: ${JSON.stringify(event)}\n\n`;

const remoteWorkspaceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "isDefault",
    "status",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    isDefault: { type: "boolean" },
    status: { type: "string", enum: ["active", "archived"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const mapPairingError = (error: unknown): never => {
  if (error instanceof PairingServiceError) {
    if (error.code === "PAIRING_NOT_FOUND") {
      throw notFound(error.message, { cause: error });
    }
    throw badRequest(error.message, { cause: error });
  }
  throw error;
};

const mapRelayConfigError = (error: unknown): never => {
  if (error instanceof RemoteRelayConfigError) {
    throw badRequest(error.message, { cause: error });
  }
  throw error;
};

const createRelaySocketFactory = (app: FastifyInstance): RelaySocketFactory => {
  const websocketServer = (
    app as unknown as {
      websocketServer?: {
        options?: {
          WebSocket?: new (url: string) => ReturnType<RelaySocketFactory>;
        };
      };
    }
  ).websocketServer;
  const WebSocketCtor = websocketServer?.options?.WebSocket;
  if (!WebSocketCtor) {
    throw new Error(
      "@fastify/websocket did not expose the ws WebSocket runtime required by Mira Relay",
    );
  }

  return (url) => new WebSocketCtor(url);
};

const remoteAccessRoute: FastifyPluginAsync = async (app) => {
  const remoteRelayConnectorService = new RemoteRelayConnectorService(
    resolvePersistedRemoteRelayConnectorConfig,
    createRelaySocketFactory(app),
  );

  app.addHook("onListen", async () => {
    remoteRelayConnectorService.start();
  });

  app.addHook("onClose", async () => {
    remoteRelayConnectorService.stop();
  });

  app.get(
    "/remote/admin/relay/config",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Get Mira Relay configuration",
        operationId: "getRemoteRelayConfig",
        response: {
          200: successEnvelope(looseObjectSchema),
          401: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to get Mira Relay configuration", async (request) => {
      if (!request.authUser) {
        throw forbidden("Desktop authentication is required");
      }
      return success(getRemoteRelayUserConfig());
    }),
  );

  app.put<{
    Body: {
      enabled?: boolean;
      endpointMode?: "default" | "custom";
      customUrl?: string;
    };
  }>(
    "/remote/admin/relay/config",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Update Mira Relay configuration",
        operationId: "updateRemoteRelayConfig",
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            endpointMode: { type: "string", enum: ["default", "custom"] },
            customUrl: { type: "string", maxLength: 2048 },
          },
        },
        response: {
          200: successEnvelope(looseObjectSchema),
          400: errorEnvelope,
          401: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to update Mira Relay configuration", async (request) => {
      if (!request.authUser) {
        throw forbidden("Desktop authentication is required");
      }
      try {
        const config = updateRemoteRelayUserConfig(request.body);
        remoteRelayConnectorService.restart();
        return success(config, "Mira Relay configuration updated");
      } catch (error) {
        return mapRelayConfigError(error);
      }
    }),
  );

  app.get(
    "/remote/admin/relay/status",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Get Mira Relay connector status",
        operationId: "getRemoteRelayConnectorStatus",
        response: {
          200: successEnvelope(looseObjectSchema),
          401: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to get Mira Relay connector status", async (request) => {
      if (!request.authUser) {
        throw forbidden("Desktop authentication is required");
      }
      return success(remoteRelayConnectorService.getSnapshot());
    }),
  );

  app.post(
    "/remote/admin/pairing/challenges",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Create a one-time mobile pairing challenge",
        operationId: "createRemotePairingChallenge",
        response: {
          200: successEnvelope(looseObjectSchema),
          400: errorEnvelope,
          401: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to create remote pairing challenge", async (request) => {
      const user = request.authUser;
      if (!user) {
        throw forbidden("Desktop authentication is required");
      }

      const tailscale = await tailscaleRemoteAccessService.getSnapshot({
        verifyHealth: true,
      });
      const directHostUrl =
        tailscale.runtime.state === "ready" && tailscale.runtime.accessUrl
          ? tailscale.runtime.accessUrl
          : null;
      const relaySnapshot = remoteRelayConnectorService.getSnapshot();
      const relay =
        relaySnapshot.state === "connected"
          ? getRemoteRelayPairingMetadata()
          : null;

      if (!directHostUrl && !relay) {
        throw badRequest(
          "A reachable Tailscale or Mira Relay connection is required before pairing a mobile device",
        );
      }

      return success(
        remoteAccessPairingService.createChallenge({
          userId: user.id,
          hostUrl: directHostUrl,
          relay,
        }),
        "Pairing challenge created",
      );
    }),
  );

  app.get<{ Params: { challengeId: string } }>(
    "/remote/admin/pairing/challenges/:challengeId",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Get a pairing challenge for desktop confirmation",
        operationId: "getRemotePairingChallenge",
        params: {
          type: "object",
          required: ["challengeId"],
          properties: { challengeId: { type: "string", minLength: 1 } },
        },
        response: {
          200: successEnvelope(looseObjectSchema),
          404: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to get remote pairing challenge", async (request) => {
      const user = request.authUser;
      if (!user) {
        throw forbidden("Desktop authentication is required");
      }
      try {
        return success(
          remoteAccessPairingService.getChallengeForUser(
            request.params.challengeId,
            user.id,
          ),
        );
      } catch (error) {
        return mapPairingError(error);
      }
    }),
  );

  app.post<{
    Params: { claimId: string };
    Body: { scopes?: string[] };
  }>(
    "/remote/admin/pairing/claims/:claimId/approve",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Approve a claimed mobile device",
        operationId: "approveRemotePairingClaim",
        params: {
          type: "object",
          required: ["claimId"],
          properties: { claimId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            scopes: {
              type: "array",
              uniqueItems: true,
              items: { type: "string", enum: [...REMOTE_DEVICE_SCOPES] },
            },
          },
        },
        response: {
          200: successEnvelope(looseObjectSchema),
          400: errorEnvelope,
          404: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to approve remote pairing claim", async (request) => {
      const user = request.authUser;
      if (!user) {
        throw forbidden("Desktop authentication is required");
      }
      try {
        return success(
          remoteAccessPairingService.approve({
            claimId: request.params.claimId,
            userId: user.id,
            scopes: request.body.scopes,
          }),
          "Remote device approved",
        );
      } catch (error) {
        return mapPairingError(error);
      }
    }),
  );

  app.post<{ Params: { claimId: string } }>(
    "/remote/admin/pairing/claims/:claimId/reject",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Reject a claimed mobile device",
        operationId: "rejectRemotePairingClaim",
        params: {
          type: "object",
          required: ["claimId"],
          properties: { claimId: { type: "string", minLength: 1 } },
        },
        response: {
          200: successEnvelope(looseObjectSchema),
          400: errorEnvelope,
          404: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to reject remote pairing claim", async (request) => {
      const user = request.authUser;
      if (!user) {
        throw forbidden("Desktop authentication is required");
      }
      try {
        return success(
          remoteAccessPairingService.reject({
            claimId: request.params.claimId,
            userId: user.id,
          }),
          "Remote device rejected",
        );
      } catch (error) {
        return mapPairingError(error);
      }
    }),
  );

  app.post<{
    Body: {
      challengeId: string;
      code: string;
      deviceName?: string;
      platform?: string;
      transport?: "relay" | "direct";
      publicKey?: string;
      requestedScopes?: string[];
    };
  }>(
    "/remote/pairing/claim",
    {
      schema: {
        tags: ["Remote Pairing"],
        summary: "Claim a one-time pairing challenge from mobile",
        operationId: "claimRemotePairingChallenge",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["challengeId", "code"],
          properties: {
            challengeId: { type: "string", minLength: 1 },
            code: { type: "string", minLength: 8, maxLength: 16 },
            deviceName: { type: "string", maxLength: 80 },
            platform: { type: "string", maxLength: 40 },
            transport: {
              type: "string",
              enum: [...REMOTE_PAIRING_TRANSPORTS],
            },
            publicKey: { type: "string", maxLength: 4096 },
            requestedScopes: {
              type: "array",
              uniqueItems: true,
              maxItems: 32,
              // Pairing requests are capability proposals, not grants. Accept
              // future scope names here so newer Mobile clients can pair with
              // an older Host; the service keeps only REMOTE_DEVICE_SCOPES.
              items: { type: "string", minLength: 1, maxLength: 128 },
            },
          },
        },
        response: {
          200: successEnvelope(looseObjectSchema),
          400: errorEnvelope,
          404: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to claim remote pairing challenge", async (request) => {
      try {
        return success(
          remoteAccessPairingService.claim(request.body),
          "Pairing challenge claimed",
        );
      } catch (error) {
        return mapPairingError(error);
      }
    }),
  );

  app.post<{
    Params: { claimId: string };
    Body: { pollToken: string };
  }>(
    "/remote/pairing/claims/:claimId/poll",
    {
      schema: {
        tags: ["Remote Pairing"],
        summary: "Poll pairing approval and retrieve the credential once",
        operationId: "pollRemotePairingClaim",
        params: {
          type: "object",
          required: ["claimId"],
          properties: { claimId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["pollToken"],
          properties: { pollToken: { type: "string", minLength: 20 } },
        },
        response: {
          200: successEnvelope(looseObjectSchema),
          400: errorEnvelope,
          404: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to poll remote pairing claim", async (request) => {
      try {
        return success(
          remoteAccessPairingService.poll(
            request.params.claimId,
            request.body.pollToken,
          ),
        );
      } catch (error) {
        return mapPairingError(error);
      }
    }),
  );

  app.get(
    "/remote/v1/workspaces",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "List mobile-safe chat workspaces",
        operationId: "listRemoteDeviceWorkspaces",
        response: {
          200: successEnvelope({
            type: "array",
            items: remoteWorkspaceSchema,
          }),
          401: errorEnvelope,
          403: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to list remote device workspaces", async (request) => {
      const user = request.authUser;
      if (!request.remoteDevice || !user) {
        throw forbidden("A paired remote device credential is required");
      }

      const activeWorkspaces = threadService
        .listChatWorkspaces(user.id)
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          isDefault: workspace.isDefault,
          status: workspace.status,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        }));
      const archivedWorkspaces = chatWorkspaceRepository
        .list({ userId: user.id, status: "archived" })
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          isDefault: false,
          status: workspace.status,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        }));

      return success(
        [...activeWorkspaces, ...archivedWorkspaces].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        ),
      );
    }),
  );

  app.get(
    "/remote/v1/tools",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "List mobile-safe remote Agent tools",
        operationId: "listRemoteDeviceTools",
        response: {
          200: successEnvelope({
            type: "array",
            items: looseObjectSchema,
          }),
          401: errorEnvelope,
          403: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to list remote device tools", async (request) => {
      if (!request.remoteDevice || !request.authUser) {
        throw forbidden("A paired remote device credential is required");
      }
      return success(await listRemoteToolManifests());
    }),
  );

  app.post<{
    Body: { toolId: string; args?: Record<string, unknown> };
  }>(
    "/remote/v1/tool-invocations/stream",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Execute one mobile remote tool invocation with SSE",
        operationId: "streamRemoteDeviceToolInvocation",
        body: {
          type: "object",
          required: ["toolId"],
          additionalProperties: false,
          properties: {
            toolId: { type: "string", minLength: 1, maxLength: 512 },
            args: { type: "object", additionalProperties: true },
          },
        },
        response: {
          400: errorEnvelope,
          401: errorEnvelope,
          403: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to stream remote device tool invocation", async (request, reply) => {
      const user = request.authUser;
      if (!request.remoteDevice || !user) {
        throw forbidden("A paired remote device credential is required");
      }

      await assertRemoteToolAvailable(request.body.toolId);

      const routeAbortController = new AbortController();
      const abortOnDisconnect = () => routeAbortController.abort();
      reply.raw.once("close", abortOnDisconnect);

      reply
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache, no-transform")
        .header("Connection", "keep-alive");

      const stream = Readable.from(
        (async function* () {
          const queue: string[] = [];
          let resolvePending: (() => void) | null = null;
          let finished = false;

          const wake = () => {
            resolvePending?.();
            resolvePending = null;
          };

          const runner = executeRemoteToolInvocation({
            toolId: request.body.toolId,
            args: request.body.args,
            userId: user.id,
            signal: routeAbortController.signal,
            onEvent(event) {
              queue.push(toRemoteToolSseChunk(event));
              wake();
            },
          })
            .then((invocation) => {
              queue.push(
                toRemoteToolSseChunk({
                  type: "tool:complete",
                  invocation,
                }),
              );
            })
            .catch(() => {
              queue.push(
                toRemoteToolSseChunk({
                  type: "tool:error",
                  code: "REMOTE_TOOL_REQUEST_FAILED",
                  message: "Remote tool request failed before a final invocation result was available.",
                }),
              );
            })
            .finally(() => {
              finished = true;
              reply.raw.off("close", abortOnDisconnect);
              wake();
            });

          while (!finished || queue.length > 0) {
            while (queue.length > 0) {
              yield queue.shift()!;
            }
            if (!finished) {
              await new Promise<void>((resolve) => {
                resolvePending = resolve;
              });
            }
          }

          await runner;
        })(),
      );

      return reply.send(stream);
    }),
  );

  app.post<{
    Params: { invocationId: string };
    Body: {
      decision: "approved" | "rejected";
      toolId: string;
      args?: Record<string, unknown>;
    };
  }>(
    "/remote/v1/tool-invocations/:invocationId/approval",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Resolve one mobile remote tool approval",
        operationId: "resolveRemoteDeviceToolApproval",
        params: {
          type: "object",
          required: ["invocationId"],
          properties: {
            invocationId: { type: "string", minLength: 1 },
          },
        },
        body: {
          type: "object",
          required: ["decision", "toolId"],
          additionalProperties: false,
          properties: {
            decision: { type: "string", enum: ["approved", "rejected"] },
            toolId: { type: "string", minLength: 1, maxLength: 512 },
            args: { type: "object", additionalProperties: true },
          },
        },
        response: {
          200: successEnvelope(looseObjectSchema),
          400: errorEnvelope,
          401: errorEnvelope,
          403: errorEnvelope,
          404: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to resolve remote device tool approval", async (request) => {
      const user = request.authUser;
      if (!request.remoteDevice || !user) {
        throw forbidden("A paired remote device credential is required");
      }
      return success(
        await resolveRemoteToolApproval({
          invocationId: request.params.invocationId,
          decision: request.body.decision,
          toolId: request.body.toolId,
          args: request.body.args,
          userId: user.id,
        }),
      );
    }),
  );

  app.post<{ Params: { invocationId: string } }>(
    "/remote/v1/tool-invocations/:invocationId/cancel",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Cancel one mobile remote tool invocation",
        operationId: "cancelRemoteDeviceToolInvocation",
        params: {
          type: "object",
          required: ["invocationId"],
          properties: {
            invocationId: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: successEnvelope(looseObjectSchema),
          401: errorEnvelope,
          403: errorEnvelope,
          404: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to cancel remote device tool invocation", async (request) => {
      if (!request.remoteDevice || !request.authUser) {
        throw forbidden("A paired remote device credential is required");
      }
      return success(
        cancelRemoteToolInvocation(request.params.invocationId, request.authUser.id),
      );
    }),
  );

  app.get(
    "/remote/v1/manifest",
    {
      schema: {
        tags: ["Remote Access"],
        summary: "Get the scoped remote-device protocol manifest",
        operationId: "getRemoteDeviceManifest",
        response: {
          200: successEnvelope(looseObjectSchema),
          401: errorEnvelope,
          403: errorEnvelope,
          500: errorEnvelope,
        },
      },
    },
    routeHandler("Failed to get remote device manifest", async (request) => {
      const device = request.remoteDevice;
      if (!device) {
        throw forbidden("A paired remote device credential is required");
      }

      return success({
        protocolVersion: 1,
        device: {
          id: device.id,
          name: device.name,
          platform: device.platform,
          scopes: device.permissions,
        },
        routes: {
          workspaces: ["GET /remote/v1/workspaces"],
          threads: [
            "GET /threads",
            "GET /threads/:id",
            "POST /threads",
            "DELETE /threads/:id",
          ],
          messages: ["GET /threads/:id/messages", "POST /proxy/chat/default"],
          agent: [
            "GET /agent/runs/:runId",
            "POST /agent/runs/:runId/approve",
            "POST /agent/runs/:runId/reject",
            "POST /agent/runs/:runId/cancel",
          ],
          tools: [
            "GET /remote/v1/tools",
            "POST /remote/v1/tool-invocations/stream",
            "POST /remote/v1/tool-invocations/:invocationId/approval",
            "POST /remote/v1/tool-invocations/:invocationId/cancel",
          ],
          artifacts: ["GET /threads/:id/media/:mediaId/content"],
        },
        reconnect: {
          mode: "canonical-state-replay",
          eventCursor: false,
        },
        serverTime: new Date().toISOString(),
      });
    }),
  );
};

export default remoteAccessRoute;
