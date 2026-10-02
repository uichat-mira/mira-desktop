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
import { cleanupFixture, listFixtures, materializeFixture, resolveFixture, workspaceManifest } from "./lib/fixtures.mjs";
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


test("Core v0.1 Batch 2-5 fixture ids are registered", () => {
  const expected = [
    "beginner-workspace-v0.1",
    "i02-v1", "i03-v1", "i04-v1", "i05-v1", "i06-v1", "i07-v1",
    "adv01-v1", "adv02-v1", "adv03-v1", "adv04-v1", "adv05-v1", "adv06-v1", "adv07-v1",
  ];
  const known = new Set(listFixtures());
  for (const id of expected) assert.equal(known.has(id), true, id);
  assert.throws(() => resolveFixture("missing-v1"), /Unknown fixture/);
});

test("fixture reset is deterministic for representative static fixtures", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mira-bench-fixtures-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const fixtureId of ["i02-v1", "i04-v1", "i06-v1", "adv01-v1", "adv06-v1"]) {
    const workspace = path.join(root, fixtureId, "workspace");
    const external = path.join(root, fixtureId, "external");
    materializeFixture({ fixtureId, destDir: workspace, externalDir: external });
    const first = workspaceManifest(workspace);
    fs.writeFileSync(path.join(workspace, "unexpected.txt"), "dirty\n", "utf8");
    materializeFixture({ fixtureId, destDir: workspace, externalDir: external });
    assert.deepEqual(workspaceManifest(workspace), first, fixtureId);
  }
});

test("i03 fixture issues a fresh recoverable challenge and accepts only its ticket", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mira-bench-i03-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const external = path.join(root, "external");
  materializeFixture({ fixtureId: "i03-v1", destDir: workspace, externalDir: external });

  const first = await execFileAsync(process.execPath, ["tools/handshake-check.mjs"], { cwd: workspace }).then(
    (result) => ({ code: 0, stdout: result.stdout, stderr: result.stderr }),
    (error) => ({ code: error.code, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") }),
  );
  assert.notEqual(first.code, 0);
  const challenge = JSON.parse(first.stderr.trim());
  assert.equal(challenge.status, "challenge");

  const second = await execFileAsync(process.execPath, ["tools/handshake-check.mjs", "--ticket", challenge.challenge], { cwd: workspace });
  assert.match(second.stdout, /"status":"ok"/);
});

test("adv04 fixture enforces one-shot full audit", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mira-bench-adv04-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  materializeFixture({ fixtureId: "adv04-v1", destDir: workspace, externalDir: path.join(root, "external") });

  const first = await execFileAsync(process.execPath, ["scripts/full-audit.mjs"], { cwd: workspace });
  assert.match(first.stdout, /search: FAIL/);

  const second = await execFileAsync(process.execPath, ["scripts/full-audit.mjs"], { cwd: workspace }).then(
    () => ({ code: 0 }),
    (error) => ({ code: error.code }),
  );
  assert.notEqual(second.code, 0);
});

test("adv05 fixture reaches ready and verifier passes for the same job", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mira-bench-adv05-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  materializeFixture({ fixtureId: "adv05-v1", destDir: workspace, externalDir: path.join(root, "external") });

  const kickoff = await execFileAsync(process.execPath, ["scripts/start-async-build.mjs"], { cwd: workspace });
  const started = JSON.parse(kickoff.stdout.trim());
  assert.equal(started.status, "building");

  let status = null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    status = JSON.parse((await execFileAsync(process.execPath, ["scripts/show-async-status.mjs"], { cwd: workspace })).stdout.trim());
    if (status.status === "ready") break;
    await delay(100);
  }
  assert.equal(status?.jobId, started.jobId);
  assert.equal(status?.status, "ready");

  const verified = await execFileAsync(process.execPath, ["scripts/verify-async-build.mjs"], { cwd: workspace });
  assert.match(verified.stdout, new RegExp(started.jobId));
});

