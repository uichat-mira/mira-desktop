"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { attachCloudRelayTicketIpc, CHANNEL } = require("./cloud-relay-ticket-ipc.cjs");

class FakeChild extends EventEmitter {
  connected = true;
  sent = [];
  send(value, callback) {
    this.sent.push(value);
    callback?.(null);
    return true;
  }
  request(requestId = randomUUID(), extra = {}) {
    this.emit("message", { channel: CHANNEL, type: "request", requestId, ...extra });
    return requestId;
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const ticket = () => ({
  token: "header.payload.signature",
  tokenType: "Bearer",
  audience: "mira:cloud-relay-transport",
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  room: "room_accepted",
  role: "host",
});

test("native IPC sends only a validated Host ticket to its bound child", async () => {
  const child = new FakeChild();
  const account = { withRelayHostTicket: async (consume) => consume(ticket()) };
  const bridge = attachCloudRelayTicketIpc(child, () => account);
  const requestId = child.request();
  await tick();
  assert.deepEqual(child.sent, [{
    channel: CHANNEL, type: "result", requestId, ok: true, ticket: ticketLike(child),
  }]);
  assert.equal(JSON.stringify(child.sent).includes("mcs_v1."), false);
  bridge.dispose();
});

function ticketLike(child) {
  const value = child.sent[0].ticket;
  assert.equal(value.audience, "mira:cloud-relay-transport");
  assert.equal(value.role, "host");
  assert.equal(value.room, "room_accepted");
  return value;
}

test("unknown input shapes, forged fields and duplicate ids cannot request a ticket", async () => {
  const child = new FakeChild();
  let called = 0;
  const bridge = attachCloudRelayTicketIpc(child, () => ({
    withRelayHostTicket: async () => { called++; await new Promise(() => {}); },
  }));
  child.emit("message", { channel: "other", type: "request", requestId: randomUUID() });
  child.request(randomUUID(), { room: "other-account" });
  child.request("invalid-id");
  const id = child.request();
  child.request(id);
  await tick();
  assert.equal(called, 1);
  assert.equal(child.sent.length, 0);
  bridge.dispose();
});

test("native IPC caps concurrent requests and never reflects exception messages", async () => {
  const child = new FakeChild();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let called = 0;
  const bridge = attachCloudRelayTicketIpc(child, () => ({
    withRelayHostTicket: async () => { called++; await gate; throw Object.assign(
      new Error("mcs_v1.SECRET_DO_NOT_LOG"), { code: "not-an-allowed-code" }); },
  }));
  const ids = Array.from({ length: 5 }, () => child.request());
  await tick();
  assert.equal(called, 4);
  assert.deepEqual(child.sent, [{
    channel: CHANNEL, type: "result", requestId: ids[4], ok: false,
    errorCode: "relay_ticket_bridge_busy",
  }]);
  release();
  await tick();
  assert.equal(child.sent.length, 5);
  assert.equal(child.sent.every((x) => !JSON.stringify(x).includes("SECRET_DO_NOT_LOG")), true);
  assert.equal(child.sent.slice(1).every((x) => x.errorCode === "relay_ticket_unavailable"), true);
  bridge.dispose();
});

test("native signout or reauth revokes pending work and drops late tickets", async () => {
  const child = new FakeChild();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const bridge = attachCloudRelayTicketIpc(child, () => ({
    withRelayHostTicket: async (consume) => { await gate; return consume(ticket()); },
  }));
  child.request();
  await tick();
  bridge.notifyRevoked("reauth");
  assert.deepEqual(child.sent, [{ channel: CHANNEL, type: "revoked", reason: "reauth" }]);
  release();
  await tick();
  assert.equal(child.sent.length, 1);
  bridge.dispose();
});

test("child disconnect ends the private response route, no fallback", async () => {
  const child = new FakeChild();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const bridge = attachCloudRelayTicketIpc(child, () => ({
    withRelayHostTicket: async (consume) => { await gate; return consume(ticket()); },
  }));
  child.request();
  await tick();
  child.connected = false;
  child.emit("disconnect");
  release();
  await tick();
  assert.equal(child.sent.length, 0);
  assert.equal(child.listenerCount("message"), 0);
  bridge.dispose();
});

test("malformed ticket fails closed without forwarding secrets", async () => {
  const child = new FakeChild();
  const bridge = attachCloudRelayTicketIpc(child, () => ({
    withRelayHostTicket: async (consume) =>
      consume({ ...ticket(), role: "client", token: "mcs_v1.SECRET_DO_NOT_SEND" }),
  }));
  const requestId = child.request();
  await tick();
  assert.deepEqual(child.sent, [{
    channel: CHANNEL, type: "result", requestId, ok: false,
    errorCode: "relay_ticket_invalid_response",
  }]);
  bridge.dispose();
});
