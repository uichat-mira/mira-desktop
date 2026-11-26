import assert from "node:assert/strict";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { badRequest, sendRouteError } from "@/utils/route-errors.js";

const mocks = vi.hoisted(() => {
  class HostNotificationBindingError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "HostNotificationBindingError";
    }
  }

  class HostNotificationConfigError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "HostNotificationConfigError";
    }
  }

  class PairingServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "PairingServiceError";
    }
  }

  class RemoteThreadWorkspaceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode = 409,
    ) {
      super(message);
      this.name = "RemoteThreadWorkspaceError";
    }
  }

  return {
    HostNotificationBindingError,
    HostNotificationConfigError,
    PairingServiceError,
    RemoteThreadWorkspaceError,
    pairing: {
      createChallenge: vi.fn(),
      getChallengeForUser: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      claim: vi.fn(),
      poll: vi.fn(),
    },
    tailscale: {
      getSnapshot: vi.fn(),
    },
    thread: {
      listChatWorkspaces: vi.fn(),
    },
    threadRepo: {
      findById: vi.fn(),
    },
    push: {
      createBindingDescriptor: vi.fn(),
      acceptApprovedBinding: vi.fn(),
    },
    pushConfig: {
      getBrokerBaseUrl: vi.fn(),
    },
    workspaces: {
      list: vi.fn(),
    },
    toolGateway: {
      list: vi.fn(),
      assertAvailable: vi.fn(),
      execute: vi.fn(),
      approve: vi.fn(),
      cancel: vi.fn(),
      cancelThread: vi.fn(),
    },
    threadWorkspace: {
      getState: vi.fn(),
      end: vi.fn(),
      readContext: vi.fn(() => null),
      identity: vi.fn(() => ({
        accountId: "account-a",
        hostId: "host-a",
        mobileDeviceId: "phone-a",
      })),
    },
    terminalSessions: {
      stopForThread: vi.fn(),
    },
  };
});

vi.mock("@/services/remote-access-pairing.service.js", () => ({
  PairingServiceError: mocks.PairingServiceError,
  remoteAccessPairingService: mocks.pairing,
}));

vi.mock("@/services/tailscale-remote-access.service.js", () => ({
  tailscaleRemoteAccessService: mocks.tailscale,
}));

vi.mock("@/services/thread.service.js", () => ({
  threadService: mocks.thread,
}));

vi.mock("@/services/host-notification-identity.service.js", () => ({
  HostNotificationBindingError: mocks.HostNotificationBindingError,
  hostNotificationIdentityService: mocks.push,
}));

vi.mock("@/services/host-notification-config.js", () => ({
  HostNotificationConfigError: mocks.HostNotificationConfigError,
  getConfiguredPushBrokerBaseUrl: mocks.pushConfig.getBrokerBaseUrl,
}));

vi.mock("@/db/repositories/chat-workspace.repository.js", () => ({
  chatWorkspaceRepository: mocks.workspaces,
}));

vi.mock("@/db/repositories/thread.repository.js", () => ({
  threadRepository: mocks.threadRepo,
}));

vi.mock("@/db/repositories/tailscale-remote-access.repository.js", () => ({
  REMOTE_DEVICE_SCOPES: [
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
  ],
  REMOTE_PAIRING_TRANSPORTS: ["direct"],
}));

vi.mock("@/services/remote-tool-gateway.service.js", () => ({
  assertRemoteToolAvailable: mocks.toolGateway.assertAvailable,
  listRemoteToolManifests: mocks.toolGateway.list,
  executeRemoteToolInvocation: mocks.toolGateway.execute,
  resolveRemoteToolApproval: mocks.toolGateway.approve,
  cancelRemoteToolInvocation: mocks.toolGateway.cancel,
  cancelRemoteToolInvocationsForThread: mocks.toolGateway.cancelThread,
  waitForRemoteThreadInvocations: async () => {},
}));

vi.mock("@/services/remote-thread-workspace.service.js", () => ({
  RemoteThreadWorkspaceError: mocks.RemoteThreadWorkspaceError,
  readCloudRemoteThreadContext: mocks.threadWorkspace.readContext,
  resolveCloudRemoteIdentity: mocks.threadWorkspace.identity,
  remoteThreadExecutionKey: () => "remote-mcp-scoped-thread-1",
  remoteThreadWorkspaceService: {
    getState: mocks.threadWorkspace.getState,
    end: mocks.threadWorkspace.end,
  },
}));

