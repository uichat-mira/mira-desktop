import { describe, expect, it } from "vitest";
import { parseRelayInboundHostFrame } from "./protocol.js";

const room = "room_dGVzdC1yb29t";
const conn = "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e";
const requestId = conn + "~one-request";
const provenance = () => ({
  version: 1, transport: "cloud", accountId: "account-a",
  deviceId: "mobile-a", room, role: "client",
  connectionId: conn, requestId,
});
const req = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, type: "request", requestId,
    method: "GET", path: "/remote/v1/manifest",
    relayProvenance: provenance(), ...overrides });

describe("DSK-007 official Cloud Relay provenance consumer contract (T2)", () => {
  it("preserves only verified-form Cloud provenance on a Cloud-specific parser path", () => {
    expect(parseRelayInboundHostFrame(req(), room)).toMatchObject({
      type: "request", requestId, relayProvenance: provenance(),
    });
    // Legacy still parses the same V1 frame without taking identity authority.
    expect(parseRelayInboundHostFrame(req())).not.toHaveProperty("relayProvenance");
  });

  it.each([
    ["missing", undefined],
    ["spoofed device type", { ...provenance(), deviceId: 12 }],
    ["wrong room", { ...provenance(), room: "room_d3Jvbmc" }],
    ["foreign role", { ...provenance(), role: "host" }],
    ["request swap", { ...provenance(), requestId: conn + "~another" }],
    ["connection swap", { ...provenance(), connectionId: "a6afaf4a-b2c0-4912-9ecd-abb3f45fb92e" }],
    ["wrong version", { ...provenance(), version: 2 }],
    ["extra fields", { ...provenance(), authority: "tools:invoke" }],
    ["invalid host metadata", { ...provenance(), accountId: "" }],
  ])("fails closed on %s rather than trusting frame/header-provided identity", (_case, proof) => {
    const raw = req({ relayProvenance: proof,
      headers: { authorization: "Bearer mira_device_fake" } });
    expect(parseRelayInboundHostFrame(raw, room)).toBeNull();
  });

  it("rejects a mismatched Cloud host room and unsolicited claims in Legacy", () => {
    expect(parseRelayInboundHostFrame(req(), "room_Zm9yZWlnbi0xMjM0")).toBeNull();
    expect(parseRelayInboundHostFrame(req({ mobileDeviceId: "forged-mobile" }))).toMatchObject({
      type: "request", requestId,
    });
    expect(parseRelayInboundHostFrame(req({ mobileDeviceId: "forged-mobile" })))
      .not.toHaveProperty("relayProvenance");
  });

  it("requires the same bound provenance on a Cloud cancellation", () => {
    const cancel = (p: unknown) => JSON.stringify({
      version: 1, type: "cancel", requestId, relayProvenance: p,
    });
    expect(parseRelayInboundHostFrame(cancel(provenance()), room)).toMatchObject({
      type: "cancel", requestId, relayProvenance: provenance(),
    });
    // The Relay socket-cleanup path emits an unadorned routed cancel.
    expect(parseRelayInboundHostFrame(cancel(undefined), room)).toMatchObject({
      type: "cancel", requestId,
    });
    expect(parseRelayInboundHostFrame(cancel(undefined), room))
      .not.toHaveProperty("relayProvenance");
    expect(parseRelayInboundHostFrame(cancel({ ...provenance(), deviceId: "x", requestId: "wrong" }), room))
      .toBeNull();
    expect(parseRelayInboundHostFrame(cancel(undefined))).toMatchObject({
      type: "cancel", requestId,
    });
  });

  it("rejects forged or malformed bare Cloud cancellation without granting authority", () => {
    const cancel = (id: string, claim?: unknown) => JSON.stringify({
      version: 1, type: "cancel", requestId: id,
      ...(claim === undefined ? {} : { relayProvenance: claim }),
    });
    expect(parseRelayInboundHostFrame(cancel("not-connection-bound"), room)).toBeNull();
    expect(parseRelayInboundHostFrame(cancel(conn + "~"), room)).toBeNull();
    expect(parseRelayInboundHostFrame(cancel("not-a-uuid~one-request"), room)).toBeNull();
    expect(parseRelayInboundHostFrame(cancel(requestId, { deviceId: "fake" }), room))
      .toBeNull();
    // Missing Cloud request provenance is ALWAYS denied, unlike cleanup-only cancellation.
    expect(parseRelayInboundHostFrame(req({ relayProvenance: undefined }), room))
      .toBeNull();
  });

  it("never promotes transport identity to a direct permission decision", () => {
    const result = parseRelayInboundHostFrame(req(), room);
    expect(result).toMatchObject({ type: "request", relayProvenance: provenance() });
    expect(result).not.toHaveProperty("grant");
    expect(result).not.toHaveProperty("userId");
  });
});
