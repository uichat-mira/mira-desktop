import { describe, expect, it, vi } from "vitest";
import { CloudHostGrantRuntime } from "./cloud-host-grant-runtime.service.js";
import type { RelayCloudProvenance } from "@/remote-relay/protocol.js";

const NOW = Date.parse("2026-10-31T08:00:00.000Z");
const identity: RelayCloudProvenance = {
  version: 1, transport: "cloud", accountId: "account-a",
  deviceId: "phone-a", room: "room_dGVzdC1yb29t", role: "client",
  connectionId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e",
  requestId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e~req-a",
};
const grant = (overrides: Record<string, unknown> = {}) => ({
  hostId: "host-1", accountId: "account-a", policyConfigured: true,
  policyScopes: ["threads:read", "tools:read"], revision: 3,
  issuedAt: "2026-10-31T07:59:00.000Z",
  validUntil: "2026-10-31T08:04:00.000Z", maxStalenessSeconds: 300,
  grants: [{ mobileDeviceId: "phone-a", scopes: ["threads:read"], status: "active" }],
  ...overrides,
});
const setup = () => {
  let raw: unknown = { snapshot: grant(), localOwnerUserId: 7 };
  let listener: (() => void) | undefined;
  const requestSnapshot = vi.fn(async () => {
    if (raw instanceof Error) throw raw;
    return raw;
  });
  const owner = { id: 7, username: "local-owner", role: "user" as const,
    isActive: true };
  const native = {
    requestSnapshot,
    onInvalidated: (fn: () => void) => {
      listener = fn;
      return () => { listener = undefined; };
    },
  };
  const runtime = new CloudHostGrantRuntime(native, (id) =>
    id === owner.id ? owner : null, () => NOW);
  return {
    runtime, owner, requestSnapshot,
    set: (next: unknown) => { raw = next; },
    revoke: () => listener?.(),
  };
};

describe("DSK-007 native-bound Cloud Host authority lifecycle (T1/T2)", () => {
  it("admits only current Mobile account, local owner and scoped Remote V1 route", async () => {
    const f = setup();
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW)).toMatchObject({
        accountId: "account-a", hostId: "host-1",
        mobileDeviceId: "phone-a", revision: 3, owner: { id: 7 },
        scopes: ["threads:read"],
      });
    expect(await f.runtime.authorize({ ...identity, accountId: "foreign" },
      "GET", "/remote/v1/workspaces", NOW)).toBeNull();
    expect(await f.runtime.authorize({ ...identity, deviceId: "phone-b" },
      "GET", "/remote/v1/workspaces", NOW)).toBeNull();
    expect(await f.runtime.authorize(identity,
      "GET", "/remote/v1/tools", NOW)).toBeNull();
    expect(await f.runtime.authorize(identity,
      "POST", "/remote/v1/tool-invocations/stream", NOW)).toBeNull();
    expect(await f.runtime.authorize(identity,
      "GET", "/admin/secrets", NOW)).toBeNull();
    expect(f.requestSnapshot).toHaveBeenCalledTimes(1);
    f.runtime.dispose();
  });

  it("rejects absent owner, malformed bound envelope and disabled local owner", async () => {
    const f = setup();
    f.set({ snapshot: grant() });
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW)).toBeNull();
    f.set({ snapshot: grant(), localOwnerUserId: 7 });
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW + 31_000)).not.toBeNull();
    f.owner.isActive = false;
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW + 32_000)).toBeNull();
    f.runtime.dispose();
  });

  it("replaces narrowed grant by revision, denies rollback without resurrection", async () => {
    const f = setup();
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW)).not.toBeNull();
    f.set({ localOwnerUserId: 7, snapshot: grant({
      revision: 4, grants: [{ mobileDeviceId: "phone-a", scopes: [],
        status: "revoked" }],
    }) });
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW + 31_000)).toBeNull();
    f.set({ localOwnerUserId: 7, snapshot: grant({ revision: 2 }) });
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW + 62_000)).toBeNull();
    f.runtime.dispose();
  });

  it("preserves unexpired authority on Cloud outage but never beyond validUntil", async () => {
    const f = setup();
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW)).not.toBeNull();
    f.set(Object.assign(new Error("transient"), { code: "cloud_grant_unavailable" }));
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW + 31_000)).not.toBeNull();
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW + 241_000)).toBeNull();
    f.runtime.dispose();
  });

  it("revocation aborts pending fetch and never revives a signed-out owner", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { release = resolve; });
    let listener: (() => void) | undefined;
    const runtime = new CloudHostGrantRuntime({
      requestSnapshot: () => pending,
      onInvalidated: (fn) => { listener = fn; return () => {}; },
    }, () => ({ id: 7, username: "local", role: "user", isActive: true }),
    () => NOW);
    const attempt = runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW);
    listener?.();
    release({ localOwnerUserId: 7, snapshot: grant() });
    expect(await attempt).toBeNull();
    runtime.dispose();
  });

  it("rejects an old grant that expires while a native refresh is pending", async () => {
    let activeNow = NOW;
    let rejectRefresh!: (reason: unknown) => void;
    let reads = 0;
    const native = {
      requestSnapshot: () => {
        reads++;
        if (reads === 1) return Promise.resolve({
          snapshot: grant(), localOwnerUserId: 7,
        });
        return new Promise<unknown>((_resolve, reject) => {
          rejectRefresh = reject;
        });
      },
      onInvalidated: () => () => {},
    };
    const runtime = new CloudHostGrantRuntime(native, () => ({
      id: 7, username: "local", role: "user", isActive: true,
    }), () => activeNow);
    expect(await runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW)).not.toBeNull();
    // The old proof expires at NOW+240s. The request enters just before it,
    // but a failed native IPC refresh settles after expiration.
    activeNow = NOW + 239_990;
    const pending = runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", activeNow);
    activeNow = NOW + 241_000;
    rejectRefresh(Object.assign(new Error("offline"), {
      code: "cloud_grant_unavailable",
    }));
    expect(await pending).toBeNull();
    runtime.dispose();
  });

  it("blocks an unannounced Cloud account or local owner switch", async () => {
    const f = setup();
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW)).not.toBeNull();
    f.set({ localOwnerUserId: 8, snapshot: grant({ accountId: "account-b" }) });
    expect(await f.runtime.authorize(identity, "GET",
      "/remote/v1/workspaces", NOW + 31_000)).toBeNull();
    f.runtime.dispose();
  });
});
