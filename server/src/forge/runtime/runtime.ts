import { resolveForgeStateFile } from "./persistence.js";
import { reconcileForgeRuntimeState, type ForgeStartupReconcileReport } from "./reconcile.js";
import { createForgeRuntimeStore, type ForgeRuntimeStore } from "./store.js";

export interface ForgeRuntimeManagedResource {
  reconcile?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface ForgeRuntimeInitReport {
  stateFile: string;
  reconcile: ForgeStartupReconcileReport;
}

export interface CreateForgeRuntimeOptions {
  stateFile?: string;
  store?: ForgeRuntimeStore;
}

export class ForgeRuntime {
  readonly store: ForgeRuntimeStore;
  private readonly resources = new Map<string, ForgeRuntimeManagedResource>();
  private initialized = false;
  private closed = false;
  private initReport: ForgeRuntimeInitReport | null = null;
  private initPromise: Promise<ForgeRuntimeInitReport> | null = null;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: CreateForgeRuntimeOptions = {}) {
    const store =
      options.store ??
      createForgeRuntimeStore(options.stateFile ?? resolveForgeStateFile());
    this.store = store;
  }

  get stateFile(): string {
    return this.store.filePath;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  async initialize(): Promise<ForgeRuntimeInitReport> {
    if (this.closed || this.shutdownPromise) {
      throw new Error("Forge runtime is closing or already closed");
    }
    if (this.initialized && this.initReport) {
      return this.initReport;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const reconcile = await this.store.mutate((state) =>
        reconcileForgeRuntimeState(state),
      );

      for (const resource of this.resources.values()) {
        await resource.reconcile?.();
      }

      this.initialized = true;
      this.initReport = {
        stateFile: this.store.filePath,
        reconcile,
      };
      return this.initReport;
    })();

    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async registerResource(
    name: string,
    resource: ForgeRuntimeManagedResource,
  ): Promise<void> {
    const id = name.trim();
    if (!id) throw new Error("Forge runtime resource name is required");
    if (this.closed || this.shutdownPromise) {
      throw new Error("Forge runtime is closing or already closed");
    }
    if (this.resources.has(id)) {
      throw new Error(`Forge runtime resource already registered: ${id}`);
    }

    this.resources.set(id, resource);
    if (this.initialized) {
      try {
        await resource.reconcile?.();
      } catch (error) {
        this.resources.delete(id);
        throw error;
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.shutdownPromise = (async () => {
      const errors: unknown[] = [];

      if (this.initPromise) {
        try {
          await this.initPromise;
        } catch (error) {
          errors.push(error);
        }
      }
      const resources = [...this.resources.entries()].reverse();

      for (const [, resource] of resources) {
        try {
          await resource.shutdown?.();
        } catch (error) {
          errors.push(error);
        }
      }

      this.resources.clear();

      try {
        await this.store.flush();
      } catch (error) {
        errors.push(error);
      }

      this.closed = true;
      this.initialized = false;

      if (errors.length > 0) {
        throw new AggregateError(errors, "Forge runtime shutdown failed");
      }
    })();

    return this.shutdownPromise;
  }
}

let activeForgeRuntime: ForgeRuntime | null = null;
let forgeRuntimeShutdownPromise: Promise<void> | null = null;

export async function initializeForgeRuntime(
  options: CreateForgeRuntimeOptions = {},
): Promise<ForgeRuntime> {
  if (forgeRuntimeShutdownPromise) {
    await forgeRuntimeShutdownPromise;
  }

  if (activeForgeRuntime) {
    await activeForgeRuntime.initialize();
    return activeForgeRuntime;
  }

  const runtime = new ForgeRuntime(options);
  activeForgeRuntime = runtime;

  try {
    await runtime.initialize();
    return runtime;
  } catch (error) {
    activeForgeRuntime = null;
    await runtime.shutdown().catch(() => undefined);
    throw error;
  }
}

export function getActiveForgeRuntime(): ForgeRuntime | null {
  return activeForgeRuntime;
}

export async function shutdownForgeRuntime(): Promise<void> {
  if (forgeRuntimeShutdownPromise) {
    return forgeRuntimeShutdownPromise;
  }

  const runtime = activeForgeRuntime;
  if (!runtime) return;

  activeForgeRuntime = null;
  forgeRuntimeShutdownPromise = runtime.shutdown().finally(() => {
    forgeRuntimeShutdownPromise = null;
  });
  return forgeRuntimeShutdownPromise;
}

export function resetForgeRuntimeForTests(): void {
  activeForgeRuntime = null;
  forgeRuntimeShutdownPromise = null;
}
