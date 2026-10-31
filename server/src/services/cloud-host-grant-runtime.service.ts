import type { AuthenticatedUser } from "@/db/auth.db.js";
import type { RelayCloudProvenance } from "@/remote-relay/protocol.js";
import { getRequiredRemoteScope } from "./remote-device-auth.service.js";
import {
  CloudHostGrantCache,
  type CloudHostGrantBinding,
} from "./cloud-host-grant-authority.service.js";
import type {
  CloudGrantInvalidation,
  CloudHostGrantIpcClient,
} from "./cloud-host-grant-ipc.service.js";

/**
 * Backend-only authority sync: the sole source is Electron's private child
 * IPC, never a Mobile header, Relay ticket, renderer state or Portal view.
 * No Cloud Auth introspection occurs on individual tool invocations.
 */
type NativeGrantSource = Pick<CloudHostGrantIpcClient, "requestSnapshot" | "onInvalidated">;
type LocalUser = AuthenticatedUser & { isActive: boolean };
type ResolveOwner = (userId: number) => LocalUser | null;
type Envelope = { snapshot: Record<string, unknown>; localOwnerUserId: number };

export type CloudGrantAdmission = Readonly<{
  owner: AuthenticatedUser;
  accountId: string;
  hostId: string;
  mobileDeviceId: string;
  revision: number;
}>;

const REFRESH_INTERVAL_MS = 30_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isEnvelope = (value: unknown): value is Envelope =>
  isRecord(value) && Object.keys(value).length === 2 &&
  isRecord(value.snapshot) &&
  Number.isSafeInteger(value.localOwnerUserId) &&
  (value.localOwnerUserId as number) > 0;

const isTransient = (error: unknown): boolean =>
  isRecord(error) && typeof error.code === "string" &&
  (error.code === "cloud_grant_unavailable" ||
   error.code === "cloud_grant_bridge_timeout" ||
   error.code === "cloud_grant_bridge_busy");

const sameBinding = (a: CloudHostGrantBinding, b: CloudHostGrantBinding) =>
  a.accountId === b.accountId && a.hostId === b.hostId &&
  a.localOwnerUserId === b.localOwnerUserId;

export class CloudHostGrantRuntime {
  private binding: CloudHostGrantBinding | null = null;
  private cache: CloudHostGrantCache | null = null;
  private lastAttemptMs = -Infinity;
  private inFlight: Promise<void> | null = null;
  private generation = 0;
  private blocked = false;
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly native: NativeGrantSource,
    private readonly resolveOwner: ResolveOwner,
  ) {
    this.unsubscribe = native.onInvalidated((_reason: CloudGrantInvalidation) => {
      // A late IPC reply must never revive revoked owner/grant authority.
      this.invalidate();
    });
  }

  private invalidate() {
    this.generation++;
    this.binding = null;
    this.cache?.clear();
    this.cache = null;
    this.lastAttemptMs = -Infinity;
    this.blocked = true;
  }

  private async reload(now: number) {
    const generation = this.generation;
    this.lastAttemptMs = now;
    try {
      const envelope = await this.native.requestSnapshot();
      if (this.disposed || generation !== this.generation) return;
      if (!isEnvelope(envelope)) throw new Error("cloud_grant_invalid_envelope");
      const raw = envelope.snapshot;
      if (typeof raw.accountId !== "string" ||
          typeof raw.hostId !== "string" ||
          !raw.accountId || !raw.hostId) throw new Error("cloud_grant_invalid_binding");
      const owner = this.resolveOwner(envelope.localOwnerUserId);
      if (!owner || !owner.isActive || owner.id !== envelope.localOwnerUserId)
        throw new Error("cloud_grant_owner_inactive");
      const binding: CloudHostGrantBinding = {
        accountId: raw.accountId, hostId: raw.hostId,
        localOwnerUserId: envelope.localOwnerUserId,
      };
      if (this.binding && !sameBinding(this.binding, binding)) {
        // An unsolicited account/Host/owner switch is not a valid grant refresh.
        throw new Error("cloud_grant_binding_changed");
      }
      const cache = this.cache ?? new CloudHostGrantCache(binding);
      cache.replaceFromTrustedNative(raw, now);
      this.cache = cache;
      this.binding = Object.freeze(binding);
      this.blocked = false;
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      // Cloud outage may use the *existing unexpired* proof only until TTL.
      // Malformed, revoked or unbound authority must never fall back to it.
      if (!isTransient(error)) this.blocked = true;
    }
  }

  async authorize(
    identity: RelayCloudProvenance,
    method: string,
    path: string,
    nowMs = Date.now(),
  ): Promise<CloudGrantAdmission | null> {
    if (this.disposed || !Number.isFinite(nowMs) ||
        !getRequiredRemoteScope(method, path)) return null;
    if (nowMs - this.lastAttemptMs >= REFRESH_INTERVAL_MS && !this.inFlight) {
      const work = this.reload(nowMs);
      this.inFlight = work;
      void work.finally(() => {
        if (this.inFlight === work) this.inFlight = null;
      });
    }
    await this.inFlight;
    if (this.disposed || this.blocked || !this.cache || !this.binding ||
        identity.accountId !== this.binding.accountId) return null;
    const owner = this.resolveOwner(this.binding.localOwnerUserId);
    if (!owner || !owner.isActive ||
        owner.id !== this.binding.localOwnerUserId) {
      this.blocked = true;
      return null;
    }
    if (!this.cache.allows(identity.deviceId, owner.id, method, path, nowMs))
      return null;
    const revision = this.cache.getRevision(nowMs);
    if (revision === null) return null;
    return {
      owner: { id: owner.id, username: owner.username, role: owner.role },
      accountId: this.binding.accountId,
      hostId: this.binding.hostId,
      mobileDeviceId: identity.deviceId,
      revision,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.invalidate();
  }
}
