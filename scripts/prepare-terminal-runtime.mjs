import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");
const lockPath = path.join(__dirname, "terminal-runtime.lock.json");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const cacheRoot = process.env.MIRA_TERMINAL_RUNTIME_CACHE_ROOT?.trim()
  ? path.resolve(process.env.MIRA_TERMINAL_RUNTIME_CACHE_ROOT.trim())
  : path.join(projectRoot, ".local-runtimes", "terminal-dev", "windows-x64");
const artifactsRoot = process.env.MIRA_TERMINAL_RUNTIME_ARTIFACTS_ROOT?.trim()
  ? path.resolve(process.env.MIRA_TERMINAL_RUNTIME_ARTIFACTS_ROOT.trim())
  : path.join(projectRoot, ".artifacts");
const nodeStageRoot = path.join(artifactsRoot, "node-runtime");
const terminalStageRoot = path.join(artifactsRoot, "terminal-runtime");
const offline = ["1", "true"].includes(
  process.env.MIRA_TERMINAL_RUNTIME_OFFLINE?.trim().toLowerCase() ?? "",
);

const ensureDir = (targetPath) => fs.mkdirSync(targetPath, { recursive: true });
const removeDir = (targetPath) =>
  fs.rmSync(targetPath, { recursive: true, force: true });
const normalizePath = (value) => value.replaceAll("\\", "/");

function assertSupportedHost() {
  if (process.platform !== lock.platform || process.arch !== lock.architecture) {
    throw new Error(
      `Terminal Dev Runtime preparation requires ${lock.platform}/${lock.architecture}; current host is ${process.platform}/${process.arch}.`,
    );
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const contents = fs.readFileSync(filePath);
  hash.update(contents);
  return hash.digest("hex");
}

function toPowerShellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function downloadFile(url, destinationPath) {
  const partialPath = `${destinationPath}.partial`;
  fs.rmSync(partialPath, { force: true });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri ${toPowerShellLiteral(url)} -OutFile ${toPowerShellLiteral(partialPath)} -MaximumRedirection 5 -TimeoutSec 600`,
        ],
        { stdio: "inherit", windowsHide: true },
      );
      fs.renameSync(partialPath, destinationPath);
      return;
    } catch (error) {
      lastError = error;
      fs.rmSync(partialPath, { force: true });
      console.warn(`Runtime download attempt ${attempt}/3 failed: ${url}`);
    }
  }
  throw lastError;
}

async function ensureArchive(componentName, component) {
  const componentCacheRoot = path.join(cacheRoot, componentName, component.version);
  const archivePath = path.join(componentCacheRoot, component.archiveName);
  ensureDir(componentCacheRoot);

  if (fs.existsSync(archivePath)) {
    const actual = sha256File(archivePath);
    if (actual === component.sha256) {
      console.log(`Using verified cached ${componentName} archive: ${archivePath}`);
      return { archivePath, componentCacheRoot };
    }
    fs.rmSync(archivePath, { force: true });
    if (offline) {
      throw new Error(
        `Cached ${componentName} archive checksum mismatch in offline mode: ${actual}`,
      );
    }
  }

  if (offline) {
    throw new Error(`Missing verified ${componentName} archive in offline mode: ${archivePath}`);
  }

  console.log(`Downloading ${componentName} ${component.version}: ${component.url}`);
  downloadFile(component.url, archivePath);
  const actual = sha256File(archivePath);
  if (actual !== component.sha256) {
    fs.rmSync(archivePath, { force: true });
    throw new Error(
      `${componentName} archive checksum mismatch. Expected ${component.sha256}, received ${actual}.`,
    );
  }
  return { archivePath, componentCacheRoot };
}

function extractArchive(componentName, component, archivePath, componentCacheRoot) {
  const extractedRoot = path.join(componentCacheRoot, "extracted");
  const markerPath = path.join(extractedRoot, ".archive-sha256");
  if (
    fs.existsSync(markerPath) &&
    fs.readFileSync(markerPath, "utf8").trim() === component.sha256
  ) {
    console.log(`Using cached extracted ${componentName} runtime: ${extractedRoot}`);
    return extractedRoot;
  }

  removeDir(extractedRoot);
  ensureDir(extractedRoot);
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      // Windows PowerShell may load a PowerShell 7 Archive module from PSModulePath,
      // whose three-argument ExtractToDirectory overload is unavailable under .NET Framework.
      // The two-argument framework API extracts the already SHA-256-verified ZIP directly.
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${toPowerShellLiteral(archivePath)}, ${toPowerShellLiteral(extractedRoot)})`,
    ],
    { stdio: "inherit", windowsHide: true },
  );
  fs.writeFileSync(markerPath, `${component.sha256}\n`);
  return extractedRoot;
}

function findFile(searchRoot, filename) {
  const entries = fs.readdirSync(searchRoot, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(searchRoot, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return candidate;
    }
    if (entry.isDirectory()) {
      const nested = findFile(candidate, filename);
      if (nested) return nested;
    }
  }
  return null;
}

