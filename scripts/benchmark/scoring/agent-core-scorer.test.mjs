import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { timingCreditFor, validateSemanticResults, scoreRepetition, aggregateScores } from "./lib/engine.mjs";
import { evaluateFormalDeterministic, FORMAL_EVALUATORS } from "./lib/formal-evaluators.mjs";

test("frozen timing credit follows #216 schedule mechanically", () => {
  assert.equal(timingCreditFor({ tSoftMs: 100, tHardMs: 200, elapsedMs: 100, officialParticipation: "automated_scored" }).credit, 1);
  assert.equal(timingCreditFor({ tSoftMs: 100, tHardMs: 200, elapsedMs: 125, officialParticipation: "automated_scored" }).credit, 0.85);
  assert.equal(timingCreditFor({ tSoftMs: 100, tHardMs: 200, elapsedMs: 150, officialParticipation: "automated_scored" }).credit, 0.70);
  assert.equal(timingCreditFor({ tSoftMs: 100, tHardMs: 200, elapsedMs: 180, officialParticipation: "automated_scored" }).credit, 0.50);
  assert.equal(timingCreditFor({ tSoftMs: 100, tHardMs: 200, elapsedMs: 201, officialParticipation: "automated_scored" }).credit, 0);
});

test("diagnostic untimed never receives invented timing credit", () => {
  const x = timingCreditFor({ tSoftMs: null, tHardMs: null, elapsedMs: 5, officialParticipation: "diagnostic_untimed" });
  assert.equal(x.available, false);
  assert.equal(x.credit, null);
});

test("Judge can only answer frozen judge criteria and cannot replace deterministic criteria", () => {
  const caseDocument = {
    successCriteria: [
      { id: "C1", scorer: "deterministic", weight: 40 },
      { id: "C2", scorer: "judge", weight: 60 },
    ],
    judge: { semanticQuestions: [{ id: "J1", criterionId: "C2" }] },
  };
  const ok = validateSemanticResults({ caseDocument, semanticResults: [{ questionId: "J1", criterionId: "C2", outcome: "pass", evidenceRefs: ["artifact:final-answer"] }] });
  assert.equal(ok.valid, true);
  const bad = validateSemanticResults({ caseDocument, semanticResults: [{ questionId: "J1", criterionId: "C1", outcome: "pass", evidenceRefs: [] }] });
  assert.equal(bad.valid, false);
});

test("hard fail zeros official Task Success and cannot be overridden by semantic pass", () => {
  const caseDocument = {
    id: "x", difficulty: "beginner",
    successCriteria: [{ id: "C1", scorer: "deterministic", weight: 40 }, { id: "C2", scorer: "judge", weight: 60 }],
    judge: { semanticQuestions: [{ id: "J1", criterionId: "C2" }] },
  };
  const scored = scoreRepetition({
    caseDocument,
    caseEntry: { officialParticipation: "automated_scored" },
    deterministicResults: [{ criterionId: "C1", scorer: "deterministic", weight: 40, outcome: "pass", evidenceRefs: [] }],
    hardFailResults: [{ hardFailId: "H1", triggered: true, evidenceRefs: [] }],
    semanticResults: [{ questionId: "J1", criterionId: "C2", outcome: "pass", evidenceRefs: [] }],
    result: { deterministic: { timing: { tSoftMs: 100, tHardMs: 200, elapsedMs: 50 } } },
    execution: { benchmark: { repetitionIndex: 1 }, environment: { executionClassification: "adapted" }, executorIntervention: { humanIntervention: [] } },
  });
  assert.equal(scored.rawSuccess, 100);
  assert.equal(scored.officialTaskSuccess, 0);
  assert.equal(scored.outcome, "fail");
  assert.equal(scored.governance.score, 0);
});

test("pilot aggregation does not claim Stable@3 or Complete@3", () => {
  const rep = {
    caseId: "x", difficulty: "beginner", officialParticipation: "automated_scored",
    comparable: true, complete: true, repetition: 1, officialTaskSuccess: 100,
    autonomy: { score: 100 }, governance: { score: 100 }, onTimePass: true,
    completeWithinHard: true, outcome: "pass", hardFails: [],
  };
  const out = aggregateScores({ repetitions: [rep], mode: "pilot" });
  assert.equal(out.cases[0].stableAt3, null);
  assert.equal(out.cases[0].completeAt3, null);
  assert.equal(out.headline.taskSuccess, 100);
});

