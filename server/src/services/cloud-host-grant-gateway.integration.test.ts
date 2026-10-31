import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthUserFromRequest } from "@/db/auth.db.js";
import {
  CLOUD_HOST_GRANT_IPC_CHANNEL,
  CloudHostGrantIpcClient,
} from "./cloud-host-grant-ipc.service.js";
import { CloudHostGrantRuntime } from "./cloud-host-grant-runtime.service.js";
import {
  cloudLocalRequestAuthority,
} from "./cloud-local-request-authority.service.js";
import {
  RemoteRelayConnectorService,
  type CloudRelayTicketSource,
  type RelaySocketFactory,
} from "./remote-relay-connector.service.js";

const dbMock = vi.hoisted(() => ({
  findById: vi.fn((_id: number) => ({
    id: 7, username: "local-owner", role: "user" as const, isActive: true,
  })),
}));
vi.mock("@/db/index.js", () => ({
  userRepository: { findById: dbMock.findById },
}));
vi.mock("@/config/index.js", () => ({ default: { PORT: 8787 } }));

const ROOM = "room_dGVzdC1yb29t";
const ID = "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e~request-a";
const PROVENANCE = {
  version: 1, transport: "cloud", accountId: "account-1",
  deviceId: "phone-1", room: ROOM, role: "client",
  connectionId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e", requestId: ID,
} as const;

class FakeNativeChild extends EventEmitter {
  connected = true;
  issued = 0;
  scopes = ["threads:read"];
  send(raw: unknown, cb?: (err: Error | null) => void) {
    cb?.(null);
    const request = raw as { channel: string; type: string; requestId: string };
    if (request.channel === CLOUD_HOST_GRANT_IPC_CHANNEL &&
        request.type === "request") {
      this.issued++;
      const now = Date.now();
      queueMicrotask(() => this.emit("message", {
        channel: CLOUD_HOST_GRANT_IPC_CHANNEL, type: "result",
        requestId: request.requestId, ok: true, localOwnerUserId: 7,
        snapshot: {
          accountId: "account-1", hostId: "host-1",
          policyConfigured: true, policyScopes: ["threads:read", "tools:invoke"],
          revision: this.issued, issuedAt: new Date(now - 1000).toISOString(),
          validUntil: new Date(now + 120_000).toISOString(),
          maxStalenessSeconds: 300,
          grants: [{
            mobileDeviceId: "phone-1", scopes: this.scopes, status: "active",
          }],
        },
      }));
    }
    return true;
  }
}

class FakeCloudSocket {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  private readonly handlers = new Map<string, Array<(event?: unknown) => void>>();
  addEventListener(type: string, handler: (event?: unknown) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) || []), handler]);
  }
  on(type: string, handler: () => void) {
    this.addEventListener(type, handler);
  }
  private emit(type: string, event?: unknown) {
    for (const handler of this.handlers.get(type) || []) handler(event);
  }
  send(raw: string) { this.sent.push(JSON.parse(raw) as Record<string, unknown>); }
  open() { this.readyState = 1; this.emit("open"); }
  message(frame: Record<string, unknown>) {
    this.emit("message", { data: JSON.stringify(frame) });
  }
  ping() { this.emit("pong"); }
  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }
}

afterEach(() => {
  cloudLocalRequestAuthority.clear();
  vi.restoreAllMocks();
});

describe("DSK-007 Cloud Host Gateway real Fastify+HTTP runtime (T3)", () => {
  it("transports only a native-granted Mobile request and rejects ungranted scopes", async () => {
    const app = Fastify();
    app.addHook("preHandler", async (request, reply) => {
      const user = getAuthUserFromRequest(request);
      if (!user) return reply.status(401).send({ error: "Unauthorized" });
      request.authUser = user;
    });
    app.get("/remote/v1/workspaces", async (request) => ({
      owner: request.authUser?.id,
      mobile: request.cloudRemoteCaller?.mobileDeviceId,
    }));
    app.post("/remote/v1/tool-invocations/stream", async () => ({
      unexpected: "tool execution without scope",
    }));
    const base = await app.listen({ host: "127.0.0.1", port: 0 });

    const native = new FakeNativeChild();
    const ipc = new CloudHostGrantIpcClient(native);
    const grants = new CloudHostGrantRuntime(ipc, (id) =>
      id === 7 ? dbMock.findById(id) : null);
    const socket = new FakeCloudSocket();
    const tickets: CloudRelayTicketSource = {
      withHostTicket: async (consume) => consume({
        token: "header.payload.signature", tokenType: "Bearer",
        audience: "mira:cloud-relay-transport", role: "host", room: ROOM,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
      onRevoked: () => () => undefined,
    };
    const connector = new RemoteRelayConnectorService(
      () => ({ kind: "cloud", enabled: true,
        relayUrl: "wss://official.example.test" }),
      (() => socket) as RelaySocketFactory,
      fetch, base, () => 0, tickets,
      async (frame) => {
        const admission = frame.relayProvenance
          ? await grants.authorize(frame.relayProvenance, frame.method, frame.path)
          : null;
        return admission
          ? cloudLocalRequestAuthority.issue(admission, frame.method, frame.path)
          : null;
      },
    );
    try {
      connector.start();
      await vi.waitFor(() => expect(socket.sent.some((x) =>
        x.type === "hello")).toBe(false)); // Hello only after WebSocket open.
      socket.open();
      expect(socket.sent[0]).toMatchObject({ type: "hello", role: "host" });
      socket.message({ version: 1, type: "hello_ack", role: "host",
        relayId: ROOM, protocolVersion: 1 });
      socket.message({
        version: 1, type: "request", requestId: ID,
        method: "GET", path: "/remote/v1/workspaces",
        headers: { authorization: "Bearer forged-local-token",
          "x-mira-cloud-internal-request": "forged" },
        relayProvenance: PROVENANCE,
      });
      await vi.waitFor(() => expect(socket.sent.some((x) =>
        x.type === "complete" && x.requestId === ID)).toBe(true));
      const chunk = socket.sent.find((x) => x.type === "chunk")!;
      const body = JSON.parse(Buffer.from(String(chunk.data), "base64")
        .toString("utf8"));
      expect(body).toEqual({ owner: 7, mobile: "phone-1" });
      expect(native.issued).toBeGreaterThan(0);

      const deniedId = PROVENANCE.connectionId + "~tool-request";
      socket.message({
        version: 1, type: "request", requestId: deniedId,
        method: "POST", path: "/remote/v1/tool-invocations/stream",
        relayProvenance: { ...PROVENANCE, requestId: deniedId },
      });
      await vi.waitFor(() => expect(socket.sent.some((x) =>
        x.type === "error" && x.requestId === deniedId &&
        x.code === "CLOUD_GRANT_REQUIRED")).toBe(true));
      expect(socket.sent.some((x) => x.type === "response" &&
        x.requestId === deniedId)).toBe(false);
    } finally {
      connector.stop();
      grants.dispose();
      ipc.dispose();
      await app.close();
    }
  });
});
