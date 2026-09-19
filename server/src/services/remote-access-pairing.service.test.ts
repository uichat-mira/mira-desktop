import { beforeEach, describe, expect, it, vi } from "vitest";

const scopes = vi.hoisted(
  () =>
    [
      "threads:read",
      "messages:read",
      "messages:write",
      "agent:read",
      "agent:approve",
      "agent:control",
      "tools:read",
      "tools:invoke",
      "tools:approve",
      "tools:control",
      "artifacts:read",
    ] as const,
);

type Challenge = {
  id: string;
  userId: number;
  status:
    | "pending"
    | "claimed"
    | "approved"
    | "rejected"
    | "delivered"
    | "expired";
  codeHash: string;
  hostUrl: string;
  createdAt: string;
  expiresAt: string;
  claimId: string | null;
  claimTokenHash: string | null;
  deviceName: string | null;
  platform: string | null;
  claimTransport: "relay" | "direct" | null;
  publicKey: string | null;
  requestedScopes: string[];
  approvedScopes: string[];
  credentialEncrypted: string | null;
  deviceId: string | null;
  attempts: number;
  claimedAt: string | null;
  resolvedAt: string | null;
  deliveredAt: string | null;
};

const state = vi.hoisted(() => ({
  challenges: new Map<string, Challenge>(),
  devices: [] as Array<Record<string, unknown>>,
}));

const repositoryMock = vi.hoisted(() => ({
  createPairingChallenge: vi.fn((input: Record<string, unknown>) => {
    const challenge: Challenge = {
      id: String(input.id),
      userId: Number(input.userId),
      status: "pending",
      codeHash: String(input.codeHash),
      hostUrl: String(input.hostUrl),
      createdAt: String(input.createdAt),
      expiresAt: String(input.expiresAt),
      claimId: null,
      claimTokenHash: null,
      deviceName: null,
      platform: null,
      claimTransport: null,
      publicKey: null,
      requestedScopes: [],
      approvedScopes: [],
      credentialEncrypted: null,
      deviceId: null,
      attempts: 0,
      claimedAt: null,
      resolvedAt: null,
      deliveredAt: null,
    };
    state.challenges.set(challenge.id, challenge);
    return challenge;
  }),
  getPairingChallengeById: vi.fn(
    (id: string) => state.challenges.get(id) ?? null,
  ),
  getPairingChallengeByClaimId: vi.fn(
    (claimId: string) =>
      Array.from(state.challenges.values()).find(
        (challenge) => challenge.claimId === claimId,
      ) ?? null,
  ),
  incrementPairingAttempts: vi.fn((id: string) => {
    const challenge = state.challenges.get(id);
    if (challenge) challenge.attempts += 1;
  }),
  claimPairingChallenge: vi.fn((input: Record<string, unknown>) => {
    const challenge = state.challenges.get(String(input.id));
    if (!challenge || challenge.status !== "pending") return null;
    challenge.status = "claimed";
    challenge.claimId = String(input.claimId);
    challenge.claimTokenHash = String(input.claimTokenHash);
    challenge.deviceName = String(input.deviceName);
    challenge.platform = String(input.platform);
    challenge.claimTransport =
      input.transport === "relay" || input.transport === "direct"
        ? input.transport
        : null;
    challenge.publicKey = input.publicKey ? String(input.publicKey) : null;
    challenge.requestedScopes = [...(input.requestedScopes as string[])];
    challenge.claimedAt = String(input.claimedAt);
    return challenge;
  }),
  createDevice: vi.fn((input: Record<string, unknown>) => {
    state.devices.push(input);
    return input;
  }),
  approvePairingChallenge: vi.fn((input: Record<string, unknown>) => {
    const challenge = Array.from(state.challenges.values()).find(
      (item) => item.claimId === input.claimId && item.userId === input.userId,
    );
    if (!challenge || challenge.status !== "claimed") return null;
    challenge.status = "approved";
    challenge.approvedScopes = [...(input.approvedScopes as string[])];
    challenge.credentialEncrypted = String(input.credentialEncrypted);
    challenge.deviceId = String(input.deviceId);
    challenge.resolvedAt = String(input.resolvedAt);
    return challenge;
  }),
  rejectPairingChallenge: vi.fn((input: Record<string, unknown>) => {
    const challenge = Array.from(state.challenges.values()).find(
      (item) => item.claimId === input.claimId && item.userId === input.userId,
    );
    if (!challenge || challenge.status !== "claimed") return null;
    challenge.status = "rejected";
    challenge.resolvedAt = String(input.resolvedAt);
    return challenge;
  }),
  consumePairingCredential: vi.fn((input: Record<string, unknown>) => {
    const challenge = Array.from(state.challenges.values()).find(
      (item) => item.claimId === input.claimId,
    );
    if (
      !challenge ||
      challenge.status !== "approved" ||
      !challenge.credentialEncrypted
    ) {
      return null;
    }
    const delivered = { ...challenge };
    challenge.status = "delivered";
    challenge.credentialEncrypted = null;
    challenge.deliveredAt = String(input.deliveredAt);
    return delivered;
  }),
  expirePairingChallenge: vi.fn((id: string) => {
    const challenge = state.challenges.get(id);
    if (!challenge) return null;
    challenge.status = "expired";
    challenge.credentialEncrypted = null;
    return challenge;
  }),
  revokeDevice: vi.fn(() => true),
}));

