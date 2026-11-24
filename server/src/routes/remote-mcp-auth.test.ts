import { createHash } from "node:crypto";
import fs from "node:fs";
import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetDatabaseClients, userRepository } from "@/db/index.js";
import {
  createAccessToken,
  getAuthUserFromRequest,
  initializeAuthDatabase,
} from "@/db/auth.db.js";
import { tailscaleRemoteAccessRepository } from "@/db/repositories/tailscale-remote-access.repository.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { cloudRemoteAccessMode } from "@/services/cloud-remote-access-mode.service.js";
import { sendRouteError, unauthorized } from "@/utils/route-errors.js";
import remoteMcpRoute, { MCP_PROTOCOL_VERSION } from "./remote-mcp.js";

const dbPath = createTimestampedTestArtifactPath("db", "remote-mcp-auth", ".sqlite");
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAdminUsername = process.env.SEED_ADMIN_USERNAME;
const originalAdminPassword = process.env.SEED_ADMIN_PASSWORD;
const deviceToken = "mira_device_device-1.0123456789abcdef";
const revokedToken = "mira_device_device-2.0123456789abcdef";

const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const makeApp = async () => {
  const app = Fastify();
  app.setErrorHandler(sendRouteError);
  app.addHook("preHandler", async (request) => {
    const user = getAuthUserFromRequest(request);
    if (!user) throw unauthorized("Missing or invalid auth token");
    request.authUser = user;
  });
  app.get("/local/ping", async (request) => ({ user: request.authUser?.id }));
  await app.register(remoteMcpRoute);
  return app;
};

beforeAll(() => {
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.SEED_ADMIN_USERNAME = "mcp-owner";
  process.env.SEED_ADMIN_PASSWORD = "mcp-owner-secret";
  resetDatabaseClients();
  initializeAuthDatabase();
  const owner = userRepository.findActiveByUsername("mcp-owner")!;
  tailscaleRemoteAccessRepository.createDevice({
    id: "device-1",
    userId: owner.id,
    name: "K70",
    platform: "android",
    permissions: ["tools:read", "tools:invoke"],
    tokenHash: hash(deviceToken),
    createdAt: "2026-11-24T00:00:00.000Z",
  });
  tailscaleRemoteAccessRepository.createDevice({
    id: "device-2",
    userId: owner.id,
    name: "Old phone",
    platform: "android",
    permissions: ["tools:read"],
    tokenHash: hash(revokedToken),
    createdAt: "2026-11-24T00:00:00.000Z",
  });
  tailscaleRemoteAccessRepository.revokeDevice("device-2", owner.id);
  cloudRemoteAccessMode.applyNativeSessionState("signed_out");
});

afterEach(() => {
  cloudRemoteAccessMode.applyNativeSessionState("signed_out");
});

afterAll(() => {
  cloudRemoteAccessMode.reset();
  resetDatabaseClients();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalAdminUsername === undefined) delete process.env.SEED_ADMIN_USERNAME;
  else process.env.SEED_ADMIN_USERNAME = originalAdminUsername;
  if (originalAdminPassword === undefined) delete process.env.SEED_ADMIN_PASSWORD;
  else process.env.SEED_ADMIN_PASSWORD = originalAdminPassword;
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe("remote MCP real authentication path", () => {
  it("keeps a positive local Desktop JWT on the local API surface", async () => {
    const owner = userRepository.findActiveByUsername("mcp-owner")!;
    const app = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/local/ping",
      headers: { authorization: `Bearer ${createAccessToken(owner)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: owner.id });
    await app.close();
  });

  it("admits a real paired Direct device through /mcp while Cloud is signed out", async () => {
    const app = await makeApp();
    const response = await initializeWithToken(app, deviceToken);

    expect(response.statusCode).toBe(200);
    expect(response.json().result.serverInfo.name).toBe("mira-desktop");
    await app.close();
  });

  it("keeps the DSK-018 Direct denial while this Desktop is signed in to Cloud", async () => {
    cloudRemoteAccessMode.applyNativeSessionState("signed_in");
    const app = await makeApp();
    const response = await initializeWithToken(app, deviceToken);

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain(
      "Tailscale Direct remote access is unavailable",
    );
    cloudRemoteAccessMode.applyNativeSessionState("signed_out");
    await app.close();
  });

  it("rejects a revoked device credential before MCP initialization", async () => {
    const app = await makeApp();
    const response = await initializeWithToken(app, revokedToken);

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("does not expose MCP to a Desktop JWT without remote authority", async () => {
    const owner = userRepository.findActiveByUsername("mcp-owner")!;
    const app = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${createAccessToken(owner)}` },
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

const initializeWithToken = (
  app: Awaited<ReturnType<typeof makeApp>>,
  token: string,
) => {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "auth-test", version: "1" },
      },
    },
  });
};
