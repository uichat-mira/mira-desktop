// Verify the checked-out stable tag points to a commit reachable from prod.
// The release workflow must first fetch origin/prod, fail closed on any mismatch.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function verifyProdTag(tag, eventSha, cwd = fileURLToPath(new URL("../../", import.meta.url))) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error("Only stable vX.Y.Z release tags are allowed");
  }
  if (!/^[a-f0-9]{40}$/i.test(eventSha)) {
    throw new Error("Expected a full GitHub event SHA");
  }
  const version = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).version;
  if (tag !== `v${version}`) {
    throw new Error(`Tag ${tag} differs from package.json version ${version}`);
  }

  const checkedOut = git(cwd, "rev-parse", "HEAD");
  const tagRef = `refs/tags/${tag}`;
  const tagObject = git(cwd, "rev-parse", "--verify", tagRef);
  const taggedCommit = git(cwd, "rev-parse", "--verify", `${tagRef}^{commit}`);
  // Annotated tag push events may expose the tag-object SHA instead of the peeled commit.
  if (checkedOut !== taggedCommit || (eventSha !== tagObject && eventSha !== taggedCommit)) {
    throw new Error("Release tag, checked-out HEAD and event SHA must identify the same tagged commit");
  }

  const prodRef = "refs/remotes/origin/prod";
  const prodCommit = git(cwd, "rev-parse", "--verify", `${prodRef}^{commit}`);
  try {
    git(cwd, "merge-base", "--is-ancestor", taggedCommit, prodRef);
  } catch {
    throw new Error(`Release commit ${taggedCommit} is not in prod history (${prodCommit})`);
  }
  return { tag, sha: taggedCommit, prodCommit };
}