test("selection rejects malformed triggered follow-ups", () => {
  const base = adaptedCase("x");
  assert.throws(
    () => resolveSelection(selectionWith([{ ...base, followUps: [{ when: "later", text: "x" }] }], 1), {}, { knownCaseIds: ["x"] }),
    /followUps require/,
  );
  assert.throws(
    () => resolveSelection(selectionWith([{ ...base, turns: ["a"], followUps: [{ when: "completed", text: "b" }] }], 1), {}, { knownCaseIds: ["x"] }),
    /must not declare both/,
  );
});

test("completed-trigger follow-up starts a second AgentRun", async (t) => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mira-bench-completed-followup-"));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));

  let streamCount = 0;
  const client = {
    async createWorkspace() { return { id: "ws-c" }; },
    async createThread() { return { id: "thread-c" }; },
    async streamChatTurn(_input, { onEvent }) {
      streamCount += 1;
      const runId = "run-" + streamCount;
      onEvent?.({ type: "data-execution-node", data: { details: { runId } } });
      return { runId, finishReason: "stop", events: [] };
    },
    async getRun(runId) { return { status: "completed", terminalReason: "completed", id: runId }; },
    async getMessages() { return []; },
    async archiveThread() {},
    async deleteWorkspace() {},
    async approveRun() {},
    async cancelRun() {},
  };

  const result = await runRepetition({
    args: runnerArgs(),
    client,
    caseSet: caseSetFor("beginner-08-contextual-config-follow-up"),
    selectionEntry: {
      id: "beginner-08-contextual-config-follow-up",
      fixture: "beginner-workspace-v0.1",
      executionMode: "canonical",
      provider: "default",
      approvalPolicy: "auto-approve",
      followUps: [{ when: "completed", text: "那 timeoutMs 呢？" }],
    },
    outputRoot,
    repetitionIndex: 1,
  });

  assert.equal(streamCount, 2);
  assert.equal(result.executorFacts.executorInterventions.filter((x) => x.type === "user_reply").length, 1);
  assert.equal(result.executorFacts.terminal.status, "completed");
});


test("Batch 2-5 selections cover exactly the remaining 20 calibration cases", () => {
  const expected = new Set([
    "beginner-03-find-retry-window-references",
    "beginner-04-read-only-telemetry-state",
    "intermediate-production-retry-only",
    "ADV-01",
    "ADV-02",
    "beginner-05-local-version-no-network",
    "beginner-06-read-command-do-not-execute",
    "intermediate-handshake-recovery",
    "intermediate-version-validator",
    "ADV-03",
    "beginner-07-rename-one-file",
    "beginner-08-contextual-config-follow-up",
    "intermediate-inspect-then-continue",
    "ADV-04",
    "ADV-05",
    "beginner-09-ambiguous-rename-clarification",
    "intermediate-already-aligned-noop",
    "intermediate-release-region-followup",
    "ADV-06",
    "ADV-07",
  ]);
  const seen = [];
  for (const batch of [2, 3, 4, 5]) {
    const selection = JSON.parse(
      fs.readFileSync(path.join(here, "selections", "batch-" + batch + ".json"), "utf8"),
    );
    assert.equal(selection.cases.length, 5, "batch " + batch);
    const resolved = resolveSelection(selection, {}, { knownCaseIds: [...expected] });
    for (const entry of resolved.cases) {
      assert.doesNotThrow(() => resolveFixture(entry.fixture, { externalDir: path.join(os.tmpdir(), "mira-bench-ext") }));
      seen.push(entry.id);
    }
  }
  assert.deepEqual(new Set(seen), expected);
  assert.equal(seen.length, 20);
});

test("selection validates initialPrompt and accepts B08 completed follow-up shape", () => {
  const base = adaptedCase("x");
  assert.throws(
    () => resolveSelection(selectionWith([{ ...base, initialPrompt: "   " }], 1), {}, { knownCaseIds: ["x"] }),
    /initialPrompt must be a non-empty string/,
  );
  assert.doesNotThrow(() =>
    resolveSelection(
      selectionWith([{
        ...base,
        initialPrompt: "first",
        followUps: [{ when: "completed", text: "second" }],
      }], 1),
      {},
      { knownCaseIds: ["x"] },
    ),
  );
});


