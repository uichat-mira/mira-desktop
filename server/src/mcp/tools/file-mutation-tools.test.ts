import { describe, expect, it } from "vitest";
import { applyPatchTool } from "./apply-patch.tool.js";
import { deleteTool } from "./delete.tool.js";
import { editTool } from "./edit.tool.js";
import { moveTool } from "./move.tool.js";
import { writeTool } from "./write.tool.js";

describe("canonical file mutation tool contracts", () => {
  it("keeps the four canonical primitives and one compound facade", () => {
    expect([
      writeTool.definition.id,
      editTool.definition.id,
      moveTool.definition.id,
      deleteTool.definition.id,
    ]).toEqual(["write", "edit", "move", "delete"]);
    expect(applyPatchTool.definition.id).toBe("apply_patch");
  });

  it("keeps every mutation facade approval-bound and workspace-bound", () => {
    for (const tool of [
      writeTool,
      editTool,
      moveTool,
      deleteTool,
      applyPatchTool,
    ]) {
      expect(tool.definition.domain).toBe("edit");
      expect(tool.definition.capabilities).toMatchObject({
        sideEffect: "local-write",
        requiresApproval: true,
        workspaceBound: true,
      });
    }
  });

  it("keeps each model-facing schema small and action-specific", () => {
    expect(Object.keys(writeTool.definition.inputSchema.properties ?? {})).toEqual([
      "path",
      "content",
      "overwrite",
    ]);
    expect(Object.keys(editTool.definition.inputSchema.properties ?? {})).toEqual([
      "path",
      "edits",
    ]);
    expect(Object.keys(moveTool.definition.inputSchema.properties ?? {})).toEqual([
      "path",
      "destinationPath",
      "overwrite",
    ]);
    expect(Object.keys(deleteTool.definition.inputSchema.properties ?? {})).toEqual([
      "path",
      "recursive",
    ]);
    expect(
      Object.keys(applyPatchTool.definition.inputSchema.properties ?? {}),
    ).toEqual(["patchText"]);
  });
});
