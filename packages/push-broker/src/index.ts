import { DurableObject } from "cloudflare:workers";

import { BrokerDeliveryWorker } from "./delivery";
import {
  ApnsProviderAdapter,
  FcmProviderAdapter,
  type PushProviderAdapter,
} from "./provider-delivery";
import { SqlBrokerPersistence, type SqlStorageLike } from "./persistence";
import { BrokerService } from "./service";

const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;
const WORKER_RETRY_DELAY_MS = 60_000;

type Env = {
  PUSH_INSTALLATIONS: DurableObjectNamespace;
  BROKER_STORAGE_KEY: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
  APNS_TEAM_ID?: string;
  APNS_KEY_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_TOPIC?: string;
  APNS_ENVIRONMENT?: string;
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const parseInstallationPath = (pathname: string) => {
  const matched = pathname.match(
    /^\/v1\/installations\/([A-Za-z0-9._:-]{1,160})(\/.*)$/u,
  );
  if (!matched?.[1] || !matched[2]) return null;
  return { installationId: matched[1], suffix: matched[2] };
};

const createProviders = (env: Env) => {
  const providers: Partial<
    Record<"android" | "ios", PushProviderAdapter>
  > = {};
  if (env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) {
    providers.android = new FcmProviderAdapter({
      projectId: env.FCM_PROJECT_ID,
      clientEmail: env.FCM_CLIENT_EMAIL,
      privateKeyPem: env.FCM_PRIVATE_KEY,
    });
  }
  if (
    env.APNS_TEAM_ID &&
    env.APNS_KEY_ID &&
    env.APNS_PRIVATE_KEY &&
    env.APNS_TOPIC &&
    (env.APNS_ENVIRONMENT === "production" ||
      env.APNS_ENVIRONMENT === "sandbox")
  ) {
    providers.ios = new ApnsProviderAdapter({
      teamId: env.APNS_TEAM_ID,
      keyId: env.APNS_KEY_ID,
      privateKeyPem: env.APNS_PRIVATE_KEY,
      topic: env.APNS_TOPIC,
      environment: env.APNS_ENVIRONMENT,
    });
  }
  return providers;
};

export class PushInstallation extends DurableObject<Env> {
  private readonly service: BrokerService;
  private readonly delivery: BrokerDeliveryWorker;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const store = new SqlBrokerPersistence(
      ctx.storage as unknown as SqlStorageLike,
    );
    this.service = new BrokerService(store, env.BROKER_STORAGE_KEY);
    this.delivery = new BrokerDeliveryWorker(
      store,
      env.BROKER_STORAGE_KEY,
      createProviders(env),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const parsed = parseInstallationPath(new URL(request.url).pathname);
    if (!parsed || !INSTALLATION_ID_PATTERN.test(parsed.installationId)) {
      return json({ error: "not_found" }, 404);
    }
    const response = await this.service.handle(request, parsed.installationId);
    if (request.method === "POST") {
      this.ctx.waitUntil(this.runDeliveryWorker());
    }
    return response;
  }

  async alarm(): Promise<void> {
    await this.runDeliveryWorker();
  }

  private async runDeliveryWorker() {
    try {
      const result = await this.delivery.drain();
      await this.scheduleNextAlarm(result.nextWakeAt);
    } catch {
      console.error("[push-broker] delivery worker failed");
      await this.ctx.storage.setAlarm(Date.now() + WORKER_RETRY_DELAY_MS);
    }
  }

  private async scheduleNextAlarm(nextWakeAt: string | null) {
    if (!nextWakeAt) {
      if ((await this.ctx.storage.getAlarm()) !== null) {
        await this.ctx.storage.deleteAlarm();
      }
      return;
    }
    const time = Date.parse(nextWakeAt);
    if (!Number.isFinite(time)) {
      console.error("[push-broker] invalid delivery wake timestamp");
      await this.ctx.storage.setAlarm(Date.now() + WORKER_RETRY_DELAY_MS);
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(Date.now(), time));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "mira-push-broker",
        protocolVersion: 1,
      });
    }

    const parsed = parseInstallationPath(url.pathname);
    if (!parsed || !INSTALLATION_ID_PATTERN.test(parsed.installationId)) {
      return json({ error: "not_found" }, 404);
    }
    if (!env.BROKER_STORAGE_KEY) {
      return json({ error: "broker_not_configured" }, 503);
    }

    const id = env.PUSH_INSTALLATIONS.idFromName(parsed.installationId);
    return env.PUSH_INSTALLATIONS.get(id).fetch(request);
  },
};
