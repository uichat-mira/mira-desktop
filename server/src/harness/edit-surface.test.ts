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

  it("registers both edit facades while default Agent exposure keeps only primitives", () => {
    initializeHarnessRuntime();

    const registeredEditToolIds = listToolDefinitions()
      .filter((definition) => definition.domain === "edit")
      .map((definition) => definition.id)
      .sort();
    expect(registeredEditToolIds).toEqual([
      "apply_patch",
      "delete",
      "edit",
      "move",
      "write",
    ]);

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
    for (const legacyId of [
      "write_file",
      "replace_block",
      "delete_path",
      "move_path",
      "edit_file",
      "workspace_mutation",
    ]) {
      expect(exposedEditToolIds).not.toContain(legacyId);
    }

    expect(exposedEditToolIds).not.toContain("apply_patch");

    for (const definition of exposedEditDefinitions) {
      const properties = (definition.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect(properties).not.toHaveProperty("operation");
    }
  });

  it("materializes only apply_patch when the patch facade is requested", () => {
    initializeHarnessRuntime();

    const decision = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "apply this code patch",
      editFacade: "apply_patch",
    });
    const exposedEditToolIds = decision.exposedDefinitions
      .filter((definition) => definition.domain === "edit")
      .map((definition) => definition.id);

    expect(exposedEditToolIds).toEqual(["apply_patch"]);
    expect(decision.reason).toContain(
      "Workspace Edit materialized as apply_patch for this exposure.",
    );
  });

  it("keeps both facades visible only on tools_list surfaces", () => {
    initializeHarnessRuntime();

    const decision = resolveHarnessToolExposure({
      source: "tools_list",
    });
    const exposedEditToolIds = decision.exposedDefinitions
      .filter((definition) => definition.domain === "edit")
      .map((definition) => definition.id)
      .sort();

    expect(exposedEditToolIds).toEqual([
      "apply_patch",
      "delete",
      "edit",
      "move",
      "write",
    ]);
  });

  it("keeps neighboring edit-tool choices explicit without narrowing schemas", () => {
    initializeHarnessRuntime();
    const definitions = listToolDefinitions()
      .filter((definition) => definition.domain === "edit");
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));

    expect(byId.get("write")?.description).toMatch(/complete.*edit/i);
    expect(byId.get("edit")?.description).toMatch(/localized.*write/i);
    expect(byId.get("move")?.description).toMatch(/path identity.*write\/edit.*delete/i);
    expect(byId.get("delete")?.description).toMatch(/move.*write\/edit/i);

    expect(byId.get("write")?.inputSchema).toMatchObject({
      required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        overwrite: { type: "boolean" },
      },
    });
    expect(byId.get("edit")?.inputSchema).toMatchObject({
      required: ["path", "edits"],
      properties: {
        path: { type: "string" },
        edits: { type: "array", minItems: 1 },
      },
    });
    expect(byId.get("move")?.inputSchema).toMatchObject({
      required: ["path", "destinationPath"],
      properties: {
        path: { type: "string" },
        destinationPath: { type: "string" },
        overwrite: { type: "boolean" },
      },
    });
    expect(byId.get("delete")?.inputSchema).toMatchObject({
      required: ["path"],
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
      },
    });
  });
});
