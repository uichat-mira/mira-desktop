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
      "file-mutation-write-create",
      "file-mutation-write-overwrite",
      "file-mutation-edit-multi",
      "file-mutation-edit-tolerant",
      "file-mutation-edit-missing",
      "file-mutation-edit-ambiguous",
      "file-mutation-move",
      "file-mutation-delete-file",
      "file-mutation-delete-recursive",
      "file-mutation-boundary-rejection",
      "file-mutation-controlled-failure",
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
      toolId: "write",
      args: {
        path: ".tool-lab-fixtures/platform-approval-boundary/approval-probe.txt",
        content: "capabilities-approval-probe",
      },
      workspace: "managed",
      fixture: "platform-approval-boundary",
    });
  });

  it("registers canonical File Mutation cases against one resettable managed fixture", () => {
    const fileMutationCases = nativeCapabilityAcceptanceCases.filter(
      (item) => item.group === "File Mutation",
    );

    expect(fileMutationCases).toHaveLength(11);
    expect(fileMutationCases.every((item) => item.workspace === "managed")).toBe(
      true,
    );
    expect(fileMutationCases.every((item) => item.fixture === "file-mutation")).toBe(
      true,
    );
    expect([...new Set(fileMutationCases.map((item) => item.toolId))].sort()).toEqual([
      "delete",
      "edit",
      "move",
      "write",
    ]);

    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-write-create",
      ),
    ).toMatchObject({
      toolId: "write",
      args: {
        path: ".tool-lab-fixtures/file-mutation/created.txt",
        content: "created by Mira Tool Lab\n",
      },
    });
    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-write-overwrite",
      ),
    ).toMatchObject({
      toolId: "write",
      args: {
        path: ".tool-lab-fixtures/file-mutation/overwrite.txt",
        content: "after overwrite\n",
        overwrite: true,
      },
    });
    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-edit-multi",
      ),
    ).toMatchObject({
      toolId: "edit",
      args: {
        path: ".tool-lab-fixtures/file-mutation/multi-edit.txt",
        edits: [
          { oldText: "alpha target", newText: "alpha changed" },
          { oldText: "omega target", newText: "omega changed" },
        ],
      },
    });
    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-edit-tolerant",
      ),
    ).toMatchObject({
      toolId: "edit",
      args: {
        path: ".tool-lab-fixtures/file-mutation/tolerant.txt",
        edits: [
          {
            oldText: '  const message = "hello";',
            newText: '  const message = "hello from Mira";',
          },
        ],
      },
    });
    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-edit-missing",
      ),
    ).toMatchObject({
      toolId: "edit",
      args: {
        path: ".tool-lab-fixtures/file-mutation/missing-edit.txt",
      },
    });
    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-edit-ambiguous",
      ),
    ).toMatchObject({
      toolId: "edit",
      args: {
        path: ".tool-lab-fixtures/file-mutation/ambiguous-edit.txt",
      },
    });
    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-move",
      ),
    ).toMatchObject({
      toolId: "move",
      args: {
        path: ".tool-lab-fixtures/file-mutation/move-source.txt",
        destinationPath:
          ".tool-lab-fixtures/file-mutation/move-destination.txt",
      },
    });
    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-delete-file",
      ),
    ).toMatchObject({
      toolId: "delete",
      args: {
        path: ".tool-lab-fixtures/file-mutation/delete-file.txt",
      },
    });
    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-delete-recursive",
      ),
    ).toMatchObject({
      toolId: "delete",
      args: {
        path: ".tool-lab-fixtures/file-mutation/recursive-dir",
        recursive: true,
      },
    });
    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-boundary-rejection",
      ),
    ).toMatchObject({
      toolId: "write",
      args: {
        path: "../file-mutation-outside.txt",
        content: "must not escape\n",
      },
    });
    expect(
      nativeCapabilityAcceptanceCases.find(
        (item) => item.id === "file-mutation-controlled-failure",
      ),
    ).toMatchObject({
      toolId: "delete",
      args: {
        path: ".tool-lab-fixtures/file-mutation/controlled-dir",
      },
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
