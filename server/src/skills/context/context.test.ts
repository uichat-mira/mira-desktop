import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillLoader } from "./loader.js";
import { SkillMatcher } from "./matcher.js";
import { SkillContextProvider } from "./provider.js";
import { SkillRegistry, type SkillScanner } from "./scanner.js";
import type { SkillManifest } from "./types.js";

const manifests: SkillManifest[] = [
  {
    id: "docx",
    name: "Word 文档处理",
    description: "Create and review DOCX documents",
    version: "1.0.0",
    entry: "/skills/docx/SKILL.md",
  },
  {
    id: "xlsx",
    name: "Excel 处理",
    description: "Create Excel workbooks and financial models",
    version: "1.0.0",
    entry: "/skills/xlsx/SKILL.md",
  },
  {
    id: "pdf",
    name: "PDF 文档处理",
    description: "Create and process PDF files",
    version: "1.0.0",
    entry: "/skills/pdf/SKILL.md",
  },
  {
    id: "pptx",
    name: "PowerPoint 处理",
    description: "Create PowerPoint presentations",
    version: "1.0.0",
    entry: "/skills/pptx/SKILL.md",
  },
];

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("SkillMatcher", () => {
  it("prefers deterministic attachment type over ambiguous text", () => {
    const matcher = new SkillMatcher();
    const result = matcher.match({
      query: "帮我审一下这个",
      manifests,
      messages: [
        {
          role: "user",
          content: "帮我审一下这个",
          parts: [
            { type: "text", text: "帮我审一下这个" },
            {
              type: "file",
              filename: "contract.docx",
              mimeType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              data: "file-ref",
            },
          ],
        },
      ],
    });

    expect(result.primary?.skillId).toBe("docx");
    expect(result.primary?.source).toBe("resource");
  });

  it("matches DCF requests to xlsx without auto-loading secondary skills", () => {
    const matcher = new SkillMatcher();
    const result = matcher.match({
      query: "给我做一个 DCF Excel 模型，再准备后续汇报思路",
      manifests,
      messages: [{ role: "user", content: "给我做一个 DCF Excel 模型，再准备后续汇报思路" }],
    });

    expect(result.primary?.skillId).toBe("xlsx");
    expect(result.primary?.score).toBeGreaterThanOrEqual(0.9);
  });

  it("matches long presentation requests to pptx as the single primary Skill", () => {
    const matcher = new SkillMatcher();
    const result = matcher.match({
      query: "帮我做一份 30 页融资路演 PPT",
      manifests,
      messages: [{ role: "user", content: "帮我做一份 30 页融资路演 PPT" }],
    });

    expect(result.primary?.skillId).toBe("pptx");
    expect(result.primary?.score).toBeGreaterThanOrEqual(0.9);
  });

  it("gives explicit triggers highest priority", () => {
    const matcher = new SkillMatcher();
    const result = matcher.match({
      query: "$pdf 把这个 Excel 内容整理成报告",
      manifests,
      messages: [{ role: "user", content: "$pdf 把这个 Excel 内容整理成报告" }],
    });

    expect(result.primary).toMatchObject({ skillId: "pdf", source: "explicit", score: 1 });
  });
});

describe("SkillLoader", () => {
  it("loads SKILL.md separately and exposes references as stable skill:// URIs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mira-skill-context-"));
    tempDirs.push(root);
    const skillRoot = path.join(root, "xlsx");
    await fs.mkdir(path.join(skillRoot, "reference"), { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, "SKILL.md"),
      "---\nname: xlsx\ndescription: test\n---\n# Routing\nUse formulas.",
      "utf8",
    );
    await fs.writeFile(
      path.join(skillRoot, "reference", "DCF_SKILL.md"),
      "# DCF\nKeep valuation formula-linked.",
      "utf8",
    );

    const manifest: SkillManifest = {
      id: "xlsx",
      name: "Excel 处理",
      description: "test",
      version: "1.0.0",
      entry: path.join(skillRoot, "SKILL.md"),
    };
    const loader = new SkillLoader();
    const content = await loader.loadContent(manifest);
    const resources = await loader.listResources(manifest);

    expect(content.body).toContain("# Routing");
    expect(content.body).not.toContain("name: xlsx");
    expect(resources).toEqual([
      expect.objectContaining({
        uri: "skill://xlsx/reference/DCF_SKILL.md",
        kind: "reference",
      }),
    ]);

    const loaded = await loader.loadResource({ manifest, resource: resources[0]! });
    expect(loaded.content).toContain("formula-linked");
  });
});

