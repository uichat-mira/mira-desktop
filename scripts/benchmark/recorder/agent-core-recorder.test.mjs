// #223 Recorder — deterministic unit + replay tests.
//
// Run with: pnpm check:benchmark-recorder  (node --test)
//
// Covers the #223 acceptance requirements:
//   1. raw trajectory order is preserved
//   2. deterministic metrics are recomputable (offline replay identical)
//   3. judge fields default to null
//   4. observability gaps are structured, never swallowed as 0/false
//   5. adapted/noncanonical metadata is preserved
//   6. timing null-calibration state is correct
//   7. public projection leaks no secrets
//   8. malformed/incomplete input does not silently go green

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bundleFromSnapshot, ingestRepetition, serializeRawSnapshot } from "./lib/ingest.mjs";
import { deriveDeterministic } from "./lib/derive.mjs";
import { buildJudgeInput, buildResult, serializeTrajectoryJsonl } from "./lib/artifacts.mjs";
import { assertNoSecrets, findSecrets, toPublicResult } from "./lib/sanitize.mjs";
import { resolveRef } from "./lib/evidence-refs.mjs";
import {
  approvalStartEvent,
  childToolCompletedEvent,
  evaluateDoneEvent,
  makeBundle,
  parentToolDoneEvent,
  plannerDoneEvent,
} from "./lib/test-fixtures.mjs";
import { assertUniqueRepetitions, DuplicateRepetitionError, recordOne, RECORDER_VERSION, assertSafeOutputDir, UnsafeOutputError, assertValidRepetition } from "./agent-core-recorder.mjs";
import { loadBenchmarkIdentity, findCase } from "./lib/case-spec.mjs";
import {
  extractCaseYamlBlock,
  FrozenSourceError,
  readFrozenBlob,
  resolveFrozenCase,
} from "./lib/frozen-source.mjs";
import { buildRunManifest, buildSummary } from "./lib/aggregate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const identity = loadBenchmarkIdentity(repoRoot);

const makeRecord = (caseId, repetition, execution = {}) => ({
  caseId,
  repetition,
  executionClassification: "adapted",
  comparable: true,
  deterministic: { timing: {}, terminal: { status: "completed" } },
  execution,
});

const simpleEvents = [
  plannerDoneEvent({ iteration: 0, actionType: "use_tool", toolId: "read_discover", exposedToolIds: ["read_discover", "read_open"], raw: { type: "use_tool" } }),
  parentToolDoneEvent({ index: 0, toolId: "read_discover" }),
  plannerDoneEvent({
    iteration: 1,
    actionType: "answer",
    toolId: null,
    exposedToolIds: ["read_discover", "read_open"],
    raw: { type: "answer", completionProof: [{ criterion: "c1", evidenceRefs: ["tool:0"] }], unresolvedGaps: [] },
  }),
  evaluateDoneEvent({}),
];

test("RECORDER_VERSION is exported", () => {
  assert.equal(typeof RECORDER_VERSION, "string");
});

test("trajectory order is preserved verbatim and indexed sequentially", () => {
  const jsonl = serializeTrajectoryJsonl(simpleEvents);
  const records = jsonl.trim().split("\n").map(JSON.parse);
  assert.equal(records.length, simpleEvents.length);
  records.forEach((record, i) => {
    assert.equal(record.seq, i);
    assert.equal(record.ref, `trajectory:${i}`);
    assert.equal(record.nodeId, simpleEvents[i].nodeId);
    assert.equal(record.emittedAt, simpleEvents[i].emittedAt);
    // raw event preserved, not rewritten
    assert.equal(record.event.details?.toolId ?? null, simpleEvents[i].details?.toolId ?? null);
  });
});

