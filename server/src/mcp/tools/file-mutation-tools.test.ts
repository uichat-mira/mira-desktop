import { describe, expect, it } from "vitest";
import { deleteTool } from "./delete.tool.js";
import { editTool } from "./edit.tool.js";
import { moveTool } from "./move.tool.js";
import { writeTool } from "./write.tool.js";

describe("canonical file mutation tool contracts", () => {
  it("defines the Phase 2 public names without changing legacy tools", () => {
    expect([
      writeTool.definition.id,
      editTool.definition.id,
      moveTool.definition.id,
      deleteTool.definition.id,
    ]).toEqual(["write", "edit", "move", "delete"]);
  });

  it("keeps all four actions approval-bound and workspace-bound", () => {
    for (const tool of [writeTool, editTool, moveTool, deleteTool]) {
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
  });
});
