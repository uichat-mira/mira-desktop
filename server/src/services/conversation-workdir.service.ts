import fs from "node:fs";
import path from "node:path";
import CONFIG from "@/config/index.js";
import {
  conversationWorkdirRepository,
  threadRepository,
} from "@/db/repositories/index.js";
import type { ConversationWorkdir } from "@/db/schema.js";
import type { ConversationWorkdirReference } from "@/agent/types.js";

export type ConversationWorkdirErrorCode =
  | "thread_not_found"
  | "missing"
  | "unavailable"
  | "invalid"
  | "linked_path"
  | "path_escape"
  | "identity_conflict"
  | "quota_exhausted"
  | "cleanup_failed";

export class ConversationWorkdirError extends Error {
  readonly code: ConversationWorkdirErrorCode;
  constructor(code: ConversationWorkdirErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConversationWorkdirError";
    this.code = code;
  }
}

export interface EnsureConversationWorkdirInput {
  threadId: string;
  userId: number;
  storageRoot?: string;
  quotaBytes?: number;
}

export interface ReopenConversationWorkdirInput extends EnsureConversationWorkdirInput {
  reference?: ConversationWorkdirReference;
}

export interface CleanupConversationWorkdirInput {
  threadId: string;
  userId: number;
  storageRoot?: string;
}

export interface ConversationWorkdirUsage {
  userId: number;
  bytes: number;
  quotaBytes: number;
}

export interface ConversationWorkdirCleanupResult {
  threadId: string;
  userId: number;
  existed: boolean;
  removed: boolean;
}

export const DEFAULT_CONVERSATION_WORKDIR_QUOTA_BYTES = 1024 * 1024 * 1024;
const QUOTA_ENV = "UI_CHAT_CONVERSATION_WORKDIR_QUOTA_BYTES";
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const WORKDIR_ROOT_SEGMENT = "conversation-workdirs";

const fail = (code: ConversationWorkdirErrorCode, message: string, cause?: unknown): never => {
  throw new ConversationWorkdirError(code, message, cause === undefined ? undefined : { cause });
};

const assertSafeThreadId = (threadId: string) => {
  if (!threadId || !SAFE_SEGMENT.test(threadId)) fail("invalid", "Conversation workdir thread id is invalid");
};

const assertValidUserId = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) fail("invalid", "Conversation workdir user id is invalid");
};

const normalizeQuota = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid", "Conversation workdir quota is invalid");
  return value;
};

export const resolveConversationWorkdirQuotaBytes = (env: NodeJS.ProcessEnv = process.env) => {
  const raw = env[QUOTA_ENV]?.trim();
  return raw ? normalizeQuota(Number(raw)) : DEFAULT_CONVERSATION_WORKDIR_QUOTA_BYTES;
};

export const resolveConversationWorkdirStorageRoot = (env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) => {
  const configured = env.UI_CHAT_DATABASE_DIR?.trim();
  if (configured) return path.resolve(cwd, configured);
  const raw = env.DATABASE_URL?.trim() ?? "";
  if (raw.startsWith("file:")) {
    const filePath = raw.slice("file:".length).trim();
    if (filePath) return path.dirname(path.resolve(cwd, filePath));
  }
  if (raw.endsWith(".db") || raw.endsWith(".sqlite")) return path.dirname(path.resolve(cwd, raw));
  return path.resolve(cwd, CONFIG.DATABASE_DIR);
};

export const buildConversationWorkdirPath = (
  input: { storageRoot: string; userId: number; threadId: string },
  pathOps: Pick<typeof path, "resolve" | "join" | "relative" | "isAbsolute"> = path,
) => {
  assertValidUserId(input.userId);
  assertSafeThreadId(input.threadId);
  const root = pathOps.resolve(input.storageRoot);
  const candidate = pathOps.join(root, WORKDIR_ROOT_SEGMENT, `user-${input.userId}`, input.threadId);
  const relative = pathOps.relative(root, candidate);
  if (!relative || relative.startsWith("..") || pathOps.isAbsolute(relative)) fail("path_escape", "Conversation workdir path escapes app-data root");
  return candidate;
};

const fsCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const comparablePath = (
  value: string,
  pathOps: Pick<typeof path, "resolve"> = path,
  caseInsensitive = process.platform === "win32",
) => {
  const resolved = pathOps.resolve(value);
  // Windows filesystem paths are case-insensitive; compare their canonical
  // forms without allowing case-only differences to defeat containment checks.
  return caseInsensitive ? resolved.toLowerCase() : resolved;
};
const samePath = (left: string, right: string) => comparablePath(left) === comparablePath(right);
const mapFsFailure = (error: unknown, missing: ConversationWorkdirErrorCode = "unavailable") => {
  const code = fsCode(error);
  if (code === "ENOENT") return missing;
  return code === "EACCES" || code === "EPERM" || code === "EBUSY" ? "unavailable" : "unavailable";
};

const readRealpath = (target: string): string => {
  try { return fs.realpathSync(target); }
  catch (error) { return fail("unavailable", "Conversation workdir path is unavailable", error); }
};

export const isConversationWorkdirPathContained = (
  root: string,
  candidate: string,
  pathOps: Pick<typeof path, "resolve" | "relative" | "isAbsolute"> = path,
  caseInsensitive = process.platform === "win32",
) => {
  const relative = pathOps.relative(
    comparablePath(root, pathOps, caseInsensitive),
    comparablePath(candidate, pathOps, caseInsensitive),
  );
  return Boolean(relative) && !relative.startsWith("..") && !pathOps.isAbsolute(relative);
};

const contained = (root: string, candidate: string) => {
  if (!isConversationWorkdirPathContained(root, candidate)) fail("path_escape", "Conversation workdir path escapes app-data root");
};

const trustedRoot = (storageRoot: string, createMissing: boolean): string => {
  try {
    if (createMissing) fs.mkdirSync(storageRoot, { recursive: true });
    const stat = fs.statSync(storageRoot);
    if (!stat.isDirectory()) fail("invalid", "Conversation workdir app-data root is not a directory");
    return fs.realpathSync(storageRoot);
  } catch (error) {
    if (error instanceof ConversationWorkdirError) throw error;
    return fail(mapFsFailure(error, "missing"), "Conversation workdir app-data root is unavailable", error);
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
        return fail(mapFsFailure(mkdirError), "Conversation workdir path is unavailable", mkdirError);
      }
    } else {
      return fail(mapFsFailure(error, "missing"), "Conversation workdir path is unavailable", error);
    }
  }
  if (stat.isSymbolicLink()) fail("linked_path", "Conversation workdir path contains a symbolic link");
  if (!stat.isDirectory()) fail("invalid", "Conversation workdir path is not a directory");
};

const validateDirectory = (input: {
  storageRoot: string;
  userId: number;
  threadId: string;
  storedRootPath?: string;
  createMissing: boolean;
}) => {
  const root = trustedRoot(input.storageRoot, input.createMissing);
  const expected = buildConversationWorkdirPath({ storageRoot: root, userId: input.userId, threadId: input.threadId });
  if (input.storedRootPath !== undefined && !samePath(input.storedRootPath, expected)) fail("identity_conflict", "Conversation workdir identity conflicts with current app-data root");
  let current = root;
  for (const segment of [WORKDIR_ROOT_SEGMENT, `user-${input.userId}`, input.threadId]) {
    current = path.join(current, segment);
    inspectComponent(current, input.createMissing);
  }
  const real = readRealpath(current);
  contained(root, real);
  return { root, expected, real };
};

const scanBytes = (directory: string, root: string): number => {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (error) { return fail(mapFsFailure(error), "Conversation workdir directory is unavailable", error); }
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(entryPath); } catch (error) { return fail(mapFsFailure(error), "Conversation workdir entry is unavailable", error); }
    if (stat.isSymbolicLink()) fail("linked_path", "Conversation workdir contains a symbolic link");
    const real = readRealpath(entryPath);
    contained(root, real);
    if (stat.isDirectory()) total += scanBytes(entryPath, root);
    else if (stat.isFile()) total += stat.size;
    else fail("invalid", "Conversation workdir contains an unsupported filesystem entry");
  }
  return total;
};

