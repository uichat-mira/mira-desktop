import { randomUUID } from "node:crypto";

import { getSqlite } from "@/db/index.js";

export type CanonicalMessageCleanupPayload = {
  media: Array<{
    id: string;
    absolutePath: string;
  }>;
  attachmentParts: unknown[];
};

export type CanonicalMessageCleanupJob = {
  id: string;
  payload: CanonicalMessageCleanupPayload;
  state: "pending" | "failed";
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type CleanupRow = {
  id: string;
  payload_json: string;
  state: "pending" | "failed";
  attempt_count: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const parsePayload = (value: string): CanonicalMessageCleanupPayload => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Stored canonical cleanup payload is invalid");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored canonical cleanup payload is invalid");
  }

  const record = parsed as Record<string, unknown>;
  const media = record.media;
  const attachmentParts = record.attachmentParts;
  if (
    !Array.isArray(media) ||
    !Array.isArray(attachmentParts) ||
    media.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof (item as Record<string, unknown>).id !== "string" ||
        typeof (item as Record<string, unknown>).absolutePath !== "string",
    )
  ) {
    throw new Error("Stored canonical cleanup payload is invalid");
  }

  return {
    media: media.map((item) => ({
      id: (item as { id: string }).id,
      absolutePath: (item as { absolutePath: string }).absolutePath,
    })),
    attachmentParts,
  };
};

const toRecord = (row: CleanupRow): CanonicalMessageCleanupJob => ({
  id: row.id,
  payload: parsePayload(row.payload_json),
  state: row.state,
  attemptCount: row.attempt_count,
  nextAttemptAt: row.next_attempt_at,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const canonicalMessageCleanupRepository = {
  enqueue(
    payload: CanonicalMessageCleanupPayload,
    now = new Date().toISOString(),
  ): CanonicalMessageCleanupJob | null {
    if (payload.media.length === 0 && payload.attachmentParts.length === 0) {
      return null;
    }

    const id = randomUUID();
    getSqlite()
      .prepare(
        `INSERT INTO canonical_message_cleanup_jobs (
          id, payload_json, state, attempt_count, next_attempt_at,
          last_error, created_at, updated_at
        ) VALUES (?, ?, 'pending', 0, ?, NULL, ?, ?)`,
      )
      .run(id, JSON.stringify(payload), now, now, now);

    const row = getSqlite()
      .prepare(
        `SELECT id, payload_json, state, attempt_count, next_attempt_at,
                last_error, created_at, updated_at
         FROM canonical_message_cleanup_jobs
         WHERE id = ?`,
      )
      .get(id) as CleanupRow | undefined;
    if (!row) throw new Error("Failed to persist canonical cleanup job");
    return toRecord(row);
  },

  listPending(now = new Date().toISOString(), limit = 100) {
    const rows = getSqlite()
      .prepare(
        `SELECT id, payload_json, state, attempt_count, next_attempt_at,
                last_error, created_at, updated_at
         FROM canonical_message_cleanup_jobs
         WHERE state = 'pending' AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC, created_at ASC
         LIMIT ?`,
      )
      .all(now, limit) as CleanupRow[];
    return rows.map(toRecord);
  },

  remove(id: string) {
    return (
      getSqlite()
        .prepare("DELETE FROM canonical_message_cleanup_jobs WHERE id = ?")
        .run(id).changes > 0
    );
  },

  scheduleRetry(input: {
    id: string;
    attemptCount: number;
    nextAttemptAt: string;
    errorMessage: string;
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    return (
      getSqlite()
        .prepare(
          `UPDATE canonical_message_cleanup_jobs
           SET attempt_count = ?, next_attempt_at = ?, last_error = ?,
               updated_at = ?
           WHERE id = ? AND state = 'pending'`,
        )
        .run(
          input.attemptCount,
          input.nextAttemptAt,
          input.errorMessage.slice(0, 1000),
          now,
          input.id,
        ).changes > 0
    );
  },

  markFailed(
    id: string,
    errorMessage: string,
    now = new Date().toISOString(),
  ) {
    return (
      getSqlite()
        .prepare(
          `UPDATE canonical_message_cleanup_jobs
           SET state = 'failed', last_error = ?, updated_at = ?
           WHERE id = ? AND state = 'pending'`,
        )
        .run(errorMessage.slice(0, 1000), now, id).changes > 0
    );
  },
};
