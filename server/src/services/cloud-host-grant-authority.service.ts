import {
  REMOTE_DEVICE_SCOPES,
  type RemoteDeviceScope,
} from "@/db/repositories/tailscale-remote-access.repository.js";
import { getRequiredRemoteScope } from "./remote-device-auth.service.js";

/**
 * DSK-007: Cloud Auth owns this complete ledger. The Desktop backend may only
 * install a snapshot received via the private Electron -> Backend channel
 * after Electron authenticates the Cloud Auth TLS response with its own
 * encrypted, Host-owning Cloud Session.
 *
 * This module deliberately does NOT admit a Relay request. A future ingress
 * adapter must first establish the Mobile identity from authenticated Relay
 * context, and bind it to the active local Desktop owner. Request headers and
 * client-provided device IDs are never trustworthy grant evidence.
 */
export type CloudHostGrantSnapshot = Readonly<{
  hostId: string;
  accountId: string;
  policyConfigured: boolean;
  policyScopes: readonly RemoteDeviceScope[];
  revision: number;
  issuedAt: string;
  validUntil: string;
  maxStalenessSeconds: number;
  grants: readonly Readonly<{
    mobileDeviceId: string;
    scopes: readonly RemoteDeviceScope[];
    status: "active" | "revoked";
  }>[];
}>;

export type CloudHostGrantBinding = Readonly<{
  accountId: string;
  hostId: string;
  localOwnerUserId: number;
}>;

const SCOPE_SET = new Set<string>(REMOTE_DEVICE_SCOPES);
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CLOCK_SKEW_MS = 30_000;
const MAX_TTL_SECONDS = 3600;
const MAX_GRANTS = 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value: unknown, keys: readonly string[]): boolean =>
  isRecord(value) && Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

const validRevision = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const scopesValid = (value: unknown): value is RemoteDeviceScope[] =>
  Array.isArray(value) && value.length <= REMOTE_DEVICE_SCOPES.length &&
  value.every((scope: unknown) => typeof scope === "string" && SCOPE_SET.has(scope)) &&
  new Set(value).size === value.length;

export class CloudHostGrantContractError extends Error {
  constructor() {
    super("Invalid or untrusted Cloud Host grant snapshot");
    this.name = "CloudHostGrantContractError";
  }
}

export function parseCloudHostGrantSnapshot(
  input: unknown,
  binding: CloudHostGrantBinding,
  nowMs: number = Date.now(),
): CloudHostGrantSnapshot {
  const bad = (): never => { throw new CloudHostGrantContractError(); };
  if (!validId(binding.accountId) || !validId(binding.hostId) ||
      !Number.isSafeInteger(binding.localOwnerUserId) ||
      binding.localOwnerUserId <= 0 || !Number.isFinite(nowMs)) return bad();

  if (!hasExactKeys(input, [
    "hostId", "accountId", "policyConfigured", "policyScopes", "revision",
    "issuedAt", "validUntil", "maxStalenessSeconds", "grants",
  ])) return bad();
  const raw = input as Record<string, unknown>;
  if (raw.hostId !== binding.hostId || raw.accountId !== binding.accountId ||
      typeof raw.policyConfigured !== "boolean" || !scopesValid(raw.policyScopes) ||
      !validRevision(raw.revision) ||
      typeof raw.maxStalenessSeconds !== "number" ||
      !Number.isSafeInteger(raw.maxStalenessSeconds) ||
      raw.maxStalenessSeconds < 1 || raw.maxStalenessSeconds > MAX_TTL_SECONDS ||
      typeof raw.issuedAt !== "string" || !ISO_DATE_TIME.test(raw.issuedAt) ||
      typeof raw.validUntil !== "string" || !ISO_DATE_TIME.test(raw.validUntil) ||
      !Array.isArray(raw.grants) || raw.grants.length > MAX_GRANTS) return bad();

  const issuedAt = Date.parse(raw.issuedAt);
  const validUntil = Date.parse(raw.validUntil);
  // Date.parse normalizes impossible calendar dates (e.g. February 31).
  // Grant validity must be the exact instant represented by Cloud Auth.
  if (!Number.isFinite(issuedAt) || !Number.isFinite(validUntil) ||
      new Date(issuedAt).toISOString() !== raw.issuedAt ||
      new Date(validUntil).toISOString() !== raw.validUntil) return bad();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(validUntil) ||
      issuedAt > nowMs + CLOCK_SKEW_MS || validUntil <= nowMs ||
      validUntil <= issuedAt ||
      validUntil - issuedAt > raw.maxStalenessSeconds * 1000 + 1000 ||
      (!raw.policyConfigured && raw.policyScopes.length > 0)) return bad();

  // Capture validated scopes in a stable local value before callback evaluation.
  const policyScopes = raw.policyScopes;
  const grants: Array<{
    mobileDeviceId: string;
    scopes: readonly RemoteDeviceScope[];
    status: "active" | "revoked";
  }> = [];
  const seen = new Set<string>();
  for (const entry of raw.grants) {
    if (!hasExactKeys(entry, ["mobileDeviceId", "scopes", "status"])) return bad();
    const grant = entry as Record<string, unknown>;
    if (!validId(grant.mobileDeviceId) || seen.has(grant.mobileDeviceId) ||
        !scopesValid(grant.scopes) ||
        (grant.status !== "active" && grant.status !== "revoked") ||
        (grant.status === "revoked" && grant.scopes.length !== 0) ||
        (!raw.policyConfigured && grant.scopes.length !== 0) ||
        grant.scopes.some((scope) => !policyScopes.includes(scope))) return bad();
    seen.add(grant.mobileDeviceId);
    grants.push(Object.freeze({
      mobileDeviceId: grant.mobileDeviceId,
      status: grant.status,
      scopes: Object.freeze([...grant.scopes]),
    }));
  }
  return Object.freeze({
    hostId: binding.hostId,
    accountId: binding.accountId,
    policyConfigured: raw.policyConfigured,
    policyScopes: Object.freeze([...raw.policyScopes]),
    revision: raw.revision,
    issuedAt: raw.issuedAt,
    validUntil: raw.validUntil,
    maxStalenessSeconds: raw.maxStalenessSeconds,
    grants: Object.freeze(grants),
  });
}

