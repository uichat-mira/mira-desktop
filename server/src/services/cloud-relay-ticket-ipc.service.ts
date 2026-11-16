import { randomUUID } from "node:crypto";

// Only the Node Backend process spawned with Electron's dedicated IPC channel
// may request transport credentials. No HTTP route, renderer or local JWT access.
export const CLOUD_RELAY_TICKET_IPC_CHANNEL = "mira:cloud-relay:host-ticket:v1";
const MAX_PENDING = 4;
const NATIVE_ERROR_CODES = new Set([
  "relay_ticket_not_configured",
  "relay_ticket_host_mismatch",
  "relay_ticket_unavailable",
  "relay_ticket_reauth",
  "relay_ticket_not_authorized",
  "relay_ticket_device_required",
  "relay_ticket_invalid_response",
  "relay_ticket_aborted",
  "relay_ticket_bridge_busy",
]);
const ROOM = /^[A-Za-z0-9._:-]{1,128}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type CloudRelayHostTicket = Readonly<{
  token: string;
  tokenType: "Bearer";
  audience: "mira:cloud-relay-transport";
  expiresAt: string;
  room: string;
  role: "host";
}>;

export type CloudRelayRevocationReason = "signout" | "reauth" | "bridge_disconnected";

export type CloudRelayTicketIpcTransport = {
  readonly connected?: boolean;
  send?: (message: unknown, callback?: (error: Error | null) => void) => boolean;
  on: (event: "message" | "disconnect", listener: (message?: unknown) => void) => unknown;
  off: (event: "message" | "disconnect", listener: (message?: unknown) => void) => unknown;
};

export class CloudRelayTicketBridgeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CloudRelayTicketBridgeError";
  }
}

