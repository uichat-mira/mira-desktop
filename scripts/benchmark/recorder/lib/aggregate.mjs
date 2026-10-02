// #223 Recorder — aggregate projection (manifest.json / summary.json / report.md).
//
// These are human/machine projections over the per-repetition artifacts. They
// must never replace raw evidence, and they never invent a score. Semantic
// components remain `pending` until a fresh blank Judge runs (#224).

const mean = (values) => {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
};

const countBy = (items, keyFn) => {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) ?? "unknown";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
};

/**
 * Blocker 5: aggregate Run Manifest identity is derived from the ACTUAL recorded
 * repetitions' execution identity, not from the benchmark case-set identity.
 * When every repetition agrees we emit a shared identity; when they disagree we
 * must NOT silently pick the first — we surface the heterogeneity explicitly.
 */
const UNKNOWN = "unknown";

const aggregateIdentityField = (repetitions, select) => {
  const values = repetitions.map((r) => select(r));
  const normalized = values.map((v) => (v === undefined || v === null ? UNKNOWN : v));
  const unique = [...new Set(normalized.map((v) => JSON.stringify(v)))].map((s) => JSON.parse(s));
  if (unique.length === 1) {
    return { shared: unique[0], heterogeneous: false, values: normalized };
  }
  return { shared: null, heterogeneous: true, values: normalized };
};

export const buildRunManifest = ({ identity, repetitions }) => {
  const executionIdentity = (r) => r.execution ?? {};

  const miraCommit = aggregateIdentityField(repetitions, (r) => executionIdentity(r).mira?.commit ?? UNKNOWN);
  const miraVersion = aggregateIdentityField(repetitions, (r) => executionIdentity(r).mira?.version ?? UNKNOWN);
  const runtimeMode = aggregateIdentityField(repetitions, (r) => executionIdentity(r).mira?.runtimeMode ?? UNKNOWN);
  const modelProvider = aggregateIdentityField(repetitions, (r) => executionIdentity(r).model?.provider ?? UNKNOWN);
  const modelId = aggregateIdentityField(repetitions, (r) => executionIdentity(r).model?.modelId ?? UNKNOWN);
  const hostOs = aggregateIdentityField(
    repetitions,
    (r) => executionIdentity(r).environment?.hostPlatform?.platform ?? UNKNOWN,
  );
  const hostArch = aggregateIdentityField(
    repetitions,
    (r) => executionIdentity(r).environment?.hostPlatform?.arch ?? UNKNOWN,
  );

  const sharedOrNull = (field) => (field.heterogeneous ? null : field.shared);

  return {
    schemaVersion: "mira-agent-core-benchmark-manifest/0.1",
    benchmark: {
      benchmarkVersion: identity.benchmarkVersion,
      caseSetVersion: identity.caseSetVersion,
      contractPath: identity.contractPath,
      contractBlobSha: identity.contractBlobSha,
      caseSetManifestPath: identity.caseSetManifestPath,
      caseSetManifestSha256: identity.caseSetManifestSha256,
      timingPolicy: identity.timingPolicy,
      // #216 §14: the manifest must state Mira/model/runtime identity. These are
      // aggregated from the recorded repetitions, never inferred from the
      // benchmark case-set identity (`loadBenchmarkIdentity`).
      miraCommit: sharedOrNull(miraCommit),
      miraVersion: sharedOrNull(miraVersion),
      modelProvider: sharedOrNull(modelProvider),
      modelId: sharedOrNull(modelId),
      hostOs: sharedOrNull(hostOs),
      hostArch: sharedOrNull(hostArch),
      runtimeMode: sharedOrNull(runtimeMode),
      identitySource: "aggregated from recorded repetition execution.json (not benchmark case-set identity)",
      identityHeterogeneous: {
        miraCommit: miraCommit.heterogeneous,
        miraVersion: miraVersion.heterogeneous,
        modelProvider: modelProvider.heterogeneous,
        modelId: modelId.heterogeneous,
        hostOs: hostOs.heterogeneous,
        hostArch: hostArch.heterogeneous,
        runtimeMode: runtimeMode.heterogeneous,
      },
      perRepetitionIdentity: repetitions.map((r) => ({
        caseId: r.caseId,
        repetition: r.repetition,
        miraCommit: executionIdentity(r).mira?.commit ?? UNKNOWN,
        miraVersion: executionIdentity(r).mira?.version ?? UNKNOWN,
        modelProvider: executionIdentity(r).model?.provider ?? UNKNOWN,
        modelId: executionIdentity(r).model?.modelId ?? UNKNOWN,
        hostOs: executionIdentity(r).environment?.hostPlatform?.platform ?? UNKNOWN,
        hostArch: executionIdentity(r).environment?.hostPlatform?.arch ?? UNKNOWN,
        runtimeMode: executionIdentity(r).mira?.runtimeMode ?? UNKNOWN,
      })),
    },
    recorder: {
      artifactSchemaVersion: "mira-agent-core-benchmark-report/0.1",
      issue: 223,
      note: "Recorder consumes #221 raw bundles; it never drives Mira and never scores semantic quality",
    },
    cases: [...new Set(repetitions.map((r) => r.caseId))].map((caseId) => ({
      caseId,
      repetitions: repetitions.filter((r) => r.caseId === caseId).map((r) => r.repetition),
    })),
    repetitionCount: repetitions.length,
  };
};

