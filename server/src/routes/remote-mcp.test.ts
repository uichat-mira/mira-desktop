import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendRouteError } from "@/utils/route-errors.js";
import type { ToolDefinition } from "@/mcp/core/definitions.js";

const externalTool = vi.hoisted((): ToolDefinition => ({
  id: "mcp:test-server:tool:lookup",
  title: "External Lookup",
  description: "A real ungrouped external tool",
  domain: "external_mcp",
  source: "external",
  sourceLabel: "Test Server",
  mode: "sync",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
  },
  tags: ["external"],
  capabilities: { sideEffect: "none", requiresApproval: false },
}));

vi.mock("@/mcp/bootstrap.js", () => ({
  initializeHarnessRuntime: vi.fn(),
}));

vi.mock("@/mcp/external.js", () => ({
  resolveAgentEligibleExternalMcpCapabilities: () => [externalTool],
}));

import {
  clearHarnessRegistry,
  registerTool,
} from "@/harness/registry.js";
import { clearHarnessInvocations } from "@/harness/invocations.js";
import { describeRemoteToolAdmission } from "@/services/remote-tool-gateway.service.js";
import remoteMcpRoute, { MCP_PROTOCOL_VERSION } from "./remote-mcp.js";

const readDefinition: ToolDefinition = {
  id: "read",
  title: "Read",
  description: "Read a workspace path",
  domain: "read",
  source: "internal",
  mode: "sync",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    additionalProperties: true,
  },
  tags: ["read"],
  capabilities: { sideEffect: "none", requiresApproval: false },
};

const writeDefinition: ToolDefinition = {
  id: "write",
  title: "Write",
  description: "Write a workspace file",
  domain: "edit",
  source: "internal",
  mode: "sync",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  tags: ["write"],
  capabilities: { sideEffect: "local-write", requiresApproval: true },
};

const applyPatchDefinition: ToolDefinition = {
  id: "apply_patch",
  title: "Apply Patch",
  description: "Apply a governed workspace patch",
  domain: "edit",
  source: "internal",
  mode: "sync",
  inputSchema: {
    type: "object",
    properties: { patchText: { type: "string" } },
    required: ["patchText"],
  },
  tags: ["edit"],
  capabilities: { sideEffect: "local-write", requiresApproval: true },
};

const nonCoreDefinition: ToolDefinition = {
  id: "github_repository",
  title: "GitHub Repository",
  description: "Registered but not part of the curated core scope",
  domain: "github",
  source: "internal",
  mode: "sync",
  inputSchema: { type: "object" },
  tags: ["github"],
  capabilities: { sideEffect: "network", requiresApproval: true },
};

const unavailableCoreDefinition: ToolDefinition = {
  id: "terminal",
  title: "Terminal",
  description: "Core terminal Tool with an unavailable runtime",
  domain: "terminal",
  source: "internal",
  mode: "stream",
  inputSchema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  tags: ["terminal"],
  capabilities: { sideEffect: "process", requiresApproval: true },
};

const unavailableDefinition: ToolDefinition = {
  id: "unavailable_tool",
  title: "Unavailable",
  description: "Not ready",
  domain: "read",
  source: "internal",
  mode: "sync",
  inputSchema: { type: "object" },
  tags: [],
  capabilities: { sideEffect: "none", requiresApproval: false },
};

