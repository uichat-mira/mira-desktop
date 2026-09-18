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
    "conversation-workdirs",
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

const assertExistingDirectory = (rootPath: string) => {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(rootPath);
  } catch {
    throw new Error("Conversation workdir path is unavailable");
  }

  if (!stat.isDirectory()) {
    throw new Error("Conversation workdir path is not a directory");
  }
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

    const existing = conversationWorkdirRepository.findByThreadId(
      input.threadId,
      input.userId,
    );
    if (existing) {
      assertExistingDirectory(existing.rootPath);
      return toReference(existing);
    }

    const storageRoot =
      input.storageRoot ?? resolveConversationWorkdirStorageRoot();
    const rootPath = buildConversationWorkdirPath({
      storageRoot,
      userId: input.userId,
      threadId: input.threadId,
    });

    fs.mkdirSync(rootPath, { recursive: true });
    assertExistingDirectory(rootPath);

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
