import { spawn } from "node:child_process";
import { mcpInternalError } from "../core/errors.js";

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

const DEFAULT_GIT_IGNORE_TIMEOUT_MS = 5_000;
const GIT_IGNORE_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export const normalizeWorkspaceRelativePath = (value: string) =>
  value.replace(/\\/g, "/");

export const escapeGlobPath = (value: string) =>
  normalizeWorkspaceRelativePath(value).replace(/([*?[\]{}()!+@])/g, "\\$1");

export const resolveWorkspaceIgnorePatterns = (
  _workspaceRoot: string,
  includeIgnored: boolean,
) => (includeIgnored ? [] : [...DEFAULT_WORKSPACE_IGNORE_PATTERNS]);

type GitIgnoreFilterOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBufferBytes?: number;
};

/**
 * Apply the repository's real Git ignore semantics after candidate discovery.
 *
 * Git owns .gitignore parsing here so negation, anchoring, escaped markers and
 * directory rules do not drift into a second Mira-specific parser. The process
 * is asynchronous, bounded and cancellable. A missing Git executable or a
 * non-worktree simply skips this layer; actual execution failures stay visible.
 */
export const filterGitIgnoredPaths = async (
  workspaceRoot: string,
  relativePaths: string[],
  includeIgnored: boolean,
  options: GitIgnoreFilterOptions = {},
): Promise<string[]> => {
  if (includeIgnored || relativePaths.length === 0) {
    return relativePaths;
  }

  const input = `${relativePaths.join("\0")}\0`;
  const timeoutMs = Math.max(
    1,
    options.timeoutMs ?? DEFAULT_GIT_IGNORE_TIMEOUT_MS,
  );
  const maxBufferBytes = Math.max(
    1,
    options.maxBufferBytes ?? GIT_IGNORE_MAX_BUFFER_BYTES,
  );

  return await new Promise<string[]>((resolve, reject) => {
    const child = spawn(
      "git",
      ["check-ignore", "--no-index", "--stdin", "-z"],
      {
        cwd: workspaceRoot,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    const finish = (result: string[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const terminate = () => {
      try {
        child.kill();
      } catch {
        // Process may already be gone.
      }
    };
    const abort = () => {
      terminate();
      fail(
        options.signal?.reason instanceof Error
          ? options.signal.reason
          : new Error("Git ignore filtering cancelled"),
      );
    };

    timer = setTimeout(() => {
      terminate();
      fail(
        mcpInternalError(
          `git check-ignore timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > maxBufferBytes) {
        terminate();
        fail(
          mcpInternalError(
            `git check-ignore output exceeded ${maxBufferBytes} bytes`,
          ),
        );
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (settled) return;
      stderr += chunk;
      if (stderr.length > 16 * 1024) {
        stderr = stderr.slice(-16 * 1024);
      }
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        finish(relativePaths);
        return;
      }
      fail(
        mcpInternalError("git check-ignore could not start", {
          cause: error,
        }),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code === 0 || code === 1) {
        const ignored = new Set(
          stdout
            .split("\0")
            .filter(Boolean)
            .map(normalizeWorkspaceRelativePath),
        );
        finish(
          relativePaths.filter(
            (candidate) =>
              !ignored.has(normalizeWorkspaceRelativePath(candidate)),
          ),
        );
        return;
      }

      if (code === 128 && /not a git repository/iu.test(stderr)) {
        finish(relativePaths);
        return;
      }

      fail(
        mcpInternalError(
          `git check-ignore failed with exit code ${code ?? "unknown"}: ${stderr.trim() || "unknown error"}`,
        ),
      );
    });
    child.stdin.on("error", (error) => {
      if (!settled) {
        fail(
          mcpInternalError("git check-ignore stdin failed", {
            cause: error,
          }),
        );
      }
    });
    child.stdin.end(input);
  });
};
