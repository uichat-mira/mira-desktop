import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  REMOTE_DEVICE_SCOPES,
  tailscaleRemoteAccessRepository,
  type PairingChallengeRecord,
  type PairingChallengeStatus,
  type RemotePairingTransport,
  type RemoteDeviceScope,
} from "@/db/repositories/tailscale-remote-access.repository.js";
import { decryptSecret, encryptSecret } from "@/utils/crypto.js";

const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 8;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const MAX_DEVICE_NAME_LENGTH = 80;
const MAX_PLATFORM_LENGTH = 40;
const MAX_PUBLIC_KEY_LENGTH = 4096;

export const DEFAULT_REMOTE_DEVICE_SCOPES: readonly RemoteDeviceScope[] = [
  "threads:read",
  "messages:read",
  "messages:write",
  "agent:read",
  "agent:approve",
  "agent:control",
  "artifacts:read",
];

export type PairingClaimSummary = {
  claimId: string;
  deviceName: string;
  platform: string;
  transport: RemotePairingTransport | null;
  publicKeyFingerprint: string | null;
  requestedScopes: RemoteDeviceScope[];
  claimedAt: string;
};

export type PairingChallengeView = {
  challengeId: string;
  status: PairingChallengeStatus;
  hostUrl: string;
  createdAt: string;
  expiresAt: string;
  claim: PairingClaimSummary | null;
  approvedScopes: RemoteDeviceScope[];
  deviceId: string | null;
};

export type CreatedPairingChallenge = PairingChallengeView & {
  code: string;
  pairingUri: string;
};

export type MobilePairingClaim = {
  claimId: string;
  pollToken: string;
  status: "claimed";
  expiresAt: string;
};

export type MobilePairingStatus = {
  status: PairingChallengeStatus;
  expiresAt: string;
  deviceId: string | null;
  scopes: RemoteDeviceScope[];
  credential?: string;
};

export type PairingServiceErrorCode =
  | "PAIRING_NOT_FOUND"
  | "PAIRING_EXPIRED"
  | "PAIRING_INVALID_CODE"
  | "PAIRING_ALREADY_CLAIMED"
  | "PAIRING_INVALID_POLL_TOKEN"
  | "PAIRING_NOT_CLAIMED"
  | "PAIRING_SCOPE_EMPTY";

export class PairingServiceError extends Error {
  constructor(
    public readonly code: PairingServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PairingServiceError";
  }
}

const hashOpaque = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const sameHash = (leftHex: string, rightHex: string) => {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
};

const normalizeText = (value: unknown, maxLength: number, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return normalized || fallback;
};

const normalizePublicKey = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_PUBLIC_KEY_LENGTH) : null;
};

const normalizeScopes = (value: unknown): RemoteDeviceScope[] => {
  const requested = Array.isArray(value) ? value : DEFAULT_REMOTE_DEVICE_SCOPES;
  return Array.from(
    new Set(
      requested.filter(
        (item): item is RemoteDeviceScope =>
          typeof item === "string" &&
          (REMOTE_DEVICE_SCOPES as readonly string[]).includes(item),
      ),
    ),
  );
};

const fingerprintPublicKey = (value: string | null) =>
  value ? createHash("sha256").update(value).digest("hex").slice(0, 16) : null;

const createCode = () =>
  Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)],
  ).join("");

const isExpired = (record: PairingChallengeRecord, now = Date.now()) =>
  new Date(record.expiresAt).getTime() <= now;

const ensureCurrent = (record: PairingChallengeRecord) => {
  if (isExpired(record) && record.status !== "delivered") {
    const expired = tailscaleRemoteAccessRepository.expirePairingChallenge(
      record.id,
    );
    throw new PairingServiceError(
      "PAIRING_EXPIRED",
      expired?.status === "expired"
        ? "Pairing challenge expired"
        : "Pairing challenge is no longer available",
    );
  }
  return record;
};

const toView = (record: PairingChallengeRecord): PairingChallengeView => ({
  challengeId: record.id,
  status: record.status,
  hostUrl: record.hostUrl,
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  claim:
    record.claimId && record.deviceName && record.platform && record.claimedAt
      ? {
          claimId: record.claimId,
          deviceName: record.deviceName,
          platform: record.platform,
          transport: record.claimTransport,
          publicKeyFingerprint: fingerprintPublicKey(record.publicKey),
          requestedScopes: record.requestedScopes,
          claimedAt: record.claimedAt,
        }
      : null,
  approvedScopes: record.approvedScopes,
  deviceId: record.deviceId,
});