vi.mock("@/mcp/terminal-sessions.js", () => ({
  stopTerminalSessionsForThread: mocks.terminalSessions.stopForThread,
}));

import remoteAccessRoute, { reconcileCloudRelayOnGrantInvalidation } from "./remote-access.js";
import { cloudRemoteAccessMode } from "@/services/cloud-remote-access-mode.service.js";

describe("DSK-006 Cloud Host eligibility after Grant invalidation", () => {
  it("stops instead of restarting after native sign-out", () => {
    const connector = { restart: vi.fn(), stop: vi.fn() };
    reconcileCloudRelayOnGrantInvalidation(false, connector);
    expect(connector.stop).toHaveBeenCalledOnce();
    expect(connector.restart).not.toHaveBeenCalled();
  });

  it("reacquires a ticket only for an eligible native Host", () => {
    const connector = { restart: vi.fn(), stop: vi.fn() };
    reconcileCloudRelayOnGrantInvalidation(true, connector);
    expect(connector.restart).toHaveBeenCalledOnce();
    expect(connector.stop).not.toHaveBeenCalled();
  });
});

const user = { id: 7, username: "tester", role: "user" as const };
const readySnapshot = {
  runtime: {
    state: "ready",
    accessUrl: "https://mira.example.ts.net",
  },
};

const createApp = async (options: {
  authenticated?: boolean; device?: unknown; cloud?: boolean;
} = {}) => {
  const app = Fastify();
  app.setErrorHandler(sendRouteError);
  await app.register(fastifyWebsocket);
  await app.addHook("preHandler", async (request) => {
    if (options.authenticated) {
      request.authUser = user;
    }
    if (options.device) {
      request.remoteDevice = options.device as never;
    }
    if (options.cloud) {
      request.authUser = user;
      request.cloudRemoteCaller = {
        kind: "cloud", accountId: "account-a", hostId: "host-a",
        mobileDeviceId: "phone-a", revision: 3,
        scopes: ["threads:read", "tools:read", "tools:invoke", "tools:control"],
        owner: user,
      };
    }
  });
  await app.register(remoteAccessRoute);
  // DSK-018 fixture: the native lifecycle is signed-out unless a test switches
  // it to a Cloud-owned mode.
  cloudRemoteAccessMode.applyNativeSessionState("signed_out");
  return app;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tailscale.getSnapshot.mockResolvedValue(readySnapshot);
  mocks.pairing.createChallenge.mockReturnValue({
    challengeId: "challenge-1",
    status: "pending",
    hostUrl: "https://mira.example.ts.net",
    code: "ABCD2345",
  });
  mocks.pairing.getChallengeForUser.mockReturnValue({
    challengeId: "challenge-1",
    status: "claimed",
  });
  mocks.pairing.approve.mockReturnValue({
    challengeId: "challenge-1",
    status: "approved",
    approvedScopes: ["threads:read"],
  });
  mocks.pairing.reject.mockReturnValue({
    challengeId: "challenge-1",
    status: "rejected",
  });
  mocks.pairing.claim.mockReturnValue({
    claimId: "claim-1",
    pollToken: "poll-token-123456789012345",
    status: "claimed",
  });
  mocks.pairing.poll.mockReturnValue({
    status: "approved",
    deviceId: "device-1",
    scopes: ["threads:read"],
    credential: "mira_device_credential",
  });
  mocks.toolGateway.assertAvailable.mockResolvedValue(undefined);
  mocks.toolGateway.list.mockResolvedValue([
    {
      id: "web_search",
      name: "web_search",
      description: "Search the public web",
      parameters: { type: "object" },
      destructive: false,
      requiresApproval: false,
    },
  ]);
  mocks.toolGateway.execute.mockImplementation(async (input: {
    toolId: string;
    onEvent?: (event: unknown) => void | Promise<void>;
  }) => {
    await input.onEvent?.({
      type: "tool:start",
      invocationId: "inv-1",
      toolId: input.toolId,
    });
    return {
      invocationId: "inv-1",
      toolId: input.toolId,
      status: "completed",
      content: "result",
    };
  });
  mocks.toolGateway.approve.mockResolvedValue({
    invocationId: "inv-2",
    toolId: "terminal",
    status: "completed",
    content: "approved result",
  });
  mocks.toolGateway.cancel.mockReturnValue({
    invocationId: "inv-1",
    accepted: true,
    status: "cancelling",
  });
  mocks.toolGateway.cancelThread.mockReturnValue(0);
  mocks.threadWorkspace.getState.mockReturnValue({
    threadId: "thread-1",
    status: "not_started",
    workspace: null,
    startedAt: null,
    endedAt: null,
  });
  mocks.threadWorkspace.end.mockReturnValue({
    threadId: "thread-1",
    status: "ended",
    workspace: {
      ref: "mira-thread-workspace:thread-1",
      kind: "private",
      available: true,
      startedAt: "2026-11-25T00:00:00.000Z",
    },
    startedAt: "2026-11-25T00:00:00.000Z",
    endedAt: "2026-11-25T00:00:10.000Z",
  });
  mocks.terminalSessions.stopForThread.mockResolvedValue({
    requested: 1,
    stopped: 1,
  });
  mocks.threadRepo.findById.mockImplementation(
    (threadId: string, userId: number) =>
      threadId === "thread-1" && userId === user.id
        ? { id: threadId, userId, status: "active" }
        : undefined,
  );
  mocks.pushConfig.getBrokerBaseUrl.mockReturnValue(
    "https://push.example.test",
  );
  mocks.push.createBindingDescriptor.mockReturnValue({
    schemaVersion: 1,
    hostId: "host-1",
    hostPublicKey: "host-public-key",
    installationId: "installation-1",
    sourceScope: ["thread-1"],
    bindingNonce: "binding-nonce",
    bindingExpiresAt: "2026-10-06T06:00:00.000Z",
    hostSignature: "host-signature",
  });
  mocks.push.acceptApprovedBinding.mockReturnValue({
    installationId: "installation-1",
    originRemoteDeviceId: "device-1",
    ownerUserId: user.id,
    brokerBaseUrl: "https://push.example.test",
    deliveryToken: "delivery-secret",
    sourceScope: ["thread-1"],
    status: "active",
    createdAt: "2026-10-06T05:00:00.000Z",
    updatedAt: "2026-10-06T05:00:00.000Z",
  });
    mocks.thread.listChatWorkspaces.mockReturnValue([
    {
      id: "workspace-active",
      name: "Mira BASE",
      rootPath: "/Users/tester/mira",
      isDefault: true,
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
  ]);
  mocks.workspaces.list.mockReturnValue([
    {
      id: "workspace-archived",
      userId: user.id,
      name: "Old project",
      rootPath: "/Users/tester/old-project",
      status: "archived",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    },
  ]);
});

