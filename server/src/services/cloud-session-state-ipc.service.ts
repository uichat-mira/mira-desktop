import type { CloudRelayTicketIpcTransport } from "./cloud-relay-ticket-ipc.service.js";

// DSK-018: the native Cloud Session lifecycle is the only authority allowed to
// decide whether Mira's Tailscale Direct remote access may be used. This private
// child IPC carries a nonsecret mode projection only; never an account, token
// or grant. An absent or disconnected bridge conveys "unknown" (fail closed).
export const CLOUD_SESSION_STATE_IPC_CHANNEL = "mira:cloud-session:state:v1";

export type NativeCloudSessionState =
  | "signed_out"
  | "signed_in"
  | "restoring"
  | "unknown";

const STATES: ReadonlySet<string> = new Set([
  "signed_out",
  "signed_in",
  "restoring",
  "unknown",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const exactKeys = (value: unknown, keys: readonly string[]): boolean =>
  isRecord(value) && Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export class CloudSessionStateIpcClient {
  private state: NativeCloudSessionState = "unknown";
  private readonly listeners = new Set<(state: NativeCloudSessionState) => void>();
  private closed = false;
  private disconnected = false;

  private readonly onMessage = (message?: unknown) => {
    if (this.closed || this.disconnected || !isRecord(message) ||
        message.channel !== CLOUD_SESSION_STATE_IPC_CHANNEL) {
      return;
    }
    if (!exactKeys(message, ["channel", "type", "state"]) ||
        message.type !== "state" || typeof message.state !== "string" ||
        !STATES.has(message.state)) {
      return;
    }
    this.setState(message.state as NativeCloudSessionState);
  };

  private readonly onDisconnect = () => {
    this.disconnected = true;
    this.setState("unknown");
  };

  constructor(
    private readonly transport: CloudRelayTicketIpcTransport =
      process as unknown as CloudRelayTicketIpcTransport,
  ) {
    if (typeof transport.send === "function") {
      transport.on("message", this.onMessage);
      transport.on("disconnect", this.onDisconnect);
      // Only the Electron-spawned Backend may ask the native owner for its
      // lifecycle. Vitest workers also own process.send() for their protocol.
      const ownedChild = transport !== (process as CloudRelayTicketIpcTransport) ||
        process.env.UI_CHAT_CLOUD_IPC_CHILD === "1";
      if (ownedChild) {
        try {
          transport.send({
            channel: CLOUD_SESSION_STATE_IPC_CHANNEL, type: "state_request",
          });
        } catch {
          this.disconnected = true;
        }
      }
    }
  }

  private setState(next: NativeCloudSessionState) {
    if (this.state === next) return;
    this.state = next;
    for (const subscriber of [...this.listeners]) {
      try {
        subscriber(next);
      } catch {
        // A lifecycle observer cannot break the native control plane.
      }
    }
  }

  getState(): NativeCloudSessionState {
    return this.closed || this.disconnected ? "unknown" : this.state;
  }

  onStateChanged(listener: (state: NativeCloudSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    if (typeof this.transport.send === "function") {
      this.transport.off("message", this.onMessage);
      this.transport.off("disconnect", this.onDisconnect);
    }
    this.listeners.clear();
    this.state = "unknown";
  }
}
