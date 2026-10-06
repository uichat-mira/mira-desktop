import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMock = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  listDevices: vi.fn(),
  getActiveDeviceById: vi.fn(),
  revokeDevice: vi.fn(),
}));

const hostNotificationMock = vi.hoisted(() => ({
  revokeBindingsForRemoteDevice: vi.fn(),
}));

const sqliteMock = vi.hoisted(() => ({
  transaction: vi.fn(
    (callback: () => unknown) => () => callback(),
  ),
}));

vi.mock("@/config/index.js", () => ({
  default: { PORT: 8787 },
}));

vi.mock("@/db/index.js", () => ({
  getSqlite: () => sqliteMock,
}));

vi.mock("@/db/repositories/host-notification.repository.js", () => ({
  hostNotificationRepository: hostNotificationMock,
}));

vi.mock(
  "@/db/repositories/tailscale-remote-access.repository.js",
  () => ({
    tailscaleRemoteAccessRepository: repositoryMock,
  }),
);

import {
  TailscaleRemoteAccessService,
  type TailscaleCommandRunner,
} from "./tailscale-remote-access.service.js";

const connectedStatus = JSON.stringify({
  Version: "1.90.0",
  BackendState: "Running",
  TailscaleIPs: ["100.64.0.10"],
  Self: {
    HostName: "mira-desktop",
    DNSName: "mira-desktop.example.ts.net.",
    Online: true,
    TailscaleIPs: ["100.64.0.10"],
  },
  CurrentTailnet: {
    Name: "example",
    MagicDNSSuffix: "example.ts.net",
    MagicDNSEnabled: true,
  },
});

const managedServeStatus = (overrides: Record<string, unknown> = {}) => ({
  TCP: {
    "443": { HTTPS: true },
  },
  Web: {
    "mira-desktop.example.ts.net:443": {
      Handlers: {
        "/": { Proxy: "http://127.0.0.1:8787" },
      },
    },
  },
  AllowFunnel: {},
  ...overrides,
});

const commandKey = (args: string[]) => args.join(" ");

beforeEach(() => {
  repositoryMock.getConfig.mockReset();
  repositoryMock.updateConfig.mockReset();
  repositoryMock.listDevices.mockReset();
  repositoryMock.getActiveDeviceById.mockReset();
  repositoryMock.revokeDevice.mockReset();
  hostNotificationMock.revokeBindingsForRemoteDevice.mockReset();
  sqliteMock.transaction.mockClear();
  repositoryMock.getConfig.mockReturnValue({
    enabled: false,
    servePort: 443,
    updatedAt: null,
  });
  repositoryMock.updateConfig.mockImplementation(
    (patch: { enabled?: boolean }) => ({
      enabled: Boolean(patch.enabled),
      servePort: 443,
      updatedAt: "2026-08-01T00:00:00.000Z",
    }),
  );
  repositoryMock.listDevices.mockReturnValue([]);
  repositoryMock.getActiveDeviceById.mockReturnValue(null);
});

