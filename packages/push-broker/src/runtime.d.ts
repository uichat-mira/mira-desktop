declare module "cloudflare:workers" {
  export class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

type DurableObjectSqlCursor<T> = {
  toArray(): T[];
};

type DurableObjectSqlStorage = {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): DurableObjectSqlCursor<T>;
};

type DurableObjectStorage = {
  readonly sql: DurableObjectSqlStorage;
};

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
}

type DurableObjectId = object;

type DurableObjectStub = {
  fetch(request: Request): Promise<Response>;
};

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
