import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendRouteError } from "@/utils/route-errors.js";

const authMocks = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  changeUserPassword: vi.fn(),
  createAccessToken: vi.fn(),
  requireAuth: vi.fn(async (request: { authUser?: unknown }) => {
    request.authUser = { id: 7, username: "alice", role: "user" };
  }),
}));

vi.mock("@/db/auth.db.js", () => authMocks);

import accountRoute from "./account.js";
import loginRoute from "./login.js";
import meRoute from "./me.js";
import oauthRoute from "./oauth.js";

const createApp = async (...plugins: Array<(app: never) => Promise<void>>) => {
  const app = Fastify();
  app.setErrorHandler(sendRouteError);
  for (const plugin of plugins) {
    await app.register(plugin as never);
  }
  return app;
};

describe("authentication routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.createAccessToken.mockReturnValue("signed-token");
  });

  it("issues a token only for valid non-blank credentials", async () => {
    authMocks.authenticateUser.mockReturnValue({
      id: 7,
      username: "alice",
      role: "user",
    });
    const app = await createApp(loginRoute);

    const response = await app.inject({
      method: "POST",
      url: "/login",
      payload: { username: "alice", password: "secret" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      tokenType: "Bearer",
      token: "signed-token",
      expiresIn: "24h",
      user: { id: 7, username: "alice", role: "user" },
    });
    expect(authMocks.authenticateUser).toHaveBeenCalledWith("alice", "secret");
    expect(authMocks.createAccessToken).toHaveBeenCalledOnce();

    const blank = await app.inject({
      method: "POST",
      url: "/login",
      payload: { username: "   ", password: "secret" },
    });
    expect(blank.statusCode).toBe(400);
    expect(authMocks.authenticateUser).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("returns 401 for rejected credentials without issuing a token", async () => {
    authMocks.authenticateUser.mockReturnValue(null);
    const app = await createApp(loginRoute);
    const response = await app.inject({
      method: "POST",
      url: "/login",
      payload: { username: "alice", password: "wrong" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(authMocks.createAccessToken).not.toHaveBeenCalled();
    await app.close();
  });

  it("changes only the authenticated user's password and preserves failure reasons", async () => {
    authMocks.changeUserPassword.mockReturnValue({
      ok: true,
      user: { id: 7, username: "alice", role: "user" },
    });
    const app = await createApp(accountRoute, meRoute);

    const me = await app.inject({ method: "GET", url: "/me" });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user).toEqual({ id: 7, username: "alice", role: "user" });

    const changed = await app.inject({
      method: "POST",
      url: "/account/change-password",
      payload: { currentPassword: "old-pass", newPassword: "new-pass" },
    });
    expect(changed.statusCode).toBe(200);
    expect(authMocks.changeUserPassword).toHaveBeenCalledWith(7, "old-pass", "new-pass");

    const same = await app.inject({
      method: "POST",
      url: "/account/change-password",
      payload: { currentPassword: "same-pass", newPassword: "same-pass" },
    });
    expect(same.statusCode).toBe(400);

    authMocks.changeUserPassword.mockReturnValue({
      ok: false,
      reason: "INVALID_CURRENT_PASSWORD",
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/account/change-password",
      payload: { currentPassword: "wrong", newPassword: "new-pass" },
    });
    expect(rejected.statusCode).toBe(401);
    await app.close();
  });

  it("validates OAuth redirect and makes authorization codes single-use", async () => {
    const app = Fastify();
    app.setErrorHandler(sendRouteError);
    app.addHook("preHandler", async (request) => {
      request.authUser = { id: 7, username: "alice", role: "user" };
    });
    await app.register(oauthRoute);

    const invalidRedirect = await app.inject({
      method: "POST",
      url: "/oauth/authorize/approve",
      payload: {
        client_id: "mira-clipper",
        response_type: "code",
        redirect_uri: "https://evil.example/callback",
        state: "state-1",
        code_challenge: "challenge",
        code_challenge_method: "S256",
      },
    });
    expect(invalidRedirect.statusCode).toBe(400);

    const issued = await app.inject({
      method: "POST",
      url: "/oauth/extension/authorization-code",
      payload: {},
    });
    expect(issued.statusCode).toBe(200);
    const wrappedCode = String(issued.json().data.code);
    const rawCode = wrappedCode.slice(wrappedCode.indexOf(".") + 1);

    const exchange = () => app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "authorization_code",
        client_id: "mira-clipper",
        code: rawCode,
      },
    });
    const first = await exchange();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ tokenType: "Bearer", accessToken: "signed-token" });

    const replay = await exchange();
    expect(replay.statusCode).toBe(401);
    expect(authMocks.createAccessToken).toHaveBeenCalledOnce();
    await app.close();
  });
});
