import { describe, expect, it } from "vitest";
import { parseApplyPatch } from "./apply-patch-parser.js";

describe("Codex-compatible apply_patch parser", () => {
  it("parses add, update, move and delete hunks", () => {
    const parsed = parseApplyPatch(`*** Begin Patch
*** Add File: src/new.ts
+export const added = true;
*** Update File: src/old.ts
*** Move to: src/renamed.ts
@@ function run()
-  return "old";
+  return "new";
*** Delete File: src/remove.ts
*** End Patch
`);

    expect(parsed.hunks).toEqual([
      {
        type: "add",
        path: "src/new.ts",
        contents: "export const added = true;\n",
      },
      {
        type: "update",
        path: "src/old.ts",
        movePath: "src/renamed.ts",
        chunks: [
          {
            changeContext: "function run()",
            oldLines: ['  return "old";'],
            newLines: ['  return "new";'],
            isEndOfFile: false,
          },
        ],
      },
      {
        type: "delete",
        path: "src/remove.ts",
      },
    ]);
  });

  it("preserves blank added lines and supports EOF anchored chunks", () => {
    const parsed = parseApplyPatch(`*** Begin Patch
*** Update File: note.txt
@@
 line
+
+tail
*** End of File
*** End Patch`);

    expect(parsed.hunks[0]).toEqual({
      type: "update",
      path: "note.txt",
      chunks: [
        {
          oldLines: ["line"],
          newLines: ["line", "", "tail"],
          isEndOfFile: true,
        },
      ],
    });
  });

  it("accepts the optional Codex environment marker", () => {
    const parsed = parseApplyPatch(`*** Begin Patch
*** Environment ID: remote
*** Add File: hello.txt
+hello
*** End Patch`);

    expect(parsed.environmentId).toBe("remote");
  });

  it.each([
    ["missing begin", "*** Add File: a.txt\n+x\n*** End Patch"],
    ["missing end", "*** Begin Patch\n*** Add File: a.txt\n+x"],
    ["empty add", "*** Begin Patch\n*** Add File: a.txt\n*** End Patch"],
    ["empty update", "*** Begin Patch\n*** Update File: a.txt\n*** End Patch"],
    ["malformed add line", "*** Begin Patch\n*** Add File: a.txt\nraw\n*** End Patch"],
    ["malformed update line", "*** Begin Patch\n*** Update File: a.txt\n@@\nraw\n*** End Patch"],
  ])("rejects %s", (_label, patchText) => {
    expect(() => parseApplyPatch(patchText)).toThrow();
  });
});
