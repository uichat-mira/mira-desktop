// Observability extraction for the benchmark runner.
//
// Contract (#216 / issue #221): a benchmark runner must surface a precise
// observability gap when an *expected* execution-node fact is unavailable,
// rather than silently swallowing it as `null`.
//
// "Expected" is scoped to the observed terminal state: a run that completed (or
// paused at waiting_user) must expose planner/finalization/evaluate facts, while
// a cancelled/blocked/failed run may legitimately never produce them. This keeps
// a genuine observability failure distinguishable from an early-terminated run.

const plannerDoneNodesOf = (persistedEvents) =>
  persistedEvents.filter(
    (event) => event?.nodeId === "agent-next-action-planner" && event.phase === "done",
  );

const lastEvaluateDoneNode = (persistedEvents) =>
  [...persistedEvents]
    .reverse()
    .find((event) => event?.nodeId === "agent-evaluate" && event.phase === "done");

const GAP_DETAIL =
  "expected execution-node fact was not observed; exposed as an observability gap instead of a silent null";

export const collectObservability = ({ persistedEvents, terminalRun }) => {
  const events = persistedEvents ?? [];
  const plannerDoneNodes = plannerDoneNodesOf(events);
  const evaluateNode = lastEvaluateDoneNode(events);
  const status = terminalRun?.status ?? null;

  // A run that completed, or paused at waiting_user, went through the full
  // planner/finalization/evaluate pipeline and must expose those facts.
  const planningSettled = status === "completed" || status === "waiting_user";

  const finalizationNode = [...plannerDoneNodes]
    .reverse()
    .find((event) => Array.isArray(event.details?.finalizationEvidenceRefs));

  const signals = [
    {
      signal: "plannerDoneNode",
      expectedFrom: "execution-events: agent-next-action-planner#done",
      expected: planningSettled,
      present: plannerDoneNodes.length > 0,
    },
    {
      signal: "plannerIteration",
      expectedFrom: "agent-next-action-planner#done.details.iteration",
      expected: planningSettled,
      present: plannerDoneNodes.some((event) => typeof event.details?.iteration === "number"),
    },
    {
      signal: "selectedActionType",
      expectedFrom: "agent-next-action-planner#done.details.selectedActionType",
      expected: planningSettled,
      present: plannerDoneNodes.some((event) => typeof event.details?.selectedActionType === "string"),
    },
    {
      signal: "selectedToolId",
      expectedFrom: "agent-next-action-planner#done.details.selectedToolId",
      expected: planningSettled,
      present: plannerDoneNodes.some((event) => "selectedToolId" in (event.details ?? {})),
    },
    {
      signal: "finalizationEvidenceRefs",
      expectedFrom: "agent-next-action-planner#done.details.finalizationEvidenceRefs",
      expected: planningSettled,
      present: Boolean(finalizationNode),
    },
    {
      signal: "evaluateDoneNode",
      expectedFrom: "execution-events: agent-evaluate#done",
      expected: planningSettled,
      present: Boolean(evaluateNode),
    },
    {
      signal: "evaluateHasRequiredFinalization",
      expectedFrom: "agent-evaluate#done.details.hasRequiredFinalization",
      expected: planningSettled,
      present: typeof evaluateNode?.details?.hasRequiredFinalization === "boolean",
    },
    {
      signal: "evaluatePlannerTerminalType",
      expectedFrom: "agent-evaluate#done.details.plannerTerminalType",
      expected: planningSettled,
      present: typeof evaluateNode?.details?.plannerTerminalType === "string",
    },
    {
      signal: "terminalRunState",
      expectedFrom: "GET /agent/runs/:runId",
      expected: true,
      present: Boolean(terminalRun) && typeof status === "string",
    },
  ];

  const gaps = signals
    .filter((entry) => entry.expected && !entry.present)
    .map((entry) => ({ signal: entry.signal, expectedFrom: entry.expectedFrom, detail: GAP_DETAIL }));

  return {
    signals,
    gaps,
    plannerDoneNodes,
    evaluateNode,
    finalizationEvidenceRefs: finalizationNode?.details?.finalizationEvidenceRefs ?? null,
    hasRequiredFinalization: evaluateNode?.details?.hasRequiredFinalization ?? null,
    plannerTerminalType: evaluateNode?.details?.plannerTerminalType ?? null,
  };
};
