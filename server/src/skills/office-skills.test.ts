import { describe, expect, it } from "vitest";
import { getBuiltInSkillPackage, listBuiltInSkillPackages } from "./registry.js";

describe("WenShu built-in Skill packages", () => {
  it("publishes the built-in Skill packages", () => {
    expect(listBuiltInSkillPackages().map((skill) => skill.id).sort()).toEqual([
      "docx",
      "github-collaboration",
      "pdf",
      "pptx",
      "wechat-article-layout",
      "xlsx",
    ]);
  });

  it("keeps DOCX bundled and binds the three Python-backed packages to the shared optional runtime pack", () => {
    expect(getBuiltInSkillPackage("docx")?.bundled).toBe(true);
    expect(getBuiltInSkillPackage("docx")?.runtimePack).toBeUndefined();

    for (const id of ["pdf", "pptx", "xlsx"] as const) {
      expect(getBuiltInSkillPackage(id)?.runtimePack).toEqual({
        id: "wenshu-office",
        version: "1.0.0",
        required: true,
      });
    }
  });

  it("marks progressive SkillContext integration ready without requiring Stateful Skill Runtime", () => {
    for (const skill of listBuiltInSkillPackages()) {
      expect(skill.contextIntegration).toEqual({
        status: "ready",
        mode: "progressive-disclosure",
      });
      expect(skill.statefulRuntime.status).toBe("deferred");
      expect(skill.statefulRuntime.requiredContracts).toContain("SkillInstance state/stage");
      expect(skill.statefulRuntime.requiredContracts).toContain("Evidence-driven reducer");
      expect(skill.statefulRuntime.requiredContracts).toContain("stage-specific tool constraints");
    }
  });

  it("declares task-level execution capabilities without turning them into Skill actions", () => {
    expect(getBuiltInSkillPackage("docx")?.runtimeCapabilities).toEqual(["office_document"]);
    expect(getBuiltInSkillPackage("pdf")?.runtimeCapabilities).toEqual(["office_pdf"]);
    expect(getBuiltInSkillPackage("xlsx")?.runtimeCapabilities).toEqual(["office_spreadsheet"]);
    expect(getBuiltInSkillPackage("pptx")?.runtimeCapabilities).toEqual(["office_presentation"]);
  });

  it("returns null for unknown packages", () => {
    expect(getBuiltInSkillPackage("unknown")).toBeNull();
  });
});
