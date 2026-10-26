"use strict";

// DSK-010: Electron Main owns the one-way release of short-lived transport
// tickets to its exact, explicitly spawned Backend child. Not renderer IPC.
const { RELAY_TICKET_ERROR_CODES } = require("./cloud-account.cjs");

const CHANNEL = "mira:cloud-relay:host-ticket:v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOM = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_PENDING = 4;
const ALLOWED_ERRORS = new Set(Object.values(RELAY_TICKET_ERROR_CODES));

const record = (value) => value !== null &&
  typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) =>
  record(value) && Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

function validTicket(ticket) {
  return exactKeys(ticket, ["token", "tokenType", "audience", "expiresAt", "room", "role"]) &&
    typeof ticket.token === "string" && ticket.token.length >= 16 &&
    ticket.token.length <= 8192 &&
    ticket.token.split(".").length === 3 &&
    ticket.tokenType === "Bearer" &&
    ticket.audience === "mira:cloud-relay-transport" &&
    typeof ticket.expiresAt === "string" &&
    Number.isFinite(Date.parse(ticket.expiresAt)) &&
    Date.parse(ticket.expiresAt) > Date.now() &&
    typeof ticket.room === "string" && ROOM.test(ticket.room) &&
    ticket.role === "host";
}

function attachCloudRelayTicketIpc(child, getAccount) {
  if (!child || typeof child.on !== "function" ||
      typeof child.send !== "function" || typeof getAccount !== "function") {
    throw new TypeError("Cloud Relay IPC requires an owned Backend child");
  }
  const active = new Set();
  let disposed = false;

  function send(payload) {
    if (disposed || child.connected === false) return;
    try {
      child.send(payload, () => {
        // Deliberately do not log IPC failures or any payload containing tokens.
      });
    } catch {
      // A disconnected Backend cannot receive secrets; it never triggers a fallback.
    }
  }
  function result(requestId, errorCode, ticket) {
    if (disposed || !active.has(requestId)) return;
    if (ticket) {
      send({ channel: CHANNEL, type: "result", requestId, ok: true, ticket });
    } else {
      send({ channel: CHANNEL, type: "result", requestId, ok: false, errorCode });
    }
  }
  function onMessage(value) {
    if (disposed || !exactKeys(value, ["channel", "type", "requestId"]) ||
        value.channel !== CHANNEL || value.type !== "request" ||
        typeof value.requestId !== "string" || !UUID.test(value.requestId)) {
      return;
    }
    const requestId = value.requestId;
    if (active.has(requestId)) return;
    if (active.size >= MAX_PENDING) {
      send({ channel: CHANNEL, type: "result", requestId, ok: false,
        errorCode: "relay_ticket_bridge_busy" });
      return;
    }
    active.add(requestId);
    const account = getAccount();
    if (!account || typeof account.withRelayHostTicket !== "function") {
      result(requestId, RELAY_TICKET_ERROR_CODES.NOT_CONFIGURED);
      active.delete(requestId);
      return;
    }
    Promise.resolve()
      .then(() => account.withRelayHostTicket((ticket) => {
        if (!active.has(requestId) || disposed) return;
        if (!validTicket(ticket)) {
          result(requestId, RELAY_TICKET_ERROR_CODES.INVALID_RESPONSE);
          return;
        }
        result(requestId, null, ticket);
      }))
      .catch((error) => {
        result(requestId, ALLOWED_ERRORS.has(error?.code)
          ? error.code : RELAY_TICKET_ERROR_CODES.UNAVAILABLE);
      })
      .finally(() => { active.delete(requestId); });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    active.clear();
    child.removeListener("message", onMessage);
    child.removeListener("disconnect", dispose);
    child.removeListener("close", dispose);
  }
  function notifyRevoked(reason) {
    if (disposed || (reason !== "signout" && reason !== "reauth")) return;
    active.clear();
    send({ channel: CHANNEL, type: "revoked", reason });
  }

  child.on("message", onMessage);
  child.on("disconnect", dispose);
  child.on("close", dispose);
  return { dispose, notifyRevoked };
}

module.exports = { attachCloudRelayTicketIpc, CHANNEL };
