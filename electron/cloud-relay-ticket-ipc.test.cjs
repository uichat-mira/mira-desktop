"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { attachCloudRelayTicketIpc, attachCloudHostGrantIpc, CHANNEL, GRANT_CHANNEL } = require("./cloud-relay-ticket-ipc.cjs");

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

test("both Electron staging paths include the native IPC module", () => {
  const root = path.resolve(__dirname, "..");
  const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
  assert.match(read("electron-builder.yml"), /^  - cloud-relay-ticket-ipc\.cjs$/m);
  assert.match(read("scripts/prepare-desktop-artifacts.js"),
    /path\.join\(projectRoot, "electron", "cloud-relay-ticket-ipc\.cjs"\)/);
  assert.match(read("scripts/release/package-electron-from-payload.mjs"),
    /"cloud-relay-ticket-ipc\.cjs"/);
});

test("DSK-007 native grant channel serves only the exact owned child envelope", async () => {
  const child = new FakeChild();
  const snapshot = {
    hostId: "host-1", accountId: "account-a", policyConfigured: true,
    policyScopes: ["threads:read"], revision: 7,
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    validUntil: new Date(Date.now() + 300000).toISOString(),
    maxStalenessSeconds: 300,
    grants: [{ mobileDeviceId: "mobile-1", scopes: ["threads:read"], status: "active" }],
  };
  let calls = 0;
  const bridge = attachCloudHostGrantIpc(child, () => ({
    requestHostGrantSnapshot: async () => { calls++; return snapshot; },
  }));
  const id = randomUUID();
  child.emit("message", { channel: GRANT_CHANNEL, type: "request",
    requestId: id, accountId: "foreign-account" }); // forged data denied
  child.emit("message", { channel: GRANT_CHANNEL, type: "request", requestId: "bad-id" });
  child.emit("message", { channel: GRANT_CHANNEL, type: "request", requestId: id });
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(child.sent, [{ channel: GRANT_CHANNEL, type: "result",
    requestId: id, ok: true, snapshot }]);
  assert.equal(JSON.stringify(child.sent).includes("mcs_v1."), false);
  bridge.dispose();
});

test("DSK-007 native grant IPC cancels in-flight snapshots on signout", async () => {
  const child = new FakeChild();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const bridge = attachCloudHostGrantIpc(child, () => ({
    requestHostGrantSnapshot: async () => {
      await gate;
      return { hostId: "late-host" };
    },
  }));
  child.emit("message", { channel: GRANT_CHANNEL, type: "request",
    requestId: randomUUID() });
  await tick();
  bridge.notifyRevoked("signout");
  release();
  await tick();
  assert.deepEqual(child.sent, [{
    channel: GRANT_CHANNEL, type: "revoked", reason: "signout",
  }]);
  bridge.dispose();
});

test("DSK-007 native grant IPC rejects malformed/oversized replies without secrets", async () => {
  const child = new FakeChild();
  const bridge = attachCloudHostGrantIpc(child, () => ({
    requestHostGrantSnapshot: async () => ({ content: "x".repeat(260000) }),
  }));
  const id = randomUUID();
  child.emit("message", { channel: GRANT_CHANNEL, type: "request", requestId: id });
  await tick();
  assert.deepEqual(child.sent, [{ channel: GRANT_CHANNEL, type: "result",
    requestId: id, ok: false, errorCode: "cloud_grant_invalid_response" }]);
  bridge.dispose();
});
