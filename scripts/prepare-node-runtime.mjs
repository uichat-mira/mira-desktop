import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");
const lockPath = path.join(__dirname, "node-runtime.lock.json");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const platformKey = `${process.platform}-${process.arch}`;
const platformEntry = lock.platforms[platformKey];
const artifactsRoot = process.env.MIRA_NODE_RUNTIME_ARTIFACTS_ROOT?.trim()
  ? path.resolve(process.env.MIRA_NODE_RUNTIME_ARTIFACTS_ROOT.trim())
  : path.join(projectRoot, ".artifacts");
const nodeStageRoot = path.join(artifactsRoot, "node-runtime");
const cacheRoot = process.env.MIRA_NODE_RUNTIME_CACHE_ROOT?.trim()
  ? path.resolve(process.env.MIRA_NODE_RUNTIME_CACHE_ROOT.trim())
  : path.join(projectRoot, ".local-runtimes", "node-runtime", platformKey);
const offline = ["1", "true"].includes(
  process.env.MIRA_NODE_RUNTIME_OFFLINE?.trim().toLowerCase() ?? "",
);

const ensureDir = (targetPath) => fs.mkdirSync(targetPath, { recursive: true });
const removeDir = (targetPath) =>
  fs.rmSync(targetPath, { recursive: true, force: true });

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function downloadFile(url, destinationPath) {
  if (offline) {
    throw new Error(`Missing verified Node archive in offline mode: ${destinationPath}`);
  }

  const partialPath = `${destinationPath}.partial`;
  fs.rmSync(partialPath, { force: true });
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(partialPath, buffer);
  fs.renameSync(partialPath, destinationPath);
}

async function ensureArchive() {
  ensureDir(cacheRoot);
  const archivePath = path.join(cacheRoot, platformEntry.archiveName);

  if (fs.existsSync(archivePath)) {
    const actual = sha256File(archivePath);
    if (actual === platformEntry.sha256) {
      console.log(`Using verified cached Node archive: ${archivePath}`);
      return archivePath;
    }
    fs.rmSync(archivePath, { force: true });
    if (offline) {
      throw new Error(`Cached Node archive checksum mismatch in offline mode: ${actual}`);
    }
  }

  console.log(`Downloading Node ${lock.version} (${platformKey}): ${platformEntry.url}`);
  await downloadFile(platformEntry.url, archivePath);
  const actual = sha256File(archivePath);
  if (actual !== platformEntry.sha256) {
    fs.rmSync(archivePath, { force: true });
    throw new Error(
      `Node archive checksum mismatch. Expected ${platformEntry.sha256}, received ${actual}.`,
    );
  }
  return archivePath;
}

function extractArchive(archivePath) {
  const extractedRoot = path.join(cacheRoot, "extracted");
  const markerPath = path.join(extractedRoot, ".archive-sha256");
  if (
    fs.existsSync(markerPath) &&
    fs.readFileSync(markerPath, "utf8").trim() === platformEntry.sha256
  ) {
    console.log(`Using cached extracted Node runtime: ${extractedRoot}`);
    return extractedRoot;
  }

  removeDir(extractedRoot);
  ensureDir(extractedRoot);
  execFileSync("tar", ["-xzf", archivePath, "-C", extractedRoot], { stdio: "inherit" });
  fs.writeFileSync(markerPath, `${platformEntry.sha256}\n`);
  return extractedRoot;
}

function findNodeBinary(searchRoot) {
  for (const entry of fs.readdirSync(searchRoot, { withFileTypes: true })) {
    const candidate = path.join(searchRoot, entry.name);
    if (entry.isDirectory()) {
      const nested = findNodeBinary(candidate);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === "node") {
      return candidate;
    }
  }
  return null;
}

async function main() {
  if (!platformEntry) {
    throw new Error(
      `Node runtime preparation is not configured for ${platformKey}. Add an entry to scripts/node-runtime.lock.json.`,
    );
  }

  const archivePath = await ensureArchive();
  const extractedRoot = extractArchive(archivePath);
  const nodeBinary = findNodeBinary(extractedRoot);
  if (!nodeBinary) {
    throw new Error(`Node archive did not contain a node binary: ${extractedRoot}`);
  }

  removeDir(nodeStageRoot);
  ensureDir(nodeStageRoot);

  const stagedNode = path.join(nodeStageRoot, "node");
  fs.copyFileSync(nodeBinary, stagedNode);
  fs.chmodSync(stagedNode, 0o755);

  const licenseSource = path.join(path.dirname(path.dirname(nodeBinary)), "LICENSE");
  if (fs.existsSync(licenseSource)) {
    fs.copyFileSync(licenseSource, path.join(nodeStageRoot, "LICENSE"));
  }

  const version = execFileSync(stagedNode, ["--version"], { encoding: "utf8" })
    .trim()
    .replace(/^v/, "");

  const manifest = {
    schemaVersion: 1,
    platform: process.platform,
    architecture: process.arch,
    version,
    runtimePath: "node-runtime/node",
    sourceUrl: platformEntry.url,
    archiveSha256: platformEntry.sha256,
    runtimeSha256: sha256File(stagedNode),
    license: lock.license,
    licenseUrl: lock.licenseUrl,
  };
  fs.writeFileSync(
    path.join(nodeStageRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(`Prepared Node runtime: ${nodeStageRoot}`);
  console.log(`Node version: ${version}`);
}

await main();
