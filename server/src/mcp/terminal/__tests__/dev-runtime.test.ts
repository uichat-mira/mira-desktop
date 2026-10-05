import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  inspectTerminalDevRuntime,
  resolveTerminalDevRuntimeEnvironment,
} from "../dev-runtime.js";

const tempRoots: string[] = [];

const makeTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mira-terminal-dev-runtime-"));
  tempRoots.push(root);
  return root;
};

const writeExecutable = (root: string, relativePath: string) => {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, "test");
};

const systemExecutableName = (command: string) =>
  process.platform === "win32" ? `${command}.exe` : command;

const writeManifest = (resourcesRoot: string) => {
  const components = {
    node: "node-runtime/node.exe",
    npm: "node-runtime/npm.cmd",
    npx: "node-runtime/npx.cmd",
    git: "terminal-runtime/git/cmd/git.exe",
    uv: "terminal-runtime/bin/uv.exe",
    ripgrep: "terminal-runtime/bin/rg.exe",
  } as const;
  for (const relativePath of Object.values(components)) {
    writeExecutable(resourcesRoot, relativePath);
  }
  const manifestPath = path.join(resourcesRoot, "terminal-runtime", "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    platform: "windows",
    architecture: "x64",
    components: Object.fromEntries(
      Object.entries(components).map(([component, runtimePath]) => [component, {
        component,
        version: "test",
        runtimePath,
        architecture: "x64",
        runtimeSha256: crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(resourcesRoot, runtimePath)))
          .digest("hex"),
      }]),
    ),
    pathOrder: [
      "node-runtime",
      "terminal-runtime/bin",
      "terminal-runtime/git/cmd",
      "system",
    ],
  }));
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Terminal Dev Runtime resolution", () => {
  it("prefers every verified bundled component before the system PATH", () => {
    const resourcesRoot = makeTempRoot();
    writeManifest(resourcesRoot);
    const resolution = inspectTerminalDevRuntime({
      resourcesRoot,
      systemPath: "C:\\Windows\\System32",
    });

    expect(resolution.manifestValid).toBe(true);
    expect(resolution.components.node.source).toBe("bundled");
    expect(resolution.components.git.source).toBe("bundled");
    expect(resolution.components.ripgrep.source).toBe("bundled");
    expect(resolution.pathEntries[0]).toBe(path.join(resourcesRoot, "node-runtime"));
  });

  it("preserves system PATH and reports unavailable components without a manifest", () => {
    const resourcesRoot = makeTempRoot();
    const systemRoot = makeTempRoot();
    writeExecutable(systemRoot, systemExecutableName("git"));
    const resolution = inspectTerminalDevRuntime({
      resourcesRoot,
      systemPath: systemRoot,
    });

    expect(resolution.manifestValid).toBe(false);
    expect(resolution.components.git.source).toBe("system");
    expect(resolution.components.uv.source).toBe("unavailable");
  });

  it("prefixes bundled directories even when a command supplies a PATH override", () => {
    const resourcesRoot = makeTempRoot();
    writeManifest(resourcesRoot);
    const resolved = resolveTerminalDevRuntimeEnvironment({
      UI_CHAT_DESKTOP_RESOURCES_ROOT: resourcesRoot,
      PATH: "C:\\custom-system-bin",
    });

    expect(resolved.PATH.split(path.delimiter)[0]).toBe(
      path.join(resourcesRoot, "node-runtime"),
    );
    expect(resolved.PATH).toContain("C:\\custom-system-bin");
    expect(JSON.parse(resolved.UI_CHAT_TERMINAL_RUNTIME_COMPONENTS).uv).toBe("bundled");
  });

  it("rejects a corrupted bundled executable and reports the system fallback", () => {
    const resourcesRoot = makeTempRoot();
    const systemRoot = makeTempRoot();
    writeManifest(resourcesRoot);
    writeExecutable(systemRoot, systemExecutableName("rg"));
    const manifestPath = path.join(resourcesRoot, "terminal-runtime", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.components.ripgrep.runtimeSha256 = "0".repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const resolution = inspectTerminalDevRuntime({
      resourcesRoot,
      systemPath: systemRoot,
    });
    const resolvedEnv = resolveTerminalDevRuntimeEnvironment({
      UI_CHAT_DESKTOP_RESOURCES_ROOT: resourcesRoot,
      PATH: systemRoot,
    });

    expect(resolution.components.ripgrep.source).toBe("system");
    expect(resolution.components.ripgrep.executablePath).toBe(
      path.join(systemRoot, systemExecutableName("rg")),
    );
    expect(resolvedEnv.PATH).not.toContain(
      path.join(resourcesRoot, "terminal-runtime", "bin"),
    );
  });
});