vi.mock(
  "@/db/repositories/tailscale-remote-access.repository.js",
  () => ({
    REMOTE_DEVICE_SCOPES: scopes,
    tailscaleRemoteAccessRepository: repositoryMock,
  }),
);

import {
  PairingServiceError,
  RemoteAccessPairingService,
} from "./remote-access-pairing.service.js";

beforeEach(() => {
  state.challenges.clear();
  state.devices.length = 0;
  for (const mock of Object.values(repositoryMock)) {
    mock.mockClear();
  }
});

describe("RemoteAccessPairingService", () => {
  it("requires the one-time code and records failed attempts", () => {
    const service = new RemoteAccessPairingService();
    const challenge = service.createChallenge({
      userId: 7,
      hostUrl: "https://mira.example.ts.net",
    });

    expect(() =>
      service.claim({
        challengeId: challenge.challengeId,
        code: "BADCODE1",
        deviceName: "K70",
        platform: "android",
      }),
    ).toThrowError(PairingServiceError);
    expect(repositoryMock.incrementPairingAttempts).toHaveBeenCalledWith(
      challenge.challengeId,
    );
    expect(state.challenges.get(challenge.challengeId)?.status).toBe("pending");
  });

  it("delivers a scoped credential once after explicit desktop approval", () => {
    const service = new RemoteAccessPairingService();
    const challenge = service.createChallenge({
      userId: 7,
      hostUrl: "https://mira.example.ts.net/",
    });
    const claim = service.claim({
      challengeId: challenge.challengeId,
      code: challenge.code,
      deviceName: "K70",
      platform: "android",
      transport: "relay",
      publicKey: "mobile-public-key",
      requestedScopes: ["threads:read", "messages:read"],
    });

    expect(service.poll(claim.claimId, claim.pollToken)).toMatchObject({
      status: "claimed",
      scopes: [],
    });
    expect(service.getChallengeForUser(challenge.challengeId, 7).claim).toMatchObject({
      transport: "relay",
    });

    const approved = service.approve({
      claimId: claim.claimId,
      userId: 7,
      scopes: ["threads:read", "agent:control"],
    });
    expect(approved.status).toBe("approved");
    expect(approved.approvedScopes).toEqual(["threads:read"]);
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0]?.permissions).toEqual(["threads:read"]);
    expect(String(state.devices[0]?.tokenHash)).not.toContain("mira_device_");

    const delivered = service.poll(claim.claimId, claim.pollToken);
    expect(delivered.status).toBe("approved");
    expect(delivered.scopes).toEqual(["threads:read"]);
    expect(delivered.credential).toMatch(
      /^mira_device_[^.]+\.[A-Za-z0-9_-]+$/u,
    );

    const repeated = service.poll(claim.claimId, claim.pollToken);
    expect(repeated.status).toBe("delivered");
    expect(repeated).not.toHaveProperty("credential");
    expect(
      state.challenges.get(challenge.challengeId)?.credentialEncrypted,
    ).toBeNull();
  });

  it("filters unknown future scopes before persistence and approval", () => {
    const service = new RemoteAccessPairingService();
    const challenge = service.createChallenge({
      userId: 7,
      hostUrl: "https://mira.example.ts.net",
    });
    const claim = service.claim({
      challengeId: challenge.challengeId,
      code: challenge.code,
      requestedScopes: [
        "threads:read",
        "tools:read",
        "future:capability",
      ],
    });

    const view = service.getChallengeForUser(challenge.challengeId, 7);
    expect(view.claim?.requestedScopes).toEqual([
      "threads:read",
      "tools:read",
    ]);

    const approved = service.approve({
      claimId: claim.claimId,
      userId: 7,
      scopes: ["threads:read", "future:capability"],
    });

    expect(approved.approvedScopes).toEqual(["threads:read"]);
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0]?.permissions).toEqual(["threads:read"]);
  });

  it("does not return a credential when another poll wins atomic delivery", () => {
    const service = new RemoteAccessPairingService();
    const challenge = service.createChallenge({
      userId: 7,
      hostUrl: "https://mira.example.ts.net",
    });
    const claim = service.claim({
      challengeId: challenge.challengeId,
      code: challenge.code,
      requestedScopes: ["threads:read"],
    });
    service.approve({
      claimId: claim.claimId,
      userId: 7,
      scopes: ["threads:read"],
    });
    repositoryMock.consumePairingCredential.mockReturnValueOnce(null);

    const result = service.poll(claim.claimId, claim.pollToken);

    expect(result).not.toHaveProperty("credential");
  });

  it("does not let a different desktop user approve the claim", () => {
    const service = new RemoteAccessPairingService();
    const challenge = service.createChallenge({
      userId: 7,
      hostUrl: "https://mira.example.ts.net",
    });
    const claim = service.claim({
      challengeId: challenge.challengeId,
      code: challenge.code,
      requestedScopes: ["threads:read"],
    });

    expect(() =>
      service.approve({
        claimId: claim.claimId,
        userId: 8,
        scopes: ["threads:read"],
      }),
    ).toThrowError(PairingServiceError);
    expect(state.devices).toHaveLength(0);
  });

  it("does not silently grant tool scopes to legacy claims without requestedScopes", () => {
    const service = new RemoteAccessPairingService();
    const challenge = service.createChallenge({
      userId: 7,
      hostUrl: "https://mira.example.ts.net",
    });

    service.claim({
      challengeId: challenge.challengeId,
      code: challenge.code,
    });

    const requested =
      service.getChallengeForUser(challenge.challengeId, 7).claim
        ?.requestedScopes ?? [];
    expect(requested).toEqual([
      "threads:read",
      "messages:read",
      "messages:write",
      "agent:read",
      "agent:approve",
      "agent:control",
      "artifacts:read",
    ]);
    expect(requested.some((scope) => scope.startsWith("tools:"))).toBe(false);
  });

  it("keeps old Mobile claims compatible when transport is omitted", () => {
    const service = new RemoteAccessPairingService();
    const challenge = service.createChallenge({
      userId: 7,
      hostUrl: "https://mira.example.ts.net",
    });

    service.claim({
      challengeId: challenge.challengeId,
      code: challenge.code,
      requestedScopes: ["threads:read"],
    });

    expect(service.getChallengeForUser(challenge.challengeId, 7).claim).toMatchObject({
      transport: null,
    });
  });
});
