import type { FastifyPluginAsync } from "fastify";
import { Readable } from "node:stream";
import { success } from "@/utils/index.js";
import { routeHandler } from "@/utils/route-errors.js";
import { successEnvelope } from "@/routes/schema-helpers.js";
import { initializeHarnessRuntime } from "./bootstrap.js";
import {
  executeHarnessInvocation,
  getHarnessInvocation,
  getHarnessInvocationTrace,
  listHarnessInvocationEvents,
} from "../harness/invocations.js";
import {
  getReadableResourceImplementation,
  listInternalToolDefinitions,
  listReadableResourceDefinitions,
} from "../harness/registry.js";
import { resolveHarnessToolExposure } from "../harness/exposure.js";
import { resolveHarnessCapabilityDiagnostics } from "../harness/capability-diagnostics.js";
import { resolveHarnessToolCandidatesForTurn } from "../harness/tool-candidates.js";
import { getHarnessEnvironmentSnapshot } from "../harness/environment.js";
import { toSseChunk } from "./core/events.js";
import { mcpNotFound } from "./core/errors.js";
import { getWorkspaceSelection, selectWorkspaceRoot } from "./workspace.js";
import { createMcpMarketplaceCatalog } from "./marketplace-catalog.js";
import {
  connectExternalMcpServer,
  createExternalMcpServer,
  deleteExternalMcpServer,
  discoverExternalMcpServer,
  getExternalMcpServer,
  getExternalMcpServerConfig,
  getExternalMcpServerConfigSchema,
  listExternalMcpServers,
  updateExternalMcpServerConfig,
  updateExternalMcpAccess,
  updateExternalMcpEnabled,
} from "./external.js";
import { webSearchSettingsRepository } from "@/db/repositories/web-search-settings.repository.js";
import { integrationCapabilitiesRepository } from "@/db/repositories/integration-capabilities.repository.js";
import { integrationInstancesRepository } from "@/db/repositories/integration-instances.repository.js";
import { wecomSettingsRepository } from "@/db/repositories/wecom-settings.repository.js";
import { resolveWecomConfig } from "@/integrations/wecom/config.js";
import { knowledgeBaseService } from "@/services/knowledge-base.service.js";
import { mcpBadRequest } from "./core/errors.js";
import { withWorkbenchMetadata } from "./workbench-metadata.js";

const objectSchema = { type: "object", additionalProperties: true } as const;