const requireChallenge = (id: string) => {
  const challenge = tailscaleRemoteAccessRepository.getPairingChallengeById(id);
  if (!challenge) {
    throw new PairingServiceError(
      "PAIRING_NOT_FOUND",
      "Pairing challenge not found",
    );
  }
  return challenge;
};

const requireClaim = (claimId: string) => {
  const challenge =
    tailscaleRemoteAccessRepository.getPairingChallengeByClaimId(claimId);
  if (!challenge) {
    throw new PairingServiceError(
      "PAIRING_NOT_FOUND",
      "Pairing claim not found",
    );
  }
  return challenge;
};

export class RemoteAccessPairingService {
  createChallenge(input: {
    userId: number;
    hostUrl?: string | null;
    relay?: { endpoint: string; relayId: string; clientToken: string } | null;
  }): CreatedPairingChallenge {
    const now = new Date();
    const code = createCode();
    const hostUrl = input.hostUrl?.trim().replace(/\/+$/, "") ?? "";
    const challenge = tailscaleRemoteAccessRepository.createPairingChallenge({
      id: randomUUID(),
      userId: input.userId,
      codeHash: hashOpaque(code),
      hostUrl,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PAIRING_TTL_MS).toISOString(),
    });
    const query = new URLSearchParams({
      challenge: challenge.id,
      code,
      version: "1",
    });
    if (challenge.hostUrl) {
      query.set("host", challenge.hostUrl);
    }
    if (input.relay) {
      query.set("relay", input.relay.endpoint);
      query.set("relayId", input.relay.relayId);
      query.set("relayToken", input.relay.clientToken);
    }