const user = { id: 7, username: "tester", role: "user" as const };
const MCP_META = {
  "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

const requestHeaders = (method: string, name?: string) => ({
  "mcp-protocol-version": MCP_PROTOCOL_VERSION,
  "mcp-method": method,
  ...(name ? { "mcp-name": name } : {}),
});

const requestParams = (params: Record<string, unknown> = {}) => ({
  ...params,
  _meta: MCP_META,
});

const writeExecute = vi.fn(() => ({
  content: [{ type: "text", text: "should not execute" }],
  isError: false,
}));
const nonCoreExecute = vi.fn(() => ({
  content: [{ type: "text", text: "should not execute" }],
  isError: false,
}));

const installTestTools = () => {
  registerTool({
    definition: readDefinition,
    execute: ({ args }) => ({
      content: [
        {
          type: "text",
          text: `read:${typeof args.path === "string" ? args.path : ""}`,
        },
      ],
      structuredContent: { path: args.path ?? null },
    }),
  });
  registerTool({
    definition: writeDefinition,
    execute: writeExecute,
  });
  registerTool({
    definition: applyPatchDefinition,
    execute: () => ({ content: [{ type: "text", text: "patched" }] }),
  });
  registerTool({
    definition: nonCoreDefinition,
    execute: nonCoreExecute,
  });
  registerTool(
    {
      definition: unavailableCoreDefinition,
      execute: () => ({ content: [{ type: "text", text: "should not run" }] }),
    },
    {
      resolveReadiness: () => ({
        state: "unavailable",
        reason: "Terminal sandbox is unavailable.",
        code: "terminal_sandbox_unavailable",
      }),
    },
  );
  registerTool(
    {
      definition: unavailableDefinition,
      execute: () => ({ content: [{ type: "text", text: "should not run" }] }),
    },
    {
      resolveReadiness: () => ({
        state: "unavailable",
        reason: "Runtime is not ready.",
        code: "not_ready",
      }),
    },
  );
  registerTool({
    definition: externalTool,
    execute: () => ({
      content: [{ type: "text", text: "external result" }],
    }),
  });
};

const createApp = async (options: {
  scopes?: string[];
  cloud?: boolean;
  localJwtOnly?: boolean;
} = {}) => {
  const app = Fastify();
  app.setErrorHandler(sendRouteError);
  app.addHook("preHandler", async (request) => {
    if (!options.localJwtOnly) {
      request.authUser = user;
    } else {
      request.authUser = user;
    }
    if (options.localJwtOnly) return;
    const scopes = options.scopes ?? ["tools:read", "tools:invoke"];
    if (options.cloud) {
      request.cloudRemoteCaller = {
        kind: "cloud",
        accountId: "account-a",
        hostId: "host-a",
        mobileDeviceId: "phone-a",
        revision: 3,
        scopes,
        owner: user,
      };
    } else {
      request.remoteDevice = {
        id: "device-1",
        userId: user.id,
        name: "K70",
        platform: "android",
        publicKey: null,
        tokenHash: "hash",
        permissions: scopes as never,
        createdAt: "2026-11-24T00:00:00.000Z",
        lastSeenAt: null,
      };
    }
  });
  await app.register(remoteMcpRoute);
  return app;
};

const rpc = async (
  app: FastifyInstance,
  method: string,
  params: Record<string, unknown> = {},
  id: number | null = 1,
) => {
  const name =
    typeof params.name === "string"
      ? params.name
      : typeof params.uri === "string"
        ? params.uri
        : undefined;
  const response = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: requestHeaders(method, name),
    payload: {
      jsonrpc: "2.0",
      ...(id === null ? {} : { id }),
      method,
      params: requestParams(params),
    },
  });
  return {
    response,
    body: response.body ? response.json() : null,
  };
};

beforeEach(() => {
  clearHarnessRegistry();
  clearHarnessInvocations();
  writeExecute.mockClear();
  nonCoreExecute.mockClear();
  installTestTools();
});

afterAll(() => {
  clearHarnessRegistry();
  clearHarnessInvocations();
});

