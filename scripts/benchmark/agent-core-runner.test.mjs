// Regression tests for the benchmark runner's failure-mode guards (#221 review).
//
// These cover the two blocking bugs found in review:
//   P1 — illegal arguments must not produce a silent "green" no-op run.
//   P2 — observability gaps must be structured, not silently dropped as null.
//
// Run with: pnpm check:benchmark-runner  (node --test)

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { collectObservability } from "./lib/observability.mjs";
import { parseRepetitions, resolveSelection, SelectionError } from "./lib/selection.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(here, "agent-core-runner.mjs");
const repoRoot = path.resolve(here, "..", "..");

const selectionWith = (cases, repetitions) => ({ caseSetVersion: "test", repetitions, cases });
const adaptedCase = (id) => ({
  id,
  fixture: "beginner-workspace-v0.1",
  executionMode: "adapted",
  comparabilityImpact: "none: equivalent test conditions",
});

test("parseRepetitions rejects non-positive and non-integer values", () => {
  for (const bad of [0, -1, -5, 1.5, Number.NaN, "0", "abc"]) {
    assert.throws(() => parseRepetitions(bad), SelectionError, `expected ${bad} to be rejected`);
  }
  assert.equal(parseRepetitions("3"), 3);
  assert.equal(parseRepetitions(2), 2);
  assert.equal(parseRepetitions(null), null);
});

test("resolveSelection rejects an unknown --cases id instead of filtering it away", () => {
  const selection = selectionWith([adaptedCase("a"), adaptedCase("b")], 1);
  assert.throws(
    () => resolveSelection(selection, { cases: ["does-not-exist"] }, { knownCaseIds: ["a", "b"] }),
    /not present in selection config/,
  );
});

test("resolveSelection rejects an empty resolved case set", () => {
  const selection = selectionWith([adaptedCase("a")], 1);
  assert.throws(
    () => resolveSelection(selection, { cases: [] }, { knownCaseIds: ["a"] }),
    /did not contain any case id/,
  );
  assert.throws(
    () => resolveSelection(selectionWith([], 1), {}, { knownCaseIds: [] }),
    /at least one case/,
  );
});

test("resolveSelection rejects --repetitions 0 instead of ignoring it", () => {
  const selection = selectionWith([adaptedCase("a")], 1);
  assert.throws(
    () => resolveSelection(selection, { repetitions: 0 }, { knownCaseIds: ["a"] }),
    /positive integer/,
  );
});

test("resolveSelection applies a valid subset and repetition override", () => {
  const selection = selectionWith([adaptedCase("a"), adaptedCase("b")], 5);
  const resolved = resolveSelection(selection, { cases: ["b"], repetitions: "2" }, { knownCaseIds: ["a", "b"] });
  assert.deepEqual(resolved.cases.map((c) => c.id), ["b"]);
  assert.equal(resolved.repetitions, 2);
});

test("resolveSelection requires comparabilityImpact for non-canonical cases", () => {
  const missing = { id: "x", fixture: "beginner-workspace-v0.1", executionMode: "adapted" };
  assert.throws(
    () => resolveSelection(selectionWith([missing], 1), {}, { knownCaseIds: ["x"] }),
    /comparabilityImpact/,
  );
  const canonical = { id: "y", fixture: "beginner-workspace-v0.1" };
  assert.doesNotThrow(() => resolveSelection(selectionWith([canonical], 1), {}, { knownCaseIds: ["y"] }));
});

test("collectObservability reports no gaps when every expected fact is present", () => {
  const events = [
    { nodeId: "agent-next-action-planner", phase: "done", details: { iteration: 0, selectedActionType: "answer", selectedToolId: null, finalizationEvidenceRefs: ["tool:0"] } },
    { nodeId: "agent-evaluate", phase: "done", details: { hasRequiredFinalization: true, plannerTerminalType: "answer" } },
  ];
  const result = collectObservability({ persistedEvents: events, terminalRun: { status: "completed" } });
  assert.deepEqual(result.gaps, []);
  assert.equal(result.finalizationEvidenceRefs.length, 1);
});

test("collectObservability structure-marks missing completion facts as gaps", () => {
  const events = [
    { nodeId: "agent-next-action-planner", phase: "done", details: { iteration: 0 } },
  ];
  const result = collectObservability({ persistedEvents: events, terminalRun: { status: "completed" } });
  const signals = result.gaps.map((g) => g.signal);
  assert.ok(signals.includes("selectedActionType"));
  assert.ok(signals.includes("finalizationEvidenceRefs"));
  assert.ok(signals.includes("evaluateDoneNode"));
  assert.ok(!signals.includes("terminalRunState"));
  for (const gap of result.gaps) {
    assert.ok(gap.expectedFrom && gap.detail);
  }
});

test("collectObservability does not flag legitimately absent facts for a cancelled run", () => {
  const result = collectObservability({
    persistedEvents: [{ nodeId: "agent-prepare-context", phase: "done", details: {} }],
    terminalRun: { status: "cancelled" },
  });
  assert.deepEqual(result.gaps, []);
});

test("collectObservability flags a missing terminal run state", () => {
  const result = collectObservability({ persistedEvents: [], terminalRun: null });
  assert.deepEqual(result.gaps.map((g) => g.signal), ["terminalRunState"]);
});

test("CLI: unknown --cases id exits non-zero with no run", async () => {
  const result = await execFileAsync(process.execPath, [runnerPath, "--cases", "does-not-exist"], { cwd: repoRoot }).then(
    () => ({ code: 0, stderr: "" }),
    (error) => ({ code: error.code, stderr: String(error.stderr ?? "") }),
  );
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /selection error/);
});

test("CLI: --repetitions 0 exits non-zero with no run", async () => {
  const result = await execFileAsync(process.execPath, [runnerPath, "--repetitions", "0"], { cwd: repoRoot }).then(
    () => ({ code: 0, stderr: "" }),
    (error) => ({ code: error.code, stderr: String(error.stderr ?? "") }),
  );
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /positive integer/);
});
