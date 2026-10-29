import { describe, expect, it } from "vitest";
import {
  CloudHostGrantCache,
  CloudHostGrantContractError,
} from "./cloud-host-grant-authority.service.js";

const NOW = Date.parse("2026-10-26T04:00:00.000Z");
const binding = { hostId: "host-1", accountId: "account-1", localOwnerUserId: 7 };
const valid = (overrides: Record<string, unknown> = {}) => ({
  hostId: binding.hostId,
  accountId: binding.accountId,
  policyConfigured: true,
  policyScopes: ["threads:read", "tools:read", "tools:invoke"],
  revision: 2,
  issuedAt: "2026-10-26T03:59:00.000Z",
  validUntil: "2026-10-26T04:04:00.000Z",
  maxStalenessSeconds: 300,
  grants: [
    { mobileDeviceId: "phone-1", scopes: ["threads:read", "tools:read"], status: "active" },
    { mobileDeviceId: "phone-2", scopes: ["tools:invoke"], status: "active" },
    { mobileDeviceId: "phone-3", scopes: [], status: "revoked" },
  ],
  ...overrides,
});

describe("DSK-007 Cloud Host grant verification (T1; not Relay ingress)", () => {
  it("allows only a matched account, Host, Mobile, local owner and route scope", () => {
    const cache = new CloudHostGrantCache(binding);
    cache.replaceFromTrustedNative(valid(), NOW);
    expect(cache.allows("phone-1", 7, "GET", "/remote/v1/tools", NOW)).toBe(true);
    expect(cache.allows("phone-1", 7, "POST", "/remote/v1/tool-invocations/stream", NOW)).toBe(false);
    expect(cache.allows("phone-2", 7, "POST", "/remote/v1/tool-invocations/stream", NOW)).toBe(true);
    expect(cache.allows("phone-3", 7, "GET", "/remote/v1/tools", NOW)).toBe(false);
    expect(cache.allows("foreign-phone", 7, "GET", "/remote/v1/tools", NOW)).toBe(false);
    expect(cache.allows("phone-1", 8, "GET", "/remote/v1/tools", NOW)).toBe(false);
    expect(cache.allows("phone-1", 7, "GET", "/secrets", NOW)).toBe(false);
    expect(cache.allows("phone-1", 7, "POST", "/remote/v1/push/binding-descriptor", NOW)).toBe(false);
  });

  it("applies narrowing/revocation as atomic revision replacement", () => {
    const cache = new CloudHostGrantCache(binding);
    cache.replaceFromTrustedNative(valid(), NOW);
    cache.replaceFromTrustedNative(valid({
      revision: 3,
      grants: [{ mobileDeviceId: "phone-1", scopes: ["threads:read"], status: "active" }],
    }), NOW);
    expect(cache.allows("phone-1", 7, "GET", "/remote/v1/tools", NOW)).toBe(false);
    expect(cache.allows("phone-1", 7, "GET", "/remote/v1/workspaces", NOW)).toBe(true);
    cache.replaceFromTrustedNative(valid({
      revision: 4,
      grants: [{ mobileDeviceId: "phone-1", scopes: [], status: "revoked" }],
    }), NOW);
    expect(cache.allows("phone-1", 7, "GET", "/remote/v1/workspaces", NOW)).toBe(false);
  });

  it("never extends a proof on network outage and fails closed after expiry", () => {
    const cache = new CloudHostGrantCache(binding);
    cache.replaceFromTrustedNative(valid(), NOW);
    cache.refreshUnavailable();
    expect(cache.allows("phone-1", 7, "GET", "/remote/v1/tools", NOW + 1000)).toBe(true);
    expect(cache.allows("phone-1", 7, "GET", "/remote/v1/tools", NOW + 241_000)).toBe(false);
    expect(cache.getRevision(NOW + 241_000)).toBeNull();
  });

  it.each([
    { accountId: "foreign-account" },
    { hostId: "foreign-host" },
    { revision: -1 },
    { maxStalenessSeconds: 9999 },
    { validUntil: "2026-10-26T04:10:00.000Z" },
    { validUntil: "2026-10-26T03:59:59.000Z" },
    { issuedAt: "2026-10-26T04:05:00.000Z" },
    { policyScopes: ["relay:transport"] },
    { policyScopes: ["tools:read", "tools:read"] },
    { grants: [{ mobileDeviceId: "phone-1", scopes: ["tools:control"], status: "active" }] },
    { grants: [{ mobileDeviceId: "phone-1", scopes: ["tools:read"], status: "revoked" }] },
    { grants: [
      { mobileDeviceId: "phone-1", scopes: ["tools:read"], status: "active" },
      { mobileDeviceId: "phone-1", scopes: ["tools:read"], status: "active" },
    ] },
  ])("rejects malformed, foreign or overpowered authority (%j)", (overrides) => {
    const cache = new CloudHostGrantCache(binding);
    expect(() => cache.replaceFromTrustedNative(valid(overrides), NOW))
      .toThrow(CloudHostGrantContractError);
  });

  it("rejects revision rollback and clears formerly valid authority", () => {
    const cache = new CloudHostGrantCache(binding);
    cache.replaceFromTrustedNative(valid({ revision: 5 }), NOW);
    expect(() => cache.replaceFromTrustedNative(valid({ revision: 4 }), NOW))
      .toThrow(CloudHostGrantContractError);
    expect(cache.allows("phone-1", 7, "GET", "/remote/v1/tools", NOW)).toBe(false);
    // A rejected rollback must not discard the monotonic version watermark.
    expect(() => cache.replaceFromTrustedNative(valid({ revision: 4 }), NOW))
      .toThrow(CloudHostGrantContractError);
    expect(cache.allows("phone-1", 7, "GET", "/remote/v1/tools", NOW)).toBe(false);
    // A freshly authenticated snapshot at the observed revision can recover.
    cache.replaceFromTrustedNative(valid({ revision: 5 }), NOW);
    expect(cache.allows("phone-1", 7, "GET", "/remote/v1/tools", NOW)).toBe(true);
  });

  it("never resurrects an older grant after an invalid refresh", () => {
    const cache = new CloudHostGrantCache(binding);
    cache.replaceFromTrustedNative(valid({ revision: 6 }), NOW);
    expect(() => cache.replaceFromTrustedNative(valid({
      revision: 7, accountId: "wrong-account",
    }), NOW)).toThrow(CloudHostGrantContractError);
    expect(() => cache.replaceFromTrustedNative(valid({ revision: 5 }), NOW))
      .toThrow(CloudHostGrantContractError);
    expect(cache.getRevision(NOW)).toBeNull();
    cache.replaceFromTrustedNative(valid({ revision: 7 }), NOW);
    expect(cache.getRevision(NOW)).toBe(7);
  });

  it("rejects unconfigured Host and supports explicit logout clear", () => {
    const cache = new CloudHostGrantCache(binding);
    cache.replaceFromTrustedNative(valid({
      policyConfigured: false, policyScopes: [], grants: [],
    }), NOW);
    expect(cache.allows("phone-1", 7, "GET", "/remote/v1/workspaces", NOW)).toBe(false);
    cache.replaceFromTrustedNative(valid(), NOW);
    cache.clear();
    expect(cache.getRevision(NOW)).toBeNull();
  });
});
