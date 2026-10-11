import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillLoader } from "../context/loader.js";
import { SkillMatcher } from "../context/matcher.js";
import { SkillContextProvider } from "../context/provider.js";
import { SkillRegistry, type SkillScanner } from "../context/scanner.js";
import type { SkillManifest } from "../context/types.js";
import { prepareSubAgent } from "./subagent-runtime.js";

const DCF_URI = "skill://xlsx/reference/DCF_SKILL.md";
const COMPS_URI = "skill://xlsx/reference/COMPS_SKILL.md";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

const createSkill = async (input: {
  root: string;
  id: string;
  name: string;
  description: string;
  body: string;
  resources?: Array<{ relativePath: string; content: string }>;
}): Promise<SkillManifest> => {
  const skillRoot = path.join(input.root, input.id);
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(
    path.join(skillRoot, "SKILL.md"),
    `---\nname: ${input.id}\ndescription: ${input.description}\n---\n${input.body}`,
    "utf8",
  );
  for (const resource of input.resources ?? []) {
    const target = path.join(skillRoot, resource.relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, resource.content, "utf8");
  }
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    version: "1.0.0",
    entry: path.join(skillRoot, "SKILL.md"),
    execution: {
      context: "fork",
      agent: "subAgent",
      allowedTools: [],
      runtimeBindings: [],
      workspaceBound: false,
    },
  };
};

const createProvider = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mira-skill-visibility-"));
  tempDirs.push(root);
  const xlsx = await createSkill({
    root,
    id: "xlsx",
    name: "Excel 处理",
    description: "Create Excel workbooks and financial models",
    body: "# XLSX body\nUse workbook formulas.",
    resources: [
      { relativePath: "reference/DCF_SKILL.md", content: "# DCF\nDCF rules" },
      { relativePath: "reference/COMPS_SKILL.md", content: "# Comps\nComps rules" },
    ],
  });
  const docx = await createSkill({
    root,
    id: "docx",
    name: "Word 文档处理",
    description: "Create and review DOCX documents",
    body: "# DOCX body\nDraft the document.",
  });

  const loader = new SkillLoader();
  const registry = new SkillRegistry({
    scan: async () => [xlsx, docx],
  } as unknown as SkillScanner);
  const provider = new SkillContextProvider(registry, new SkillMatcher(), loader);
  return { provider, loader, root };
};

const selectXlsx = async (provider: SkillContextProvider) =>
  (await provider.prepare({
    query: "$xlsx 做一个 DCF Excel 模型",
    messages: [{ role: "user", content: "$xlsx 做一个 DCF Excel 模型" }],
  }))!;

describe("Skill and Resource progressive visibility integration", () => {
  it("discovers every Skill by name/description but loads only the selected body", async () => {
    const { provider, loader } = await createProvider();
    const loadContentSpy = vi.spyOn(loader, "loadContent");
    const loadResourceSpy = vi.spyOn(loader, "loadResource");

    const context = await selectXlsx(provider);

    expect(context.primary?.id).toBe("xlsx");
    expect(context.primary?.body).toContain("# XLSX body");

    const snapshot = context.skillVisibility;
    expect(snapshot?.scopeKind).toBe("main_agent");
    const xlsxEntry = snapshot?.skills.find((entry) => entry.skillId === "xlsx");
    const docxEntry = snapshot?.skills.find((entry) => entry.skillId === "docx");
    // The selected Skill reaches the body stage; the sibling stays a summary.
    expect(xlsxEntry?.disclosure).toBe("body");
    expect(docxEntry?.disclosure).toBe("summary");
    expect(docxEntry?.description).toContain("DOCX");

    // The unselected Skill body is never read during this scoped run.
    expect(loadContentSpy).toHaveBeenCalledTimes(1);
    expect(loadContentSpy.mock.calls.map((call) => call[0].id)).toEqual(["xlsx"]);

    // Resource URI/metadata is visible without content; only the selected
    // Resource body is read through the loader.
    const resourceStages = new Map(
      (xlsxEntry?.resources ?? []).map((resource) => [
        resource.uri,
        resource.disclosure,
      ]),
    );
    expect(resourceStages.get(DCF_URI)).toBe("content");
    expect(resourceStages.get(COMPS_URI)).toBe("metadata");
    expect(loadResourceSpy).toHaveBeenCalledTimes(1);
    expect(loadResourceSpy.mock.calls[0]?.[0].resource.uri).toBe(DCF_URI);
    expect(context.disclosedResources.map((resource) => resource.uri)).toEqual([
      DCF_URI,
    ]);

    // The snapshot carries disclosure only, never execution authority.
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("allowedTools");
    expect(serialized).not.toContain("runtimeBindings");
    expect(serialized).not.toContain("workspaceBound");
  });

  it("lets a Skill Child own an independent scoped visibility state", async () => {
    const { provider, root } = await createProvider();
    const mainContext = await selectXlsx(provider);

    const prepared = prepareSubAgent({
      goal: "做一个 DCF Excel 模型",
      skillContext: mainContext,
      exposedHarnessToolIds: [],
      workspaceRoot: root,
    });

    // Child scope is independent: only the active Skill is discoverable, even
    // though the Main scope also surfaced docx.
    expect(prepared.skillVisibility.scopeKind).toBe("skill_child");
    expect(
      prepared.skillVisibility.skills.map((entry) => entry.skillId),
    ).toEqual(["xlsx"]);
    const childXlsx = prepared.skillVisibility.skills[0]!;
    expect(childXlsx.disclosure).toBe("body");
    // Resource metadata stays visible; content only for the disclosed Resource.
    expect(
      childXlsx.resources.find((resource) => resource.uri === DCF_URI)?.disclosure,
    ).toBe("content");
    expect(
      childXlsx.resources.find((resource) => resource.uri === COMPS_URI)?.disclosure,
    ).toBe("metadata");

    // Visibility never widens Tool authority. The declared xlsx envelope is a
    // requirement, and an unexposed requirement stays missing rather than being
    // granted by the wider visibility stage.
    expect(prepared.profile.allowedHarnessToolIds).toContain("read");
    expect(prepared.tools.map((tool) => tool.id)).toContain("skill_read_resource");
    expect(prepared.tools.map((tool) => tool.id)).not.toContain("read");
    expect(
      prepared.missingCapabilities.map((requirement) => requirement.requiredFor),
    ).toContain("read");
  });

  it("does not expose the unselected sibling Skill resources to the Child", async () => {
    const { provider, root } = await createProvider();
    const mainContext = await selectXlsx(provider);

    const prepared = prepareSubAgent({
      goal: "做一个 DCF Excel 模型",
      skillContext: mainContext,
      exposedHarnessToolIds: [],
      workspaceRoot: root,
    });

    const resourceTool = prepared.tools.find(
      (tool) => tool.id === "skill_read_resource",
    );
    expect(resourceTool).toBeDefined();
    const schema = resourceTool!.inputSchema as {
      properties: { uri: { description: string } };
    };
    // Only the active Skill's resources are callable, and docx is out of scope.
    expect(schema.properties.uri.description).toContain(DCF_URI);
    expect(schema.properties.uri.description).toContain(COMPS_URI);
    expect(schema.properties.uri.description).not.toContain("docx");
  });
});
