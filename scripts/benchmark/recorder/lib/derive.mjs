// #223 Recorder — stage 3: deterministic derivation.
//
// This stage computes ONLY facts that can be mechanically proven from the raw
// trajectory + executor facts. Ultimate rule (contract #216 §13 / #223):
//
//   a field with no evidence is `unknown`, never a guessed 0 / false / null.
//
// Semantic judging is NOT here and never will be. Judge-owned fields are
// emitted as null and routed into judge-input.json as pending.
//
// The whole function is pure: (raw bundle) -> deterministic result. It can be
// re-run offline over a saved raw snapshot and must produce an identical result
// (see recorder/replay.test.mjs).

import { artifactRef, trajectoryNodeRef, trajectoryRef } from "./evidence-refs.mjs";
import { normalizeTrajectory } from "./trajectory.mjs";

export const DETERMINISTIC_SCHEMA_VERSION = "mira-agent-core-benchmark-result/0.1";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

const TOOL_FAILURE_STATUSES = new Set(["failed", "denied", "error", "timeout"]);

const COMPLETION_EXPECTED_STATUSES = new Set(["completed", "waiting_user"]);

/** Index every event by nodeId/phase so we can cite exact positions. */
const indexEvents = (events) => {
  const plannerDone = [];
  const plannerStart = [];
  const toolExecutions = [];
  const childToolCompleted = [];
  const childToolStarted = [];
  const toolNormalize = [];
  const approvals = [];
  const childApprovals = [];
  const resumes = [];
  const evaluateDone = [];
  const evidenceDone = [];
  events.forEach((event, index) => {
    const nodeId = event?.nodeId ?? "";
    if (nodeId === "agent-next-action-planner" && event.phase === "done") plannerDone.push(index);
    if (nodeId === "agent-next-action-planner" && event.phase === "start") plannerStart.push(index);
    if (event.nodeType === "approval") {
      approvals.push(index);
      if (event?.details?.resumedFromApproval) resumes.push(index);
    }
    // Delegated (child) tool executions are exposed as subagent-trace events with
    // a distinct `subAgentEventType`. They are NOT `agent-tool-N` nodes, so they
    // must be collected from their own source and labelled as child facts.
    if (event?.details?.subAgentEventType === "tool.completed") childToolCompleted.push(index);
    if (event?.details?.subAgentEventType === "tool.started") childToolStarted.push(index);
    if (event?.details?.subAgentEventType === "approval.required") childApprovals.push(index);
    if (nodeId === "agent-evaluate" && event.phase === "done") evaluateDone.push(index);
    if (nodeId === "agent-evidence" && event.phase === "done") evidenceDone.push(index);
    const isExecution =
      event?.nodeType === "tool" &&
      event.phase === "done" &&
      typeof nodeId === "string" &&
      nodeId.startsWith("agent-tool-") &&
      !nodeId.startsWith("agent-tool-call");
    if (isExecution && event?.details?.toolId) toolExecutions.push(index);
    if (nodeId === "agent-tool-call-normalize" && event.phase === "done") toolNormalize.push(index);
  });
  return {
    plannerDone,
    plannerStart,
    toolExecutions,
    childToolCompleted,
    childToolStarted,
    childApprovals,
    toolNormalize,
    approvals,
    resumes,
    evaluateDone,
    evidenceDone,
  };
};

const last = (arr) => (arr.length ? arr[arr.length - 1] : null);

