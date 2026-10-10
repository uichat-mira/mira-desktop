import { describe, expect, it } from "vitest";
import type {
  ExternalMcpServerRecord,
  HarnessToolDefinition,
  ToolInvocation,
} from "@/shared/api/tools";
import type { CapabilityAcceptanceCase } from "./types";
import {
  formatCapabilityDuration,
  resolveCapabilityReadiness,
  summarizeCapabilityInvocation,
  toExternalCapabilityTools,
  toNativeCapabilityTool,
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

  it("projects Server/Harness native readiness without duplicating runtime rules", () => {
    const blocked = toNativeCapabilityTool({
      ...readTool,
      runtimeReadiness: {
        state: "blocked",
        reason: "Web Search requires a configured provider.",
        missingPrerequisites: ["web_search_provider"],
      },
    });
    expect(blocked.runtimeReadiness).toEqual({
      state: "unavailable",
      reason: "Web Search requires a configured provider.",
      settingsPath: "/settings/tools",
    });

    const ready = toNativeCapabilityTool({
      ...readTool,
      runtimeReadiness: { state: "ready", missingPrerequisites: [] },
    });
    expect(ready.runtimeReadiness).toMatchObject({ state: "ready" });
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
        settingsPath: "/settings/mcp",
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
