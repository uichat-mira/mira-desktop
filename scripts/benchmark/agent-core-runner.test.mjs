// Regression tests for the benchmark runner's failure-mode guards (#221 review).
//
// These cover the two blocking bugs found in review:
//   P1 — illegal arguments must not produce a silent "green" no-op run.
//   P2 — observability gaps must be structured, not silently dropped as null.
//
// Run with: pnpm check:benchmark-runner  (node --test)

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runRepetition } from "./agent-core-runner.mjs";
import { createClient } from "./lib/http.mjs";
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
  provider: "default",
  executionMode: "adapted",
  comparabilityImpact: "none: equivalent test conditions",
  approvalPolicy: "auto-approve",
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
  const canonical = {
    id: "y",
    fixture: "beginner-workspace-v0.1",
    provider: "default",
    approvalPolicy: "auto-approve",
  };
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


const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const caseSetFor = (id) => ({
  caseSetVersion: "test-v0",
  cases: [
    {
      id,
      difficulty: "Beginner",
      public: { prompt: "initial prompt" },
      timing: { tSoftMs: null, tHardMs: null, status: "calibration_pending" },
    },
  ],
});

const runnerArgs = (overrides = {}) => ({
  keepFixture: false,
  cancelAfterMs: null,
  maxWaitMs: 1000,
  pollIntervalMs: 5,
  ...overrides,
});

test("runRepetition excludes workspace/thread setup from benchmark elapsed time", async (t) => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mira-bench-timer-"));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));

  const client = {
    async createWorkspace() {
      await delay(50);
      return { id: "ws-1" };
    },
    async createThread() {
      await delay(50);
      return { id: "thread-1" };
    },
    async streamChatTurn(_input, { onEvent }) {
      onEvent?.({
        type: "data-execution-node",
        data: { details: { runId: "run-1" } },
      });
      await delay(5);
      return { runId: "run-1", finishReason: "stop", events: [] };
    },
    async getRun() {
      return { status: "completed", terminalReason: "completed" };
    },
    async getMessages() {
      return [];
    },
    async archiveThread() {},
    async deleteWorkspace() {},
    async approveRun() {},
    async cancelRun() {},
  };

  const wallStarted = Date.now();
  const result = await runRepetition({
    args: runnerArgs(),
    client,
    caseSet: caseSetFor("beginner-02-locate-release-checklist"),
    selectionEntry: {
      id: "beginner-02-locate-release-checklist",
      fixture: "beginner-workspace-v0.1",
      executionMode: "canonical",
      provider: "default",
      approvalPolicy: "auto-approve",
    },
    outputRoot,
    repetitionIndex: 1,
  });
  const wallElapsedMs = Date.now() - wallStarted;
  const benchmarkElapsedMs = result.executorFacts.elapsed.elapsedMs;

  assert.ok(wallElapsedMs >= 90, `expected setup delay in wall time, got ${wallElapsedMs}ms`);
  assert.ok(
    wallElapsedMs - benchmarkElapsedMs >= 80,
    `setup leaked into benchmark timer: wall=${wallElapsedMs}ms benchmark=${benchmarkElapsedMs}ms`,
  );
});

test("waiting_user follow-up stays non-blocking so cancel control remains live", async (t) => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mira-bench-followup-"));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));

  let streamCount = 0;
  let cancelled = false;
  const cancelledRunIds = [];

  const client = {
    async createWorkspace() {
      return { id: "ws-2" };
    },
    async createThread() {
      return { id: "thread-2" };
    },
    async streamChatTurn({ signal }, { onEvent }) {
      streamCount += 1;
      const runId = streamCount === 1 ? "run-1" : "run-2";
      onEvent?.({
        type: "data-execution-node",
        data: { details: { runId } },
      });

      if (streamCount === 1) {
        return { runId, finishReason: null, events: [] };
      }

      return new Promise((resolve, reject) => {
        const abort = () => reject(signal?.reason ?? new Error("aborted"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    },
    async getRun(runId) {
      if (runId === "run-1") return { status: "waiting_user" };
      return {
        status: cancelled ? "cancelled" : "running",
        terminalReason: cancelled ? "cancelled" : null,
      };
    },
    async cancelRun(runId) {
      cancelled = true;
      cancelledRunIds.push(runId);
      return { status: "cancelled", terminalReason: "cancelled" };
    },
    async getMessages() {
      return [];
    },
    async archiveThread() {},
    async deleteWorkspace() {},
    async approveRun() {},
  };

  const wallStarted = Date.now();
  const result = await runRepetition({
    args: runnerArgs({ cancelAfterMs: 30 }),
    client,
    caseSet: caseSetFor("beginner-08-contextual-config-follow-up"),
    selectionEntry: {
      id: "beginner-08-contextual-config-follow-up",
      fixture: "beginner-workspace-v0.1",
      executionMode: "canonical",
      provider: "default",
      approvalPolicy: "auto-approve",
      turns: ["initial prompt", "scripted follow-up"],
    },
    outputRoot,
    repetitionIndex: 1,
  });
  const wallElapsedMs = Date.now() - wallStarted;

  assert.deepEqual(cancelledRunIds, ["run-2"]);
  assert.equal(result.executorFacts.terminal.status, "cancelled");
  assert.equal(result.executorFacts.timing.cancelRequested, true);
  assert.ok(
    wallElapsedMs < 500,
    `follow-up stream blocked cutoff monitoring for ${wallElapsedMs}ms`,
  );
});


test("resolveSelection rejects unsupported deny approval policy instead of faking a denial", () => {
  const denied = {
    ...adaptedCase("deny-case"),
    approvalPolicy: "deny",
  };
  assert.throws(
    () => resolveSelection(selectionWith([denied], 1), {}, { knownCaseIds: ["deny-case"] }),
    /deny\/reject is not supported/,
  );
});

test("resolveSelection requires an explicit provider and never falls back to default", () => {
  const missingProvider = { ...adaptedCase("provider-case") };
  delete missingProvider.provider;
  assert.throws(
    () => resolveSelection(selectionWith([missingProvider], 1), {}, { knownCaseIds: ["provider-case"] }),
    /must declare an explicit provider/,
  );

  const invalidProvider = { ...adaptedCase("provider-case"), provider: "bad/provider" };
  assert.throws(
    () => resolveSelection(selectionWith([invalidProvider], 1), {}, { knownCaseIds: ["provider-case"] }),
    /invalid provider/,
  );
});

test("HTTP client routes a chat turn through the selected provider", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return {
      ok: true,
      status: 200,
      body,
      async text() { return ""; },
    };
  };
  const client = createClient({ baseUrl: "http://127.0.0.1:9999", fetchImpl });
  await client.streamChatTurn({
    threadId: "thread-provider",
    provider: "provider-x",
    messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  });
  assert.deepEqual(seen, ["http://127.0.0.1:9999/proxy/chat/provider-x"]);
});

test("HTTP client refuses a chat turn without an explicit provider", async () => {
  const client = createClient({
    baseUrl: "http://127.0.0.1:9999",
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    },
  });
  await assert.rejects(
    () => client.streamChatTurn({
      threadId: "thread-provider",
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    }),
    /requires an explicit provider/,
  );
});
