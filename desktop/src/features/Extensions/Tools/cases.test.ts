import { describe, expect, it } from "vitest";
import type { ExternalMcpServerRecord } from "@/shared/api/tools";
import {
  buildExternalMcpToolLabCases,
  buildToolLabCases,
  coreToolLabCases,
} from "./cases";

const createServer = (
  overrides: Partial<ExternalMcpServerRecord> = {},
): ExternalMcpServerRecord =>
  ({
    id: "server-1",
    source: "manual",
    displayName: "Demo MCP",
    transport: { kind: "streamable-http", url: "https://example.com/mcp" },
    status: "connected",
    enabled: true,
    agentEnabled: true,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    discoveredTools: [
      {
        name: "ping",
        title: "Ping",
        description: "No input required",
        inputSchema: { type: "object", properties: {} },
        projectedCapabilityId: "mcp:server-1:tool:ping",
      },
      {
        name: "search",
        title: "Search",
        description: "Requires a query",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: { query: { type: "string" } },
        },
        projectedCapabilityId: "mcp:server-1:tool:search",
      },
    ],
    ...overrides,
  }) as ExternalMcpServerRecord;

describe("Tool Lab acceptance cases", () => {
  it("keeps the Phase 2 surface on fixed canonical core cases", () => {
    expect(coreToolLabCases.map((caseDefinition) => caseDefinition.id)).toEqual([
      "core-read-success",
      "core-read-controlled-failure",
      "core-approval-boundary",
    ]);

    expect(
      coreToolLabCases.find((item) => item.id === "core-read-success"),
    ).toMatchObject({
      args: {
        path: ".tool-lab-fixtures/platform-read-success/input.txt",
      },
      workspace: "managed",
      fixture: "platform-read-success",
    });
    expect(
      coreToolLabCases.find((item) => item.id === "core-read-controlled-failure"),
    ).toMatchObject({
      args: {
        path: ".tool-lab-fixtures/platform-read-missing/missing.txt",
      },
      workspace: "managed",
      fixture: "platform-read-missing",
    });
    expect(
      coreToolLabCases.find((item) => item.id === "core-approval-boundary"),
    ).toMatchObject({
      args: expect.objectContaining({
        path: ".tool-lab-fixtures/platform-approval-boundary/approval-probe.txt",
        dryRun: true,
      }),
      workspace: "managed",
      fixture: "platform-approval-boundary",
    });
  });

  it("registers only deterministic zero-input External MCP cases", () => {
    const cases = buildExternalMcpToolLabCases([createServer()]);

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      toolId: "mcp:server-1:tool:ping",
      args: {},
      group: "External MCP",
      workspace: "none",
    });
  });

  it("keeps explicit Tool Lab cases independent from the Agent exposure switch", () => {
    const cases = buildExternalMcpToolLabCases([
      createServer({ agentEnabled: false }),
    ]);

    expect(cases[0]?.expectedObservation).toContain("Awaiting Approval");
  });

  it("combines core and eligible External MCP cases without custom UI contracts", () => {
    const cases = buildToolLabCases([createServer()]);

    expect(cases).toHaveLength(coreToolLabCases.length + 1);
    expect(cases.some((item) => item.toolId === "mcp:server-1:tool:ping")).toBe(true);
  });
});