describe("TailscaleRemoteAccessService", () => {
  it("reports not_installed when the CLI cannot be resolved", async () => {
    const runCommand: TailscaleCommandRunner = vi.fn(async () => {
      throw Object.assign(new Error("spawn tailscale ENOENT"), {
        code: "ENOENT",
      });
    });
    const service = new TailscaleRemoteAccessService(runCommand);

    const snapshot = await service.getSnapshot();

    expect(snapshot.runtime.state).toBe("not_installed");
    expect(snapshot.runtime.installed).toBe(false);
  });

  it("uses the runtime DNS name and treats structural empty Serve JSON as unconfigured", async () => {
    const runCommand: TailscaleCommandRunner = vi.fn(async (args) => {
      if (commandKey(args) === "status --json") {
        return { stdout: connectedStatus, stderr: "" };
      }
      if (commandKey(args) === "serve status --json") {
        return {
          stdout: JSON.stringify({ TCP: {}, Web: {}, AllowFunnel: false }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${commandKey(args)}`);
    });
    const service = new TailscaleRemoteAccessService(runCommand);

    const snapshot = await service.getSnapshot();

    expect(snapshot.runtime.state).toBe("connected");
    expect(snapshot.runtime.serveConfigured).toBe(false);
    expect(snapshot.runtime.dnsName).toBe("mira-desktop.example.ts.net");
    expect(snapshot.runtime.accessUrl).toBe(
      "https://mira-desktop.example.ts.net",
    );
  });

  it("refuses to overwrite an unrelated Serve configuration", async () => {
    const calls: string[] = [];
    const runCommand: TailscaleCommandRunner = vi.fn(async (args) => {
      calls.push(commandKey(args));
      if (commandKey(args) === "status --json") {
        return { stdout: connectedStatus, stderr: "" };
      }
      if (commandKey(args) === "serve status --json") {
        return {
          stdout: JSON.stringify({
            TCP: { "443": { HTTPS: true } },
            Web: {
              "mira-desktop.example.ts.net:443": {
                Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } },
              },
            },
            AllowFunnel: {},
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${commandKey(args)}`);
    });
    const service = new TailscaleRemoteAccessService(runCommand);

    await expect(service.updateEnabled(true)).rejects.toMatchObject({
      code: "TAILSCALE_SERVE_CONFLICT",
    });
    expect(calls).toEqual(["status --json", "serve status --json"]);
    expect(repositoryMock.updateConfig).not.toHaveBeenCalled();
  });

  it("treats a mixed Mira and user Serve configuration as a conflict", async () => {
    const runCommand: TailscaleCommandRunner = vi.fn(async (args) => {
      if (commandKey(args) === "status --json") {
        return { stdout: connectedStatus, stderr: "" };
      }
      if (commandKey(args) === "serve status --json") {
        return {
          stdout: JSON.stringify(
            managedServeStatus({
              Web: {
                "mira-desktop.example.ts.net:443": {
                  Handlers: {
                    "/": { Proxy: "http://127.0.0.1:8787" },
                    "/other": { Proxy: "http://127.0.0.1:3000" },
                  },
                },
              },
            }),
          ),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${commandKey(args)}`);
    });
    const service = new TailscaleRemoteAccessService(runCommand);

    const snapshot = await service.getSnapshot();

    expect(snapshot.runtime.state).toBe("serve_conflict");
    expect(snapshot.runtime.serveManagedByMira).toBe(false);
  });

  it("treats Funnel permission as a conflict even when its hostname is only a JSON key", async () => {
    const runCommand: TailscaleCommandRunner = vi.fn(async (args) => {
      if (commandKey(args) === "status --json") {
        return { stdout: connectedStatus, stderr: "" };
      }
      if (commandKey(args) === "serve status --json") {
        return {
          stdout: JSON.stringify(
            managedServeStatus({
              AllowFunnel: {
                "mira-desktop.example.ts.net:443": true,
              },
            }),
          ),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${commandKey(args)}`);
    });
    const service = new TailscaleRemoteAccessService(runCommand);

    const snapshot = await service.getSnapshot();

    expect(snapshot.runtime.state).toBe("serve_conflict");
    expect(snapshot.runtime.serveManagedByMira).toBe(false);
  });

  it("reports ready only after the exclusive Mira Serve target and health check pass", async () => {
    repositoryMock.getConfig.mockReturnValue({
      enabled: true,
      servePort: 443,
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const runCommand: TailscaleCommandRunner = vi.fn(async (args) => {
      if (commandKey(args) === "status --json") {
        return { stdout: connectedStatus, stderr: "" };
      }
      if (commandKey(args) === "serve status --json") {
        return {
          stdout: JSON.stringify(managedServeStatus()),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${commandKey(args)}`);
    });
    const checkHealth = vi.fn(async () => true);
    const service = new TailscaleRemoteAccessService(
      runCommand,
      checkHealth,
    );

    const snapshot = await service.check();

    expect(snapshot.runtime.state).toBe("ready");
    expect(snapshot.runtime.serveManagedByMira).toBe(true);
    expect(snapshot.runtime.healthOk).toBe(true);
    expect(checkHealth).toHaveBeenCalledWith(
      "https://mira-desktop.example.ts.net",
    );
  });

  it("revokes Push bindings with the paired device in one lifecycle transaction", () => {
    repositoryMock.getActiveDeviceById.mockReturnValue({
      id: "device-1",
      userId: 7,
      name: "Phone",
      platform: "android",
      publicKey: null,
      tokenHash: "hash",
      permissions: ["threads:read"],
      createdAt: "2026-10-06T00:00:00.000Z",
      lastSeenAt: null,
    });
    repositoryMock.revokeDevice.mockReturnValue(true);

    const service = new TailscaleRemoteAccessService();
    expect(service.revokeDevice("device-1", 7)).toBe(true);
    expect(repositoryMock.revokeDevice).toHaveBeenCalledWith("device-1", 7);
    expect(
      hostNotificationMock.revokeBindingsForRemoteDevice,
    ).toHaveBeenCalledWith("device-1", 7);
  });

  it("does not revoke Push bindings for another user's paired device", () => {
    repositoryMock.getActiveDeviceById.mockReturnValue({
      id: "device-2",
      userId: 8,
      name: "Other Phone",
      platform: "android",
      publicKey: null,
      tokenHash: "hash",
      permissions: ["threads:read"],
      createdAt: "2026-10-06T00:00:00.000Z",
      lastSeenAt: null,
    });

    const service = new TailscaleRemoteAccessService();
    expect(service.revokeDevice("device-2", 7)).toBe(false);
    expect(repositoryMock.revokeDevice).not.toHaveBeenCalled();
    expect(
      hostNotificationMock.revokeBindingsForRemoteDevice,
    ).not.toHaveBeenCalled();
  });
});
