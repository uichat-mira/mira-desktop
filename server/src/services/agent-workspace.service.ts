import fs from "node:fs";
import path from "node:path";
import { threadRepository } from "@/db/repositories/index.js";
import { resolveAppDataStorageRoot } from "@/utils/app-data-storage-root.js";

export type AgentWorkspaceErrorCode =
  | "thread_not_found"
  | "missing"
  | "unavailable"
  | "invalid"
  | "linked_path"
  | "path_escape"
  | "quota_exhausted"
  | "cleanup_failed";

export class AgentWorkspaceError extends Error {
  readonly code: AgentWorkspaceErrorCode;

  constructor(
    code: AgentWorkspaceErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AgentWorkspaceError";
    this.code = code;
  }
}

export const DEFAULT_PRIVATE_AGENT_WORKSPACE_QUOTA_BYTES = 1024 * 1024 * 1024;
const QUOTA_ENV = "UI_CHAT_PRIVATE_AGENT_WORKSPACE_QUOTA_BYTES";
/**
 * Upgrade compatibility only. Remove after every supported upgrade path has
 * passed through a release that documents QUOTA_ENV as the canonical setting.
 */
const LEGACY_QUOTA_ENV = "UI_CHAT_CONVERSATION_WORKDIR_QUOTA_BYTES";
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Legacy disk layout only.
 *
 * #175 removes Conversation Workdir as a runtime/persistence identity. Keeping
 * this directory segment preserves existing private conversation files without
 * a destructive filesystem migration. It may be renamed only after a separate
 * migration can prove no installed client still owns data under this path.
 */
const PRIVATE_WORKSPACE_ROOT_SEGMENT = "conversation-workdirs";

const fail = (
  code: AgentWorkspaceErrorCode,
  message: string,
  cause?: unknown,
): never => {
  throw new AgentWorkspaceError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
};

const assertSafeThreadId = (threadId: string) => {
  if (!threadId || !SAFE_SEGMENT.test(threadId)) {
    fail("invalid", "Private Agent workspace thread id is invalid");
  }
};

const assertValidUserId = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    fail("invalid", "Private Agent workspace user id is invalid");
  }
};

const normalizeQuota = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("invalid", "Private Agent workspace quota is invalid");
  }
  return value;
};

export const resolvePrivateAgentWorkspaceQuotaBytes = (
  env: NodeJS.ProcessEnv = process.env,
) => {
  const raw = env[QUOTA_ENV]?.trim() ?? env[LEGACY_QUOTA_ENV]?.trim();
  return raw
    ? normalizeQuota(Number(raw))
    : DEFAULT_PRIVATE_AGENT_WORKSPACE_QUOTA_BYTES;
};

export const resolvePrivateAgentWorkspaceStorageRoot =
  resolveAppDataStorageRoot;

export const buildPrivateAgentWorkspacePath = (
  input: { storageRoot: string; userId: number; threadId: string },
  pathOps: Pick<typeof path, "resolve" | "join" | "relative" | "isAbsolute"> = path,
) => {
  assertValidUserId(input.userId);
  assertSafeThreadId(input.threadId);

  const root = pathOps.resolve(input.storageRoot);
  const candidate = pathOps.join(
    root,
    PRIVATE_WORKSPACE_ROOT_SEGMENT,
    `user-${input.userId}`,
    input.threadId,
  );
  const relative = pathOps.relative(root, candidate);
  if (!relative || relative.startsWith("..") || pathOps.isAbsolute(relative)) {
    fail("path_escape", "Private Agent workspace path escapes app-data root");
  }
  return candidate;
};

const fsCode = (error: unknown) =>
  (error as NodeJS.ErrnoException | undefined)?.code;

const comparablePath = (
  value: string,
  pathOps: Pick<typeof path, "resolve"> = path,
  caseInsensitive = process.platform === "win32",
) => {
  const resolved = pathOps.resolve(value);
  return caseInsensitive ? resolved.toLowerCase() : resolved;
};

const samePath = (left: string, right: string) =>
  comparablePath(left) === comparablePath(right);

export const isPrivateAgentWorkspacePathContained = (
  root: string,
  candidate: string,
  pathOps: Pick<typeof path, "resolve" | "relative" | "isAbsolute"> = path,
  caseInsensitive = process.platform === "win32",
) => {
  const relative = pathOps.relative(
    comparablePath(root, pathOps, caseInsensitive),
    comparablePath(candidate, pathOps, caseInsensitive),
  );
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !pathOps.isAbsolute(relative)
  );
};

