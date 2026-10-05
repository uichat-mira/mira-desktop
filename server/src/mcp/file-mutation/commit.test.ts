import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { commitFileBuffer } from "./commit.js";
import { nodeFileMutationFilesystem } from "./filesystem.js";

const tempRoot = createTimestampedTestArtifactPath(
  "workspace",
  "file-mutation-commit",
);

describe("file mutation commit", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("never replaces a create-only target that appeared before publish", async () => {
    const target = path.join(tempRoot, "target.txt");
    fs.writeFileSync(target, "existing", "utf8");

    await expect(
      commitFileBuffer({
        targetPath: target,
        content: Buffer.from("new", "utf8"),
        overwrite: false,
        filesystem: nodeFileMutationFilesystem,
      }),
    ).rejects.toThrow();

    expect(fs.readFileSync(target, "utf8")).toBe("existing");
    expect(
      fs.readdirSync(tempRoot).filter((name) => name.includes(".mira-write-")),
    ).toEqual([]);
  });

  it("keeps the old file when final replacement rename fails", async () => {
    const target = path.join(tempRoot, "target.txt");
    fs.writeFileSync(target, "existing", "utf8");

    const failingFilesystem = {
      ...nodeFileMutationFilesystem,
      rename(sourcePath: string, destinationPath: string) {
        if (
          sourcePath.includes(".mira-write-") &&
          destinationPath === target
        ) {
          const error = new Error("simulated rename failure");
          (error as NodeJS.ErrnoException).code = "EPERM";
          throw error;
        }
        nodeFileMutationFilesystem.rename(sourcePath, destinationPath);
      },
    };

    await expect(
      commitFileBuffer({
        targetPath: target,
        content: Buffer.from("new", "utf8"),
        overwrite: true,
        filesystem: failingFilesystem,
      }),
    ).rejects.toThrow("simulated rename failure");

    expect(fs.readFileSync(target, "utf8")).toBe("existing");
    expect(
      fs.readdirSync(tempRoot).filter((name) => name.includes(".mira-write-")),
    ).toEqual([]);
  });

  it("does not touch the target when atomic scratch writing fails", async () => {
    const target = path.join(tempRoot, "target.txt");
    fs.writeFileSync(target, "existing", "utf8");

    const failingFilesystem = {
      ...nodeFileMutationFilesystem,
      async writeAtomic() {
        throw new Error("simulated scratch write failure");
      },
    };

    await expect(
      commitFileBuffer({
        targetPath: target,
        content: Buffer.from("new", "utf8"),
        overwrite: true,
        filesystem: failingFilesystem,
      }),
    ).rejects.toThrow("simulated scratch write failure");

    expect(fs.readFileSync(target, "utf8")).toBe("existing");
  });
});