type PendingTicket = {
  resolve: (ticket: CloudRelayHostTicket) => void;
  reject: (error: CloudRelayTicketBridgeError) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const exactKeys = (value: unknown, keys: readonly string[]): boolean =>
  isRecord(value) && Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

function validTicket(value: unknown): value is CloudRelayHostTicket {
  if (!exactKeys(value, ["token", "tokenType", "audience", "expiresAt", "room", "role"])) {
    return false;
  }
  const ticket = value as Record<string, unknown>;
  return typeof ticket.token === "string" &&
    ticket.token.length >= 16 && ticket.token.length <= 8192 &&
    ticket.token.split(".").length === 3 &&
    ticket.tokenType === "Bearer" &&
    ticket.audience === "mira:cloud-relay-transport" &&
    typeof ticket.expiresAt === "string" &&
    Number.isFinite(Date.parse(ticket.expiresAt)) &&
    Date.parse(ticket.expiresAt) > Date.now() &&
    typeof ticket.room === "string" && ROOM.test(ticket.room) &&
    ticket.role === "host";
}

export class CloudRelayTicketIpcClient {
  private readonly pending = new Map<string, PendingTicket>();
  private readonly revoked = new Set<(reason: CloudRelayRevocationReason) => void>();
  private readonly availabilityListeners = new Set<(available: boolean) => void>();
  private available = false;
  private closed = false;
  private disconnected = false;
  private readonly onMessage = (message?: unknown) => {
    if (this.closed || !isRecord(message) ||
        message.channel !== CLOUD_RELAY_TICKET_IPC_CHANNEL) {
      return;
    }
    if (message.type === "availability" &&
        exactKeys(message, ["channel", "type", "available"]) &&
        typeof message.available === "boolean") {
      this.setAvailability(message.available);
      return;
    }
    if (message.type === "revoked" &&
        exactKeys(message, ["channel", "type", "reason"]) &&
        (message.reason === "signout" || message.reason === "reauth")) {
      const reason = message.reason;
      this.setAvailability(false);
      this.failAll(reason === "reauth" ? "relay_ticket_reauth" : "relay_ticket_revoked");
      for (const subscriber of [...this.revoked]) {
        try {
          subscriber(reason);
        } catch {
          // A consumer callback cannot crash the IPC control plane.
        }
      }
      return;
    }
    if (message.type !== "result" ||
        typeof message.requestId !== "string" || !UUID.test(message.requestId)) {
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return; // stale/duplicate/unsolicited response
    this.pending.delete(message.requestId);
    clearTimeout(pending.timeout);
    if (message.ok === true &&
        exactKeys(message, ["channel", "type", "requestId", "ok", "ticket"]) &&
        validTicket(message.ticket)) {
      pending.resolve(Object.freeze({ ...message.ticket }));
      return;
    }
    if (message.ok === false &&
        exactKeys(message, ["channel", "type", "requestId", "ok", "errorCode"]) &&
        typeof message.errorCode === "string" &&
        NATIVE_ERROR_CODES.has(message.errorCode)) {
      pending.reject(new CloudRelayTicketBridgeError(message.errorCode));
      return;
    }
    pending.reject(new CloudRelayTicketBridgeError("relay_ticket_invalid_response"));
  };
  private readonly onDisconnect = () => {
    this.disconnected = true;
    this.setAvailability(false);
    this.failAll("relay_ticket_bridge_disconnected");
    // A surviving Backend must not retain an authorized socket after its
    // native credential owner has become unreachable.
    for (const subscriber of [...this.revoked]) {
      try {
        subscriber("bridge_disconnected");
      } catch {
        // A consumer callback cannot crash IPC control flow.
      }
    }
  };

  constructor(
    private readonly transport: CloudRelayTicketIpcTransport =
      process as unknown as CloudRelayTicketIpcTransport,
    private readonly timeoutMs = 30_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("Cloud Relay ticket IPC timeout is invalid");
    }
    if (typeof transport.send === "function") {
      transport.on("message", this.onMessage);
      transport.on("disconnect", this.onDisconnect);
      // Only the Electron-spawned Backend may initiate this native handshake.
      // Vitest workers also have process.send() for their own binary protocol;
      // never send an application IPC object onto that unrelated channel.
      const ownedChild = transport !== (process as CloudRelayTicketIpcTransport) ||
        process.env.UI_CHAT_CLOUD_IPC_CHILD === "1";
      if (ownedChild) {
        try {
          transport.send({
            channel: CLOUD_RELAY_TICKET_IPC_CHANNEL, type: "state_request",
          });
        } catch {
          this.disconnected = true;
        }
      }
    }
  }

  private setAvailability(available: boolean) {
    if (this.available === available) return;
    this.available = available;
    if (!available) this.failAll("relay_ticket_not_configured");
    for (const subscriber of [...this.availabilityListeners]) {
      try { subscriber(available); } catch {
        // Native lifecycle observers must not crash the IPC control plane.
      }
    }
  }

  isHostAvailable(): boolean {
    return this.available && !this.closed && !this.disconnected;
  }

  onAvailabilityChanged(listener: (available: boolean) => void): () => void {
    this.availabilityListeners.add(listener);
    return () => { this.availabilityListeners.delete(listener); };
  }

  /** Subscribe to native logout/revocation; the actual socket close is DSK-010 Round 2. */
  onRevoked(listener: (reason: CloudRelayRevocationReason) => void): () => void {
    this.revoked.add(listener);
    return () => { this.revoked.delete(listener); };
  }

  /** Consume a fresh ticket inside trusted Backend code; never expose via HTTP. */
  async withHostTicket<T>(consumer: (ticket: CloudRelayHostTicket) => Promise<T> | T): Promise<T> {
    const ticket = await this.request();
    return consumer(ticket);
  }

  private request(): Promise<CloudRelayHostTicket> {
    if (this.closed || this.disconnected ||
        typeof this.transport.send !== "function" ||
        this.transport.connected === false) {
      return Promise.reject(new CloudRelayTicketBridgeError("relay_ticket_bridge_unavailable"));
    }
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(new CloudRelayTicketBridgeError("relay_ticket_bridge_busy"));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fail(id, "relay_ticket_bridge_timeout");
      }, this.timeoutMs);
      timeout.unref?.();
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.transport.send!({
          channel: CLOUD_RELAY_TICKET_IPC_CHANNEL, type: "request", requestId: id,
        }, (error) => {
          if (error) this.fail(id, "relay_ticket_bridge_disconnected");
        });
      } catch {
        this.fail(id, "relay_ticket_bridge_disconnected");
      }
    });
  }

  private fail(id: string, code: string): void {
    const request = this.pending.get(id);
    if (!request) return;
    this.pending.delete(id);
    clearTimeout(request.timeout);
    request.reject(new CloudRelayTicketBridgeError(code));
  }

  private failAll(code: string): void {
    for (const id of [...this.pending.keys()]) this.fail(id, code);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll("relay_ticket_bridge_unavailable");
    if (typeof this.transport.send === "function") {
      this.transport.off("message", this.onMessage);
      this.transport.off("disconnect", this.onDisconnect);
    }
    this.revoked.clear();
    this.availabilityListeners.clear();
    this.available = false;
  }
}