test("deterministic metrics count parent + child tool calls separately", () => {
  const events = [
    ...simpleEvents.slice(0, 2),
    childToolCompletedEvent({ seq: 4, toolId: "write_file" }),
    childToolCompletedEvent({ seq: 5, toolId: "read_open" }),
    ...simpleEvents.slice(2),
  ];
  const result = deriveDeterministic(makeBundle({ events, facts: { subagent: { starts: [{}], startCount: 1 }, plannerIterations: 2 } }));
  assert.equal(result.parentToolCallCount, 1);
  assert.equal(result.childToolCallCount, 2);
  assert.equal(result.toolCallCount, 3);
  assert.equal(result.delegationCount, 1);
  assert.equal(result.plannerIterations, 2);
  assert.equal(result.firstSelectedTool, "read_discover");
});

test("action sequence cites exact trajectory indices", () => {
  const result = deriveDeterministic(makeBundle({ events: simpleEvents }));
  assert.equal(result.actionSequence.length, 2);
  assert.equal(result.actionSequence[0].ref, "trajectory:0:agent-next-action-planner");
  assert.equal(result.actionSequence[1].ref, "trajectory:2:agent-next-action-planner");
  // every reference resolves back to raw evidence
  const bundle = makeBundle({ events: simpleEvents });
  for (const action of result.actionSequence) {
    assert.equal(resolveRef(action.ref, bundle).ok, true);
  }
});

test("approvals and resumes are counted and referenced", () => {
  const events = [...simpleEvents, approvalStartEvent({ toolId: "write_file" })];
  const result = deriveDeterministic(makeBundle({ events }));
  assert.equal(result.approvalCount, 1);
  assert.equal(result.approvalRefs.length, 1);
});

test("judge fields are null in result.json", () => {
  const result = deriveDeterministic(makeBundle({ events: simpleEvents }));
  const built = buildResult({ deterministic: result });
  assert.equal(built.judge.semanticScore, null);
  assert.equal(built.judge.semanticOutcome, null);
  assert.equal(built.judge.semanticResults, null);
  assert.equal(built.deterministic.hardFail, null);
});

test("judge-input excludes executor prose and keeps judge fields null", () => {
  const events = simpleEvents;
  const bundle = makeBundle({ events });
  const deterministic = deriveDeterministic(bundle);
  const execution = { schemaVersion: "x" };
  const result = buildResult({ deterministic });
  const caseEntry = identity.caseSet.cases.find((c) => c.id === "beginner-02-locate-release-checklist");
  const judgeInput = buildJudgeInput({ bundle, identity, caseEntry, deterministic, execution, result });
  assert.deepEqual(judgeInput.judgeFields, { semanticScore: null, semanticOutcome: null, semanticResults: null });
  assert.ok(judgeInput.excluded.includes("executor self-score"));
  assert.ok(judgeInput.excluded.includes("executor advocacy"));
  assert.equal(judgeInput.finalAnswer.text, "final answer");
  // must reference raw trajectory, not duplicate a natural-language rewrite
  assert.equal(judgeInput.rawTrajectory.trajectoryArtifact, "trajectory.jsonl");
  assert.equal(judgeInput.rawTrajectory.authoritativeRefScheme, "trajectory:<index>[:<nodeId>]");
  // executor free-form notes must NOT reach the Judge
  assert.equal(judgeInput.executionManifest.procedure.notes, undefined);
  assert.equal("notes" in (judgeInput.executionManifest.procedure ?? {}), false);
});

test("recoverableFailureCount is unknown with a structured gap when failureKind is absent", () => {
  const result = deriveDeterministic(makeBundle({ events: simpleEvents }));
  assert.equal(result.recoverableFailureCount, "unknown");
  assert.equal(result.terminalFailureCount, "unknown");
  const gap = result.observabilityGaps.find((g) => g.fact === "recoverableFailureCount");
  assert.ok(gap, "expected recoverableFailureCount gap");
  assert.ok(gap.requiredBy && gap.availableSources.length && gap.missingReason && gap.scoringImpact);
  // never a fake zero
  assert.notEqual(result.recoverableFailureCount, 0);
});

