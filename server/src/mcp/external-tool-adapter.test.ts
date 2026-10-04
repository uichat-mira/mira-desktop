import { afterEach, describe, expect, it } from "vitest";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import type { ToolDefinition, ToolImplementation } from "./core/definitions.js";
import { evaluateInvocationApproval } from "./core/permissions.js";
import { executeHarnessInvocation } from "../harness/invocations.js";
import { resolveHarnessToolExposure } from "../harness/exposure.js";
import {
  clearHarnessRegistry,
  getToolImplementation,
  listToolDefinitions,
  registerTool,
} from "../harness/registry.js";
import {
  deriveProjectedToolId,
  toExternalMcpToolDefinition,
  toProjectedTool,
} from "./external-tool-adapter.js";

const nativeTool: ToolImplementation = {
  definition: {
    id: "adapter_native_read",
    title: "Adapter native read",
    description: "A protocol-neutral native tool.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: { type: "object", properties: {} },
    tags: ["read"],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
      workspaceBound: true,
      workspaceBoundary: { argKeys: ["path"] },
    },
  },
  execute: () => ({ result: { ok: "native" } }),
};

const projectedTool = toProjectedTool({
  serverId: "docs-server",
  serverDisplayName: "Docs Server",
  remoteToolName: "search_docs",
  title: "Search Docs",
  description: "Search the remote docs corpus.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
  },
});

const externalTool: ToolImplementation = {
  definition: toExternalMcpToolDefinition(projectedTool),
  execute: () => ({ result: { ok: "external" } }),
};

const MCP_SPECIFIC_KEYS = [
  "remoteToolName",
  "projectedCapabilityId",
  "projectedKind",
  "transport",
  "stdioSession",
  "jsonrpc",
  "marketplace",
] as const;

const assertNeutralToolDefinition = (definition: ToolDefinition) => {
  const serialized = JSON.stringify(definition);
  for (const key of MCP_SPECIFIC_KEYS) {
    expect(serialized).not.toContain(key);
  }
};

describe("External MCP neutral Tool adapter boundary", () => {
  afterEach(() => {
    clearHarnessRegistry();
  });

  it("derives the canonical projected tool id and keeps the persisted wire shape", () => {
    expect(deriveProjectedToolId("docs-server", "search_docs")).toBe(
      "mcp:docs-server:tool:search_docs",
    );
    expect(projectedTool.id).toBe("mcp:docs-server:tool:search_docs");
  });

  it("projects MCP protocol records into a neutral ToolDefinition without MCP-specific fields", () => {
    const definition = toExternalMcpToolDefinition(projectedTool);

    expect(definition.id).toBe("mcp:docs-server:tool:search_docs");
    expect(definition.source).toBe("external");
    expect(definition.domain).toBe("external_mcp");
    expect(definition.title).toBe("Search Docs");
    expect(definition.sourceLabel).toBe("Docs Server");
    expect(definition.tags).toContain("mcp");
    expect(definition.tags).toContain("external");
    expect(definition.tags).toContain("docs-server");
    expect(definition.capabilities).toEqual({
      sideEffect: "network",
      requiresApproval: true,
      networkAccess: true,
      longRunning: true,
    });
    assertNeutralToolDefinition(definition);
  });

  it("falls back to a redaction-safe server label instead of carrying server config", () => {
    const withOmittedLabel = toExternalMcpToolDefinition(
      toProjectedTool({
        serverId: "secrets-server",
        serverDisplayName: "secrets-server",
        remoteToolName: "lookup",
        title: "Lookup",
        description: "",
        inputSchema: { type: "object" },
      }),
    );

    expect(withOmittedLabel.description).toBe(
      "MCP capability lookup from secrets-server",
    );
    expect(withOmittedLabel.tags).toEqual([
      "mcp",
      "external",
      "secrets-server",
    ]);
  });

  it("never injects raw remote tool names that contain characters outside a safe tag", () => {
    const definition = toExternalMcpToolDefinition(
      toProjectedTool({
        serverId: "bad server id",
        serverDisplayName: "Bad Server",
        remoteToolName: "x",
        title: "x",
        description: "x",
        inputSchema: { type: "object" },
      }),
    );

    expect(definition.tags).toEqual(["mcp", "external"]);
  });

  it("puts a native tool and an External MCP projected tool in one neutral registry", () => {
    registerTool(nativeTool);
    registerTool(externalTool);

    const ids = listToolDefinitions().map((definition) => definition.id).sort();
    expect(ids).toEqual(
      ["adapter_native_read", "mcp:docs-server:tool:search_docs"].sort(),
    );
    expect(getToolImplementation("adapter_native_read")).toBe(nativeTool);
    expect(getToolImplementation("mcp:docs-server:tool:search_docs")).toBe(
      externalTool,
    );
  });

  it("resolves native and External MCP tools through the same exposure contract", () => {
    registerTool(nativeTool);
    registerTool(externalTool);

    const blocked = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "search docs",
    });
    expect(blocked.exposedToolIds).toContain("adapter_native_read");
    expect(blocked.exposedToolIds).not.toContain(
      "mcp:docs-server:tool:search_docs",
    );
    expect(
      blocked.blockedCapabilityIds,
    ).toContain("mcp:docs-server:tool:search_docs");

    const allowed = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "search docs",
      allowExternal: true,
      allowedExternalToolIds: ["mcp:docs-server:tool:search_docs"],
    });
    expect(allowed.exposedToolIds).toContain("adapter_native_read");
    expect(allowed.exposedToolIds).toContain(
      "mcp:docs-server:tool:search_docs",
    );
  });

  it("governs native and External MCP tools through the same approval decision shape", () => {
    const nativeDecision = evaluateInvocationApproval({
      definition: nativeTool.definition,
      args: {},
    });
    expect(nativeDecision.type).toBe("allow");

    const externalDecision = evaluateInvocationApproval({
      definition: externalTool.definition,
      args: {},
    });
    expect(externalDecision.type).toBe("require_approval");
    expect(externalDecision.scope).toBe("external_mcp");

    const approvedExternal = evaluateInvocationApproval({
      definition: externalTool.definition,
      args: {},
      inputHash: "hash",
      approvedInvocations: [
        { toolId: externalTool.definition.id, inputHash: "hash" },
      ],
    });
    expect(approvedExternal.type).toBe("allow");
  });

  it("runs a native tool and an External MCP projected tool through the same Harness invocation path", async () => {
    registerTool(nativeTool);
    registerTool(externalTool);

    const nativeResult = await executeHarnessInvocation({
      toolId: "adapter_native_read",
      args: {},
    });
    expect(nativeResult.status).toBe("completed");
    expect(nativeResult.result).toEqual({ ok: "native" });

    const externalPending = await executeHarnessInvocation({
      toolId: "mcp:docs-server:tool:search_docs",
      args: {},
    });
    expect(externalPending.status).toBe("awaiting_approval");
    expect(externalPending.toolId).toBe("mcp:docs-server:tool:search_docs");

    const externalApproved = await executeHarnessInvocation({
      toolId: "mcp:docs-server:tool:search_docs",
      args: {},
      approvedInvocations: [
        {
          toolId: "mcp:docs-server:tool:search_docs",
          inputHash: createInvocationInputHash({}),
        },
      ],
    });
    expect(externalApproved.status).toBe("completed");
    expect(externalApproved.result).toEqual({ ok: "external" });
  });
});
