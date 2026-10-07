import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { parseApplyPatch } from "./apply-patch-parser.js";
import { executeApplyPatchMutation } from "./apply-patch-runtime.js";
import { nodeFileMutationFilesystem } from "./filesystem.js";

const tempRoot = createTimestampedTestArtifactPath(
  "workspace",
  "apply-patch-runtime",
);

describe("apply_patch File Mutation Runtime", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("applies add, update+move and delete through the governed mutation runtime", async () => {
    fs.writeFileSync(
      path.join(tempRoot, "old.txt"),
      "function run() {\n  return \"old\";\n}\n",
      "utf8",
    );
    fs.writeFileSync(path.join(tempRoot, "remove.txt"), "bye\n", "utf8");

    const result = await executeApplyPatchMutation(
      parseApplyPatch(`*** Begin Patch
*** Add File: added.txt
+hello
*** Update File: old.txt
*** Move to: renamed.txt
@@ function run() {
-  return "old";
+  return "new";
 }
*** Delete File: remove.txt
*** End Patch`),
    );

    expect(result.status).toBe("completed");
    expect(result.committedDeltaExact).toBe(true);
    expect(fs.readFileSync(path.join(tempRoot, "added.txt"), "utf8")).toBe(
      "hello\n",
    );
    expect(fs.existsSync(path.join(tempRoot, "old.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(tempRoot, "renamed.txt"), "utf8")).toContain(
      'return "new";',
    );
    expect(fs.existsSync(path.join(tempRoot, "remove.txt"))).toBe(false);
  });

  it("updates an empty file with an insertion-only chunk", async () => {
    fs.writeFileSync(path.join(tempRoot, "empty.txt"), "", "utf8");

    const result = await executeApplyPatchMutation(
      parseApplyPatch(`*** Begin Patch
*** Update File: empty.txt
@@
+first
+second
*** End Patch`),
    );

    expect(result.status).toBe("completed");
    expect(fs.readFileSync(path.join(tempRoot, "empty.txt"), "utf8")).toBe(
      "first\nsecond\n",
    );
  });

  it("accepts a context-only update as a successful no-op", async () => {
    fs.writeFileSync(path.join(tempRoot, "same.txt"), "alpha\nbeta\n", "utf8");

    const result = await executeApplyPatchMutation(
      parseApplyPatch(`*** Begin Patch
*** Update File: same.txt
@@
 alpha
 beta
*** End Patch`),
    );

    expect(result).toMatchObject({
      operation: "apply_patch",
      status: "completed",
      changed: false,
      hunkCount: 1,
      committed: [],
      unapplied: [],
      committedDeltaExact: true,
    });
    expect(fs.readFileSync(path.join(tempRoot, "same.txt"), "utf8")).toBe(
      "alpha\nbeta\n",
    );
  });

  it("updates the intended repeated line without ambiguous re-search", async () => {
    fs.writeFileSync(
      path.join(tempRoot, "repeated.txt"),
      "same\nmarker\nsame\n",
      "utf8",
    );

    const result = await executeApplyPatchMutation(
      parseApplyPatch(`*** Begin Patch
*** Update File: repeated.txt
@@ marker
-same
+changed
*** End Patch`),
    );

    expect(result.status).toBe("completed");
    expect(
      fs.readFileSync(path.join(tempRoot, "repeated.txt"), "utf8"),
    ).toBe("same\nmarker\nchanged\n");
  });

  it("appends an unanchored insertion at EOF", async () => {
    fs.writeFileSync(path.join(tempRoot, "append.txt"), "alpha", "utf8");

    const result = await executeApplyPatchMutation(
      parseApplyPatch(`*** Begin Patch
*** Update File: append.txt
@@
+tail
*** End Patch`),
    );

    expect(result.status).toBe("completed");
    expect(fs.readFileSync(path.join(tempRoot, "append.txt"), "utf8")).toBe(
      "alpha\ntail",
    );
  });

  it("prevalidates the whole patch before the first mutation", async () => {
    const parsed = parseApplyPatch(`*** Begin Patch
*** Add File: first.txt
+first
*** Update File: missing.txt
@@
-old
+new
*** End Patch`);

    await expect(executeApplyPatchMutation(parsed)).rejects.toThrow(
      /existing file/,
    );
    expect(fs.existsSync(path.join(tempRoot, "first.txt"))).toBe(false);
  });

  it("reports exact no-change when scratch preparation fails before target commit", async () => {
    const failingFilesystem = {
      ...nodeFileMutationFilesystem,
      async writeAtomic() {
        throw new Error("simulated scratch write failure");
      },
    };

    const result = await executeApplyPatchMutation(
      parseApplyPatch(`*** Begin Patch
*** Add File: first.txt
+first
*** End Patch`),
      { filesystem: failingFilesystem },
    );

    expect(result).toMatchObject({
      status: "failed",
      changed: false,
      committed: [],
      committedDeltaExact: true,
      failed: {
        hunkIndex: 0,
        stage: "add",
        targetCommitAttempted: false,
      },
    });
    expect(fs.existsSync(path.join(tempRoot, "first.txt"))).toBe(false);
  });

  it("reports uncertain changed state after target publish is attempted", async () => {
    const failingFilesystem = {
      ...nodeFileMutationFilesystem,
      link() {
        throw new Error("simulated target publish failure");
      },
    };

    const result = await executeApplyPatchMutation(
      parseApplyPatch(`*** Begin Patch
*** Add File: first.txt
+first
*** End Patch`),
      { filesystem: failingFilesystem },
    );

    expect(result).toMatchObject({
      status: "failed",
      changed: "unknown",
      committed: [],
      committedDeltaExact: false,
      failed: {
        hunkIndex: 0,
        stage: "add",
        targetCommitAttempted: true,
      },
    });
  });

  it("reports an exact committed prefix when the next operation fails pre-commit", async () => {
    const failingFilesystem = {
      ...nodeFileMutationFilesystem,
      async writeAtomic(
        targetPath: string,
        content: Buffer,
        options?: { mode?: number },
      ) {
        if (path.basename(targetPath).startsWith(".second.txt.mira-write-")) {
          throw new Error("simulated second write failure");
        }
        await nodeFileMutationFilesystem.writeAtomic(
          targetPath,
          content,
          options,
        );
      },
    };

    const result = await executeApplyPatchMutation(
      parseApplyPatch(`*** Begin Patch
*** Add File: first.txt
+first
*** Add File: second.txt
+second
*** End Patch`),
      { filesystem: failingFilesystem },
    );

    expect(result).toMatchObject({
      operation: "apply_patch",
      status: "partial",
      changed: true,
      committedDeltaExact: true,
      failed: {
        hunkIndex: 1,
        hunkType: "add",
        path: "second.txt",
        stage: "add",
        targetCommitAttempted: false,
      },
      unapplied: [],
    });
    expect(result.committed).toHaveLength(1);
    expect(fs.readFileSync(path.join(tempRoot, "first.txt"), "utf8")).toBe(
      "first\n",
    );
    expect(fs.existsSync(path.join(tempRoot, "second.txt"))).toBe(false);
  });

  it("rejects canonical path drift between batch preflight and execution", async () => {
    const targetPath = path.join(tempRoot, "stable.txt");
    const alternatePath = path.join(tempRoot, "alternate.txt");
    fs.writeFileSync(targetPath, "old\n", "utf8");
    fs.writeFileSync(alternatePath, "alternate\n", "utf8");

    let targetRealpathCalls = 0;
    const unstableFilesystem = {
      ...nodeFileMutationFilesystem,
      realpath(candidate: string) {
        if (path.resolve(candidate) === path.resolve(targetPath)) {
          targetRealpathCalls += 1;
          return targetRealpathCalls === 1
            ? nodeFileMutationFilesystem.realpath(targetPath)
            : nodeFileMutationFilesystem.realpath(alternatePath);
        }
        return nodeFileMutationFilesystem.realpath(candidate);
      },
    };

    await expect(
      executeApplyPatchMutation(
        parseApplyPatch(`*** Begin Patch
*** Update File: stable.txt
@@
-old
+new
*** End Patch`),
        { filesystem: unstableFilesystem },
      ),
    ).rejects.toThrow(/target changed while waiting for batch lock/);

    expect(fs.readFileSync(targetPath, "utf8")).toBe("old\n");
    expect(fs.readFileSync(alternatePath, "utf8")).toBe("alternate\n");
  });

  it("rejects overlapping resolved path ownership before mutation", async () => {
    fs.writeFileSync(path.join(tempRoot, "same.txt"), "old\n", "utf8");

    await expect(
      executeApplyPatchMutation(
        parseApplyPatch(`*** Begin Patch
*** Update File: same.txt
@@
-old
+new
*** Delete File: same.txt
*** End Patch`),
      ),
    ).rejects.toThrow(/same resolved mutation path/);

    expect(fs.readFileSync(path.join(tempRoot, "same.txt"), "utf8")).toBe(
      "old\n",
    );
  });
});
