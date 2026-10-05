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

  it("never replaces a create-only target that appeared before publish", () => {
    const target = path.join(tempRoot, "target.txt");
    fs.writeFileSync(target, "existing", "utf8");

    expect(() =>
      commitFileBuffer({
        targetPath: target,
        content: Buffer.from("new", "utf8"),
        overwrite: false,
        filesystem: nodeFileMutationFilesystem,
      }),
    ).toThrow();

    expect(fs.readFileSync(target, "utf8")).toBe("existing");
    expect(
      fs.readdirSync(tempRoot).filter((name) => name.includes(".mira-write-")),
    ).toEqual([]);
  });

  it("keeps the old file when atomic replacement rename fails", () => {
    const target = path.join(tempRoot, "target.txt");
    fs.writeFileSync(target, "existing", "utf8");

    const failingFilesystem = {
      ...nodeFileMutationFilesystem,
      rename() {
        const error = new Error("simulated rename failure");
        (error as NodeJS.ErrnoException).code = "EPERM";
        throw error;
      },
    };

    expect(() =>
      commitFileBuffer({
        targetPath: target,
        content: Buffer.from("new", "utf8"),
        overwrite: true,
        filesystem: failingFilesystem,
      }),
    ).toThrow("simulated rename failure");

    expect(fs.readFileSync(target, "utf8")).toBe("existing");
    expect(
      fs.readdirSync(tempRoot).filter((name) => name.includes(".mira-write-")),
    ).toEqual([]);
  });
});
