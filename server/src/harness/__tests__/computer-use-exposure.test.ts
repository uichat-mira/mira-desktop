import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHarnessToolCandidatesForTurn } from "../candidates-core/resolver.js";
import { clearHarnessRegistry, registerTool } from "../registry.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";

describe("Computer Use Harness exposure", () => {
  beforeEach(() => clearHarnessRegistry());
  afterEach(() => clearHarnessRegistry());

  it("exposes only atomic Browser Tools to Agent intent while retaining legacy registrations", async () => {
    const browser = { observe: async () => ({ ok: true }), act: async () => ({ ok: true }), assert: async () => ({ ok: true }) };
    createComputerUseBrowserTools(browser as never).forEach(registerTool);

    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "请打开网页读取页面标题",
      maxTools: 10,
    });

    expect(result.toolExposure.exposedToolIds).toEqual(
      expect.arrayContaining([
        "browser_navigate",
        "browser_snapshot",
        "browser_fill",
        "browser_click",
        "browser_wait_for",
        "browser_assert",
      ]),
    );
    expect(result.toolExposure.exposedToolIds).not.toContain("browser_observe");
    expect(result.toolExposure.exposedToolIds).not.toContain("browser_act");
    expect(result.toolCandidates.map((candidate) => candidate.toolId)).not.toContain(
      "browser_observe",
    );
    expect(result.toolCandidates.map((candidate) => candidate.toolId)).not.toContain(
      "browser_act",
    );
    expect(result.toolExposure.blockedCapabilityIds).toEqual(
      expect.arrayContaining(["browser_observe", "browser_act"]),
    );
  });

  it("keeps registered browser tools visible to chat_surface", async () => {
    const browser = { observe: async () => ({ ok: true }), act: async () => ({ ok: true }), assert: async () => ({ ok: true }) };
    createComputerUseBrowserTools(browser as never).forEach(registerTool);

    const result = await resolveHarnessToolCandidatesForTurn({ source: "chat_surface", query: "打开网页读取标题" });

    expect(result.toolExposure.exposedToolIds).toEqual(expect.arrayContaining(["browser_observe", "browser_act", "browser_assert"]));
  });

  it("keeps browser tools available for a browser-intent Agent turn", async () => {
    const browser = { observe: async () => ({ ok: true }), act: async () => ({ ok: true }), assert: async () => ({ ok: true }) };
    createComputerUseBrowserTools(browser as never).forEach(registerTool);
    registerTool({
      definition: {
        id: "terminal",
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
      expect.arrayContaining([
        "browser_navigate",
        "browser_snapshot",
        "browser_fill",
        "browser_click",
        "browser_wait_for",
        "browser_assert",
      ]),
    );
    expect(result.toolExposure.exposedToolIds).not.toContain("browser_observe");
    expect(result.toolExposure.exposedToolIds).not.toContain("browser_act");
    expect(result.toolCandidates.map((candidate) => candidate.toolId)).not.toContain(
      "browser_observe",
    );
    expect(result.toolCandidates.map((candidate) => candidate.toolId)).not.toContain(
      "browser_act",
    );
  });
});
