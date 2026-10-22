import type { BrowserRuntimeResolver } from "../microapps/computer-use/browser/types.js";
import type {
  HarnessToolRuntimeReadiness,
  HarnessToolRuntimeReadinessResolver,
} from "./runtime-readiness.js";

export const resolveManagedBrowserHarnessRuntimeReadiness = (
  runtime: BrowserRuntimeResolver,
): HarnessToolRuntimeReadiness => {
  const resolved = runtime.resolveRuntime();

  if (resolved.status === "ready") {
    return {
      state: "ready",
      reason: "Managed browser runtime prerequisites are satisfied.",
    };
  }

  return {
    state: "unavailable",
    reason: resolved.reason,
    code: "browser_runtime_unavailable",
  };
};

export const createManagedBrowserRuntimeReadinessResolver = (
  runtime: BrowserRuntimeResolver,
): HarnessToolRuntimeReadinessResolver =>
  () => resolveManagedBrowserHarnessRuntimeReadiness(runtime);
