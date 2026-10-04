#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { aggregateScores, scoreRepetition } from "./lib/engine.mjs";
import { evaluatePilotDeterministic, PILOT_EVALUATORS } from "./lib/pilot-evaluators.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const CASE_SET_PATH = path.join(REPO_ROOT, "docs/development/agent-core-benchmark-v0.1-case-set.json");

const parseArgs = (argv) => {
  const out = { report: null, judgeResults: null, mode: "pilot", out: null, coverageOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`missing value for ${a}`);
      return value;
    };
    if (a === "--report") out.report = path.resolve(next());
    else if (a === "--judge-results") out.judgeResults = path.resolve(next());
    else if (a === "--mode") out.mode = next();
    else if (a === "--out") out.out = path.resolve(next());
    else if (a === "--coverage-only") out.coverageOnly = true;
    else if (a === "--") continue;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!["pilot", "formal"].includes(out.mode)) throw new Error("--mode must be pilot or formal");
  if (!out.coverageOnly && !out.report) throw new Error("--report is required");
  return out;
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};

const loadJudgeResults = (file) => {
  if (!file) return new Map();
  const doc = readJson(file);
  const reps = Array.isArray(doc?.repetitions) ? doc.repetitions : [];
  return new Map(reps.map((r) => [`${r.caseId}#${r.repetition}`, r.semanticResults ?? []]));
};

const coverage = (caseSet) => {
  const formal = caseSet.cases.filter((c) => c.officialParticipation === "automated_scored");
  const supported = formal.filter((c) => PILOT_EVALUATORS[c.id]);
  const unsupported = formal.filter((c) => !PILOT_EVALUATORS[c.id]).map((c) => c.id);
  return {
    formalCaseCount: formal.length,
    deterministicEvaluatorCaseCount: supported.length,
    fullyCovered: unsupported.length === 0,
    unsupported,
  };
};

const collectRepetitions = ({ report, caseSet, judgeResults }) => {
  const reps = [];
  const casesDir = path.join(report, "cases");
  for (const caseId of fs.readdirSync(casesDir)) {
    const caseRoot = path.join(casesDir, caseId);
    if (!fs.statSync(caseRoot).isDirectory()) continue;
    const caseDocument = readJson(path.join(caseRoot, "case.json"));
    const caseEntry = caseSet.cases.find((c) => c.id === caseId);
    if (!caseEntry) throw new Error(`case ${caseId} is absent from canonical manifest`);
    const repsDir = path.join(caseRoot, "repetitions");
    for (const repName of fs.readdirSync(repsDir)) {
      const repetition = Number(repName);
      if (!Number.isInteger(repetition) || repetition <= 0) continue;
      const repRoot = path.join(repsDir, repName);
      const execution = readJson(path.join(repRoot, "execution.json"));
      const result = readJson(path.join(repRoot, "result.json"));
      const snapshot = readJson(path.join(report, "raw", `${caseId}-rep-${repetition}.snapshot.json`));
      const deterministic = evaluatePilotDeterministic({ caseDocument, snapshot, result, execution });
      const semanticResults = judgeResults.get(`${caseId}#${repetition}`) ?? [];
      const scored = scoreRepetition({
        caseDocument,
        caseEntry,
        deterministicResults: deterministic.criteria,
        hardFailResults: deterministic.hardFails,
        semanticResults,
        result,
        execution,
      });
      scored.evaluatorSupported = deterministic.supported;
      reps.push(scored);
    }
  }
  return reps;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const caseSet = readJson(CASE_SET_PATH);
  const evaluatorCoverage = coverage(caseSet);
  if (args.coverageOnly) {
    process.stdout.write(JSON.stringify(evaluatorCoverage, null, 2) + "\n");
    process.exitCode = evaluatorCoverage.fullyCovered ? 0 : 2;
    return;
  }

  const judgeResults = loadJudgeResults(args.judgeResults);
  const repetitions = collectRepetitions({ report: args.report, caseSet, judgeResults });
  const summary = aggregateScores({ repetitions, mode: args.mode });
  const scoring = {
    schemaVersion: "mira-agent-core-benchmark-scoring-run/0.1",
    mode: args.mode,
    sourceReport: path.basename(args.report),
    evaluatorCoverage,
    repetitions,
    summary,
  };

  const output = args.out ?? path.join(args.report, "scoring");
  writeJson(path.join(output, "scoring.json"), scoring);
  writeJson(path.join(output, "summary.json"), summary);
  process.stdout.write(JSON.stringify({
    out: output,
    repetitions: repetitions.length,
    completeRepetitions: repetitions.filter((r) => r.complete).length,
    summaryStatus: summary.status,
    evaluatorCoverage,
  }, null, 2) + "\n");

  if (repetitions.some((r) => !r.evaluatorSupported)) process.exitCode = 2;
};

main();
