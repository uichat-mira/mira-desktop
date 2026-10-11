import { describe, expect, it, vi } from "vitest";
import { SkillContextProvider } from "./provider.js";
import { SkillLoader } from "./loader.js";
import { SkillMatcher } from "./matcher.js";
import { SkillRegistry, type SkillScanner } from "./scanner.js";
import type { SkillManifest } from "./types.js";

/**
 * #309 acceptance gate: exercise the production SkillContextProvider, not the
 * isolated disclosure projection. These intentionally fail until the live
 * Main Agent startup/disclosure seam implements summary discoverability.
 * Known, confidently matched Skills may still use the direct-body fast path.
 *
 * A passing disclosure.ts unit test is not sufficient: the model must be able
 * to discover a Skill before its SKILL.md has been read.
 */
const manifests: SkillManifest[] = [
  {
    id: "xlsx",
    name: "Excel models",
    description: "Spreadsheet and DCF financial modelling",
    version: "1.0.0",
    entry: "/unused/xlsx/SKILL.md",
  },
  {
    id: "docx",
    name: "Word documents",
    description: "Draft and review Word documents",
    version: "1.0.0",
    entry: "/unused/docx/SKILL.md",
  },
];

const createProvider = () => {
  const loader = {
    listResources: vi.fn(async () => []),
    loadContent: vi.fn(async (manifest: SkillManifest) => ({
      manifest,
      body: `# ${manifest.id} private Skill body`,
    })),
  };
  const scanner = {
    scan: async () => manifests,
  } as unknown as SkillScanner;
  return {
    provider: new SkillContextProvider(
      new SkillRegistry(scanner),
      new SkillMatcher(),
      loader as unknown as SkillLoader,
    ),
    loader,
  };
};

describe("#309 production Skill progressive disclosure acceptance", () => {
  it("makes a compact Skill catalog discoverable without a deterministic primary match or any body read", async () => {
    const { provider, loader } = createProvider();
    const query = "帮我分析一下这个问题";
    const context = await provider.prepare({
      query,
      messages: [{ role: "user", content: query }],
    });

    // No deterministic match must not make every Skill disappear from the
    // Main Agent's discoverable catalog. The model needs the summaries first.
    expect(context?.skillVisibility?.skills.map((entry) => ({
      skillId: entry.skillId,
      description: entry.description,
      disclosure: entry.disclosure,
    }))).toEqual([
      { skillId: "xlsx", description: manifests[0]!.description, disclosure: "summary" },
      { skillId: "docx", description: manifests[1]!.description, disclosure: "summary" },
    ]);
    expect(context?.primary).toBeUndefined();
    expect(loader.loadContent).not.toHaveBeenCalled();
  });

  it("preserves the direct selected-Skill fast path without loading unrelated Skill bodies", async () => {
    const { provider, loader } = createProvider();
    const query = "做一个 DCF Excel 模型";
    const context = await provider.prepare({
      query,
      messages: [{ role: "user", content: query }],
    });

    // A confidently matched Skill may be promoted directly: #309 must not
    // penalize the established deterministic fast path for known tasks.
    expect(context?.primary?.id).toBe("xlsx");
    expect(context?.skillVisibility?.skills.find(
      (entry) => entry.skillId === "xlsx",
    )?.disclosure).toBe("body");
    expect(context?.skillVisibility?.skills.find(
      (entry) => entry.skillId === "docx",
    )?.disclosure).toBe("summary");
    expect(loader.loadContent).toHaveBeenCalledTimes(1);
    expect(loader.loadContent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "xlsx" }),
    );
  });
});
