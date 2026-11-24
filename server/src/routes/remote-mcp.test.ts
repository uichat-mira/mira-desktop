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
const writeExecute = vi.fn(() => ({
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
  params?: Record<string, unknown>,
  id: number | null = 1,
) => {
  const response = await app.inject({
    method: "POST",
    url: "/mcp",
    payload: {
      jsonrpc: "2.0",
      ...(id === null ? {} : { id }),
      method,
      ...(params ? { params } : {}),
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
  installTestTools();
});

afterAll(() => {
  clearHarnessRegistry();
  clearHarnessInvocations();
});

describe("remote MCP outlet", () => {
  it("initializes the one stable mira-desktop service identity for a Direct device", async () => {
    const app = await createApp();

    const { response, body } = await rpc(app, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      clientInfo: { name: "test-client", version: "1" },
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(body.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: "mira-desktop" },
      capabilities: {
        tools: {},
        resources: {},
      },
    });
    expect(body.result.serverInfo.version).toMatch(/\d+\.\d+\.\d+/u);
    await app.close();
  });

  it("lists exactly the genuine eligible projection with the original schemas", async () => {
    const app = await createApp();

    const { response, body } = await rpc(app, "tools/list");
    assert.equal(response.statusCode, 200, response.body);
    const tools = body.result.tools as Array<Record<string, unknown>>;
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["read", "write"]),
    );
    const read = tools.find((tool) => tool.name === "read");
    expect(read).toMatchObject({
      name: "read",
      description: readDefinition.description,
      inputSchema: readDefinition.inputSchema,
      annotations: { readOnlyHint: true },
    });
    const external = tools.find((tool) => String(tool.name).startsWith("mcp"));
    expect(external).toBeDefined();
    expect(external!.name).not.toContain(":");
    expect(external!.inputSchema).toEqual(externalTool.inputSchema);
    expect(tools.some((tool) => tool.name === "unavailable_tool")).toBe(false);
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
    expect(missing.body.error).toMatchObject({ code: -32002 });
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

  it("speaks the protocol over a real listening Fastify HTTP client", async () => {
    const app = await createApp();
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const initialized = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init",
          method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "http-client", version: "1" },
          },
        }),
      });
      expect(initialized.status).toBe(200);
      expect(initialized.headers.get("content-type")).toContain("application/json");
      expect((await initialized.json()).result.serverInfo.name).toBe("mira-desktop");

      const called = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "read", arguments: { path: "http.txt" } },
        }),
      });
      expect(called.status).toBe(200);
      const body = await called.json();
      expect(body.result).toMatchObject({
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

    const initialized = await rpc(app, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "cloud-client", version: "1" },
    });
    expect(initialized.body.result.serverInfo.name).toBe("mira-desktop");
    const called = await rpc(app, "tools/call", {
      name: "read",
      arguments: { path: "cloud.txt" },
    });
    expect(called.body.result).toMatchObject({
      isError: false,
      content: [{ type: "text", text: expect.stringContaining("read:cloud.txt") }],
    });
    await app.close();
  });

  it("denies a Desktop JWT without remote device or Cloud authority", async () => {
    const app = await createApp({ localJwtOnly: true });

    const { response } = await rpc(app, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
    });

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

  it("accepts notifications without a JSON-RPC response", async () => {
    const app = await createApp();

    const { response } = await rpc(app, "notifications/initialized", undefined, null);

    expect(response.statusCode).toBe(202);
    expect(response.body).toBe("");
    await app.close();
  });

  it("rejects an unsupported negotiated protocol header", async () => {
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": "1900-01-01" },
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe(-32000);
    await app.close();
  });
});
