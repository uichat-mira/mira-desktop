import { afterEach, describe, expect, it } from "vitest";
import { clearHarnessRegistry } from "@/harness/registry.js";
import { runProgressiveAcceptanceMatrix } from "./cases.js";
import type { AcceptanceCaseResult } from "./contract.js";

const byId = (
  cases: readonly AcceptanceCaseResult[],
  caseId: string,
): AcceptanceCaseResult => {
  const found = cases.find((item) => item.caseId === caseId);
  if (!found) throw new Error(`missing case ${caseId}`);
  return found;
};

describe("#311 Progressive Resolution acceptance matrix", () => {
  afterEach(() => {
    clearHarnessRegistry();
  });

  it("covers the full #311 matrix with a passing gold-oracle comparison", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    // 16 required #311 surfaces plus the explicit ambiguous-semantic fallback.
    expect(report.cases).toHaveLength(17);
    expect(report.summary.skipped).toBe(0);
    expect(
      report.cases
        .filter((item) => item.status !== "passed")
        .map((item) => ({
          caseId: item.caseId,
          failed: item.assertions.filter((assertion) => !assertion.ok),
        })),
    ).toEqual([]);
  });

  it("is explicit that direct #243 cost/reachability parity is NOT COMPARABLE", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    expect(report.corpus.fixtureSource).toBe("311-matrix-analogous");
    expect(report.comparison.directParity).toBe("not_comparable");
    expect(report.comparison.reference.modelCalls).toBe(86);
    expect(report.comparison.reference.tokens).toBe(209148);
  });

  it("keeps exact and structural cases free of Tool Search and semantic model calls", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    for (const caseId of ["exact-known-tool", "structural-domain", "main-agent"]) {
      const result = byId(report.cases, caseId);
      expect(result.metrics.modelCalls).toBe(0);
      expect(result.metrics.semanticAttempted).toBe(false);
      expect(result.metrics.searchUsed).toBe(false);
    }
  });

  it("reaches a Tool beyond the old first-20 window and in a noisy large catalog", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    for (const caseId of ["beyond-first20", "noisy-large-catalog"]) {
      const result = byId(report.cases, caseId);
      expect(result.metrics.modelCalls).toBe(0);
      expect(result.metrics.searchUsed).toBe(true);
      expect(result.assertions.find((a) => a.name === "gold_selected_tool_reachable")?.ok).toBe(
        true,
      );
    }
  });

  it("keeps no-match transparent and authority violations at zero across the matrix", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    expect(byId(report.cases, "no-match").metrics.modelCalls).toBe(0);
    for (const result of report.cases) {
      expect(result.metrics.authorityViolations).toBe(0);
    }
  });

  it("keeps resolution budget independent from recovery and reconciles revocation/readiness", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    expect(byId(report.cases, "resolution-budget-exhaustion").status).toBe("passed");
    expect(byId(report.cases, "approval-resume").status).toBe("passed");
    expect(byId(report.cases, "readiness-revocation-after-checkpoint").status).toBe(
      "passed",
    );
  });

  it("keeps Main, Generic Child and Skill Child scoped views independent", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    expect(byId(report.cases, "generic-child").status).toBe("passed");
    expect(byId(report.cases, "unauthorized-capability").status).toBe("passed");
    expect(byId(report.cases, "skill-child-scope").status).toBe("passed");
  });
});
