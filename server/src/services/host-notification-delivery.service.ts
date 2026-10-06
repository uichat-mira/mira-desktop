import {
  hostNotificationRepository,
  type HostNotificationBindingRecord,
  type NotificationOutboxRecord,
} from "@/db/repositories/host-notification.repository.js";
import {
  hostNotificationIdentityService,
  type HostNotificationEvent,
} from "@/services/host-notification-identity.service.js";
import { getConfiguredPushBrokerBaseUrl } from "@/services/host-notification-config.js";

const RETRY_DELAYS_MS = [
  5_000,
  30_000,
  2 * 60_000,
  5 * 60_000,
  15 * 60_000,
] as const;
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const BROKER_REQUEST_TIMEOUT_MS = 10_000;

type DeliveryRepository = Pick<
  typeof hostNotificationRepository,
  | "expireDue"
  | "listPending"
  | "isCanonicalDeliveryEligible"
  | "getBinding"
  | "markExpired"
  | "markDelivered"
  | "markFailed"
  | "scheduleRetry"
>;

type SigningIdentity = Pick<
  typeof hostNotificationIdentityService,
  "getOrCreateIdentity" | "signEvent"
>;

const isRetryableStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const errorMessageForResponse = (status: number) =>
  `Push Broker rejected event with HTTP ${status}`;

export class HostNotificationDeliveryService {
  private draining = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dependencies: {
      repository?: DeliveryRepository;
      identity?: SigningIdentity;
      fetchImpl?: typeof fetch;
      brokerBaseUrl?: () => string;
      now?: () => number;
      pollIntervalMs?: number;
    } = {},
  ) {}

  async drainOnce() {
    if (this.draining) return { delivered: 0, retried: 0, failed: 0 };
    this.draining = true;

    const repository =
      this.dependencies.repository ?? hostNotificationRepository;
    const identity =
      this.dependencies.identity ?? hostNotificationIdentityService;
    const fetchImpl = this.dependencies.fetchImpl ?? fetch;
    const nowMs = this.dependencies.now?.() ?? Date.now();
    const now = new Date(nowMs).toISOString();

    let delivered = 0;
    let retried = 0;
    let failed = 0;

    try {
      repository.expireDue(now);
      const pending = repository.listPending(now, 100);
      for (const event of pending) {
        let outcome:
          | { type: "delivered" }
          | { type: "expired"; message: string }
          | { type: "failed"; message: string }
          | {
              type: "retry";
              attemptCount: number;
              nextAttemptAt: string;
              message: string;
            };

        try {
          const binding = repository.getBinding(event.installationId);
          if (!binding || binding.status !== "active") {
            outcome = {
              type: "failed",
              message: "Notification binding is unavailable or revoked",
            };
          } else if (!repository.isCanonicalDeliveryEligible(event, binding)) {
            outcome = {
              type: "expired",
              message:
                "Canonical message or binding authority is no longer eligible",
            };
          } else {
            const deliveryOutcome = await this.deliverOne({
              event,
              binding,
              identity,
              fetchImpl,
              brokerBaseUrl:
                this.dependencies.brokerBaseUrl ??
                getConfiguredPushBrokerBaseUrl,
            });

            if (deliveryOutcome === "delivered") {
              outcome = { type: "delivered" };
            } else if (deliveryOutcome.retryable) {
              const attemptCount = event.attemptCount + 1;
              if (attemptCount >= MAX_ATTEMPTS) {
                outcome = {
                  type: "failed",
                  message: deliveryOutcome.message,
                };
              } else {
                const delay =
                  RETRY_DELAYS_MS[
                    Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)
                  ] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
                const nextAttemptAt = new Date(nowMs + delay).toISOString();
                outcome =
                  Date.parse(event.expiresAt) <= Date.parse(nextAttemptAt)
                    ? {
                        type: "failed",
                        message: "Notification retry would exceed event TTL",
                      }
                    : {
                        type: "retry",
                        attemptCount,
                        nextAttemptAt,
                        message: deliveryOutcome.message,
                      };
              }
            } else {
              outcome = {
                type: "failed",
                message: deliveryOutcome.message,
              };
            }
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          outcome = {
            type: "failed",
            message: `Notification delivery preparation failed: ${message}`,
          };
        }

        if (outcome.type === "delivered") {
          // State writes stay outside the preparation/delivery catch. If this
          // write fails after Broker acceptance, keep the row pending so the
          // next drain can safely replay the same idempotent event.
          repository.markDelivered(event.id, now);
          delivered += 1;
          continue;
        }

        if (outcome.type === "expired") {
          repository.markExpired(event.id, outcome.message, now);
          continue;
        }

        if (outcome.type === "retry") {
          repository.scheduleRetry({
            id: event.id,
            attemptCount: outcome.attemptCount,
            nextAttemptAt: outcome.nextAttemptAt,
            errorMessage: outcome.message,
            now,
          });
          retried += 1;
          continue;
        }

        repository.markFailed(event.id, outcome.message, now);
        failed += 1;
      }

      return { delivered, retried, failed };
    } finally {
      this.draining = false;
    }
  }

  start() {
    if (this.timer) return;
    const tick = () => {
      void this.drainOnce().catch((error) => {
        console.error("[host-notification] outbox drain failed", { error });
      });
    };
    tick();
    this.timer = setInterval(
      tick,
      this.dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async deliverOne(input: {
    event: NotificationOutboxRecord;
    binding: HostNotificationBindingRecord;
    identity: SigningIdentity;
    fetchImpl: typeof fetch;
    brokerBaseUrl: () => string;
  }): Promise<
    | "delivered"
    | {
        retryable: boolean;
        message: string;
      }
  > {
    const identity = input.identity.getOrCreateIdentity();
    const unsigned: HostNotificationEvent = {
      schemaVersion: 1,
      eventType: "assistant-message",
      installationId: input.event.installationId,
      eventId: input.event.id,
      hostId: identity.hostId,
      sourceId: input.event.sourceId,
      canonicalMessageId: input.event.canonicalMessageId,
      eligibilityEvent: "final_transition_first_seen",
      occurredAt: input.event.createdAt,
      expiresAt: input.event.expiresAt,
    };
    const hostSignature = input.identity.signEvent(unsigned);

    try {
      const brokerBaseUrl = input.brokerBaseUrl();
      const response = await input.fetchImpl(
        `${brokerBaseUrl}/v1/installations/${encodeURIComponent(
          input.event.installationId,
        )}/events`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.binding.deliveryToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...unsigned,
            hostSignature,
          }),
          signal: AbortSignal.timeout(BROKER_REQUEST_TIMEOUT_MS),
        },
      );

      if (response.ok) return "delivered";
      return {
        retryable: isRetryableStatus(response.status),
        message: errorMessageForResponse(response.status),
      };
    } catch (error) {
      return {
        retryable: true,
        message:
          error instanceof Error
            ? `Push Broker transport failed: ${error.message}`
            : "Push Broker transport failed",
      };
    }
  }
}

export const hostNotificationDeliveryService =
  new HostNotificationDeliveryService();
