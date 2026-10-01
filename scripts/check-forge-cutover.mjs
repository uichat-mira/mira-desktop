import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const runtimeRoots = [
  "server/src/forge",
  "desktop/src/features/forge",
  "desktop/src/shared/api/forge",
];

const forbiddenRuntimeMarkers = [
  {
    value: "47831",
    reason: "legacy standalone Forge control-plane port",
  },
  {
    value: "MIRA_FORGE_STATE_FILE",
    reason: "legacy independently-owned Forge state path",
  },
  {
    value: ".mira-forge",
    reason: "legacy standalone Forge data root",
  },
];

const forbiddenNestedFiles = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "vite.config.ts",
  "vite.config.js",
  "index.html",
]);

const failures = [];

function walkFiles(relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) {
    failures.push(`missing Forge runtime root: ${relativeRoot}`);
    return [];
  }

  const files = [];
  const stack = [absoluteRoot];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.isFile()) files.push(absolute);
    }
  }

  return files;
}

for (const relativeRoot of runtimeRoots) {
  for (const absoluteFile of walkFiles(relativeRoot)) {
    const relativeFile = path.relative(root, absoluteFile).replaceAll("\\", "/");
    const basename = path.basename(absoluteFile);

    if (forbiddenNestedFiles.has(basename)) {
      failures.push(
        `${relativeFile}: standalone build/dependency file is forbidden inside integrated Forge`,
      );
      continue;
    }

    const source = fs.readFileSync(absoluteFile, "utf8");
    for (const marker of forbiddenRuntimeMarkers) {
      if (source.includes(marker.value)) {
        failures.push(
          `${relativeFile}: contains ${marker.reason} (${marker.value})`,
        );
      }
    }
  }
}

const packageManifests = [
  "package.json",
  "server/package.json",
  "desktop/package.json",
];

for (const relativeFile of packageManifests) {
  const absoluteFile = path.join(root, relativeFile);
  const manifest = JSON.parse(fs.readFileSync(absoluteFile, "utf8"));
  const dependencySections = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ];

  for (const section of dependencySections) {
    if (!section || typeof section !== "object") continue;
    for (const dependencyName of Object.keys(section)) {
      if (dependencyName.toLowerCase().includes("mira-forge")) {
        failures.push(
          `${relativeFile}: standalone Forge dependency is forbidden (${dependencyName})`,
        );
      }
    }
  }
}

const workspaceFile = path.join(root, "pnpm-workspace.yaml");
if (
  fs.existsSync(workspaceFile) &&
  fs.readFileSync(workspaceFile, "utf8").toLowerCase().includes("mira-forge")
) {
  failures.push(
    "pnpm-workspace.yaml: standalone mira-forge workspace entry is forbidden",
  );
}

const legacyRepoRoot = path.join(root, "mira-forge");
if (fs.existsSync(legacyRepoRoot)) {
  failures.push(
    "mira-forge/: standalone Forge source tree must not be embedded in uichat-mira",
  );
}

const requiredIntegrationFiles = [
  "server/src/forge/runtime/runtime.ts",
  "server/src/forge/routes/index.ts",
  "desktop/src/features/forge/hooks/useForgeWorkspace.ts",
  "desktop/src/shared/api/forge/client.ts",
];

for (const relativeFile of requiredIntegrationFiles) {
  if (!fs.existsSync(path.join(root, relativeFile))) {
    failures.push(`missing integrated Forge entry point: ${relativeFile}`);
  }
}

if (failures.length) {
  console.error("Forge cutover check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  "Forge cutover check passed: integrated runtime roots are present and no standalone Forge package/control-plane markers were found.",
);
