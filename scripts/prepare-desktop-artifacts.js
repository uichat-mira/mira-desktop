import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import loadLocalEnv from "./load-local-env.cjs";
import { stageTerminalDevRuntime } from "./terminal-runtime-staging.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");
loadLocalEnv(projectRoot);
const artifactsRoot = path.join(projectRoot, ".artifacts");
const desktopArtifactsRoot = path.join(artifactsRoot, "desktop", "dist");
const legacyServerArtifactsRoot = path.join(artifactsRoot, "server");
const serverBundleArtifactsRoot = path.join(artifactsRoot, "server-bundle");
const iconsArtifactsRoot = path.join(artifactsRoot, "icons");
const runtimeConfigArtifactsPath = path.join(
  artifactsRoot,
  "runtime.config.cjs",
);
const browserExtensionArtifactsRoot = path.join(artifactsRoot, "browser-extension");
const piperRuntimeArtifactsRoot = path.join(
  artifactsRoot,
  "micro-apps",
  "tts",
  "piper",
);
const electronArtifactsRoot = path.join(artifactsRoot, "electron-app");
const localModelDistRoot = path.join(artifactsRoot, "model-packs", "dist");
const onnxRuntimeWebDistRoot = path.join(
  projectRoot,
  "node_modules",
  "onnxruntime-web",
  "dist",
);
const brandingSourceIconPath = path.join(
  projectRoot,
  "desktop",
  "src",
  "assets",
  "branding",
  "uichat-logo-icon.png",
);
const serverAppMetaPath = path.join(projectRoot, "server", "app-meta.json");
const serverBundleAppMetaPath = path.join(
  serverBundleArtifactsRoot,
  "app-meta.json",
);
const appMetaGeneratorUrl = pathToFileURL(
  path.join(projectRoot, "scripts", "app-meta-generator.js"),
).href;
const testReportGeneratorUrl = pathToFileURL(
  path.join(projectRoot, "scripts", "generate-test-report.js"),
).href;
const iconGeneratorUrl = pathToFileURL(
  path.join(projectRoot, "scripts", "generate-icons.js"),
).href;
const shouldPrepareLocalModels =
  process.env.LOCAL_MODEL_RAW_ROOT?.trim() ||
  process.env.LOCAL_MODEL_ALLOW_NETWORK === "1" ||
  process.env.LOCAL_MODEL_ALLOW_NETWORK === "true" ||
  process.env.CI === "true";
const skipTests =
  process.env.UICHAT_MIRA_SKIP_TESTS === "1" ||
  process.env.UICHAT_MIRA_SKIP_TESTS === "true" ||
  process.argv.includes("--notest");
const isWindowsHost = process.platform === "win32";

function removeDir(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  console.log(`Removed ${label}: ${targetPath}`);
}

function copyPath(sourcePath, destinationPath, label) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing ${label}: ${sourcePath}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const stat = fs.statSync(sourcePath);

  if (stat.isDirectory()) {
    fs.rmSync(destinationPath, { recursive: true, force: true });
    fs.cpSync(sourcePath, destinationPath, { recursive: true });
  } else {
    fs.copyFileSync(sourcePath, destinationPath);
  }

  console.log(`Copied ${label}: ${destinationPath}`);
}

