import fs from "node:fs";
import path from "node:path";
import CONFIG from "@/config/index.js";
import {
  conversationWorkdirRepository,
  threadRepository,
} from "@/db/repositories/index.js";
import type { ConversationWorkdir } from "@/db/schema.js";
import type { ConversationWorkdirReference } from "@/agent/types.js";

type PathOperations = Pick<
  typeof path,
  "resolve" | "join" | "relative" | "isAbsolute"
>;

export interface EnsureConversationWorkdirInput {
  threadId: string;
  userId: number;
  storageRoot?: string;
}

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const WORKDIR_ROOT_SEGMENT = "conversation-workdirs";

const assertSafeThreadId = (threadId: string) => {
  if (!threadId || !SAFE_SEGMENT.test(threadId)) {
    throw new Error("Conversation workdir thread id is invalid");
  }
};

const assertValidUserId = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("Conversation workdir user id is invalid");
  }
};

const assertContainedPath = (storageRoot: string, candidatePath: string) => {
  const relativePath = path.relative(storageRoot, candidatePath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Conversation workdir path escapes app-data root");
  }
};

const toReference = (row: ConversationWorkdir): ConversationWorkdirReference => ({
  id: row.id,
  threadId: row.threadId,
  rootPath: row.rootPath,
});

export const resolveConversationWorkdirStorageRoot = (
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) => {
  const configuredDatabaseDir = env.UI_CHAT_DATABASE_DIR?.trim();
  if (configuredDatabaseDir) {
    return path.resolve(cwd, configuredDatabaseDir);
  }

  const rawDatabaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (rawDatabaseUrl.startsWith("file:")) {
    const filePath = rawDatabaseUrl.slice("file:".length).trim();
    if (filePath) {
      return path.dirname(path.resolve(cwd, filePath));
    }
  }

  if (rawDatabaseUrl.endsWith(".db") || rawDatabaseUrl.endsWith(".sqlite")) {
    return path.dirname(path.resolve(cwd, rawDatabaseUrl));
  }

  return path.resolve(cwd, CONFIG.DATABASE_DIR);
};

export const buildConversationWorkdirPath = (
  input: {
    storageRoot: string;
    userId: number;
    threadId: string;
  },
  pathOps: PathOperations = path,
) => {
  assertValidUserId(input.userId);
  assertSafeThreadId(input.threadId);

  const storageRoot = pathOps.resolve(input.storageRoot);
  const workdirPath = pathOps.join(
    storageRoot,
    WORKDIR_ROOT_SEGMENT,
    `user-${input.userId}`,
    input.threadId,
  );
  const relativePath = pathOps.relative(storageRoot, workdirPath);

  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    pathOps.isAbsolute(relativePath)
  ) {
    throw new Error("Conversation workdir path escapes app-data root");
  }

  return workdirPath;
};

const resolveTrustedStorageRoot = (storageRoot: string) => {
  fs.mkdirSync(storageRoot, { recursive: true });

  let stat: fs.Stats;
  try {
    stat = fs.statSync(storageRoot);
  } catch {
    throw new Error("Conversation workdir app-data root is unavailable");
  }
  if (!stat.isDirectory()) {
    throw new Error("Conversation workdir app-data root is not a directory");
  }

  return fs.realpathSync(storageRoot);
};

const inspectDirectoryComponent = (
  directoryPath: string,
  createMissing: boolean,
) => {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(directoryPath);
  } catch (error) {
    if (
      !createMissing ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw new Error("Conversation workdir path is unavailable");
    }

    fs.mkdirSync(directoryPath);
    stat = fs.lstatSync(directoryPath);
  }

  if (stat.isSymbolicLink()) {
    throw new Error("Conversation workdir path contains a symbolic link");
  }
  if (!stat.isDirectory()) {
    throw new Error("Conversation workdir path is not a directory");
  }
};

const validateWorkdirDirectory = (input: {
  storageRoot: string;
  userId: number;
  threadId: string;
  storedRootPath?: string;
  createMissing: boolean;
}) => {
  const trustedStorageRoot = resolveTrustedStorageRoot(input.storageRoot);
  const expectedRootPath = buildConversationWorkdirPath({
    storageRoot: trustedStorageRoot,
    userId: input.userId,
    threadId: input.threadId,
  });

  if (
    input.storedRootPath !== undefined &&
    path.resolve(input.storedRootPath) !== path.resolve(expectedRootPath)
  ) {
    throw new Error(
      "Conversation workdir identity conflicts with current app-data root",
    );
  }

  let currentPath = trustedStorageRoot;
  for (const segment of [
    WORKDIR_ROOT_SEGMENT,
    `user-${input.userId}`,
    input.threadId,
  ]) {
    currentPath = path.join(currentPath, segment);
    inspectDirectoryComponent(currentPath, input.createMissing);
  }

  const realWorkdirPath = fs.realpathSync(currentPath);
  assertContainedPath(trustedStorageRoot, realWorkdirPath);

  return realWorkdirPath;
};

export const conversationWorkdirService = {
  get(threadId: string, userId: number): ConversationWorkdirReference | null {
    const thread = threadRepository.findById(threadId, userId);
    if (!thread) {
      return null;
    }

    const row = conversationWorkdirRepository.findByThreadId(threadId, userId);
    return row ? toReference(row) : null;
  },

  ensure(input: EnsureConversationWorkdirInput): ConversationWorkdirReference {
    const thread = threadRepository.findById(input.threadId, input.userId);
    if (!thread) {
      throw new Error("Thread not found for conversation workdir");
    }

    const storageRoot =
      input.storageRoot ?? resolveConversationWorkdirStorageRoot();
    const existing = conversationWorkdirRepository.findByThreadId(
      input.threadId,
      input.userId,
    );

    if (existing) {
      const validatedRootPath = validateWorkdirDirectory({
        storageRoot,
        userId: input.userId,
        threadId: input.threadId,
        storedRootPath: existing.rootPath,
        createMissing: false,
      });
      if (validatedRootPath !== existing.rootPath) {
        throw new Error("Conversation workdir stored path is not canonical");
      }
      return toReference(existing);
    }

    const rootPath = validateWorkdirDirectory({
      storageRoot,
      userId: input.userId,
      threadId: input.threadId,
      createMissing: true,
    });

    const persisted = conversationWorkdirRepository.createForThread({
      threadId: input.threadId,
      userId: input.userId,
      rootPath,
    });

    if (persisted.rootPath !== rootPath) {
      throw new Error("Conversation workdir identity conflicts with stored path");
    }

    return toReference(persisted);
  },
};