export const buildSummary = ({ repetitions }) => {
  const validComparable = repetitions.filter((r) => r.comparable === true);
  const invalid = repetitions.filter((r) => r.executionClassification === "invalid");
  const noncanonical = repetitions.filter((r) => r.comparable !== true && r.executionClassification !== "invalid");

  const elapsed = repetitions.map((r) => r.deterministic?.timing?.elapsedMs ?? null);

  return {
    schemaVersion: "mira-agent-core-benchmark-summary/0.1",
    runCount: repetitions.length,
    repetitionCounts: {
      total: repetitions.length,
      validComparable: validComparable.length,
      noncanonical: noncanonical.length,
      invalid: invalid.length,
    },
    terminalDistribution: countBy(repetitions, (r) => r.deterministic?.terminal?.status),
    executionModeDistribution: countBy(repetitions, (r) => r.executionClassification),
    timingObservations: {
      policyState: repetitions.every((r) => r.deterministic?.timing?.state === "frozen")
        ? "frozen"
        : "calibration_pending",
      elapsedMs: {
        values: elapsed,
        median: median(elapsed),
        max: max(elapsed),
        count: elapsed.filter((v) => typeof v === "number").length,
      },
    },
    deterministicMeasurements: {
      toolCallCountMean: mean(repetitions.map((r) => r.deterministic?.toolCallCount)),
      plannerIterationsMean: mean(repetitions.map((r) => r.deterministic?.plannerIterations)),
      delegationCountMean: mean(
        repetitions.map((r) => (typeof r.deterministic?.delegationCount === "number" ? r.deterministic.delegationCount : null)),
      ),
      approvalCountTotal: sum(repetitions.map((r) => r.deterministic?.approvalCount)),
      resumeCountTotal: sum(repetitions.map((r) => r.deterministic?.resumeCount)),
      workspaceChangedCount: repetitions.filter((r) => r.deterministic?.sideEffects?.workspaceChanged === true).length,
    },
    unresolvedGaps: repetitions.flatMap((r) =>
      (r.deterministic?.observabilityGaps ?? []).map((gap) => ({ caseId: r.caseId, repetition: r.repetition, ...gap })),
    ),
    scoreComponents: {
      taskSuccessSemantic: "pending",
      autonomy: "pending",
      reliability: "pending",
      governance: "pending",
      note: "these components require deterministic scoring (#224) and/or a fresh blank Judge; the Recorder intentionally does not populate them",
    },
  };
};

const max = (values) => {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  return nums.length ? Math.max(...nums) : null;
};
const sum = (values) => {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : 0;
};
const median = (values) => {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
};

export const buildReportMarkdown = ({ manifest, summary, repetitions, recognizedInput }) => {
  const lines = [];
  lines.push("# Mira Agent Core Benchmark — Recorder Report (#223)");
  lines.push("");
  lines.push(`- benchmark version: \`${manifest.benchmark.benchmarkVersion}\``);
  lines.push(`- case-set version: \`${manifest.benchmark.caseSetVersion}\``);
  lines.push(`- Mira commit: \`${manifest.benchmark.miraCommit}\``);
  lines.push(`- repetitions recorded: ${summary.runCount}`);
  lines.push("");
  lines.push("## What this recorder consumed");
  lines.push("");
  lines.push(`- #221 raw repetition bundles: ${recognizedInput}`);
  lines.push("- per-repetition raw sources: `execution-events.ndjson` (authoritative), `stream-frames.ndjson`, `agent-run.json`, `executor-facts.json`, workspace manifests");
  lines.push("");
  lines.push("## Execution identity");
  lines.push("");
  lines.push("| case | rep | mode | comparable |");
  lines.push("| --- | ---: | --- | --- |");
  for (const r of repetitions) {
    lines.push(`| ${r.caseId} | ${r.repetition} | ${r.executionClassification} | ${r.comparable} |`);
  }
  lines.push("");
  lines.push("## Deterministic facts");
  lines.push("");
  lines.push("| case | rep | terminal | plannerIter | toolCalls | delegations | approvals | resumes | elapsedMs |");
  lines.push("| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of repetitions) {
    const d = r.deterministic ?? {};
    lines.push(
      `| ${r.caseId} | ${r.repetition} | ${d.terminal?.status ?? "unknown"} | ${d.plannerIterations ?? "?"} | ${d.toolCallCount ?? "?"} | ${d.delegationCount ?? "?"} | ${d.approvalCount ?? "?"} | ${d.resumeCount ?? "?"} | ${d.timing?.elapsedMs ?? "?"} |`,
    );
  }
  lines.push("");
  lines.push("## Timing observations");
  lines.push("");
  lines.push(`- policy state: \`${summary.timingObservations.policyState}\``);
  lines.push(`- elapsed ms values: ${JSON.stringify(summary.timingObservations.elapsedMs.values)}`);
  lines.push("- timing credit / on-time classification: not computed while `calibration_pending` (see gaps)");
  lines.push("");
  lines.push("## Artifact completeness");
  lines.push("");
  lines.push("Per repetition: `execution.json`, `trajectory.jsonl`, `result.json`, `judge-input.json`.");
  lines.push("Aggregate: `manifest.json`, `summary.json`, `report.md`, `public-summary.json`, `raw-snapshot.json`.");
  lines.push("");
  lines.push("## Observability gaps");
  lines.push("");
  if (!summary.unresolvedGaps.length) {
    lines.push("- none");
  } else {
    for (const gap of summary.unresolvedGaps) {
      lines.push(`- \`${gap.fact}\` (${gap.caseId} rep ${gap.repetition}): ${gap.missingReason}`);
    }
  }
  lines.push("");
  lines.push("## Semantic criteria awaiting a fresh blank Judge");
  lines.push("");
  lines.push("- Case semantic questions/criteria are owned by the frozen case source pack and are not reconstructed here.");
  lines.push("- `result.json.judge` and `judge-input.json.judgeFields` are `null`; a fresh blank judging thread (#224) fills them.");
  return `${lines.join("\n")}\n`;
};
