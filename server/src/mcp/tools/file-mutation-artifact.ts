import type {
  ToolArtifact,
  ToolInvocationContext,
} from "../core/definitions.js";
import type {
  DeleteMutationResult,
  EditMutationResult,
  MoveMutationResult,
  WriteMutationResult,
} from "../file-mutation/runtime.js";

export type FileMutationResult =
  | WriteMutationResult
  | EditMutationResult
  | MoveMutationResult
  | DeleteMutationResult;

const mutationMetadata = (result: FileMutationResult) => ({
  operation: result.operation,
  path: result.path,
  changed: result.changed,
  ...("destinationPath" in result
    ? { destinationPath: result.destinationPath }
    : {}),
  ...("created" in result ? { created: result.created } : {}),
  ...("overwritten" in result ? { overwritten: result.overwritten } : {}),
  ...("editsApplied" in result
    ? {
        editsApplied: result.editsApplied,
        tolerantEdits: result.tolerantEdits,
      }
    : {}),
  ...("movedType" in result
    ? {
        movedType: result.movedType,
        ...(result.cleanupIncomplete
          ? {
              cleanupIncomplete: true,
              cleanupBackupPath: result.cleanupBackupPath,
              cleanupError: result.cleanupError,
            }
          : {}),
      }
    : {}),
  ...("deletedType" in result
    ? {
        deletedType: result.deletedType,
        recursive: result.recursive,
      }
    : {}),
  ...("bytesBefore" in result
    ? {
        bytesBefore: result.bytesBefore,
        bytesAfter: result.bytesAfter,
        diffTruncated: result.diffTruncated,
        ...(result.diffUnavailableReason
          ? { diffUnavailableReason: result.diffUnavailableReason }
          : {}),
      }
    : {}),
});

const mutationSummary = (result: FileMutationResult) =>
  JSON.stringify(mutationMetadata(result), null, 2);

const MUTATION_RESULT_DIFF_PREVIEW_CHARS = 4_000;

export const createFileMutationStructuredResult = (
  result: FileMutationResult,
  artifactId: string,
) => {
  if (result.operation === "write" || result.operation === "edit") {
    const { diff, ...rest } = result;
    const diffPreview =
      diff === undefined
        ? undefined
        : diff.length > MUTATION_RESULT_DIFF_PREVIEW_CHARS
          ? `${diff.slice(0, MUTATION_RESULT_DIFF_PREVIEW_CHARS)}\n... [result diff preview truncated]`
          : diff;

    return {
      ...rest,
      artifactId,
      diffAvailable: diff !== undefined,
      ...(diffPreview ? { diffPreview } : {}),
    };
  }

  return {
    ...result,
    artifactId,
    diffAvailable: false,
  };
};

export const emitFileMutationArtifact = (
  context: Pick<ToolInvocationContext, "addArtifact">,
  result: FileMutationResult,
): ToolArtifact => {
  if (
    (result.operation === "write" || result.operation === "edit") &&
    result.diff
  ) {
    return context.addArtifact({
      kind: "diff",
      title: `${result.operation === "write" ? "Write" : "Edit"} ${result.path}`,
      mimeType: "text/x-diff",
      data: result.diff,
      metadata: mutationMetadata(result),
    });
  }

  return context.addArtifact({
    kind: "text",
    title: `File mutation: ${result.operation} ${result.path}`,
    mimeType: "application/json",
    data: mutationSummary(result),
    metadata: mutationMetadata(result),
  });
};
