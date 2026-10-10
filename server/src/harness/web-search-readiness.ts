import type { ToolExecutionEnvironment } from "../mcp/core/definitions.js";
import { resolveWebSearchProviderAvailability } from "../mcp/web/search.js";
import { createHarnessEnvironmentSnapshot } from "./environment.js";
import type { HarnessToolRuntimeReadiness } from "./runtime-readiness.js";

export const resolveWebSearchHarnessRuntimeReadiness = (
  environment: ToolExecutionEnvironment = createHarnessEnvironmentSnapshot(),
): HarnessToolRuntimeReadiness =>
  resolveWebSearchProviderAvailability(environment)
    ? {
        state: "ready",
        reason: "Web search runtime prerequisites are satisfied.",
      }
    : {
        state: "unavailable",
        reason:
          "Web search is unavailable until a usable search provider is configured.",
        code: "web_search_provider_unavailable",
      };
