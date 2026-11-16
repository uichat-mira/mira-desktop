import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import loadLocalEnv from "./load-local-env.cjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");
loadLocalEnv(projectRoot);

const pinnedVersion = process.env.UIC_TTS_PIPER_VERSION?.trim() || "2023.11.14-2";
const runtimeUrl =
  process.env.UIC_TTS_PIPER_RUNTIME_URL?.trim() ||
  `https://github.com/rhasspy/piper/releases/download/${pinnedVersion}/piper_windows_amd64.zip`;
const localArchiveSourcePath = process.env.UIC_TTS_PIPER_ARCHIVE_PATH?.trim() || "";
const runtimeCacheRoot =
  process.env.UIC_TTS_PIPER_CACHE_ROOT?.trim() ||
  path.join(projectRoot, ".local-runtimes", "piper", "windows-amd64", pinnedVersion);
const runtimeStageRoot =
  process.env.UIC_TTS_PIPER_STAGE_ROOT?.trim() ||
  path.join(projectRoot, ".artifacts", "micro-apps", "tts", "piper");
const archivePath = path.join(runtimeCacheRoot, "piper_windows_amd64.zip");
const extractedRoot = path.join(runtimeCacheRoot, "extracted");
const metadataPath = path.join(runtimeCacheRoot, "manifest.json");

function assertWindowsHost() {
  if (process.platform !== "win32") {
    throw new Error("Bundled Piper runtime preparation currently supports Windows only.");
  }
}

function removeDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function toPsLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function findBundledRuntimeRoot(searchRoot) {
  const directExecutable = path.join(searchRoot, "piper.exe");
  if (fs.existsSync(directExecutable)) {
    return searchRoot;
  }

  const nestedExecutable = path.join(searchRoot, "piper", "piper.exe");
  if (fs.existsSync(nestedExecutable)) {
    return path.join(searchRoot, "piper");
  }

  for (const entry of fs.readdirSync(searchRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidateRoot = findBundledRuntimeRoot(path.join(searchRoot, entry.name));
    if (candidateRoot) {
      return candidateRoot;
    }
  }

  return "";
}

function copyLocalArchive() {
  if (!localArchiveSourcePath) {
    return false;
  }

  ensureDir(runtimeCacheRoot);
  if (!fs.existsSync(localArchiveSourcePath)) {
    throw new Error(`UIC_TTS_PIPER_ARCHIVE_PATH does not exist: ${localArchiveSourcePath}`);
  }
  fs.copyFileSync(localArchiveSourcePath, archivePath);
  console.log(`Copied bundled Piper runtime archive from local source: ${localArchiveSourcePath}`);
  return true;
}

function downloadArchive() {
  console.log(`Downloading bundled Piper runtime: ${runtimeUrl}`);
  ensureDir(runtimeCacheRoot);
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri ${toPsLiteral(runtimeUrl)} -OutFile ${toPsLiteral(archivePath)} -MaximumRedirection 5 -TimeoutSec 180`,
    ],
    {
      windowsHide: true,
      stdio: "inherit",
    },
  );
}

function extractArchive() {
  removeDir(extractedRoot);
  ensureDir(extractedRoot);
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      // Windows PowerShell can load a PowerShell 7 Archive module whose three-argument
      // ExtractToDirectory overload is unavailable on .NET Framework. Use the
      // two-argument framework API, as in prepare-terminal-runtime.mjs.
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${toPsLiteral(archivePath)}, ${toPsLiteral(extractedRoot)})`,
    ],
    {
      windowsHide: true,
      stdio: "inherit",
    },
  );
}

function writeMetadata(runtimeRoot) {
  const manifest = {
    schemaVersion: 1,
    version: pinnedVersion,
    platform: "windows-amd64",
    sourceUrl: runtimeUrl,
    executablePath: path.join(runtimeRoot, "piper.exe"),
    preparedAt: new Date().toISOString(),
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function copyStage(runtimeRoot) {
  removeDir(runtimeStageRoot);
  ensureDir(path.dirname(runtimeStageRoot));
  fs.cpSync(runtimeRoot, runtimeStageRoot, { recursive: true });
  console.log(`Prepared staged Piper runtime: ${runtimeStageRoot}`);
}

async function ensurePreparedRuntime() {
  assertWindowsHost();

  const cachedExecutablePath = path.join(extractedRoot, "piper", "piper.exe");
  if (!fs.existsSync(cachedExecutablePath)) {
    if (!fs.existsSync(archivePath)) {
      if (!copyLocalArchive()) {
        downloadArchive();
      }
    } else {
      console.log(`Using cached Piper runtime archive: ${archivePath}`);
    }
    extractArchive();
  } else {
    console.log(`Using cached extracted Piper runtime: ${cachedExecutablePath}`);
  }

  const runtimeRoot = findBundledRuntimeRoot(extractedRoot);
  if (!runtimeRoot) {
    throw new Error(
      `Bundled Piper runtime extraction is invalid. Missing piper.exe under: ${extractedRoot}`,
    );
  }

  writeMetadata(runtimeRoot);
  copyStage(runtimeRoot);
}

await ensurePreparedRuntime();
