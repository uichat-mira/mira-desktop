import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_HOST_GRANT_IPC_CHANNEL as CHANNEL,
  CloudHostGrantIpcClient,
} from "./cloud-host-grant-ipc.service.js";
import type { CloudRelayTicketIpcTransport } from "./cloud-relay-ticket-ipc.service.js";

class FakeParent extends EventEmitter implements CloudRelayTicketIpcTransport {
  connected = true;
  sent: Array<Record<string, unknown>> = [];
  send(payload: unknown, callback?: (error: Error | null) => void) {
    this.sent.push(payload as Record<string, unknown>);
    callback?.(null);
    return true;
  }
  reply(index: number, payload: Record<string, unknown>) {
    this.emit("message", {
      channel: CHANNEL, type: "result",
      requestId: this.sent[index]?.requestId, ...payload,
    });
  }
}

const snapshot = () => ({
  hostId: "host-1", accountId: "account-1", policyConfigured: true,
  policyScopes: ["threads:read"], revision: 3,
  issuedAt: "2026-10-31T08:00:00.000Z",
  validUntil: "2026-10-31T08:05:00.000Z", maxStalenessSeconds: 300,
  grants: [{ mobileDeviceId: "mobile-1", scopes: ["threads:read"], status: "active" }],
});

describe("DSK-007 Cloud Host grant private Backend IPC (T2)", () => {
  afterEach(() => vi.useRealTimers());

  it("never falls back to HTTP/renderer when Electron child IPC is absent", async () => {
    const parent = new FakeParent();
    (parent as { send?: FakeParent["send"] }).send = undefined;
    const client = new CloudHostGrantIpcClient(parent);
    await expect(client.requestSnapshot()).rejects.toMatchObject({
      code: "cloud_grant_bridge_unavailable",
    });
    client.dispose();
  });

  it("requests only an opaque ID and ignores wrong channel, stale or duplicate replies", async () => {
    const parent = new FakeParent();
    const client = new CloudHostGrantIpcClient(parent);
    const wait = client.requestSnapshot();
    expect(Object.keys(parent.sent[0]!).sort()).toEqual(["channel", "requestId", "type"]);
    expect(parent.sent[0]).toMatchObject({ channel: CHANNEL, type: "request" });
    parent.emit("message", { channel: "mira:cloud-relay:host-ticket:v1",
      type: "result", requestId: parent.sent[0]?.requestId,
      ok: true, snapshot: snapshot() });
    parent.reply(0, { ok: true, snapshot: snapshot() });
    await expect(wait).resolves.toEqual(snapshot());
    parent.reply(0, { ok: false, errorCode: "cloud_grant_reauth" });
    client.dispose();
  });

  it("rejects malformed replies, leaked server messages and unknown errors", async () => {
    const parent = new FakeParent();
    const client = new CloudHostGrantIpcClient(parent);
    const first = client.requestSnapshot();
    parent.reply(0, { ok: true, snapshot: "not JSON" });
    await expect(first).rejects.toMatchObject({ code: "cloud_grant_invalid_response" });
    const second = client.requestSnapshot();
    parent.reply(1, { ok: false, errorCode: "cloud_grant_reauth",
      message: "mcs_v1.secret" });
    await expect(second).rejects.toMatchObject({ code: "cloud_grant_invalid_response" });
    client.dispose();
  });

  it("revocation clears pending requests and invalidates a previously trusted cache consumer", async () => {
    const parent = new FakeParent();
    const client = new CloudHostGrantIpcClient(parent);
    const invalidated = vi.fn();
    client.onInvalidated(invalidated);
    const wait = client.requestSnapshot();
    parent.emit("message", { channel: CHANNEL, type: "revoked", reason: "reauth" });
    await expect(wait).rejects.toMatchObject({ code: "cloud_grant_reauth" });
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(invalidated).toHaveBeenCalledWith("reauth");
    parent.reply(0, { ok: true, snapshot: snapshot() });
    client.dispose();
  });

  it("bounds pending requests, deadlines and child disconnect", async () => {
    vi.useFakeTimers();
    const parent = new FakeParent();
    const client = new CloudHostGrantIpcClient(parent, 200);
    const a = client.requestSnapshot();
    const b = client.requestSnapshot();
    const failures = Promise.all([a, b].map((p) =>
      p.then(() => "unexpected", (error: { code: string }) => error.code)));
    await expect(client.requestSnapshot()).rejects.toMatchObject({
      code: "cloud_grant_bridge_busy",
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(await failures).toEqual(["cloud_grant_bridge_timeout", "cloud_grant_bridge_timeout"]);
    const invalidated = vi.fn();
    client.onInvalidated(invalidated);
    parent.connected = false;
    parent.emit("disconnect");
    expect(invalidated).toHaveBeenCalledWith("bridge_disconnected");
    await expect(client.requestSnapshot()).rejects.toMatchObject({
      code: "cloud_grant_bridge_unavailable",
    });
    client.dispose();
  });
});