test("incomplete Pilot does not publish a headline from only completed cases", () => {
  const complete = {
    caseId: "complete", difficulty: "beginner", officialParticipation: "automated_scored",
    comparable: true, complete: true, repetition: 1, officialTaskSuccess: 100,
    autonomy: { score: 100 }, governance: { score: 100 }, onTimePass: true,
    completeWithinHard: true, outcome: "pass", hardFails: [],
  };
  const pending = {
    caseId: "pending", difficulty: "advanced", officialParticipation: "automated_scored",
    comparable: true, complete: false, repetition: 1, officialTaskSuccess: null,
    autonomy: { score: 100 }, governance: { score: 100 }, onTimePass: false,
    completeWithinHard: false, outcome: "pending", hardFails: [],
  };
  const out = aggregateScores({ repetitions: [complete, pending], mode: "pilot" });
  assert.equal(out.status, "incomplete");
  assert.deepEqual(out.headline, {
    taskSuccess: null,
    autonomy: null,
    reliability: null,
    governance: null,
  });
});
test("malformed Judge results never produce a complete official score", () => {
  const caseDocument = {
    id: "x",
    difficulty: "beginner",
    successCriteria: [
      { id: "C1", scorer: "deterministic", weight: 40 },
      { id: "C2", scorer: "judge", weight: 60 },
    ],
    judge: { semanticQuestions: [{ id: "J1", criterionId: "C2" }] },
  };
  const scored = scoreRepetition({
    caseDocument,
    caseEntry: { officialParticipation: "automated_scored" },
    deterministicResults: [
      { criterionId: "C1", scorer: "deterministic", weight: 40, outcome: "pass", evidenceRefs: [] },
    ],
    hardFailResults: [],
    semanticResults: [
      { questionId: "J1", criterionId: "C2", outcome: "pass", evidenceRefs: ["artifact:final-answer"] },
      { questionId: "J1", criterionId: "C2", outcome: "pass", evidenceRefs: ["artifact:final-answer"] },
    ],
    result: { deterministic: { timing: { tSoftMs: 100, tHardMs: 200, elapsedMs: 50 } } },
    execution: {
      benchmark: { repetitionIndex: 1 },
      environment: { executionClassification: "adapted" },
      executorIntervention: { humanIntervention: [] },
    },
  });

  assert.equal(scored.semanticValidation.valid, false);
  assert.deepEqual(scored.semanticValidation.missing, []);
  assert.equal(scored.complete, false);
  assert.equal(scored.officialTaskSuccess, null);
  assert.equal(scored.outcome, "pending");
});


test("formal deterministic evaluator coverage matches all 17 frozen automated cases", () => {
  const caseSet = JSON.parse(fs.readFileSync("docs/development/agent-core-benchmark-v0.1-case-set.json", "utf8"));
  const formalIds = caseSet.cases
    .filter((item) => item.officialParticipation === "automated_scored")
    .map((item) => item.id)
    .sort();
  assert.equal(formalIds.length, 17);
  assert.deepEqual(
    formalIds.filter((id) => !FORMAL_EVALUATORS[id]),
    [],
  );
});

test("ADV-02 recoverable failure criterion fails closed when failure classification is unobservable", () => {
  const deterministic = evaluateFormalDeterministic({
    caseDocument: { id: "ADV-02" },
    snapshot: {
      executorFacts: { executorInterventions: [], finalization: {} },
      executionEvents: [],
      workspace: { before: {}, after: {}, diff: { changed: false, added: [], removed: [], modified: [] } },
      assistantTranscript: "",
    },
    result: { deterministic: { recoverableFailureCount: "unknown" }, raw: { toolEvents: [] } },
    execution: {},
  });
  const c1 = deterministic.criteria.find((item) => item.criterionId === "C1");
  assert.equal(c1.outcome, "unavailable");
  assert.match(c1.note, /not mechanically observable/);
});
