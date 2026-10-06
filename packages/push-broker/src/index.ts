import { DurableObject } from "cloudflare:workers";

import { SqlBrokerPersistence, type SqlStorageLike } from "./persistence";
import { BrokerService } from "./service";

const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;

type Env = {
  PUSH_INSTALLATIONS: DurableObjectNamespace;
  BROKER_STORAGE_KEY: string;
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

export class PushInstallation extends DurableObject<Env> {
  private readonly service: BrokerService;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const store = new SqlBrokerPersistence(
      ctx.storage as unknown as SqlStorageLike,
    );
    this.service = new BrokerService(store, env.BROKER_STORAGE_KEY);
  }

  fetch(request: Request): Promise<Response> {
    const parsed = parseInstallationPath(new URL(request.url).pathname);
    if (!parsed || !INSTALLATION_ID_PATTERN.test(parsed.installationId)) {
      return Promise.resolve(json({ error: "not_found" }, 404));
    }
    return this.service.handle(request, parsed.installationId);
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
