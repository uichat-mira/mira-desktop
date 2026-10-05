import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveHarnessToolExposure } from "./exposure.js";
import {
  clearHarnessRegistry,
  listToolDefinitions,
} from "./registry.js";
import {
  initializeHarnessRuntime,
  resetHarnessRuntime,
} from "./runtime.js";

describe("public edit tool surface", () => {
  beforeEach(() => {
    resetHarnessRuntime();
    clearHarnessRegistry();
  });

  afterEach(() => {
    resetHarnessRuntime();
    clearHarnessRegistry();
  });

  it("exposes exactly four direct edit actions while keeping legacy wrappers compatibility-only", () => {
    initializeHarnessRuntime();

    const registeredEditToolIds = listToolDefinitions()
      .filter((definition) => definition.domain === "edit")
      .map((definition) => definition.id)
      .sort();
    expect(registeredEditToolIds).toEqual(
      expect.arrayContaining([
        "write",
        "edit",
        "move",
        "delete",
        "write_file",
        "replace_block",
        "delete_path",
        "move_path",
        "edit_file",
        "workspace_mutation",
      ]),
    );

    const decision = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "创建文件，精确修改代码，删除旧目录并重命名文件",
    });
    const exposedEditDefinitions = decision.exposedDefinitions
      .filter((definition) => definition.domain === "edit");
    const exposedEditToolIds = exposedEditDefinitions
      .map((definition) => definition.id)
      .sort();

    expect(exposedEditToolIds).toEqual([
      "delete",
      "edit",
      "move",
      "write",
    ]);
    expect(exposedEditToolIds).not.toEqual(
      expect.arrayContaining([
        "write_file",
        "replace_block",
        "delete_path",
        "move_path",
        "edit_file",
        "workspace_mutation",
      ]),
    );

    for (const definition of exposedEditDefinitions) {
      const properties = (definition.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect(properties).not.toHaveProperty("operation");
    }
  });
});
