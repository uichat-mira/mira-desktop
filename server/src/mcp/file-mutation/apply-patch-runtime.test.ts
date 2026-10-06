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

  it("reports a definitely committed prefix and uncertain failed operation", async () => {
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
      committedDeltaExact: false,
      failed: {
        hunkIndex: 1,
        hunkType: "add",
        path: "second.txt",
        stage: "add",
      },
      unapplied: [],
    });
    expect(result.committed).toHaveLength(1);
    expect(fs.readFileSync(path.join(tempRoot, "first.txt"), "utf8")).toBe(
      "first\n",
    );
    expect(fs.existsSync(path.join(tempRoot, "second.txt"))).toBe(false);
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
