import { describe, expect, it } from "vitest";
import { webFetchTool } from "../mcp/tools/web-fetch.tool.js";
import { createHarnessEnvironmentSnapshot } from "./environment.js";
import { projectToolRuntimeReadiness } from "./runtime-readiness.js";
import { resolveWebSearchHarnessRuntimeReadiness } from "./web-search-readiness.js";

describe("Harness runtime readiness", () => {
  it("keeps web_fetch independently ready without a search provider prerequisite", () => {
    const projected = projectToolRuntimeReadiness(webFetchTool.definition);

    expect(projected.runtimeReadiness).toEqual({
      state: "ready",
      reason: "Runtime prerequisites are satisfied.",
    });
  });

  it("projects secret-safe web_search readiness metadata", () => {
    const apiKey = "readiness-secret-key";
    const baseUrl = "https://private-search.example";
    const readiness = resolveWebSearchHarnessRuntimeReadiness(
      createHarnessEnvironmentSnapshot({
        toolConfig: {
          web_search: {
            apiKey,
            baseUrl,
          },
        },
      }),
    );

    expect(readiness.state).toBe("ready");
    const serialized = JSON.stringify(readiness);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(baseUrl);
    expect(serialized.toLowerCase()).not.toContain("tavily");
    expect(serialized.toLowerCase()).not.toContain("searxng");
  });
});
