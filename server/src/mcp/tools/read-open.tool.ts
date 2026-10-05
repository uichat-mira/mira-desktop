import type { ToolImplementation } from "../core/definitions.js";
import { readTool } from "./read.tool.js";

// Compatibility-only wrapper for persisted/legacy callers. New Agent exposure
// and new code should use the canonical `read` Tool. Remove this wrapper once
// repository and persisted consumers no longer reference `read_open`.
export const readOpenTool: ToolImplementation = {
  definition: {
    ...readTool.definition,
    id: "read_open",
    title: "Read Open (compat)",
    description: "Compatibility wrapper for the canonical read Tool.",
    tags: [...readTool.definition.tags, "compatibility", "alias"],
  },
  execute: (context) => readTool.execute(context),
};
