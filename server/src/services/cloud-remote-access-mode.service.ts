import type { NativeCloudSessionState } from "./cloud-session-state-ipc.service.js";

/**
 * DSK-018: Desktop remote access is mutually exclusive with a Mira Cloud
 * account. The native Cloud Session lifecycle projects this minimal state to
 * the Backend. Only an explicitly confirmed signed-out lifecycle may admit
 * Tailscale Direct pairing or device traffic; restoring/unavailable states fail
 * closed so a Relay outage is never mistaken for a sign-out.
 */
export type CloudRemoteAccessMode = NativeCloudSessionState;

class CloudRemoteAccessModeStore {
  private mode: CloudRemoteAccessMode = "unknown";
  private readonly listeners = new Set<() => void>();

  applyNativeSessionState(state: CloudRemoteAccessMode): void {
    if (this.mode === state) return;
    this.mode = state;
    for (const subscriber of [...this.listeners]) {
      try {
        subscriber();
      } catch {
        // A mode observer cannot break the admission gate.
      }
    }
  }

  reset(): void {
    this.applyNativeSessionState("unknown");
  }

  getMode(): CloudRemoteAccessMode {
    return this.mode;
  }

  isDirectRemoteAccessAllowed(): boolean {
    return this.mode === "signed_out";
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const cloudRemoteAccessMode = new CloudRemoteAccessModeStore();
