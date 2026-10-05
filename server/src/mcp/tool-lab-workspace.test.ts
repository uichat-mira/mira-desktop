import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import {
  ensureManagedToolLabWorkspace,
  getToolLabWorkspaceSelection,
} from "./tool-lab-workspace.js";
import {
  clearWorkspaceSelection,
  selectWorkspaceRoot,
} from "./workspace.js";

describe("Tool Lab managed workspace", () => {
  const root = createTimestampedTestArtifactPath(
    "workspace",
    "tool-lab-managed-workspace",
  );
  const appDataRoot = path.join(root, "app-data");
  const explicitRoot = path.join(root, "explicit");
  const outsideRoot = path.join(root, "outside");

  afterEach(() => {
    clearWorkspaceSelection();
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    delete process.env.UI_CHAT_DATABASE_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates a real managed workspace when no active workspace exists", () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;

    const selection = getToolLabWorkspaceSelection();

    expect(selection.source).toBe("managed");
    const realAppDataRoot = fs.realpathSync.native(appDataRoot);
    expect(path.relative(realAppDataRoot, selection.rootPath)).toBe(
      path.join("tool-lab", "workspace"),
    );
    expect(fs.statSync(selection.rootPath).isDirectory()).toBe(true);
    expect(
      fs.readFileSync(path.join(selection.rootPath, "README.md"), "utf8"),
    ).toContain("Mira Tool Lab Workspace");
  });

  it("keeps an explicit workspace authoritative", () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;
    fs.mkdirSync(explicitRoot, { recursive: true });
    selectWorkspaceRoot(explicitRoot);

    expect(getToolLabWorkspaceSelection()).toEqual({
      rootPath: path.resolve(explicitRoot),
      source: "selected",
    });
    expect(fs.existsSync(path.join(appDataRoot, "tool-lab"))).toBe(false);
  });

  it("does not hide an invalid configured workspace behind the fallback", () => {
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;
    process.env.UI_CHAT_WORKSPACE_ROOT = explicitRoot;

    expect(() => getToolLabWorkspaceSelection()).toThrow(
      `workspace path does not exist: ${path.resolve(explicitRoot)}`,
    );
    expect(fs.existsSync(path.join(appDataRoot, "tool-lab"))).toBe(false);
  });

  it("rejects linked managed workspace components", () => {
    fs.mkdirSync(appDataRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });

    fs.symlinkSync(
      outsideRoot,
      path.join(appDataRoot, "tool-lab"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() => ensureManagedToolLabWorkspace(appDataRoot)).toThrow(
      "Tool Lab managed workspace path contains a symbolic link",
    );
  });
});
