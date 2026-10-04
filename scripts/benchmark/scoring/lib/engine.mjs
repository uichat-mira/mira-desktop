export const timingCreditFor = ({ tSoftMs, tHardMs, elapsedMs, officialParticipation }) => {
  if (officialParticipation === "diagnostic_untimed") return { available: false, credit: null, classification: "diagnostic_untimed" };
  if (![tSoftMs, tHardMs, elapsedMs].every(Number.isFinite)) return { available: false, credit: null, classification: "unavailable" };
  if (elapsedMs <= tSoftMs) return { available: true, credit: 1, classification: "within_soft" };
  if (elapsedMs <= 1.25 * tSoftMs) return { available: true, credit: 0.85, classification: "late_complete" };
  if (elapsedMs <= 1.5 * tSoftMs) return { available: true, credit: 0.70, classification: "late_complete" };
  if (elapsedMs <= tHardMs) return { available: true, credit: 0.50, classification: "late_complete" };
  return { available: true, credit: 0, classification: "post_cutoff_completion" };
};

export const validateSemanticResults = ({ caseDocument, semanticResults }) => {
  const expected = new Map(
    (caseDocument.successCriteria ?? [])
      .filter((c) => c.scorer === "judge")
      .map((c) => [c.id, c]),
  );
  const questions = new Map((caseDocument.judge?.semanticQuestions ?? []).map((q) => [q.id, q]));
  const supplied = Array.isArray(semanticResults) ? semanticResults : [];
  const seen = new Set();
  const normalized = [];
  const errors = [];

  for (const item of supplied) {
    const question = questions.get(item?.questionId);
    const criterion = expected.get(item?.criterionId);
    if (!question || !criterion || question.criterionId !== item.criterionId) {
      errors.push(`invalid semantic result mapping: ${JSON.stringify(item)}`);
      continue;
    }
    if (seen.has(item.criterionId)) {
      errors.push(`duplicate semantic criterion: ${item.criterionId}`);
      continue;
    }
    if (!["pass", "fail"].includes(item.outcome)) {
      errors.push(`invalid semantic outcome for ${item.criterionId}: ${item.outcome}`);
      continue;
    }
    seen.add(item.criterionId);
    normalized.push({
      questionId: item.questionId,
      criterionId: item.criterionId,
      scorer: "judge",
      weight: criterion.weight,
      outcome: item.outcome,
      evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [],
    });
  }

  const missing = [...expected.keys()].filter((id) => !seen.has(id));
  return { valid: errors.length === 0 && missing.length === 0, errors, missing, results: normalized };
};

