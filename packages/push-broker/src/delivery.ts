import { openSecret } from "./crypto";
import type {
  BrokerPersistence,
  EventRecord,
  ProviderName,
} from "./persistence";
import type {
  ProviderDispatchResult,
  PushProviderAdapter,
} from "./provider-delivery";

const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 16;
const RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000, 960_000] as const;

export type ProviderRegistry = Partial<
  Record<"android" | "ios", PushProviderAdapter>
>;

export type DeliveryDrainResult = {
  delivered: number;
  retried: number;
  failed: number;
  waitingTokenRefresh: number;
  expired: number;
  nextWakeAt: string | null;
};

const providerForPlatform = (
  platform: "android" | "ios",
): ProviderName => (platform === "android" ? "fcm" : "apns");

const retryDelayMs = (
  attemptNo: number,
  providerRetryAfterMs: number | undefined,
) => {
  const base =
    RETRY_DELAYS_MS[
      Math.min(attemptNo - 1, RETRY_DELAYS_MS.length - 1)
    ] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  return Math.max(base, providerRetryAfterMs ?? 0);
};

export class BrokerDeliveryWorker {
  private inFlight: Promise<DeliveryDrainResult> | null = null;

  constructor(
    private readonly store: BrokerPersistence,
    private readonly storageKey: string,
    private readonly providers: ProviderRegistry,
    private readonly now: () => number = () => Date.now(),
  ) {}

  drain(): Promise<DeliveryDrainResult> {
    if (this.inFlight) return this.inFlight;
    const current = this.drainInternal().finally(() => {
      if (this.inFlight === current) this.inFlight = null;
    });
    this.inFlight = current;
    return current;
  }

  private async drainInternal(): Promise<DeliveryDrainResult> {
    const nowMs = this.now();
    const now = new Date(nowMs).toISOString();
    const expired = this.store.expireDue(now);
    const result: DeliveryDrainResult = {
      delivered: 0,
      retried: 0,
      failed: 0,
      waitingTokenRefresh: 0,
      expired,
      nextWakeAt: null,
    };

    let registration = this.store.getRegistration();
    if (!registration || registration.revokedAt) {
      result.nextWakeAt = this.store.getNextWakeAt(now);
      return result;
    }

    if (
      registration.providerTokenStatus !== "active" ||
      !registration.providerTokenCiphertext
    ) {
      result.waitingTokenRefresh =
        this.store.pausePendingForTokenRefresh(now);
      result.nextWakeAt = this.store.getNextWakeAt(now);
      return result;
    }

    let providerToken: string;
    try {
      providerToken = await openSecret(
        registration.providerTokenCiphertext,
        this.storageKey,
        registration.installationId,
      );
    } catch {
      await this.recordSyntheticRetry(
        this.store.listDueEvents(now, BATCH_LIMIT),
        providerForPlatform(registration.platform),
        "provider_token_unseal_failed",
        nowMs,
        result,
      );
      result.nextWakeAt = this.store.getNextWakeAt(now);
      return result;
    }

    const adapter = this.providers[registration.platform];
    if (!adapter) {
      await this.recordSyntheticRetry(
        this.store.listDueEvents(now, BATCH_LIMIT),
        providerForPlatform(registration.platform),
        "provider_not_configured",
        nowMs,
        result,
      );
      result.nextWakeAt = this.store.getNextWakeAt(now);
      return result;
    }

    const events = this.store.listDueEvents(now, BATCH_LIMIT);
    for (const event of events) {
      const outcome = await this.dispatch(
        adapter,
        registration.installationId,
        providerToken,
        event,
        nowMs,
      );
      const attemptNo = event.attemptCount + 1;
      const common = {
        eventId: event.eventId,
        attemptNo,
        provider: outcome.provider,
        providerRequestId: outcome.requestId,
        httpStatus: outcome.httpStatus,
        errorCode: "errorCode" in outcome ? outcome.errorCode : null,
        attemptedAt: now,
      } as const;

      if (outcome.type === "accepted") {
        this.store.recordDeliveryAttempt({
          ...common,
          outcome: "accepted",
          eventState: "delivered",
          nextAttemptAt: null,
          lastError: null,
        });
        result.delivered += 1;
        continue;
      }

      if (outcome.type === "invalid_token") {
        this.store.recordDeliveryAttempt({
          ...common,
          outcome: "invalid_token",
          eventState: "waiting_token_refresh",
          nextAttemptAt: null,
          lastError: outcome.errorCode,
          invalidateProviderToken: true,
        });
        result.waitingTokenRefresh += 1;
        break;
      }

      if (outcome.type === "rejected") {
        this.store.recordDeliveryAttempt({
          ...common,
          outcome: "rejected",
          eventState: "failed",
          nextAttemptAt: null,
          lastError: outcome.errorCode,
        });
        result.failed += 1;
        continue;
      }

      this.applyRetry(event, attemptNo, outcome, nowMs, common, result);
    }

    registration = this.store.getRegistration();
    if (
      registration?.providerTokenStatus === "refresh_required" ||
      !registration?.providerTokenCiphertext
    ) {
      result.waitingTokenRefresh +=
        this.store.pausePendingForTokenRefresh(now);
    }
    result.nextWakeAt = this.store.getNextWakeAt(now);
    return result;
  }

