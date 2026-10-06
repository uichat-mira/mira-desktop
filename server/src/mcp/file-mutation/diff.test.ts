import { describe, expect, it } from "vitest";
import {
  createMutationDiff,
  MAX_MUTATION_DIFF_CHARS,
  MAX_MUTATION_DIFF_SOURCE_BYTES,
} from "./diff.js";

describe("file mutation diff evidence", () => {
  it("creates a unified diff for a bounded content mutation", async () => {
    const result = await createMutationDiff({
      oldPath: "notes.txt",
      newPath: "notes.txt",
      beforeText: "alpha\nbeta\n",
      afterText: "alpha\ngamma\n",
    });

    expect(result.diffUnavailableReason).toBeUndefined();
    expect(result.diffTruncated).toBe(false);
    expect(result.diff).toContain("--- notes.txt");
    expect(result.diff).toContain("+++ notes.txt");
    expect(result.diff).toContain("-beta");
    expect(result.diff).toContain("+gamma");
  });

  it("skips diff work when the source exceeds the evidence budget", async () => {
    const result = await createMutationDiff({
      oldPath: "large.txt",
      newPath: "large.txt",
      beforeText: "",
      afterText: "x".repeat(MAX_MUTATION_DIFF_SOURCE_BYTES + 1),
    });

    expect(result).toEqual({
      diffTruncated: false,
      diffUnavailableReason: "source_too_large",
    });
  });

  it("bounds a large generated patch without changing mutation success semantics", async () => {
    const beforeText = `${"a".repeat(40_000)}\n`;
    const afterText = `${"b".repeat(40_000)}\n`;

    const result = await createMutationDiff({
      oldPath: "large-line.txt",
      newPath: "large-line.txt",
      beforeText,
      afterText,
    });

    expect(result.diffUnavailableReason).toBeUndefined();
    expect(result.diffTruncated).toBe(true);
    expect(result.diff?.length).toBeGreaterThan(MAX_MUTATION_DIFF_CHARS);
    expect(result.diff).toContain("... [diff truncated]");
  });
});
