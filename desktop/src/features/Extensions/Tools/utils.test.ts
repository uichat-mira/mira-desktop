import { describe, expect, it } from "vitest";
import type {
  ExternalMcpServerRecord,
  HarnessToolDefinition,
  ToolInvocation,
} from "@/shared/api/tools";
import type { ToolLabCaseDefinition } from "./types";
import {
  formatToolLabDuration,
  resolveToolLabReadiness,
  summarizeToolLabInvocation,
  toExternalToolLabTools,
  toNativeToolLabTool,
} from "./utils";

const caseDefinition: ToolLabCaseDefinition = {
  id: "read",
  toolId: "read",
  title: "Read",
  purpose: "Read a file",
  expectedObservation: "Completed",
  args: { path: "README.md" },
  group: "Core",
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

describe("Tool Lab view helpers", () => {
  it("keeps readiness separate from invocation failure", () => {
    const tool = toNativeToolLabTool(readTool);

    expect(
      resolveToolLabReadiness({
        caseDefinition,
        tool,
        workspaceRoot: null,
      }),
    ).toMatchObject({
      state: "unavailable",
      settingsPath: "/settings/tools",
    });

    expect(
      resolveToolLabReadiness({
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

    const [tool] = toExternalToolLabTools([server]);

    expect(tool).toMatchObject({
      source: "external",
      sourceInfo: {
        label: "External MCP · Demo MCP",
        settingsPath: "/settings/mcp",
      },
      runtimeReadiness: {
        state: "unavailable",
      },
    });
  });

  it("does not confuse Agent exposure with explicit Tool Lab runtime readiness", () => {
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

    const [tool] = toExternalToolLabTools([server]);

    expect(tool.runtimeReadiness?.state).toBe("ready");
    expect(tool.agentAccessEnabled).toBe(false);
  });

  it("summarizes approval and structured success without Tool-family shape guessing", () => {
    expect(
      summarizeToolLabInvocation(
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
      summarizeToolLabInvocation(
        invocation({
          result: { arbitrary: { future: "shape" } },
        }),
      ),
    ).toBe("执行完成，已返回结构化结果。");

    expect(
      summarizeToolLabInvocation(
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
    expect(formatToolLabDuration(invocation())).toBe("125ms");
  });
});
