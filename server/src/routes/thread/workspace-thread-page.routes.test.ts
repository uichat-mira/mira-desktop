import assert from "node:assert/strict";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendRouteError } from "@/utils/route-errors.js";

const mocks = vi.hoisted(() => ({
  workspaces: {
    findById: vi.fn(),
  },
  threads: {
    listPage: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock("@/db/repositories/chat-workspace.repository.js", () => ({
  chatWorkspaceRepository: mocks.workspaces,
}));

vi.mock("@/db/repositories/remote-workspace-thread.repository.js", () => ({
  remoteWorkspaceThreadRepository: mocks.threads,
}));

import { registerWorkspaceThreadPageRoutes } from "./workspace-thread-page.routes.js";

const user = { id: 7, username: "tester", role: "user" as const };
const workspace = {
  id: "workspace-1",
  userId: user.id,
  name: "Mira BASE",
  rootPath: "/Users/tester/mira",
  status: "active",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
};

const rows = [
  {
    id: "thread-3",
    title: "Third",
    modelName: "model-a",
    workspaceId: workspace.id,
    knowledgeBaseId: null,
    roleId: null,
    agentEnabled: false,
    status: "active",
    createdAt: "2026-08-01T03:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    messageCount: 3,
    lastMessageContent: "third message",
  },
  {
    id: "thread-2",
    title: "Second",
    modelName: null,
    workspaceId: workspace.id,
    knowledgeBaseId: "kb-1",
    roleId: "role-1",
    agentEnabled: true,
    status: "active",
    createdAt: "2026-08-01T02:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    messageCount: 2,
    lastMessageContent: "second message",
  },
  {
    id: "thread-1",
    title: "First",
    modelName: null,
    workspaceId: workspace.id,
    knowledgeBaseId: null,
    roleId: null,
    agentEnabled: false,
    status: "active",
    createdAt: "2026-08-01T01:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    messageCount: 1,
    lastMessageContent: "first message",
  },
];

const createApp = async (paired = true, cloud = false) => {
  const app = Fastify();
  app.setErrorHandler(sendRouteError);
  app.addHook("preHandler", async (request) => {
    request.authUser = user;
    if (cloud) {
      request.cloudRemoteCaller = {
        kind: "cloud", accountId: "account-1", hostId: "host-1",
        mobileDeviceId: "mobile-1", revision: 3,
        scopes: ["threads:read"], owner: user,
      };
    }
    if (paired) {
      request.remoteDevice = {
        id: "device-1",
        userId: user.id,
        name: "K70",
        platform: "android",
        publicKey: null,
        tokenHash: "hash",
        permissions: ["threads:read"],
        createdAt: "2026-08-01T00:00:00.000Z",
        lastSeenAt: null,
      };
    }
  });
  await registerWorkspaceThreadPageRoutes(app);
  return app;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspaces.findById.mockReturnValue(workspace);
  mocks.threads.listPage.mockReturnValue(rows);
  mocks.threads.count.mockReturnValue(8);
});

describe("remote workspace thread pages", () => {
  it("returns a stable page and authoritative total without loading the full list", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: `/remote/v1/workspaces/${workspace.id}/threads?limit=2`,
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(mocks.workspaces.findById).toHaveBeenCalledWith(workspace.id, user.id);
    expect(mocks.threads.listPage).toHaveBeenCalledWith({
      userId: user.id,
      workspaceId: workspace.id,
      status: "active",
      limit: 3,
      cursor: undefined,
    });
    expect(mocks.threads.count).toHaveBeenCalledWith({
      userId: user.id,
      workspaceId: workspace.id,
      status: "active",
    });

    const body = response.json().data;
    assert.equal(body.items.length, 2);
    assert.equal(body.total, 8);
    assert.equal(body.limit, 2);
    assert.equal(typeof body.nextCursor, "string");
    assert.deepEqual(body.items[1], {
      id: "thread-2",
      title: "Second",
      modelName: null,
      workspaceId: workspace.id,
      knowledgeBaseId: "kb-1",
      roleId: "role-1",
      agentEnabled: true,
      status: "active",
      createdAt: "2026-08-01T02:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
      messageCount: 2,
      lastMessage: "second message",
    });
    await app.close();
  });

  it("passes an opaque cursor and archived filter to the authoritative query", async () => {
    const app = await createApp();
    mocks.threads.listPage.mockReturnValue([]);
    mocks.threads.count.mockReturnValue(4);
    const cursorPayload = {
      updatedAt: "2026-08-02T00:00:00.000Z",
      id: "thread-2",
    };
    const cursor = Buffer.from(JSON.stringify(cursorPayload), "utf8").toString(
      "base64url",
    );

    const response = await app.inject({
      method: "GET",
      url: `/remote/v1/workspaces/${workspace.id}/threads?status=archived&limit=25&cursor=${encodeURIComponent(cursor)}`,
    });

    assert.equal(response.statusCode, 200, response.body);
    expect(mocks.threads.listPage).toHaveBeenCalledWith({
      userId: user.id,
      workspaceId: workspace.id,
      status: "archived",
      limit: 26,
      cursor: cursorPayload,
    });
    assert.deepEqual(response.json().data, {
      items: [],
      total: 4,
      nextCursor: null,
      limit: 25,
    });
    await app.close();
  });

  it("rejects invalid cursors before querying threads", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: `/remote/v1/workspaces/${workspace.id}/threads?cursor=not-a-cursor`,
    });

    assert.equal(response.statusCode, 400, response.body);
    expect(mocks.threads.listPage).not.toHaveBeenCalled();
    expect(mocks.threads.count).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not expose another user's workspace", async () => {
    const app = await createApp();
    mocks.workspaces.findById.mockReturnValue(null);
    const response = await app.inject({
      method: "GET",
      url: "/remote/v1/workspaces/other-workspace/threads",
    });

    assert.equal(response.statusCode, 404, response.body);
    expect(mocks.threads.listPage).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts a Cloud-authorized caller and preserves local owner isolation", async () => {
    const app = await createApp(false, true);
    const allowed = await app.inject({
      method: "GET",
      url: `/remote/v1/workspaces/${workspace.id}/threads?limit=2`,
    });
    assert.equal(allowed.statusCode, 200, allowed.body);
    expect(mocks.workspaces.findById).toHaveBeenCalledWith(workspace.id, user.id);
    expect(mocks.threads.listPage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, workspaceId: workspace.id }),
    );

    mocks.workspaces.findById.mockReturnValueOnce(null);
    const crossOwner = await app.inject({
      method: "GET", url: "/remote/v1/workspaces/other-owner/threads",
    });
    assert.equal(crossOwner.statusCode, 404, crossOwner.body);
    await app.close();
  });

  it("requires a paired remote device", async () => {
    const app = await createApp(false);
    const response = await app.inject({
      method: "GET",
      url: `/remote/v1/workspaces/${workspace.id}/threads`,
    });

    assert.equal(response.statusCode, 403, response.body);
    expect(mocks.workspaces.findById).not.toHaveBeenCalled();
    await app.close();
  });
});
