import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initializeAuthDatabase } from "@/db/auth.db";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { resetDatabaseClients } from "@/db/index.js";
import {
  userRepository,
} from "@/db/repositories/index.js";
import { initializeHarnessRuntime, resetHarnessRuntime } from "@/mcp/bootstrap.js";
import { clearWorkspaceSelection } from "@/mcp/workspace.js";
import { remoteThreadWorkspaceService } from "@/services/remote-thread-workspace.service.js";
import { sendRouteError } from "@/utils/route-errors.js";
import remoteMcpRoute, { MCP_PROTOCOL_VERSION } from "./remote-mcp.js";
import remoteAccessRoute from "./remote-access.js";
import {
  createTimestampedTestArtifactPath,
  getTestArtifactDir,
} from "@/test-support/artifacts.js";

const scope = `remote-mcp-thread-e2e-${process.pid}-${Date.now()}`;
const testRoot = getTestArtifactDir("remote-mcp-thread-e2e", scope);
const databasePath = createTimestampedTestArtifactPath(
  "db",
  "remote-mcp-thread-e2e",
  ".sqlite",
);
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDatabaseDir = process.env.UI_CHAT_DATABASE_DIR;

process.env.DATABASE_URL = `file:${databasePath}`;
process.env.UI_CHAT_DATABASE_DIR = testRoot;
resetDatabaseClients();
initializeAuthDatabase();
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeRoleDatabase();
initializeThreadDatabase();
initializeHarnessRuntime();

const user = { id: 7, username: "cloud-owner", role: "user" as const };
const threadContext = {
  threadId: "thread-file-e2e",
  identity: {
    accountId: "account-a",
    hostId: "host-a",
    mobileDeviceId: "phone-a",
  },
};

const createApp = async (): Promise<FastifyInstance> => {
  const app = Fastify();
  app.setErrorHandler(sendRouteError);
  await app.register(fastifyWebsocket);
  await app.addHook("preHandler", async (request) => {
    request.authUser = user;
    request.cloudRemoteCaller = {
      kind: "cloud",
      accountId: "account-a",
      hostId: "host-a",
      mobileDeviceId: "phone-a",
      revision: 1,
      scopes: [
        "threads:read",
        "tools:read",
        "tools:invoke",
        "tools:approve",
        "tools:control",
      ],
      owner: user,
    };
  });
  await app.register(remoteMcpRoute);
  await app.register(remoteAccessRoute);
  return app;
};

const mcpCall = async (
  app: FastifyInstance,
  name: string,
  args: Record<string, unknown>,
) => {
  const response = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      "x-mira-thread-id": threadContext.threadId,
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientInfo": {
            name: "thread-e2e",
            version: "1",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
  });
  return { response, body: response.json() };
};

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true });
  const created = userRepository.create({
    username: `cloud-owner-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });
  user.id = created.id;
  // Deliberately no Desktop conversation for this Mobile thread ID.
});

afterAll(() => {
  clearWorkspaceSelection();
  resetHarnessRuntime();
  resetDatabaseClients();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalDatabaseDir === undefined) delete process.env.UI_CHAT_DATABASE_DIR;
  else process.env.UI_CHAT_DATABASE_DIR = originalDatabaseDir;
  fs.rmSync(testRoot, { recursive: true, force: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

describe("real MCP JSON-RPC thread workspace flow", () => {
  test("write approval, file read, explicit end, and old-thread rejection", async () => {
    const app = await createApp();
    const args = { path: "mcp-note.txt", content: "real-mcp-thread" };

    const pending = await mcpCall(app, "write", args);
    expect(pending.response.statusCode).toBe(200);
    expect(pending.body.result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "awaiting_approval",
        toolId: "write",
      },
    });
    expect(remoteThreadWorkspaceService.getState({ ...threadContext, userId: user.id }).workspace).toBeNull();

    const invocationId = pending.body.result.structuredContent.invocationId as string;
    const approval = await app.inject({
      method: "POST",
      url: `/remote/v1/tool-invocations/${invocationId}/approval`,
      headers: { "x-mira-thread-id": threadContext.threadId },
      payload: {
        decision: "approved",
        toolId: "write",
        args,
      },
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.json().data).toMatchObject({ status: "completed" });

    const workspaceRoot = remoteThreadWorkspaceService.plan({
      ...threadContext, userId: user.id,
    }).rootPath;
    expect(workspaceRoot).toBeTruthy();
    expect(
      fs.readFileSync(path.join(workspaceRoot!, "mcp-note.txt"), "utf8"),
    ).toBe("real-mcp-thread");

    const read = await mcpCall(app, "read", { path: "mcp-note.txt" });
    expect(read.body.result).toMatchObject({
      isError: false,
      content: [{ type: "text", text: expect.stringContaining("real-mcp-thread") }],
    });

    const ended = await app.inject({
      method: "POST",
      url: `/remote/v1/threads/${threadContext.threadId}/end`,
    });
    expect(ended.statusCode).toBe(200);
    expect(ended.json().data).toMatchObject({ status: "ended" });
    expect(
      fs.readFileSync(path.join(workspaceRoot!, "mcp-note.txt"), "utf8"),
    ).toBe("real-mcp-thread");

    const rejected = await mcpCall(app, "read", { path: "mcp-note.txt" });
    expect(rejected.body.error).toMatchObject({
      code: -32010,
      data: { code: "thread_ended" },
    });

    await app.close();
  });
});
