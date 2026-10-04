import { afterEach, describe, expect, it } from "vitest";
import { resolveHarnessToolExposure } from "./exposure.js";
import { clearHarnessRegistry, registerTool } from "./registry.js";
import { codebaseExploreTool } from "../mcp/managed-codegraph/codebase-explore.tool.js";
import { grepTool } from "../mcp/tools/grep.tool.js";
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

  it("exposes exactly four read actions to the Agent while keeping legacy primitives internal", () => {
    [
      readTool,
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
      ["codebase_explore", "grep", "read_discover", "read_open"].sort(),
    );
  });
});
