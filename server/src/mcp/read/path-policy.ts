import fs from "node:fs";
import path from "node:path";

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

const normalizeGitignorePattern = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
    return [];
  }

  const directoryOnly = trimmed.endsWith("/");
  const normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/^\//, "")
    .replace(/\/$/, "");

  if (!normalized) return [];

  if (normalized.includes("/")) {
    return directoryOnly
      ? [normalized, `${normalized}/**`]
      : [normalized, `**/${normalized}`];
  }

  return [
    normalized,
    `${normalized}/**`,
    `**/${normalized}`,
    `**/${normalized}/**`,
  ];
};

export const loadWorkspaceIgnorePatterns = (workspaceRoot: string) => {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    return [...DEFAULT_WORKSPACE_IGNORE_PATTERNS];
  }

  const gitignorePatterns = fs
    .readFileSync(gitignorePath, "utf8")
    .split(/\r?\n/)
    .flatMap(normalizeGitignorePattern);

  return [...new Set([...DEFAULT_WORKSPACE_IGNORE_PATTERNS, ...gitignorePatterns])];
};

export const normalizeWorkspaceRelativePath = (value: string) =>
  value.replace(/\\/g, "/");

export const escapeGlobPath = (value: string) =>
  normalizeWorkspaceRelativePath(value).replace(/([*?[\]{}()!+@])/g, "\\$1");


export const resolveWorkspaceIgnorePatterns = (
  workspaceRoot: string,
  includeIgnored: boolean,
) => (includeIgnored ? [] : loadWorkspaceIgnorePatterns(workspaceRoot));
