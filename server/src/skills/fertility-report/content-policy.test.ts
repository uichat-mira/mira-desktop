import { describe, expect, it } from "vitest";
import type { FertilityDimension } from "../fertility-assessment/runtime.js";
import { applyFertilityReportContentPolicy } from "./content-policy.js";

const dimension = (overrides: Partial<FertilityDimension> = {}): FertilityDimension => ({
  id: "female_ovarian_reserve",
  score: 3.9,
  confidence: "high",
  dataCompleteness: 0.8,
  evidence: [
    {
      fact: "AMH 0.7 ng/mL，AFC 4 个，提示卵巢储备下降",
      source: "user_reported",
    },
  ],
  strengths: [],
  concerns: [
    "AMH 0.7 ng/mL，AFC 4 个，提示卵巢储备下降",
    "可募集卵泡池较小，可能限制单周期获卵数量",
  ],
  missingEvidence: ["基础 FSH 与 E2", "基础性激素 FSH、E2 水平"],
  interpretation:
    "当前储备指标偏低，需要结合既往促排反应理解。建议采用双刺激方案，以提高成功率。",
  actions: {
    selfCare: ["整理既往周期记录", "在医生指导下补充辅酶Q10"],
    discussWithClinician: ["与生殖医生讨论促排方案调整"],
    testsToConsider: ["月经第 2-3 天 FSH、E2"],
  },
  ...overrides,
});

describe("fertility report content policy", () => {
  it("removes cross-section duplicates and reframes clinical decisions as questions", () => {
    const result = applyFertilityReportContentPolicy({
      dimensions: { female_ovarian_reserve: dimension() },
      summary: {
        strengths: [],
        priorities: [],
        visitPrep: [],
        lifestyleFocus: [],
      },
      closingMessage: "祝福",
    });
    const governed = result.dimensions.female_ovarian_reserve;

    expect(governed.concerns).toEqual([
      "可募集卵泡池较小，可能限制单周期获卵数量",
    ]);
    expect(governed.missingEvidence).toHaveLength(1);
    expect(governed.actions.selfCare).toEqual(["整理既往周期记录"]);
    // Clinical self-care items and existing clinician actions are merged and
    // reframed as questions, so the policy never issues a direct instruction.
    expect(governed.actions.discussWithClinician.length).toBeGreaterThan(0);
    expect(
      governed.actions.discussWithClinician.every((item) => item.includes("就诊时可询问")),
    ).toBe(true);
    expect(
      governed.actions.discussWithClinician.some((item) => item.includes("辅酶Q10")),
    ).toBe(true);
    expect(governed.interpretation).not.toContain("双刺激方案");
    expect(governed.interpretation).not.toContain("提高成功率");
  });

  it("compresses a no-evidence dimension into a neutral reference result", () => {
    const result = applyFertilityReportContentPolicy({
      dimensions: {
        female_metabolic_health: dimension({
          id: "female_metabolic_health",
          score: 5,
          confidence: "low",
          dataCompleteness: 0,
          evidence: [],
          concerns: ["可能存在代谢风险"],
          actions: {
            selfCare: ["控制体重"],
            discussWithClinician: ["讨论减重"],
            testsToConsider: ["空腹血糖"],
          },
        }),
      },
      summary: {
        strengths: [],
        priorities: [],
        visitPrep: [],
        lifestyleFocus: [],
      },
      closingMessage: "祝福",
    });
    const governed = result.dimensions.female_metabolic_health;

    expect(governed.concerns).toEqual([]);
    expect(governed.actions.selfCare).toEqual([]);
    expect(governed.actions.discussWithClinician).toEqual([]);
    expect(governed.interpretation).toContain("中性参考基准");
    expect(governed.interpretation).toContain("不代表正常或异常");
  });
});
