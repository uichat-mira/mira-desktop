import Fastify from "fastify";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  CLOUD_INTERNAL_REQUEST_HEADER as HEADER,
  cloudLocalRequestAuthority,
  CloudLocalRequestAuthority,
  claimCloudRemoteUser,
} from "./cloud-local-request-authority.service.js";
import type { CloudGrantAdmission } from "./cloud-host-grant-runtime.service.js";

const mocked = vi.hoisted(() => ({
  findById: vi.fn(() => ({
    id: 7, username: "local-owner", role: "user", isActive: true,
  })),
}));
vi.mock("@/db/index.js", () => ({ userRepository: mocked }));
const authority: CloudGrantAdmission = {
  accountId: "account-a", hostId: "host-a",
  mobileDeviceId: "phone-a", revision: 4,
  scopes: ["threads:read"],
  owner: { id: 7, username: "local-owner", role: "user" },
};
beforeEach(() => {
  cloudLocalRequestAuthority.clear();
  mocked.findById.mockReset();
  mocked.findById.mockReturnValue({
    id: 7, username: "local-owner", role: "user", isActive: true,
  });
});

describe("DSK-007 in-process Cloud one-shot Remote V1 authority", () => {
  it("consumes only the exact method and canonical path once", () => {
    const service = new CloudLocalRequestAuthority();
    const nonce = service.issue(authority, "GET", "/remote/v1/workspaces");
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(service.consume(nonce, "POST", "/remote/v1/workspaces")).toBeNull();
    expect(service.consume(nonce, "GET", "/remote/v1/workspaces")).toBeNull();
    const again = service.issue(authority, "GET", "/remote/v1/workspaces");
    expect(service.consume(again, "GET", "/remote/v1/workspaces"))
      .toMatchObject({ kind: "cloud", owner: { id: 7 },
        mobileDeviceId: "phone-a", scopes: ["threads:read"] });
    expect(service.consume(again, "GET", "/remote/v1/workspaces")).toBeNull();
  });

  it("does not issue capabilities for unknown routes or accept inactive local owners", () => {
    const service = new CloudLocalRequestAuthority();
    expect(service.issue(authority, "GET", "/settings")).toBeNull();
    expect(service.issue(authority, "POST", "/remote/v1/unknown")).toBeNull();
    const nonce = service.issue(authority, "GET", "/remote/v1/workspaces");
    mocked.findById.mockReturnValue({ id: 7, username: "local-owner",
      role: "user", isActive: false });
    expect(service.consume(nonce, "GET", "/remote/v1/workspaces")).toBeNull();
  });

  it("expires and clears credentials; never reflects forged identity headers", () => {
    const service = new CloudLocalRequestAuthority();
    const nonce = service.issue(authority, "GET", "/remote/v1/workspaces", 1000);
    expect(service.consume(nonce, "GET", "/remote/v1/workspaces", 11_000))
      .toBeNull();
    const again = service.issue(authority, "GET", "/remote/v1/workspaces");
    service.clear();
    expect(service.consume(again, "GET", "/remote/v1/workspaces")).toBeNull();
  });

  it("authenticates a real Fastify request using only Backend-issued one-shot proof", async () => {
    const app = Fastify();
    app.addHook("preHandler", async (req, reply) => {
      const owner = claimCloudRemoteUser(req);
      if (!owner) return reply.status(403).send({ error: "CLOUD_GRANT_REQUIRED" });
      req.authUser = owner;
    });
    app.get("/remote/v1/workspaces", async (req) => ({
      user: req.authUser?.id,
      caller: req.cloudRemoteCaller?.mobileDeviceId,
      scopes: req.cloudRemoteCaller?.scopes,
    }));
    const nonce = cloudLocalRequestAuthority.issue(authority,
      "GET", "/remote/v1/workspaces");
    const denied = await app.inject({
      method: "GET", url: "/remote/v1/workspaces",
      headers: { [HEADER]: "forged", authorization: "Bearer mira_device_fake" },
    });
    expect(denied.statusCode).toBe(403);
    const accepted = await app.inject({
      method: "GET", url: "/remote/v1/workspaces",
      headers: { [HEADER]: nonce!, authorization: "Bearer mira_device_fake" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      user: 7, caller: "phone-a", scopes: ["threads:read"],
    });
    const replay = await app.inject({
      method: "GET", url: "/remote/v1/workspaces",
      headers: { [HEADER]: nonce! },
    });
    expect(replay.statusCode).toBe(403);
    await app.close();
  });
});