    return {
      ...toView(challenge),
      code,
      pairingUri: `mira://pair?${query.toString()}`,
    };
  }

  getChallengeForUser(challengeId: string, userId: number) {
    const challenge = requireChallenge(challengeId);
    if (challenge.userId !== userId) {
      throw new PairingServiceError(
        "PAIRING_NOT_FOUND",
        "Pairing challenge not found",
      );
    }

    if (isExpired(challenge) && challenge.status !== "delivered") {
      return toView(
        tailscaleRemoteAccessRepository.expirePairingChallenge(challenge.id) ??
          challenge,
      );
    }
    return toView(challenge);
  }

  claim(input: {
    challengeId: string;
    code: string;
    deviceName?: string;
    platform?: string;
    transport?: RemotePairingTransport;
    publicKey?: string;
    requestedScopes?: string[];
  }): MobilePairingClaim {
    const challenge = ensureCurrent(requireChallenge(input.challengeId));
    if (challenge.status !== "pending") {
      throw new PairingServiceError(
        "PAIRING_ALREADY_CLAIMED",
        "Pairing challenge has already been claimed",
      );
    }

    tailscaleRemoteAccessRepository.incrementPairingAttempts(challenge.id);
    const nextAttempts = challenge.attempts + 1;
    const normalizedCode = input.code.trim().toUpperCase();
    if (!sameHash(challenge.codeHash, hashOpaque(normalizedCode))) {
      if (nextAttempts >= MAX_PAIRING_ATTEMPTS) {
        tailscaleRemoteAccessRepository.expirePairingChallenge(challenge.id);
      }
      throw new PairingServiceError(
        "PAIRING_INVALID_CODE",
        "Pairing code is invalid",
      );
    }

    const requestedScopes = normalizeScopes(input.requestedScopes);
    const claimId = randomUUID();
    const pollToken = randomBytes(32).toString("base64url");
    const claimed = tailscaleRemoteAccessRepository.claimPairingChallenge({
      id: challenge.id,
      claimId,
      claimTokenHash: hashOpaque(pollToken),
      deviceName: normalizeText(
        input.deviceName,
        MAX_DEVICE_NAME_LENGTH,
        "Mira Mobile",
      ),
      platform: normalizeText(
        input.platform,
        MAX_PLATFORM_LENGTH,
        "unknown",
      ),
      transport: input.transport ?? null,
      publicKey: normalizePublicKey(input.publicKey),
      requestedScopes,
      claimedAt: new Date().toISOString(),
    });

    if (!claimed) {
      throw new PairingServiceError(
        "PAIRING_ALREADY_CLAIMED",
        "Pairing challenge has already been claimed",
      );
    }

    return {
      claimId,
      pollToken,
      status: "claimed",
      expiresAt: claimed.expiresAt,
    };
  }

  poll(claimId: string, pollToken: string): MobilePairingStatus {
    const challenge = requireClaim(claimId);
    if (
      !challenge.claimTokenHash ||
      !sameHash(challenge.claimTokenHash, hashOpaque(pollToken))
    ) {
      throw new PairingServiceError(
        "PAIRING_INVALID_POLL_TOKEN",
        "Pairing poll token is invalid",
      );
    }

    if (isExpired(challenge) && challenge.status !== "delivered") {
      tailscaleRemoteAccessRepository.expirePairingChallenge(challenge.id);
      return {
        status: "expired",
        expiresAt: challenge.expiresAt,
        deviceId: challenge.deviceId,
        scopes: [],
      };
    }

    if (challenge.status === "approved" && challenge.credentialEncrypted) {
      const credential = decryptSecret(challenge.credentialEncrypted);
      const consumed = tailscaleRemoteAccessRepository.consumePairingCredential({
        claimId,
        deliveredAt: new Date().toISOString(),
      });
      if (consumed && credential) {
        return {
          status: "approved",
          expiresAt: challenge.expiresAt,
          deviceId: challenge.deviceId,
          scopes: challenge.approvedScopes,
          credential,
        };
      }
    }

    return {
      status: challenge.status,
      expiresAt: challenge.expiresAt,
      deviceId: challenge.deviceId,
      scopes: challenge.approvedScopes,
    };
  }

  approve(input: {
    claimId: string;
    userId: number;
    scopes?: string[];
  }): PairingChallengeView {
    const challenge = ensureCurrent(requireClaim(input.claimId));
    if (challenge.userId !== input.userId) {
      throw new PairingServiceError(
        "PAIRING_NOT_FOUND",
        "Pairing claim not found",
      );
    }
    if (challenge.status !== "claimed") {
      throw new PairingServiceError(
        "PAIRING_NOT_CLAIMED",
        "Pairing claim is not awaiting approval",
      );
    }

    const requestedSet = new Set(challenge.requestedScopes);
    const approvedScopes = normalizeScopes(input.scopes).filter((scope) =>
      requestedSet.has(scope),
    );
    if (approvedScopes.length === 0) {
      throw new PairingServiceError(
        "PAIRING_SCOPE_EMPTY",
        "At least one requested remote scope must be approved",
      );
    }

    const deviceId = randomUUID();
    const credential = `mira_device_${deviceId}.${randomBytes(32).toString("base64url")}`;
    const resolvedAt = new Date().toISOString();
    tailscaleRemoteAccessRepository.createDevice({
      id: deviceId,
      userId: input.userId,
      name: challenge.deviceName ?? "Mira Mobile",
      platform: challenge.platform ?? "unknown",
      publicKey: challenge.publicKey,
      permissions: approvedScopes,
      tokenHash: hashOpaque(credential),
      createdAt: resolvedAt,
    });

    const approved = tailscaleRemoteAccessRepository.approvePairingChallenge({
      claimId: input.claimId,
      userId: input.userId,
      approvedScopes,
      credentialEncrypted: encryptSecret(credential) ?? "",
      deviceId,
      resolvedAt,
    });

    if (!approved) {
      tailscaleRemoteAccessRepository.revokeDevice(deviceId, input.userId);
      throw new PairingServiceError(
        "PAIRING_NOT_CLAIMED",
        "Pairing claim is no longer awaiting approval",
      );
    }

    return toView(approved);
  }

  reject(input: { claimId: string; userId: number }): PairingChallengeView {
    const challenge = requireClaim(input.claimId);
    if (challenge.userId !== input.userId) {
      throw new PairingServiceError(
        "PAIRING_NOT_FOUND",
        "Pairing claim not found",
      );
    }
    const rejected = tailscaleRemoteAccessRepository.rejectPairingChallenge({
      claimId: input.claimId,
      userId: input.userId,
      resolvedAt: new Date().toISOString(),
    });
    if (!rejected) {
      throw new PairingServiceError(
        "PAIRING_NOT_CLAIMED",
        "Pairing claim is not awaiting approval",
      );
    }
    return toView(rejected);
  }
}

export const remoteAccessPairingService = new RemoteAccessPairingService();
