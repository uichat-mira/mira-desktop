import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import computerUseRoutes, { type ComputerUseRuntimeRouteService } from "../index.js";
import type { ComputerUseRuntimeState } from "@/microapps/computer-use/index.js";

const runtimeState: ComputerUseRuntimeState = {
  status: "ready",
  browserEngine: "chromium",
  version: "141.0.0",
  checkedAt: "2026-07-14T00:00:00.000Z",
};

const computerUseRuntimeService: ComputerUseRuntimeRouteService = {
  getRuntimeState: async () => runtimeState,
  installRuntime: async () => runtimeState,
};

const app = async () => {
  const server = Fastify();
  await server.register(computerUseRoutes, { computerUseRuntimeService });
  return server;
};

describe("Computer Use Studio routes", () => {
  it("keeps runtime management routes and does not register the retired Manual Debug session routes", async () => {
    const server = await app();

    const runtime = await server.inject({ method: "GET", url: "/microapps/computer-use/runtime" });
    expect(runtime.statusCode).toBe(200);
    expect(runtime.json().data.status).toBe("ready");

    const retired = [
      { method: "GET" as const, url: "/microapps/computer-use/debugger/status" },
      { method: "POST" as const, url: "/microapps/computer-use/sessions" },
      { method: "GET" as const, url: "/microapps/computer-use/sessions/session-1" },
      { method: "POST" as const, url: "/microapps/computer-use/sessions/session-1/observe" },
      { method: "POST" as const, url: "/microapps/computer-use/sessions/session-1/action" },
      { method: "POST" as const, url: "/microapps/computer-use/sessions/session-1/assert" },
      { method: "POST" as const, url: "/microapps/computer-use/sessions/session-1/approval" },
      { method: "POST" as const, url: "/microapps/computer-use/sessions/session-1/approval/reject" },
      { method: "GET" as const, url: "/microapps/computer-use/sessions/session-1/artifacts/artifact-1/content" },
      { method: "POST" as const, url: "/microapps/computer-use/sessions/session-1/stop" },
    ];

    for (const request of retired) {
      const response = await server.inject(request);
      expect(response.statusCode, `${request.method} ${request.url}: ${response.body}`).toBe(404);
    }

    await server.close();
  });
});
