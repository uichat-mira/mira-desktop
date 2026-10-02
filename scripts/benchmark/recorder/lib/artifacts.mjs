// #223 Recorder — stage 5: artifact assembly (schema boundaries).
//
// This module turns one ingested raw bundle into the per-repetition artifacts:
//
//   execution.json    -- under what conditions did this repetition run?
//   trajectory.jsonl  -- the raw ordered trajectory (verbatim, one event/line)
//   result.json       -- raw facts | deterministic facts | judge(null)
//   judge-input.json  -- frozen evidence pack for a future fresh blank Judge
//
// The three result buckets are intentionally separated so a Judge can never be
// confused by a deterministic fact, and a deterministic fact is never polluted
// by executor prose.

import { deriveDeterministic } from "./derive.mjs";
import { toPublicResult, assertNoSecrets } from "./sanitize.mjs";
import { frozenCaseIdentity } from "./case-spec.mjs";
import { TRAJECTORY_SOURCES, normalizeTrajectory } from "./trajectory.mjs";

const JUDGE_SCHEMA_VERSION = "mira-agent-core-benchmark-judge-input/0.1";
const EXECUTION_SCHEMA_VERSION = "mira-agent-core-benchmark-execution/0.1";

const modelIdentityFrom = (bundle) => {
  // Provider is explicit per selected case (#221). Model id / parameters are
  // resolved by the backend and are NOT exposed verbatim on the run document,
  // so anything not provable is `unknown` (never inferred).
  const provider = bundle?.executorFacts?.actualProcedure?.provider ?? null;
  const ctx = bundle?.agentRun?.contextBudget ?? null;
  return {
    provider: provider ?? "unknown",
    modelId: ctx?.model ?? "unknown",
    accessPath: bundle?.executorFacts?.actualProcedure?.transport ?? "unknown",
    effectiveParameters: {
      temperature: "provider-default",
      topP: "provider-default",
      maxOutputTokens: ctx?.reservedOutputTokens ?? "unknown",
      reasoningEffort: "unknown",
      structuredOutputMode: "unknown",
    },
    note:
      "model id / access path are read from the run contextBudget where available; unspecified generation parameters are recorded as provider-default or unknown, never guessed",
  };
};

export const buildExecution = ({ bundle, identity, caseEntry, correction, fixtures }) => {
  const facts = bundle.executorFacts ?? {};
  const interventions = Array.isArray(facts.executorInterventions) ? facts.executorInterventions : [];

  const classifyInterventions = (list) => {
    const isMiraAction = () => false; // Mira's own actions never live in executorInterventions
    return {
      executorMechanical: list.filter((i) => ["approval", "cancel", "user_reply"].includes(i.type)),
      humanIntervention: list.filter((i) => i.type === "human").length
        ? list.filter((i) => i.type === "human")
        : [],
      note: "entries here are mechanically executed by the #221 executor on the product control surface; Mira's own actions live only in trajectory.jsonl",
      _isMiraAction: isMiraAction,
    };
  };

  return {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    benchmark: {
      benchmarkVersion: identity.benchmarkVersion,
      caseSetVersion: identity.caseSetVersion,
      caseId: caseEntry.id,
      repetitionIndex: facts.repetition ?? null,
      caseSetManifestPath: identity.caseSetManifestPath,
      caseSetManifestSha256: identity.caseSetManifestSha256,
      contractPath: identity.contractPath,
      contractBlobSha: identity.contractBlobSha,
    },
    mira: {
      commit: correction?.miraCommit ?? "unknown",
      version: correction?.miraVersion ?? "unknown",
      runtimeMode: correction?.runtimeMode ?? "desktop-local-backend",
      note: "exact Mira commit/version are supplied by the run manifest when available; unknown otherwise, never fabricated",
    },
    model: modelIdentityFrom(bundle),
    environment: {
      hostPlatform: facts.hostPlatform ?? null,
      node: facts.hostPlatform?.node ?? null,
      executionClassification: facts.executionMode ?? "canonical",
      classificationRationale: facts.classificationRationale ?? null,
      comparabilityImpact: facts.comparabilityImpact ?? null,
      adaptationRationale: facts.referenceProcedure?.reasonForDeviation ?? null,
      referenceProcedure: facts.referenceProcedure ?? null,
    },
    procedure: {
      actual: facts.actualProcedure ?? null,
      notes: Array.isArray(facts.notes) ? facts.notes : [],
    },
    fixture: {
      fixtureId: facts.workspace?.fixtureId ?? null,
      beforeManifestHash: facts.workspace?.beforeManifestHash ?? null,
      afterManifestHash: facts.workspace?.afterManifestHash ?? null,
      descriptor: fixtures ?? null,
    },
    executorIntervention: classifyInterventions(interventions),
    provenance: bundle.provenance ?? {},
    rawSources: TRAJECTORY_SOURCES,
  };
};

