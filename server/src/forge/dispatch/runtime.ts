import type { ForgeRuntime } from "../runtime/runtime.js";
import {
  createDefaultBuilderRunners,
  type BuilderRunnerRegistryOptions,
} from "../adapters/builder/index.js";
import {
  createDispatchManager,
  type ForgeDispatchManager,
} from "./manager.js";

export async function attachBuilderDispatchRuntime(
  runtime: ForgeRuntime,
  options: BuilderRunnerRegistryOptions = {},
): Promise<ForgeDispatchManager> {
  const manager = createDispatchManager({
    store: runtime.store,
    runners: createDefaultBuilderRunners(options),
  });

  await runtime.registerResource("forge-builder-dispatch", {
    reconcile: async () => {
      await manager.reconcile();
    },
    shutdown: () => manager.shutdown(),
  });

  return manager;
}
