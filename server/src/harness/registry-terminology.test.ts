import { afterEach, describe, expect, it } from "vitest";
import type { ToolImplementation } from "../mcp/core/definitions.js";
import {
  clearHarnessRegistry,
  getToolImplementation,
  listToolDefinitions,
  registerTool,
  unregisterTool,
} from "./registry.js";

const testTool: ToolImplementation = {
  definition: {
    id: "registry_terminology_test_tool",
    title: "Registry terminology test tool",
    description: "Verifies the Harness Tool Registry facade.",
    domain: "read",
    mode: "sync",
    inputSchema: { type: "object" },
    tags: ["test"],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
    },
  },
  execute: () => ({ result: { ok: true } }),
};

describe("Harness Tool Registry terminology", () => {
  afterEach(() => clearHarnessRegistry());

  it("registers, lists, resolves, and unregisters concrete tools", () => {
    registerTool(testTool);

    expect(listToolDefinitions()).toEqual([testTool.definition]);
    expect(getToolImplementation(testTool.definition.id)).toBe(testTool);

    unregisterTool(testTool.definition.id);

    expect(listToolDefinitions()).toEqual([]);
    expect(getToolImplementation(testTool.definition.id)).toBeUndefined();
  });
});
