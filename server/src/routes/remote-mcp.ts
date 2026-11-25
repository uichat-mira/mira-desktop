import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { isAppError } from "@/utils/errors.js";
import { forbidden } from "@/utils/route-errors.js";
import {
  REMOTE_MCP_PROTOCOL_VERSION,
  REMOTE_MCP_RESOURCE_MIME_TYPE,
  REMOTE_MCP_RESOURCE_NAME,
  REMOTE_MCP_RESOURCE_URI,
  REMOTE_MCP_SERVER_NAME,
  REMOTE_MCP_SUPPORTED_PROTOCOL_VERSIONS,
  createRemoteServiceCapabilitiesManifest,
  type RemoteServiceCapabilitiesManifest,
} from "@/mcp/remote-service-capabilities.js";
import {
  executeRemoteToolInvocation,
  resolveRemoteToolCatalog,
  type RemoteToolCatalog,
  type RemoteToolInvocationProjection,
} from "@/services/remote-tool-gateway.service.js";
import {
  readCloudRemoteThreadContext,
  RemoteThreadWorkspaceError,
} from "@/services/remote-thread-workspace.service.js";
import { getAppMeta } from "@/utils/index.js";

export const MCP_PROTOCOL_VERSION = REMOTE_MCP_PROTOCOL_VERSION;
export const MCP_SUPPORTED_PROTOCOL_VERSIONS =
  REMOTE_MCP_SUPPORTED_PROTOCOL_VERSIONS;

const MCP_MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MCP_META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const MCP_META_CLIENT_CAPABILITIES =
  "io.modelcontextprotocol/clientCapabilities";
const MCP_META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

type JsonRpcId = string | number;

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
    readonly statusCode = 200,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isSupportedProtocolVersion = (
  value: string,
): value is (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number] =>
  (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value);

const unsupportedProtocolVersion = (requested: string) =>
  new JsonRpcError(
    -32022,
    `Unsupported MCP protocol version: ${requested}`,
    {
      supported: [...MCP_SUPPORTED_PROTOCOL_VERSIONS],
      requested,
    },
    400,
  );

const headerMismatch = (message: string) =>
  new JsonRpcError(-32020, `Header mismatch: ${message}`, undefined, 400);

const singleHeader = (
  request: FastifyRequest,
  name: string,
): string | undefined => {
  const value = request.headers[name];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw headerMismatch(`Multiple ${name} headers were sent`);
    }
    return value[0];
  }
  return value;
};

const MCP_NAME_HEADER_ENCODING = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/u;

// Streamable HTTP mirrors Mcp-Name/Mcp-Param-* body values into headers and may
// Base64-encode values that are not header-safe. Only Mcp-Name is used here.
const decodeHeaderValue = (value: string) => {
  const match = MCP_NAME_HEADER_ENCODING.exec(value);
  return match ? Buffer.from(match[1], "base64").toString("utf8") : value;
};

const serverImplementation = () => ({
  name: REMOTE_MCP_SERVER_NAME,
  version: getAppMeta().version,
});

const jsonRpcResult = (id: JsonRpcId, result: Record<string, unknown>) => ({
  jsonrpc: "2.0" as const,
  id,
  result: {
    resultType: "complete" as const,
    ...result,
    _meta: {
      ...(isRecord(result._meta) ? result._meta : {}),
      [MCP_META_SERVER_INFO]: serverImplementation(),
    },
  },
});

