import assert from "node:assert/strict";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendRouteError } from "@/utils/route-errors.js";

const mocks = vi.hoisted(() => ({
  roles: {
    listRoles: vi.fn(),
  },
}));

vi.mock("@/services/role.service.js", () => ({
  roleService: mocks.roles,
}));

import remoteRoleSummaryRoute from "./remote-role-summary.js";

const user = { id: 7, username: "tester", role: "user" as const };

const createApp = async (paired = true, cloud = false) => {
  const app = Fastify();
  app.setErrorHandler(sendRouteError);
  app.addHook("preHandler", async (request) => {
    request.authUser = user;
    if (cloud) {
      request.cloudRemoteCaller = {
        kind: "cloud", mobileDeviceId: "phone-a", accountId: "account-a",
        hostId: "host-1", revision: 3,
        scopes: ["threads:read"], owner: user,
      };
    }
    if (paired) {
      request.remoteDevice = {
        id: "device-1",
        userId: user.id,
        name: "K70",
        platform: "android",
        publicKey: null,
        tokenHash: "hash",
        permissions: ["threads:read"],
        createdAt: "2026-08-01T00:00:00.000Z",
        lastSeenAt: null,
      };
    }
  });
  await app.register(remoteRoleSummaryRoute);
  return app;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.roles.listRoles.mockReturnValue([
    {
      id: "role-1",
      name: "Programmer",
      summary: "Writes code",
      avatarId: "pilot-helper",
      status: "active",
      tags: ["code"],
      prompt: {
        description: "internal prompt",
        worldview: "",
        persona: "",
        scenario: "",
        exampleDialogues: "",
        style: "",
        constraints: "",
      },
      llmProfile: { temperature: 0.2 },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
  ]);
});

describe("remote role summary route", () => {
  it("returns only id and name for the current user's roles", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/remote/v1/roles" });

    assert.equal(response.statusCode, 200, response.body);
    expect(mocks.roles.listRoles).toHaveBeenCalledWith({ userId: user.id });
    assert.deepEqual(response.json().data, [
      { id: "role-1", name: "Programmer" },
    ]);
    assert.equal("prompt" in response.json().data[0], false);
    assert.equal("llmProfile" in response.json().data[0], false);
    assert.equal("summary" in response.json().data[0], false);
    await app.close();
  });

  it("allows an already authenticated and scoped Cloud Mobile without QR pairing", async () => {
    const app = await createApp(false, true);
    const response = await app.inject({ method: "GET", url: "/remote/v1/roles" });
    assert.equal(response.statusCode, 200, response.body);
    expect(mocks.roles.listRoles).toHaveBeenCalledWith({ userId: user.id });
    await app.close();
  });

  it("rejects requests without a paired remote device", async () => {
    const app = await createApp(false);
    const response = await app.inject({ method: "GET", url: "/remote/v1/roles" });

    assert.equal(response.statusCode, 403, response.body);
    expect(mocks.roles.listRoles).not.toHaveBeenCalled();
    await app.close();
  });
});
