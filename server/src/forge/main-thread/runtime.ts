import type { ForgeRuntime } from "../runtime/runtime.js";
import {
  createDefaultMainThreadAdapters,
  type MainThreadAdapterRegistryOptions,
} from "../adapters/main-thread/index.js";
import {
  createMainThreadManager,
  type MainThreadManager,
} from "./manager.js";

export async function attachMainThreadRuntime(
  runtime: ForgeRuntime,
  options: MainThreadAdapterRegistryOptions = {},
): Promise<MainThreadManager> {
  const manager = createMainThreadManager({
    store: runtime.store,
    adapters: createDefaultMainThreadAdapters(options),
  });
  await runtime.registerResource("forge-main-thread", {
    reconcile: async () => {
      await manager.reconcile();
    },
    shutdown: () => manager.shutdown(),
  });
  return manager;
}