export const buildResult = ({ deterministic }) => ({
  schemaVersion: deterministic.schemaVersion,
  // 1) raw facts: verbatim values carried from the raw sources.
  raw: {
    terminal: deterministic.terminal,
    elapsedMs: deterministic.timing.elapsedMs,
    startedAt: deterministic.timing.startedAt,
    endedAt: deterministic.timing.endedAt,
    toolEvents: deterministic.toolCalls,
    approvals: {
      count: deterministic.approvalCount,
      childApprovalCount: deterministic.childApprovalCount,
      resumeCount: deterministic.resumeCount,
      refs: deterministic.approvalRefs,
      childRefs: deterministic.childApprovalRefs,
    },
    workspaceChanges: deterministic.sideEffects,
    refs: deterministic.refs,
  },
  // 2) deterministic derived facts: mechanically computed.
  deterministic: {
    plannerIterations: deterministic.plannerIterations,
    firstSelectedTool: deterministic.firstSelectedTool,
    exposedToolCount: deterministic.exposedToolCount,
    exposedToolIds: deterministic.exposedToolIds,
    actionSequence: deterministic.actionSequence,
    toolCallCount: deterministic.toolCallCount,
    parentToolCallCount: deterministic.parentToolCallCount,
    childToolCallCount: deterministic.childToolCallCount,
    delegationCount: deterministic.delegationCount,
    approvalCount: deterministic.approvalCount,
    childApprovalCount: deterministic.childApprovalCount,
    resumeCount: deterministic.resumeCount,
    recoverableFailureCount: deterministic.recoverableFailureCount,
    terminalFailureCount: deterministic.terminalFailureCount,
    repeatedSemanticActionCount: deterministic.repeatedSemanticActionCount,
    completionProof: deterministic.completionProof,
    unresolvedGaps: deterministic.unresolvedGaps,
    finalization: deterministic.finalization,
    timing: deterministic.timing,
    sideEffects: deterministic.sideEffects,
    hardFail: null,
    hardFailNote:
      "no deterministic hard-fail is asserted by the Recorder; hard-fail evaluation is a scoring step that consumes these facts (see #224)",
    refs: deterministic.refs,
  },
  // 3) future semantic judge result: MUST stay null at recorder time.
  judge: {
    semanticScore: null,
    semanticOutcome: null,
    semanticResults: null,
    note: "reserved for a future fresh blank judging thread; the Recorder never scores semantic quality",
  },
  observabilityGaps: deterministic.observabilityGaps,
});