describe("remote MCP outlet", () => {
  it("discovers the one stable mira-desktop service identity for a Direct device", async () => {
    const app = await createApp();

    const { response, body } = await rpc(app, "server/discover");

    assert.equal(response.statusCode, 200, response.body);
    expect(body.result).toMatchObject({
      resultType: "complete",
      supportedVersions: [MCP_PROTOCOL_VERSION],
      capabilities: {
        tools: {},
        resources: {},
      },
    });
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({
      name: "mira-desktop",
    });
    expect(
      body.result._meta["io.modelcontextprotocol/serverInfo"].version,
    ).toMatch(/\d+\.\d+\.\d+/u);
    await app.close();
  });

  it("lists exactly the genuine eligible core projection with the original schemas", async () => {
    const app = await createApp();

    const { response, body } = await rpc(app, "tools/list");
    assert.equal(response.statusCode, 200, response.body);
    expect(body.result.resultType).toBe("complete");
    const tools = body.result.tools as Array<Record<string, unknown>>;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "apply_patch",
      "read",
      "write",
    ]);
    const read = tools.find((tool) => tool.name === "read");
    expect(read).toMatchObject({
      name: "read",
      description: readDefinition.description,
      inputSchema: readDefinition.inputSchema,
      annotations: { readOnlyHint: true },
    });
    expect(tools.some((tool) => tool.name === "github_repository")).toBe(false);
    expect(tools.some((tool) => tool.name === "unavailable_tool")).toBe(false);
    expect(tools.some((tool) => tool.name === "terminal")).toBe(false);
    expect(tools.some((tool) => String(tool.name).startsWith("mcp"))).toBe(false);
    await app.close();
  });

  it("reports the core mapping and the exact reason a registered core Tool is unavailable", async () => {
    const app = await createApp();
    const admission = await describeRemoteToolAdmission();

    expect(admission.coreProfiles.map((profile) => profile.id).sort()).toEqual([
      "terminal_execution",
      "workspace_edit",
      "workspace_lookup",
    ]);
    expect(admission.exposedCoreToolIds.sort()).toEqual([
      "apply_patch",
      "read",
      "write",
    ]);
    expect(admission.excludedCoreTools).toEqual([
      {
        toolId: "terminal",
        reason: "Terminal sandbox is unavailable.",
      },
    ]);
    expect(admission.nonCoreRegisteredToolIds).toEqual(
      expect.arrayContaining(["github_repository", "unavailable_tool"]),
    );
    await app.close();
  });

  it("publishes only real semantic groups and keeps an ungrouped tool in tools/list", async () => {
    const app = await createApp();

    const tools = (await rpc(app, "tools/list")).body.result.tools as Array<{
      name: string;
    }>;
    const list = await rpc(app, "resources/list");
    assert.equal(list.response.statusCode, 200, list.response.body);
    expect(list.body.result.resources).toEqual([
      expect.objectContaining({
        uri: "mira://service/mira-desktop/capabilities",
        mimeType: "application/json",
      }),
    ]);

    const read = await rpc(app, "resources/read", {
      uri: "mira://service/mira-desktop/capabilities",
    });
    assert.equal(read.response.statusCode, 200, read.response.body);
    const manifest = JSON.parse(read.body.result.contents[0].text);
    expect(manifest).toMatchObject({
      schema: "mira.service-capabilities/v1",
      service: {
        id: "mira-desktop",
        mcp: {
          serverName: "mira-desktop",
          protocolVersions: [MCP_PROTOCOL_VERSION],
        },
      },
    });
    const capabilityToolNames = new Set(
      manifest.capabilities.flatMap((capability: { tools: string[] }) =>
        capability.tools,
      ),
    );
    expect(capabilityToolNames.has("read")).toBe(true);
    expect(capabilityToolNames.has("write")).toBe(true);
    expect(capabilityToolNames.has("mcp_test_server_tool_lookup")).toBe(false);
    for (const name of capabilityToolNames) {
      expect(tools.some((tool) => tool.name === name)).toBe(true);
    }

    const missing = await rpc(app, "resources/read", {
      uri: "mira://service/mira-desktop/missing",
    });
    expect(missing.response.statusCode).toBe(200);
    expect(missing.body.error).toMatchObject({ code: -32602 });
    await app.close();
  });

  it("executes a safe read-only tool through the existing Harness invocation chain", async () => {
    const app = await createApp();

    const { response, body } = await rpc(app, "tools/call", {
      name: "read",
      arguments: { path: "README.md" },
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(body.result).toMatchObject({
      resultType: "complete",
      isError: false,
      content: [{ type: "text", text: expect.stringContaining("read:README.md") }],
      structuredContent: {
        toolId: "read",
        status: "completed",
      },
    });
    expect(body.result.structuredContent.invocationId).toMatch(/\S+/u);
    await app.close();
  });

  it("rejects browser origins before executing any native remote MCP request", async () => {
    for (const cloud of [false, true]) {
      const app = await createApp({ cloud });
      try {
        for (const origin of ["https://untrusted.example", "null"]) {
          const response = await app.inject({
            method: "POST", url: "/mcp",
            headers: { ...requestHeaders("server/discover"), origin },
            payload: { jsonrpc: "2.0", id: 1, method: "server/discover", params: requestParams() },
          });
          expect(response.statusCode).toBe(403);
        }
        expect((await rpc(app, "server/discover")).response.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    }
  });

  it("speaks the protocol over a real listening Fastify HTTP client", async () => {
    const app = await createApp();
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const discovered = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
          "mcp-method": "server/discover",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "discover",
          method: "server/discover",
          params: { _meta: MCP_META },
        }),
      });
      expect(discovered.status).toBe(200);
      expect(discovered.headers.get("content-type")).toContain("application/json");
      const discoveredBody = await discovered.json();
      expect(discoveredBody.result.supportedVersions).toEqual([
        MCP_PROTOCOL_VERSION,
      ]);
      expect(
        discoveredBody.result._meta["io.modelcontextprotocol/serverInfo"].name,
      ).toBe("mira-desktop");

      const called = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
          "mcp-method": "tools/call",
          "mcp-name": "read",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "read",
            arguments: { path: "http.txt" },
            _meta: MCP_META,
          },
        }),
      });
      expect(called.status).toBe(200);
      const body = await called.json();
      expect(body.result).toMatchObject({
        resultType: "complete",
        isError: false,
        content: [
          { type: "text", text: expect.stringContaining("read:http.txt") },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("uses the same MCP identity and tool projection for an official Cloud grant caller", async () => {
    const app = await createApp({ cloud: true });

    const discovered = await rpc(app, "server/discover");
    expect(
      discovered.body.result._meta["io.modelcontextprotocol/serverInfo"].name,
    ).toBe("mira-desktop");
    const called = await rpc(app, "tools/call", {
      name: "read",
      arguments: { path: "cloud.txt" },
    });
    expect(called.body.result).toMatchObject({
      resultType: "complete",
      isError: false,
      content: [{ type: "text", text: expect.stringContaining("read:cloud.txt") }],
    });
    await app.close();
  });

  it("denies a Desktop JWT without remote device or Cloud authority", async () => {
    const app = await createApp({ localJwtOnly: true });

    const { response } = await rpc(app, "server/discover");

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("denies missing discovery scope at the endpoint and missing invoke scope at tools/call", async () => {
    const noRead = await createApp({ scopes: ["tools:invoke"] });
    const deniedDiscovery = await rpc(noRead, "tools/list");
    expect(deniedDiscovery.response.statusCode).toBe(403);
    await noRead.close();

    const readOnly = await createApp({ scopes: ["tools:read"] });
    const deniedCall = await rpc(readOnly, "tools/call", {
      name: "read",
      arguments: { path: "README.md" },
    });
    expect(deniedCall.response.statusCode).toBe(200);
    expect(deniedCall.body.error).toMatchObject({ code: -32003 });
    await readOnly.close();
  });

  it("rejects an unknown tool without executing anything", async () => {
    const app = await createApp();

    const { body } = await rpc(app, "tools/call", {
      name: "not_a_real_tool",
      arguments: {},
    });

    expect(body.error).toMatchObject({ code: -32602 });
    expect(writeExecute).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a registered non-core tool without executing anything", async () => {
    const app = await createApp();

    const { body } = await rpc(app, "tools/call", {
      name: "github_repository",
      arguments: {},
    });

    expect(body.error).toMatchObject({ code: -32602 });
    expect(nonCoreExecute).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns the existing exact-call approval checkpoint instead of executing a side effect", async () => {
    const app = await createApp();

    const { body } = await rpc(app, "tools/call", {
      name: "write",
      arguments: { path: "notes.txt", content: "hello" },
    });

    expect(body.result).toMatchObject({
      isError: true,
      structuredContent: {
        toolId: "write",
        status: "awaiting_approval",
        approval: {
          message: expect.stringContaining("approval"),
        },
      },
    });
    expect(body.result.structuredContent.invocationId).toMatch(/\S+/u);
    expect(writeExecute).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects the legacy notifications/initialized handshake notification", async () => {
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: requestHeaders("notifications/initialized"),
      payload: { jsonrpc: "2.0", method: "notifications/initialized" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: -32601 });
    await app.close();
  });

  it("rejects the legacy initialize handshake without transparent compatibility", async () => {
    const app = await createApp();

    const modernShaped = await rpc(app, "initialize");
    expect(modernShaped.response.statusCode).toBe(404);
    expect(modernShaped.body.error).toMatchObject({
      code: -32601,
      data: { supported: [MCP_PROTOCOL_VERSION] },
    });

    const legacyShaped = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "legacy-client", version: "1" },
        },
      },
    });
    expect(legacyShaped.statusCode).toBe(400);
    expect(legacyShaped.json().error).toMatchObject({
      code: -32020,
      data: { supported: [MCP_PROTOCOL_VERSION] },
    });
    await app.close();
  });

  it("rejects an unsupported MCP protocol version with the supported list", async () => {
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "mcp-protocol-version": "2025-06-18",
        "mcp-method": "ping",
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2025-06-18",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: -32022,
      data: {
        supported: [MCP_PROTOCOL_VERSION],
        requested: "2025-06-18",
      },
    });
    await app.close();
  });

  it("rejects missing or mismatched request metadata and mirrored headers", async () => {
    const app = await createApp();

    const missingVersion = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-method": "ping" },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: { _meta: MCP_META },
      },
    });
    expect(missingVersion.statusCode).toBe(400);
    expect(missingVersion.json().error.code).toBe(-32020);

    const missingMeta = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: requestHeaders("ping"),
      payload: { jsonrpc: "2.0", id: 1, method: "ping", params: {} },
    });
    expect(missingMeta.statusCode).toBe(400);
    expect(missingMeta.json().error.code).toBe(-32602);

    const versionMismatch = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: requestHeaders("ping"),
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: {
          _meta: {
            ...MCP_META,
            "io.modelcontextprotocol/protocolVersion": "2025-06-18",
          },
        },
      },
    });
    expect(versionMismatch.statusCode).toBe(400);
    expect(versionMismatch.json().error.code).toBe(-32020);

    const methodMismatch = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: requestHeaders("tools/list"),
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: { _meta: MCP_META },
      },
    });
    expect(methodMismatch.statusCode).toBe(400);
    expect(methodMismatch.json().error.code).toBe(-32020);

    const missingName = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: requestHeaders("tools/call"),
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read", arguments: { path: "README.md" }, _meta: MCP_META },
      },
    });
    expect(missingName.statusCode).toBe(400);
    expect(missingName.json().error.code).toBe(-32020);
    expect(writeExecute).not.toHaveBeenCalled();
    await app.close();
  });

  it("decodes the Base64 Mcp-Name sentinel before comparing it with the body", async () => {
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        "mcp-method": "tools/call",
        "mcp-name": `=?base64?${Buffer.from("read").toString("base64")}?=`,
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "read",
          arguments: { path: "b64.txt" },
          _meta: MCP_META,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.structuredContent).toMatchObject({
      toolId: "read",
      status: "completed",
    });
    await app.close();
  });

  it("returns 404 for unknown methods and 405 for legacy GET/DELETE session traffic", async () => {
    const app = await createApp();

    const unknown = await rpc(app, "tools/unknown");
    expect(unknown.response.statusCode).toBe(404);
    expect(unknown.body.error).toMatchObject({ code: -32601 });

    for (const method of ["GET", "DELETE"]) {
      const response = await app.inject({ method, url: "/mcp" });
      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe("POST");
    }
    await app.close();
  });
});
