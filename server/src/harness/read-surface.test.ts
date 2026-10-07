import { afterEach, describe, expect, it } from "vitest";
import {
  clearHarnessRegistry,
  listToolDefinitions,
} from "./registry.js";
import {
  initializeHarnessRuntime,
  resetHarnessRuntime,
} from "./runtime.js";
import { grepTool } from "../mcp/tools/grep.tool.js";
import { globTool } from "../mcp/tools/glob.tool.js";
import { listTool } from "../mcp/tools/list.tool.js";
import { readTool } from "../mcp/tools/read.tool.js";

describe("public read tool surface", () => {
  afterEach(() => {
    resetHarnessRuntime();
    clearHarnessRegistry();
  });

  it("registers canonical read primitives without executable legacy readers", () => {
    resetHarnessRuntime();
    clearHarnessRegistry();
    initializeHarnessRuntime();

    const readToolIds = listToolDefinitions()
      .filter((definition) => definition.domain === "read")
      .map((definition) => definition.id);

    expect(readToolIds).toEqual(
      expect.arrayContaining(["glob", "grep", "list", "read"]),
    );
    for (const legacyId of [
      "read_discover",
      "read_open",
      "read_list",
      "read_locate",
      "read_extract",
      "read_slice",
    ]) {
      expect(readToolIds).not.toContain(legacyId);
    }
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
