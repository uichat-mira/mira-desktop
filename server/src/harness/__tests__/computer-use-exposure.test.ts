import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHarnessToolCandidatesForTurn } from "../candidates-core/resolver.js";
import { clearHarnessRegistry, registerCapability } from "../registry.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";

describe("Computer Use Harness exposure", () => {
  beforeEach(() => clearHarnessRegistry());
  afterEach(() => clearHarnessRegistry());

  it("exposes browser tools for an explicit browser request without changing AgentGraph", async () => {
    const browser = { observe: async () => ({ ok: true }), act: async () => ({ ok: true }), assert: async () => ({ ok: true }) };
    createComputerUseBrowserTools(browser as never).forEach(registerCapability);

    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "请打开网页读取页面标题",
      maxTools: 10,
    });

    expect(result.toolExposure.exposedToolIds).toEqual(expect.arrayContaining(["browser_observe", "browser_act", "browser_assert"]));
    expect(result.toolCandidates.map((candidate) => candidate.toolId)).toEqual(expect.arrayContaining(["browser_observe", "browser_act", "browser_assert"]));
    expect(result.toolExposure.blockedCapabilityIds).not.toContain("browser_observe");
  });

  it("keeps registered browser tools visible to chat_surface", async () => {
    const browser = { observe: async () => ({ ok: true }), act: async () => ({ ok: true }), assert: async () => ({ ok: true }) };
    createComputerUseBrowserTools(browser as never).forEach(registerCapability);

    const result = await resolveHarnessToolCandidatesForTurn({ source: "chat_surface", query: "打开网页读取标题" });

    expect(result.toolExposure.exposedToolIds).toEqual(expect.arrayContaining(["browser_observe", "browser_act", "browser_assert"]));
  });

  it("keeps browser tools available for a browser-intent Agent turn", async () => {
    const browser = { observe: async () => ({ ok: true }), act: async () => ({ ok: true }), assert: async () => ({ ok: true }) };
    createComputerUseBrowserTools(browser as never).forEach(registerCapability);
    registerCapability({
      definition: {
        id: "terminal_session",
        title: "Terminal Session",
        description: "Run a local command.",
        domain: "terminal",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["terminal", "command"],
        capabilities: { sideEffect: "process", requiresApproval: true, sandboxRequired: true, sandboxProfile: "command" },
      },
      execute: async () => ({ result: { ok: true } }),
    });

    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "请只读打开 https://example.com，读取页面标题，不要执行任何写操作。",
      maxTools: 10,
    });

    expect(result.toolExposure.exposedToolIds).toEqual(
      expect.arrayContaining(["browser_observe", "browser_act", "browser_assert"]),
    );
    expect(result.toolCandidates.map((candidate) => candidate.toolId)).toEqual(
      expect.arrayContaining(["browser_observe", "browser_act", "browser_assert"]),
    );
  });
});
