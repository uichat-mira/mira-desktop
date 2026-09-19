import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversationArtifacts, type ConversationArtifact, type NewConversationArtifact } from "@/db/schema";

export const conversationArtifactRepository = {
  findById(id: string, userId: number): ConversationArtifact | undefined {
    return getDb().select().from(conversationArtifacts).where(and(eq(conversationArtifacts.id, id), eq(conversationArtifacts.userId, userId))).get();
  },
  create(input: NewConversationArtifact): ConversationArtifact {
    return getDb().insert(conversationArtifacts).values(input).returning().get();
  },
};