const contained = (root: string, candidate: string) => {
  if (!isPrivateAgentWorkspacePathContained(root, candidate)) {
    fail("path_escape", "Private Agent workspace path escapes app-data root");
  }
};

const mapFsFailure = (
  error: unknown,
  missing: AgentWorkspaceErrorCode = "unavailable",
) => {
  const code = fsCode(error);
  if (code === "ENOENT") return missing;
  return "unavailable" as const;
};

const trustedRoot = (storageRoot: string, createMissing: boolean): string => {
  try {
    if (createMissing) fs.mkdirSync(storageRoot, { recursive: true });
    const stat = fs.statSync(storageRoot);
    if (!stat.isDirectory()) {
      fail("invalid", "Private Agent workspace app-data root is not a directory");
    }
    return fs.realpathSync(storageRoot);
  } catch (error) {
    if (error instanceof AgentWorkspaceError) throw error;
    return fail(
      mapFsFailure(error, "missing"),
      "Private Agent workspace app-data root is unavailable",
      error,
    );
  }
};

const inspectComponent = (component: string, createMissing: boolean) => {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(component);
  } catch (error) {
    if (createMissing && fsCode(error) === "ENOENT") {
      try {
        fs.mkdirSync(component);
        stat = fs.lstatSync(component);
      } catch (mkdirError) {
        return fail(
          mapFsFailure(mkdirError),
          "Private Agent workspace path is unavailable",
          mkdirError,
        );
      }
    } else {
      return fail(
        mapFsFailure(error, "missing"),
        "Private Agent workspace path is unavailable",
        error,
      );
    }
  }

  if (stat.isSymbolicLink()) {
    fail("linked_path", "Private Agent workspace path contains a symbolic link");
  }
  if (!stat.isDirectory()) {
    fail("invalid", "Private Agent workspace path is not a directory");
  }
};

const validateDirectory = (input: {
  storageRoot: string;
  userId: number;
  threadId: string;
  createMissing: boolean;
}) => {
  const root = trustedRoot(input.storageRoot, input.createMissing);
  const expected = buildPrivateAgentWorkspacePath({
    storageRoot: root,
    userId: input.userId,
    threadId: input.threadId,
  });

  let current = root;
  for (const segment of [
    PRIVATE_WORKSPACE_ROOT_SEGMENT,
    `user-${input.userId}`,
    input.threadId,
  ]) {
    current = path.join(current, segment);
    inspectComponent(current, input.createMissing);
  }

  let real: string;
  try {
    real = fs.realpathSync(current);
  } catch (error) {
    return fail(
      mapFsFailure(error),
      "Private Agent workspace path is unavailable",
      error,
    );
  }
  contained(root, real);

  if (!samePath(real, expected)) {
    fail("path_escape", "Private Agent workspace path is not canonical");
  }

  return { root, expected, real };
};

const scanBytes = (directory: string, root: string): number => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    return fail(
      mapFsFailure(error),
      "Private Agent workspace directory is unavailable",
      error,
    );
  }

  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(entryPath);
    } catch (error) {
      return fail(
        mapFsFailure(error),
        "Private Agent workspace entry is unavailable",
        error,
      );
    }

    if (stat.isSymbolicLink()) {
      fail("linked_path", "Private Agent workspace contains a symbolic link");
    }

    let real: string;
    try {
      real = fs.realpathSync(entryPath);
    } catch (error) {
      return fail(
        mapFsFailure(error),
        "Private Agent workspace entry is unavailable",
        error,
      );
    }
    contained(root, real);

    if (stat.isDirectory()) total += scanBytes(real, root);
    else if (stat.isFile()) total += stat.size;
    else {
      fail(
        "invalid",
        "Private Agent workspace contains an unsupported filesystem entry",
      );
    }
  }
  return total;
};

