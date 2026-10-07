import fs from "node:fs";
import path from "node:path";
import { resolveAppDataStorageRoot } from "@/utils/app-data-storage-root.js";
import { getWorkspaceRoot, getWorkspaceSelection } from "./workspace.js";

const TOOL_LAB_SEGMENTS = ["tool-lab", "workspace"] as const;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const README_NAME = "README.md";
const README_CONTENT = [
  "# Mira Tool Lab Workspace",
  "",
  "This directory is managed by Mira as a safe fallback workspace for Tool Lab.",
  "It is not a user project and is not the global selected Workspace.",
  "",
].join("\n");

export type ToolLabWorkspaceSelection = {
  rootPath: string;
  source: "selected" | "configured" | "managed";
};

const assertContained = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Tool Lab managed workspace escapes app-data root");
  }
};

const ensureDirectoryComponent = (component: string) => {
  if (!fs.existsSync(component)) {
    fs.mkdirSync(component);
  }

  const stat = fs.lstatSync(component);
  if (stat.isSymbolicLink()) {
    throw new Error("Tool Lab managed workspace path contains a symbolic link");
  }
  if (!stat.isDirectory()) {
    throw new Error("Tool Lab managed workspace path is not a directory");
  }
};

export const ensureManagedToolLabWorkspace = (
  storageRoot = resolveAppDataStorageRoot(),
) => {
  const resolvedStorageRoot = path.resolve(storageRoot);
  fs.mkdirSync(resolvedStorageRoot, { recursive: true });

  const rootStat = fs.statSync(resolvedStorageRoot);
  if (!rootStat.isDirectory()) {
    throw new Error("Tool Lab app-data root is not a directory");
  }

  const realRoot = fs.realpathSync.native(resolvedStorageRoot);
  let current = realRoot;

  for (const segment of TOOL_LAB_SEGMENTS) {
    if (!SAFE_SEGMENT.test(segment)) {
      throw new Error("Tool Lab managed workspace segment is invalid");
    }

    current = path.join(current, segment);
    ensureDirectoryComponent(current);

    const realCurrent = fs.realpathSync.native(current);
    assertContained(realRoot, realCurrent);
    current = realCurrent;
  }

  const readmePath = path.join(current, README_NAME);
  if (fs.existsSync(readmePath)) {
    const readmeStat = fs.lstatSync(readmePath);
    if (readmeStat.isSymbolicLink()) {
      throw new Error("Tool Lab workspace README must not be a symbolic link");
    }
    if (!readmeStat.isFile()) {
      throw new Error("Tool Lab workspace README path is not a file");
    }
  } else {
    fs.writeFileSync(readmePath, README_CONTENT, {
      encoding: "utf8",
      flag: "wx",
    });
  }

  return current;
};

export const getManagedToolLabWorkspaceSelection =
  (): ToolLabWorkspaceSelection => ({
    rootPath: ensureManagedToolLabWorkspace(),
    source: "managed",
  });

export const getToolLabWorkspaceSelection = (): ToolLabWorkspaceSelection => {
  const active = getWorkspaceSelection();
  if (active.rootPath) {
    return {
      rootPath: getWorkspaceRoot(),
      source: active.source === "configured" ? "configured" : "selected",
    };
  }

  return getManagedToolLabWorkspaceSelection();
};
