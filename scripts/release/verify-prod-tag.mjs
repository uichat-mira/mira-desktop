#!/usr/bin/env node
// Require a stable release tag to point to the checked-out commit in prod history.
// The release workflow must fetch origin/prod before calling this check.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function verifyProdTag(tag, sha, cwd = fileURLToPath(new URL("../../", import.meta.url))) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error("Only stable vX.Y.Z release tags are allowed");
  }
  if (!/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error("Expected a full release commit SHA");
  }

  const version = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).version;
  if (tag !== `v${version}`) {
    throw new Error(`Tag ${tag} differs from package.json version ${version}`);
  }

  const checkedOut = git(cwd, "rev-parse", "HEAD");
  const taggedCommit = git(cwd, "rev-parse", "--verify", `refs/tags/${tag}^{commit}`);
  if (checkedOut !== sha || taggedCommit !== sha) {
    throw new Error("Release tag, checked-out HEAD, and event commit must match");
  }

  const prodRef = "refs/remotes/origin/prod";
  const prodCommit = git(cwd, "rev-parse", "--verify", `${prodRef}^{commit}`);
  try {
    git(cwd, "merge-base", "--is-ancestor", sha, prodRef);
  } catch {
    throw new Error(`Release commit ${sha} is not in prod history (${prodCommit})`);
  }
  return { tag, sha, prodCommit };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = verifyProdTag(process.argv[2], process.argv[3]);
    console.log(`Release provenance PASS: ${result.tag} @ ${result.sha} is in prod history (${result.prodCommit})`);
  } catch (error) {
    console.error("::error::Release provenance rejected: " + error.message);
    process.exitCode = 1;
  }
}