function findDirectoryContaining(searchRoot, filename) {
  const candidate = findFile(searchRoot, filename);
  return candidate ? path.dirname(candidate) : null;
}

function copyRequiredFile(sourceRoot, filename, destinationRoot) {
  const sourcePath = path.join(sourceRoot, filename);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Runtime archive is missing ${filename}: ${sourcePath}`);
  }
  fs.copyFileSync(sourcePath, path.join(destinationRoot, filename));
}

function stageNode(extractedRoot) {
  const nodeRoot = findDirectoryContaining(extractedRoot, "node.exe");
  if (!nodeRoot || !fs.existsSync(path.join(nodeRoot, "node_modules", "npm"))) {
    throw new Error(`Node archive is missing node.exe or the bundled npm runtime: ${extractedRoot}`);
  }

  removeDir(nodeStageRoot);
  ensureDir(nodeStageRoot);
  for (const filename of ["node.exe", "npm.cmd", "npx.cmd", "LICENSE"]) {
    copyRequiredFile(nodeRoot, filename, nodeStageRoot);
  }
  fs.cpSync(
    path.join(nodeRoot, "node_modules", "npm"),
    path.join(nodeStageRoot, "node_modules", "npm"),
    { recursive: true },
  );
}

function stageGit(extractedRoot) {
  const gitRoot = findDirectoryContaining(extractedRoot, "git-bash.exe") ??
    findDirectoryContaining(extractedRoot, "git-cmd.exe");
  const runtimeRoot = gitRoot ?? extractedRoot;
  const gitExecutable = path.join(runtimeRoot, "cmd", "git.exe");
  if (!fs.existsSync(gitExecutable)) {
    throw new Error(`MinGit archive is missing cmd/git.exe: ${extractedRoot}`);
  }
  fs.cpSync(runtimeRoot, path.join(terminalStageRoot, "git"), { recursive: true });
}

function stageStandaloneExecutable(extractedRoot, filename) {
  const sourcePath = findFile(extractedRoot, filename);
  if (!sourcePath) {
    throw new Error(`Runtime archive is missing ${filename}: ${extractedRoot}`);
  }
  fs.copyFileSync(sourcePath, path.join(terminalStageRoot, "bin", filename));
}

function directorySize(targetPath) {
  let total = 0;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const candidate = path.join(targetPath, entry.name);
    total += entry.isDirectory() ? directorySize(candidate) : fs.statSync(candidate).size;
  }
  return total;
}

function commandVersion(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

function writeNotices(npmVersion) {
  const components = lock.components;
  const contents = [
    "# Terminal Dev Runtime third-party notices",
    "",
    "The archives below are downloaded only during the build, verified with the pinned SHA-256, and redistributed inside Mira.",
    "",
    "| Component | Version | License | Source | SHA-256 |",
    "| --- | --- | --- | --- | --- |",
    ...Object.entries(components).map(
      ([name, component]) =>
        `| ${name} | ${component.version} | ${component.license} | ${component.url} | \`${component.sha256}\` |`,
    ),
    `| npm / npx | ${npmVersion} | Artistic-2.0 and bundled dependency licenses | distributed in ${components.node.url} | \`${components.node.sha256}\` |`,
    "",
    "Node's archive supplies npm and npx; their license file is retained at `node-runtime/node_modules/npm/LICENSE`. MinGit retains its bundled component license files under the Git runtime directory.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(terminalStageRoot, "THIRD_PARTY_NOTICES.md"), contents);
}

function createComponent(component, runtimePath, version, sizes, extras = {}) {
  return {
    component: extras.component ?? path.basename(runtimePath, path.extname(runtimePath)),
    version,
    runtimePath: normalizePath(runtimePath),
    architecture: lock.architecture,
    sourceUrl: component.url,
    archiveSha256: component.sha256,
    license: component.license,
    downloadSizeBytes: sizes.downloadSizeBytes,
    stagedSizeBytes: sizes.stagedSizeBytes,
    ...extras,
  };
}