const usageForUser = (input: {
  userId: number;
  storageRoot: string;
  quotaBytes: number;
}) => {
  const root = trustedRoot(input.storageRoot, false);
  const userRoot = path.join(
    root,
    PRIVATE_WORKSPACE_ROOT_SEGMENT,
    `user-${input.userId}`,
  );

  try {
    const stat = fs.lstatSync(userRoot);
    if (stat.isSymbolicLink()) {
      fail("linked_path", "Private Agent workspace user root contains a symbolic link");
    }
    if (!stat.isDirectory()) {
      fail("invalid", "Private Agent workspace user root is not a directory");
    }
    const real = fs.realpathSync(userRoot);
    contained(root, real);
    return {
      userId: input.userId,
      bytes: scanBytes(real, root),
      quotaBytes: input.quotaBytes,
    };
  } catch (error) {
    if (fsCode(error) === "ENOENT") {
      return { userId: input.userId, bytes: 0, quotaBytes: input.quotaBytes };
    }
    if (error instanceof AgentWorkspaceError) throw error;
    return fail(
      mapFsFailure(error),
      "Private Agent workspace user root is unavailable",
      error,
    );
  }
};

const assertQuota = (usage: {
  bytes: number;
  quotaBytes: number;
}) => {
  if (usage.bytes > usage.quotaBytes) {
    fail(
      "quota_exhausted",
      `Private Agent workspace quota exhausted (${usage.bytes}/${usage.quotaBytes} bytes)`,
    );
  }
};

export const privateAgentWorkspaceService = {
  get(threadId: string, userId: number): string | null {
    if (!threadRepository.findById(threadId, userId)) return null;
    const storageRoot = resolvePrivateAgentWorkspaceStorageRoot();
    let root: string;
    try {
      root = trustedRoot(storageRoot, false);
    } catch (error) {
      if (error instanceof AgentWorkspaceError && error.code === "missing") {
        return null;
      }
      throw error;
    }
    const expected = buildPrivateAgentWorkspacePath({
      storageRoot: root,
      userId,
      threadId,
    });
    if (!fs.existsSync(expected)) return null;

    return validateDirectory({
      storageRoot,
      userId,
      threadId,
      createMissing: false,
    }).real;
  },

  ensure(input: {
    threadId: string;
    userId: number;
    storageRoot?: string;
    quotaBytes?: number;
  }): string {
    if (!threadRepository.findById(input.threadId, input.userId)) {
      fail("thread_not_found", "Thread not found for private Agent workspace");
    }

    const storageRoot =
      input.storageRoot ?? resolvePrivateAgentWorkspaceStorageRoot();
    const quotaBytes = normalizeQuota(
      input.quotaBytes ?? resolvePrivateAgentWorkspaceQuotaBytes(),
    );

    try {
      assertQuota(
        usageForUser({
          userId: input.userId,
          storageRoot,
          quotaBytes,
        }),
      );
    } catch (error) {
      if (
        error instanceof AgentWorkspaceError &&
        error.code === "missing"
      ) {
        // The app-data root will be created below.
      } else {
        throw error;
      }
    }

    return validateDirectory({
      storageRoot,
      userId: input.userId,
      threadId: input.threadId,
      createMissing: true,
    }).real;
  },

  isExpectedRoot(input: {
    threadId: string;
    userId: number;
    rootPath: string;
    storageRoot?: string;
  }): boolean {
    const storageRoot =
      input.storageRoot ?? resolvePrivateAgentWorkspaceStorageRoot();
    let root: string;
    try {
      root = trustedRoot(storageRoot, false);
    } catch {
      return false;
    }
    const expected = buildPrivateAgentWorkspacePath({
      storageRoot: root,
      userId: input.userId,
      threadId: input.threadId,
    });
    return samePath(expected, input.rootPath);
  },

  cleanup(input: {
    threadId: string;
    userId: number;
    storageRoot?: string;
  }): { existed: boolean; removed: boolean } {
    if (!threadRepository.findById(input.threadId, input.userId)) {
      return { existed: false, removed: false };
    }

    const storageRoot =
      input.storageRoot ?? resolvePrivateAgentWorkspaceStorageRoot();
    const expected = buildPrivateAgentWorkspacePath({
      storageRoot,
      userId: input.userId,
      threadId: input.threadId,
    });

    if (!fs.existsSync(expected)) {
      return { existed: false, removed: false };
    }

    validateDirectory({
      storageRoot,
      userId: input.userId,
      threadId: input.threadId,
      createMissing: false,
    });

    try {
      fs.rmSync(expected, { recursive: true, force: false });
    } catch (error) {
      fail("cleanup_failed", "Private Agent workspace cleanup failed", error);
    }
    return { existed: true, removed: true };
  },
};
