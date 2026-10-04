import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeReadExtract } from "../read/extract.js";
import { emitArtifacts } from "./artifact-utils.js";

export const readExtractTool: ToolImplementation = {
  definition: {
    id: "read_extract",
    title: "Read Extract",
    description: "Extract readable content from a workspace target.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
        startLine: { type: "number" },
        endLine: { type: "number" },
        maxLines: { type: "number" },
      },
    },
    outputSchema: {
      type: "object",
    },
    tags: ["read", "workspace", "extract"],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path"],
      },
    },
  },
  execute: async (context) => {
    const pathValue = context.args.path;
    if (typeof pathValue !== "string" || !pathValue.trim()) {
      throw mcpBadRequest("path is required");
    }

    const result = await executeReadExtract(context.environment, {
      path: pathValue,
      startLine: typeof context.args.startLine === "number" ? context.args.startLine : undefined,
      endLine: typeof context.args.endLine === "number" ? context.args.endLine : undefined,
      maxLines: typeof context.args.maxLines === "number" ? context.args.maxLines : undefined,
    }, context.pushEvent);

    emitArtifacts(context, result.artifacts);

    return {
      structuredContent: result.contents,
    };
  },
};