const upsertDefaultWecomResources = (input: {
  corpId?: string;
  agentId?: string;
  appSecret?: string;
  contactsSecret?: string;
  robotWebhookUrl?: string;
  robotWebhookSecret?: string;
  smartRobotBotId?: string;
  smartRobotSecret?: string;
  smartRobotKnowledgeBaseId?: string;
  smartRobotReplyMode?: "stream" | "send";
}) => {
  const current = resolveWecomConfig();
  const next = {
    corpId: input.corpId?.trim() ?? current.corpId,
    agentId: input.agentId?.trim() ?? current.agentId,
    appSecret: input.appSecret?.trim() ?? current.appSecret,
    contactsSecret: input.contactsSecret?.trim() ?? current.contactsSecret,
    robotWebhookUrl:
      input.robotWebhookUrl?.trim() ?? current.robotWebhookUrl,
    robotWebhookSecret:
      input.robotWebhookSecret?.trim() ?? current.robotWebhookSecret,
    smartRobotBotId:
      input.smartRobotBotId?.trim() ?? current.smartRobotBotId,
    smartRobotSecret:
      input.smartRobotSecret?.trim() ?? current.smartRobotSecret,
    smartRobotKnowledgeBaseId:
      input.smartRobotKnowledgeBaseId?.trim() ?? current.smartRobotKnowledgeBaseId,
    smartRobotReplyMode:
      input.smartRobotReplyMode === "send" || input.smartRobotReplyMode === "stream"
        ? input.smartRobotReplyMode
        : current.smartRobotReplyMode,
  };

  const defaultInstance =
    integrationInstancesRepository.getDefault("wecom") ??
    integrationInstancesRepository.create({
      provider: "wecom",
      name: "Default WeCom Instance",
      externalTenantId: next.corpId || null,
      config: {
        corpId: next.corpId,
        agentId: next.agentId,
        appSecret: next.appSecret,
        contactsSecret: next.contactsSecret,
      },
      enabled: true,
      isDefault: true,
    });

  const instance =
    integrationInstancesRepository.update(defaultInstance.id, {
      name: defaultInstance.name || "Default WeCom Instance",
      externalTenantId: next.corpId || null,
      config: {
        corpId: next.corpId,
        agentId: next.agentId,
        appSecret: next.appSecret,
        contactsSecret: next.contactsSecret,
      },
      enabled: true,
      isDefault: true,
    }) ?? defaultInstance;

  const capabilities = integrationCapabilitiesRepository.listByInstance(
    instance.id,
  );
  const webhookCapability = capabilities.find(
    (item) => item.type === "wecom.webhook_robot",
  );
  const smartRobotCapability = capabilities.find(
    (item) => item.type === "wecom.smart_robot",
  );

  if (webhookCapability) {
    integrationCapabilitiesRepository.update(webhookCapability.id, {
      name: webhookCapability.name || "Default Webhook Robot",
      enabled: true,
      config: {
        webhookUrl: next.robotWebhookUrl,
        webhookSecret: next.robotWebhookSecret,
      },
    });
  } else {
    integrationCapabilitiesRepository.create({
      instanceId: instance.id,
      provider: "wecom",
      type: "wecom.webhook_robot",
      name: "Default Webhook Robot",
      enabled: true,
      isDefault: true,
      config: {
        webhookUrl: next.robotWebhookUrl,
        webhookSecret: next.robotWebhookSecret,
      },
    });
  }

  if (smartRobotCapability) {
    integrationCapabilitiesRepository.update(smartRobotCapability.id, {
      name: smartRobotCapability.name || "Default Smart Robot",
      enabled: true,
      knowledgeBaseId: next.smartRobotKnowledgeBaseId || null,
      config: {
        botId: next.smartRobotBotId,
        secret: next.smartRobotSecret,
        replyMode: next.smartRobotReplyMode,
      },
    });
  } else {
    integrationCapabilitiesRepository.create({
      instanceId: instance.id,
      provider: "wecom",
      type: "wecom.smart_robot",
      name: "Default Smart Robot",
      enabled: true,
      isDefault: false,
      knowledgeBaseId: next.smartRobotKnowledgeBaseId || null,
      config: {
        botId: next.smartRobotBotId,
        secret: next.smartRobotSecret,
        replyMode: next.smartRobotReplyMode,
      },
    });
  }

  return next;
};