const usageForUser = (input: { userId: number; storageRoot: string; quotaBytes: number }): ConversationWorkdirUsage => {
  const root = trustedRoot(input.storageRoot, false);
  const userRoot = path.join(root, WORKDIR_ROOT_SEGMENT, `user-${input.userId}`);
  try {
    const stat = fs.lstatSync(userRoot);
    if (stat.isSymbolicLink()) fail("linked_path", "Conversation workdir user root contains a symbolic link");
    if (!stat.isDirectory()) fail("invalid", "Conversation workdir user root is not a directory");
    const real = fs.realpathSync(userRoot);
    contained(root, real);
    return { userId: input.userId, bytes: scanBytes(userRoot, root), quotaBytes: input.quotaBytes };
  } catch (error) {
    if (fsCode(error) === "ENOENT") return { userId: input.userId, bytes: 0, quotaBytes: input.quotaBytes };
    if (error instanceof ConversationWorkdirError) throw error;
    return fail(mapFsFailure(error), "Conversation workdir user root is unavailable", error);
  }
};

const assertQuota = (usage: ConversationWorkdirUsage) => {
  if (usage.bytes > usage.quotaBytes) fail("quota_exhausted", `Conversation workdir quota exhausted (${usage.bytes}/${usage.quotaBytes} bytes)`);
};

const toReference = (row: ConversationWorkdir): ConversationWorkdirReference => ({ id: row.id, threadId: row.threadId, rootPath: row.rootPath });

const cleanupPhysical = (input: CleanupConversationWorkdirInput): ConversationWorkdirCleanupResult => {
  const row = conversationWorkdirRepository.findByThreadId(input.threadId, input.userId);
  if (!row) return { threadId: input.threadId, userId: input.userId, existed: false, removed: false };
  const storageRoot = input.storageRoot ?? resolveConversationWorkdirStorageRoot();
  let root: string;
  try {
    root = trustedRoot(storageRoot, false);
  } catch (error) {
    return fail(
      error instanceof ConversationWorkdirError ? error.code : "unavailable",
      "Conversation workdir cleanup root is unavailable",
      error,
    );
  }
  const expected = buildConversationWorkdirPath({ storageRoot: root, userId: input.userId, threadId: input.threadId });
  if (!samePath(row.rootPath, expected)) fail("identity_conflict", "Conversation workdir cleanup identity conflicts with app-data root");
  try { fs.lstatSync(expected); } catch (error) {
    if (fsCode(error) === "ENOENT") return { threadId: input.threadId, userId: input.userId, existed: true, removed: false };
    return fail(mapFsFailure(error), "Conversation workdir cleanup path is unavailable", error);
  }
  validateDirectory({ storageRoot: root, userId: input.userId, threadId: input.threadId, storedRootPath: row.rootPath, createMissing: false });
  try { fs.rmSync(expected, { recursive: true, force: false }); } catch (error) { fail("cleanup_failed", "Conversation workdir cleanup failed", error); }
  return { threadId: input.threadId, userId: input.userId, existed: true, removed: true };
};

