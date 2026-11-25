import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  remoteThreadWorkspaces,
  type RemoteThreadWorkspace,
} from "@/db/schema";

export type RemoteThreadWorkspaceRow = RemoteThreadWorkspace;

export const remoteThreadWorkspaceRepository = {
  getByThread(threadId: string): RemoteThreadWorkspaceRow | undefined {
    return getDb()
      .select()
      .from(remoteThreadWorkspaces)
      .where(eq(remoteThreadWorkspaces.threadId, threadId))
      .limit(1)
      .get();
  },

  /**
   * The Desktop owns the first successful binding. Concurrent first calls must
   * converge on the same row instead of creating a second space.
   */
  insertIfAbsent(
    input: Omit<RemoteThreadWorkspaceRow, "createdAt"> & { createdAt?: string },
  ): RemoteThreadWorkspaceRow {
    getDb()
      .insert(remoteThreadWorkspaces)
      .values(input)
      .onConflictDoNothing()
      .run();

    const stored = this.getByThread(input.threadId);
    if (!stored) {
      throw new Error("Remote thread workspace binding could not be stored");
    }
    return stored;
  },

  markEnded(input: {
    threadId: string;
    userId: number;
    endedAt: string;
  }): RemoteThreadWorkspaceRow | undefined {
    getDb()
      .update(remoteThreadWorkspaces)
      .set({ status: "ended", endedAt: input.endedAt })
      .where(eq(remoteThreadWorkspaces.threadId, input.threadId))
      .run();

    const stored = this.getByThread(input.threadId);
    return stored?.userId === input.userId ? stored : undefined;
  },
};
