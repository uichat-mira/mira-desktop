#!/usr/bin/env node
// Validate the release artifacts that GitHub and R2 advertise, without downloading binaries.
// Usage: node verify-release-mirror.mjs <win|macos-intel> <vX.Y.Z> <dist-dir> [github-release.json] [r2-list.json]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

function fail(message) {
  throw new Error("Release mirror contract: " + message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function verify(platform, tag, directory, githubRelease, r2List) {
  if (!["win", "macos-intel"].includes(platform)) fail("unknown platform " + platform);
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail("invalid release tag " + tag);
  const version = tag.slice(1);
  const files = readdirSync(directory);
  if (files.length !== 2 || files.some(name => !statSync(join(directory, name)).isFile())) {
    fail("expected exactly two installer and blockmap files in " + directory);
  }

  const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const installerPattern = platform === "win"
    ? new RegExp("^electron_.*_Setup_" + escapeRe(version) + "\\.exe$")
    : new RegExp("^macos-intel_.*-" + escapeRe(version) + "\\.dmg$");
  const installer = files.find(name => installerPattern.test(name));
  if (!installer || files.some(name => name !== installer && name !== installer + ".blockmap")) {
    fail("unexpected file name or installer/blockmap version mismatch");
  }
  const objects = files.map(name => ({
    name,
    size: statSync(join(directory, name)).size,
  }));
  if (objects.some(obj => obj.size <= 0)) fail("empty release asset");

  if (githubRelease !== undefined) {
    if (githubRelease.tag_name !== tag || githubRelease.draft || githubRelease.prerelease) {
      fail("GitHub Release is not the expected published tag");
    }
    for (const obj of objects) {
      // GitHub Release normalizes spaces in uploaded macOS artifact names to dots.
      const githubName = obj.name.replace(/ /g, ".");
      const match = (githubRelease.assets || []).find(asset => asset.name === githubName);
      if (!match || match.size !== obj.size) fail("GitHub Release asset missing/size mismatch: " + githubName);
    }
    if ((githubRelease.assets || []).some(asset => /tauri/i.test(asset.name))) {
      fail("retired Tauri asset in new Electron-only Release");
    }
  }

  if (r2List !== undefined) {
    const prefix = platform === "win" ? "mira/latest/" : "mira/macos-intel/latest/";
    const remote = r2List.Contents || [];
    if (remote.length !== objects.length || r2List.IsTruncated === true) {
      fail("R2 latest contains unexpected/stale objects or truncated result");
    }
    for (const obj of objects) {
      const item = remote.find(entry => entry.Key === prefix + obj.name);
      if (!item || item.Size !== obj.size) fail("R2 object missing/size mismatch: " + prefix + obj.name);
    }
  }
  return { platform, tag, installer, objects };
}

if (process.argv[1] && basename(process.argv[1]) === "verify-release-mirror.mjs") {
  const [, , platform, tag, dir, githubPath, r2Path] = process.argv;
  if (!platform || !tag || !dir) {
    console.error("Usage: verify-release-mirror.mjs <win|macos-intel> <vX.Y.Z> <dist-dir> [github-release.json] [r2-list.json]");
    process.exitCode = 2;
  } else {
    try {
      const result = verify(platform, tag, dir, githubPath ? readJson(githubPath) : undefined, r2Path ? readJson(r2Path) : undefined);
      console.log("Release mirror contract PASS:", result.platform, result.tag, result.installer);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
