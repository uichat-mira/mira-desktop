import assert from "node:assert/strict";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendRouteError } from "@/utils/route-errors.js";

const mocks = vi.hoisted(() => {
  class PairingServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "PairingServiceError";
    }
  }

  return {
    PairingServiceError,
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
    workspaces: {
      list: vi.fn(),
    },
    relay: {
      getPairingMetadata: vi.fn(),
    },
    toolGateway: {
      list: vi.fn(),
      assertAvailable: vi.fn(),
      execute: vi.fn(),
      approve: vi.fn(),
      cancel: vi.fn(),
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

vi.mock("@/db/repositories/chat-workspace.repository.js", () => ({
  chatWorkspaceRepository: mocks.workspaces,
}));

vi.mock("@/services/remote-relay-config.service.js", () => {
  class RemoteRelayConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RemoteRelayConfigError";
    }
  }

  return {
    RemoteRelayConfigError,
    getRemoteRelayPairingMetadata: mocks.relay.getPairingMetadata,
    getRemoteRelayUserConfig: vi.fn(() => ({
      enabled: false,
      endpointMode: "default",
      customUrl: "",
      effectiveUrl: null,
      defaultAvailable: false,
      updatedAt: null,
    })),
    resolvePersistedRemoteRelayConnectorConfig: vi.fn(() => ({
      enabled: false,
      relayUrl: null,
      relayId: null,
      hostToken: null,
      clientToken: null,
    })),
    updateRemoteRelayUserConfig: vi.fn(() => ({
      enabled: false,
      endpointMode: "default",
      customUrl: "",
      effectiveUrl: null,
      defaultAvailable: false,
      updatedAt: null,
    })),
  };
});

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
  REMOTE_PAIRING_TRANSPORTS: ["relay", "direct"],
}));

vi.mock("@/services/remote-tool-gateway.service.js", () => ({
  assertRemoteToolAvailable: mocks.toolGateway.assertAvailable,
  listRemoteToolManifests: mocks.toolGateway.list,
  executeRemoteToolInvocation: mocks.toolGateway.execute,
  resolveRemoteToolApproval: mocks.toolGateway.approve,
  cancelRemoteToolInvocation: mocks.toolGateway.cancel,
}));

import remoteAccessRoute from "./remote-access.js";

const user = { id: 7, username: "tester", role: "user" as const };
const readySnapshot = {
  runtime: {
    state: "ready",
    accessUrl: "https://mira.example.ts.net",
  },
};

const createApp = async (options: { authenticated?: boolean; device?: unknown } = {}) => {
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
  });
  await app.register(remoteAccessRoute);
  return app;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.relay.getPairingMetadata.mockReturnValue(null);
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
    toolId: "terminal_session",
    status: "completed",
    content: "approved result",
  });
  mocks.toolGateway.cancel.mockReturnValue({
    invocationId: "inv-1",
    accepted: true,
    status: "cancelling",
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
      relay: null,
    });
    assert.equal(response.json().data.challengeId, "challenge-1");
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
        transport: "relay",
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
      transport: "relay",
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
        transport: "relay",
        requestedScopes: ["threads:read", "future:capability"],
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(mocks.pairing.claim).toHaveBeenCalledWith({
      challengeId: "challenge-1",
      code: "ABCD2345",
      deviceName: "K70",
      platform: "android",
      transport: "relay",
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
    await app.close();
    await manifestApp.close();
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
      payload: { toolId: "web_search", args: { query: "mira" } },
    });
    assert.equal(streamResponse.statusCode, 200, streamResponse.body);
    expect(streamResponse.body).toContain('"type":"tool:start"');
    expect(streamResponse.body).toContain('"type":"tool:complete"');
    expect(mocks.toolGateway.assertAvailable).toHaveBeenCalledWith("web_search");
    expect(mocks.toolGateway.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "web_search",
        args: { query: "mira" },
        userId: user.id,
        signal: expect.any(AbortSignal),
      }),
    );

    await app.close();
  });

  it("rejects unavailable tools before committing the SSE response", async () => {
    mocks.toolGateway.assertAvailable.mockRejectedValueOnce(
      Object.assign(new Error("Tool is not available to the mobile Agent surface"), {
        statusCode: 400,
      }),
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
        toolId: "terminal_session",
        args: { command: "pwd" },
      },
    });
    assert.equal(approvalResponse.statusCode, 200, approvalResponse.body);
    expect(mocks.toolGateway.approve).toHaveBeenCalledWith({
      invocationId: "inv-1",
      decision: "approved",
      toolId: "terminal_session",
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
});
