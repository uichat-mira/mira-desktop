import { get, post, put } from "@/shared/lib/request";

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

export type RemoteRelayConnectorState =
  | "disabled"
  | "misconfigured"
  | "connecting"
  | "connected"
  | "disconnected"
  | "stopped";

export type RemoteRelayEndpointMode = "default" | "custom";
export type RemotePairingTransport = "relay" | "direct";

export interface RemoteRelayUserConfig {
  enabled: boolean;
  endpointMode: RemoteRelayEndpointMode;
  customUrl: string;
  effectiveUrl: string | null;
  defaultAvailable: boolean;
  updatedAt: string | null;
}

export interface RemoteRelayConnectorSnapshot {
  enabled: boolean;
  state: RemoteRelayConnectorState;
  relayUrl: string | null;
  relayId: string | null;
  connectedAt: string | null;
  lastError: string | null;
  activeRequests: number;
  reconnectAttempt: number;
}

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

export function getRemoteRelayConfig() {
  return get<RemoteRelayUserConfig>("/remote/admin/relay/config");
}

export function updateRemoteRelayConfig(input: {
  enabled?: boolean;
  endpointMode?: RemoteRelayEndpointMode;
  customUrl?: string;
}) {
  return put<RemoteRelayUserConfig>("/remote/admin/relay/config", input);
}

export function getRemoteRelayStatus() {
  return get<RemoteRelayConnectorSnapshot>("/remote/admin/relay/status");
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
