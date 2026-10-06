import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChatToolSurface } from "./chat-tool-surface.js";

const resolveHarnessToolExposureMock = vi.hoisted(() => vi.fn());

vi.mock("@/harness/exposure.js", () => ({
  resolveHarnessToolExposure: resolveHarnessToolExposureMock,
}));

describe("chat tool surface", () => {
  afterEach(() => {
    resolveHarnessToolExposureMock.mockReset();
  });

  it("exposes the default allowlisted chat tools for normal chat", () => {
    resolveHarnessToolExposureMock.mockReturnValue({
      visibleDefinitions: [
        {
          id: "web_search",
          title: "Web Search",
          description: "Search the web.",
          domain: "web_search",
          mode: "sync",
          inputSchema: { type: "object" },
          tags: ["search"],
          capabilities: {
            sideEffect: "network",
            requiresApproval: false,
          },
        },
      ],
      blockedCapabilityIds: ["terminal"],
      reasons: [],
    });

    const tools = resolveChatToolSurface();

    expect(resolveHarnessToolExposureMock).toHaveBeenCalledWith({
      source: "chat_surface",
    });

    expect(tools.map((tool) => tool.id)).toEqual(["web_search"]);
  });

  it("exposes all built-in tools in agent mode", () => {
    resolveHarnessToolExposureMock.mockReturnValue({
      visibleDefinitions: [
        {
          id: "read_list",
          title: "Read List",
          description: "List the workspace directory.",
          domain: "read",
          mode: "sync",
          inputSchema: { type: "object" },
          tags: ["read", "workspace"],
          capabilities: {
            sideEffect: "none",
            requiresApproval: false,
            workspaceBound: true,
          },
        },
        {
          id: "web_search",
          title: "Web Search",
          description: "Search the web.",
          domain: "web_search",
          mode: "sync",
          inputSchema: { type: "object" },
          tags: ["search"],
          capabilities: {
            sideEffect: "network",
            requiresApproval: false,
          },
        },
        {
          id: "terminal",
          title: "Terminal Session",
          description: "Run commands in a managed terminal session.",
          domain: "terminal",
          mode: "stream",
          inputSchema: { type: "object" },
          tags: ["terminal"],
          capabilities: {
            sideEffect: "process",
            requiresApproval: true,
          },
        },
      ],
      blockedCapabilityIds: ["edit_file", "mcp:demo:tool:search"],
      reasons: [],
    });

    const tools = resolveChatToolSurface({
      agentEnabled: true,
    });

    expect(resolveHarnessToolExposureMock).toHaveBeenCalledWith({
      source: "agent_intent",
    });

    expect(tools.map((tool) => tool.id)).toEqual([
      "read_list",
      "web_search",
      "terminal",
    ]);
  });

  it("keeps the normal chat surface narrow even when more tools exist", () => {
    resolveHarnessToolExposureMock.mockReturnValue({
      visibleDefinitions: [
      {
        id: "read_list",
        title: "Read List",
        description: "List the workspace directory.",
        domain: "read",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["read", "workspace"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
          workspaceBound: true,
        },
      },
      {
        id: "web_search",
        title: "Web Search",
        description: "Search the web.",
        domain: "web_search",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["search"],
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
        },
      },
      ],
      blockedCapabilityIds: [],
      reasons: [],
    });

    const tools = resolveChatToolSurface();

    expect(tools.map((tool) => tool.id)).toEqual(["web_search"]);
  });

  it("supports a caller-provided allowlist and maxTools cap", () => {
    resolveHarnessToolExposureMock.mockReturnValue({
      visibleDefinitions: [
      {
        id: "web_search",
        title: "Web Search",
        description: "Search the web.",
        domain: "web_search",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["search"],
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
        },
      },
      {
        id: "read_list",
        title: "Read List",
        description: "List the workspace directory.",
        domain: "read",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["read"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      {
        id: "edit_file",
        title: "Edit File",
        description: "Edit workspace files.",
        domain: "edit",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["edit"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
        },
      },
      ],
      blockedCapabilityIds: [],
      reasons: [],
    });

    const tools = resolveChatToolSurface({
      allowlist: ["read_list", "edit_file"],
      maxTools: 1,
    });

    expect(tools.map((tool) => tool.id)).toEqual(["read_list"]);
  });

  it("does not expose external MCP projections in agent mode even when they look tool-like", () => {
    resolveHarnessToolExposureMock.mockReturnValue({
      visibleDefinitions: [
      {
        id: "terminal",
        title: "Terminal Session",
        description: "Run commands.",
        domain: "terminal",
        mode: "stream",
        inputSchema: { type: "object" },
        tags: ["terminal"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
        },
      },
      {
        id: "mcp:demo:tool:terminal_proxy",
        title: "Terminal Proxy",
        description: "Projected external MCP terminal tool.",
        domain: "external_mcp",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["mcp", "external", "demo", "terminal"],
        capabilities: {
          sideEffect: "network",
          requiresApproval: true,
          networkAccess: true,
          longRunning: true,
        },
      },
      ],
      blockedCapabilityIds: [],
      reasons: [],
    });

    const tools = resolveChatToolSurface({
      agentEnabled: true,
    });

    expect(tools.map((tool) => tool.id)).toEqual(["terminal"]);
  });
});
