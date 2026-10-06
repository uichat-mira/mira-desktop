import {
  canonicalMessageCleanupRepository,
  type CanonicalMessageCleanupJob,
} from "@/db/repositories/canonical-message-cleanup.repository.js";
import { chatMediaService } from "@/services/chat-media.service.js";
import { removeFileAttachmentsFromParts } from "@/services/chat-file-context.service.js";

const RETRY_DELAYS_MS = [
  5_000,
  30_000,
  2 * 60_000,
  5 * 60_000,
  15 * 60_000,
] as const;
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const DEFAULT_POLL_INTERVAL_MS = 30_000;

type CleanupRepository = Pick<
  typeof canonicalMessageCleanupRepository,
  "listPending" | "remove" | "scheduleRetry" | "markFailed"
>;

export class CanonicalMessageCleanupService {
  private draining = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dependencies: {
      repository?: CleanupRepository;
      now?: () => number;
      pollIntervalMs?: number;
    } = {},
  ) {}

  drainOnce() {
    if (this.draining) {
      return { completed: 0, retried: 0, failed: 0 };
    }
    this.draining = true;

    const repository =
      this.dependencies.repository ?? canonicalMessageCleanupRepository;
    const nowMs = this.dependencies.now?.() ?? Date.now();
    const now = new Date(nowMs).toISOString();

    let completed = 0;
    let retried = 0;
    let failed = 0;

    try {
      const jobs = repository.listPending(now, 100);
      for (const job of jobs) {
        try {
          this.runJob(job);
          repository.remove(job.id);
          completed += 1;
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Canonical cleanup failed";
          const attemptCount = job.attemptCount + 1;
          if (attemptCount >= MAX_ATTEMPTS) {
            repository.markFailed(job.id, message, now);
            console.error("[canonical-cleanup] failed permanently", {
              jobId: job.id,
              error,
            });
            failed += 1;
            continue;
          }

          const delay =
            RETRY_DELAYS_MS[
              Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)
            ] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
          repository.scheduleRetry({
            id: job.id,
            attemptCount,
            nextAttemptAt: new Date(nowMs + delay).toISOString(),
            errorMessage: message,
            now,
          });
          console.warn("[canonical-cleanup] scheduled retry", {
            jobId: job.id,
            attemptCount,
            error,
          });
          retried += 1;
        }
      }

      return { completed, retried, failed };
    } finally {
      this.draining = false;
    }
  }

  start() {
    if (this.timer) return;
    this.drainOnce();
    this.timer = setInterval(
      () => this.drainOnce(),
      this.dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private runJob(job: CanonicalMessageCleanupJob) {
    chatMediaService.removeCleanupSnapshot(job.payload.media);
    removeFileAttachmentsFromParts(job.payload.attachmentParts);
  }
}

export const canonicalMessageCleanupService =
  new CanonicalMessageCleanupService();
