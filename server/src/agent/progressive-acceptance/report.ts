import fs from "node:fs";
import path from "node:path";
import type {
  AcceptanceCaseResult,
  ProgressiveAcceptanceReport,
} from "./contract.js";

const statusIcon = (status: AcceptanceCaseResult["status"]): string =>
  status === "passed" ? "PASS" : status === "skipped" ? "SKIP" : "FAIL";

const renderCase = (result: AcceptanceCaseResult): string => {
  const lines = [
    `### ${statusIcon(result.status)} \`${result.caseId}\` (${result.surface} / ${result.category}) [evidence: \`${result.evidenceLevel}\`]`,
    "",
    `- query: \`${result.query}\``,
    `- gold: \`${JSON.stringify(result.gold)}\``,
    `- observed: \`${JSON.stringify(result.observed)}\``,
    `- metrics: modelCalls=${String(result.metrics.modelCalls)} semanticAttempted=${String(result.metrics.semanticAttempted)} searchUsed=${String(result.metrics.searchUsed)} authorityViolations=${result.metrics.authorityViolations} tokens=${String(result.metrics.tokens)} latencyMs=${String(result.metrics.latencyMs)} resolverLatencyMs=${String(result.metrics.resolverLatencyMs)}`,
    "- evidence boundaries: candidate ranking != resolved capability != schema-disclosed Tool != Planner-callable Tool != invoked Tool.",
  ];
  for (const assertion of result.assertions) {
    lines.push(
      `  - ${assertion.ok ? "ok" : "NOT OK"} ${assertion.name}${assertion.detail ? ` (${assertion.detail})` : ""}`,
    );
  }
  for (const diagnostic of result.diagnostics) {
    lines.push(`  - note: ${diagnostic}`);
  }
  lines.push("");
  return lines.join("\n");
};

export const formatAcceptanceMarkdown = (
  report: ProgressiveAcceptanceReport,
): string => {
  const header = [
    "# Progressive Resolution Acceptance Report (#311)",
    "",
    `- runner: \`${report.runner}\``,
    `- mode: \`${report.mode}\``,
    `- generatedAt: \`${report.generatedAt}\``,
    `- evidenceLevel: ${report.evidenceLevel}`,
    `- evidenceScope: resolution=${report.evidenceScope.resolutionObserved} plannerProjection=${report.evidenceScope.plannerProjectionObserved} governedExecution=${report.evidenceScope.governedExecutionObserved} modelCallUsage=${report.evidenceScope.modelCallUsageObserved}`,
    `- corpus: \`${report.corpus.fixtureSource}\` — ${report.corpus.note}`,
    `- summary: total=${report.summary.total} passed=${report.summary.passed} failed=${report.summary.failed} skipped=${report.summary.skipped}`,
    "",
    "## Comparison discipline",
    "",
    `- #243 reference: ${report.comparison.reference.goldReachability} gold reachability, ${report.comparison.reference.modelCalls} model calls / ${report.comparison.reference.tokens} tokens across ${report.comparison.reference.caseCount} cases (${report.comparison.reference.corpus}).`,
    `- #243 source: ${report.comparison.reference.source}`,
    `- #243 gold ids: ${report.comparison.reference.caseIds.join(", ")}`,
    `- direct parity: **${report.comparison.directParity}**`,
    `- reason: ${report.comparison.reason}`,
    "",
    "## Cases",
    "",
  ];
  return [...header, ...report.cases.map(renderCase)].join("\n");
};

export const writeAcceptanceArtifacts = (
  report: ProgressiveAcceptanceReport,
  outDir: string,
): { jsonPath: string; markdownPath: string } => {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "report.json");
  const markdownPath = path.join(outDir, "report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, `${formatAcceptanceMarkdown(report)}\n`, "utf8");
  return { jsonPath, markdownPath };
};
