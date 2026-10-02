#!/usr/bin/env node
// Mira Agent Core Benchmark v0.1 — external local executor / reference runner.
//
// Issue: uichat-mira/mira-desktop#221
//
// This is a THIN external executor. It drives a running Mira backend through the
// existing product control surface (see lib/http.mjs), isolates each repetition
// in its own fixture workspace, observes execution to a terminal state, applies
// mechanical approval/resume control, and exposes the raw execution events plus
// structured executor/control facts for the Recorder (#223).
//
// It deliberately does NOT:
//   - solve the benchmark task or answer on Mira's behalf;
//   - score semantic quality or compute benchmark metrics;
//   - define/own the Recorder artifact schema (#223);
//   - modify production Agent/Harness/approval/resume/runtime code.
//
// Calibration mode: when a case has no frozen T_soft/T_hard (RC state), the runner
// records monotonic elapsed time and never invents a soft/hard cutoff.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "./lib/http.mjs";
import {
  diffManifest,
  fileSha256,
  hashManifest,
  listFixtures,
  materializeFixture,
  workspaceManifest,
} from "./lib/fixtures.mjs";
import {
  caseTiming,
  getCase,
  isTimingFrozen,
  loadCaseSet,
} from "./lib/manifest.mjs";
import { caseIdsOf, resolveSelection } from "./lib/selection.mjs";
import { collectObservability } from "./lib/observability.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const TERMINAL_STATUSES = new Set(["completed", "failed", "blocked", "cancelled"]);

const RUNNER_VERSION = "agent-core-runner/0.1";