export const scoreRepetition = ({
  caseDocument,
  caseEntry,
  deterministicResults,
  hardFailResults,
  semanticResults,
  result,
  execution,
}) => {
  const deterministicById = new Map((deterministicResults ?? []).map((r) => [r.criterionId, r]));
  const semantic = validateSemanticResults({ caseDocument, semanticResults });
  const semanticById = new Map(semantic.results.map((r) => [r.criterionId, r]));

  const criteria = (caseDocument.successCriteria ?? []).map((criterion) => {
    const source = criterion.scorer === "judge" ? semanticById.get(criterion.id) : deterministicById.get(criterion.id);
    return source ?? {
      criterionId: criterion.id,
      scorer: criterion.scorer,
      weight: criterion.weight,
      outcome: "unavailable",
      evidenceRefs: [],
      note: criterion.scorer === "judge" ? "fresh blank Judge result not supplied" : "deterministic evaluator did not produce a result",
    };
  });

  const hardFails = hardFailResults ?? [];
  const hardFailUnavailable = hardFails.some((h) => h.triggered === "unavailable");
  const hardFailTriggered = hardFails.some((h) => h.triggered === true);
  const criteriaUnavailable = criteria.some((c) => c.outcome === "unavailable");
  const rawSuccess = criteria
    .filter((c) => c.outcome === "pass")
    .reduce((sum, c) => sum + Number(c.weight || 0), 0);

  const timing = result?.deterministic?.timing ?? {};
  const timingScore = timingCreditFor({
    tSoftMs: timing.tSoftMs,
    tHardMs: timing.tHardMs,
    elapsedMs: timing.elapsedMs,
    officialParticipation: caseEntry.officialParticipation,
  });

  const complete = !criteriaUnavailable && !hardFailUnavailable && (semantic.valid || semantic.missing.length === 0);
  let officialTaskSuccess = null;
  let outcome = "pending";
  if (complete && timingScore.available) {
    officialTaskSuccess = hardFailTriggered ? 0 : rawSuccess * timingScore.credit;
    if (hardFailTriggered || rawSuccess === 0) outcome = "fail";
    else if (rawSuccess < 100) outcome = "partial";
    else if (timingScore.classification === "within_soft") outcome = "pass";
    else if (timingScore.classification === "late_complete") outcome = "late_complete";
    else outcome = "post_cutoff_completion";
  }

  const human = execution?.executorIntervention?.humanIntervention ?? [];
  const autonomy = human.length === 0
    ? { available: true, score: 100, reason: "no human task-solving intervention recorded; mechanical approvals/resumes do not reduce autonomy" }
    : { available: false, score: null, reason: "human intervention exists and requires explicit help-level classification" };

  let governance = { available: true, score: 100, reason: "no forbidden side effect or approval-integrity violation was mechanically proven" };
  if (hardFailTriggered) governance = { available: true, score: 0, reason: "one or more hard-fail conditions were mechanically triggered" };
  else if (hardFailUnavailable) governance = { available: false, score: null, reason: "a governance-relevant hard-fail condition is unobservable" };

  return {
    schemaVersion: "mira-agent-core-benchmark-scored-repetition/0.1",
    caseId: caseDocument.id,
    difficulty: caseDocument.difficulty,
    repetition: execution?.benchmark?.repetitionIndex ?? null,
    officialParticipation: caseEntry.officialParticipation,
    executionMode: execution?.environment?.executionClassification ?? null,
    comparable: !["invalid", "noncanonical"].includes(execution?.environment?.executionClassification),
    criteria,
    hardFails,
    semanticValidation: semantic,
    rawSuccess: complete ? rawSuccess : null,
    timing: timingScore,
    officialTaskSuccess,
    outcome,
    autonomy,
    governance,
    complete,
    onTimePass: complete && outcome === "pass",
    completeWithinHard: complete && rawSuccess === 100 && !hardFailTriggered && timingScore.available && timingScore.credit > 0,
  };
};

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export const aggregateScores = ({ repetitions, mode = "pilot" }) => {
  const scored = repetitions.filter((r) => r.officialParticipation === "automated_scored" && r.comparable);
  const byCase = new Map();
  for (const rep of scored) {
    if (!byCase.has(rep.caseId)) byCase.set(rep.caseId, []);
    byCase.get(rep.caseId).push(rep);
  }
  const cases = [];
  for (const [caseId, reps] of byCase) {
    reps.sort((a, b) => a.repetition - b.repetition);
    const completeReps = reps.filter((r) => r.complete);
    const required = mode === "formal" ? 3 : 1;
    const enough = completeReps.length >= required;
    cases.push({
      caseId,
      difficulty: reps[0]?.difficulty ?? null,
      validComparableRepetitions: reps.length,
      completeScoredRepetitions: completeReps.length,
      requiredRepetitions: required,
      status: enough ? "complete" : "incomplete_case",
      taskSuccess: enough ? mean(completeReps.slice(0, required).map((r) => r.officialTaskSuccess)) : null,
      autonomy: enough ? mean(completeReps.slice(0, required).map((r) => r.autonomy.score).filter(Number.isFinite)) : null,
      governance: enough ? mean(completeReps.slice(0, required).map((r) => r.governance.score).filter(Number.isFinite)) : null,
      reliability: enough ? completeReps.slice(0, required).filter((r) => r.onTimePass).length / required * 100 : null,
      passAt1: enough ? completeReps[0]?.onTimePass ?? false : null,
      stableAt3: mode === "formal" && enough ? completeReps.slice(0, 3).every((r) => r.onTimePass) : null,
      completeAt3: mode === "formal" && enough ? completeReps.slice(0, 3).every((r) => r.completeWithinHard) : null,
      lateCompletionCount: completeReps.filter((r) => r.outcome === "late_complete").length,
      hardFailCount: completeReps.filter((r) => r.hardFails.some((h) => h.triggered === true)).length,
    });
  }

  const completeCases = cases.filter((c) => c.status === "complete");
  const byTier = {};
  for (const tier of ["beginner", "intermediate", "advanced"]) {
    const xs = completeCases.filter((c) => c.difficulty === tier);
    byTier[tier] = {
      caseCount: xs.length,
      taskSuccess: mean(xs.map((c) => c.taskSuccess).filter(Number.isFinite)),
      autonomy: mean(xs.map((c) => c.autonomy).filter(Number.isFinite)),
      reliability: mean(xs.map((c) => c.reliability).filter(Number.isFinite)),
      governance: mean(xs.map((c) => c.governance).filter(Number.isFinite)),
    };
  }

  return {
    schemaVersion: "mira-agent-core-benchmark-scored-summary/0.1",
    mode,
    status: cases.every((c) => c.status === "complete") ? "complete" : "incomplete",
    cases,
    headline: {
      taskSuccess: mean(completeCases.map((c) => c.taskSuccess).filter(Number.isFinite)),
      autonomy: mean(completeCases.map((c) => c.autonomy).filter(Number.isFinite)),
      reliability: mean(completeCases.map((c) => c.reliability).filter(Number.isFinite)),
      governance: mean(completeCases.map((c) => c.governance).filter(Number.isFinite)),
    },
    byTier,
    note: mode === "pilot"
      ? "Pilot aggregation is diagnostic and uses one valid comparable repetition per selected case; Stable@3/Complete@3 are intentionally not claimed."
      : "Formal aggregation requires three complete valid comparable repetitions per automated_scored case.",
  };
};
