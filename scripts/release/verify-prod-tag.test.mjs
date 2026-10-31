import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyProdTag } from "./verify-prod-tag.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "mira-release-tag-"));
  git(cwd, "init", "-q");
  git(cwd, "config", "user.name", "Release Test");
  git(cwd, "config", "user.email", "release-test@example.invalid");
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ version: "0.106.0" }));
  git(cwd, "add", "package.json");
  git(cwd, "commit", "-qm", "prod baseline");
  const sha = git(cwd, "rev-parse", "HEAD");
  git(cwd, "tag", "v0.106.0");
  git(cwd, "update-ref", "refs/remotes/origin/prod", sha);
  return { cwd, sha, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}
function inRepo(run) {
  const f = fixture();
  try { run(f); } finally { f.cleanup(); }
}

test("stable tag on prod commit is accepted (including annotated tags)", () => inRepo(f => {
  assert.equal(verifyProdTag("v0.106.0", f.sha, f.cwd).sha, f.sha);
  git(f.cwd, "tag", "-d", "v0.106.0");
  git(f.cwd, "tag", "-a", "v0.106.0", "-m", "release");
  assert.equal(verifyProdTag("v0.106.0", f.sha, f.cwd).sha, f.sha);
}));

test("commit outside prod history is rejected", () => inRepo(f => {
  writeFileSync(join(f.cwd, "unreleased.txt"), "unreleased");
  git(f.cwd, "add", "unreleased.txt");
  git(f.cwd, "commit", "-qm", "unreleased feature");
  const unpromoted = git(f.cwd, "rev-parse", "HEAD");
  git(f.cwd, "tag", "-f", "v0.106.0");
  assert.throws(() => verifyProdTag("v0.106.0", unpromoted, f.cwd), /not in prod history/);
}));

test("tag/version mismatch, unstable tag and SHA mismatch are rejected", () => inRepo(f => {
  assert.throws(() => verifyProdTag("v0.105.0", f.sha, f.cwd), /differs from package.json/);
  assert.throws(() => verifyProdTag("v0.106.0-rc.1", f.sha, f.cwd), /Only stable/);
  assert.throws(() => verifyProdTag("v0.106.0", "f".repeat(40), f.cwd), /must match/);
}));

test("missing prod ref fails closed", () => inRepo(f => {
  git(f.cwd, "update-ref", "-d", "refs/remotes/origin/prod");
  assert.throws(() => verifyProdTag("v0.106.0", f.sha, f.cwd));
}));

test("publish jobs cannot run before provenance guard", () => {
  const yml = readFileSync(new URL("../../.github/workflows/release-production.yml", import.meta.url), "utf8");
  assert.match(yml, /  verify-tag-source:\n/);
  assert.match(yml, /  factory:\n    name: Build and validate release\n    needs: verify-tag-source\n/);
  assert.match(yml, /  build-macos-intel:\n    name: Build macOS Intel release asset\n    needs: verify-tag-source\n/);
});

test("CLI executes provenance check instead of exiting silently", () => inRepo(f => {
  const scripts = join(f.cwd, "scripts", "release");
  mkdirSync(scripts, { recursive: true });
  copyFileSync(new URL("./verify-prod-tag.mjs", import.meta.url), join(scripts, "verify-prod-tag.mjs"));
  const output = execFileSync(process.execPath, ["scripts/release/verify-prod-tag.mjs", "v0.106.0", f.sha], {
    cwd: f.cwd, encoding: "utf8",
  });
  assert.match(output, /Release provenance PASS/);
  assert.throws(() => execFileSync(process.execPath, [
    "scripts/release/verify-prod-tag.mjs", "v0.106.0", "f".repeat(40),
  ], { cwd: f.cwd, encoding: "utf8", stdio: "pipe" }));
}));
