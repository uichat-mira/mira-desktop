import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { webSearchTool } from "./web-search.tool.js";

const webSearchSettingsMock = vi.hoisted(() => ({
  get: vi.fn(() => ({
    tavilyApiKey: "stored-key",
    searxngBaseUrl: "",
    maxResults: 4,
  })),
}));

const newsSearchMock = vi.hoisted(() => ({
  hasNewsIntent: vi.fn(() => true),
  searchNewsHubCache: vi.fn(async () => ({
    results: [{ title: "cached", link: "cached", snippet: "cached" }],
    diagnostics: {},
  })),
}));

vi.mock("@/db/repositories/web-search-settings.repository.js", () => ({
  webSearchSettingsRepository: webSearchSettingsMock,
}));
vi.mock("@/microapps/news-hub/news-search.adapter.js", () => newsSearchMock);

describe("web/news search separation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses public web providers even for news-like wording and never consults News Hub", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "Live result",
            url: "https://example.com/live",
            content: "live web result",
          },
        ],
      }),
    } as Response);

    const result = await webSearchTool.execute({
      invocationId: "web-news-separation",
      args: { queries: ["latest AI news"] },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "artifact-web", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-web",
            end() {},
          };
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(newsSearchMock.hasNewsIntent).not.toHaveBeenCalled();
    expect(newsSearchMock.searchNewsHubCache).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      queries: ["latest AI news"],
    });
    expect(result.structuredContent).not.toHaveProperty("provider");
    expect(result.structuredContent).not.toHaveProperty("capabilityId");
  });
});
