import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { userRepository } from "@/db/index.js";
import {
  tailscaleRemoteAccessRepository,
  type RemoteDeviceRecord,
  type RemoteDeviceScope,
} from "@/db/repositories/tailscale-remote-access.repository.js";
import type { AuthenticatedUser } from "@/db/auth.db.js";

export type AuthenticatedRemoteDevice = {
  device: RemoteDeviceRecord;
  user: AuthenticatedUser;
};

declare module "fastify" {
  interface FastifyRequest {
    remoteDevice?: RemoteDeviceRecord;
  }
}

const DEVICE_TOKEN_PREFIX = "mira_device_";

const hashOpaque = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const sameHash = (leftHex: string, rightHex: string) => {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
};

const parseDeviceId = (token: string) => {
  if (!token.startsWith(DEVICE_TOKEN_PREFIX)) {
    return null;
  }
  const separator = token.indexOf(".", DEVICE_TOKEN_PREFIX.length);
  if (separator <= DEVICE_TOKEN_PREFIX.length || separator === token.length - 1) {
    return null;
  }
  return token.slice(DEVICE_TOKEN_PREFIX.length, separator);
};

export const verifyRemoteDeviceToken = (
  token: string,
): AuthenticatedRemoteDevice | null => {
  const deviceId = parseDeviceId(token);
  if (!deviceId) {
    return null;
  }

  const device = tailscaleRemoteAccessRepository.getActiveDeviceById(deviceId);
  if (!device || !sameHash(device.tokenHash, hashOpaque(token))) {
    return null;
  }

  const user = userRepository.findById(device.userId);
  if (!user || !user.isActive) {
    return null;
  }

  tailscaleRemoteAccessRepository.touchDevice(device.id);
  return {
    device,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  };
};

export const getRemoteDeviceFromRequest = (
  request: FastifyRequest,
): AuthenticatedRemoteDevice | null => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return verifyRemoteDeviceToken(authHeader.slice(7));
};

const splitPath = (url: string) =>
  (url.split("?")[0] || "/").split("/").filter(Boolean);

export const getRequiredRemoteScope = (
  method: string,
  url: string,
): RemoteDeviceScope | "authenticated" | null => {
  const normalizedMethod = method.toUpperCase();
  const parts = splitPath(url);

  if (
    normalizedMethod === "GET" &&
    parts.length === 3 &&
    parts[0] === "remote" &&
    parts[1] === "v1" &&
    parts[2] === "manifest"
  ) {
    return "authenticated";
  }

  if (
    normalizedMethod === "GET" &&
    parts.length === 3 &&
    parts[0] === "remote" &&
    parts[1] === "v1" &&
    parts[2] === "workspaces"
  ) {
    return "threads:read";
  }

  if (
    normalizedMethod === "GET" &&
    parts.length === 3 &&
    parts[0] === "remote" &&
    parts[1] === "v1" &&
    parts[2] === "roles"
  ) {
    return "threads:read";
  }

  if (
    normalizedMethod === "GET" &&
    parts.length === 5 &&
    parts[0] === "remote" &&
    parts[1] === "v1" &&
    parts[2] === "workspaces" &&
    parts[4] === "threads"
  ) {
    return "threads:read";
  }

  if (normalizedMethod === "GET" && parts.length === 1 && parts[0] === "threads") {
    return "threads:read";
  }

  if (
    normalizedMethod === "GET" &&
    parts.length === 2 &&
    parts[0] === "threads"
  ) {
    return "threads:read";
  }

  if (
    normalizedMethod === "POST" &&
    parts.length === 1 &&
    parts[0] === "threads"
  ) {
    // Compatibility decision for already-paired 0.2.x devices: messages:write
    // is the existing conversation-mutation grant used by chat send and single
    // thread deletion. Thread creation joins that same grant so users do not
    // have to re-pair solely to activate a newly advertised canonical route.
    return "messages:write";
  }

  if (
    normalizedMethod === "DELETE" &&
    parts.length === 2 &&
    parts[0] === "threads" &&
    parts[1] !== "history"
  ) {
    // Existing 0.2.x paired devices already carry messages:write. Treat
    // deleting one owned conversation as a conversation-write mutation. The
    // reserved /threads/history bulk-cleanup route is intentionally denied.
    return "messages:write";
  }

  if (
    normalizedMethod === "GET" &&
    parts.length === 3 &&
    parts[0] === "threads" &&
    parts[2] === "messages"
  ) {
    return "messages:read";
  }

  if (
    normalizedMethod === "POST" &&
    parts.length === 3 &&
    parts[0] === "proxy" &&
    parts[1] === "chat" &&
    parts[2] === "default"
  ) {
    return "messages:write";
  }

  if (
    normalizedMethod === "GET" &&
    parts.length === 3 &&
    parts[0] === "agent" &&
    parts[1] === "runs"
  ) {
    return "agent:read";
  }

  if (
    normalizedMethod === "POST" &&
    parts.length === 4 &&
    parts[0] === "agent" &&
    parts[1] === "runs" &&
    (parts[3] === "approve" || parts[3] === "reject")
  ) {
    return "agent:approve";
  }

  if (
    normalizedMethod === "POST" &&
    parts.length === 4 &&
    parts[0] === "agent" &&
    parts[1] === "runs" &&
    parts[3] === "cancel"
  ) {
    return "agent:control";
  }

  if (
    normalizedMethod === "GET" &&
    parts.length === 3 &&
    parts[0] === "remote" &&
    parts[1] === "v1" &&
    parts[2] === "tools"
  ) {
    return "tools:read";
  }

  if (
    normalizedMethod === "POST" &&
    parts.length === 4 &&
    parts[0] === "remote" &&
    parts[1] === "v1" &&
    parts[2] === "tool-invocations" &&
    parts[3] === "stream"
  ) {
    return "tools:invoke";
  }

  if (
    normalizedMethod === "POST" &&
    parts.length === 5 &&
    parts[0] === "remote" &&
    parts[1] === "v1" &&
    parts[2] === "tool-invocations" &&
    parts[4] === "approval"
  ) {
    return "tools:approve";
  }

  if (
    normalizedMethod === "POST" &&
    parts.length === 5 &&
    parts[0] === "remote" &&
    parts[1] === "v1" &&
    parts[2] === "tool-invocations" &&
    parts[4] === "cancel"
  ) {
    return "tools:control";
  }

  if (
    normalizedMethod === "GET" &&
    parts.length === 5 &&
    parts[0] === "threads" &&
    parts[2] === "media" &&
    parts[4] === "content"
  ) {
    return "artifacts:read";
  }

  return null;
};

export const remoteDeviceHasScope = (
  device: RemoteDeviceRecord,
  scope: RemoteDeviceScope | "authenticated",
) =>
  scope === "authenticated" || device.permissions.includes(scope);
