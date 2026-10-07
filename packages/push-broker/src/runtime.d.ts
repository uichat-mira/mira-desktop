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
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: Date | number): Promise<void>;
  deleteAlarm(): Promise<void>;
};

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
  waitUntil(promise: Promise<unknown>): void;
}

type DurableObjectId = object;

type DurableObjectStub = {
  fetch(request: Request): Promise<Response>;
};

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
