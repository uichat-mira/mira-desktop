import fs from "node:fs";
import path from "node:path";
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

describe("file mutation runtime phase 1", () => {
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

  it("moves only when the destination does not already exist", async () => {
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
    await expect(
      executeMoveMutation({
        path: "other.txt",
        destinationPath: "moved.txt",
        overwrite: true,
      }),
    ).rejects.toThrow("atomic replacement");
    expect(fs.readFileSync(path.join(tempRoot, "moved.txt"), "utf8")).toBe(
      "source",
    );
    expect(fs.readFileSync(path.join(tempRoot, "other.txt"), "utf8")).toBe(
      "other",
    );
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
