import { beforeEach, describe, expect, it, vi } from "vitest";

const taskModel = vi.hoisted(() => ({
  collectTaskModelText: vi.fn(),
}));

vi.mock("@/services/task-model.service.js", () => taskModel);

import { createTaskModelCapabilityResolver } from "./capability-resolution.semantic.js";

const capabilities = [
  {
    capabilityId: "news",
    title: "News",
    description: "Read general news.",
    domain: "read",
    tags: ["news"],
    toolIds: ["news"],
    aliases: ["news"],
  },
  {
    capabilityId: "news_research",
    title: "News Research",
    description: "Research and compare news sources.",
    domain: "web_search",
    tags: ["news", "research"],
    toolIds: ["news_research"],
    aliases: ["news_research"],
  },
] as const;

const candidates = [
  { capabilityId: "news", score: 1, reason: "ambiguous lexical match" },
  {
    capabilityId: "news_research",
    score: 1,
    reason: "ambiguous lexical match",
  },
] as const;

describe("task-model capability resolver parsing", () => {
  beforeEach(() => {
    taskModel.collectTaskModelText.mockReset();
  });

  it("accepts a single exact candidate id wrapped in punctuation", async () => {
    taskModel.collectTaskModelText.mockResolvedValue("`news_research`");
    const resolver = createTaskModelCapabilityResolver(capabilities);

    await expect(
      resolver({ query: "research the news", candidates }),
    ).resolves.toBe("news_research");
  });

  it("does not substring-match a sibling id when multiple candidate ids appear", async () => {
    taskModel.collectTaskModelText.mockResolvedValue(
      "news_research is better than news",
    );
    const resolver = createTaskModelCapabilityResolver(capabilities);

    await expect(
      resolver({ query: "research the news", candidates }),
    ).resolves.toBeUndefined();
  });

  it("matches the short sibling only when that exact id is the sole candidate token", async () => {
    taskModel.collectTaskModelText.mockResolvedValue("news");
    const resolver = createTaskModelCapabilityResolver(capabilities);

    await expect(
      resolver({ query: "show news", candidates }),
    ).resolves.toBe("news");
  });
});