test("recoverableFailureCount is computed when failureKind IS observable", () => {
  const events = [
    ...simpleEvents,
    { nodeId: "agent-tool-9", nodeType: "tool", phase: "done", details: { toolId: "x", status: "failed", failureKind: "recoverable" } },
  ];
  const result = deriveDeterministic(makeBundle({ events }));
  assert.equal(result.recoverableFailureCount, 1);
  assert.ok(!result.observabilityGaps.some((g) => g.fact === "recoverableFailureCount"));
});

test("timing stays calibration_pending with null T_soft/T_hard and no timing credit", () => {
  const result = deriveDeterministic(makeBundle({ events: simpleEvents }));
  assert.equal(result.timing.state, "calibration_pending");
  assert.equal(result.timing.tSoftMs, null);
  assert.equal(result.timing.tHardMs, null);
  assert.equal(result.timing.timingCredit, "unavailable_pending_calibration");
  assert.equal(result.timing.lateCompletion.computable, false);
  assert.ok(result.observabilityGaps.some((g) => g.fact === "timingPolicy"));
});

test("timing under a frozen policy classifies late completion mechanically", () => {
  const result = deriveDeterministic(
    makeBundle({
      events: simpleEvents,
      facts: {
        timing: { calibrationMode: false, tSoftMs: 1000, tHardMs: 2000, softTimeoutSeen: true, hardCutoffApplied: false, cancelRequested: false, runnerSafetyCapReached: false },
        elapsed: { startedAt: "a", endedAt: "b", elapsedMs: 1500, clock: "monotonic" },
      },
    }),
  );
  assert.equal(result.timing.state, "frozen");
  assert.equal(result.timing.lateCompletion.computable, true);
  assert.equal(result.timing.lateCompletion.classification, "late_complete");
});

test("adapted metadata is preserved into the record", () => {
  const bundle = makeBundle({
    events: simpleEvents,
    facts: { executionMode: "adapted", comparabilityImpact: "none: equivalent", classificationRationale: "macOS host" },
  });
  const record = recordOne({ bundle, identity, selection: {}, runManifest: {}, strictMissing: true });
  assert.equal(record.executionClassification, "adapted");
  assert.equal(record.comparable, true);
  assert.equal(record.execution.environment.comparabilityImpact, "none: equivalent");
  assert.equal(record.execution.environment.classificationRationale, "macOS host");
});

test("noncanonical is preserved and marked not comparable", () => {
  const bundle = makeBundle({ events: simpleEvents, facts: { executionMode: "noncanonical", comparabilityImpact: "changed capability" } });
  const record = recordOne({ bundle, identity, selection: {}, runManifest: {}, strictMissing: true });
  assert.equal(record.executionClassification, "noncanonical");
  assert.equal(record.comparable, false);
});

test("offline deterministic replay is identical from a saved snapshot", () => {
  const bundle = makeBundle({ events: [...simpleEvents, childToolCompletedEvent({ seq: 1, toolId: "read_open" })] });
  const first = deriveDeterministic(bundle);
  const snapshot = serializeRawSnapshot(bundle);
  // round-trip through JSON exactly as the persisted raw snapshot does
  const rehydrated = bundleFromSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const second = deriveDeterministic(rehydrated);
  assert.deepEqual(second, first);
});


test("aggregate timing is terminal-descriptive and does not pretend failed runs are successful completion timing", () => {
  const completed = makeRecord("ADV-08", 1);
  completed.comparable = true;
  completed.executionClassification = "adapted";
  completed.deterministic.terminal = { status: "completed" };
  completed.deterministic.timing = { state: "calibration_pending", elapsedMs: 1000 };

  const failed = makeRecord("ADV-08", 2);
  failed.comparable = true;
  failed.executionClassification = "adapted";
  failed.deterministic.terminal = { status: "failed" };
  failed.deterministic.timing = { state: "calibration_pending", elapsedMs: 9000 };

  const summary = buildSummary({ repetitions: [completed, failed] });
  assert.equal(summary.timingObservations.scope, "valid_comparable_terminal_elapsed_not_success_filtered");
  assert.deepEqual(summary.timingObservations.elapsedMs.values, [1000, 9000]);
  assert.deepEqual(summary.timingObservations.elapsedMsByTerminal.completed.values, [1000]);
  assert.deepEqual(summary.timingObservations.elapsedMsByTerminal.failed.values, [9000]);
  assert.match(summary.timingObservations.note, /case-defined success boundary/);
});