async function main() {
  assertSupportedHost();
  const prepared = {};
  for (const [name, component] of Object.entries(lock.components)) {
    const cached = await ensureArchive(name, component);
    prepared[name] = {
      ...cached,
      extractedRoot: extractArchive(
        name,
        component,
        cached.archivePath,
        cached.componentCacheRoot,
      ),
    };
  }

  removeDir(terminalStageRoot);
  ensureDir(path.join(terminalStageRoot, "bin"));
  stageNode(prepared.node.extractedRoot);
  stageGit(prepared.git.extractedRoot);
  stageStandaloneExecutable(prepared.uv.extractedRoot, "uv.exe");
  stageStandaloneExecutable(prepared.ripgrep.extractedRoot, "rg.exe");

  const nodeVersion = commandVersion(path.join(nodeStageRoot, "node.exe"), ["--version"])
    .replace(/^v/, "");
  const npmVersion = commandVersion(path.join(nodeStageRoot, "node.exe"), [
    path.join(nodeStageRoot, "node_modules", "npm", "bin", "npm-cli.js"),
    "--version",
  ]);
  const gitVersion = commandVersion(path.join(terminalStageRoot, "git", "cmd", "git.exe"), [
    "--version",
  ]).replace(/^git version\s+/, "");
  const uvVersion = commandVersion(path.join(terminalStageRoot, "bin", "uv.exe"), [
    "--version",
  ]).replace(/^uv\s+/, "").split(/\s+/)[0];
  const ripgrepVersion = commandVersion(path.join(terminalStageRoot, "bin", "rg.exe"), [
    "--version",
  ]).split(/\s+/)[1];
  writeNotices(npmVersion);

  const archiveSize = (name) => fs.statSync(prepared[name].archivePath).size;
  const nodeCoreSize = fs.statSync(path.join(nodeStageRoot, "node.exe")).size +
    fs.statSync(path.join(nodeStageRoot, "LICENSE")).size;
  const npmSize = directorySize(path.join(nodeStageRoot, "node_modules", "npm")) +
    fs.statSync(path.join(nodeStageRoot, "npm.cmd")).size;
  const gitSize = directorySize(path.join(terminalStageRoot, "git"));
  const uvSize = fs.statSync(path.join(terminalStageRoot, "bin", "uv.exe")).size;
  const rgSize = fs.statSync(path.join(terminalStageRoot, "bin", "rg.exe")).size;

  const manifest = {
    version: 1,
    platform: "windows",
    architecture: lock.architecture,
    components: {
      node: createComponent(lock.components.node, "node-runtime/node.exe", nodeVersion, {
        downloadSizeBytes: archiveSize("node"),
        stagedSizeBytes: nodeCoreSize,
      }, { component: "node", runtimeSha256: sha256File(path.join(nodeStageRoot, "node.exe")) }),
      npm: createComponent(lock.components.node, "node-runtime/npm.cmd", npmVersion, {
        downloadSizeBytes: 0,
        stagedSizeBytes: npmSize,
      }, {
        component: "npm",
        distributedWith: "node",
        license: "Artistic-2.0 and bundled dependency licenses",
        licenseUrl: `https://github.com/npm/cli/blob/v${npmVersion}/LICENSE`,
        runtimeSha256: sha256File(path.join(nodeStageRoot, "npm.cmd")),
      }),
      npx: createComponent(lock.components.node, "node-runtime/npx.cmd", npmVersion, {
        downloadSizeBytes: 0,
        stagedSizeBytes: fs.statSync(path.join(nodeStageRoot, "npx.cmd")).size,
      }, {
        component: "npx",
        distributedWith: "node",
        license: "Artistic-2.0 and bundled dependency licenses",
        licenseUrl: `https://github.com/npm/cli/blob/v${npmVersion}/LICENSE`,
        runtimeSha256: sha256File(path.join(nodeStageRoot, "npx.cmd")),
      }),
      git: createComponent(lock.components.git, "terminal-runtime/git/cmd/git.exe", gitVersion, {
        downloadSizeBytes: archiveSize("git"),
        stagedSizeBytes: gitSize,
      }, { component: "git", distribution: "MinGit", runtimeSha256: sha256File(path.join(terminalStageRoot, "git", "cmd", "git.exe")) }),
      uv: createComponent(lock.components.uv, "terminal-runtime/bin/uv.exe", uvVersion, {
        downloadSizeBytes: archiveSize("uv"),
        stagedSizeBytes: uvSize,
      }, { component: "uv", runtimeSha256: sha256File(path.join(terminalStageRoot, "bin", "uv.exe")) }),
      ripgrep: createComponent(lock.components.ripgrep, "terminal-runtime/bin/rg.exe", ripgrepVersion, {
        downloadSizeBytes: archiveSize("ripgrep"),
        stagedSizeBytes: rgSize,
      }, { component: "ripgrep", runtimeSha256: sha256File(path.join(terminalStageRoot, "bin", "rg.exe")) }),
    },
    pathOrder: [
      "node-runtime",
      "terminal-runtime/bin",
      "terminal-runtime/git/cmd",
      "terminal-runtime/git/mingw64/bin",
      "terminal-runtime/git/usr/bin",
      "system",
    ],
    sizes: {
      nodeRuntimeStagedBytes: directorySize(nodeStageRoot),
      terminalRuntimeStagedBytes: directorySize(terminalStageRoot),
      totalStagedBytes: directorySize(nodeStageRoot) + directorySize(terminalStageRoot),
      totalDownloadBytes: Object.keys(lock.components).reduce(
        (total, name) => total + archiveSize(name),
        0,
      ),
    },
  };
  fs.writeFileSync(
    path.join(terminalStageRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(`Prepared Node runtime: ${nodeStageRoot}`);
  console.log(`Prepared Terminal Dev Runtime: ${terminalStageRoot}`);
  console.log(JSON.stringify(manifest.sizes, null, 2));
}

await main();