describe("remote access routes", () => {
  it("requires desktop authentication before creating a challenge", async () => {
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/remote/admin/pairing/challenges",
    });

    assert.equal(response.statusCode, 403, response.body);
    expect(mocks.tailscale.getSnapshot).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects challenge creation when Tailscale remote access is not ready", async () => {
    mocks.tailscale.getSnapshot.mockResolvedValueOnce({
      runtime: { state: "connected", accessUrl: null },
    });
    const app = await createApp({ authenticated: true });

    const response = await app.inject({
      method: "POST",
      url: "/remote/admin/pairing/challenges",
    });

    assert.equal(response.statusCode, 400, response.body);
    expect(mocks.pairing.createChallenge).not.toHaveBeenCalled();
    await app.close();
  });

  it("creates an admin challenge from the ready Tailscale access URL", async () => {
    const app = await createApp({ authenticated: true });

    const response = await app.inject({
      method: "POST",
      url: "/remote/admin/pairing/challenges",
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(mocks.tailscale.getSnapshot).toHaveBeenCalledWith({ verifyHealth: true });
    expect(mocks.pairing.createChallenge).toHaveBeenCalledWith({
      userId: user.id,
      hostUrl: "https://mira.example.ts.net",
    });
    assert.equal(response.json().data.challengeId, "challenge-1");
    await app.close();
  });

  it("refuses to create a challenge unless Tailscale Direct is ready", async () => {
    mocks.tailscale.getSnapshot.mockResolvedValueOnce({
      runtime: {
        state: "serve_not_configured",
        accessUrl: "https://mira.example.ts.net",
      },
    });
    const app = await createApp({ authenticated: true });

    const response = await app.inject({
      method: "POST",
      url: "/remote/admin/pairing/challenges",
    });

    assert.equal(response.statusCode, 400, response.body);
    expect(response.json().message).toContain("Tailscale Direct");
    expect(mocks.pairing.createChallenge).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not register the retired legacy Relay config or status routes", async () => {
    const app = await createApp({ authenticated: true });

    for (const url of [
      "/remote/admin/relay/config",
      "/remote/admin/relay/status",
    ]) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 404, `${url}: ${response.body}`);
    }

    const update = await app.inject({
      method: "PUT",
      url: "/remote/admin/relay/config",
      payload: { enabled: true },
    });
    assert.equal(update.statusCode, 404, update.body);
    await app.close();
  });

  it("reports only sanitized official Cloud transport status", async () => {
    const app = await createApp({ authenticated: true });

    const response = await app.inject({
      method: "GET",
      url: "/remote/admin/cloud-relay/status",
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(response.json().data).not.toHaveProperty("relayId");
    expect(response.json().data).toMatchObject({ state: "disabled" });
    await app.close();
  });

  it("rejects a legacy Relay claim transport instead of admitting it", async () => {
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/remote/pairing/claim",
      payload: {
        challengeId: "challenge-1",
        code: "ABCD2345",
        transport: "relay",
      },
    });

    assert.equal(response.statusCode, 400, response.body);
    expect(mocks.pairing.claim).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards desktop approval and rejection with the authenticated user", async () => {
    const app = await createApp({ authenticated: true });

    const approveResponse = await app.inject({
      method: "POST",
      url: "/remote/admin/pairing/claims/claim-1/approve",
      payload: { scopes: ["threads:read", "messages:read"] },
    });
    const rejectResponse = await app.inject({
      method: "POST",
      url: "/remote/admin/pairing/claims/claim-1/reject",
    });

    assert.equal(approveResponse.statusCode, 200, approveResponse.body);
    assert.equal(rejectResponse.statusCode, 200, rejectResponse.body);
    expect(mocks.pairing.approve).toHaveBeenCalledWith({
      claimId: "claim-1",
      userId: user.id,
      scopes: ["threads:read", "messages:read"],
    });
    expect(mocks.pairing.reject).toHaveBeenCalledWith({
      claimId: "claim-1",
      userId: user.id,
    });
    await app.close();
  });

  it("forwards mobile claim and poll requests without desktop authentication", async () => {
    const app = await createApp();

    const claimResponse = await app.inject({
      method: "POST",
      url: "/remote/pairing/claim",
      payload: {
        challengeId: "challenge-1",
        code: "ABCD2345",
        deviceName: "K70",
        platform: "android",
        transport: "direct",
        requestedScopes: ["threads:read"],
      },
    });
    const pollResponse = await app.inject({
      method: "POST",
      url: "/remote/pairing/claims/claim-1/poll",
      payload: { pollToken: "poll-token-123456789012345" },
    });

    assert.equal(claimResponse.statusCode, 200, claimResponse.body);
    assert.equal(pollResponse.statusCode, 200, pollResponse.body);
    expect(mocks.pairing.claim).toHaveBeenCalledWith({
      challengeId: "challenge-1",
      code: "ABCD2345",
      deviceName: "K70",
      platform: "android",
      transport: "direct",
      requestedScopes: ["threads:read"],
    });
    expect(mocks.pairing.poll).toHaveBeenCalledWith(
      "claim-1",
      "poll-token-123456789012345",
    );
    await app.close();
  });

  it("accepts future mobile scopes for service-side negotiation", async () => {
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/remote/pairing/claim",
      payload: {
        challengeId: "challenge-1",
        code: "ABCD2345",
        deviceName: "K70",
        platform: "android",
        transport: "direct",
        requestedScopes: ["threads:read", "future:capability"],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(mocks.pairing.claim).toHaveBeenCalledWith({
      challengeId: "challenge-1",
      code: "ABCD2345",
      deviceName: "K70",
      platform: "android",
      transport: "direct",
      requestedScopes: ["threads:read", "future:capability"],
    });
    await app.close();
  });

  it("maps pairing-not-found errors to 404", async () => {
    mocks.pairing.getChallengeForUser.mockImplementationOnce(() => {
      throw new mocks.PairingServiceError(
        "PAIRING_NOT_FOUND",
        "Pairing challenge not found",
      );
    });
    const app = await createApp({ authenticated: true });

    const response = await app.inject({
      method: "GET",
      url: "/remote/admin/pairing/challenges/missing",
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().message, "Pairing challenge not found");
    await app.close();
  });

  it("requires a paired device credential for the remote manifest", async () => {
    const app = await createApp();

    const forbiddenResponse = await app.inject({
      method: "GET",
      url: "/remote/v1/manifest",
    });
    assert.equal(forbiddenResponse.statusCode, 403, forbiddenResponse.body);

    const manifestApp = await createApp({
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["threads:read", "messages:write"],
      },
    });
    const manifestResponse = await manifestApp.inject({
      method: "GET",
      url: "/remote/v1/manifest",
    });

    assert.equal(manifestResponse.statusCode, 200, manifestResponse.body);
    assert.equal(manifestResponse.json().data.device.id, "device-1");
    assert.deepEqual(manifestResponse.json().data.routes.workspaces, [
      "GET /remote/v1/workspaces",
    ]);
    assert.deepEqual(manifestResponse.json().data.routes.threads, [
      "GET /threads",
      "GET /threads/:id",
      "POST /threads",
      "DELETE /threads/:id",
    ]);
    assert.deepEqual(manifestResponse.json().data.routes.tools, [
      "GET /remote/v1/tools",
      "POST /remote/v1/tool-invocations/stream",
      "POST /remote/v1/tool-invocations/:invocationId/approval",
      "POST /remote/v1/tool-invocations/:invocationId/cancel",
    ]);
    assert.deepEqual(manifestResponse.json().data.routes.mcp, ["POST /mcp"]);
    assert.deepEqual(manifestResponse.json().data.routes.push, [
      "POST /remote/v1/push/binding-descriptor",
      "POST /remote/v1/push/bindings/accept",
    ]);
    await app.close();
    await manifestApp.close();
  });

  it("binds Push bootstrap to the authenticated paired device and owner", async () => {
    const app = await createApp({
      authenticated: true,
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["threads:read"],
      },
    });

    const descriptor = await app.inject({
      method: "POST",
      url: "/remote/v1/push/binding-descriptor",
      payload: {
        installationId: "installation-1",
        sourceScope: ["thread-1"],
      },
    });
    assert.equal(descriptor.statusCode, 200, descriptor.body);
    expect(mocks.push.createBindingDescriptor).toHaveBeenCalledWith({
      installationId: "installation-1",
      originRemoteDeviceId: "device-1",
      ownerUserId: user.id,
      sourceScope: ["thread-1"],
    });
    assert.equal(
      descriptor.json().data.brokerBaseUrl,
      "https://push.example.test",
    );

    const accepted = await app.inject({
      method: "POST",
      url: "/remote/v1/push/bindings/accept",
      payload: {
        bindingNonce: "binding-nonce",
        installationId: "installation-1",
        deliveryToken: "delivery_0123456789012345678901234567890123456789",
        sourceScope: ["thread-1"],
      },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    expect(mocks.push.acceptApprovedBinding).toHaveBeenCalledWith({
      bindingNonce: "binding-nonce",
      installationId: "installation-1",
      originRemoteDeviceId: "device-1",
      ownerUserId: user.id,
      deliveryToken: "delivery_0123456789012345678901234567890123456789",
      sourceScope: ["thread-1"],
    });

    await app.close();
  });

  it("maps unavailable Push Broker configuration to 503 without hiding the cause", async () => {
    mocks.pushConfig.getBrokerBaseUrl.mockImplementationOnce(() => {
      throw new mocks.HostNotificationConfigError(
        "BROKER_NOT_CONFIGURED",
        "MIRA_PUSH_BROKER_URL is not configured",
      );
    });
    const app = await createApp({
      authenticated: true,
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["threads:read"],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/remote/v1/push/binding-descriptor",
      payload: {
        installationId: "installation-1",
        sourceScope: ["thread-1"],
      },
    });

    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().message, "MIRA_PUSH_BROKER_URL is not configured");
    await app.close();
  });

  it("maps consumed or expired Push binding requests to 400", async () => {
    mocks.push.acceptApprovedBinding.mockImplementationOnce(() => {
      throw new mocks.HostNotificationBindingError(
        "REQUEST_EXPIRED",
        "Notification binding request has expired",
      );
    });
    const app = await createApp({
      authenticated: true,
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["threads:read"],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/remote/v1/push/bindings/accept",
      payload: {
        bindingNonce: "binding-nonce",
        installationId: "installation-1",
        deliveryToken: "delivery_0123456789012345678901234567890123456789",
        sourceScope: ["thread-1"],
      },
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().message, "Notification binding request has expired");
    await app.close();
  });

  it("rejects Push bootstrap for a source outside the paired owner's threads", async () => {
    const app = await createApp({
      authenticated: true,
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["threads:read"],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/remote/v1/push/binding-descriptor",
      payload: {
        installationId: "installation-1",
        sourceScope: ["thread-other"],
      },
    });

    assert.equal(response.statusCode, 403, response.body);
    expect(mocks.push.createBindingDescriptor).not.toHaveBeenCalled();
    await app.close();
  });

  it("supports native-authorized Cloud Mobile through canonical tools and Harness, without pairing", async () => {
    const app = await createApp({ cloud: true });
    const tools = await app.inject({ method: "GET", url: "/remote/v1/tools" });
    assert.equal(tools.statusCode, 200, tools.body);
    const manifest = await app.inject({ method: "GET", url: "/remote/v1/manifest" });
    assert.equal(manifest.statusCode, 200, manifest.body);
    expect(manifest.json().data.device).toMatchObject({
      id: "phone-a", platform: "cloud",
      scopes: ["threads:read", "tools:read", "tools:invoke", "tools:control"],
    });
    expect(manifest.json().data.routes.push).toEqual([]);
    const stream = await app.inject({
      method: "POST", url: "/remote/v1/tool-invocations/stream",
      payload: { toolId: "web_search", args: { queries: ["cloud"] } },
    });
    assert.equal(stream.statusCode, 200, stream.body);
    expect(stream.body).toContain('"type":"tool:complete"');
    expect(mocks.toolGateway.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, toolId: "web_search" }),
    );
    const push = await app.inject({
      method: "POST", url: "/remote/v1/push/binding-descriptor",
      payload: { installationId: "phone-a", sourceScope: ["thread-1"] },
    });
    assert.equal(push.statusCode, 403, push.body);
    expect(mocks.push.createBindingDescriptor).not.toHaveBeenCalled();
    await app.close();
  });

  it("lists and streams mobile-safe remote tools through the gateway service", async () => {
    const app = await createApp({
      authenticated: true,
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["tools:read", "tools:invoke"],
      },
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/remote/v1/tools",
    });
    assert.equal(listResponse.statusCode, 200, listResponse.body);
    assert.equal(listResponse.json().data[0].id, "web_search");

    const streamResponse = await app.inject({
      method: "POST",
      url: "/remote/v1/tool-invocations/stream",
      payload: { toolId: "web_search", args: { queries: ["mira"] } },
    });
    assert.equal(streamResponse.statusCode, 200, streamResponse.body);
    expect(streamResponse.body).toContain('"type":"tool:start"');
    expect(streamResponse.body).toContain('"type":"tool:complete"');
    expect(mocks.toolGateway.assertAvailable).toHaveBeenCalledWith("web_search");
    expect(mocks.toolGateway.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "web_search",
        args: { queries: ["mira"] },
        userId: user.id,
        signal: expect.any(AbortSignal),
      }),
    );

    await app.close();
  });

  it("rejects unavailable tools before committing the SSE response", async () => {
    // Production throws an AppError (mcpBadRequest); a plain Error carrying a
    // statusCode property is not recognized by isAppError and is re-wrapped as
    // INTERNAL_ERROR, so the mock must use the real error type.
    mocks.toolGateway.assertAvailable.mockRejectedValueOnce(
      badRequest("Tool is not available to the mobile Agent surface"),
    );
    const app = await createApp({
      authenticated: true,
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["tools:invoke"],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/remote/v1/tool-invocations/stream",
      payload: { toolId: "missing_tool", args: {} },
    });

    assert.equal(response.statusCode, 400, response.body);
    expect(mocks.toolGateway.execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("terminates post-dispatch tool failures with a safe SSE error event", async () => {
    mocks.toolGateway.execute.mockRejectedValueOnce(new Error("private runtime detail"));
    const app = await createApp({
      authenticated: true,
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["tools:invoke"],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/remote/v1/tool-invocations/stream",
      payload: { toolId: "web_search", args: {} },
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(response.body).toContain('"type":"tool:error"');
    expect(response.body).toContain('"code":"REMOTE_TOOL_REQUEST_FAILED"');
    expect(response.body).not.toContain("private runtime detail");
    await app.close();
  });

  it("projects and explicitly ends an official Cloud MCP thread workspace", async () => {
    const app = await createApp({ cloud: true });

    const workspace = await app.inject({
      method: "GET",
      url: "/remote/v1/threads/thread-1/workspace",
    });
    assert.equal(workspace.statusCode, 200, workspace.body);
    expect(workspace.json().data).toMatchObject({
      threadId: "thread-1",
      status: "not_started",
    });
    expect(mocks.threadWorkspace.getState).toHaveBeenCalledWith({
      threadId: "thread-1",
      userId: user.id,
      identity: {
        accountId: "account-a",
        hostId: "host-a",
        mobileDeviceId: "phone-a",
      },
    });

    mocks.terminalSessions.stopForThread
      .mockResolvedValueOnce({ requested: 1, stopped: 1 })
      .mockResolvedValueOnce({ requested: 0, stopped: 0 });
    const ended = await app.inject({
      method: "POST",
      url: "/remote/v1/threads/thread-1/end",
    });
    assert.equal(ended.statusCode, 200, ended.body);
    expect(ended.json().data).toMatchObject({
      threadId: "thread-1",
      status: "ended",
      stoppedInvocations: 0,
      stoppedTerminalSessions: 1,
    });
    expect(mocks.toolGateway.cancelThread).toHaveBeenCalledWith(
      user.id,
      "remote-mcp-scoped-thread-1",
    );
    expect(mocks.terminalSessions.stopForThread).toHaveBeenCalledWith({
      userId: user.id,
      threadId: "remote-mcp-scoped-thread-1",
    });

    await app.close();
  });

  it("keeps Direct callers outside the Cloud thread lifecycle routes", async () => {
    const app = await createApp({
      authenticated: true,
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["tools:read", "tools:control"],
      },
    });

    const workspace = await app.inject({
      method: "GET",
      url: "/remote/v1/threads/thread-1/workspace",
    });
    assert.equal(workspace.statusCode, 403, workspace.body);

    const ended = await app.inject({
      method: "POST",
      url: "/remote/v1/threads/thread-1/end",
    });
    assert.equal(ended.statusCode, 403, ended.body);
    expect(mocks.threadWorkspace.getState).not.toHaveBeenCalled();
    expect(mocks.threadWorkspace.end).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps stable thread lifecycle errors through the normal envelope", async () => {
    mocks.threadWorkspace.end.mockImplementationOnce(() => {
      throw new mocks.RemoteThreadWorkspaceError(
        "thread_not_found",
        "Remote thread was not found",
        404,
      );
    });
    const app = await createApp({ cloud: true });

    const response = await app.inject({
      method: "POST",
      url: "/remote/v1/threads/missing/end",
    });

    assert.equal(response.statusCode, 404, response.body);
    expect(response.json()).toMatchObject({
      code: "thread_not_found",
      message: "Remote thread was not found",
    });
    expect(mocks.toolGateway.cancelThread).not.toHaveBeenCalled();
    await app.close();
  });

  it("passes the Cloud thread context into exact approval recovery", async () => {
    const threadContext = {
      threadId: "thread-1",
      identity: {
        accountId: "account-a",
        hostId: "host-a",
        mobileDeviceId: "phone-a",
      },
    };
    mocks.threadWorkspace.readContext.mockReturnValueOnce(threadContext);
    const app = await createApp({ cloud: true });

    const response = await app.inject({
      method: "POST",
      url: "/remote/v1/tool-invocations/inv-1/approval",
      headers: { "x-mira-thread-id": "thread-1" },
      payload: {
        decision: "approved",
        toolId: "terminal",
        args: { command: "pwd" },
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(mocks.toolGateway.approve).toHaveBeenCalledWith(
      expect.objectContaining({ threadContext }),
    );
    await app.close();
  });

  it("routes mobile approval and cancellation to the original invocation", async () => {
    const app = await createApp({
      authenticated: true,
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["tools:approve", "tools:control"],
      },
    });

    const approvalResponse = await app.inject({
      method: "POST",
      url: "/remote/v1/tool-invocations/inv-1/approval",
      payload: {
        decision: "approved",
        toolId: "terminal",
        args: { command: "pwd" },
      },
    });
    assert.equal(approvalResponse.statusCode, 200, approvalResponse.body);
    expect(mocks.toolGateway.approve).toHaveBeenCalledWith({
      invocationId: "inv-1",
      decision: "approved",
      toolId: "terminal",
      args: { command: "pwd" },
      userId: user.id,
    });

    const cancelResponse = await app.inject({
      method: "POST",
      url: "/remote/v1/tool-invocations/inv-1/cancel",
    });
    assert.equal(cancelResponse.statusCode, 200, cancelResponse.body);
    expect(mocks.toolGateway.cancel).toHaveBeenCalledWith("inv-1", user.id);

    await app.close();
  });

  it("returns active and archived mobile-safe workspaces without rootPath", async () => {
    const app = await createApp({
      authenticated: true,
      device: {
        id: "device-1",
        name: "K70",
        platform: "android",
        permissions: ["threads:read"],
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/remote/v1/workspaces",
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(mocks.thread.listChatWorkspaces).toHaveBeenCalledWith(user.id);
    expect(mocks.workspaces.list).toHaveBeenCalledWith({
      userId: user.id,
      status: "archived",
    });
    assert.deepEqual(response.json().data, [
      {
        id: "workspace-active",
        name: "Mira BASE",
        isDefault: true,
        status: "active",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
      },
      {
        id: "workspace-archived",
        name: "Old project",
        isDefault: false,
        status: "archived",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ]);
    assert.equal("rootPath" in response.json().data[0], false);
    assert.equal("rootPath" in response.json().data[1], false);
    await app.close();
  });

  it("denies Direct pairing entrypoints while Mira Cloud owns remote access", async () => {
    const app = await createApp({ authenticated: true });
    cloudRemoteAccessMode.applyNativeSessionState("signed_in");

    const challenge = await app.inject({
      method: "POST",
      url: "/remote/admin/pairing/challenges",
    });
    assert.equal(challenge.statusCode, 403, challenge.body);
    expect(mocks.tailscale.getSnapshot).not.toHaveBeenCalled();
    expect(mocks.pairing.createChallenge).not.toHaveBeenCalled();

    const claim = await app.inject({
      method: "POST",
      url: "/remote/pairing/claim",
      payload: { challengeId: "challenge-1", code: "ABCD2345" },
    });
    assert.equal(claim.statusCode, 403, claim.body);
    expect(mocks.pairing.claim).not.toHaveBeenCalled();

    const approve = await app.inject({
      method: "POST",
      url: "/remote/admin/pairing/claims/claim-1/approve",
      payload: {},
    });
    assert.equal(approve.statusCode, 403, approve.body);
    expect(mocks.pairing.approve).not.toHaveBeenCalled();

    const poll = await app.inject({
      method: "POST",
      url: "/remote/pairing/claims/claim-1/poll",
      payload: { pollToken: "poll-token-123456789012345" },
    });
    assert.equal(poll.statusCode, 403, poll.body);
    expect(mocks.pairing.poll).not.toHaveBeenCalled();

    await app.close();
  });

  it("denies a pairing challenge if Cloud signs in during the health check", async () => {
    const app = await createApp({ authenticated: true });
    mocks.tailscale.getSnapshot.mockImplementationOnce(async () => {
      cloudRemoteAccessMode.applyNativeSessionState("signed_in");
      return readySnapshot;
    });
    const response = await app.inject({ method: "POST", url: "/remote/admin/pairing/challenges" });
    expect(response.statusCode).toBe(403);
    expect(mocks.pairing.createChallenge).not.toHaveBeenCalled();
    await app.close();
  });

  it("restores Direct pairing after a confirmed Cloud sign-out", async () => {
    const app = await createApp({ authenticated: true });
    cloudRemoteAccessMode.applyNativeSessionState("signed_in");

    const denied = await app.inject({
      method: "POST",
      url: "/remote/admin/pairing/challenges",
    });
    assert.equal(denied.statusCode, 403, denied.body);

    cloudRemoteAccessMode.applyNativeSessionState("signed_out");
    const allowed = await app.inject({
      method: "POST",
      url: "/remote/admin/pairing/challenges",
    });
    assert.equal(allowed.statusCode, 200, allowed.body);
    expect(mocks.pairing.createChallenge).toHaveBeenCalledOnce();

    await app.close();
  });
});
