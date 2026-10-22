import { describe, expect, it } from "vitest";
import type {
  ExternalMcpServerRecord,
  HarnessToolDefinition,
  ToolInvocation,
} from "@/shared/api/tools";
import type { CapabilityAcceptanceCase } from "./types";
import {
  formatCapabilityDuration,
  isManagedBrowserTool,
  resolveCapabilityReadiness,
  summarizeCapabilityInvocation,
  toExternalCapabilityTools,
  toNativeCapabilityTool,
  resolveToolReadiness,
} from "./utils";

const caseDefinition: CapabilityAcceptanceCase = {
  id: "read",
  toolId: "read",
  title: "Read",
  purpose: "Read a file",
  expectedObservation: "Completed",
  args: { path: "README.md" },
  workspace: "managed",
  group: "Native",
};

const readTool: HarnessToolDefinition = {
  id: "read",
  title: "Read",
  description: "Read a file",
  domain: "read",
  source: "internal",
  mode: "sync",
  inputSchema: {},
  tags: [],
  capabilities: {
    sideEffect: "none",
    requiresApproval: false,
    workspaceBound: true,
  },
};

const invocation = (
  overrides: Partial<ToolInvocation> = {},
): ToolInvocation => ({
  id: "inv-1",
  toolId: "read",
  status: "completed",
  args: {},
  artifacts: [],
  startedAt: "2026-10-05T00:00:00.000Z",
  finishedAt: "2026-10-05T00:00:00.125Z",
  ...overrides,
});

