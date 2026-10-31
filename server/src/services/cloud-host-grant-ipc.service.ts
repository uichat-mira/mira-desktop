import { randomUUID } from "node:crypto";
import type { CloudRelayTicketIpcTransport } from "./cloud-relay-ticket-ipc.service.js";

// DSK-007: same private Electron-spawned child IPC as the Relay ticket channel,
// but a different purpose and envelope. Never exposed as a local HTTP route.
export const CLOUD_HOST_GRANT_IPC_CHANNEL = "mira:cloud-host-grant:snapshot:v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PENDING = 2;
const ERRORS = new Set([
  "cloud_grant_not_configured", "cloud_grant_reauth",
  "cloud_grant_not_authorized", "cloud_grant_unavailable",
  "cloud_grant_invalid_response", "cloud_grant_aborted",
  "cloud_grant_bridge_busy",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const hasKeys = (value: unknown, keys: readonly string[]): boolean =>
  isRecord(value) && Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export type CloudGrantInvalidation = "signout" | "reauth" | "bridge_disconnected";

export class CloudHostGrantIpcError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CloudHostGrantIpcError";
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: CloudHostGrantIpcError) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class CloudHostGrantIpcClient {
  private readonly pending = new Map<string, Pending>();
  private readonly invalidations = new Set<(reason: CloudGrantInvalidation) => void>();
  private disposed = false;
  private disconnected = false;

  private readonly onMessage = (value?: unknown) => {
    if (this.disposed || !isRecord(value) ||
        value.channel !== CLOUD_HOST_GRANT_IPC_CHANNEL) return;
    if (value.type === "revoked" && hasKeys(value, ["channel", "type", "reason"]) &&
        (value.reason === "signout" || value.reason === "reauth")) {
      this.failAll("cloud_grant_" + value.reason);
      this.emitInvalidation(value.reason);
      return;
    }
    if (value.type !== "result" || typeof value.requestId !== "string" ||
        !UUID.test(value.requestId)) return;
    const request = this.pending.get(value.requestId);
    if (!request) return; // stale/duplicate/unsolicited IPC reply
    this.pending.delete(value.requestId);
    clearTimeout(request.timeout);
    if (value.ok === true && hasKeys(value,
        ["channel", "type", "requestId", "ok", "snapshot", "localOwnerUserId"]) &&
        isRecord(value.snapshot) &&
        Number.isSafeInteger(value.localOwnerUserId) &&
        (value.localOwnerUserId as number) > 0) {
      request.resolve({ snapshot: value.snapshot,
        localOwnerUserId: value.localOwnerUserId });
      return;
    }
    if (value.ok === false && hasKeys(value,
        ["channel", "type", "requestId", "ok", "errorCode"]) &&
        typeof value.errorCode === "string" && ERRORS.has(value.errorCode)) {
      request.reject(new CloudHostGrantIpcError(value.errorCode));
      return;
    }
    request.reject(new CloudHostGrantIpcError("cloud_grant_invalid_response"));
  };

  private readonly onDisconnect = () => {
    if (this.disconnected) return;
    this.disconnected = true;
    this.failAll("cloud_grant_bridge_disconnected");
    this.emitInvalidation("bridge_disconnected");
  };

  constructor(
    private readonly transport: CloudRelayTicketIpcTransport =
      process as unknown as CloudRelayTicketIpcTransport,
    private readonly timeoutMs = 15_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("Invalid Host grant IPC timeout");
    }
    if (typeof transport.send === "function") {
      transport.on("message", this.onMessage);
      transport.on("disconnect", this.onDisconnect);
    }
  }

  onInvalidated(listener: (reason: CloudGrantInvalidation) => void): () => void {
    this.invalidations.add(listener);
    return () => { this.invalidations.delete(listener); };
  }

  /** Returns private native {snapshot, localOwnerUserId} envelope.
   * Caller MUST re-check local user state, Cloud account/Host match,
   * and parseCloudHostGrantSnapshot before any business authorization. */
  requestSnapshot(): Promise<unknown> {
    if (this.disposed || this.disconnected ||
        this.transport.connected === false ||
        typeof this.transport.send !== "function") {
      return Promise.reject(new CloudHostGrantIpcError("cloud_grant_bridge_unavailable"));
    }
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(new CloudHostGrantIpcError("cloud_grant_bridge_busy"));
    }
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => this.fail(requestId, "cloud_grant_bridge_timeout"), this.timeoutMs);
      timeout.unref?.();
      this.pending.set(requestId, { resolve, reject, timeout });
      try {
        this.transport.send!({
          channel: CLOUD_HOST_GRANT_IPC_CHANNEL, type: "request", requestId,
        }, (error) => {
          if (error) this.fail(requestId, "cloud_grant_bridge_disconnected");
        });
      } catch {
        this.fail(requestId, "cloud_grant_bridge_disconnected");
      }
    });
  }

  private emitInvalidation(reason: CloudGrantInvalidation): void {
    for (const listener of [...this.invalidations]) {
      try { listener(reason); } catch { /* callback cannot crash native IPC */ }
    }
  }

  private fail(id: string, code: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(new CloudHostGrantIpcError(code));
  }

  private failAll(code: string): void {
    for (const id of [...this.pending.keys()]) this.fail(id, code);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll("cloud_grant_bridge_unavailable");
    if (typeof this.transport.send === "function") {
      this.transport.off("message", this.onMessage);
      this.transport.off("disconnect", this.onDisconnect);
    }
    this.invalidations.clear();
  }
}
