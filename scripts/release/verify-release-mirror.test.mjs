import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verify } from "./verify-release-mirror.mjs";

function fixture(platform = "win") {
  const dir = mkdtempSync(join(tmpdir(), "mira-r2-contract-"));
  const tag = "v0.106.0";
  const installer = platform === "win"
    ? "electron_UIChat_Mira_Setup_0.106.0.exe"
    : "macos-intel_UIChat Mira-0.106.0.dmg";
  const names = [installer, installer + ".blockmap"];
  const objects = names.map((name, index) => {
    const size = index === 0 ? 137 : 19;
    writeFileSync(join(dir, name), Buffer.alloc(size));
    return { name, size };
  });
  const github = {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: objects.map(obj => ({ name: obj.name.replace(/ /g, "."), size: obj.size })),
  };
  const prefix = platform === "win" ? "mira/latest/" : "mira/macos-intel/latest/";
  const r2 = {
    IsTruncated: false,
    Contents: objects.map(obj => ({ Key: prefix + obj.name, Size: obj.size })),
  };
  return { dir, tag, installer, objects, github, r2, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

test("Windows Electron installer and blockmap match GitHub and R2", () => {
  const f = fixture();
  try {
    assert.equal(verify("win", f.tag, f.dir, f.github, f.r2).installer, f.installer);
  } finally { f.dispose(); }
});

test("macOS space-normalized GitHub names preserve original R2 names", () => {
  const f = fixture("macos-intel");
  try {
    assert.equal(verify("macos-intel", f.tag, f.dir, f.github, f.r2).installer, f.installer);
  } finally { f.dispose(); }
});

test("a missing blockmap or extra Tauri file fails before upload", () => {
  const f = fixture();
  try {
    rmSync(join(f.dir, f.installer + ".blockmap"));
    assert.throws(() => verify("win", f.tag, f.dir), /expected exactly two/);
    writeFileSync(join(f.dir, f.installer + ".blockmap"), Buffer.alloc(19));
    writeFileSync(join(f.dir, "tauri-setup.exe"), Buffer.alloc(12));
    assert.throws(() => verify("win", f.tag, f.dir), /expected exactly two/);
  } finally { f.dispose(); }
});

test("wrong tag, GitHub size, or Tauri asset cannot pass preflight", () => {
  const f = fixture();
  try {
    assert.throws(() => verify("win", "v0.107.0", f.dir), /unexpected file name/);
    assert.throws(() => verify("win", f.tag, f.dir, { ...f.github, tag_name: "v0.105.0" }), /expected published tag/);
    const wrongSize = { ...f.github, assets: [{ ...f.github.assets[0], size: 2 }, f.github.assets[1]] };
    assert.throws(() => verify("win", f.tag, f.dir, wrongSize), /size mismatch/);
    assert.throws(() => verify("win", f.tag, f.dir, { ...f.github, assets: [...f.github.assets, { name: "tauri_nsis.exe", size: 1 }] }), /Tauri asset/);
  } finally { f.dispose(); }
});

test("R2 stale, missing, truncated, or wrong-size objects fail postflight", () => {
  const f = fixture();
  try {
    const extra = { ...f.r2, Contents: [...f.r2.Contents, { Key: "mira/latest/obsolete.exe", Size: 1 }] };
    assert.throws(() => verify("win", f.tag, f.dir, f.github, extra), /unexpected\/stale/);
    const missing = { ...f.r2, Contents: f.r2.Contents.slice(0, 1) };
    assert.throws(() => verify("win", f.tag, f.dir, f.github, missing), /unexpected\/stale/);
    const truncated = { ...f.r2, IsTruncated: true };
    assert.throws(() => verify("win", f.tag, f.dir, f.github, truncated), /truncated/);
    const incorrect = { ...f.r2, Contents: [{ ...f.r2.Contents[0], Size: 3 }, f.r2.Contents[1]] };
    assert.throws(() => verify("win", f.tag, f.dir, f.github, incorrect), /size mismatch/);
  } finally { f.dispose(); }
});
