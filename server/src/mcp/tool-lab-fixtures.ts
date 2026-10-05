import fs from "node:fs";
import path from "node:path";
import { mcpBadRequest } from "./core/errors.js";
import {
  getManagedToolLabWorkspaceSelection,
  type ToolLabWorkspaceSelection,
} from "./tool-lab-workspace.js";

const FIXTURE_ROOT_DIR = ".tool-lab-fixtures";
const SAFE_FIXTURE_ID = /^[A-Za-z0-9_-]+$/;

export type ToolLabFixtureResetContext = {
  workspaceRoot: string;
  fixtureRoot: string;
};

export type ToolLabFixtureDefinition = {
  id: string;
  reset: (
    context: ToolLabFixtureResetContext,
  ) => void | Promise<void>;
};

export type ToolLabFixtureResetResult = {
  fixtureId: string;
  workspace: ToolLabWorkspaceSelection;
  fixtureRoot: string;
  resetAt: string;
};

const resetFixtureDirectory = (workspaceRoot: string, fixtureId: string) => {
  if (!SAFE_FIXTURE_ID.test(fixtureId)) {
    throw mcpBadRequest("Tool Lab fixture id is invalid");
  }

  const base = path.join(workspaceRoot, FIXTURE_ROOT_DIR);
  if (fs.existsSync(base)) {
    const baseStat = fs.lstatSync(base);
    if (baseStat.isSymbolicLink()) {
      throw new Error("Tool Lab fixture base must not be a symbolic link");
    }
    if (!baseStat.isDirectory()) {
      throw new Error("Tool Lab fixture base is not a directory");
    }
  } else {
    fs.mkdirSync(base);
  }

  const realWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  const realBase = fs.realpathSync.native(base);
  const baseRelative = path.relative(realWorkspaceRoot, realBase);
  if (
    !baseRelative ||
    baseRelative.startsWith("..") ||
    path.isAbsolute(baseRelative)
  ) {
    throw new Error("Tool Lab fixture base escapes managed workspace");
  }

  const fixtureRoot = path.join(realBase, fixtureId);
  const relative = path.relative(realWorkspaceRoot, fixtureRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Tool Lab fixture root escapes managed workspace");
  }

  if (fs.existsSync(fixtureRoot)) {
    const stat = fs.lstatSync(fixtureRoot);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(fixtureRoot);
    } else {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }

  fs.mkdirSync(fixtureRoot, { recursive: true });
  return fixtureRoot;
};

const workspaceFixture = (input: {
  id: string;
  files?: Record<string, string | Buffer>;
  directories?: string[];
}): ToolLabFixtureDefinition => ({
  id: input.id,
  reset: ({ fixtureRoot }) => {
    for (const directory of input.directories ?? []) {
      fs.mkdirSync(path.join(fixtureRoot, directory), { recursive: true });
    }

    for (const [relativePath, contents] of Object.entries(input.files ?? {})) {
      const target = path.join(fixtureRoot, relativePath);
      const relative = path.relative(fixtureRoot, target);
      if (
        !relative ||
        relative.startsWith("..") ||
        path.isAbsolute(relative)
      ) {
        throw new Error("Tool Lab fixture file escapes fixture root");
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents, "utf8");
    }
  },
});

const fixtureDefinitions: ToolLabFixtureDefinition[] = [
  workspaceFixture({
    id: "platform-read-success",
    files: {
      "input.txt": [
        "Mira Tool Lab deterministic read fixture.",
        "This file is reset before every case run.",
        "",
      ].join("\n"),
    },
  }),
  workspaceFixture({
    id: "platform-read-missing",
  }),
  workspaceFixture({
    id: "platform-approval-boundary",
  }),
  workspaceFixture({
    id: "universal-read",
    directories: [
      "text",
      "image",
      "binary",
      "tree/nested",
      "tree/ignored",
    ],
    files: {
      "text/notes.txt": [
        "line one",
        "line two",
        "line three",
        "line four",
        "line five",
        "",
      ].join("\n"),
      "image/pixel.png": Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlE7h8AAAAASUVORK5CYII=",
        "base64",
      ),
      "image/icon.svg": [
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">',
        '  <rect width="16" height="16" fill="#000" />',
        "</svg>",
        "",
      ].join("\n"),
      "binary/blob.bin": Buffer.from([0, 255, 1, 254, 2, 253, 3, 252]),
      "tree/alpha.txt": "alpha\n",
      "tree/beta.md": "beta\n",
      "tree/nested/gamma.ts": [
        "export const before = true;",
        'export const marker = "MIRA_NEEDLE";',
        "export const after = true;",
        "",
      ].join("\n"),
      "tree/.gitignore": "ignored/\n",
      "tree/ignored/secret.ts": 'export const hidden = "MIRA_NEEDLE";\n',
    },
  }),
];

const fixtureRegistry = new Map(
  fixtureDefinitions.map((definition) => [definition.id, definition]),
);

export const listToolLabFixtureIds = () => [...fixtureRegistry.keys()];

export const resetToolLabFixture = async (
  fixtureId: string,
): Promise<ToolLabFixtureResetResult> => {
  const definition = fixtureRegistry.get(fixtureId);
  if (!definition) {
    throw mcpBadRequest(`Unknown Tool Lab fixture: ${fixtureId}`);
  }

  const workspace = getManagedToolLabWorkspaceSelection();
  const fixtureRoot = resetFixtureDirectory(workspace.rootPath, fixtureId);

  await definition.reset({
    workspaceRoot: workspace.rootPath,
    fixtureRoot,
  });

  return {
    fixtureId,
    workspace,
    fixtureRoot,
    resetAt: new Date().toISOString(),
  };
};