/**
 * An in-memory, bounded grant cache; not an authorization provider on its own.
 * Callers must additionally authenticate the ingress device and resolve the
 * active local Host owner before consulting it. No persisted snapshot or
 * renderer/mobile-supplied data is ever accepted here.
 */
export class CloudHostGrantCache {
  private snapshot: CloudHostGrantSnapshot | null = null;
  // Retain the highest trusted revision even after a failed refresh clears the
  // usable snapshot; otherwise a later replay could resurrect older grants.
  private highestObservedRevision: number | null = null;
  private highestPolicyFingerprint: string | null = null;
  private readonly binding: CloudHostGrantBinding;
  constructor(binding: CloudHostGrantBinding) {
    // The trusted native account/local-owner association is fixed for this
    // cache lifecycle: mutation by a caller cannot silently switch owners.
    this.binding = Object.freeze({ ...binding });
  }

  replaceFromTrustedNative(input: unknown, nowMs = Date.now()): void {
    try {
      const candidate = parseCloudHostGrantSnapshot(input, this.binding, nowMs);
      // A ledger revision changes on any grant mutation. issuedAt/validUntil
      // may advance at the same revision, but scopes cannot change under it.
      const fingerprint = JSON.stringify([candidate.policyConfigured,
        candidate.policyScopes, candidate.grants]);
      if (this.highestObservedRevision !== null &&
          (candidate.revision < this.highestObservedRevision ||
          (candidate.revision === this.highestObservedRevision &&
           fingerprint !== this.highestPolicyFingerprint))) {
        throw new CloudHostGrantContractError();
      }
      this.highestObservedRevision = candidate.revision;
      this.highestPolicyFingerprint = fingerprint;
      this.snapshot = candidate;
    } catch (error) {
      // A malformed/mismatched/replayed response cannot keep an old positive
      // authorization alive just because its cached deadline has not passed.
      this.snapshot = null;
      throw error;
    }
  }

  /** Cloud outage preserves an existing proof only until its own expiry. */
  refreshUnavailable(): void {
    // Do not extend or re-issue the server-signed-in-context TTL.
  }

  clear(): void {
    this.snapshot = null;
    // An explicit local signout ends the bound native Session lifecycle.
    this.highestObservedRevision = null;
    this.highestPolicyFingerprint = null;
  }

  allows(
    mobileDeviceIdFromAuthenticatedIngress: string,
    activeLocalOwnerUserId: number,
    method: string,
    path: string,
    nowMs = Date.now(),
  ): boolean {
    const proof = this.snapshot;
    if (!proof || !Number.isFinite(nowMs) ||
        !validId(mobileDeviceIdFromAuthenticatedIngress) ||
        activeLocalOwnerUserId !== this.binding.localOwnerUserId ||
        Date.parse(proof.validUntil) <= nowMs ||
        !proof.policyConfigured) return false;

    const scope = getRequiredRemoteScope(method, path);
    if (!scope) return false;
    const grant = proof.grants.find(
      (item) => item.mobileDeviceId === mobileDeviceIdFromAuthenticatedIngress,
    );
    if (!grant || grant.status !== "active") return false;
    // Manifest discovery requires an authenticated Mobile with a non-empty
    // effective grant. Push pairing-bootstrap paths remain forbidden on Cloud.
    if (scope === "authenticated") {
      return method.toUpperCase() === "GET" &&
        path.split("?")[0] === "/remote/v1/manifest" && grant.scopes.length > 0;
    }
    return grant.scopes.includes(scope) && proof.policyScopes.includes(scope);
  }

  /** Read-only effective Mobile scopes for the canonical Remote V1 manifest. */
  getEffectiveScopes(
    mobileDeviceId: string,
    ownerUserId: number,
    nowMs = Date.now(),
  ): readonly RemoteDeviceScope[] {
    const proof = this.snapshot;
    if (!proof || !proof.policyConfigured ||
        ownerUserId !== this.binding.localOwnerUserId ||
        Date.parse(proof.validUntil) <= nowMs) return [];
    const grant = proof.grants.find((g) => g.mobileDeviceId === mobileDeviceId);
    if (!grant || grant.status !== "active") return [];
    return grant.scopes.filter((scope) => proof.policyScopes.includes(scope));
  }

  getRevision(nowMs = Date.now()): number | null {
    return this.snapshot && Date.parse(this.snapshot.validUntil) > nowMs
      ? this.snapshot.revision : null;
  }
}
