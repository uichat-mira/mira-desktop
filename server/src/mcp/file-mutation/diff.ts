import { createTwoFilesPatch } from "diff";

export const MAX_MUTATION_DIFF_SOURCE_BYTES = 512 * 1024;
export const MAX_MUTATION_DIFF_CHARS = 64 * 1024;
const MUTATION_DIFF_TIMEOUT_MS = 250;

export type MutationDiffUnavailableReason =
  | "source_too_large"
  | "source_not_text"
  | "source_unavailable"
  | "diff_budget_exceeded"
  | "diff_failed";

export type MutationDiffResult = {
  diff?: string;
  diffTruncated: boolean;
  diffUnavailableReason?: MutationDiffUnavailableReason;
};

const createPatchAsync = (input: {
  oldPath: string;
  newPath: string;
  beforeText: string;
  afterText: string;
}) =>
  new Promise<string | undefined>((resolve) => {
    createTwoFilesPatch(
      input.oldPath,
      input.newPath,
      input.beforeText,
      input.afterText,
      undefined,
      undefined,
      {
        context: 3,
        timeout: MUTATION_DIFF_TIMEOUT_MS,
        callback: resolve,
      },
    );
  });

export const createMutationDiff = async (input: {
  oldPath: string;
  newPath: string;
  beforeText?: string;
  afterText: string;
  unavailableReason?: MutationDiffUnavailableReason;
}): Promise<MutationDiffResult> => {
  if (input.beforeText === undefined) {
    return {
      diffTruncated: false,
      diffUnavailableReason: input.unavailableReason ?? "source_not_text",
    };
  }

  const sourceBytes =
    Buffer.byteLength(input.beforeText, "utf8") +
    Buffer.byteLength(input.afterText, "utf8");
  if (sourceBytes > MAX_MUTATION_DIFF_SOURCE_BYTES) {
    return {
      diffTruncated: false,
      diffUnavailableReason: "source_too_large",
    };
  }

  try {
    const patch = await createPatchAsync({
      oldPath: input.oldPath,
      newPath: input.newPath,
      beforeText: input.beforeText,
      afterText: input.afterText,
    });
    if (patch === undefined) {
      return {
        diffTruncated: false,
        diffUnavailableReason: "diff_budget_exceeded",
      };
    }

    if (patch.length <= MAX_MUTATION_DIFF_CHARS) {
      return {
        diff: patch,
        diffTruncated: false,
      };
    }

    return {
      diff: `${patch.slice(0, MAX_MUTATION_DIFF_CHARS)}\n... [diff truncated]\n`,
      diffTruncated: true,
    };
  } catch {
    // Evidence generation must never turn an already-committed mutation into
    // a failed tool invocation. The structured result records the gap instead.
    return {
      diffTruncated: false,
      diffUnavailableReason: "diff_failed",
    };
  }
};
