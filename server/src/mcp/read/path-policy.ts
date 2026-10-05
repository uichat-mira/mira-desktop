import { spawnSync } from "node:child_process";

export const DEFAULT_WORKSPACE_IGNORE_PATTERNS = [
  ".git",
  ".git/**",
  "**/.git",
  "**/.git/**",
  "node_modules",
  "node_modules/**",
  "**/node_modules",
  "**/node_modules/**",
  "dist",
  "dist/**",
  "**/dist",
  "**/dist/**",
  "build",
  "build/**",
  "**/build",
  "**/build/**",
  "release",
  "release/**",
  "**/release",
  "**/release/**",
  ".artifacts",
  ".artifacts/**",
  "**/.artifacts",
  "**/.artifacts/**",
  "coverage",
  "coverage/**",
  "**/coverage",
  "**/coverage/**",
  "target",
  "target/**",
  "**/target",
  "**/target/**",
] as const;

export const normalizeWorkspaceRelativePath = (value: string) =>
  value.replace(/\\/g, "/");

export const escapeGlobPath = (value: string) =>
  normalizeWorkspaceRelativePath(value).replace(/([*?[\]{}()!+@])/g, "\\$1");

export const resolveWorkspaceIgnorePatterns = (
  _workspaceRoot: string,
  includeIgnored: boolean,
) => (includeIgnored ? [] : [...DEFAULT_WORKSPACE_IGNORE_PATTERNS]);

/**
 * Apply the repository's real Git ignore semantics after candidate discovery.
 *
 * Git owns .gitignore parsing here so negation, anchoring, escaped markers and
 * directory rules do not drift into a second Mira-specific parser. If the
 * workspace is not a Git worktree (or Git is unavailable), this layer is
 * intentionally skipped; the normal Mira default-noise filters still apply.
 */
export const filterGitIgnoredPaths = (
  workspaceRoot: string,
  relativePaths: string[],
  includeIgnored: boolean,
) => {
  if (includeIgnored || relativePaths.length === 0) {
    return relativePaths;
  }

  const input = `${relativePaths.join("\0")}\0`;
  const result = spawnSync(
    "git",
    ["check-ignore", "--no-index", "--stdin", "-z"],
    {
      cwd: workspaceRoot,
      input,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  );

  if (result.error || (result.status !== 0 && result.status !== 1)) {
    return relativePaths;
  }

  const ignored = new Set(
    result.stdout
      .split("\0")
      .filter(Boolean)
      .map(normalizeWorkspaceRelativePath),
  );

  return relativePaths.filter(
    (candidate) => !ignored.has(normalizeWorkspaceRelativePath(candidate)),
  );
};