const jsonRpcError = (
  id: JsonRpcId | null,
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

const discoverResult = () => ({
  supportedVersions: [...MCP_SUPPORTED_PROTOCOL_VERSIONS],
  capabilities: {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
  },
  instructions:
    "Mira Desktop exposes the same eligible Tool Core/Harness tools used by Remote V1. tools/list is authoritative; the optional capability resource describes real groups only.",
});

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

const listResourcesResult = (
  manifest: RemoteServiceCapabilitiesManifest | null,
) => ({
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
    throw new JsonRpcError(-32602, "Resource not found", { uri });
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

  const isCloud = Boolean(input.request.cloudRemoteCaller);
  const threadContext = isCloud
    ? readCloudRemoteThreadContext(input.request)
    : null;

  const controller = new AbortController();
  const abort = () => controller.abort();
  input.request.raw.once("aborted", abort);
  input.request.raw.once("close", abort);
  try {
    const projection = await executeRemoteToolInvocation({
      toolId,
      args: input.args,
      userId,
      ...(threadContext ? { threadContext } : {}),
      ...(isCloud ? { requireThreadContext: true } : {}),
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
    throw new JsonRpcError(-32600, "Invalid JSON-RPC request", undefined, 400);
  }
  if (
    Object.hasOwn(body, "id") &&
    (body.id === null ||
      (typeof body.id !== "string" && typeof body.id !== "number"))
  ) {
    throw new JsonRpcError(-32600, "Invalid JSON-RPC request id", undefined, 400);
  }
  if (body.params !== undefined && !isRecord(body.params)) {
    throw new JsonRpcError(-32602, "MCP params must be an object");
  }
  return body as JsonRpcRequest;
};

const requireRequestMetadata = (request: FastifyRequest, body: JsonRpcRequest) => {
  const headerVersion = singleHeader(request, "mcp-protocol-version");
  if (!headerVersion) {
    throw headerMismatch("MCP-Protocol-Version header is required");
  }
  if (!isSupportedProtocolVersion(headerVersion)) {
    throw unsupportedProtocolVersion(headerVersion);
  }

  const meta = body.params?._meta;
  if (!isRecord(meta)) {
    throw new JsonRpcError(
      -32602,
      "MCP request metadata is required in params._meta",
      undefined,
      400,
    );
  }
  const bodyVersion = meta[MCP_META_PROTOCOL_VERSION];
  if (typeof bodyVersion !== "string") {
    throw new JsonRpcError(
      -32602,
      `${MCP_META_PROTOCOL_VERSION} is required in params._meta`,
      undefined,
      400,
    );
  }
  if (bodyVersion !== headerVersion) {
    throw headerMismatch(
      `MCP-Protocol-Version '${headerVersion}' does not match the request body '${bodyVersion}'`,
    );
  }
  if (!isRecord(meta[MCP_META_CLIENT_CAPABILITIES])) {
    throw new JsonRpcError(
      -32602,
      `${MCP_META_CLIENT_CAPABILITIES} is required in params._meta`,
      undefined,
      400,
    );
  }
};

const requireMethodHeader = (request: FastifyRequest, body: JsonRpcRequest) => {
  const method = singleHeader(request, "mcp-method");
  if (!method) {
    throw headerMismatch("Mcp-Method header is required");
  }
  if (method !== body.method) {
    throw headerMismatch(
      `Mcp-Method '${method}' does not match the request body '${body.method}'`,
    );
  }
};

const requireNameHeader = (request: FastifyRequest, value: string) => {
  const header = singleHeader(request, "mcp-name");
  if (!header) {
    throw headerMismatch("Mcp-Name header is required");
  }
  if (decodeHeaderValue(header) !== value) {
    throw headerMismatch(
      `Mcp-Name '${header}' does not match the request body '${value}'`,
    );
  }
};

const sendJsonRpcError = (
  reply: FastifyReply,
  id: JsonRpcId | null,
  error: JsonRpcError,
  method?: string,
) => {
  // A modern-only server names its supported versions for initialize requests:
  // legacy clients have no fall-forward mechanism to discover them otherwise.
  const data =
    error.data ??
    (method === "initialize"
      ? { supported: [...MCP_SUPPORTED_PROTOCOL_VERSIONS] }
      : undefined);
  return reply
    .code(error.statusCode)
    .type("application/json")
    .send(jsonRpcError(id, error.code, error.message, data));
};

const remoteMcpRoute: FastifyPluginAsync = async (app) => {
  // Remote MCP is a native paired-device/Host Grant outlet, not a browser
  // endpoint. No browser Origin is authorized for this route. Fail closed
  // before resolving tools, including when an authenticated token is present.
  app.addHook("onRequest", async (request, reply) => {
    if (request.headers.origin !== undefined) {
      return reply.code(403).type("application/json").send(
        jsonRpcError(null, -32600, "Browser Origin is not allowed on Remote MCP"),
      );
    }
  });

  // This revision removed the GET stream and DELETE session endpoint.
  app.route({
    method: ["GET", "DELETE"],
    url: "/mcp",
    handler: async (_request, reply) =>
      reply
        .code(405)
        .header("allow", "POST")
        .type("application/json")
        .send(
          jsonRpcError(
            null,
            -32601,
            "MCP 2026-07-28 is a stateless POST endpoint; GET streams and DELETE sessions are not supported.",
          ),
        ),
  });

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

      let body: JsonRpcRequest;
      try {
        body = parseJsonRpcRequest(request.body);
      } catch (error) {
        if (error instanceof JsonRpcError) {
          return sendJsonRpcError(reply, null, error);
        }
        throw error;
      }

      if (!Object.hasOwn(body, "id")) {
        // 2026-07-28 defines no client-to-server notifications on Streamable
        // HTTP; connection close is the cancellation signal.
        return reply
          .code(400)
          .type("application/json")
          .send(
            jsonRpcError(
              null,
              -32601,
              "MCP notifications are not part of the 2026-07-28 Streamable HTTP contract.",
            ),
          );
      }

      const id = body.id as JsonRpcId;

      try {
        requireRequestMetadata(request, body);
        requireMethodHeader(request, body);

        switch (body.method) {
          case "server/discover":
            return reply
              .type("application/json")
              .send(jsonRpcResult(id, discoverResult()));
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
            requireNameHeader(request, name);
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
            requireNameHeader(request, uri);
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
          case "initialize":
            throw new JsonRpcError(
              -32601,
              "MCP initialize is not supported. Mira Desktop Remote MCP implements only protocol 2026-07-28; use server/discover and per-request _meta.",
              { supported: [...MCP_SUPPORTED_PROTOCOL_VERSIONS] },
              404,
            );
          default:
            throw new JsonRpcError(-32601, "Method not found", undefined, 404);
        }
      } catch (error) {
        if (error instanceof JsonRpcError) {
          return sendJsonRpcError(reply, id, error, body.method);
        }
        if (error instanceof RemoteThreadWorkspaceError) {
          return reply
            .type("application/json")
            .send(
              jsonRpcError(id, -32010, error.message, {
                code: error.code,
              }),
            );
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
