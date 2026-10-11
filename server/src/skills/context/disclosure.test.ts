import { describe, expect, it } from "vitest";
import {
  createMainAgentSkillVisibilityScope,
  createSkillChildSkillVisibilityScope,
  describeSkillVisibility,
  getResourceVisibilityEntry,
  getSkillVisibilityEntry,
  listSkillIdsAtDisclosure,
  materializeResourceContent,
  materializeSkillBody,
  projectResourceMetadata,
  projectSkillSummaries,
  projectSkillVisibilityView,
  promoteResourceContent,
  promoteSkillBody,
  resourceDisclosureKey,
  withResourceDisclosure,
  withSkillDisclosure,
} from "./disclosure.js";
import type { SkillVisibilityScope } from "./disclosure.js";
import type {
  LoadedSkillResource,
  SkillContent,
  SkillManifest,
  SkillResource,
} from "./types.js";

type SkillSource = SkillManifest & { resources: SkillResource[] };

const DCF_URI = "skill://xlsx/reference/DCF_SKILL.md";
const COMPS_URI = "skill://xlsx/reference/COMPS.md";

const xlsxResources: SkillResource[] = [
  {
    uri: DCF_URI,
    skillId: "xlsx",
    name: "DCF Skill",
    kind: "reference",
    description: "Discounted cash flow reference",
  },
  {
    uri: COMPS_URI,
    skillId: "xlsx",
    name: "Comps",
    kind: "reference",
  },
];

const manifests: SkillSource[] = [
  {
    id: "xlsx",
    name: "Spreadsheet",
    description: "Spreadsheet domain skill",
    version: "1.0.0",
    entry: "SKILL.md",
    // Declared execution authority must never leak into the visibility view.
    execution: {
      context: "fork",
      agent: "subAgent",
      allowedTools: ["office_spreadsheet"],
      runtimeBindings: ["office_spreadsheet"],
      workspaceBound: true,
    },
    resources: xlsxResources,
  },
  {
    id: "docx",
    name: "Document",
    description: "Document domain skill",
    version: "2.0.0",
    entry: "SKILL.md",
    execution: {
      context: "inline",
      allowedTools: ["read"],
      runtimeBindings: [],
    },
    resources: [],
  },
];

const contents: SkillContent[] = [
  { manifest: manifests[0]!, body: "XLSX body: routing and hard rules." },
  { manifest: manifests[1]!, body: "DOCX body: routing and hard rules." },
];

const loadedResources: LoadedSkillResource[] = [
  { ...xlsxResources[0]!, content: "DCF reference content" },
  { ...xlsxResources[1]!, content: "COMPS reference content" },
];

const project = (
  scope: SkillVisibilityScope,
  options: Omit<
    Parameters<typeof projectSkillVisibilityView>[0],
    "scope" | "skills"
  > = {},
) => projectSkillVisibilityView({ scope, skills: manifests, ...options });

