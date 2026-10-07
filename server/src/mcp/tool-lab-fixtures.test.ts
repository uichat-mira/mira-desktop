import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import {
  listToolLabFixtureIds,
  resetToolLabFixture,
} from "./tool-lab-fixtures.js";
import { ensureManagedToolLabWorkspace } from "./tool-lab-workspace.js";
import {
  clearWorkspaceSelection,
  selectWorkspaceRoot,
} from "./workspace.js";

describe("Tool Lab fixture registry", () => {
  const root = createTimestampedTestArtifactPath(
    "workspace",
    "tool-lab-fixtures",
  );
  const appDataRoot = path.join(root, "app-data");
  const explicitRoot = path.join(root, "explicit");
  const outsideRoot = path.join(root, "outside");

  afterEach(() => {
    clearWorkspaceSelection();
    delete process.env.UI_CHAT_DATABASE_DIR;
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("exposes stable fixture ids for case configuration", () => {
    expect(listToolLabFixtureIds()).toEqual([
      "platform-read-success",
      "platform-read-missing",
      "platform-approval-boundary",
      "universal-read",
      "file-mutation",
    ]);
  });

  it("restores the declared fixture to the same baseline before every run", async () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;

    const first = await resetToolLabFixture("platform-read-success");
    const inputPath = path.join(first.fixtureRoot, "input.txt");
    const junkPath = path.join(first.fixtureRoot, "junk.txt");

    expect(fs.readFileSync(inputPath, "utf8")).toContain(
      "Mira Tool Lab deterministic read fixture.",
    );

    fs.writeFileSync(inputPath, "dirty", "utf8");
    fs.writeFileSync(junkPath, "leftover", "utf8");

    const second = await resetToolLabFixture("platform-read-success");

    expect(second.workspace.source).toBe("managed");
    expect(second.fixtureRoot).toBe(first.fixtureRoot);
    expect(fs.readFileSync(inputPath, "utf8")).toContain(
      "This file is reset before every case run.",
    );
    expect(fs.existsSync(junkPath)).toBe(false);
  });

  it("can define a controlled missing-path condition declaratively", async () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;

    const reset = await resetToolLabFixture("platform-read-missing");

    expect(fs.existsSync(path.join(reset.fixtureRoot, "missing.txt"))).toBe(
      false,
    );
  });

  it("prepares deterministic Universal Read text, image, binary and discovery inputs", async () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;

    const reset = await resetToolLabFixture("universal-read");

    expect(
      fs.readFileSync(path.join(reset.fixtureRoot, "text", "notes.txt"), "utf8"),
    ).toContain("line three");
    expect(
      fs
        .readFileSync(path.join(reset.fixtureRoot, "image", "pixel.png"))
        .subarray(0, 4),
    ).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(
      fs.readFileSync(path.join(reset.fixtureRoot, "image", "icon.svg"), "utf8"),
    ).toContain("<svg");
    expect(
      fs.readFileSync(path.join(reset.fixtureRoot, "binary", "blob.bin")),
    ).toEqual(Buffer.from([0, 255, 1, 254, 2, 253, 3, 252]));
    expect(
      fs.readFileSync(path.join(reset.fixtureRoot, "tree", "nested", "gamma.ts"), "utf8"),
    ).toContain("MIRA_NEEDLE");
  });

  it("restores deterministic File Mutation inputs before every case run", async () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;

    const first = await resetToolLabFixture("file-mutation");
    const overwritePath = path.join(first.fixtureRoot, "overwrite.txt");
    const moveSourcePath = path.join(first.fixtureRoot, "move-source.txt");
    const moveDestinationPath = path.join(first.fixtureRoot, "move-destination.txt");
    const deleteFilePath = path.join(first.fixtureRoot, "delete-file.txt");
    const recursiveDirPath = path.join(first.fixtureRoot, "recursive-dir");
    const controlledDirPath = path.join(first.fixtureRoot, "controlled-dir");
    const createdPath = path.join(first.fixtureRoot, "created.txt");

    expect(fs.readFileSync(overwritePath, "utf8")).toBe("before overwrite\n");
    expect(fs.readFileSync(moveSourcePath, "utf8")).toBe("move me\n");
    expect(fs.existsSync(moveDestinationPath)).toBe(false);
    expect(fs.existsSync(deleteFilePath)).toBe(true);
    expect(
      fs.readFileSync(path.join(recursiveDirPath, "nested.txt"), "utf8"),
    ).toBe("nested delete target\n");
    expect(
      fs.readFileSync(path.join(controlledDirPath, "nested.txt"), "utf8"),
    ).toBe("must survive controlled failure\n");
    expect(
      fs.readFileSync(path.join(first.fixtureRoot, "tolerant.txt"), "utf8"),
    ).toContain("“hello”");

    fs.writeFileSync(overwritePath, "dirty", "utf8");
    fs.renameSync(moveSourcePath, moveDestinationPath);
    fs.rmSync(deleteFilePath);
    fs.rmSync(recursiveDirPath, { recursive: true, force: true });
    fs.rmSync(controlledDirPath, { recursive: true, force: true });
    fs.writeFileSync(createdPath, "leftover", "utf8");

    const second = await resetToolLabFixture("file-mutation");

    expect(second.fixtureRoot).toBe(first.fixtureRoot);
    expect(fs.readFileSync(overwritePath, "utf8")).toBe("before overwrite\n");
    expect(fs.readFileSync(moveSourcePath, "utf8")).toBe("move me\n");
    expect(fs.existsSync(moveDestinationPath)).toBe(false);
    expect(fs.existsSync(deleteFilePath)).toBe(true);
    expect(fs.existsSync(path.join(recursiveDirPath, "nested.txt"))).toBe(true);
    expect(fs.existsSync(path.join(controlledDirPath, "nested.txt"))).toBe(true);
    expect(fs.existsSync(createdPath)).toBe(false);
  });

  it("always prepares fixtures inside managed workspace, never selected user workspace", async () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;
    fs.mkdirSync(explicitRoot, { recursive: true });
    selectWorkspaceRoot(explicitRoot);

    const reset = await resetToolLabFixture("platform-approval-boundary");

    expect(reset.workspace.source).toBe("managed");
    expect(path.relative(reset.workspace.rootPath, reset.fixtureRoot)).toBe(
      path.join(".tool-lab-fixtures", "platform-approval-boundary"),
    );
    expect(fs.readdirSync(explicitRoot)).toEqual([]);
  });

  it("rejects a fixture base replaced by a link outside managed workspace", async () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;
    const workspaceRoot = ensureManagedToolLabWorkspace(appDataRoot);
    const fixtureBase = path.join(workspaceRoot, ".tool-lab-fixtures");

    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.symlinkSync(
      outsideRoot,
      fixtureBase,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(resetToolLabFixture("platform-read-success")).rejects.toThrow(
      "Tool Lab fixture base must not be a symbolic link",
    );
  });

  it("replaces a linked fixture root without touching its target", async () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;
    const initial = await resetToolLabFixture("platform-read-success");
    fs.rmSync(initial.fixtureRoot, { recursive: true, force: true });

    fs.mkdirSync(outsideRoot, { recursive: true });
    const outsideFile = path.join(outsideRoot, "keep.txt");
    fs.writeFileSync(outsideFile, "keep", "utf8");
    fs.symlinkSync(
      outsideRoot,
      initial.fixtureRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    const reset = await resetToolLabFixture("platform-read-success");

    expect(fs.lstatSync(reset.fixtureRoot).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("keep");
    expect(
      fs.readFileSync(path.join(reset.fixtureRoot, "input.txt"), "utf8"),
    ).toContain("Mira Tool Lab deterministic read fixture");
  });

  it("fails closed for an unregistered fixture id", async () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;

    await expect(resetToolLabFixture("not-registered")).rejects.toThrow(
      "Unknown Tool Lab fixture: not-registered",
    );
  });
});
