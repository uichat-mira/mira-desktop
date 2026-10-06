import { afterEach, describe, expect, it } from "vitest";
import { resolveHarnessToolExposure } from "./exposure.js";
import { clearHarnessRegistry, registerTool } from "./registry.js";
import { codebaseExploreTool } from "../mcp/managed-codegraph/codebase-explore.tool.js";
import { grepTool } from "../mcp/tools/grep.tool.js";
import { globTool } from "../mcp/tools/glob.tool.js";
import { listTool } from "../mcp/tools/list.tool.js";
import { readDiscoverTool } from "../mcp/tools/read-discover.tool.js";
import { readExtractTool } from "../mcp/tools/read-extract.tool.js";
import { readListTool } from "../mcp/tools/read-list.tool.js";
import { readLocateTool } from "../mcp/tools/read-locate.tool.js";
import { readOpenTool } from "../mcp/tools/read-open.tool.js";
import { readSliceTool } from "../mcp/tools/read-slice.tool.js";
import { readTool } from "../mcp/tools/read.tool.js";

describe("public read tool surface", () => {
  afterEach(() => {
    clearHarnessRegistry();
  });

  it("exposes canonical read list glob grep while keeping compatibility primitives internal", () => {
    [
      readTool,
      listTool,
      globTool,
      readListTool,
      readLocateTool,
      readExtractTool,
      readSliceTool,
      readDiscoverTool,
      grepTool,
      readOpenTool,
      codebaseExploreTool,
    ].forEach(registerTool);

    const readToolIds = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "inspect the workspace code",
    }).exposedDefinitions
      .filter((definition) => definition.domain === "read")
      .map((definition) => definition.id)
      .sort();

    expect(readToolIds).toEqual(
      ["codebase_explore", "glob", "grep", "list", "read"].sort(),
    );
  });

  it("keeps neighboring read-tool choices explicit without narrowing schemas", () => {
    const definitions = [readTool, listTool, globTool, grepTool].map(
      (tool) => tool.definition,
    );
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));

    expect(byId.get("read")?.description).toMatch(/list.*glob.*grep/i);
    expect(byId.get("list")?.description).toMatch(/glob.*read/i);
    expect(byId.get("glob")?.description).toMatch(/list.*grep/i);
    expect(byId.get("grep")?.description).toMatch(/glob.*read/i);

    expect(byId.get("read")?.inputSchema).toMatchObject({
      required: ["path"],
      properties: {
        path: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
      },
    });
    expect(byId.get("list")?.inputSchema).toMatchObject({
      properties: {
        path: { type: "string" },
        includeIgnored: { type: "boolean" },
      },
    });
    expect(byId.get("glob")?.inputSchema).toMatchObject({
      required: ["pattern"],
      properties: {
        pattern: { type: "string" },
        includeIgnored: { type: "boolean" },
      },
    });
    expect(byId.get("grep")?.inputSchema).toMatchObject({
      required: ["pattern"],
      properties: {
        pattern: { type: "string" },
        literal: { type: "boolean" },
        caseSensitive: { type: "boolean" },
        context: { type: "integer", minimum: 0 },
        includeIgnored: { type: "boolean" },
      },
    });
  });
});
