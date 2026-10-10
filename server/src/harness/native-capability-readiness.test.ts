import { beforeEach, describe, expect, it } from "vitest";
import { webFetchTool } from "../mcp/tools/web-fetch.tool.js";
import { webSearchTool } from "../mcp/tools/web-search.tool.js";
import {
  resolveNativeCapabilityReadiness,
  resolveNativeCapabilityReadinessForTool,
  resolveRegistryNativeCapabilityReadiness,
  type NativeCapabilityReadinessProbes,
} from "./native-capability-readiness.js";
import { clearHarnessRegistry, registerTool } from "./registry.js";

const createProbes = (
  overrides: Partial<NativeCapabilityReadinessProbes> = {},
): NativeCapabilityReadinessProbes => ({
  webSearchProviderConfigured: () => false,
  codeGraphRuntimeAvailable: () => ({ available: false, reason: "CodeGraph runtime is unavailable." }),
  ...overrides,
});

describe("native capability readiness", () => {
  beforeEach(() => {
    clearHarnessRegistry();
  });

  it("blocks web_search while keeping web_fetch independently ready", () => {
    const readiness = resolveNativeCapabilityReadiness(
      ["web_search", "web_fetch"],
      createProbes(),
    );

    expect(readiness.web_search).toMatchObject({
      state: "blocked",
      missingPrerequisites: ["web_search_provider"],
    });
    expect(readiness.web_fetch).toEqual({ state: "ready", missingPrerequisites: [] });
  });

  it("promotes web_search to ready once a provider is configured", () => {
    const blocked = resolveNativeCapabilityReadinessForTool(
      "web_search",
      createProbes({ webSearchProviderConfigured: () => false }),
    );
    const ready = resolveNativeCapabilityReadinessForTool(
      "web_search",
      createProbes({ webSearchProviderConfigured: () => true }),
    );

    expect(blocked.state).toBe("blocked");
    expect(ready).toEqual({ state: "ready", missingPrerequisites: [] });
  });

  it("applies the same readiness contract to the CodeGraph-backed capability", () => {
    const blocked = resolveNativeCapabilityReadinessForTool(
      "codebase_explore",
      createProbes({
        codeGraphRuntimeAvailable: () => ({ available: false, reason: "Index missing." }),
      }),
    );
    const ready = resolveNativeCapabilityReadinessForTool(
      "codebase_explore",
      createProbes({ codeGraphRuntimeAvailable: () => ({ available: true }) }),
    );

    expect(blocked).toEqual({
      state: "blocked",
      reason: "Index missing.",
      missingPrerequisites: ["codegraph_runtime"],
    });
    expect(ready).toEqual({ state: "ready", missingPrerequisites: [] });
  });

  it("projects registry readiness without exposing provider secrets", () => {
    registerTool(webSearchTool);
    registerTool(webFetchTool);

    const readiness = resolveRegistryNativeCapabilityReadiness(createProbes());

    expect(Object.keys(readiness).sort()).toEqual(["web_fetch", "web_search"]);
    expect(readiness.web_search?.state).toBe("blocked");
    expect(readiness.web_fetch?.state).toBe("ready");
    expect(JSON.stringify(readiness)).not.toMatch(
      /bearerToken|customHeaders|envJson|apiKey|top-secret-token/i,
    );
  });
});
