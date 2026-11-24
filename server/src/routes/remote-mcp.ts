import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { isAppError } from "@/utils/errors.js";
import { forbidden } from "@/utils/route-errors.js";
import {
  REMOTE_MCP_RESOURCE_MIME_TYPE,
  REMOTE_MCP_RESOURCE_NAME,
  REMOTE_MCP_RESOURCE_URI,
  REMOTE_MCP_SERVER_NAME,
  createRemoteServiceCapabilitiesManifest,
  type RemoteServiceCapabilitiesManifest,
} from "@/mcp/remote-service-capabilities.js";
import {
  executeRemoteToolInvocation,
  resolveRemoteToolCatalog,
  type RemoteToolCatalog,
  type RemoteToolInvocationProjection,
} from "@/services/remote-tool-gateway.service.js";
import { getAppMeta } from "@/utils/index.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18" as const;
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION] as const;
const MCP_MAX_REQUEST_BODY_BYTES = 1024 * 1024;

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError: boolean;
};

class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const jsonRpcResult = (id: JsonRpcId, result: unknown) => ({
  jsonrpc: "2.0" as const,
  id,
  result,
});

const jsonRpcError = (
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
) => ({
  jsonrpc: "2.0" as const,
  id,
  error: {
    code,
    message,
    ...(data === undefined ? {} : { data }),
  },
});

const remoteScopes = (request: FastifyRequest): readonly string[] | null => {
  if (request.remoteDevice) {
    return request.remoteDevice.permissions;
  }
  if (request.cloudRemoteCaller) {
    return request.cloudRemoteCaller.scopes;
  }
  return null;
};

const requireRemoteScope = (request: FastifyRequest, scope: string) => {
  const scopes = remoteScopes(request);
  if (!scopes) {
    throw forbidden(
      "A paired remote device or official Cloud Host Grant is required",
    );
  }
  if (!scopes.includes(scope)) {
    throw forbidden(
      `Remote device is not permitted to access this Mira route (${scope})`,
    );
  }
  return scopes;
};

const manifestForCatalog = (
  catalog: RemoteToolCatalog,
): RemoteServiceCapabilitiesManifest | null =>
  createRemoteServiceCapabilitiesManifest({
    definitions: catalog.definitions,
    toolNameById: catalog.idToName,
    serverVersion: getAppMeta().version,
  });

const toMcpToolResult = (
  projection: RemoteToolInvocationProjection,
): McpToolResult => {
  const text =
    projection.status === "completed"
      ? projection.content ?? ""
      : projection.status === "awaiting_approval"
        ? `Tool ${projection.toolId} is awaiting approval for invocation ${projection.invocationId}. Resolve the exact invocation through the existing Remote V1 approval route.`
        : projection.error?.message ?? "Tool execution failed.";

  return {
    content: text ? [{ type: "text", text }] : [],
    structuredContent: {
      invocationId: projection.invocationId,
      toolId: projection.toolId,
      status: projection.status,
      ...(projection.approval ? { approval: projection.approval } : {}),
      ...(projection.error ? { error: projection.error } : {}),
    },
    isError: projection.status !== "completed",
  };
};

const initializeResult = (params: Record<string, unknown>) => {
  const requested =
    typeof params.protocolVersion === "string"
      ? params.protocolVersion
      : undefined;
  const protocolVersion =
    requested &&
    MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(
      requested as (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number],
    )
      ? requested
      : MCP_PROTOCOL_VERSION;

  return {
    protocolVersion,
    capabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
    },
    serverInfo: {
      name: REMOTE_MCP_SERVER_NAME,
      version: getAppMeta().version,
    },
    instructions:
      "Mira Desktop exposes the same eligible Tool Core/Harness tools used by Remote V1. tools/list is authoritative; the optional capability resource describes real groups only.",
  };
};

const listToolsResult = (catalog: RemoteToolCatalog) => ({
  tools: catalog.manifests.map((manifest) => {
    const definition = catalog.definitions.find(
      (candidate) => candidate.id === manifest.id,
    );
    const sideEffect = definition?.capabilities.sideEffect ?? "none";
    const annotations = {
      readOnlyHint: sideEffect === "none",
      destructiveHint:
        sideEffect === "local-write" || sideEffect === "process",
      idempotentHint: false,
      openWorldHint: sideEffect === "network" || sideEffect === "process",
    };
    return {
      name: manifest.name,
      title: definition?.title ?? manifest.id,
      description: manifest.description,
      inputSchema: manifest.parameters,
      annotations,
    };
  }),
});

const listResourcesResult = (manifest: RemoteServiceCapabilitiesManifest | null) => ({
  resources: manifest
    ? [
        {
          uri: REMOTE_MCP_RESOURCE_URI,
          name: REMOTE_MCP_RESOURCE_NAME,
          title: "Mira Desktop service capabilities",
          description:
            "Versioned, read-only semantic capability groups over the currently eligible Mira Desktop tools.",
          mimeType: REMOTE_MCP_RESOURCE_MIME_TYPE,
        },
      ]
    : [],
});

const readResourceResult = (
  manifest: RemoteServiceCapabilitiesManifest | null,
  uri: string,
) => {
  if (!manifest || uri !== REMOTE_MCP_RESOURCE_URI) {
    throw new JsonRpcError(-32002, "Resource not found");
  }
  return {
    contents: [
      {
        uri: REMOTE_MCP_RESOURCE_URI,
        mimeType: REMOTE_MCP_RESOURCE_MIME_TYPE,
        text: JSON.stringify(manifest),
      },
    ],
  };
};

