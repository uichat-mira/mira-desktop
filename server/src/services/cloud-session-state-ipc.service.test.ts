import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  CLOUD_SESSION_STATE_IPC_CHANNEL as CHANNEL,
  CloudSessionStateIpcClient,
  type NativeCloudSessionState,
} from "./cloud-session-state-ipc.service.js";
import type { CloudRelayTicketIpcTransport } from "./cloud-relay-ticket-ipc.service.js";

class FakeParent extends EventEmitter implements CloudRelayTicketIpcTransport {
  connected = true;
  sent: Array<Record<string, unknown>> = [];
  send(value: unknown, callback?: (error: Error | null) => void) {
    this.sent.push(value as Record<string, unknown>);
    callback?.(null);
    return true;
  }
  state(state: string, extra: Record<string, unknown> = {}) {
    this.emit("message", { channel: CHANNEL, type: "state", state, ...extra });
  }
}

describe("CloudSessionStateIpcClient", () => {
  it("fails closed to unknown without a native bridge", () => {
    const transport = new FakeParent();
    (transport as { send?: FakeParent["send"] }).send = undefined;
    const client = new CloudSessionStateIpcClient(transport);
    expect(client.getState()).toBe("unknown");
    client.dispose();
  });

  it("asks the native owner for the restored lifecycle exactly once", () => {
    const parent = new FakeParent();
    const client = new CloudSessionStateIpcClient(parent);
    expect(parent.sent).toEqual([{ channel: CHANNEL, type: "state_request" }]);
    expect(client.getState()).toBe("unknown");
    client.dispose();
  });

  it("accepts only exact nonsecret lifecycle states and reports changes", () => {
    const parent = new FakeParent();
    const client = new CloudSessionStateIpcClient(parent);
    const changes = vi.fn<(state: NativeCloudSessionState) => void>();
    client.onStateChanged(changes);

    parent.emit("message", { channel: "other", type: "state", state: "signed_out" });
    parent.state("signed_out", { accountId: "forged" });
    parent.state("token");
    expect(client.getState()).toBe("unknown");

    parent.state("signed_in");
    expect(client.getState()).toBe("signed_in");
    expect(changes).toHaveBeenCalledExactlyOnceWith("signed_in");

    parent.state("restoring");
    parent.state("signed_out");
    parent.state("signed_out");
    expect(changes.mock.calls.map(([state]) => state)).toEqual([
      "signed_in",
      "restoring",
      "signed_out",
    ]);
    client.dispose();
  });

  it("drops to unknown on disconnect and dispose", () => {
    const parent = new FakeParent();
    const client = new CloudSessionStateIpcClient(parent);
    parent.state("signed_out");
    expect(client.getState()).toBe("signed_out");

    parent.emit("disconnect");
    expect(client.getState()).toBe("unknown");

    parent.state("signed_in");
    expect(client.getState()).toBe("unknown");

    client.dispose();
    expect(client.getState()).toBe("unknown");
  });
});
