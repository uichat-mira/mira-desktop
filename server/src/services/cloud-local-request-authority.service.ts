import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { userRepository } from "@/db/index.js";
import type { AuthenticatedUser } from "@/db/auth.db.js";
import { getRequiredRemoteScope } from "./remote-device-auth.service.js";
import type { CloudGrantAdmission } from "./cloud-host-grant-runtime.service.js";

/**
 * Cloud Relay is never allowed to forward a local Mira JWT or a QR-pairing
 * token. The Backend issues a one-shot, in-process capability after native
 * Cloud Grant verification. Only its own loopback fetch can consume it.
 */
export const CLOUD_INTERNAL_REQUEST_HEADER = "x-mira-cloud-internal-request";
const CAPABILITY_TTL_MS = 10_000;
const MAX_PENDING = 128;

export type CloudRemoteCaller = Readonly<{
  kind: "cloud";
  mobileDeviceId: string;
  accountId: string;
  hostId: string;
  revision: number;
  scopes: readonly string[];
  owner: AuthenticatedUser;
}>;

declare module "fastify" {
  interface FastifyRequest {
    cloudRemoteCaller?: CloudRemoteCaller;
  }
}

type Pending = {
  method: string;
  path: string;
  expiresAt: number;
  caller: CloudRemoteCaller;
};

export class CloudLocalRequestAuthority {
  private readonly pending = new Map<string, Pending>();

  issue(admission: CloudGrantAdmission, method: string, path: string,
    now = Date.now()): string | null {
    // Expired capabilities can remain unconsumed if the local fetch aborts
    // before reaching Fastify. Reap them to prevent permanent saturation.
    for (const [token, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(token);
    }
    if (!Number.isFinite(now) || this.pending.size >= MAX_PENDING ||
        !getRequiredRemoteScope(method, path)) return null;
    const ticket = randomBytes(32).toString("base64url");
    this.pending.set(ticket, {
      method: method.toUpperCase(), path, expiresAt: now + CAPABILITY_TTL_MS,
      caller: Object.freeze({
        kind: "cloud", mobileDeviceId: admission.mobileDeviceId,
        accountId: admission.accountId, hostId: admission.hostId,
        revision: admission.revision, scopes: Object.freeze([...admission.scopes]),
        owner: Object.freeze({ ...admission.owner }),
      }),
    });
    return ticket;
  }

  consume(ticket: unknown, method: string, path: string,
    now = Date.now()): CloudRemoteCaller | null {
    if (typeof ticket !== "string" || ticket.length !== 43) return null;
    const pending = this.pending.get(ticket);
    if (!pending) return null;
    this.pending.delete(ticket); // one-shot even when validation fails
    if (pending.expiresAt <= now || pending.method !== method.toUpperCase() ||
        pending.path !== path || !getRequiredRemoteScope(method, path)) return null;
    const owner = userRepository.findById(pending.caller.owner.id);
    if (!owner || !owner.isActive || owner.username !== pending.caller.owner.username ||
        owner.role !== pending.caller.owner.role) return null;
    return pending.caller;
  }

  clear() {
    this.pending.clear();
  }
}

export const cloudLocalRequestAuthority = new CloudLocalRequestAuthority();

export const claimCloudRemoteUser = (request: FastifyRequest):
  AuthenticatedUser | null => {
  const value = request.headers[CLOUD_INTERNAL_REQUEST_HEADER];
  if (value === undefined) return null;
  const caller = cloudLocalRequestAuthority.consume(value, request.method, request.url);
  if (!caller) return null;
  request.cloudRemoteCaller = caller;
  return caller.owner;
};
