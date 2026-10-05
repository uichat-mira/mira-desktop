import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

type RuntimeComponentName = "node" | "npm" | "npx" | "git" | "uv" | "ripgrep";
type RuntimeSource = "bundled" | "system" | "unavailable";

type RuntimeManifestComponent = {
  component: RuntimeComponentName;
  version: string;
  runtimePath: string;
  architecture: string;
  runtimeSha256: string;
};

type RuntimeManifest = {
  version: number;
  platform: string;
  architecture: string;
  components: Record<RuntimeComponentName, RuntimeManifestComponent>;
  pathOrder: string[];
};

export type TerminalDevRuntimeComponentStatus = {
  component: RuntimeComponentName;
  source: RuntimeSource;
  version?: string;
  executablePath?: string;
};

export type TerminalDevRuntimeResolution = {
  resourcesRoot: string | null;
  manifestPath: string | null;
  manifestValid: boolean;
  pathEntries: string[];
  components: Record<RuntimeComponentName, TerminalDevRuntimeComponentStatus>;
};

const componentCommands: Record<RuntimeComponentName, string> = {
  node: "node",
  npm: "npm",
  npx: "npx",
  git: "git",
  uv: "uv",
  ripgrep: "rg",
};

const expectedComponents = Object.keys(componentCommands) as RuntimeComponentName[];
let warnedManifestPath: string | null = null;
const integrityCache = new Map<
  string,
  { mtimeMs: number; size: number; sha256: string }
>();

const hasValidRuntimeIntegrity = (
  executablePath: string,
  expectedSha256: string,
) => {
  try {
    const stat = fs.statSync(executablePath);
    const cached = integrityCache.get(executablePath);
    if (
      cached?.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size &&
      cached.sha256 === expectedSha256
    ) {
      return true;
    }
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(executablePath))
      .digest("hex");
    integrityCache.set(executablePath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      sha256: actual,
    });
    return actual === expectedSha256;
  } catch {
    return false;
  }
};

const resolvePathValue = (env: NodeJS.ProcessEnv | Record<string, string | undefined>) =>
  Object.entries(env).find(([name]) => name.toLowerCase() === "path")?.[1] ?? "";

const executableCandidates = (command: string) => {
  if (path.extname(command)) return [command];
  return process.platform === "win32"
    ? [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command]
    : [command];
};

const findSystemExecutable = (command: string, systemPath: string) => {
  for (const directory of systemPath.split(path.delimiter).filter(Boolean)) {
    for (const candidate of executableCandidates(command)) {
      const executablePath = path.join(directory.replace(/^"|"$/g, ""), candidate);
      if (fs.existsSync(executablePath)) return executablePath;
    }
  }
  return null;
};

const resolveResourcesRoot = (
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  explicitRoot?: string,
) => {
  if (explicitRoot?.trim()) return path.resolve(explicitRoot.trim());
  const configuredRoot = env.UI_CHAT_DESKTOP_RESOURCES_ROOT?.trim();
  if (configuredRoot) return path.resolve(configuredRoot);

  const cwdParent = path.resolve(process.cwd(), "..");
  if (fs.existsSync(path.join(cwdParent, "terminal-runtime", "manifest.json"))) {
    return cwdParent;
  }
  return null;
};

