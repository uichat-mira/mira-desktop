import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import computerUseRoutes, { type ComputerUseRuntimeRouteService } from "../index.js";
import type { ComputerUseDebuggerService } from "../debugger-service.js";

const session = {
  sessionId: "session-1",
  status: "ready" as const,
  config: { runtime: "managed" as const, url: "https://example.com", allowedDomains: ["example.com"], limits: { timeoutMs: 30000, maxSnapshotChars: 12000 }, approvalPolicy: "write_actions" as const },
  browser: { url: "https://example.com", title: "Example", snapshot: "button ref=e1", visibleText: "Example", screenshotArtifact: "artifact-1", snapshotHash: "hash-1" },
  invocations: [],
  evidence: { entries: [], artifacts: [] },
};

const debuggerService: ComputerUseDebuggerService = {
  getStatus: () => ({ runtime: { status: "ready", checkedAt: "2026-07-14T00:00:00.000Z" }, model: { status: "unavailable", message: "No provider", checkedAt: "2026-07-14T00:00:00.000Z" } }),
  create: async () => session,
  get: () => session,
  observe: async () => session,
  act: async (_id, input) => ({ ...session, invocations: [{ invocationId: "invocation-1", tool: "browser_act", args: input, status: "succeeded" as const, createdAt: "2026-07-14T00:00:00.000Z" }] }),
  assert: async () => session,
  approve: async () => ({ ...session, approval: { status: "approved" as const } }),
  reject: async () => ({ ...session, approval: { status: "rejected" as const } }),
  stop: async () => ({ ...session, status: "stopped" as const }),
  readArtifact: async () => ({ bytes: Buffer.from("png-bytes"), contentType: "image/png" }),
};

const app = async () => {
  const server = Fastify();
  const computerUseRuntimeService = {} as ComputerUseRuntimeRouteService;
  await server.register(computerUseRoutes, { computerUseRuntimeService, computerUseDebuggerService: debuggerService });
  return server;
};

describe("Computer Use debugger routes", () => {
  it("exposes the structured session flow and controlled artifact content", async () => {
    const server = await app();
    const status = await server.inject({ method: "GET", url: "/microapps/computer-use/debugger/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.model.status).toBe("unavailable");

    const created = await server.inject({ method: "POST", url: "/microapps/computer-use/sessions", payload: session.config });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.sessionId).toBe("session-1");

    expect((await server.inject({ method: "POST", url: "/microapps/computer-use/sessions/session-1/observe" })).statusCode).toBe(200);
    const action = await server.inject({ method: "POST", url: "/microapps/computer-use/sessions/session-1/action", payload: { pageUrl: "https://example.com", snapshotHash: "hash-1", action: { kind: "click", ref: "e1" } } });
    expect(action.statusCode).toBe(200);
    expect(action.json().data.invocations[0].tool).toBe("browser_act");
    expect(action.json().data.invocations[0].args.action).toEqual({ kind: "click", ref: "e1" });
    const invalidAction = await server.inject({ method: "POST", url: "/microapps/computer-use/sessions/session-1/action", payload: { action: "click", value: "e1" } });
    expect(invalidAction.statusCode).toBe(400);
    expect((await server.inject({ method: "POST", url: "/microapps/computer-use/sessions/session-1/assert", payload: { assertion: { kind: "title", expected: "Example" } } })).statusCode).toBe(200);
    const approval = await server.inject({ method: "POST", url: "/microapps/computer-use/sessions/session-1/approval", payload: { invocationId: "invocation-1" } });
    expect(approval.statusCode).toBe(200);
    const rejection = await server.inject({ method: "POST", url: "/microapps/computer-use/sessions/session-1/approval/reject", payload: { invocationId: "invocation-1", reason: "Unsafe" } });
    expect(rejection.statusCode).toBe(200);

    const artifact = await server.inject({ method: "GET", url: "/microapps/computer-use/sessions/session-1/artifacts/artifact-1/content" });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.headers["content-type"]).toBe("image/png");
    expect(artifact.body).toBe("png-bytes");
    expect((await server.inject({ method: "POST", url: "/microapps/computer-use/sessions/session-1/stop" })).statusCode).toBe(200);
    await server.close();
  });
});
