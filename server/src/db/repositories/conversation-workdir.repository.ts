import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  conversationWorkdirs,
  type ConversationWorkdir,
  type NewConversationWorkdir,
} from "@/db/schema";
import { nowIso } from "@/utils/time.js";

const findByThreadId = (
  threadId: string,
  userId?: number,
): ConversationWorkdir | undefined => {
  const conditions = [eq(conversationWorkdirs.threadId, threadId)];
  if (typeof userId === "number") {
    conditions.push(eq(conversationWorkdirs.userId, userId));
  }

  return getDb()
    .select()
    .from(conversationWorkdirs)
    .where(and(...conditions))
    .limit(1)
    .get();
};

export const conversationWorkdirRepository = {
  findByThreadId,

  createForThread(
    data: Omit<NewConversationWorkdir, "id" | "createdAt" | "updatedAt">,
  ): ConversationWorkdir {
    const now = nowIso();
    const created = getDb()
      .insert(conversationWorkdirs)
      .values({
        ...data,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: conversationWorkdirs.threadId,
      })
      .returning()
      .get();

    const workdir = created ?? findByThreadId(data.threadId, data.userId);
    if (!workdir) {
      throw new Error("Conversation workdir could not be persisted");
    }
    return workdir;
  },
};