describe("progressive Skill and Resource visibility", () => {
  it("exposes Skill name/description at the summary stage without loading the body", () => {
    const view = project(createMainAgentSkillVisibilityScope({ scopeId: "main" }));

    const summaries = projectSkillSummaries(view);
    expect(summaries.map((summary) => summary.skillId).sort()).toEqual([
      "docx",
      "xlsx",
    ]);

    const xlsx = summaries.find((summary) => summary.skillId === "xlsx")!;
    expect(xlsx.disclosure).toBe("summary");
    expect(xlsx.name).toBe("Spreadsheet");
    // Summary is a materially separate stage: it must not carry the body.
    expect(Object.keys(xlsx).sort()).toEqual([
      "description",
      "disclosure",
      "name",
      "skillId",
      "version",
    ]);
    expect("body" in xlsx).toBe(false);

    expect(materializeSkillBody(view, "xlsx", contents)).toBeUndefined();
    expect(getSkillVisibilityEntry(view, "xlsx")?.disclosure).toBe("summary");
  });

  it("discloses the full Skill body later within the same scoped view", () => {
    const view = project(createMainAgentSkillVisibilityScope({ scopeId: "main" }));
    const promoted = promoteSkillBody({ view, skillId: "xlsx", contents });

    expect(promoted.transition).toEqual({
      skillId: "xlsx",
      from: "summary",
      to: "body",
      reason: "promoted",
      bodyMaterialized: true,
    });
    expect(promoted.body?.body).toBe(contents[0]!.body);
    expect(materializeSkillBody(promoted.view, "xlsx", contents)?.body).toBe(
      contents[0]!.body,
    );
    // An unrelated Skill stays at the summary stage.
    expect(getSkillVisibilityEntry(promoted.view, "docx")?.disclosure).toBe(
      "summary",
    );
  });

  it("keeps Resource metadata/URI visible without loading content", () => {
    const view = project(createMainAgentSkillVisibilityScope({ scopeId: "main" }));

    const metadata = projectResourceMetadata(view);
    expect(metadata.map((resource) => resource.uri).sort()).toEqual([
      COMPS_URI,
      DCF_URI,
    ]);

    const dcf = metadata.find((resource) => resource.uri === DCF_URI)!;
    expect(dcf.disclosure).toBe("metadata");
    expect(Object.keys(dcf).sort()).toEqual([
      "description",
      "disclosure",
      "kind",
      "name",
      "skillId",
      "uri",
    ]);
    expect("content" in dcf).toBe(false);

    expect(
      materializeResourceContent(view, "xlsx", DCF_URI, loadedResources),
    ).toBeUndefined();
  });

  it("loads Resource content only for the explicitly promoted resource", () => {
    const view = project(createMainAgentSkillVisibilityScope({ scopeId: "main" }));
    const promoted = promoteResourceContent({
      view,
      skillId: "xlsx",
      uri: DCF_URI,
      resources: loadedResources,
    });

    expect(promoted.transition).toEqual({
      uri: DCF_URI,
      from: "metadata",
      to: "content",
      reason: "promoted",
      contentMaterialized: true,
    });
    expect(promoted.content?.content).toBe("DCF reference content");
    expect(
      materializeResourceContent(promoted.view, "xlsx", DCF_URI, loadedResources)
        ?.content,
    ).toBe("DCF reference content");
    // A sibling Resource remains metadata-only.
    expect(
      materializeResourceContent(promoted.view, "xlsx", COMPS_URI, loadedResources),
    ).toBeUndefined();
  });

  it("lets a Skill Child own independent scoped visibility state", () => {
    const main = project(
      createMainAgentSkillVisibilityScope({ scopeId: "main" }),
      {
        requestedSkillDisclosure: new Map([["xlsx", "body"]]),
      },
    );
    const child = project(
      createSkillChildSkillVisibilityScope({
        scopeId: "skill:xlsx",
        discoverableSkillIds: ["xlsx"],
      }),
      {
        requestedResourceDisclosure: new Map([
          [resourceDisclosureKey("xlsx", DCF_URI), "content"],
        ]),
      },
    );

    expect(getSkillVisibilityEntry(main, "xlsx")?.disclosure).toBe("body");
    expect(getSkillVisibilityEntry(child, "xlsx")?.disclosure).toBe("summary");
    expect(getResourceVisibilityEntry(main, "xlsx", DCF_URI)?.disclosure).toBe(
      "metadata",
    );
    expect(getResourceVisibilityEntry(child, "xlsx", DCF_URI)?.disclosure).toBe(
      "content",
    );
    // The Child envelope excludes docx even though the Main scope sees it.
    expect(getSkillVisibilityEntry(main, "docx")?.discoverable).toBe(true);
    expect(getSkillVisibilityEntry(child, "docx")?.discoverable).toBe(false);
    // Scoped projection never mutates the shared source manifests.
    expect(manifests[0]!.resources).toHaveLength(2);
    expect(manifests[0]!.execution?.allowedTools).toEqual([
      "office_spreadsheet",
    ]);
  });

  it("clamps Skill and Resource disclosure to the scope ceiling", () => {
    const view = project(
      createMainAgentSkillVisibilityScope({
        scopeId: "main",
        maxSkillDisclosure: "summary",
        maxResourceDisclosure: "metadata",
      }),
      {
        requestedSkillDisclosure: new Map([["xlsx", "body"]]),
        requestedResourceDisclosure: new Map([
          [resourceDisclosureKey("xlsx", DCF_URI), "content"],
        ]),
      },
    );

    expect(view.maxSkillDisclosure).toBe("summary");
    expect(getSkillVisibilityEntry(view, "xlsx")?.disclosure).toBe("summary");
    expect(getResourceVisibilityEntry(view, "xlsx", DCF_URI)?.disclosure).toBe(
      "metadata",
    );

    const skillPromotion = promoteSkillBody({ view, skillId: "xlsx", contents });
    expect(skillPromotion.transition.reason).toBe("blocked-ceiling");
    expect(skillPromotion.body).toBeUndefined();

    const resourcePromotion = promoteResourceContent({
      view,
      skillId: "xlsx",
      uri: DCF_URI,
      resources: loadedResources,
    });
    expect(resourcePromotion.transition.reason).toBe("blocked-ceiling");
    expect(resourcePromotion.content).toBeUndefined();
  });

  it("blocks disclosure outside the discoverable Skill envelope", () => {
    const view = project(
      createMainAgentSkillVisibilityScope({
        scopeId: "main",
        discoverableSkillIds: ["docx"],
      }),
    );

    expect(getSkillVisibilityEntry(view, "xlsx")?.discoverable).toBe(false);
    expect(getSkillVisibilityEntry(view, "xlsx")?.disclosure).toBe("hidden");
    expect(projectSkillSummaries(view).map((summary) => summary.skillId)).toEqual([
      "docx",
    ]);

    const skillPromotion = promoteSkillBody({ view, skillId: "xlsx", contents });
    expect(skillPromotion.transition.reason).toBe("blocked-not-discoverable");
    expect(skillPromotion.body).toBeUndefined();
    expect(materializeSkillBody(view, "xlsx", contents)).toBeUndefined();

    const resourcePromotion = promoteResourceContent({
      view,
      skillId: "xlsx",
      uri: DCF_URI,
      resources: loadedResources,
    });
    expect(resourcePromotion.transition.reason).toBe(
      "blocked-not-discoverable",
    );
    expect(resourcePromotion.content).toBeUndefined();
  });

  it("reports unknown Skill and Resource promotion as no-op transitions", () => {
    const view = project(createMainAgentSkillVisibilityScope({ scopeId: "main" }));

    const unknownSkill = promoteSkillBody({
      view,
      skillId: "does-not-exist",
      contents,
    });
    expect(unknownSkill.transition.reason).toBe("unknown-skill");
    expect(unknownSkill.view).toBe(view);

    const unknownResource = promoteResourceContent({
      view,
      skillId: "xlsx",
      uri: "skill://xlsx/reference/MISSING.md",
      resources: loadedResources,
    });
    expect(unknownResource.transition.reason).toBe("unknown-resource");
    expect(unknownResource.view).toBe(view);
  });

  it("keeps ExecutionProfile and runtimeBindings outside model-granted authority", () => {
    const view = project(createMainAgentSkillVisibilityScope({ scopeId: "main" }));
    const entry = getSkillVisibilityEntry(view, "xlsx");

    // The view carries visibility state only. There is no execution or
    // authorization field a caller could mistake for a permission grant.
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      "description",
      "disclosure",
      "discoverable",
      "name",
      "resources",
      "skillId",
      "version",
    ]);
    expect(Object.keys(entry?.resources.get(DCF_URI) ?? {}).sort()).toEqual([
      "description",
      "disclosure",
      "discoverable",
      "kind",
      "name",
      "skillId",
      "uri",
    ]);
    expect("execution" in (entry ?? {})).toBe(false);

    const serialized = JSON.stringify(describeSkillVisibility(view));
    expect(serialized).not.toContain("runtimeBindings");
    expect(serialized).not.toContain("allowedTools");
    expect(serialized).not.toContain("workspaceBound");

    const promoted = promoteSkillBody({ view, skillId: "xlsx", contents });
    expect(Object.keys(promoted.body ?? {}).sort()).toEqual([
      "body",
      "disclosure",
      "skillId",
    ]);
    const content = promoteResourceContent({
      view,
      skillId: "xlsx",
      uri: DCF_URI,
      resources: loadedResources,
    });
    expect(Object.keys(content.content ?? {}).sort()).toEqual([
      "content",
      "disclosure",
      "uri",
    ]);
  });

  it("distinguishes summary, body, metadata and content disclosure in the trace", () => {
    const view = project(createMainAgentSkillVisibilityScope({ scopeId: "main" }));
    const body = promoteSkillBody({ view, skillId: "xlsx", contents });
    const withContent = promoteResourceContent({
      view: body.view,
      skillId: "xlsx",
      uri: DCF_URI,
      resources: loadedResources,
    });

    const trace = describeSkillVisibility(withContent.view);
    expect(trace.scopeKind).toBe("main_agent");
    expect(trace.summaryDisclosedCount).toBe(2);
    expect(trace.bodyDisclosedCount).toBe(1);
    expect(trace.hiddenCount).toBe(0);
    expect(trace.resourceMetadataDisclosedCount).toBe(2);
    expect(trace.resourceContentDisclosedCount).toBe(1);

    const xlsx = trace.entries.find((item) => item.skillId === "xlsx")!;
    expect(xlsx.summaryDisclosed).toBe(true);
    expect(xlsx.bodyDisclosed).toBe(true);
    const docx = trace.entries.find((item) => item.skillId === "docx")!;
    expect(docx.bodyDisclosed).toBe(false);
  });

  it("supports independent stage transitions per scope", () => {
    const view = project(createMainAgentSkillVisibilityScope({ scopeId: "main" }));
    expect(listSkillIdsAtDisclosure(view, "summary").sort()).toEqual([
      "docx",
      "xlsx",
    ]);

    const bodyView = withSkillDisclosure(view, "xlsx", "body");
    expect(getSkillVisibilityEntry(bodyView, "xlsx")?.disclosure).toBe("body");
    expect(getSkillVisibilityEntry(view, "xlsx")?.disclosure).toBe("summary");
    expect(listSkillIdsAtDisclosure(bodyView, "body")).toEqual(["xlsx"]);

    const resourceView = withResourceDisclosure(view, "xlsx", DCF_URI, "content");
    expect(
      getResourceVisibilityEntry(resourceView, "xlsx", DCF_URI)?.disclosure,
    ).toBe("content");
    expect(
      getResourceVisibilityEntry(view, "xlsx", DCF_URI)?.disclosure,
    ).toBe("metadata");
  });

  it("exposes immutable Skill visibility state", () => {
    const view = project(
      createMainAgentSkillVisibilityScope({
        scopeId: "main",
        maxSkillDisclosure: "summary",
      }),
    );
    const entry = getSkillVisibilityEntry(view, "xlsx");

    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry?.resources)).toBe(true);
    expect("set" in view.skills).toBe(false);
    expect("delete" in view.skills).toBe(false);
    expect("clear" in view.skills).toBe(false);

    expect(Reflect.set(view as object, "maxSkillDisclosure", "body")).toBe(false);
    expect(Reflect.set(entry as object, "disclosure", "body")).toBe(false);
    expect(view.maxSkillDisclosure).toBe("summary");
    expect(getSkillVisibilityEntry(view, "xlsx")?.disclosure).toBe("summary");
  });
});
