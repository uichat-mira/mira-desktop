import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { nodeFileMutationFilesystem } from "./filesystem.js";
import {
  executeDeleteMutation,
  executeEditMutation,
  executeMoveMutation,
  executeWriteMutation,
} from "./runtime.js";

const tempRoot = createTimestampedTestArtifactPath(
  "workspace",
  "file-mutation-runtime-safety",
);
const outsideRoot = createTimestampedTestArtifactPath(
  "workspace",
  "file-mutation-runtime-safety-outside",
);

const resolveExistingPathCaseInsensitively = (targetPath: string) => {
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  const parent = path.dirname(targetPath);
  if (!fs.existsSync(parent)) {
    return targetPath;
  }

  const targetName = path.basename(targetPath).toLowerCase();
  const actualName = fs
    .readdirSync(parent)
    .find((entry) => entry.toLowerCase() === targetName);
  return actualName ? path.join(parent, actualName) : targetPath;
};

describe("file mutation runtime safety", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("serializes concurrent writes and re-evaluates state after the lock", async () => {
    const first = executeWriteMutation({
      path: "race.txt",
      content: "first",
      overwrite: true,
    });
    const second = executeWriteMutation({
      path: "race.txt",
      content: "second",
      overwrite: true,
    });

    await Promise.all([first, second]);

    expect(fs.readFileSync(path.join(tempRoot, "race.txt"), "utf8")).toBe(
      "second",
    );
  });

  it("supports case-only renames without overwrite intent", async () => {
    const source = path.join(tempRoot, "Readme.md");
    fs.writeFileSync(source, "hello", "utf8");

    const caseInsensitiveFilesystem = {
      ...nodeFileMutationFilesystem,
      lstat(targetPath: string) {
        return nodeFileMutationFilesystem.lstat(
          resolveExistingPathCaseInsensitively(targetPath),
        );
      },
      realpath(targetPath: string) {
        return nodeFileMutationFilesystem.realpath(
          resolveExistingPathCaseInsensitively(targetPath),
        );
      },
    };

    const result = await executeMoveMutation(
      {
        path: "Readme.md",
        destinationPath: "README.md",
      },
      { filesystem: caseInsensitiveFilesystem },
    );

    expect(result).toMatchObject({
      operation: "move",
      path: "Readme.md",
      destinationPath: "README.md",
      overwritten: false,
    });
    expect(fs.readdirSync(tempRoot)).toContain("README.md");
    expect(fs.readFileSync(path.join(tempRoot, "README.md"), "utf8")).toBe(
      "hello",
    );

    await expect(
      executeMoveMutation({
        path: "README.md",
        destinationPath: "README.md",
      }),
    ).rejects.toThrow("path and destinationPath must be different");
  });

  it("keeps source and destination when file overwrite move fails", async () => {
    const source = path.join(tempRoot, "source.txt");
    const destination = path.join(tempRoot, "destination.txt");
    fs.writeFileSync(source, "source", "utf8");
    fs.writeFileSync(destination, "destination", "utf8");

    const failingFilesystem = {
      ...nodeFileMutationFilesystem,
      rename(sourcePath: string, destinationPath: string) {
        if (sourcePath === source && destinationPath === destination) {
          const error = new Error("simulated EXDEV");
          (error as NodeJS.ErrnoException).code = "EXDEV";
          throw error;
        }
        nodeFileMutationFilesystem.rename(sourcePath, destinationPath);
      },
    };

    await expect(
      executeMoveMutation(
        {
          path: "source.txt",
          destinationPath: "destination.txt",
          overwrite: true,
        },
        { filesystem: failingFilesystem },
      ),
    ).rejects.toThrow("Failed to move workspace target");

    expect(fs.readFileSync(source, "utf8")).toBe("source");
    expect(fs.readFileSync(destination, "utf8")).toBe("destination");
  });

  it("rolls directory overwrite back when the source rename fails", async () => {
    const source = path.join(tempRoot, "source-dir");
    const destination = path.join(tempRoot, "destination-dir");
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(source, "new.txt"), "new", "utf8");
    fs.writeFileSync(path.join(destination, "old.txt"), "old", "utf8");

    const failingFilesystem = {
      ...nodeFileMutationFilesystem,
      rename(sourcePath: string, destinationPath: string) {
        if (sourcePath === source && destinationPath === destination) {
          throw new Error("simulated directory commit failure");
        }
        nodeFileMutationFilesystem.rename(sourcePath, destinationPath);
      },
    };

    await expect(
      executeMoveMutation(
        {
          path: "source-dir",
          destinationPath: "destination-dir",
          overwrite: true,
        },
        { filesystem: failingFilesystem },
      ),
    ).rejects.toThrow("Failed to move workspace target");

    expect(fs.readFileSync(path.join(source, "new.txt"), "utf8")).toBe("new");
    expect(fs.readFileSync(path.join(destination, "old.txt"), "utf8")).toBe(
      "old",
    );
    expect(
      fs.readdirSync(tempRoot).filter((name) => name.includes(".mira-backup-")),
    ).toEqual([]);
  });

  it("rejects a parent-directory symlink swap before commit", async () => {
    const parent = path.join(tempRoot, "safe");
    const parkedParent = path.join(tempRoot, "safe-original");
    fs.mkdirSync(parent);
    fs.mkdirSync(outsideRoot, { recursive: true });
    let swapped = false;

    const racingFilesystem = {
      ...nodeFileMutationFilesystem,
      mkdir(targetPath: string) {
        nodeFileMutationFilesystem.mkdir(targetPath);
        if (!swapped && targetPath === parent) {
          swapped = true;
          fs.renameSync(parent, parkedParent);
          fs.symlinkSync(outsideRoot, parent, "junction");
        }
      },
    };

    await expect(
      executeWriteMutation(
        {
          path: "safe/escape.txt",
          content: "must stay inside",
        },
        { filesystem: racingFilesystem },
      ),
    ).rejects.toThrow("path must stay inside workspace root");

    expect(fs.existsSync(path.join(outsideRoot, "escape.txt"))).toBe(false);
  });

  it("rejects final symbolic-link targets across all mutation actions", async () => {
    const real = path.join(tempRoot, "real.txt");
    const alias = path.join(tempRoot, "alias.txt");
    fs.writeFileSync(real, "original", "utf8");
    fs.symlinkSync(real, alias, "file");

    await expect(
      executeWriteMutation({
        path: "alias.txt",
        content: "write",
        overwrite: true,
      }),
    ).rejects.toThrow("symbolic-link targets");

    await expect(
      executeEditMutation({
        path: "alias.txt",
        edits: [{ oldText: "original", newText: "edited" }],
      }),
    ).rejects.toThrow("symbolic-link targets");

    await expect(
      executeDeleteMutation({ path: "alias.txt" }),
    ).rejects.toThrow("symbolic-link targets");

    await expect(
      executeMoveMutation({
        path: "alias.txt",
        destinationPath: "moved.txt",
      }),
    ).rejects.toThrow("symbolic-link targets");

    fs.writeFileSync(path.join(tempRoot, "source.txt"), "source", "utf8");
    await expect(
      executeMoveMutation({
        path: "source.txt",
        destinationPath: "alias.txt",
        overwrite: true,
      }),
    ).rejects.toThrow("symbolic-link targets");

    expect(fs.readFileSync(real, "utf8")).toBe("original");
    expect(fs.lstatSync(alias).isSymbolicLink()).toBe(true);
  });

  it("allows an intermediate linked directory only when it resolves inside the workspace", async () => {
    const realDir = path.join(tempRoot, "real-dir");
    const linkedDir = path.join(tempRoot, "linked-dir");
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, linkedDir, "junction");

    await executeWriteMutation({
      path: "linked-dir/nested.txt",
      content: "inside",
    });

    expect(fs.readFileSync(path.join(realDir, "nested.txt"), "utf8")).toBe(
      "inside",
    );
  });

  it("rejects an edit when the file changes after it is read but before commit", async () => {
    const target = path.join(tempRoot, "changing.txt");
    fs.writeFileSync(target, "before", "utf8");
    let mutated = false;

    const racingFilesystem = {
      ...nodeFileMutationFilesystem,
      readFile(targetPath: string) {
        const content = nodeFileMutationFilesystem.readFile(targetPath);
        if (!mutated && targetPath === target) {
          mutated = true;
          fs.writeFileSync(target, "external-change", "utf8");
        }
        return content;
      },
    };

    await expect(
      executeEditMutation(
        {
          path: "changing.txt",
          edits: [{ oldText: "before", newText: "after" }],
        },
        { filesystem: racingFilesystem },
      ),
    ).rejects.toThrow("file changed before mutation commit");

    expect(fs.readFileSync(target, "utf8")).toBe("external-change");
  });
});
