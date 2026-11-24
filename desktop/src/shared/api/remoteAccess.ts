import { get, post } from "@/shared/lib/request";

export type RemoteDeviceScope =
  | "threads:read"
  | "messages:read"
  | "messages:write"
  | "agent:read"
  | "agent:approve"
  | "agent:control"
  | "tools:read"
  | "tools:invoke"
  | "tools:approve"
  | "tools:control"
  | "artifacts:read";

export type PairingChallengeStatus =
  | "pending"
  | "claimed"
  | "approved"
  | "rejected"
  | "delivered"
  | "expired";

// DSK-017 retires legacy Relay pairing; new claims can only be Tailscale Direct.
export type RemotePairingTransport = "direct";

export interface PairingClaimSummary {
  claimId: string;
  deviceName: string;
  platform: string;
  transport: RemotePairingTransport | null;
  publicKeyFingerprint: string | null;
  requestedScopes: RemoteDeviceScope[];
  claimedAt: string;
}

export interface PairingChallengeView {
  challengeId: string;
  status: PairingChallengeStatus;
  hostUrl: string;
  createdAt: string;
  expiresAt: string;
  claim: PairingClaimSummary | null;
  approvedScopes: RemoteDeviceScope[];
  deviceId: string | null;
}

export interface CreatedPairingChallenge extends PairingChallengeView {
  code: string;
  pairingUri: string;
}

export function createRemotePairingChallenge() {
  return post<CreatedPairingChallenge>("/remote/admin/pairing/challenges");
}

export function getRemotePairingChallenge(challengeId: string) {
  return get<PairingChallengeView>(
    `/remote/admin/pairing/challenges/${encodeURIComponent(challengeId)}`,
  );
}

export function approveRemotePairingClaim(
  claimId: string,
  scopes: RemoteDeviceScope[],
) {
  return post<PairingChallengeView>(
    `/remote/admin/pairing/claims/${encodeURIComponent(claimId)}/approve`,
    { scopes },
  );
}

export function rejectRemotePairingClaim(claimId: string) {
  return post<PairingChallengeView>(
    `/remote/admin/pairing/claims/${encodeURIComponent(claimId)}/reject`,
  );
}
