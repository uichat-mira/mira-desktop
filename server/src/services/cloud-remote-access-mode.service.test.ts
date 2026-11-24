import { describe, expect, it, vi } from "vitest";
import { cloudRemoteAccessMode } from "./cloud-remote-access-mode.service.js";

describe("cloudRemoteAccessMode", () => {
  it("starts unknown and denies Direct until a confirmed native sign-out", () => {
    cloudRemoteAccessMode.reset();
    expect(cloudRemoteAccessMode.getMode()).toBe("unknown");
    expect(cloudRemoteAccessMode.isDirectRemoteAccessAllowed()).toBe(false);

    cloudRemoteAccessMode.applyNativeSessionState("signed_in");
    expect(cloudRemoteAccessMode.isDirectRemoteAccessAllowed()).toBe(false);
    cloudRemoteAccessMode.applyNativeSessionState("restoring");
    expect(cloudRemoteAccessMode.isDirectRemoteAccessAllowed()).toBe(false);

    cloudRemoteAccessMode.applyNativeSessionState("signed_out");
    expect(cloudRemoteAccessMode.isDirectRemoteAccessAllowed()).toBe(true);
  });

  it("notifies observers once per actual transition and can reset", () => {
    cloudRemoteAccessMode.reset();
    const listener = vi.fn();
    const unsubscribe = cloudRemoteAccessMode.subscribe(listener);

    cloudRemoteAccessMode.applyNativeSessionState("signed_in");
    cloudRemoteAccessMode.applyNativeSessionState("signed_in");
    expect(listener).toHaveBeenCalledTimes(1);

    cloudRemoteAccessMode.applyNativeSessionState("signed_out");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    cloudRemoteAccessMode.applyNativeSessionState("unknown");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(cloudRemoteAccessMode.getMode()).toBe("unknown");
  });
});