export const conversationWorkdirService = {
  get(threadId: string, userId: number): ConversationWorkdirReference | null {
    if (!threadRepository.findById(threadId, userId)) return null;
    const row = conversationWorkdirRepository.findByThreadId(threadId, userId);
    return row ? toReference(row) : null;
  },

  usage(input: { userId: number; storageRoot?: string; quotaBytes?: number }): ConversationWorkdirUsage {
    assertValidUserId(input.userId);
    return usageForUser({ userId: input.userId, storageRoot: input.storageRoot ?? resolveConversationWorkdirStorageRoot(), quotaBytes: normalizeQuota(input.quotaBytes ?? resolveConversationWorkdirQuotaBytes()) });
  },

  ensure(input: EnsureConversationWorkdirInput): ConversationWorkdirReference {
    if (!threadRepository.findById(input.threadId, input.userId)) fail("thread_not_found", "Thread not found for conversation workdir");
    const storageRoot = input.storageRoot ?? resolveConversationWorkdirStorageRoot();
    const quotaBytes = normalizeQuota(input.quotaBytes ?? resolveConversationWorkdirQuotaBytes());
    const existing = conversationWorkdirRepository.findByThreadId(input.threadId, input.userId);
    if (existing) {
      let root: string;
      try {
        root = trustedRoot(storageRoot, false);
      } catch (error) {
        if (!(error instanceof ConversationWorkdirError) || error.code !== "missing") throw error;
        root = path.resolve(storageRoot);
      }
      const expectedFromConfiguredRoot = buildConversationWorkdirPath({
        storageRoot: root,
        userId: input.userId,
        threadId: input.threadId,
      });
      if (!samePath(existing.rootPath, expectedFromConfiguredRoot)) {
        fail("identity_conflict", "Conversation workdir identity conflicts with current app-data root");
      }
      const validated = validateDirectory({ storageRoot, userId: input.userId, threadId: input.threadId, storedRootPath: existing.rootPath, createMissing: false });
      if (!samePath(validated.real, existing.rootPath)) fail("identity_conflict", "Conversation workdir stored path is not canonical");
      assertQuota(this.usage({ userId: input.userId, storageRoot, quotaBytes }));
      return { ...toReference(existing), rootPath: validated.real };
    }
    const root = trustedRoot(storageRoot, true);
    const expected = buildConversationWorkdirPath({ storageRoot: root, userId: input.userId, threadId: input.threadId });
    try { fs.lstatSync(expected); fail("identity_conflict", "Conversation workdir path exists without persisted identity"); } catch (error) {
      if (error instanceof ConversationWorkdirError) throw error;
      if (fsCode(error) !== "ENOENT") fail(mapFsFailure(error), "Conversation workdir path is unavailable", error);
    }
    assertQuota(this.usage({ userId: input.userId, storageRoot, quotaBytes }));
    const validated = validateDirectory({ storageRoot, userId: input.userId, threadId: input.threadId, createMissing: true });
    const persisted = conversationWorkdirRepository.createForThread({ threadId: input.threadId, userId: input.userId, rootPath: validated.real });
    if (persisted.rootPath !== validated.real) fail("identity_conflict", "Conversation workdir identity conflicts with stored path");
    return toReference(persisted);
  },

  reopen(input: ReopenConversationWorkdirInput): ConversationWorkdirReference {
    if (!threadRepository.findById(input.threadId, input.userId)) fail("thread_not_found", "Thread not found for conversation workdir reopen");
    const row = conversationWorkdirRepository.findByThreadId(input.threadId, input.userId);
    if (!row) return fail("missing", "Conversation workdir identity is missing");
    const persisted = toReference(row);
    if (input.reference && (input.reference.id !== persisted.id || input.reference.threadId !== persisted.threadId || !samePath(input.reference.rootPath, persisted.rootPath))) fail("identity_conflict", "Conversation workdir runtime reference conflicts with persisted identity");
    const storageRoot = input.storageRoot ?? resolveConversationWorkdirStorageRoot();
    const validated = validateDirectory({ storageRoot, userId: input.userId, threadId: input.threadId, storedRootPath: row.rootPath, createMissing: false });
    if (!samePath(validated.real, row.rootPath)) fail("identity_conflict", "Conversation workdir stored path is not canonical");
    assertQuota(this.usage({ userId: input.userId, storageRoot, quotaBytes: input.quotaBytes }));
    return { ...persisted, rootPath: validated.real };
  },

  cleanup(input: CleanupConversationWorkdirInput): ConversationWorkdirCleanupResult {
    return cleanupPhysical(input);
  },
};