  private async dispatch(
    adapter: PushProviderAdapter,
    installationId: string,
    providerToken: string,
    event: EventRecord,
    nowMs: number,
  ): Promise<ProviderDispatchResult> {
    try {
      return await adapter.send({
        installationId,
        providerToken,
        event,
        nowMs,
      });
    } catch {
      return {
        type: "retryable",
        provider: adapter.provider,
        requestId: null,
        httpStatus: null,
        errorCode: "provider_adapter_error",
      };
    }
  }

  private applyRetry(
    event: EventRecord,
    attemptNo: number,
    outcome: Extract<ProviderDispatchResult, { type: "retryable" }>,
    nowMs: number,
    common: {
      eventId: string;
      attemptNo: number;
      provider: ProviderName;
      providerRequestId: string | null;
      httpStatus: number | null;
      errorCode: string | null;
      attemptedAt: string;
    },
    result: DeliveryDrainResult,
  ) {
    const delay = retryDelayMs(attemptNo, outcome.retryAfterMs);
    const nextMs = nowMs + delay;
    const expiresMs = Date.parse(event.expiresAt);
    if (attemptNo >= MAX_ATTEMPTS) {
      this.store.recordDeliveryAttempt({
        ...common,
        outcome: "retryable",
        eventState: "failed",
        nextAttemptAt: null,
        lastError: outcome.errorCode,
      });
      result.failed += 1;
      return;
    }
    if (nextMs >= expiresMs) {
      this.store.recordDeliveryAttempt({
        ...common,
        outcome: "retryable",
        eventState: "expired",
        nextAttemptAt: null,
        lastError: "event_ttl_expired",
      });
      result.expired += 1;
      return;
    }

    this.store.recordDeliveryAttempt({
      ...common,
      outcome: "retryable",
      eventState: "pending",
      nextAttemptAt: new Date(nextMs).toISOString(),
      lastError: outcome.errorCode,
    });
    result.retried += 1;
  }

  private async recordSyntheticRetry(
    events: EventRecord[],
    provider: ProviderName,
    errorCode: string,
    nowMs: number,
    result: DeliveryDrainResult,
  ) {
    for (const event of events) {
      const attemptNo = event.attemptCount + 1;
      this.applyRetry(
        event,
        attemptNo,
        {
          type: "retryable",
          provider,
          requestId: null,
          httpStatus: null,
          errorCode,
        },
        nowMs,
        {
          eventId: event.eventId,
          attemptNo,
          provider,
          providerRequestId: null,
          httpStatus: null,
          errorCode,
          attemptedAt: new Date(nowMs).toISOString(),
        },
        result,
      );
    }
  }
}
