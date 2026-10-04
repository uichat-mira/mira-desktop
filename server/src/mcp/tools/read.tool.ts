import type { ToolImplementation } from "../core/definitions.js";
import { readOpenTool } from "./read-open.tool.js";

export const readTool: ToolImplementation = {
  definition: {
    id: "read",
    title: "Read",
    description: "Compatibility alias for read_open.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: readOpenTool.definition.inputSchema,
    outputSchema: readOpenTool.definition.outputSchema,
    tags: ["read", "workspace", "document", "alias"],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path"],
      },
    },
  },
  execute: (context) => readOpenTool.execute(context),
};