const mcpRoutes: FastifyPluginAsync = async (app) => {
  initializeHarnessRuntime();
  const marketplaceCatalog = createMcpMarketplaceCatalog();
  const stopMarketplaceAutoSync = marketplaceCatalog.startAutoSync();
  app.addHook("onClose", async () => {
    stopMarketplaceAutoSync();
  });

  app.get<{
    Querystring: {
      cursor?: string;
      limit?: number;
      query?: string;
      category?: string;
      transport?: "remote" | "local";
      installable?: boolean;
    };
  }>(
    "/mcp/marketplace/servers",
    {
      schema: {
        tags: ["Tools"],
        summary: "List marketplace MCP servers",
        querystring: {
          type: "object",
          properties: {
            cursor: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            query: { type: "string" },
            category: { type: "string" },
            transport: { type: "string", enum: ["remote", "local"] },
            installable: { type: "boolean" },
          },
          additionalProperties: false,
        },
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to list marketplace MCP servers", async (request) =>
      success(
        marketplaceCatalog.list({
          cursor: request.query.cursor,
          limit: request.query.limit ?? 20,
          query: request.query.query,
          category: request.query.category,
          transport: request.query.transport,
          installable: request.query.installable,
        }),
      )),
  );

  app.get(
    "/mcp/marketplace/sync-status",
    {
      schema: {
        tags: ["Tools"],
        summary: "Get MCP marketplace catalog sync status",
        response: { 200: successEnvelope(objectSchema) },
      },
    },
    routeHandler("Failed to get MCP marketplace sync status", async () =>
      success(marketplaceCatalog.getStatus()),
    ),
  );

  app.post(
    "/mcp/marketplace/sync",
    {
      schema: {
        tags: ["Tools"],
        summary: "Request an MCP marketplace catalog update",
        response: { 200: successEnvelope(objectSchema) },
      },
    },
    routeHandler("Failed to start MCP marketplace sync", async () => {
      const result = marketplaceCatalog.requestSync();
      return success({ started: true, status: result.status });
    }),
  );

  app.get(
    "/mcp/external/servers",
    {
      schema: {
        tags: ["Tools"],
        summary: "List configured external MCP servers",
        response: {
          200: successEnvelope({
            type: "array",
            items: objectSchema,
          }),
        },
      },
    },
    routeHandler("Failed to list external MCP servers", async () =>
      success(listExternalMcpServers())),
  );

  app.post<{
    Body: {
      id?: string;
      registryUrl?: string;
      packageName?: string;
      documentationUrl?: string;
      repositoryUrl?: string;
      displayName: string;
      description?: string;
      version?: string;
      transport:
        | {
            kind: "streamable-http";
            url: string;
          }
        | {
            kind: "stdio";
            command: string;
            args?: string[];
          };
      disclaimerAccepted: boolean;
      disclaimerTextHash?: string;
    };
  }>(
    "/mcp/external/servers",
    {
      schema: {
        tags: ["Tools"],
        summary: "Create one external MCP server record",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to create external MCP server", async (request) =>
      success(
        createExternalMcpServer({
          id: request.body.id,
          registryUrl: request.body.registryUrl,
          packageName: request.body.packageName,
          documentationUrl: request.body.documentationUrl,
          repositoryUrl: request.body.repositoryUrl,
          displayName: request.body.displayName,
          description: request.body.description,
          version: request.body.version,
          transport: request.body.transport,
          disclaimerAccepted: request.body.disclaimerAccepted,
          disclaimerTextHash: request.body.disclaimerTextHash,
        }),
      )),
  );

  app.post<{ Params: { id: string } }>(
    "/mcp/external/servers/:id/connect",
    {
      schema: {
        tags: ["Tools"],
        summary: "Connect one external MCP server",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to connect external MCP server", async (request) =>
      success(await connectExternalMcpServer(request.params.id))),
  );

  app.patch<{
    Params: { id: string };
    Body: { agentEnabled: boolean };
  }>(
    "/mcp/external/servers/:id/access",
    {
      schema: {
        tags: ["Tools"],
        summary: "Update Agent access for one external MCP server",
        body: {
          type: "object",
          required: ["agentEnabled"],
          additionalProperties: false,
          properties: {
            agentEnabled: { type: "boolean" },
          },
        },
        response: { 200: successEnvelope(objectSchema) },
      },
    },
    routeHandler("Failed to update external MCP Agent access", async (request) =>
      success(updateExternalMcpAccess(request.params.id, request.body))),
  );

  app.patch<{
    Params: { id: string };
    Body: { enabled: boolean };
  }>(
    "/mcp/external/servers/:id/enabled",
    {
      schema: {
        tags: ["Tools"],
        summary: "Enable or disable one external MCP server",
        body: {
          type: "object",
          required: ["enabled"],
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
          },
        },
        response: { 200: successEnvelope(objectSchema) },
      },
    },
    routeHandler("Failed to update external MCP enabled state", async (request) =>
      success(updateExternalMcpEnabled(request.params.id, request.body.enabled))),
  );

  app.post<{ Params: { id: string } }>(
    "/mcp/external/servers/:id/discover",
    {
      schema: {
        tags: ["Tools"],
        summary: "Discover capabilities from one external MCP server",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to discover external MCP server capabilities", async (request) =>
      success(await discoverExternalMcpServer(request.params.id))),
  );

  app.get<{ Params: { id: string } }>(
    "/mcp/external/servers/:id",
    {
      schema: {
        tags: ["Tools"],
        summary: "Get one external MCP server",
        description:
          "Return one external MCP server with transport, disclaimer, connection, and discovered capability metadata for governance and audit views.",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to get external MCP server", async (request) =>
      success(getExternalMcpServer(request.params.id))),
  );

  app.get<{ Params: { id: string } }>(
    "/mcp/external/servers/:id/config-schema",
    {
      schema: {
        tags: ["Tools"],
        summary: "Get config schema draft for one external MCP server",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to get external MCP server config schema", async (request) =>
      success(getExternalMcpServerConfigSchema(request.params.id))),
  );

  app.get<{ Params: { id: string } }>(
    "/mcp/external/servers/:id/config",
    {
      schema: {
        tags: ["Tools"],
        summary: "Get current config for one external MCP server",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to get external MCP server config", async (request) =>
      success(getExternalMcpServerConfig(request.params.id))),
  );

  app.patch<{
    Params: { id: string };
    Body: {
      endpointUrl?: string;
      command?: string;
      argsText?: string;
      cwd?: string;
      envJson?: string;
      authType: "none" | "bearer";
      timeoutMs: number;
      customHeadersJson: string;
      bearerToken?: string | null;
    };
  }>(
    "/mcp/external/servers/:id/config",
    {
      schema: {
        tags: ["Tools"],
        summary: "Update config for one external MCP server",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to update external MCP server config", async (request) =>
      success(
        updateExternalMcpServerConfig(request.params.id, {
          endpointUrl: request.body.endpointUrl,
          command: request.body.command,
          argsText: request.body.argsText,
          cwd: request.body.cwd,
          envJson: request.body.envJson,
          authType: request.body.authType,
          timeoutMs: request.body.timeoutMs,
          customHeadersJson: request.body.customHeadersJson,
          bearerToken: request.body.bearerToken,
        }),
      )),
  );

  app.delete<{ Params: { id: string } }>(
    "/mcp/external/servers/:id",
    {
      schema: {
        tags: ["Tools"],
        summary: "Delete one external MCP server",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to delete external MCP server", async (request) =>
      success(deleteExternalMcpServer(request.params.id))),
  );

  app.get(
    "/mcp/web-search/config",
    {
      schema: {
        tags: ["Tools"],
        summary: "Get persisted web search config",
        description:
          "Return the backend-persisted Web Search configuration. The values are stored in the server SQLite database and reused by harness web_search execution.",
        response: {
          200: successEnvelope({
            type: "object",
            required: ["apiKey", "baseUrl", "maxResults"],
            properties: {
              apiKey: { type: "string" },
              baseUrl: { type: "string" },
              maxResults: { type: "integer", minimum: 1, maximum: 10 },
            },
          }),
        },
      },
    },
    routeHandler("Failed to get web search config", async () => {
      const current = webSearchSettingsRepository.get();
      return success({
        apiKey: current.tavilyApiKey,
        baseUrl: current.searxngBaseUrl,
        maxResults: current.maxResults,
      });
    }),
  );

  app.put<{ Body: { apiKey?: string; baseUrl?: string; maxResults?: number } }>(
    "/mcp/web-search/config",
    {
      schema: {
        tags: ["Tools"],
        summary: "Persist web search config",
        description:
          "Persist the Web Search configuration into the server SQLite database. These saved values are later used by harness web_search as the default provider credentials and endpoint.",
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            apiKey: { type: "string" },
            baseUrl: { type: "string" },
            maxResults: { type: "integer", minimum: 1, maximum: 10 },
          },
        },
        response: {
          200: successEnvelope({
            type: "object",
            required: ["apiKey", "baseUrl", "maxResults"],
            properties: {
              apiKey: { type: "string" },
              baseUrl: { type: "string" },
              maxResults: { type: "integer", minimum: 1, maximum: 10 },
            },
          }),
        },
      },
    },
    routeHandler("Failed to save web search config", async (request) => {
      const next = webSearchSettingsRepository.update({
        tavilyApiKey: request.body.apiKey,
        searxngBaseUrl: request.body.baseUrl,
        maxResults: request.body.maxResults,
      });
      return success({
        apiKey: next.tavilyApiKey,
        baseUrl: next.searxngBaseUrl,
        maxResults: next.maxResults,
      });
    }),
  );

  app.get(
    "/mcp/wecom/config",
    {
      schema: {
        tags: ["Tools"],
        summary: "Get persisted WeCom config",
        description:
          "Return the backend-persisted WeCom configuration used by the internal WeCom integration routes and providers.",
        response: {
          200: successEnvelope({
            type: "object",
            required: [
              "corpId",
              "agentId",
              "appSecret",
              "contactsSecret",
              "robotWebhookUrl",
              "robotWebhookSecret",
              "smartRobotBotId",
              "smartRobotSecret",
              "smartRobotKnowledgeBaseId",
              "smartRobotReplyMode",
            ],
            properties: {
              corpId: { type: "string" },
              agentId: { type: "string" },
              appSecret: { type: "string" },
              contactsSecret: { type: "string" },
                robotWebhookUrl: { type: "string" },
                robotWebhookSecret: { type: "string" },
                smartRobotBotId: { type: "string" },
                smartRobotSecret: { type: "string" },
                smartRobotKnowledgeBaseId: { type: "string" },
                smartRobotReplyMode: { type: "string", enum: ["stream", "send"] },
              },
          }),
        },
      },
    },
    routeHandler("Failed to get WeCom config", async () => {
      const current = resolveWecomConfig();
      return success(current);
    }),
  );

  app.put<{
    Body: {
      corpId?: string;
      agentId?: string;
      appSecret?: string;
      contactsSecret?: string;
        robotWebhookUrl?: string;
        robotWebhookSecret?: string;
        smartRobotBotId?: string;
        smartRobotSecret?: string;
        smartRobotKnowledgeBaseId?: string;
        smartRobotReplyMode?: "stream" | "send";
      };
  }>(
    "/mcp/wecom/config",
    {
      schema: {
        tags: ["Tools"],
        summary: "Persist WeCom config",
        description:
          "Persist the WeCom configuration into the server SQLite database. These saved values are later used by the internal WeCom integration routes and providers as default credentials.",
          body: {
            type: "object",
            additionalProperties: false,
            properties: {
              corpId: { type: "string" },
              agentId: { type: "string" },
              appSecret: { type: "string" },
              contactsSecret: { type: "string" },
              robotWebhookUrl: { type: "string" },
              robotWebhookSecret: { type: "string" },
              smartRobotBotId: { type: "string" },
              smartRobotSecret: { type: "string" },
              smartRobotKnowledgeBaseId: { type: "string" },
              smartRobotReplyMode: { type: "string", enum: ["stream", "send"] },
            },
          },
        response: {
          200: successEnvelope({
            type: "object",
            required: [
              "corpId",
              "agentId",
              "appSecret",
              "contactsSecret",
              "robotWebhookUrl",
              "robotWebhookSecret",
              "smartRobotBotId",
              "smartRobotSecret",
              "smartRobotKnowledgeBaseId",
              "smartRobotReplyMode",
            ],
            properties: {
              corpId: { type: "string" },
              agentId: { type: "string" },
              appSecret: { type: "string" },
              contactsSecret: { type: "string" },
                robotWebhookUrl: { type: "string" },
                robotWebhookSecret: { type: "string" },
                smartRobotBotId: { type: "string" },
                smartRobotSecret: { type: "string" },
                smartRobotKnowledgeBaseId: { type: "string" },
                smartRobotReplyMode: { type: "string", enum: ["stream", "send"] },
              },
          }),
        },
      },
    },
      routeHandler("Failed to save WeCom config", async (request) => {
        const smartRobotKnowledgeBaseId = request.body.smartRobotKnowledgeBaseId?.trim();
        if (
          smartRobotKnowledgeBaseId &&
          !knowledgeBaseService.getKnowledgeBaseById(smartRobotKnowledgeBaseId)
        ) {
          throw mcpBadRequest(`Knowledge base not found: ${smartRobotKnowledgeBaseId}`);
        }

        const next = upsertDefaultWecomResources({
          corpId: request.body.corpId,
          agentId: request.body.agentId,
          appSecret: request.body.appSecret,
          contactsSecret: request.body.contactsSecret,
          robotWebhookUrl: request.body.robotWebhookUrl,
          robotWebhookSecret: request.body.robotWebhookSecret,
          smartRobotBotId: request.body.smartRobotBotId,
          smartRobotSecret: request.body.smartRobotSecret,
          smartRobotKnowledgeBaseId: request.body.smartRobotKnowledgeBaseId,
          smartRobotReplyMode: request.body.smartRobotReplyMode,
        });
        wecomSettingsRepository.update(next);
        return success(next);
      }),
  );

  app.get(
    "/mcp/workspace",
    {
      schema: {
        tags: ["Tools"],
        summary: "Get active workspace root selection",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to get workspace selection", async () =>
      success(getWorkspaceSelection())),
  );

  app.post<{ Body: { rootPath: string } }>(
    "/mcp/workspace/select",
    {
      schema: {
        tags: ["Tools"],
        summary: "Select active workspace root",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to select workspace root", async (request) =>
      success(selectWorkspaceRoot(request.body.rootPath))),
  );

  app.get<{ Querystring: { query?: string; source?: "tools_list" | "agent_intent" | "chat_surface" } }>(
    "/mcp/tools",
    {
      schema: {
        tags: ["Tools"],
        summary: "List MCP tools",
        querystring: {
          type: "object",
          properties: {
            query: { type: "string" },
            source: {
              type: "string",
              enum: ["tools_list", "agent_intent", "chat_surface"],
            },
          },
          additionalProperties: false,
        },
        response: {
          200: successEnvelope({
            type: "array",
            items: objectSchema,
          }),
        },
      },
    },
    routeHandler("Failed to list MCP tools", async (request) => {
      const internalDefinitions = listInternalToolDefinitions();
      if (!request.query.query && !request.query.source) {
        return success(withWorkbenchMetadata(internalDefinitions));
      }

      const decision = resolveHarnessToolExposure({
        source: request.query.source ?? "tools_list",
        query: request.query.query,
      });
      return success(
        withWorkbenchMetadata(
          decision.exposedDefinitions.filter((definition) => definition.source === "internal"),
          internalDefinitions,
        ),
      );
    }),
  );

  app.get<{
    Querystring: {
      query: string;
      source?: "tools_list" | "agent_intent" | "chat_surface";
      maxTools?: number;
      topK?: number;
      minScore?: number;
    };
  }>(
    "/mcp/tools/candidates",
    {
      schema: {
        tags: ["Tools"],
        summary: "Resolve Harness tool candidates for the current turn",
        querystring: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            source: {
              type: "string",
              enum: ["tools_list", "agent_intent", "chat_surface"],
            },
            maxTools: { type: "integer", minimum: 1, maximum: 50 },
            topK: { type: "integer", minimum: 1, maximum: 50 },
            minScore: { type: "number" },
          },
          additionalProperties: false,
        },
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to resolve Harness tool candidates", async (request) =>
      success(
        await resolveHarnessToolCandidatesForTurn({
          query: request.query.query,
          source: request.query.source ?? "agent_intent",
          maxTools: request.query.maxTools,
          topK: request.query.topK,
          minScore: request.query.minScore,
        }),
      )),
  );

  app.get<{
    Querystring: {
      query: string;
      source?: "tools_list" | "agent_intent" | "chat_surface";
      topK?: number;
      minScore?: number;
      selectedTopK?: number;
      selectedMinScore?: number;
    };
  }>(
    "/mcp/capabilities/diagnostics",
    {
      schema: {
        tags: ["Tools"],
        summary: "Diagnose Harness capability exposure and selection",
        querystring: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            source: {
              type: "string",
              enum: ["tools_list", "agent_intent", "chat_surface"],
            },
            topK: { type: "integer", minimum: 1, maximum: 50 },
            minScore: { type: "number" },
            selectedTopK: { type: "integer", minimum: 0, maximum: 20 },
            selectedMinScore: { type: "number" },
          },
          additionalProperties: false,
        },
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to resolve Harness capability diagnostics", async (request) =>
      success(
        await resolveHarnessCapabilityDiagnostics({
          query: request.query.query,
          source: request.query.source,
          topK: request.query.topK,
          minScore: request.query.minScore,
          selectedTopK: request.query.selectedTopK,
          selectedMinScore: request.query.selectedMinScore,
        }),
      )),
  );

  app.get(
    "/mcp/resources",
    {
      schema: {
        tags: ["Tools"],
        summary: "List MCP resources",
        response: {
          200: successEnvelope({
            type: "array",
            items: objectSchema,
          }),
        },
      },
    },
    routeHandler("Failed to list MCP resources", async () =>
      success(listReadableResourceDefinitions())),
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/mcp/resources/:id/read",
    {
      schema: {
        tags: ["Tools"],
        summary: "Read one MCP resource",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to read MCP resource", async (request) => {
      const resource = getReadableResourceImplementation(request.params.id);
      if (!resource?.read) {
        throw mcpNotFound(`Resource not found: ${request.params.id}`);
      }

      const result = await resource.read({
        args: request.body ?? {},
        environment: getHarnessEnvironmentSnapshot(),
      });
      return success(result);
    }),
  );

  app.post<{ Body: { toolId: string; args?: Record<string, unknown> } }>(
    "/mcp/invocations",
    {
      schema: {
        tags: ["Tools"],
        summary: "Execute one MCP tool invocation",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to execute MCP invocation", async (request) => {
      const result = await executeHarnessInvocation({
        toolId: request.body.toolId,
        args: request.body.args,
        userId: request.authUser?.id,
      });
      return success(result);
    }),
  );

  app.post<{ Body: { toolId: string; args?: Record<string, unknown> } }>(
    "/mcp/invocations/stream",
    {
      schema: {
        tags: ["Tools"],
        summary: "Execute one MCP tool invocation with SSE stream",
      },
    },
    routeHandler("Failed to stream MCP invocation", async (request, reply) => {
      reply
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache, no-transform")
        .header("Connection", "keep-alive");

      const stream = Readable.from(
        (async function* () {
          let invocationId = "";
          const queue: string[] = [];
          let resolvePending: (() => void) | null = null;
          let finished = false;

          const waitForQueue = async () =>
            new Promise<void>((resolve) => {
              resolvePending = resolve;
            });

          const runner = executeHarnessInvocation({
            toolId: request.body.toolId,
            args: request.body.args,
            userId: request.authUser?.id,
            onEvent(event) {
              invocationId = event.invocationId;
              queue.push(toSseChunk(event));
              resolvePending?.();
              resolvePending = null;
            },
          }).finally(() => {
            finished = true;
            resolvePending?.();
            resolvePending = null;
          });

          while (!finished || queue.length > 0) {
            while (queue.length > 0) {
              yield queue.shift()!;
            }

            if (!finished) {
              await waitForQueue();
            }
          }

          await runner;
          if (invocationId) {
            yield `data: ${JSON.stringify({ type: "invocation:done", invocationId })}\n\n`;
          }
        })(),
      );

      return reply.send(stream);
    }),
  );

  app.get<{ Params: { id: string } }>(
    "/mcp/invocations/:id",
    {
      schema: {
        tags: ["Tools"],
        summary: "Get one MCP invocation",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to get MCP invocation", async (request) => {
      const invocation = getHarnessInvocation(request.params.id);
      if (!invocation) {
        throw mcpNotFound(`Invocation not found: ${request.params.id}`);
      }
      return success(invocation);
    }),
  );

  app.get<{ Params: { id: string } }>(
    "/mcp/invocations/:id/trace",
    {
      schema: {
        tags: ["Tools"],
        summary: "Get one MCP invocation trace",
        response: {
          200: successEnvelope(objectSchema),
        },
      },
    },
    routeHandler("Failed to get MCP invocation trace", async (request) => {
      const trace = getHarnessInvocationTrace(request.params.id);
      if (!trace) {
        throw mcpNotFound(`Invocation trace not found: ${request.params.id}`);
      }
      return success(trace);
    }),
  );

  app.get<{ Params: { id: string } }>(
    "/mcp/invocations/:id/events",
    {
      schema: {
        tags: ["Tools"],
        summary: "List buffered MCP invocation events",
        response: {
          200: successEnvelope({
            type: "array",
            items: objectSchema,
          }),
        },
      },
    },
    routeHandler("Failed to list MCP invocation events", async (request) =>
      success(listHarnessInvocationEvents(request.params.id))),
  );
};

export default mcpRoutes;
