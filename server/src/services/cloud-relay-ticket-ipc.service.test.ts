import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_RELAY_TICKET_IPC_CHANNEL as CHANNEL,
  CloudRelayTicketIpcClient,
  type CloudRelayTicketIpcTransport,
} from "./cloud-relay-ticket-ipc.service.js";

class FakeParent extends EventEmitter implements CloudRelayTicketIpcTransport {
  connected = true;
  sent: Array<Record<string, unknown>> = [];
  failSend = false;
  send(value: unknown, callback?: (error: Error | null) => void) {
    if (this.failSend) throw new Error("cannot send mcs_v1.SECRET");
    this.sent.push(value as Record<string, unknown>);
    callback?.(null);
    return true;
  }
  result(index: number, value: Record<string, unknown>) {
    const requestId = this.sent[index]?.requestId;
    expect(typeof requestId).toBe("string");
    this.emit("message", { channel: CHANNEL, type: "result", requestId, ...value });
  }
}
const ticket = () => ({
  token: "header.payload.signature",
  tokenType: "Bearer" as const,
  audience: "mira:cloud-relay-transport" as const,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  room: "room_accepted",
  role: "host" as const,
});

describe("CloudRelayTicketIpcClient", () => {
  afterEach(() => vi.useRealTimers());

  it("has no HTTP/dev fallback when Node IPC is absent", async () => {
    const transport = new FakeParent();
    (transport as { send?: FakeParent["send"] }).send = undefined;
    const client = new CloudRelayTicketIpcClient(transport);
    await expect(client.withHostTicket(() => "called"))
      .rejects.toMatchObject({ code: "relay_ticket_bridge_unavailable" });
    client.dispose();
  });

  it("requests only an opaque ID, consumes the scoped ticket, ignores unrelated messages", async () => {
    const parent = new FakeParent();
    const client = new CloudRelayTicketIpcClient(parent);
    const consumer = vi.fn((value) => value.room);
    const wait = client.withHostTicket(consumer);
    expect(parent.sent).toHaveLength(1);
    expect(Object.keys(parent.sent[0]!).sort()).toEqual(["channel", "requestId", "type"]);
    expect(parent.sent[0]).toMatchObject({ channel: CHANNEL, type: "request" });
    parent.emit("message", { channel: "another-channel", type: "result",
      requestId: parent.sent[0]!.requestId, ok: true, ticket: ticket() });
    expect(consumer).not.toHaveBeenCalled();
    parent.result(0, { ok: true, ticket: ticket() });
    await expect(wait).resolves.toBe("room_accepted");
    expect(consumer).toHaveBeenCalledTimes(1);
    parent.result(0, { ok: true, ticket: ticket() }); // duplicate result
    expect(consumer).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it("rejects malformed matching replies rather than calling the consumer", async () => {
    const parent = new FakeParent();
    const client = new CloudRelayTicketIpcClient(parent);
    const consumer = vi.fn();
    const wait = client.withHostTicket(consumer);
    parent.result(0, { ok: true, ticket: { ...ticket(), role: "client" } });
    await expect(wait).rejects.toMatchObject({ code: "relay_ticket_invalid_response" });
    expect(consumer).not.toHaveBeenCalled();
    client.dispose();
  });

  it("revocation cancels outstanding tickets and informs the future Cloud socket owner", async () => {
    const parent = new FakeParent();
    const client = new CloudRelayTicketIpcClient(parent);
    const onRevoke = vi.fn();
    client.onRevoked(onRevoke);
    const wait = client.withHostTicket(() => "not-consumed");
    parent.emit("message", { channel: CHANNEL, type: "revoked", reason: "reauth" });
    await expect(wait).rejects.toMatchObject({ code: "relay_ticket_reauth" });
    expect(onRevoke).toHaveBeenCalledWith("reauth");
    parent.result(0, { ok: true, ticket: ticket() });
    client.dispose();
  });

  it("untrusted result errors do not include raw server messages", async () => {
    const parent = new FakeParent();
    const client = new CloudRelayTicketIpcClient(parent);
    const wait = client.withHostTicket(() => "not-consumed");
    parent.result(0, { ok: false, errorCode: "relay_ticket_reauth",
      message: "mcs_v1.SECRET_SHOULD_NOT_LEAK" });
    await expect(wait).rejects.toMatchObject({ code: "relay_ticket_invalid_response" });
    client.dispose();
  });

  it("bounds outstanding requests, deadline, disconnect and send exceptions", async () => {
    vi.useFakeTimers();
    const parent = new FakeParent();
    const client = new CloudRelayTicketIpcClient(parent, 100);
    const requests = Array.from({ length: 4 }, () => client.withHostTicket(() => true));
    // Attach rejection handlers before the fake clock advances.
    const results = Promise.all(requests.map((promise) =>
      promise.then(() => "unexpected-success", (error: { code: string }) => error.code)));
    await expect(client.withHostTicket(() => true))
      .rejects.toMatchObject({ code: "relay_ticket_bridge_busy" });
    expect(parent.sent).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(100);
    expect(await results).toEqual(Array(4).fill("relay_ticket_bridge_timeout"));
    const disconnected = client.withHostTicket(() => true);
    parent.connected = false;
    parent.emit("disconnect");
    await expect(disconnected).rejects.toMatchObject({
      code: "relay_ticket_bridge_disconnected",
    });
    client.dispose();

    const another = new FakeParent();
    another.failSend = true;
    const failing = new CloudRelayTicketIpcClient(another);
    await expect(failing.withHostTicket(() => true))
      .rejects.toMatchObject({ code: "relay_ticket_bridge_disconnected" });
    failing.dispose();
  });
});