describe("Capability view helpers", () => {
  it("does not mark web search ready when runtime readiness is missing", () => {
    const tool = toNativeCapabilityTool({
      ...readTool,
      id: "web_search",
      title: "Web Search",
      domain: "web_search",
    });

    expect(resolveToolReadiness(tool)).toBe("unavailable");
  });

  it("does not mark Managed Browser ready from a Tool definition alone", () => {
    const tool = toNativeCapabilityTool({
      ...readTool,
      id: "browser_snapshot",
      title: "Browser Snapshot",
      domain: "browser_action",
      workbench: {
        groupId: "browser",
        groupLabel: "智控",
        groupDescription: "Playwright / Managed Browser 浏览器自动化工具。",
        groupOrder: 50,
        icon: "mouse-pointer",
      },
    });

    expect(isManagedBrowserTool(tool)).toBe(true);
    expect(resolveToolReadiness(tool)).toBe("unavailable");
    expect(
      resolveToolReadiness(
        toNativeCapabilityTool({
          ...readTool,
          id: "browser_unprojected",
          domain: "browser_action",
        }),
      ),
    ).toBe("unavailable");

    const readyTool: typeof tool = {
      ...tool,
      runtimeReadiness: {
        state: "ready",
        reason: "Managed browser runtime prerequisites are satisfied.",
      },
    };
    expect(resolveToolReadiness(readyTool)).toBe("ready");

    const unavailableTool: typeof tool = {
      ...tool,
      runtimeReadiness: {
        state: "unavailable",
        reason: "Managed browser runtime is unavailable.",
        code: "browser_runtime_unavailable",
      },
    };
    expect(resolveToolReadiness(unavailableTool)).toBe("unavailable");
  });

  it("keeps 触界 outside Managed Browser ownership", () => {
    const attachedTool = toNativeCapabilityTool({
      ...readTool,
      id: "browser_attached_look",
      title: "Attached Browser Look",
      domain: "browser_action",
      workbench: {
        groupId: "browser_attached",
        groupLabel: "触界",
        groupDescription: "通过 Chrome Extension 操作用户已连接的真实浏览器。",
        groupOrder: 60,
        icon: "globe",
      },
    });

    expect(isManagedBrowserTool(attachedTool)).toBe(false);
    expect(resolveToolReadiness(attachedTool)).toBe("ready");
  });

  it("uses the localized reason when Managed Browser readiness is missing", () => {
    const tool = toNativeCapabilityTool({
      ...readTool,
      id: "browser_snapshot",
      title: "Browser Snapshot",
      domain: "browser_action",
      workbench: {
        groupId: "browser",
        groupLabel: "智控",
        groupDescription: "Playwright / Managed Browser 浏览器自动化工具。",
        groupOrder: 50,
        icon: "mouse-pointer",
      },
    });

    expect(
      resolveCapabilityReadiness({
        caseDefinition: { ...caseDefinition, toolId: "browser_snapshot" },
        tool,
        workspaceRoot: null,
        translate: () => "localized browser readiness reason",
      }),
    ).toMatchObject({
      state: "unavailable",
      reason: "localized browser readiness reason",
    });
    expect(
      resolveCapabilityReadiness({
        caseDefinition: { ...caseDefinition, toolId: "browser_snapshot" },
        tool,
        workspaceRoot: null,
      }).settingsPath,
    ).toBeUndefined();
  });

  it("uses the localized reason when web search readiness is unavailable", () => {
    const tool = toNativeCapabilityTool({
      ...readTool,
      id: "web_search",
      title: "Web Search",
      domain: "web_search",
    });

    expect(
      resolveCapabilityReadiness({
        caseDefinition: { ...caseDefinition, toolId: "web_search" },
        tool,
        workspaceRoot: null,
        translate: () => "localized readiness reason",
      }),
    ).toMatchObject({ reason: "localized readiness reason" });
  });

  it("keeps readiness separate from invocation failure", () => {
    const tool = toNativeCapabilityTool(readTool);

    expect(
      resolveCapabilityReadiness({
        caseDefinition,
        tool,
        workspaceRoot: null,
      }),
    ).toMatchObject({
      state: "unavailable",
      settingsPath: "/settings/tools",
    });

    expect(
      resolveCapabilityReadiness({
        caseDefinition,
        tool,
        workspaceRoot: "/workspace",
      }).state,
    ).toBe("ready");
  });

  it("projects External MCP source identity and unavailable runtime state", () => {
    const server = {
      id: "server-1",
      source: "manual",
      displayName: "Demo MCP",
      transport: { kind: "streamable-http", url: "https://example.com/mcp" },
      status: "configured",
      enabled: true,
      agentEnabled: true,
      createdAt: "2026-10-05T00:00:00.000Z",
      updatedAt: "2026-10-05T00:00:00.000Z",
      discoveredTools: [
        {
          name: "ping",
          title: "Ping",
          description: "Ping",
          inputSchema: { type: "object" },
          projectedCapabilityId: "mcp:server-1:tool:ping",
        },
      ],
    } as ExternalMcpServerRecord;

    const [tool] = toExternalCapabilityTools([server]);

    expect(tool).toMatchObject({
      source: "external",
      sourceInfo: {
        label: "External MCP · Demo MCP",
        settingsPath: "/extensions/connectors",
      },
      runtimeReadiness: {
        state: "unavailable",
      },
    });
  });

  it("does not confuse Agent exposure with explicit Capability runtime readiness", () => {
    const server = {
      id: "server-1",
      source: "manual",
      displayName: "Demo MCP",
      transport: { kind: "streamable-http", url: "https://example.com/mcp" },
      status: "connected",
      enabled: true,
      agentEnabled: false,
      createdAt: "2026-10-05T00:00:00.000Z",
      updatedAt: "2026-10-05T00:00:00.000Z",
      discoveredTools: [
        {
          name: "ping",
          title: "Ping",
          description: "Ping",
          inputSchema: { type: "object" },
          projectedCapabilityId: "mcp:server-1:tool:ping",
        },
      ],
    } as ExternalMcpServerRecord;

    const [tool] = toExternalCapabilityTools([server]);

    expect(tool.runtimeReadiness?.state).toBe("ready");
    expect(tool.agentAccessEnabled).toBe(false);
  });

  it("summarizes approval and structured success without Tool-family shape guessing", () => {
    expect(
      summarizeCapabilityInvocation(
        invocation({
          status: "awaiting_approval",
          approval: {
            required: true,
            reason: "Approval required",
            scope: "workspace.write",
          },
        }),
      ),
    ).toBe("Approval required");

    expect(
      summarizeCapabilityInvocation(
        invocation({
          result: { arbitrary: { future: "shape" } },
        }),
      ),
    ).toBe("执行完成，已返回结构化结果。");

    expect(
      summarizeCapabilityInvocation(
        invocation({
          evidence: {
            actionTaken: "Opened file README.md.",
            facts: ["contentLength=12"],
            status: "completed",
          },
        }),
      ),
    ).toBe("Opened file README.md.");
  });

  it("formats invocation duration from the record timestamps", () => {
    expect(formatCapabilityDuration(invocation())).toBe("125ms");
  });
});
