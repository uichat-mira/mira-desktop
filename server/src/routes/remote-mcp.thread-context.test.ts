import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { sendRouteError } from "@/utils/route-errors.js";
import type { ToolDefinition } from "@/mcp/core/definitions.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  catalog: vi.fn(),
}));

vi.mock("@/services/remote-tool-gateway.service.js", () => ({
  executeRemoteToolInvocation: mocks.execute,
  resolveRemoteToolCatalog: mocks.catalog,
}));

import { RemoteThreadWorkspaceError } from "@/services/remote-thread-workspace.service.js";
import remoteMcpRoute from "./remote-mcp.js";

const definition: ToolDefinition = {
  id: "read",
  title: "Read",
  description: "Read",
  domain: "read",
  source: "internal",
  mode: "sync",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
  },
  tags: [],
  capabilities: {
    sideEffect: "none",
    requiresApproval: false,
    workspaceBound: true,
  },
};

const createApp = async (cloud: boolean): Promise<FastifyInstance> => {
  const app = Fastify();
  app.setErrorHandler(sendRouteError);
  app.addHook("preHandler", async (request) => {
    request.authUser = { id: 7, username: "tester", role: "user" };
    if (cloud) {
      request.cloudRemoteCaller = {
        kind: "cloud",
        accountId: "account-a",
        hostId: "host-a",
        mobileDeviceId: "phone-a",
        revision: 1,
        scopes: ["tools:read", "tools:invoke"],
        owner: { id: 7, username: "tester", role: "user" },
      };
    } else {
      request.remoteDevice = {
        id: "device-1",
        userId: 7,
        name: "K70",
        platform: "android",
        publicKey: null,
        tokenHash: "hash",
        permissions: ["tools:read", "tools:invoke"],
        createdAt: "2026-11-25T00:00:00.000Z",
        lastSeenAt: null,
      };
    }
  });
  await app.register(remoteMcpRoute);
  return app;
};

const call = (
  app: FastifyInstance,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: "POST",
    url: "/mcp",
    headers,
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "read",
        arguments: { path: "note.txt" },
      },
    },
  });

mocks.catalog.mockResolvedValue({
  definitions: [definition],
  manifests: [
    {
      id: "read",
      name: "read",
      description: "Read",
      parameters: definition.inputSchema,
      destructive: false,
      requiresApproval: false,
    },
  ],
  nameToId: new Map([["read", "read"]]),
  idToName: new Map([["read", "read"]]),
});

describe("official Cloud MCP thread context route", () => {
  it("passes the trusted Cloud identity and thread header to execution", async () => {
    mocks.execute.mockResolvedValueOnce({
      invocationId: "inv-1",
      toolId: "read",
      status: "completed",
      content: "ok",
    });
    const app = await createApp(true);

    const response = await call(app, { "x-mira-thread-id": "thread-1" });

    expect(response.statusCode).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "read",
        userId: 7,
        requireThreadContext: true,
        threadContext: {
          threadId: "thread-1",
          identity: {
            accountId: "account-a",
            hostId: "host-a",
            mobileDeviceId: "phone-a",
          },
        },
      }),
    );
    await app.close();
  });

  it("does not invent thread context when the header is absent", async () => {
    mocks.execute.mockResolvedValueOnce({
      invocationId: "inv-2",
      toolId: "read",
      status: "completed",
      content: "ok",
    });
    const app = await createApp(true);

    await call(app);

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        requireThreadContext: true,
      }),
    );
    expect(mocks.execute.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "threadContext",
    );
    await app.close();
  });

  it("ignores the thread header on the Direct path", async () => {
    mocks.execute.mockResolvedValueOnce({
      invocationId: "inv-3",
      toolId: "read",
      status: "completed",
      content: "ok",
    });
    const app = await createApp(false);

    await call(app, { "x-mira-thread-id": "thread-1" });

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.not.objectContaining({
        requireThreadContext: true,
        threadContext: expect.anything(),
      }),
    );
    await app.close();
  });

  it("returns the stable thread lifecycle error code", async () => {
    mocks.execute.mockRejectedValueOnce(
      new RemoteThreadWorkspaceError(
        "thread_ended",
        "Remote thread has ended",
      ),
    );
    const app = await createApp(true);

    const response = await call(app, { "x-mira-thread-id": "thread-1" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.error).toMatchObject({
      code: -32010,
      data: { code: "thread_ended" },
    });
    await app.close();
  });
});
