import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { parseApplyPatch } from "../file-mutation/apply-patch-parser.js";
import { executeApplyPatchMutation } from "../file-mutation/apply-patch-runtime.js";
import {
  createFileMutationStructuredResult,
  emitFileMutationArtifact,
} from "./file-mutation-artifact.js";

export const applyPatchTool: ToolImplementation = {
  definition: {
    id: "apply_patch",
    title: "Apply Patch",
    description:
      "Apply a Codex-compatible multi-file patch when patch grammar is the clearest way to express related Add, Update, Move, or Delete operations. Use write/edit/move/delete instead when the primitive facade is disclosed; do not mix both edit facades in one plan.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["patchText"],
      additionalProperties: false,
      properties: {
        patchText: {
          type: "string",
          description:
            "Complete patch from *** Begin Patch through *** End Patch using Codex-compatible Add File, Update File, Move to, and Delete File grammar.",
        },
      },
    },
    outputSchema: { type: "object" },
    tags: ["workspace", "edit", "patch", "apply_patch", "multi-file"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
    },
  },
  execute: async (context) => {
    const patchText = context.args.patchText;
    if (typeof patchText !== "string" || !patchText.trim()) {
      throw mcpBadRequest("patchText is required");
    }

    const parsed = parseApplyPatch(patchText);
    const result = await executeApplyPatchMutation(parsed, {
      signal: context.signal,
      pushEvent: context.pushEvent,
    });

    const committed = result.committed.map((step) => {
      const artifact = emitFileMutationArtifact(context, step.mutation);
      return {
        hunkIndex: step.hunkIndex,
        hunkType: step.hunkType,
        path: step.path,
        ...(step.destinationPath ? { destinationPath: step.destinationPath } : {}),
        mutation: createFileMutationStructuredResult(step.mutation, artifact.id),
      };
    });

    const patchArtifact = context.addArtifact({
      kind: "text",
      title: "Apply patch summary",
      mimeType: "application/json",
      data: JSON.stringify(
        {
          status: result.status,
          hunkCount: result.hunkCount,
          committedMutationCount: committed.length,
          failed: result.failed ?? null,
          unapplied: result.unapplied,
          committedDeltaExact: result.committedDeltaExact,
        },
        null,
        2,
      ),
      metadata: {
        operation: "apply_patch",
        status: result.status,
        hunkCount: result.hunkCount,
        committedMutationCount: committed.length,
        committedDeltaExact: result.committedDeltaExact,
      },
    });

    return {
      structuredContent: {
        operation: "apply_patch",
        status: result.status,
        changed: result.changed,
        hunkCount: result.hunkCount,
        committed,
        ...(result.failed ? { failed: result.failed } : {}),
        unapplied: result.unapplied,
        committedDeltaExact: result.committedDeltaExact,
        artifactId: patchArtifact.id,
      },
      isError: result.status !== "completed",
    };
  },
};