const deriveTiming = (executorFacts, gaps) => {
  const elapsed = executorFacts?.elapsed ?? {};
  const timing = executorFacts?.timing ?? {};
  const frozen =
    isNum(timing.tSoftMs) && isNum(timing.tHardMs) && timing.calibrationMode !== true;

  const timingState = frozen ? "frozen" : "calibration_pending";
  if (!frozen) {
    gaps.push({
      fact: "timingPolicy",
      requiredBy: "#216 §10 / #220 timing calibration",
      availableSources: [artifactRef("timing"), "executor-facts.timing"],
      missingReason:
        "per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence",
      scoringImpact:
        "timing_credit and on-time/ late classification are unavailable until #220 freezes T_soft/T_hard; elapsed is recorded but not classified",
    });
  }

  // Late-completion credit is only mechanically computable under a frozen policy.
  let lateCompletion = {
    computable: frozen,
    classification: null,
    reason: frozen
      ? null
      : "not computed: no frozen T_soft/T_hard; recorded elapsed is calibration input only",
  };
  if (frozen && isNum(elapsed.elapsedMs)) {
    const { tSoftMs, tHardMs } = timing;
    if (elapsed.elapsedMs <= tSoftMs) lateCompletion.classification = "within_soft";
    else if (elapsed.elapsedMs <= tHardMs) lateCompletion.classification = "late_complete";
    else lateCompletion.classification = "post_cutoff";
  }

  return {
    state: timingState,
    // These mirror the executor's mechanical control flags verbatim.
    softTimeoutSeen: timing.softTimeoutSeen ?? null,
    hardCutoffApplied: timing.hardCutoffApplied ?? null,
    cancelRequested: timing.cancelRequested ?? null,
    runnerSafetyCapReached: timing.runnerSafetyCapReached ?? null,
    tSoftMs: isNum(timing.tSoftMs) ? timing.tSoftMs : null,
    tHardMs: isNum(timing.tHardMs) ? timing.tHardMs : null,
    elapsedMs: isNum(elapsed.elapsedMs) ? elapsed.elapsedMs : null,
    startedAt: elapsed.startedAt ?? null,
    endedAt: elapsed.endedAt ?? null,
    clock: elapsed.clock ?? null,
    timingCredit: frozen ? null : "unavailable_pending_calibration",
    lateCompletion,
  };
};

const deriveSideEffects = (executorFacts) => {
  const diff = executorFacts?.workspace?.diff ?? null;
  if (!diff) {
    return {
      status: "unknown",
      workspaceChanged: null,
      added: null,
      removed: null,
      modified: null,
      externalTargets: null,
      refs: [artifactRef("workspace")],
    };
  }
  return {
    status: "observed",
    workspaceChanged: Boolean(diff.changed),
    added: Array.isArray(diff.added) ? diff.added.length : null,
    removed: Array.isArray(diff.removed) ? diff.removed.length : null,
    modified: Array.isArray(diff.modified) ? diff.modified.length : null,
    externalTargets: Array.isArray(executorFacts?.workspace?.externalTargets)
      ? executorFacts.workspace.externalTargets.length
      : null,
    refs: [artifactRef("workspace")],
  };
};

/**
 * Deterministically derive the full measurement set.
 *
 * @param {object} bundle ingested raw bundle (or re-hydrated snapshot)
 */
