import { describe, expect, it } from "vitest";
import type { ExternalMcpServerRecord } from "@/shared/api/tools";
import {
  buildExternalMcpCapabilityAcceptanceCases,
  buildCapabilityAcceptanceCases,
  nativeCapabilityAcceptanceCases,
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

describe("Capability acceptance cases", () => {
  it("registers the platform baseline plus Universal Read acceptance cases", () => {
    expect(nativeCapabilityAcceptanceCases.map((caseDefinition) => caseDefinition.id)).toEqual([
      "core-read-success",
      "universal-read-range",
      "universal-read-image",
      "universal-read-svg",
      "universal-read-binary",
      "universal-list-direct",
      "universal-glob-match",
      "universal-glob-no-match",
      "universal-grep-match",
      "universal-grep-no-match",
      "core-read-controlled-failure",
      "core-approval-boundary",
    ]);

    expect(
      nativeCapabilityAcceptanceCases.find((item) => item.id === "core-read-success"),
    ).toMatchObject({
      args: {
        path: ".tool-lab-fixtures/platform-read-success/input.txt",
      },
      workspace: "managed",
      fixture: "platform-read-success",
    });

    expect(
      nativeCapabilityAcceptanceCases.find((item) => item.id === "universal-read-range"),
    ).toMatchObject({
      toolId: "read",
      args: {
        path: ".tool-lab-fixtures/universal-read/text/notes.txt",
        offset: 1,
        limit: 2,
      },
      workspace: "managed",
      fixture: "universal-read",
    });

    expect(
      nativeCapabilityAcceptanceCases.find((item) => item.id === "universal-read-image"),
    ).toMatchObject({
      toolId: "read",
      args: {
        path: ".tool-lab-fixtures/universal-read/image/pixel.png",
      },
      fixture: "universal-read",
    });

    expect(
      nativeCapabilityAcceptanceCases.find((item) => item.id === "universal-list-direct"),
    ).toMatchObject({
      toolId: "list",
      args: {
        path: ".tool-lab-fixtures/universal-read/tree",
        limit: 20,
      },
      fixture: "universal-read",
    });

    expect(
      nativeCapabilityAcceptanceCases.find((item) => item.id === "universal-glob-match"),
    ).toMatchObject({
      toolId: "glob",
      args: {
        pattern: "**/*.ts",
        path: ".tool-lab-fixtures/universal-read/tree",
        limit: 20,
      },
      fixture: "universal-read",
    });

    expect(
      nativeCapabilityAcceptanceCases.find((item) => item.id === "universal-grep-match"),
    ).toMatchObject({
      toolId: "grep",
      args: expect.objectContaining({
        pattern: "MIRA_NEEDLE",
        path: ".tool-lab-fixtures/universal-read/tree",
        include: "**/*.ts",
        literal: true,
        context: 1,
      }),
      fixture: "universal-read",
    });

    expect(
      nativeCapabilityAcceptanceCases.find((item) => item.id === "core-read-controlled-failure"),
    ).toMatchObject({
      args: {
        path: ".tool-lab-fixtures/platform-read-missing/missing.txt",
      },
      workspace: "managed",
      fixture: "platform-read-missing",
    });

    expect(
      nativeCapabilityAcceptanceCases.find((item) => item.id === "core-approval-boundary"),
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
    const cases = buildExternalMcpCapabilityAcceptanceCases([createServer()]);

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      toolId: "mcp:server-1:tool:ping",
      args: {},
      group: "External MCP",
      workspace: "none",
    });
  });

  it("keeps explicit Capability cases independent from the Agent exposure switch", () => {
    const cases = buildExternalMcpCapabilityAcceptanceCases([
      createServer({ agentEnabled: false }),
    ]);

    expect(cases[0]?.expectedObservation).toContain("Awaiting Approval");
  });

  it("combines native and eligible External MCP cases without custom UI contracts", () => {
    const cases = buildCapabilityAcceptanceCases([createServer()]);

    expect(cases).toHaveLength(nativeCapabilityAcceptanceCases.length + 1);
    expect(cases.some((item) => item.toolId === "mcp:server-1:tool:ping")).toBe(true);
  });
});