describe("SkillContextProvider", () => {
  const createXlsxProvider = async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mira-skill-provider-"));
    tempDirs.push(root);
    const skillRoot = path.join(root, "xlsx");
    await fs.mkdir(path.join(skillRoot, "reference"), { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, "SKILL.md"),
      "---\nname: xlsx\ndescription: spreadsheet\n---\n# Routing\nUse workbook formulas and read references only when needed.",
      "utf8",
    );
    await fs.writeFile(path.join(skillRoot, "reference", "DCF_SKILL.md"), "# DCF\nDCF rules", "utf8");
    await fs.writeFile(path.join(skillRoot, "reference", "COMPS_SKILL.md"), "# Comps\nComps rules", "utf8");
    await fs.writeFile(path.join(skillRoot, "reference", "3_statement_model.md"), "# Three statement\n3S rules", "utf8");

    const manifest: SkillManifest = {
      id: "xlsx",
      name: "Excel 处理",
      description: "spreadsheet",
      version: "1.0.0",
      entry: path.join(skillRoot, "SKILL.md"),
    };
    const scanner = {
      scan: async () => [manifest],
    } as unknown as SkillScanner;
    const registry = new SkillRegistry(scanner);
    return new SkillContextProvider(registry, new SkillMatcher(), new SkillLoader());
  };

  it("discloses only the DCF reference for a DCF task", async () => {
    const provider = await createXlsxProvider();
    const context = await provider.prepare({
      query: "做一个 DCF Excel 模型",
      messages: [{ role: "user", content: "做一个 DCF Excel 模型" }],
    });

    expect(context?.primary?.id).toBe("xlsx");
    expect(context?.resources).toHaveLength(3);
    expect(context?.disclosedResources).toHaveLength(1);
    expect(context?.disclosedResources[0]?.uri).toBe("skill://xlsx/reference/DCF_SKILL.md");
    expect(context?.disclosedResources[0]?.content).toContain("DCF rules");
  });

  it("inherits the prior primary Skill across a clarification reply and keeps its reference context", async () => {
    const provider = await createXlsxProvider();
    const currentQuery = "用一家虚拟科技公司，历史 3 年，预测 5 年，其余参数用合理默认值";
    const context = await provider.prepare({
      query: currentQuery,
      messages: [
        { role: "user", content: "帮我做一个 DCF Excel 模型" },
        {
          role: "assistant",
          content: "可以。为了构建模型，请提供目标公司、历史数据范围、预测期和关键假设。",
        },
        { role: "user", content: currentQuery },
      ],
    });

    expect(context?.primary?.id).toBe("xlsx");
    expect(context?.match?.source).toBe("continuation");
    expect(context?.disclosedResources.map((resource) => resource.uri)).toEqual([
      "skill://xlsx/reference/DCF_SKILL.md",
    ]);
  });

  it("does not inherit a stale Skill when the user starts a different task", async () => {
    const provider = await createXlsxProvider();
    const currentQuery = "帮我写一封邮件给老板说明明天请假";
    const context = await provider.prepare({
      query: currentQuery,
      messages: [
        { role: "user", content: "帮我做一个 DCF Excel 模型" },
        {
          role: "assistant",
          content: "可以。为了构建模型，请提供目标公司、历史数据范围、预测期和关键假设。",
        },
        { role: "user", content: currentQuery },
      ],
    });

    expect(context?.primary).toBeUndefined();
    expect(context?.skillVisibility?.skills.find(
      (entry) => entry.skillId === "xlsx",
    )?.disclosure).toBe("summary");
  });
});