const readManifest = (manifestPath: string): RuntimeManifest | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RuntimeManifest;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.pathOrder) ||
      !parsed.components ||
      expectedComponents.some((name) => {
        const component = parsed.components[name];
        return !component?.runtimePath ||
          !/^[a-f\d]{64}$/i.test(component.runtimeSha256);
      })
    ) {
      throw new Error("manifest schema is incomplete");
    }
    return parsed;
  } catch (error) {
    if (warnedManifestPath !== manifestPath) {
      warnedManifestPath = manifestPath;
      console.warn(
        `Terminal Dev Runtime manifest is unavailable or invalid at ${manifestPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }
};

export const inspectTerminalDevRuntime = (input: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  resourcesRoot?: string;
  systemPath?: string;
} = {}): TerminalDevRuntimeResolution => {
  const env = input.env ?? process.env;
  const systemPath = input.systemPath ?? resolvePathValue(env);
  const resourcesRoot = resolveResourcesRoot(env, input.resourcesRoot);
  const manifestPath = resourcesRoot
    ? path.join(resourcesRoot, "terminal-runtime", "manifest.json")
    : null;
  const manifest = manifestPath && fs.existsSync(manifestPath)
    ? readManifest(manifestPath)
    : null;
  const bundledIntegrity = Object.fromEntries(
    expectedComponents.map((name) => {
      const bundledComponent = manifest?.components[name];
      const bundledPath = bundledComponent && resourcesRoot
        ? path.resolve(resourcesRoot, bundledComponent.runtimePath)
        : null;
      return [
        name,
        Boolean(
          bundledComponent &&
          bundledPath &&
          fs.existsSync(bundledPath) &&
          hasValidRuntimeIntegrity(bundledPath, bundledComponent.runtimeSha256),
        ),
      ];
    }),
  ) as Record<RuntimeComponentName, boolean>;
  const isPathGroupValid = (entry: string) => {
    const normalized = entry.replaceAll("\\", "/").replace(/\/$/, "");
    if (normalized === "node-runtime") {
      return ["node", "npm", "npx"].every(
        (name) => bundledIntegrity[name as RuntimeComponentName],
      );
    }
    if (normalized === "terminal-runtime/bin") {
      return ["uv", "ripgrep"].every(
        (name) => bundledIntegrity[name as RuntimeComponentName],
      );
    }
    if (normalized.startsWith("terminal-runtime/git/")) {
      return bundledIntegrity.git;
    }
    return true;
  };
  const pathEntries = manifest && resourcesRoot
    ? manifest.pathOrder
        .filter((entry) => entry !== "system")
        .filter(isPathGroupValid)
        .map((entry) => path.resolve(resourcesRoot, entry))
        .filter((entry) => fs.existsSync(entry))
    : [];

  const components = Object.fromEntries(
    expectedComponents.map((name) => {
      const bundledComponent = manifest?.components[name];
      const bundledPath = bundledComponent && resourcesRoot
        ? path.resolve(resourcesRoot, bundledComponent.runtimePath)
        : null;
      if (
        bundledComponent &&
        bundledPath &&
        bundledIntegrity[name] &&
        pathEntries.includes(path.dirname(bundledPath))
      ) {
        return [name, {
          component: name,
          source: "bundled",
          version: bundledComponent.version,
          executablePath: bundledPath,
        } satisfies TerminalDevRuntimeComponentStatus];
      }

      const systemPathname = findSystemExecutable(componentCommands[name], systemPath);
      return [name, {
        component: name,
        source: systemPathname ? "system" : "unavailable",
        ...(systemPathname ? { executablePath: systemPathname } : {}),
      } satisfies TerminalDevRuntimeComponentStatus];
    }),
  ) as Record<RuntimeComponentName, TerminalDevRuntimeComponentStatus>;

  return {
    resourcesRoot,
    manifestPath,
    manifestValid: Boolean(manifest),
    pathEntries,
    components,
  };
};

export const resolveTerminalDevRuntimeEnvironment = (
  env: Record<string, string>,
) => {
  const systemPath = resolvePathValue(env);
  const resolution = inspectTerminalDevRuntime({ env, systemPath });
  const mergedPath = [...resolution.pathEntries, systemPath]
    .filter(Boolean)
    .join(path.delimiter);
  const normalizedEnv = Object.fromEntries(
    Object.entries(env).filter(([name]) => name.toLowerCase() !== "path"),
  );

  return {
    ...normalizedEnv,
    PATH: mergedPath,
    UI_CHAT_TERMINAL_RUNTIME_MANIFEST: resolution.manifestPath ?? "",
    UI_CHAT_TERMINAL_RUNTIME_COMPONENTS: JSON.stringify(
      Object.fromEntries(
        Object.entries(resolution.components).map(([name, component]) => [
          name,
          component.source,
        ]),
      ),
    ),
  };
};

export const resolveTerminalRuntimeExecutable = (
  component: RuntimeComponentName,
) => inspectTerminalDevRuntime().components[component];
