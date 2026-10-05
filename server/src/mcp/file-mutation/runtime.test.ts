import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { clearWorkspaceSelection } from "../workspace.js";
import {
  executeDeleteMutation,
  executeEditMutation,
  executeMoveMutation,
  executeWriteMutation,
} from "./runtime.js";

const tempRoot = createTimestampedTestArtifactPath(
  "workspace",
  "file-mutation-runtime-phase-1",
);

describe("file mutation runtime", () => {
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

  it("creates through write and requires explicit overwrite", async () => {
    const created = await executeWriteMutation({
      path: "nested/note.txt",
      content: "hello",
    });

    expect(created).toMatchObject({
      operation: "write",
      path: "nested/note.txt",
      created: true,
      overwritten: false,
    });
    expect(fs.readFileSync(path.join(tempRoot, "nested/note.txt"), "utf8")).toBe(
      "hello",
    );

    await expect(
      executeWriteMutation({
        path: "nested/note.txt",
        content: "replaced",
      }),
    ).rejects.toThrow("overwrite=true");

    await executeWriteMutation({
      path: "nested/note.txt",
      content: "replaced",
      overwrite: true,
    });
    expect(fs.readFileSync(path.join(tempRoot, "nested/note.txt"), "utf8")).toBe(
      "replaced",
    );
  });

  it("preserves UTF-8 BOM and CRLF style on whole-file overwrite", async () => {
    const target = path.join(tempRoot, "bom-crlf.txt");
    fs.writeFileSync(
      target,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("old\r\nvalue\r\n", "utf8"),
      ]),
    );

    await executeWriteMutation({
      path: "bom-crlf.txt",
      content: "new\nvalue\n",
      overwrite: true,
    });

    const next = fs.readFileSync(target);
    expect(next.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(next.subarray(3).toString("utf8")).toBe("new\r\nvalue\r\n");
  });

  it("does not mis-detect UTF-8 when the format probe ends mid-character", async () => {
    const target = path.join(tempRoot, "probe-boundary.txt");
    const prefix = "a".repeat(64 * 1024 - 1);
    fs.writeFileSync(target, prefix + "😀\\n", "utf8");

    await executeWriteMutation({
      path: "probe-boundary.txt",
      content: "你好\\nMira\\n",
      overwrite: true,
    });

    expect(fs.readFileSync(target, "utf8")).toBe("你好\\nMira\\n");
  });

  it("validates all exact edits before committing", async () => {
    const target = path.join(tempRoot, "edit.txt");
    fs.writeFileSync(target, "alpha\nbeta\ngamma\n", "utf8");

    await executeEditMutation({
      path: "edit.txt",
      edits: [
        { oldText: "alpha", newText: "ALPHA" },
        { oldText: "gamma", newText: "GAMMA" },
      ],
    });
    expect(fs.readFileSync(target, "utf8")).toBe("ALPHA\nbeta\nGAMMA\n");

    await expect(
      executeEditMutation({
        path: "edit.txt",
        edits: [
          { oldText: "ALPHA", newText: "first" },
          { oldText: "missing", newText: "second" },
        ],
      }),
    ).rejects.toThrow("was not found");

    expect(fs.readFileSync(target, "utf8")).toBe("ALPHA\nbeta\nGAMMA\n");
  });

  it("uses finite deterministic tolerance for line endings, whitespace and common Unicode punctuation", async () => {
    const target = path.join(tempRoot, "tolerant.txt");
    fs.writeFileSync(
      target,
      'const label = “Mira”;\r\n\treturn   label;\r\n// Mira\u00a0— stable\r\n',
      "utf8",
    );

    await executeEditMutation({
      path: "tolerant.txt",
      edits: [
        {
          oldText:
            'const label = "Mira";\n  return label;\n// Mira - stable',
          newText:
            'const label = "Mira Next";\nreturn label;\n// Mira - stable',
        },
      ],
    });

    expect(fs.readFileSync(target, "utf8")).toBe(
      'const label = "Mira Next";\r\nreturn label;\r\n// Mira - stable\r\n',
    );
  });

  it("fails tolerant matching when normalization leaves more than one candidate", async () => {
    const target = path.join(tempRoot, "ambiguous.txt");
    fs.writeFileSync(target, "foo   bar\nfoo\tbar\n", "utf8");

    await expect(
      executeEditMutation({
        path: "ambiguous.txt",
        edits: [{ oldText: "foo bar", newText: "changed" }],
      }),
    ).rejects.toThrow("ambiguous");

    expect(fs.readFileSync(target, "utf8")).toBe("foo   bar\nfoo\tbar\n");
  });

  it("treats overlapping duplicate matches as ambiguous", async () => {
    const target = path.join(tempRoot, "overlapping-match.txt");
    fs.writeFileSync(target, "aaa", "utf8");

    await expect(
      executeEditMutation({
        path: "overlapping-match.txt",
        edits: [{ oldText: "aa", newText: "x" }],
      }),
    ).rejects.toThrow("ambiguous");

    expect(fs.readFileSync(target, "utf8")).toBe("aaa");
  });

  it("rejects overlapping edits without mutating the file", async () => {
    const target = path.join(tempRoot, "overlap.txt");
    fs.writeFileSync(target, "abc def ghi", "utf8");

    await expect(
      executeEditMutation({
        path: "overlap.txt",
        edits: [
          { oldText: "abc def", newText: "one" },
          { oldText: "def ghi", newText: "two" },
        ],
      }),
    ).rejects.toThrow("must not overlap");

    expect(fs.readFileSync(target, "utf8")).toBe("abc def ghi");
  });

  it("preserves UTF-16LE BOM and CRLF while editing", async () => {
    const target = path.join(tempRoot, "utf16.txt");
    fs.writeFileSync(
      target,
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        iconv.encode("alpha\r\nbeta\r\n", "utf16-le"),
      ]),
    );

    await executeEditMutation({
      path: "utf16.txt",
      edits: [{ oldText: "beta", newText: "BETA" }],
    });

    const next = fs.readFileSync(target);
    expect(next.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
    expect(iconv.decode(next.subarray(2), "utf16-le")).toBe(
      "alpha\r\nBETA\r\n",
    );
  });

  it("moves normally and replaces an existing destination only with explicit overwrite", async () => {
    fs.writeFileSync(path.join(tempRoot, "source.txt"), "source", "utf8");

    const moved = await executeMoveMutation({
      path: "source.txt",
      destinationPath: "moved.txt",
    });
    expect(moved).toMatchObject({
      operation: "move",
      path: "source.txt",
      destinationPath: "moved.txt",
      overwritten: false,
    });
    expect(fs.existsSync(path.join(tempRoot, "source.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(tempRoot, "moved.txt"), "utf8")).toBe(
      "source",
    );

    fs.writeFileSync(path.join(tempRoot, "other.txt"), "other", "utf8");
    const overwritten = await executeMoveMutation({
      path: "other.txt",
      destinationPath: "moved.txt",
      overwrite: true,
    });
    expect(overwritten).toMatchObject({
      operation: "move",
      path: "other.txt",
      destinationPath: "moved.txt",
      overwritten: true,
    });
    expect(fs.readFileSync(path.join(tempRoot, "moved.txt"), "utf8")).toBe(
      "other",
    );
    expect(fs.existsSync(path.join(tempRoot, "other.txt"))).toBe(false);
  });

  it("deletes files directly and requires recursive intent for non-empty directories", async () => {
    fs.writeFileSync(path.join(tempRoot, "plain.txt"), "delete me", "utf8");
    await executeDeleteMutation({ path: "plain.txt" });
    expect(fs.existsSync(path.join(tempRoot, "plain.txt"))).toBe(false);

    fs.mkdirSync(path.join(tempRoot, "folder"));
    fs.writeFileSync(path.join(tempRoot, "folder/child.txt"), "child", "utf8");

    await expect(
      executeDeleteMutation({ path: "folder" }),
    ).rejects.toThrow("recursive=true");
    expect(fs.existsSync(path.join(tempRoot, "folder/child.txt"))).toBe(true);

    await executeDeleteMutation({ path: "folder", recursive: true });
    expect(fs.existsSync(path.join(tempRoot, "folder"))).toBe(false);
  });
});
