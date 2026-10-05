import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { filterGitIgnoredPaths } from "./path-policy.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "read-ignore-policy");

beforeEach(() => {
  fs.mkdirSync(path.join(tempRoot, "ignored"), { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: tempRoot, windowsHide: true });
  fs.writeFileSync(
    path.join(tempRoot, ".gitignore"),
    "ignored/*\n!ignored/keep.txt\n",
    "utf8",
  );
  fs.writeFileSync(path.join(tempRoot, "ignored", "drop.txt"), "drop", "utf8");
  fs.writeFileSync(path.join(tempRoot, "ignored", "keep.txt"), "keep", "utf8");
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("read ignore policy", () => {
  it("delegates gitignore negation to Git instead of hand-parsing it", async () => {
    await expect(
      filterGitIgnoredPaths(
        tempRoot,
        ["ignored/drop.txt", "ignored/keep.txt"],
        false,
      ),
    ).resolves.toEqual(["ignored/keep.txt"]);
  });

  it("lets includeIgnored expose the full candidate set", async () => {
    await expect(
      filterGitIgnoredPaths(
        tempRoot,
        ["ignored/drop.txt", "ignored/keep.txt"],
        true,
      ),
    ).resolves.toEqual(["ignored/drop.txt", "ignored/keep.txt"]);
  });
});
