import { describe, expect, it } from "vitest";
import { resolveHarnessCapabilityProfiles } from "./capability-profiles.js";
import type { McpToolDefinition } from "../mcp/core/definitions.js";

const createDefinition = (
  id: string,
  domain: McpToolDefinition["domain"] = "browser_action",
): McpToolDefinition => ({
  id,
  title: id,
  description: id,
  domain,
  source: "internal",
  mode: "sync",
  inputSchema: {},
  tags: ["browser"],
  capabilities: {
    sideEffect: "none",
    requiresApproval: false,
  },
});

describe("resolveHarnessCapabilityProfiles", () => {
  it("groups read family tools under one workspace capability profile", () => {
    const profiles = resolveHarnessCapabilityProfiles([
      {
        id: "read_discover",
        title: "Read Discover",
        description: "discover",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["read"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      {
        id: "read_open",
        title: "Read Open",
        description: "open",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["read"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
    ]);

    expect(profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workspace_lookup",
          preferredToolId: "read_open",
          supportingToolIds: ["read_discover", "read_open"],
        }),
      ]),
    );
  });

  it("exposes action profile metadata for terminal and edit capability groups", () => {
    const profiles = resolveHarnessCapabilityProfiles([
      {
        id: "terminal_session",
        title: "Terminal Session",
        description: "terminal",
        domain: "terminal",
        source: "internal",
        mode: "stream",
        inputSchema: {},
        tags: ["terminal"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
        },
      },
      {
        id: "write_file",
        title: "Write File",
        description: "write",
        domain: "edit",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["edit"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
        },
      },
      {
        id: "replace_block",
        title: "Replace Block",
        description: "replace",
        domain: "edit",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["edit"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
        },
      },
    ]);

    expect(profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "terminal_execution",
          preferredToolId: "terminal_session",
          actionProfileId: "terminal_execute_command",
        }),
        expect.objectContaining({
          id: "workspace_edit",
          preferredToolId: "write_file",
          actionProfileId: "edit_create_file",
        }),
      ]),
    );
  });

  it("keeps unknown tools as one-to-one fallback profiles", () => {
    const profiles = resolveHarnessCapabilityProfiles([
      {
        id: "custom_internal_tool",
        title: "Custom Internal Tool",
        description: "custom",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["custom"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
    ]);

    expect(profiles).toEqual([
      expect.objectContaining({
        id: "custom_internal_tool",
        preferredToolId: "custom_internal_tool",
        supportingToolIds: ["custom_internal_tool"],
      }),
    ]);
  });

  it("maps web, local news, and mail research to distinct governed tools", () => {
    const profiles = resolveHarnessCapabilityProfiles([
      {
        id: "web_search",
        title: "Web Search",
        description: "public web search",
        domain: "web_search",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["search", "web"],
        capabilities: { sideEffect: "network", requiresApproval: false },
      },
      {
        id: "news_search",
        title: "News Search",
        description: "local news search",
        domain: "web_search",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["news", "local-news"],
        capabilities: { sideEffect: "none", requiresApproval: false },
      },
      {
        id: "mail_query",
        title: "Mail Query",
        description: "mail",
        domain: "mail",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["mail"],
        capabilities: { sideEffect: "network", requiresApproval: false },
      },
    ]);

    expect(profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "web_research", preferredToolId: "web_search" }),
        expect.objectContaining({ id: "news_research", preferredToolId: "news_search" }),
        expect.objectContaining({ id: "mail_reading", preferredToolId: "mail_query" }),
      ]),
    );
  });

  it("keeps Attached Browser and managed Playwright Computer Use as isolated profiles", () => {
    const profiles = resolveHarnessCapabilityProfiles([
      createDefinition("browser_observe"),
      createDefinition("browser_act"),
      createDefinition("browser_assert"),
      createDefinition("browser_attached_look"),
      createDefinition("browser_attached_browse"),
      createDefinition("browser_attached_act"),
      createDefinition("browser_attached_transfer"),
    ]);

    const computerUse = profiles.find(
      (profile) => profile.id === "browser_computer_use",
    );
    const attached = profiles.find(
      (profile) => profile.id === "browser_attached",
    );

    expect(computerUse).toEqual(
      expect.objectContaining({
        preferredToolId: "browser_observe",
        supportingToolIds: ["browser_observe", "browser_act", "browser_assert"],
        workbench: {
          label: "智控",
          description: expect.any(String),
          order: 50,
          icon: "mouse-pointer",
        },
      }),
    );
    expect(computerUse?.description).toMatch(/isolated Playwright.*Mira-managed/i);
    expect(computerUse?.tags).toEqual(
      expect.arrayContaining(["managed-browser", "isolated-session", "playwright"]),
    );

    expect(attached).toEqual(
      expect.objectContaining({
        id: "browser_attached",
        title: "Attached Browser",
        domain: "browser_action",
        source: "internal",
        preferredToolId: "browser_attached_look",
        supportingToolIds: [
          "browser_attached_look",
          "browser_attached_browse",
          "browser_attached_act",
          "browser_attached_transfer",
        ],
        workbench: {
          label: "触界",
          description: expect.any(String),
          order: 60,
          icon: "globe",
        },
      }),
    );
    expect(attached?.tags).toEqual(
      expect.arrayContaining([
        "attached-browser",
        "current-browser",
        "authenticated-session",
        "当前浏览器",
        "已登录",
      ]),
    );
    expect(attached?.supportingToolIds).not.toEqual(
      expect.arrayContaining(["browser_observe", "browser_act", "browser_assert"]),
    );
    expect(computerUse?.supportingToolIds).not.toEqual(
      expect.arrayContaining(["browser_attached_look"]),
    );
  });
});