const parseArgs = (argv) => {
  const args = {
    baseUrl: "http://127.0.0.1:8787",
    username: process.env.MIRA_BENCH_USERNAME ?? null,
    password: process.env.MIRA_BENCH_PASSWORD ?? null,
    selection: path.join(__dirname, "selection.json"),
    out: path.join(REPO_ROOT, ".test-artifact", "agent-core-benchmark", "runs"),
    cases: null,
    repetitions: null,
    keepFixture: false,
    preflightOnly: false,
    maxWaitMs: 15 * 60 * 1000,
    pollIntervalMs: 1000,
    cancelAfterMs: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[(i += 1)];
    switch (token) {
      case "--base-url": args.baseUrl = next(); break;
      case "--username": args.username = next(); break;
      case "--password": args.password = next(); break;
      case "--selection": args.selection = path.resolve(next()); break;
      case "--out": args.out = path.resolve(next()); break;
      case "--cases": args.cases = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--repetitions": args.repetitions = next(); break;
      case "--keep-fixture": args.keepFixture = true; break;
      case "--preflight-only": args.preflightOnly = true; break;
      case "--max-wait-ms": args.maxWaitMs = Number(next()); break;
      case "--poll-interval-ms": args.pollIntervalMs = Number(next()); break;
      case "--cancel-after-ms": args.cancelAfterMs = Number(next()); break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
};

const printHelp = () => {
  process.stdout.write(
    [
      "Mira Agent Core Benchmark reference runner (#221)",
      "",
      "Usage: node scripts/benchmark/agent-core-runner.mjs [options]",
      "",
      "Options:",
      "  --base-url <url>       Running Mira backend base URL (default http://127.0.0.1:8787)",
      "  --username <name>      Login username (or MIRA_BENCH_USERNAME); required",
      "  --password <pw>        Login password (or MIRA_BENCH_PASSWORD); required",
      "  --selection <file>     Runner selection config (default scripts/benchmark/selection.json)",
      "  --out <dir>            Output root for raw run bundles",
      "  --cases <a,b>          Subset of selection case ids (all ids must exist; empty result is an error)",
      "  --repetitions <n>      Override repetition count per case (must be a positive integer)",
      "  --keep-fixture         Keep the materialized fixture workspace after the run",
      "  --preflight-only       Only run environment preflight, then exit",
      "  --max-wait-ms <n>      Runner safety bound for terminal polling (NOT a case cutoff)",
      "  --poll-interval-ms <n> Terminal-state poll interval",
      "  --cancel-after-ms <n>  Executor control-path smoke: cancel after N ms (NOT a case cutoff)",
      "",
    ].join("\n"),
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nowIso = () => new Date().toISOString();

const hostPlatform = () => ({
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  hostname: os.hostname(),
  node: process.version,
});

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const writeNdjson = (file, records) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""), "utf8");
};

const extractExecutionNodeEvents = (messages) => {
  const events = [];
  for (const message of messages) {
    for (const part of message?.parts ?? []) {
      if (part?.type === "data" && part?.name === "execution-node") {
        events.push(part.value);
      }
    }
  }
  return events;
};

const extractAssistantText = (messages) =>
  messages
    .filter((message) => message?.role === "assistant")
    .map((message) =>
      (message.parts ?? [])
        .filter((part) => part?.type === "text")
        .map((part) => part.text)
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");

const mechanicalFactsFromEvents = (events) => {
  const toolExecutions = [];
  const toolFailures = [];
  const normalizedInvocations = [];
  const subagentStarts = [];
  const resumes = [];
  const approvals = [];
  let plannerIterations = 0;
  let repeatedSemanticActionCount = 0;

  const FAILURE_STATUSES = new Set(["failed", "denied", "awaiting_approval"]);

  for (const event of events) {
    const details = event?.details ?? {};
    if (event?.nodeId === "agent-next-action-planner" && event.phase === "done") {
      if (typeof details.iteration === "number") {
        plannerIterations = Math.max(plannerIterations, details.iteration + 1);
      }
      if (typeof details.repeatedSemanticActionCount === "number") {
        repeatedSemanticActionCount = details.repeatedSemanticActionCount;
      }
    }

    // `agent-tool-call-normalize` freezes the invocation; it is not an execution.
    if (event?.nodeId === "agent-tool-call-normalize" && event.phase === "done") {
      normalizedInvocations.push({
        toolId: details.toolId ?? null,
        inputHash: details.inputHash ?? null,
        status: details.status ?? null,
      });
    }

    const isExecutionNode =
      event?.nodeType === "tool" &&
      event.phase === "done" &&
      typeof event.nodeId === "string" &&
      event.nodeId.startsWith("agent-tool-") &&
      !event.nodeId.startsWith("agent-tool-call");

    if (isExecutionNode && details.toolId) {
      const record = {
        toolId: details.toolId,
        status: details.status ?? null,
        inputHash: details.inputHash ?? null,
        toolCallId: details.toolCallId ?? null,
        durationMs: details.durationMs ?? null,
        at: event.emittedAt ?? null,
      };
      toolExecutions.push(record);
      if (details.status && FAILURE_STATUSES.has(details.status)) toolFailures.push(record);
    }
    if (event?.nodeType === "approval") {
      approvals.push({
        nodeId: event.nodeId,
        phase: event.phase,
        toolId: details.toolId ?? null,
        toolCallId: details.toolCallId ?? null,
        inputHash: details.inputHash ?? null,
        resumedFromApproval: details.resumedFromApproval ?? null,
        at: event.emittedAt ?? null,
      });
      if (details.resumedFromApproval) resumes.push(event.nodeId);
    }
    if (
      typeof event?.nodeId === "string" &&
      event.nodeId.includes("generic-task-subagent") &&
      event.phase === "start"
    ) {
      subagentStarts.push({ nodeId: event.nodeId, at: event.emittedAt ?? null });
    }
  }

  return {
    plannerIterations,
    repeatedSemanticActionCount,
    toolExecutions,
    toolFailures,
    normalizedInvocations,
    subagentStarts,
    approvalEvents: approvals,
    resumeEvents: resumes,
  };
};

const runPreflight = async ({ client, args, caseSet, selection }) => {
  const report = { ok: false, checks: [] };

  // Credentials are never defaulted. They must be supplied explicitly so the
  // runner never logs in with a baked-in dev password.
  if (!args.username || !args.password) {
    report.checks.push({
      name: "credentials",
      ok: false,
      detail:
        "username/password are required via --username/--password or MIRA_BENCH_USERNAME/MIRA_BENCH_PASSWORD",
    });
    report.ok = false;
    report.hostPlatform = hostPlatform();
    return report;
  }

  const health = await client.health();
  report.checks.push({ name: "backend_health", ok: true, detail: health?.data ?? health });

  const user = await client.login({
    username: args.username,
    password: args.password,
  });
  report.checks.push({ name: "login", ok: true, detail: { id: user.id, username: user.username } });

  const knownFixtures = new Set(listFixtures());
  for (const entry of selection.cases) {
    const caseEntry = getCase(caseSet, entry.id);
    report.checks.push({
      name: `case:${entry.id}`,
      ok: knownFixtures.has(entry.fixture),
      detail: {
        difficulty: caseEntry.difficulty,
        fixture: entry.fixture,
        fixtureKnown: knownFixtures.has(entry.fixture),
        timing: caseTiming(caseEntry),
      },
    });
  }
  report.ok = report.checks.every((check) => check.ok);
  report.hostPlatform = hostPlatform();
  return report;
};

export const runRepetition = async ({
  args,
  client,
  caseSet,
  selectionEntry,
  outputRoot,
  repetitionIndex,
}) => {
  const caseEntry = getCase(caseSet, selectionEntry.id);
  const timing = caseTiming(caseEntry);
  const frozen = isTimingFrozen(timing);

  const repDir = path.join(outputRoot, selectionEntry.id, `rep-${repetitionIndex}`);
  fs.rmSync(repDir, { recursive: true, force: true });
  const fixtureDir = path.join(repDir, "workspace");
  const externalDir = path.join(repDir, "external");

  const prompt = selectionEntry.turns?.[0] ?? caseEntry.public?.prompt ?? "";
  const followUps =
    selectionEntry.followUps ??
    (selectionEntry.turns?.slice(1).map((text) => ({ when: "waiting_user", text })) ?? []);

  // --- fixture setup ---
  const fixtureSpec = materializeFixture({
    fixtureId: selectionEntry.fixture,
    destDir: fixtureDir,
    externalDir,
  });
  const externalPaths = Object.keys(fixtureSpec.externalFiles ?? {});
  const beforeManifest = workspaceManifest(fixtureDir);
  const externalBefore = Object.fromEntries(
    externalPaths.map((absolute) => [absolute, fileSha256(absolute)]),
  );

  const interventions = [];
  const notes = [];

  // Workspace/thread are created *inside* the cleanup scope so a partial setup
  // failure cannot leak a workspace record or a materialized fixture and pollute
  // the next repetition.
  let workspace = null;
  let thread = null;

  // The benchmark timer is armed only after workspace/thread setup completes.
  // It starts immediately before the first case submission to Mira.
  let monotonicStartNs = null;
  let startedAtIso = null;

  const sseFrames = [];
  let runId = null;
  let terminalRun = null;
  let finishReason = null;
  let softTimeoutSeen = false;
  let hardCutoffApplied = false;
  let cancelRequested = false;
  let runnerSafetyCapReached = false;

  const clientAbort = new AbortController();

  const streamMessage = (text, onRunId) =>
    client.streamChatTurn(
      {
        threadId: thread.id,
        provider: selectionEntry.provider,
        agentEnabled: true,
        signal: clientAbort.signal,
        messages: [{ role: "user", parts: [{ type: "text", text }] }],
      },
      {
        onEvent: (event) => {
          sseFrames.push(event);
          if (event.type === "data-execution-node" && event.data?.details?.runId) {
            onRunId?.(event.data.details.runId);
          }
        },
      },
    );

  // Track every SSE turn in the background so terminal polling and cutoff
  // control remain live while a follow-up response is still streaming.
  const trackedTurns = [];
  const startTrackedTurn = (text) => {
    const tracked = { runId: null, settled: false, error: null, promise: null };
    tracked.promise = streamMessage(text, (id) => {
      tracked.runId = id;
    })
      .then((result) => {
        tracked.settled = true;
        finishReason = result.finishReason;
        if (result.runId) tracked.runId = result.runId;
        return result;
      })
      .catch((error) => {
        tracked.settled = true;
        tracked.error = error;
        return null;
      });
    trackedTurns.push(tracked);
    return tracked;
  };

  const elapsedMs = () => {
    if (monotonicStartNs === null) throw new Error("benchmark timer has not started");
    return Number((process.hrtime.bigint() - monotonicStartNs) / 1_000_000n);
  };

  try {
    workspace = await client.createWorkspace({
      name: `bench-${selectionEntry.id}-rep${repetitionIndex}`,
      rootPath: fixtureDir,
    });
    thread = await client.createThread({
      title: `bench-${selectionEntry.id}-rep${repetitionIndex}`,
      workspaceId: workspace.id,
      agentEnabled: true,
    });

    // Contract: timing starts immediately before Mira receives the case, not
    // while the runner is still preparing backend workspace/thread state.
    monotonicStartNs = process.hrtime.bigint();
    startedAtIso = nowIso();

    // Start the first turn in the background so the executor can poll terminal
    // state and apply timeout/cancel control while the run is still executing.
    const firstTurn = startTrackedTurn(prompt);

    const runIdDeadline = Date.now() + 120000;
    while (!firstTurn.runId && !firstTurn.settled && Date.now() < runIdDeadline) {
      await sleep(200);
    }
    runId = firstTurn.runId;

    if (!runId) {
      notes.push("no runId surfaced on the stream; run control/polling unavailable");
      await firstTurn.promise;
    } else {
      // --- terminal-state polling ---
      let nextFollowUp = 0;
      let activeFollowUp = null;
      const startFollowUp = (followUp) => {
        nextFollowUp += 1;
        interventions.push({
          at: nowIso(),
          type: "user_reply",
          trigger: followUp.when,
          text: followUp.text,
        });
        return startTrackedTurn(followUp.text);
      };

      while (true) {
        if (activeFollowUp?.runId && activeFollowUp.runId !== runId) {
          runId = activeFollowUp.runId;
        }
        if (activeFollowUp && !activeFollowUp.runId && !activeFollowUp.settled) {
          await sleep(50);
          continue;
        }
        if (activeFollowUp?.settled) {
          const settledFollowUp = activeFollowUp;
          activeFollowUp = null;
          if (settledFollowUp.runId) runId = settledFollowUp.runId;
          if (settledFollowUp.error && !clientAbort.signal.aborted) {
            throw settledFollowUp.error;
          }
        }

        const run = await client.getRun(runId);

        if (TERMINAL_STATUSES.has(run.status)) {
          const followUp = followUps[nextFollowUp];
          if (
            run.status === "completed" &&
            !activeFollowUp &&
            followUp?.when === "completed"
          ) {
            activeFollowUp = startFollowUp(followUp);
            continue;
          }
          terminalRun = run;
          break;
        }

        if (run.status === "waiting_approval") {
          interventions.push({
            at: nowIso(),
            type: "approval",
            decision: "approve",
            toolId: run.pendingApproval?.toolId ?? null,
            toolCallId: run.pendingApproval?.toolCallId ?? null,
            inputHash: run.pendingApproval?.inputHash ?? null,
            note: "approve exact frozen invocation",
          });
          await client.approveRun(runId);
          continue;
        }

        if (run.status === "waiting_user") {
          if (!activeFollowUp) {
            const followUp = followUps[nextFollowUp];
            if (followUp?.when === "waiting_user") {
              activeFollowUp = startFollowUp(followUp);
              continue;
            }
            notes.push("run paused at waiting_user with no matching scripted follow-up");
            break;
          }
          // A scripted follow-up is already streaming. Do not await it here:
          // fall through so T_soft/T_hard/cancel/safety checks keep running.
        }

        const waited = elapsedMs();

        if (frozen && waited >= timing.tHardMs) {
          hardCutoffApplied = true;
          cancelRequested = true;
          interventions.push({ at: nowIso(), type: "cancel", reason: "frozen_t_hard" });
          await client.cancelRun(runId);
          clientAbort.abort();
          const after = await client.getRun(runId);
          terminalRun = after;
          break;
        }
        if (frozen && !softTimeoutSeen && waited >= timing.tSoftMs) {
          softTimeoutSeen = true;
          notes.push(`soft timeout reached at ${waited}ms; observing without assistance`);
        }

        if (args.cancelAfterMs !== null && waited >= args.cancelAfterMs) {
          cancelRequested = true;
          interventions.push({ at: nowIso(), type: "cancel", reason: "executor_control_smoke" });
          await client.cancelRun(runId);
          clientAbort.abort();
          const after = await client.getRun(runId);
          terminalRun = after;
          break;
        }

        if (waited >= args.maxWaitMs) {
          runnerSafetyCapReached = true;
          notes.push(`runner safety bound ${args.maxWaitMs}ms reached while status=${run.status}`);
          break;
        }

        await sleep(args.pollIntervalMs);
      }

      clientAbort.abort();
      await Promise.all(trackedTurns.map((turn) => turn.promise.catch(() => null)));
      terminalRun = terminalRun ?? (await client.getRun(runId));
    }

    const elapsedEndNs = process.hrtime.bigint();
    const elapsedMsFinal = Number((elapsedEndNs - monotonicStartNs) / 1_000_000n);

    // Robustly capture the stream finish reason even if the stream was aborted
    // by executor timeout/cancel control.
    if (finishReason === null) {
      finishReason = sseFrames.find((frame) => frame?.type === "finish")?.finishReason ?? null;
    }

    const messages = await client.getMessages(thread.id);
    const persistedEvents = extractExecutionNodeEvents(messages);
    const facts = mechanicalFactsFromEvents(persistedEvents);
    const afterManifest = workspaceManifest(fixtureDir);
    const externalAfter = Object.fromEntries(
      externalPaths.map((absolute) => [absolute, fileSha256(absolute)]),
    );

    terminalRun = terminalRun ?? (runId ? await client.getRun(runId) : null);
    // Expected execution-node facts are extracted together with a structured
    // gap list, so a missing field is exposed instead of silently becoming null.
    const observability = collectObservability({ persistedEvents, terminalRun });

    // --- raw run bundle (NOT the #223 Recorder schema) ---
    writeNdjson(path.join(repDir, "execution-events.ndjson"), persistedEvents);
    writeNdjson(path.join(repDir, "stream-frames.ndjson"), sseFrames);
    writeJson(path.join(repDir, "agent-run.json"), terminalRun ?? null);
    writeJson(path.join(repDir, "workspace-manifest.before.json"), beforeManifest);
    writeJson(path.join(repDir, "workspace-manifest.after.json"), afterManifest);
    writeJson(path.join(repDir, "workspace-diff.json"), diffManifest(beforeManifest, afterManifest));
    fs.mkdirSync(repDir, { recursive: true });
    fs.writeFileSync(path.join(repDir, "assistant-transcript.txt"), extractAssistantText(messages), "utf8");

    const executorFacts = {
      runner: RUNNER_VERSION,
      issue: 221,
      caseSetVersion: caseSet.caseSetVersion,
      caseId: selectionEntry.id,
      difficulty: caseEntry.difficulty,
      repetition: repetitionIndex,
      executionMode: selectionEntry.executionMode ?? "canonical",
      classificationRationale:
        selectionEntry.classificationRationale ??
        "Driven through the product HTTP control surface on macOS. Same information, capability, fixture and governance boundaries as the Windows 11 + PowerShell 7 reference baseline; only the executor script/host differ.",
      comparabilityImpact: selectionEntry.comparabilityImpact ?? null,
      hostPlatform: hostPlatform(),
      actualProcedure: {
        transport: "http",
        provider: selectionEntry.provider,
        baseUrl: args.baseUrl,
        endpoints: [
          "POST /login",
          "POST /chat-workspaces",
          "POST /threads",
          `POST /proxy/chat/${selectionEntry.provider}`,
          "GET /agent/runs/:runId",
          "POST /agent/runs/:runId/approve",
          "POST /agent/runs/:runId/cancel",
          "GET /threads/:id/messages",
        ],
        steps: [
          "materialize fixture workspace",
          "bind workspace + create agent thread",
          "start monotonic timer",
          "submit case prompt via streaming agent turn",
          "poll terminal state",
          "apply mechanical approval/resume control",
          "read persisted raw execution events",
          "cleanup",
        ],
      },
      referenceProcedure: {
        baseline: "Windows 11 + PowerShell 7 reference runner",
        provider: selectionEntry.provider,
        deviations: [
          "executor host is macOS (Intel) instead of Windows 11",
          "control flow implemented as a Node script instead of PowerShell",
        ],
        reasonForDeviation: "current development/dry-run host is Intel macOS; acceptance is platform-neutral",
        comparabilityImpact:
          "none expected: identical HTTP control surface, model access path, fixture, governance and observability semantics",
      },
      executorInterventions: interventions,
      approval: {
        count: facts.approvalEvents.filter((event) => event.phase === "start").length,
        resumeCount: facts.resumeEvents.length,
        events: facts.approvalEvents,
      },
      failureRetry: {
        toolFailures: facts.toolFailures,
        toolFailureCount: facts.toolFailures.length,
        repeatedSemanticActionCount: facts.repeatedSemanticActionCount,
      },
      invocations: {
        frozen: facts.normalizedInvocations,
      },
      subagent: { starts: facts.subagentStarts, startCount: facts.subagentStarts.length },
      toolExecutions: facts.toolExecutions,
      plannerIterations: facts.plannerIterations,
      terminal: terminalRun
        ? {
            status: terminalRun.status,
            terminalReason: terminalRun.terminalReason ?? null,
            blockedReason: terminalRun.blockedReason ?? null,
            selectedToolId: terminalRun.selectedToolId ?? null,
          }
        : null,
      streamFinishReason: finishReason,
      finalization: {
        hasRequiredFinalization: observability.hasRequiredFinalization,
        plannerTerminalType: observability.plannerTerminalType,
        finalizationEvidenceRefs: observability.finalizationEvidenceRefs,
      },
      elapsed: {
        startedAt: startedAtIso,
        endedAt: nowIso(),
        elapsedMs: elapsedMsFinal,
        clock: "process.hrtime.bigint (monotonic)",
      },
      timing: {
        calibrationMode: !frozen,
        tSoftMs: timing.tSoftMs,
        tHardMs: timing.tHardMs,
        timingStatus: timing.status,
        softTimeoutSeen,
        hardCutoffApplied,
        cancelRequested,
        runnerSafetyCapReached,
        note: frozen
          ? "frozen timing applied"
          : "no frozen T_soft/T_hard; elapsed recorded without inventing a cutoff",
      },
      workspace: {
        fixtureId: selectionEntry.fixture,
        beforeManifestHash: hashManifest(beforeManifest),
        afterManifestHash: hashManifest(afterManifest),
        diff: diffManifest(beforeManifest, afterManifest),
        externalTargets: externalPaths.map((absolute) => ({
          path: absolute,
          before: externalBefore[absolute] ?? null,
          after: externalAfter[absolute] ?? null,
          changed: externalBefore[absolute] !== externalAfter[absolute],
        })),
      },
      notes,
      observability: {
        signals: observability.signals,
        gaps: observability.gaps,
      },
      observerGaps: observability.gaps,
      rawArtifacts: {
        executionEvents: path.relative(REPO_ROOT, path.join(repDir, "execution-events.ndjson")),
        streamFrames: path.relative(REPO_ROOT, path.join(repDir, "stream-frames.ndjson")),
        agentRun: path.relative(REPO_ROOT, path.join(repDir, "agent-run.json")),
      },
    };
    writeJson(path.join(repDir, "executor-facts.json"), executorFacts);

    return { repDir, executorFacts };
  } finally {
    // --- cleanup (also covers partial setup failures) ---
    if (thread) {
      try {
        await client.archiveThread(thread.id);
      } catch (error) {
        notes.push(`archive thread failed: ${error.message}`);
      }
    }
    if (workspace) {
      try {
        await client.deleteWorkspace(workspace.id);
      } catch (error) {
        notes.push(`delete workspace failed: ${error.message}`);
      }
    }
    if (!args.keepFixture) {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const rawSelection = JSON.parse(fs.readFileSync(args.selection, "utf8"));
  const caseSet = loadCaseSet(REPO_ROOT);
  const selection = resolveSelection(
    rawSelection,
    { cases: args.cases, repetitions: args.repetitions },
    { knownCaseIds: caseIdsOf(caseSet) },
  );

  const client = createClient({ baseUrl: args.baseUrl });

  const preflight = await runPreflight({ client, args, caseSet, selection });
  process.stdout.write(`${JSON.stringify({ preflight }, null, 2)}\n`);
  if (!preflight.ok) {
    process.stderr.write("preflight failed\n");
    process.exitCode = 1;
    return;
  }
  if (args.preflightOnly) return;

  const stamp = startedStamp();
  const outputRoot = path.join(args.out, stamp);
  fs.mkdirSync(outputRoot, { recursive: true });

  const results = [];
  let hadError = false;
  for (const entry of selection.cases) {
    for (let rep = 1; rep <= selection.repetitions; rep += 1) {
      try {
        const result = await runRepetition({
          args,
          client,
          caseSet,
          selectionEntry: entry,
          outputRoot,
          repetitionIndex: rep,
        });
        results.push({
          caseId: entry.id,
          repetition: rep,
          repDir: path.relative(REPO_ROOT, result.repDir),
          terminal: result.executorFacts.terminal,
          elapsedMs: result.executorFacts.elapsed.elapsedMs,
          interventions: result.executorFacts.executorInterventions.length,
        });
      } catch (error) {
        // A failed repetition must never disappear silently; record it and make
        // the process exit non-zero so the run cannot look green.
        hadError = true;
        results.push({
          caseId: entry.id,
          repetition: rep,
          error: error?.message ?? String(error),
        });
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify({ outputRoot: path.relative(REPO_ROOT, outputRoot), results }, null, 2)}\n`,
  );
  if (hadError) process.exitCode = 1;
};

const startedStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const runCli = () =>
  main().catch((error) => {
    if (error?.name === "SelectionError") {
      process.stderr.write(`selection error: ${error.message}\n`);
    } else {
      process.stderr.write(`${error?.stack ?? error}\n`);
    }
    process.exitCode = 1;
  });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