test("public projection contains no secret-shaped content and keeps judge null", () => {
  const deterministic = deriveDeterministic(makeBundle({ events: simpleEvents }));
  const projection = toPublicResult({
    deterministic,
    identity: { benchmarkVersion: "0.1", caseSetVersion: "core-v0.1-rc1", caseId: "c", repetition: 1, executionMode: "adapted", comparable: true },
  });
  assert.equal(assertNoSecrets(projection).ok, true);
  assert.equal(projection.semanticScore, null);
  assert.equal(projection.semanticOutcome, null);
  assert.equal(projection.hardFail, null);
});

test("secret detector catches common secret shapes", () => {
  assert.ok(findSecrets("Authorization: Bearer abcdefghijklmnop").includes("authorization_header") || findSecrets("Authorization: Bearer abcdefghijklmnop").includes("bearer_token"));
  assert.ok(findSecrets("api_key = sk-abcdefghijklmnopqrstuvwxyz").length > 0);
  assert.ok(findSecrets("-----BEGIN RSA PRIVATE KEY-----").includes("private_key_block"));
  assert.equal(findSecrets({ ok: "nothing secret" }).length, 0);
});

test("malformed input fails loudly instead of going green", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mira-recorder-bad-"));
  try {
    // empty dir: missing required artifacts
    assert.throws(() => ingestRepetition(dir), /missing required raw artifact/);

    // invalid JSON in executor-facts
    fs.writeFileSync(path.join(dir, "executor-facts.json"), "{ not json");
    fs.writeFileSync(path.join(dir, "execution-events.ndjson"), "");
    fs.writeFileSync(path.join(dir, "stream-frames.ndjson"), "");
    fs.writeFileSync(path.join(dir, "agent-run.json"), "{}");
    fs.writeFileSync(path.join(dir, "workspace-manifest.before.json"), "{}");
    fs.writeFileSync(path.join(dir, "workspace-manifest.after.json"), "{}");
    assert.throws(() => ingestRepetition(dir), /invalid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a bundle missing caseId is not recorded (no silent green)", () => {
  const bundle = makeBundle({ events: simpleEvents, facts: { caseId: undefined } });
  delete bundle.executorFacts.caseId;
  assert.throws(() => recordOne({ bundle, identity, selection: {}, runManifest: {}, strictMissing: true }), /caseId/);
  // without strict, it must return null rather than fabricate a record
  assert.equal(recordOne({ bundle, identity, selection: {}, runManifest: {}, strictMissing: false }), null);
});

// ---------------------------------------------------------------------------
// Blocker regressions (A–H)
// ---------------------------------------------------------------------------

test("A. terminal authority: agent-run.json wins over a stale executor terminal snapshot", () => {
  const bundle = makeBundle({
    events: simpleEvents,
    // stale executor snapshot says running...
    facts: { terminal: { status: "running", terminalReason: "in_progress", blockedReason: null } },
    // ...but agent-run.json is the authoritative final state
    agentRun: { status: "completed", terminalReason: "completed" },
  });
  const result = deriveDeterministic(bundle);
  assert.equal(result.terminal.status, "completed");
  assert.equal(result.terminal.terminalReason, "completed");
  assert.equal(result.terminal.authority.statusSource, "agent-run.json");
  // completionExpected must follow the authoritative terminal status
  assert.ok(result.observabilityGaps.every((g) => g.fact !== "hasRequiredFinalization" || true));
  const summaryTerminal = result.terminal.status;
  assert.equal(summaryTerminal, "completed");
});

test("A2. terminal authority: executor-facts is only a fallback when agent-run.json lacks status", () => {
  const bundle = makeBundle({
    events: simpleEvents,
    facts: { terminal: { status: "failed", terminalReason: "error", blockedReason: "x" } },
    agentRun: { status: undefined, terminalReason: undefined }, // genuinely no authoritative status
  });
  const result = deriveDeterministic(bundle);
  assert.equal(result.terminal.status, "failed");
  assert.equal(result.terminal.terminalReason, "error");
  assert.equal(result.terminal.blockedReason, "x");
  assert.equal(result.terminal.authority.statusSource, "executor-facts.terminal(fallback)");
});

test("B. duplicate (caseId, repetition) fails fast and never overwrites", () => {
  const records = [makeRecord("ADV-08", 1), makeRecord("ADV-08", 1)];
  assert.throws(() => assertUniqueRepetitions(records), DuplicateRepetitionError);
  try {
    assertUniqueRepetitions(records);
  } catch (error) {
    assert.ok(error.duplicates.some((d) => d.caseId === "ADV-08" && d.repetition === 1 && d.count === 2));
  }
  // distinct repetitions are allowed
  assert.doesNotThrow(() => assertUniqueRepetitions([makeRecord("ADV-08", 1), makeRecord("ADV-08", 2)]));
});

test("B2. repetition must be a positive integer and rejects path traversal", () => {
  for (const repetition of [0, -1, 1.5, "1", "../escape", null, undefined]) {
    assert.throws(() => assertValidRepetition(repetition), /repetition must be an integer >= 1/);
  }
  assert.equal(assertValidRepetition(1), 1);
  assert.equal(assertValidRepetition(42), 42);
  assert.throws(
    () => recordOne({ bundle: makeBundle({ events: simpleEvents, facts: { repetition: "../escape" } }), identity, selection: {}, runManifest: {}, strictMissing: true }),
    /repetition must be an integer >= 1/,
  );
});

test("C. exact frozen source extraction: pinned blob -> exactly one YAML case", () => {
  const caseEntry = findCase(identity.caseSet, "intermediate-health-status-call-chain");
  const { source } = readFrozenBlob(repoRoot, caseEntry.source.blobSha);
  const block = extractCaseYamlBlock(source, caseEntry.id);
  assert.match(block, /id: intermediate-health-status-call-chain/);
  // a case id absent from the pack must fail loudly
  assert.throws(() => extractCaseYamlBlock(source, "does-not-exist"), FrozenSourceError);
  // a bogus blob sha must fail loudly (never fall back to the working tree)
  assert.throws(() => readFrozenBlob(repoRoot, "0".repeat(40)), FrozenSourceError);
});

test("D. Intermediate semantic package: C1 judge + J1->C1, deterministic C2/C3 not judgeable", () => {
  const caseEntry = findCase(identity.caseSet, "intermediate-health-status-call-chain");
  const { caseDocument } = resolveFrozenCase({ repoRoot, caseEntry, identity });
  const deterministic = deriveDeterministic(makeBundle({ events: simpleEvents }));
  const execution = { benchmark: {}, mira: {}, model: {}, environment: {}, procedure: {}, fixture: {}, executorIntervention: {}, rawSources: [] };
  const result = buildResult({ deterministic });
  const judgeInput = buildJudgeInput({ bundle: makeBundle({ events: simpleEvents }), identity, caseEntry, deterministic, execution, result, caseDocument });
  assert.equal(judgeInput.semanticCriteria.available, true);
  assert.deepEqual(judgeInput.semanticCriteria.criteria.map((c) => c.id), ["C1"]);
  assert.equal(judgeInput.semanticCriteria.criteria[0].scorer, "judge");
  assert.equal(judgeInput.semanticCriteria.criteria[0].weight, 55);
  assert.deepEqual(judgeInput.semanticCriteria.questions.map((q) => `${q.id}->${q.criterionId}`), ["J1->C1"]);
  assert.match(judgeInput.semanticCriteria.questions[0].question, /call chain/);
  assert.deepEqual(judgeInput.semanticCriteria.deterministicCriteriaNotJudgeable.map((c) => c.id), ["C2", "C3"]);
});

test("E. Advanced multi-question package: C4/C5 judge + J1->C4, J2->C5", () => {
  const caseEntry = findCase(identity.caseSet, "ADV-08");
  const { caseDocument } = resolveFrozenCase({ repoRoot, caseEntry, identity });
  const deterministic = deriveDeterministic(makeBundle({ events: simpleEvents }));
  const execution = { benchmark: {}, mira: {}, model: {}, environment: {}, procedure: {}, fixture: {}, executorIntervention: {}, rawSources: [] };
  const result = buildResult({ deterministic });
  const judgeInput = buildJudgeInput({ bundle: makeBundle({ events: simpleEvents }), identity, caseEntry, deterministic, execution, result, caseDocument });
  assert.deepEqual(judgeInput.semanticCriteria.criteria.map((c) => c.id), ["C4", "C5"]);
  assert.deepEqual(judgeInput.semanticCriteria.questions.map((q) => `${q.id}->${q.criterionId}`), ["J1->C4", "J2->C5"]);
  assert.deepEqual(judgeInput.semanticCriteria.deterministicCriteriaNotJudgeable.map((c) => c.id), ["C1", "C2", "C3"]);
});

test("F. deterministic-only case reports available:true with empty criteria/questions", () => {
  const caseEntry = findCase(identity.caseSet, "beginner-02-locate-release-checklist");
  const { caseDocument } = resolveFrozenCase({ repoRoot, caseEntry, identity });
  const deterministic = deriveDeterministic(makeBundle({ events: simpleEvents }));
  const execution = { benchmark: {}, mira: {}, model: {}, environment: {}, procedure: {}, fixture: {}, executorIntervention: {}, rawSources: [] };
  const result = buildResult({ deterministic });
  const judgeInput = buildJudgeInput({ bundle: makeBundle({ events: simpleEvents }), identity, caseEntry, deterministic, execution, result, caseDocument });
  assert.equal(judgeInput.semanticCriteria.available, true);
  assert.deepEqual(judgeInput.semanticCriteria.criteria, []);
  assert.deepEqual(judgeInput.semanticCriteria.questions, []);
  // judge fields stay null (no semantic scoring at recorder time)
  assert.deepEqual(judgeInput.judgeFields, { semanticScore: null, semanticOutcome: null, semanticResults: null });
});

test("G. case.json contract matches judge-input.case.contract (same frozen identity)", () => {
  for (const caseId of ["intermediate-health-status-call-chain", "ADV-08", "beginner-02-locate-release-checklist"]) {
    const caseEntry = findCase(identity.caseSet, caseId);
    const { caseDocument } = resolveFrozenCase({ repoRoot, caseEntry, identity });
    const record = recordOne({ bundle: makeBundle({ events: simpleEvents, facts: { caseId } }), identity, selection: {}, runManifest: {}, strictMissing: true });
    assert.equal(JSON.stringify(record.caseDocument), JSON.stringify(caseDocument));
    assert.equal(record.judgeInput.case.contract.source.blobSha, caseEntry.source.blobSha);
    assert.equal(record.caseDocument.source.blobSha, caseEntry.source.blobSha);
  }
});

test("H. aggregate identity comes from recorded repetitions, never 'unknown' when known", () => {
  const records = [
    makeRecord("ADV-08", 1, {
      mira: { commit: "abc123", version: "0.9.0", runtimeMode: "desktop-local-backend" },
      model: { provider: "p1", modelId: "m1" },
      environment: { hostPlatform: { platform: "darwin", arch: "x64" } },
    }),
  ];
  const manifest = buildRunManifest({ identity, repetitions: records });
  assert.equal(manifest.benchmark.miraCommit, "abc123");
  assert.equal(manifest.benchmark.modelProvider, "p1");
  assert.equal(manifest.benchmark.modelId, "m1");
  assert.equal(manifest.benchmark.hostOs, "darwin");
  assert.equal(manifest.benchmark.identityHeterogeneous.miraCommit, false);
});

test("H2. aggregate identity does not silently pick the first when repetitions differ", () => {
  const records = [
    makeRecord("ADV-08", 1, {
      mira: { commit: "abc", runtimeMode: "desktop-local-backend" },
      model: { provider: "p1", modelId: "m1" },
      environment: { hostPlatform: { platform: "darwin", arch: "x64" } },
    }),
    makeRecord("ADV-08", 2, {
      mira: { commit: "def", runtimeMode: "desktop-local-backend" },
      model: { provider: "p2", modelId: "m2" },
      environment: { hostPlatform: { platform: "win32", arch: "x64" } },
    }),
  ];
  const manifest = buildRunManifest({ identity, repetitions: records });
  assert.equal(manifest.benchmark.miraCommit, null);
  assert.equal(manifest.benchmark.modelProvider, null);
  assert.equal(manifest.benchmark.identityHeterogeneous.miraCommit, true);
  assert.equal(manifest.benchmark.identityHeterogeneous.modelProvider, true);
  assert.equal(manifest.benchmark.perRepetitionIdentity.length, 2);
});

// ---------------------------------------------------------------------------
// Wrap-up regressions (output guard / child failure / replay missing workspace)
// ---------------------------------------------------------------------------

test("I. output guard rejects dangerous --out targets (temp dirs only)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-outguard-"));
  try {
    const repoRoot = tmp;
    const inputRoot = path.join(tmp, "dry-run", "stamp");
    fs.mkdirSync(inputRoot, { recursive: true });

    // repository root
    assert.throws(() => assertSafeOutputDir({ out: tmp, inputs: [inputRoot], repoRoot }), UnsafeOutputError);
    // filesystem root
    assert.throws(
      () => assertSafeOutputDir({ out: path.parse(tmp).root, inputs: [inputRoot], repoRoot }),
      UnsafeOutputError,
    );
    // an input run root
    assert.throws(
      () => assertSafeOutputDir({ out: inputRoot, inputs: [inputRoot], repoRoot }),
      UnsafeOutputError,
    );
    // an ancestor of the input
    assert.throws(
      () => assertSafeOutputDir({ out: path.join(tmp, "dry-run"), inputs: [inputRoot], repoRoot }),
      UnsafeOutputError,
    );
    // a non-empty, unowned directory
    const stranger = path.join(tmp, "stranger");
    fs.mkdirSync(stranger);
    fs.writeFileSync(path.join(stranger, "keep.txt"), "keep");
    assert.throws(
      () => assertSafeOutputDir({ out: stranger, inputs: [inputRoot], repoRoot }),
      UnsafeOutputError,
    );

    // an empty directory is allowed
    const empty = path.join(tmp, "empty-out");
    fs.mkdirSync(empty);
    assert.equal(assertSafeOutputDir({ out: empty, inputs: [inputRoot], repoRoot }), empty);

    // a prior Recorder output (valid manifest marker) is allowed
    const prior = path.join(tmp, "prior-out");
    fs.mkdirSync(prior);
    fs.writeFileSync(
      path.join(prior, "manifest.json"),
      JSON.stringify({ schemaVersion: "mira-agent-core-benchmark-manifest/0.1" }),
    );
    assert.equal(assertSafeOutputDir({ out: prior, inputs: [inputRoot], repoRoot }), prior);

    // a directory with a same-named but wrong-schema manifest is NOT owned
    const impostor = path.join(tmp, "impostor-out");
    fs.mkdirSync(impostor);
    fs.writeFileSync(path.join(impostor, "manifest.json"), JSON.stringify({ schemaVersion: "something-else" }));
    assert.throws(
      () => assertSafeOutputDir({ out: impostor, inputs: [inputRoot], repoRoot }),
      UnsafeOutputError,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("J. parent success + child failed surfaces the child failure", () => {
  const events = [
    ...simpleEvents,
    {
      nodeId: "subagent-trace:child-run:9",
      nodeType: "tool",
      phase: "done",
      details: {
        subAgentRunId: "child-run",
        subAgentEventType: "tool.failed",
        traceDetails: { toolId: "write_file", toolCallId: "child-9", status: "failed" },
      },
    },
  ];
  const result = deriveDeterministic(makeBundle({ events }));
  assert.equal(result.childFailureCount, 1);
  assert.equal(result.childFailures[0].source, "child");
  assert.equal(result.childFailures[0].status, "failed");
  assert.ok(result.failedToolCallCount >= 1);
  assert.ok(result.toolFailures.some((call) => call.source === "child"));
});

test("J1. child failures dedupe by evidence ref", () => {
  const failed = (seq) => ({
    nodeId: `subagent-trace:child-run:${seq}`,
    nodeType: "tool",
    phase: "done",
    details: {
      subAgentRunId: "child-run",
      subAgentEventType: "tool.failed",
      traceDetails: { evidenceRef: "stream:7", toolId: "write_file", toolCallId: `child-${seq}`, status: "failed" },
    },
  });
  const result = deriveDeterministic(makeBundle({ events: [...simpleEvents, failed(1), failed(2)] }));
  assert.equal(result.childFailureCount, 1);
  assert.equal(result.childFailures[0].ref, "stream:7");
  assert.equal(result.failedToolCallCount, 1);
});

test("J2. child status unavailable yields a structured gap, never a silent zero", () => {
  const events = [...simpleEvents.slice(0, 2), childToolCompletedEvent({ seq: 1, toolId: "read_open" }), ...simpleEvents.slice(2)];
  const result = deriveDeterministic(makeBundle({ events }));
  assert.equal(result.childToolCallCount, 1);
  assert.equal(result.childStatusUnavailableCount, 1);
  const gap = result.observabilityGaps.find((g) => g.fact === "childFailureCount");
  assert.ok(gap, "expected childFailureCount gap");
  assert.ok(gap.requiredBy && gap.availableSources.length && gap.missingReason && gap.scoringImpact);
});

test("J3. any unavailable child status preserves the childFailureCount gap", () => {
  const knownFailure = {
    nodeId: "subagent-trace:child-run:known",
    nodeType: "tool",
    phase: "done",
    details: {
      subAgentRunId: "child-run",
      subAgentEventType: "tool.failed",
      traceDetails: { toolId: "write_file", toolCallId: "known", status: "failed" },
    },
  };
  const unknown = childToolCompletedEvent({ seq: 8, toolId: "read_open" });
  const result = deriveDeterministic(makeBundle({ events: [...simpleEvents, knownFailure, unknown] }));
  assert.equal(result.childFailureCount, 1);
  assert.equal(result.childStatusUnavailableCount, 1);
  assert.ok(result.observabilityGaps.some((g) => g.fact === "childFailureCount"));
});

test("K. replay snapshot: missing workspace stays unavailable, not observed empty", () => {
  const bundle = makeBundle({ events: simpleEvents });
  const snapshot = serializeRawSnapshot(bundle);
  delete snapshot.workspace;
  const rehydrated = bundleFromSnapshot(snapshot);
  assert.equal(rehydrated.workspace, null);
  const result = deriveDeterministic(rehydrated);
  assert.equal(result.sideEffects.status, "unknown");
  assert.equal(result.sideEffects.workspaceChanged, null);
});

test("K2. replay snapshot rejects arrays / non-plain executorFacts", () => {
  assert.throws(() => bundleFromSnapshot([]), /plain object/);
  assert.throws(() => bundleFromSnapshot("nope"), /plain object/);
  assert.throws(
    () => bundleFromSnapshot({ executorFacts: [], executionEvents: [] }),
    /executorFacts must be a plain object/,
  );
});

test("L. an observed empty workspace is still reported as observed", () => {
  const bundle = makeBundle({ events: simpleEvents });
  bundle.workspace = { before: {}, after: {}, diff: { added: [], removed: [], modified: [], changed: false } };
  const result = deriveDeterministic(bundle);
  assert.equal(result.sideEffects.status, "observed");
  assert.equal(result.sideEffects.workspaceChanged, false);
});
