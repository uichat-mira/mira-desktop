import { describe, expect, it } from "vitest";
import { runContextReadBenchCases } from "./cases.js";

describe("context read bench", () => {
  it("covers context and read scenarios without failures", async () => {
    const report = await runContextReadBenchCases();

    expect(report.cases).toHaveLength(11);
    expect(
      report.cases
        .filter((item) => item.status !== "passed")
        .map((item) => ({
          caseId: item.caseId,
          diagnostics: item.diagnostics,
        })),
    ).toEqual([]);
    expect(report.cases.find((item) => item.caseId === "read-gbk")?.encoding).toBe(
      "gb18030",
    );
    expect(report.cases.find((item) => item.caseId === "read-binary")?.encoding).toBe(
      "binaryDetected",
    );
    expect(report.cases.find((item) => item.caseId === "inspect-max-files")?.filesRead).toBe(1);
  });
});
