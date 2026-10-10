import { webSearchSettingsRepository } from "@/db/repositories/web-search-settings.repository.js";
import { resolveCodeGraphHarnessAvailability } from "./codegraph-capability.js";
import { listToolDefinitions } from "./registry.js";

/**
 * Authoritative runtime readiness for native Harness capabilities.
 *
 * Registration only means the Harness knows a Tool contract. It must not imply
 * that the current machine can execute the Tool successfully, and it must not
 * automatically make the Tool visible to the Agent. Readiness is deliberately
 * provider-neutral and secret-safe: it reports whether a prerequisite is
 * satisfied, never the credential or endpoint that satisfies it.
 */
export type NativeCapabilityReadinessState = "ready" | "blocked" | "unavailable";

export interface NativeCapabilityReadiness {
  state: NativeCapabilityReadinessState;
  reason?: string;
  missingPrerequisites: string[];
}

export interface NativeCapabilityReadinessProbes {
  webSearchProviderConfigured: () => boolean;
  codeGraphRuntimeAvailable: () => { available: boolean; reason?: string };
}

const hasConfiguredWebSearchProvider = () => {
  if (
    (process.env.TAVILY_API_KEY ?? "").trim() ||
    (process.env.SEARXNG_BASE_URL ?? "").trim()
  ) {
    return true;
  }

  try {
    const settings = webSearchSettingsRepository.get();
    return Boolean(settings.tavilyApiKey.trim()) || Boolean(settings.searxngBaseUrl.trim());
  } catch {
    // Database wiring is unavailable in this runtime context; the provider is
    // not verifiably configured, so readiness fails closed rather than
    // fabricating an available state.
    return false;
  }
};

export const defaultNativeCapabilityReadinessProbes: NativeCapabilityReadinessProbes = {
  webSearchProviderConfigured: hasConfiguredWebSearchProvider,
  codeGraphRuntimeAvailable: resolveCodeGraphHarnessAvailability,
};

const readyReadiness = (): NativeCapabilityReadiness => ({
  state: "ready",
  missingPrerequisites: [],
});

const blockedReadiness = (
  prerequisite: string,
  reason: string,
): NativeCapabilityReadiness => ({
  state: "blocked",
  reason,
  missingPrerequisites: [prerequisite],
});

export const resolveNativeCapabilityReadinessForTool = (
  toolId: string,
  probes: NativeCapabilityReadinessProbes = defaultNativeCapabilityReadinessProbes,
): NativeCapabilityReadiness => {
  switch (toolId) {
    case "web_search":
      return probes.webSearchProviderConfigured()
        ? readyReadiness()
        : blockedReadiness(
            "web_search_provider",
            "Web Search requires a configured provider: set a Tavily API key or a SearXNG base URL. web_fetch is unaffected.",
          );
    case "codebase_explore": {
      const availability = probes.codeGraphRuntimeAvailable();
      return availability.available
        ? readyReadiness()
        : blockedReadiness(
            "codegraph_runtime",
            availability.reason ??
              "CodeGraph runtime is not ready for this workspace.",
          );
    }
    default:
      // Tools without an external/runtime prerequisite are ready by definition.
      return readyReadiness();
  }
};

export const resolveNativeCapabilityReadiness = (
  toolIds: Iterable<string>,
  probes: NativeCapabilityReadinessProbes = defaultNativeCapabilityReadinessProbes,
): Record<string, NativeCapabilityReadiness> =>
  Object.fromEntries(
    [...toolIds].map((toolId) => [
      toolId,
      resolveNativeCapabilityReadinessForTool(toolId, probes),
    ]),
  );

export const resolveRegistryNativeCapabilityReadiness = (
  probes: NativeCapabilityReadinessProbes = defaultNativeCapabilityReadinessProbes,
): Record<string, NativeCapabilityReadiness> =>
  resolveNativeCapabilityReadiness(
    listToolDefinitions()
      .filter((definition) => definition.source === "internal")
      .map((definition) => definition.id),
    probes,
  );