const callTool = async (input: {
  request: FastifyRequest;
  catalog: RemoteToolCatalog;
  name: string;
  args: Record<string, unknown>;
}) => {
  const toolId = input.catalog.nameToId.get(input.name);
  if (!toolId) {
    throw new JsonRpcError(-32602, "Tool not found");
  }
  const scopes = remoteScopes(input.request);
  if (!scopes) {
    throw forbidden(
      "A paired remote device or official Cloud Host Grant is required",
    );
  }
  if (!scopes.includes("tools:invoke")) {
    throw new JsonRpcError(
      -32003,
      "Forbidden: tools:invoke scope is required",
    );
  }
  const userId = input.request.authUser?.id;
  if (typeof userId !== "number") {
    throw forbidden("Desktop authentication is required");
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  input.request.raw.once("aborted", abort);
  input.request.raw.once("close", abort);
  try {
    const projection = await executeRemoteToolInvocation({
      toolId,
      args: input.args,
      userId,
      signal: controller.signal,
    });
    return toMcpToolResult(projection);
  } finally {
    input.request.raw.off("aborted", abort);
    input.request.raw.off("close", abort);
  }
};

const parseJsonRpcRequest = (body: unknown): JsonRpcRequest => {
  if (!isRecord(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    throw new JsonRpcError(-32600, "Invalid JSON-RPC request");
  }
  if (
    Object.hasOwn(body, "id") &&
    body.id !== null &&
    typeof body.id !== "string" &&
    typeof body.id !== "number"
  ) {
    throw new JsonRpcError(-32600, "Invalid JSON-RPC request id");
  }
  if (body.params !== undefined && !isRecord(body.params)) {
    throw new JsonRpcError(-32602, "MCP params must be an object");
  }
  return body as JsonRpcRequest;
};

const remoteMcpRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: unknown }>(
    "/mcp",
    {
      bodyLimit: MCP_MAX_REQUEST_BODY_BYTES,
      schema: {
        tags: ["Remote Access"],
        summary: "Authenticated MCP Streamable HTTP endpoint",
        operationId: "handleRemoteMcpRequest",
      },
    },
    async (request, reply) => {
      // The endpoint is a remote per-device protocol outlet, not a second local
      // Desktop API. A Desktop JWT alone must not turn it into an MCP server.
      requireRemoteScope(request, "tools:read");

      const versionHeader = request.headers["mcp-protocol-version"];
      if (versionHeader !== undefined) {
        const value = Array.isArray(versionHeader)
          ? versionHeader[0]
          : versionHeader;
        if (
          typeof value !== "string" ||
          !MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(
            value as (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number],
          )
        ) {
          return reply
            .code(400)
            .type("application/json")
            .send(
              jsonRpcError(
                null,
                -32000,
                `Unsupported MCP protocol version. Supported: ${MCP_SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
              ),
            );
        }
      }

      let body: JsonRpcRequest;
      try {
        body = parseJsonRpcRequest(request.body);
      } catch (error) {
        if (error instanceof JsonRpcError) {
          return reply
            .code(error.code === -32600 ? 400 : 200)
            .type("application/json")
            .send(jsonRpcError(null, error.code, error.message, error.data));
        }
        throw error;
      }

      const hasId = Object.hasOwn(body, "id");
      const id = body.id ?? null;

      if (!hasId) {
        // Every JSON-RPC notification, including notifications/initialized and
        // notifications/cancelled, is transport-level input with no response.
        return reply.code(202).send();
      }

      try {
        switch (body.method) {
          case "initialize":
            return reply
              .type("application/json")
              .send(jsonRpcResult(id, initializeResult(body.params ?? {})));
          case "ping":
            return reply.type("application/json").send(jsonRpcResult(id, {}));
          case "tools/list": {
            const catalog = await resolveRemoteToolCatalog();
            return reply
              .type("application/json")
              .send(jsonRpcResult(id, listToolsResult(catalog)));
          }
          case "tools/call": {
            const params = body.params ?? {};
            const name = params.name;
            if (typeof name !== "string" || !name) {
              throw new JsonRpcError(-32602, "tools/call requires a tool name");
            }
            if (params.arguments !== undefined && !isRecord(params.arguments)) {
              throw new JsonRpcError(-32602, "tools/call arguments must be an object");
            }
            const catalog = await resolveRemoteToolCatalog();
            const result = await callTool({
              request,
              catalog,
              name,
              args:
                params.arguments === undefined
                  ? {}
                  : (params.arguments as Record<string, unknown>),
            });
            return reply.type("application/json").send(jsonRpcResult(id, result));
          }
          case "resources/list": {
            const catalog = await resolveRemoteToolCatalog();
            return reply
              .type("application/json")
              .send(
                jsonRpcResult(
                  id,
                  listResourcesResult(manifestForCatalog(catalog)),
                ),
              );
          }
          case "resources/read": {
            const uri = body.params?.uri;
            if (typeof uri !== "string" || !uri) {
              throw new JsonRpcError(-32602, "resources/read requires a uri");
            }
            const catalog = await resolveRemoteToolCatalog();
            return reply
              .type("application/json")
              .send(
                jsonRpcResult(
                  id,
                  readResourceResult(manifestForCatalog(catalog), uri),
                ),
              );
          }
          default:
            throw new JsonRpcError(-32601, "Method not found");
        }
      } catch (error) {
        if (error instanceof JsonRpcError) {
          return reply
            .type("application/json")
            .send(jsonRpcError(id, error.code, error.message, error.data));
        }
        if (isAppError(error)) {
          return reply
            .type("application/json")
            .send(jsonRpcError(id, -32602, error.message));
        }
        request.log.error(
          { err: error, method: body.method },
          "Remote MCP request failed",
        );
        return reply
          .type("application/json")
          .send(jsonRpcError(id, -32603, "MCP request failed"));
      }
    },
  );
};

export default remoteMcpRoute;