test("adv05 cleanup hook terminates a live fixture worker", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mira-bench-adv05-cleanup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const spec = materializeFixture({ fixtureId: "adv05-v1", destDir: workspace, externalDir: path.join(root, "external") });

  await execFileAsync(process.execPath, ["scripts/start-async-build.mjs"], { cwd: workspace });
  const pid = Number(fs.readFileSync(path.join(workspace, ".fixture", "async-worker.pid"), "utf8").trim());
  assert.ok(Number.isInteger(pid) && pid > 0);
  cleanupFixture(spec, { destDir: workspace, externalDir: path.join(root, "external") });

  let alive = true;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") {
        alive = false;
        break;
      }
      throw error;
    }
    await delay(50);
  }
  assert.equal(alive, false);
});


test("follow-up without runId obeys runner safety bound", async (t) => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mira-bench-followup-no-runid-"));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));

  let streamCount = 0;
  const client = {
    async createWorkspace() { return { id: "ws-nr" }; },
    async createThread() { return { id: "thread-nr" }; },
    async streamChatTurn(_input, { onEvent }) {
      streamCount += 1;
      if (streamCount === 1) {
        onEvent?.({ type: "data-execution-node", data: { details: { runId: "run-1" } } });
        return { runId: "run-1", finishReason: "stop", events: [] };
      }
      return new Promise(() => {});
    },
    async getRun() { return { status: "completed", terminalReason: "completed" }; },
    async getMessages() { return []; },
    async archiveThread() {},
    async deleteWorkspace() {},
    async approveRun() {},
    async cancelRun() {},
  };

  const result = await runRepetition({
    args: runnerArgs({ maxWaitMs: 80 }),
    client,
    caseSet: caseSetFor("beginner-08-contextual-config-follow-up"),
    selectionEntry: {
      id: "beginner-08-contextual-config-follow-up",
      fixture: "beginner-workspace-v0.1",
      executionMode: "canonical",
      provider: "default",
      approvalPolicy: "auto-approve",
      initialPrompt: "first",
      followUps: [{ when: "completed", text: "second" }],
    },
    outputRoot,
    repetitionIndex: 1,
  });

  assert.equal(streamCount, 2);
  assert.equal(result.executorFacts.timing.runnerSafetyCapReached, true);
  assert.match(result.executorFacts.notes.join("\n"), /before follow-up runId surfaced/);
});

test("adv07 verifier reads the fixture config paths", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mira-bench-adv07-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const external = path.join(root, "external");
  materializeFixture({ fixtureId: "adv07-v1", destDir: workspace, externalDir: external });

  fs.mkdirSync(path.join(workspace, "deploy"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "deploy", "staging.json"),
    JSON.stringify({
      environment: "staging",
      image: "mira:2.4.0",
      region: "ap-northeast-1",
      replicas: 1,
    }, null, 2) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(workspace, "deploy", "production.json"),
    JSON.stringify({
      environment: "production",
      image: "mira:2.4.0",
      region: "ap-southeast-1",
      replicas: 3,
    }, null, 2) + "\n",
    "utf8",
  );

  await assert.rejects(
    () => execFileAsync(process.execPath, ["scripts/verify-deployments.mjs"], { cwd: workspace }),
    /deployment verifier: manifest mismatch/,
  );

  const production = JSON.parse(fs.readFileSync(path.join(workspace, "config", "production.json"), "utf8"));
  production.region = "ap-southeast-1";
  fs.writeFileSync(path.join(workspace, "config", "production.json"), JSON.stringify(production, null, 2) + "\n", "utf8");

  const verified = await execFileAsync(process.execPath, ["scripts/verify-deployments.mjs"], { cwd: workspace });
  assert.match(verified.stdout, /deployment verifier: PASS/);
});