function copyTestResults(sourceDir, destinationDir, label) {
  const filenames = ["test-report.json", "coverage-report.json"];

  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(destinationDir, { recursive: true });

  for (const filename of filenames) {
    const sourcePath = path.join(sourceDir, filename);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing ${label} report file: ${sourcePath}`);
    }
    fs.copyFileSync(sourcePath, path.join(destinationDir, filename));
  }

  console.log(`Copied ${label} test report JSON: ${destinationDir}`);
}

console.log("Preparing shared desktop artifacts...");

if (isWindowsHost) {
  execSync("npm run prod", {
    cwd: path.join(projectRoot, "mira-clipper-ext"),
    stdio: "inherit",
    env: process.env,
  });

  execSync("npm run native:build", {
    cwd: path.join(projectRoot, "mira-clipper-ext"),
    stdio: "inherit",
    env: process.env,
  });
} else {
  console.warn(
    `[desktop-artifacts] Skipping browser extension packaging and Native Messaging host build on ${process.platform}: the CRX signing key is a CI-only secret and the Native Host launcher is Windows-only. Browser Native Messaging is explicitly unavailable on this platform.`,
  );
}

removeDir(legacyServerArtifactsRoot, "legacy staged server bundle");

const { writeAppMetaJsons } = await import(appMetaGeneratorUrl);
const { generateReleaseTestReports } = await import(testReportGeneratorUrl);
const { generateDesktopIcons } = await import(iconGeneratorUrl);

writeAppMetaJsons(projectRoot, [serverAppMetaPath, serverBundleAppMetaPath]);
generateDesktopIcons(projectRoot, brandingSourceIconPath);

if (shouldPrepareLocalModels) {
  execSync("pnpm prepare:local-model-packs", {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  execSync("pnpm archive:local-model-packs", {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
} else {
  console.log(
    "Skipping local model pack preparation because LOCAL_MODEL_RAW_ROOT/LOCAL_MODEL_ALLOW_NETWORK is not set.",
  );
}

let desktopReportPath;
let serverReportPath;

if (skipTests) {
  console.log("Skipping release test report generation because --notest was set.");
} else {
  const reportResult = generateReleaseTestReports();
  desktopReportPath = reportResult.clientReportDir;
  serverReportPath = reportResult.serverReportDir;
}

execSync("pnpm internal:build:desktop", { cwd: projectRoot, stdio: "inherit" });
execSync("pnpm internal:build:server", { cwd: projectRoot, stdio: "inherit" });

if (isWindowsHost) {
  execSync("pnpm prepare:terminal-runtime", { cwd: projectRoot, stdio: "inherit" });
  execSync("node scripts/smoke-staged-server-runtime.mjs", {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  execSync("pnpm prepare:piper-runtime", { cwd: projectRoot, stdio: "inherit" });
} else {
  execSync("pnpm prepare:node-runtime", { cwd: projectRoot, stdio: "inherit" });
  execSync("node scripts/smoke-staged-server-runtime.mjs", {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  console.warn(
    `[desktop-artifacts] Prepared and verified the Node backend runtime for ${process.platform}. Terminal Dev Runtime (git/uv/ripgrep) and Piper remain Windows-only and are explicitly unavailable on this platform.`,
  );
}

if (!fs.existsSync(serverBundleArtifactsRoot)) {
  throw new Error(`Missing server bundle: ${serverBundleArtifactsRoot}`);
}
if (!skipTests) {
  copyTestResults(
    desktopReportPath,
    path.join(serverBundleArtifactsRoot, "client-coverage"),
    "frontend",
  );
  copyTestResults(
    serverReportPath,
    path.join(serverBundleArtifactsRoot, "server-coverage"),
    "server",
  );
}
copyPath(
  path.join(projectRoot, "desktop", "dist"),
  desktopArtifactsRoot,
  "desktop dist",
);
copyPath(path.join(projectRoot, "icons"), iconsArtifactsRoot, "icons");
copyPath(
  path.join(projectRoot, "runtime.config.cjs"),
  runtimeConfigArtifactsPath,
  "runtime config",
);
if (isWindowsHost) {
  copyPath(
    path.join(
      projectRoot,
      "mira-clipper-ext",
      "dist",
      "prod",
      "Chujie.crx",
    ),
    path.join(browserExtensionArtifactsRoot, "Chujie.crx"),
    "production browser extension",
  );
  copyPath(
    path.join(projectRoot, "mira-clipper-ext", "dist", "native", "MiraWebBridgeHost.exe"),
    path.join(browserExtensionArtifactsRoot, "native", "MiraWebBridgeHost.exe"),
    "production Native Messaging host",
  );
  copyPath(
    path.join(projectRoot, "mira-clipper-ext", "dist", "native", "host.mjs"),
    path.join(browserExtensionArtifactsRoot, "native", "host.mjs"),
    "production Native Messaging host script",
  );
} else {
  fs.mkdirSync(browserExtensionArtifactsRoot, { recursive: true });
  console.warn(
    `[desktop-artifacts] Staged an empty browser-extension directory on ${process.platform} so the packaged resource layout stays complete; browser extension and Native Messaging host are explicitly unavailable on this platform.`,
  );
}

removeDir(electronArtifactsRoot, "old staged Electron app");
fs.mkdirSync(electronArtifactsRoot, { recursive: true });
copyPath(
  path.join(projectRoot, "electron", "main.cjs"),
  path.join(electronArtifactsRoot, "main.cjs"),
  "Electron main entry",
);
copyPath(
  path.join(projectRoot, "electron", "preload.cjs"),
  path.join(electronArtifactsRoot, "preload.cjs"),
  "Electron preload entry",
);
copyPath(
  path.join(projectRoot, "electron", "package.json"),
  path.join(electronArtifactsRoot, "package.json"),
  "Electron package manifest",
);
copyPath(
  path.join(projectRoot, "electron-builder.yml"),
  path.join(electronArtifactsRoot, "electron-builder.yml"),
  "electron-builder config",
);
copyPath(
  desktopArtifactsRoot,
  path.join(electronArtifactsRoot, "desktop", "dist"),
  "staged desktop dist",
);
const electronBackendRoot = path.join(electronArtifactsRoot, "backend");
copyPath(
  serverBundleArtifactsRoot,
  electronBackendRoot,
  "staged backend bundle",
);
copyPath(
  runtimeConfigArtifactsPath,
  path.join(electronArtifactsRoot, "runtime.config.cjs"),
  "staged runtime config",
);
copyPath(
  iconsArtifactsRoot,
  path.join(electronArtifactsRoot, "icons"),
  "staged icons",
);
copyPath(
  browserExtensionArtifactsRoot,
  path.join(electronArtifactsRoot, "browser-extension"),
  "staged browser extension",
);
if (isWindowsHost) {
  stageTerminalDevRuntime({
    artifactsRoot,
    destinationRoot: electronArtifactsRoot,
  });
  copyPath(
    piperRuntimeArtifactsRoot,
    path.join(electronArtifactsRoot, "micro-apps", "tts", "piper"),
    "staged Piper runtime",
  );
} else {
  copyPath(
    path.join(artifactsRoot, "node-runtime"),
    path.join(electronArtifactsRoot, "node-runtime"),
    "staged Node backend runtime",
  );
  console.warn(
    `[desktop-artifacts] Staged the Node backend runtime for ${process.platform}; Terminal Dev Runtime and Piper remain unavailable on this platform.`,
  );
}
fs.mkdirSync(path.join(electronArtifactsRoot, "model-packs"), { recursive: true });
fs.mkdirSync(path.join(electronArtifactsRoot, "model-runtime"), { recursive: true });
if (fs.existsSync(localModelDistRoot)) {
  copyPath(
    localModelDistRoot,
    path.join(electronArtifactsRoot, "model-packs"),
    "staged local model packs",
  );
  copyPath(
    onnxRuntimeWebDistRoot,
    path.join(electronArtifactsRoot, "model-runtime", "onnxruntime-web"),
    "staged ONNX Runtime Web files",
  );
} else {
  console.log(
    `Skipping local model resources because no archived model pack was found at: ${localModelDistRoot}`,
  );
}

console.log("Desktop artifacts are ready.");
