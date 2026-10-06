import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendRouteError } from "@/utils/route-errors.js";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  listDevices: vi.fn(),
  revokeDevice: vi.fn(),
  getSnapshot: vi.fn(),
  check: vi.fn(),
  updateEnabled: vi.fn(),
  revokeLifecycleDevice: vi.fn(),
}));

vi.mock("@/db/repositories/general-settings.repository.js", () => ({
  generalSettingsRepository: { get: mocks.get, update: mocks.update },
}));
vi.mock("@/db/repositories/tailscale-remote-access.repository.js", () => ({
  tailscaleRemoteAccessRepository: {
    listDevices: mocks.listDevices,
    revokeDevice: mocks.revokeDevice,
  },
}));
vi.mock("@/services/tailscale-remote-access.service.js", () => ({
  TailscaleRemoteAccessError: class TailscaleRemoteAccessError extends Error {},
  tailscaleRemoteAccessService: {
    getSnapshot: mocks.getSnapshot,
    check: mocks.check,
    updateEnabled: mocks.updateEnabled,
    revokeDevice: mocks.revokeLifecycleDevice,
  },
}));
vi.mock("@/routes/remote-access.js", () => ({ default: async () => undefined }));
vi.mock("./memory.js", () => ({ default: async () => undefined }));

import generalSettingsRoute from "./general-settings.js";
import { TailscaleRemoteAccessError } from "@/services/tailscale-remote-access.service.js";

const settings = {
  socks5Host: "127.0.0.1",
  socks5Port: 1080,
  socks5Username: "alice",
  socks5Password: "secret",
};
const snapshot = {
  config: { enabled: false, servePort: 8787, updatedAt: null },
  runtime: {
    state: "not_installed",
    installed: false,
    backendState: null,
    version: null,
    deviceName: null,
    dnsName: null,
    tailnetName: null,
    tailnetDomain: null,
    tailscaleIps: [],
    serveConfigured: false,
    serveManagedByMira: false,
    accessUrl: null,
    healthOk: null,
    checkedAt: "2026-08-04T00:00:00.000Z",
    error: null,
  },
};

const createApp = async () => {
  const app = Fastify();
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));
  app.setErrorHandler(sendRouteError);
  app.addHook("preHandler", async (request) => {
    request.authUser = { id: 7, username: "alice", role: "user" };
  });
  await app.register(generalSettingsRoute);
  return app;
};

describe("general settings routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockReturnValue(settings);
    mocks.update.mockReturnValue(settings);
    mocks.listDevices.mockReturnValue([]);
    mocks.revokeDevice.mockReturnValue(true);
    mocks.revokeLifecycleDevice.mockReturnValue(true);
    mocks.getSnapshot.mockResolvedValue(snapshot);
    mocks.check.mockResolvedValue(snapshot);
    mocks.updateEnabled.mockResolvedValue(snapshot);
  });

  it("reads and persists only the declared proxy settings", async () => {
    const app = await createApp();
    const get = await app.inject({ method: "GET", url: "/general-settings" });
    expect(get.statusCode).toBe(200);
    expect(get.json().data).toEqual(settings);

    const invalid = await app.inject({
      method: "PUT",
      url: "/general-settings",
      payload: { socks5Host: "localhost", unexpected: "value" },
    });
    expect(invalid.statusCode).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ socks5Host: "localhost" });
    mocks.update.mockClear();

    const valid = await app.inject({
      method: "PUT",
      url: "/general-settings",
      payload: { socks5Host: "localhost", socks5Port: 1081 },
    });
    expect(valid.statusCode).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ socks5Host: "localhost", socks5Port: 1081 });
    await app.close();
  });

  it("keeps paired devices scoped to the authenticated user", async () => {
    mocks.listDevices.mockReturnValue([{ id: "device-1" }]);
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/general-settings/tailscale-remote-access",
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.listDevices).toHaveBeenCalledWith(7);
    expect(response.json().data.pairedDevices).toEqual([{ id: "device-1" }]);
    await app.close();
  });

  it("maps managed Tailscale conflicts to 400", async () => {
    mocks.updateEnabled.mockRejectedValue(
      new TailscaleRemoteAccessError("existing Serve config is not managed by Mira"),
    );
    const app = await createApp();
    const response = await app.inject({
      method: "PUT",
      url: "/general-settings/tailscale-remote-access",
      payload: { enabled: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("not managed by Mira");
    await app.close();
  });

  it("returns 404 when revoking a device outside the user's visible set", async () => {
    mocks.revokeLifecycleDevice.mockReturnValue(false);
    const app = await createApp();
    const response = await app.inject({
      method: "DELETE",
      url: "/general-settings/tailscale-remote-access/devices/device-2",
    });
    expect(response.statusCode).toBe(404);
    expect(mocks.revokeLifecycleDevice).toHaveBeenCalledWith("device-2", 7);
    await app.close();
  });
});