export const buildJudgeInput = ({ bundle, identity, caseEntry, deterministic, execution, result, caseDocument }) => {
  const finalAnswer =
    typeof bundle.assistantTranscript === "string" && bundle.assistantTranscript.length > 0
      ? bundle.assistantTranscript
      : null;

  // Judge-safe execution manifest: identity + environment + classification +
  // procedure steps are required Judge evidence (#216 §14). Free-form executor
  // `notes` are NOT evidence and are deliberately dropped to avoid advocacy.
  const executionManifest = {
    benchmark: execution.benchmark,
    mira: execution.mira,
    model: execution.model,
    environment: execution.environment,
    procedure: {
      actual: execution.procedure?.actual ?? null,
      // executor free-form notes are excluded (not evidence)
    },
    fixture: execution.fixture,
    executorIntervention: execution.executorIntervention,
    rawSources: execution.rawSources,
    notesExcluded: "executor free-form notes are withheld from the Judge (advocacy risk, not evidence)",
  };

  // Judge-owned contract, embedded so a fresh blank Judge needs NO repository,
  // GitHub, source markdown, running Mira, or executor context. Only criteria
  // whose `scorer` is `judge` are handed out for judging; deterministic
  // criteria stay in `case.json` as frozen context and must not be re-judged.
  const successCriteria = Array.isArray(caseDocument?.successCriteria) ? caseDocument.successCriteria : [];
  const judgeCriteria = successCriteria
    .filter((criterion) => criterion.scorer === "judge")
    .map((criterion) => ({
      id: criterion.id,
      description: criterion.description ?? null,
      weight: criterion.weight ?? null,
      scorer: "judge",
      observable: criterion.observable ?? null,
    }));
  const questions = (Array.isArray(caseDocument?.judge?.semanticQuestions)
    ? caseDocument.judge.semanticQuestions
    : []
  ).map((question) => ({
    id: question.id,
    criterionId: question.criterionId,
    question: question.question ?? null,
  }));

  const judgeCriterionIds = new Set(judgeCriteria.map((criterion) => criterion.id));
  const deterministicCriteria = successCriteria
    .filter((criterion) => criterion.scorer !== "judge")
    .map((criterion) => ({ id: criterion.id, weight: criterion.weight ?? null, scorer: criterion.scorer ?? null }));

  return {
    schemaVersion: JUDGE_SCHEMA_VERSION,
    instructions:
      "You are judging one frozen Mira Agent Core Benchmark repetition. Everything you need is inside this file plus trajectory.jsonl: the frozen case contract, the semantic criteria, the semantic questions, the run/execution manifest, the raw trajectory evidence, the deterministic measurements and Mira's final answer. Do NOT reinterpret or override deterministic facts, timing, terminal state or side effects. Answer ONLY the semantic questions listed under semanticCriteria.questions, each targeting one judge-scored criterion, with pass | fail and the smallest useful evidence refs. Executor self-assessment, advocacy and hidden reasoning are deliberately excluded.",
    benchmarkContract: {
      benchmarkVersion: identity.benchmarkVersion,
      contractPath: identity.contractPath,
      contractBlobSha: identity.contractBlobSha,
      caseSetVersion: identity.caseSetVersion,
    },
    case: {
      identity: frozenCaseIdentity(caseEntry, identity),
      // Frozen case contract extracted from the exact pinned Git blob
      // (`source.path` + `source.blobSha`); equals cases/<id>/case.json.
      contract: caseDocument,
    },
    semanticCriteria: {
      // `available: true` always means "the package is complete". An empty
      // `criteria`/`questions` list means this case has NO semantic Judge work
      // (fully deterministic), which is different from an incomplete package.
      available: true,
      criteria: judgeCriteria,
      questions,
      judgeCriterionIds: [...judgeCriterionIds],
      expectedOutputShape: {
        semanticResults: [
          {
            questionId: "<id>",
            criterionId: "<id>",
            outcome: "pass | fail",
            evidenceRefs: ["trajectory:<index>", "artifact:<name>"],
          },
        ],
      },
      deterministicCriteriaNotJudgeable: deterministicCriteria,
      judgeScopeNote:
        "the Judge may only score the criteria listed in `criteria` (scorer: judge). Deterministic criteria are frozen context and must NOT be re-judged.",
    },
    executionManifest,
    deterministicMeasurements: result.deterministic,
    rawTrajectory: {
      sources: TRAJECTORY_SOURCES,
      authoritativeRefScheme: "trajectory:<index>[:<nodeId>]",
      eventCount: (bundle.executionEvents ?? []).length,
      // The full raw trajectory is delivered as trajectory.jsonl next to this
      // file; it is referenced, not duplicated here.
      trajectoryArtifact: "trajectory.jsonl",
      trajectoryDigest: bundle.provenance?.executionEvents?.sha256 ?? null,
    },
    finalAnswer: {
      text: finalAnswer,
      ref: "artifact:final-answer",
      note: "verbatim assistant transcript; not summarized or interpreted by the Recorder",
    },
    /** Executor prose / self-assessment is deliberately excluded. */
    excluded: [
      "executor self-score",
      "executor advocacy",
      "runner explanation of why Mira should pass",
      "hidden author reasoning",
    ],
    judgeFields: {
      semanticScore: null,
      semanticOutcome: null,
      semanticResults: null,
    },
  };
};

export const buildPublicProjection = ({ identity, deterministic }) => {
  const projection = toPublicResult({
    deterministic,
    identity: {
      benchmarkVersion: identity.benchmarkVersion,
      caseSetVersion: identity.caseSetVersion,
      caseId: identity.caseId,
      repetition: identity.repetition,
      executionMode: identity.executionMode,
      comparable: identity.comparable,
    },
  });
  const check = assertNoSecrets(projection);
  if (!check.ok) {
    throw new Error(`public projection leaked secret-shaped content: ${check.leaks.join(", ")}`);
  }
  return projection;
};

export const serializeTrajectoryJsonl = (executionEvents) =>
  normalizeTrajectory(executionEvents)
    .map((record) => JSON.stringify(record))
    .join("\n") + ((executionEvents ?? []).length ? "\n" : "");

export { deriveDeterministic };
