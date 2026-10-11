import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillLoader } from "../context/loader.js";
import { SkillMatcher } from "../context/matcher.js";
import { SkillContextProvider } from "../context/provider.js";
import { SkillRegistry, type SkillScanner } from "../context/scanner.js";
import type { SkillManifest } from "../context/types.js";
import { prepareSubAgent } from "./subagent-runtime.js";

const DCF_URI = "skill://xlsx/reference/DCF_SKILL.md";
const COMPS_URI = "skill://xlsx/reference/COMPS_SKILL.md";

const testDir = path.dirname(fileURLToPath(import.meta.url));
// Repository AGENTS.md requires test temporary artifacts to live under the
// repo-root `.test-artifact/` directory rather than the OS temp directory.
const ARTIFACT_ROOT = path.resolve(
  testDir,
  "../../../..",
  ".test-artifact",
  "skill-visibility",
);

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
  await fs.mkdir(ARTIFACT_ROOT, { recursive: true });
  const root = await fs.mkdtemp(path.join(ARTIFACT_ROOT, "case-"));
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

const findResource = (
  context: Awaited<ReturnType<SkillContextProvider["prepare"]>>,
  uri: string,
) =>
  context?.skillVisibility?.skills
    .find((entry) => entry.skillId === "xlsx")
    ?.resources.find((resource) => resource.uri === uri);

describe("Skill Child runtime visibility wiring", () => {
  it("runs the Child on its own scoped snapshot and promotes only the Child scope on a real Resource read", async () => {
    const { provider, root } = await createProvider();
    const mainContext = await selectXlsx(provider);
    const loadResourceSpy = vi
      .spyOn(SkillContextProvider.prototype, "loadResource")
      .mockResolvedValue({
        uri: COMPS_URI,
        skillId: "xlsx",
        name: "COMPS_SKILL.md",
        kind: "reference",
        content: "# Comps\nComps rules",
      });

    try {
      const prepared = prepareSubAgent({
        goal: "做一个 DCF Excel 模型",
        skillContext: mainContext,
        exposedHarnessToolIds: [],
        workspaceRoot: root,
      });

      // The live Child execution owns a distinct scoped snapshot, not the Main
      // Agent view that was passed in.
      expect(prepared.execution.skillContext).not.toBe(mainContext);
      expect(prepared.execution.skillContext.skillVisibility?.scopeKind).toBe(
        "skill_child",
      );
      expect(mainContext.skillVisibility?.scopeKind).toBe("main_agent");

      const childResource = findResource(
        prepared.execution.skillContext,
        COMPS_URI,
      );
      const mainResource = findResource(mainContext, COMPS_URI);
      // The sibling Resource starts metadata-only in both scopes.
      expect(childResource?.disclosure).toBe("metadata");
      expect(mainResource?.disclosure).toBe("metadata");

      const resourceTool = prepared.tools.find(
        (tool) => tool.id === "skill_read_resource",
      );
      expect(resourceTool).toBeDefined();
      const executed = await resourceTool!.execute({ uri: COMPS_URI });
      expect(executed.result).toMatchObject({ status: "loaded", uri: COMPS_URI });
      expect(loadResourceSpy).toHaveBeenCalledTimes(1);

      // A genuine read promotes the same running Child scope to content, while
      // the Main snapshot stays untouched.
      expect(
        findResource(prepared.execution.skillContext, COMPS_URI)?.disclosure,
      ).toBe("content");
      expect(findResource(mainContext, COMPS_URI)?.disclosure).toBe("metadata");
    } finally {
      loadResourceSpy.mockRestore();
    }
  });

  it("keeps blocked Resource reads at the metadata stage", async () => {
    const { provider, root } = await createProvider();
    const mainContext = await selectXlsx(provider);
    const loadResourceSpy = vi
      .spyOn(SkillContextProvider.prototype, "loadResource")
      .mockRejectedValue(new Error("resource unavailable"));

    try {
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

      const notFound = await resourceTool!.execute({
        uri: "skill://xlsx/reference/MISSING.md",
      });
      expect(notFound.result).toMatchObject({ status: "not_found" });

      const unavailable = await resourceTool!.execute({ uri: COMPS_URI });
      expect(unavailable.result).toMatchObject({ status: "unavailable" });

      // Neither an unresolved nor a read-blocked Resource may claim content.
      expect(
        findResource(prepared.execution.skillContext, COMPS_URI)?.disclosure,
      ).toBe("metadata");
    } finally {
      loadResourceSpy.mockRestore();
    }
  });
});
