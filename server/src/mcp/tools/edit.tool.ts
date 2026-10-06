import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import {
  createFileMutationStructuredResult,
  emitFileMutationArtifact,
} from "./file-mutation-artifact.js";
import { executeEditMutation, type EditMutation } from "../file-mutation/runtime.js";

const parseEdits = (value: unknown): EditMutation[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw mcpBadRequest("edits must contain at least one edit");
  }

  return value.map((edit, index) => {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
      throw mcpBadRequest(`edits[${index}] must be an object`);
    }
    const candidate = edit as Record<string, unknown>;
    if (typeof candidate.oldText !== "string" || typeof candidate.newText !== "string") {
      throw mcpBadRequest(`edits[${index}] requires oldText and newText strings`);
    }
    return {
      oldText: candidate.oldText,
      newText: candidate.newText,
    };
  });
};

export const editTool: ToolImplementation = {
  definition: {
    id: "edit",
    title: "Edit",
    description:
      "Modify an existing file with one or more non-overlapping text edits. All edits must validate before commit.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path", "edits"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["oldText", "newText"],
            additionalProperties: false,
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
          },
        },
      },
    },
    outputSchema: { type: "object" },
    tags: ["workspace", "edit", "file", "text"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path"],
      },
    },
  },
  execute: async (context) => {
    if (typeof context.args.path !== "string") {
      throw mcpBadRequest("path is required");
    }

    const result = await executeEditMutation(
      {
        path: context.args.path,
        edits: parseEdits(context.args.edits),
      },
      {
        signal: context.signal,
        pushEvent: context.pushEvent,
      },
    );
    const artifact = emitFileMutationArtifact(context, result);

    return {
      structuredContent: createFileMutationStructuredResult(
        result,
        artifact.id,
      ),
    };
  },
};