export const deriveDeterministic = (bundle) => {
  const executorFacts = bundle.executorFacts ?? {};
  const events = bundle.executionEvents ?? [];
  const trajectory = normalizeTrajectory(events);
  const idx = indexEvents(events);
  const gaps = [];

  // --- terminal authority (Blocker 1) ---
  // `agent-run.json` is the authoritative terminal run-state document; the
  // executor's `executor-facts.terminal` snapshot is a secondary control fact
  // and is only a FALLBACK when `agent-run.json` genuinely lacks the field. A
  // stale executor snapshot must never override the final AgentRun.
  const agentRun = bundle.agentRun ?? null;
  const executorTerminal = executorFacts?.terminal ?? {};
  const terminalStatus = agentRun?.status ?? executorTerminal.status ?? null;
  const terminalReason = agentRun?.terminalReason ?? executorTerminal.terminalReason ?? null;
  const terminalBlockedReason = agentRun?.blockedReason ?? executorTerminal.blockedReason ?? null;
  const completionExpected = COMPLETION_EXPECTED_STATUSES.has(terminalStatus);

  // --- action / tool facts (all cite exact trajectory indices) ---
  const actionSequence = idx.plannerDone.map((i) => ({
    ref: trajectoryNodeRef(i, "agent-next-action-planner"),
    actionType: events[i]?.details?.selectedActionType ?? null,
    selectedToolId: events[i]?.details?.selectedToolId ?? null,
    iteration: isNum(events[i]?.details?.iteration) ? events[i].details.iteration : null,
  }));

  // Parent (Main Planner) tool executions, from `agent-tool-N#done` nodes.
  const parentToolCalls = idx.toolExecutions.map((i) => ({
    source: "parent",
    ref: trajectoryNodeRef(i, events[i].nodeId),
    toolId: events[i]?.details?.toolId ?? null,
    status: events[i]?.details?.status ?? null,
    inputHash: events[i]?.details?.inputHash ?? null,
    toolCallId: events[i]?.details?.toolCallId ?? null,
    durationMs: isNum(events[i]?.details?.durationMs) ? events[i].details.durationMs : null,
    at: events[i]?.emittedAt ?? null,
  }));

  // Delegated (child) tool executions, from `subagent-trace:*` tool.completed
  // events. A separate source, labelled as child, never merged into parent truth.
  const childToolCalls = idx.childToolCompleted.map((i) => ({
    source: "child",
    ref: trajectoryNodeRef(i, events[i].nodeId),
    subAgentRunId: events[i]?.details?.subAgentRunId ?? null,
    toolId: events[i]?.details?.traceDetails?.toolId ?? null,
    toolCallId: events[i]?.details?.traceDetails?.toolCallId ?? null,
    inputHash: events[i]?.details?.traceDetails?.inputHash ?? null,
    artifactCount: isNum(events[i]?.details?.traceDetails?.artifactCount)
      ? events[i].details.traceDetails.artifactCount
      : null,
    at: events[i]?.emittedAt ?? null,
  }));

  const toolCalls = [...parentToolCalls, ...childToolCalls];
  const failedToolCalls = toolCalls.filter(
    (call) => call.status && TOOL_FAILURE_STATUSES.has(call.status),
  );

  // exposed tools / first selected tool come from the last planner done node.
  const lastPlanner = last(idx.plannerDone);
  const exposedToolIds = lastPlanner !== null ? events[lastPlanner]?.details?.exposedToolIds ?? null : null;
  const firstSelectedTool = actionSequence.find((a) => a.selectedToolId)?.selectedToolId ?? null;

  const plannerIterations = isNum(executorFacts.plannerIterations)
    ? executorFacts.plannerIterations
    : idx.plannerDone.length;

  const delegationStarts = executorFacts?.subagent?.startCount;

  // --- approvals / resumes ---
  // Parent approval nodes are authoritative; child approval handoffs are also
  // observable and reported separately so delegated governance is visible.
  const parentApprovalCount = idx.approvals.filter((i) => events[i].phase === "start").length;
  const childApprovalCount = idx.childApprovals.length;
  const approvalCount = parentApprovalCount;
  const resumeCount = idx.resumes.length;
  const approvalRefs = idx.approvals.map((i) => trajectoryNodeRef(i, events[i].nodeId));
  const childApprovalRefs = idx.childApprovals.map((i) => trajectoryNodeRef(i, events[i].nodeId));

  // --- recoverable vs terminal failures ---
  // We can only *mechanically* count recoverable/terminal failures if the raw
  // trajectory exposes a `failureKind`. The current #221 execution-node schema
  // exposes tool `status` but not `failureKind` per tool event, so we do NOT
  // invent a count; we emit unknown + a structured gap.
  const failureKindObservable = events.some(
    (event) => typeof event?.details?.failureKind === "string",
  );
  let recoverableFailureCount;
  let terminalFailureCount;
  if (failureKindObservable) {
    recoverableFailureCount = events.filter((e) => e?.details?.failureKind === "recoverable").length;
    terminalFailureCount = events.filter((e) => e?.details?.failureKind === "terminal").length;
  } else {
    recoverableFailureCount = "unknown";
    terminalFailureCount = "unknown";
    gaps.push({
      fact: "recoverableFailureCount",
      requiredBy: "#216 §12/§13 recoverable-failure diagnostic; #221 failureRetry",
      availableSources: ["execution-events tool node details.status", artifactRef("toolCalls")],
      missingReason:
        "current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone",
      scoringImpact:
        "recoverable-failure diagnostics and any hard-fail that depends on failure classification stay unresolved for this repetition",
    });
  }

  // --- recoverable-failure retry: mechanically unauthoritative ---
  const repeatedSemanticActionCount = isNum(executorFacts?.failureRetry?.repeatedSemanticActionCount)
    ? executorFacts.failureRetry.repeatedSemanticActionCount
    : "unknown";

  // --- completion / finalization ---
  const finalization = executorFacts?.finalization ?? {};
  const completionProof = idx.plannerDone
    .map((i) => {
      const raw = events[i]?.details?.rawOutputPreview;
      if (typeof raw !== "string") return null;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.completionProof) ? parsed.completionProof : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const unresolvedGaps = idx.plannerDone
    .map((i) => {
      const raw = events[i]?.details?.rawOutputPreview;
      if (typeof raw !== "string") return null;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.unresolvedGaps) ? parsed.unresolvedGaps : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (completionExpected) {
    if (typeof finalization.hasRequiredFinalization !== "boolean") {
      gaps.push({
        fact: "hasRequiredFinalization",
        requiredBy: "#216 §3 finalization completion fact",
        availableSources: ["agent-evaluate#done.details.hasRequiredFinalization"],
        missingReason: "evaluate done node did not expose hasRequiredFinalization for a completed run",
        scoringImpact: "premature-completion / required-finalization hard-fail cannot be resolved",
      });
    }
    if (exposedToolIds === null) {
      gaps.push({
        fact: "exposedToolIds",
        requiredBy: "#216 §13 exposed tools",
        availableSources: ["agent-next-action-planner#done.details.exposedToolIds"],
        missingReason: "planner done node did not expose exposedToolIds",
        scoringImpact: "tool-exposure gap / tool-not-exposed diagnostics cannot be resolved",
      });
    }
  }

  // Export executor-reported observability gaps verbatim (do not swallow them).
  const executorGaps = Array.isArray(executorFacts?.observability?.gaps)
    ? executorFacts.observability.gaps
    : [];

  const refs = {
    terminal: artifactRef("terminal-run"),
    elapsed: artifactRef("timing"),
    toolCalls: artifactRef("toolCalls"),
    actionSequence: artifactRef("actionSequence"),
    approvals: artifactRef("approvals"),
    workspace: artifactRef("workspace"),
    assistantTranscript: artifactRef("final-answer"),
    trajectory: trajectoryRef(0),
  };

  return {
    schemaVersion: DETERMINISTIC_SCHEMA_VERSION,
    terminal: {
      status: terminalStatus,
      terminalReason,
      blockedReason: terminalBlockedReason,
      streamFinishReason: executorFacts?.streamFinishReason ?? null,
      authority: {
        statusSource: agentRun?.status != null ? "agent-run.json" : "executor-facts.terminal(fallback)",
        note: "agent-run.json is authoritative terminal state; executor-facts.terminal is only a fallback when agent-run.json lacks the field",
      },
      refs: [refs.terminal],
    },
    plannerIterations,
    firstSelectedTool,
    exposedToolCount: Array.isArray(exposedToolIds) ? exposedToolIds.length : null,
    exposedToolIds: exposedToolIds ?? "unknown",
    actionSequence,
    toolCallCount: toolCalls.length,
    parentToolCallCount: parentToolCalls.length,
    childToolCallCount: childToolCalls.length,
    toolCalls,
    parentToolCalls,
    childToolCalls,
    failedToolCallCount: failedToolCalls.length,
    toolFailures: failedToolCalls,
    delegationCount: isNum(delegationStarts) ? delegationStarts : "unknown",
    approvalCount,
    childApprovalCount,
    approvalRefs,
    childApprovalRefs,
    resumeCount,
    recoverableFailureCount,
    terminalFailureCount,
    repeatedSemanticActionCount,
    completionProof,
    unresolvedGaps,
    finalization: {
      hasRequiredFinalization:
        typeof finalization.hasRequiredFinalization === "boolean"
          ? finalization.hasRequiredFinalization
          : null,
      plannerTerminalType: finalization.plannerTerminalType ?? null,
      finalizationEvidenceRefs: Array.isArray(finalization.finalizationEvidenceRefs)
        ? finalization.finalizationEvidenceRefs
        : null,
    },
    timing: deriveTiming(executorFacts, gaps),
    sideEffects: deriveSideEffects(executorFacts),
    refs,
    observabilityGaps: [...executorGaps, ...gaps],
  };
};

export const _internals = { indexEvents, isNum };
