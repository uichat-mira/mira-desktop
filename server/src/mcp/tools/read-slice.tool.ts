import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeReadSlice } from "../read/slice.js";
import { emitArtifacts } from "./artifact-utils.js";

export const readSliceTool: ToolImplementation = {
  definition: {
    id: "read_slice",
    title: "Read Slice",
    description: "Slice extracted text into a requested window.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string" },
        startLine: { type: "number" },
        endLine: { type: "number" },
        maxLines: { type: "number" },
      },
    },
    outputSchema: {
      type: "object",
    },
    tags: ["read", "slice", "workspace"],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
    },
  },
  execute: async (context) => {
    if (typeof context.args.text !== "string" || !context.args.text.trim()) {
      throw mcpBadRequest("text is required");
    }

    const result = await executeReadSlice(context.environment, {
      text: context.args.text,
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
