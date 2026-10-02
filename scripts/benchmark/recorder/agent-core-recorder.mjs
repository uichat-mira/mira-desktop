#!/usr/bin/env node
// Mira Agent Core Benchmark v0.1 — Recorder / report package (#223).
//
// Consumes one or more #221 raw repetition bundles and produces a stable,
// versioned, machine-readable, offline-recomputable benchmark artifact package.
// It does NOT drive Mira, does NOT re-implement the #221 runner, and does NOT
// score semantic quality.
//
// Usage:
//   node scripts/benchmark/recorder/agent-core-recorder.mjs \
//     --input <runRoot|repDir> [--input ...] --out <reportDir> \
//     [--manifest <run-manifest.json>] [--strict-missing]
//
// Output tree (per #216 §15):
//   <out>/
//     manifest.json
//     summary.json
//     report.md
//     public-summary.json
//     raw/<case>-rep-<n>.snapshot.json
//     cases/<case-id>/
//       case.json                       # frozen case contract (from pinned blob)
//       repetitions/<n>/
//         execution.json
//         trajectory.jsonl
//         result.json
//         judge-input.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bundleFromSnapshot, ingestRepetition, serializeRawSnapshot } from "./lib/ingest.mjs";
import { deriveDeterministic } from "./lib/derive.mjs";
import {
  buildExecution,
  buildJudgeInput,
  buildPublicProjection,
  buildResult,
  serializeTrajectoryJsonl,
} from "./lib/artifacts.mjs";
import { loadBenchmarkIdentity, findCase } from "./lib/case-spec.mjs";
import { resolveFrozenCase } from "./lib/frozen-source.mjs";
import {
  buildReportMarkdown,
  buildRunManifest,
  buildSummary,
} from "./lib/aggregate.mjs";
import { listFixtures, resolveFixture } from "../lib/fixtures.mjs";

export const RECORDER_VERSION = "agent-core-recorder/0.1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Duplicate (caseId, repetition) is data destruction — refuse to write. */
export class DuplicateRepetitionError extends Error {
  constructor(duplicates) {
    super(
      `duplicate (caseId, repetition) records would overwrite each other: ${duplicates
        .map((d) => `${d.caseId}#${d.repetition} (x${d.count})`)
        .join(", ")}`,
    );
    this.name = "DuplicateRepetitionError";
    this.duplicates = duplicates;
  }
}

/**
 * Fail fast, BEFORE deleting the output dir or writing any artifact, if two
 * input bundles resolve to the same (caseId, repetition). Otherwise the second
 * would silently overwrite the first while manifest/summary still counted two.
 */
export const assertUniqueRepetitions = (records) => {
  const seen = new Map();
  for (const record of records) {
    const key = `${record.caseId}#${record.repetition}`;
    const entry = seen.get(key) ?? { caseId: record.caseId, repetition: record.repetition, count: 0 };
    entry.count += 1;
    seen.set(key, entry);
  }
  const duplicates = [...seen.values()].filter((entry) => entry.count > 1);
  if (duplicates.length) throw new DuplicateRepetitionError(duplicates);
  return duplicates;
};

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const writeText = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
};

const parseArgs = (argv) => {
  const args = { inputs: [], out: null, manifest: null, strictMissing: false, replayFrom: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[(i += 1)];
    switch (token) {
      case "--": break; // tolerate the `pnpm run --` separator
      case "--input": args.inputs.push(path.resolve(next())); break;
      case "--out": args.out = path.resolve(next()); break;
      case "--manifest": args.manifest = path.resolve(next()); break;
      case "--replay-from": args.replayFrom = path.resolve(next()); break;
      case "--strict-missing": args.strictMissing = true; break;
      case "--help":
      case "-h":
        process.stdout.write(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
};

const HELP = [
  "Mira Agent Core Benchmark recorder (#223)",
  "",
  "Usage: node scripts/benchmark/recorder/agent-core-recorder.mjs [options]",
  "",
  "Options:",
  "  --input <path>        #221 run root or a single rep-<n> directory (repeatable)",
  "  --out <dir>           report output root (required unless --replay-from)",
  "  --manifest <file>     optional run manifest with miraCommit/model identity",
  "  --replay-from <file>  re-derive offline from a saved raw-snapshot.json",
  "  --strict-missing      fail if a recognized bundle is incomplete",
  "",
].join("\n");

/** Expand an input path into repetition bundle directories. */
const expandInputs = (input) => {
  const bundles = [];
  if (!fs.existsSync(input)) throw new Error(`input path not found: ${input}`);
  const walk = (dir) => {
    const base = path.basename(dir);
    if (base.startsWith("rep-") && fs.existsSync(path.join(dir, "executor-facts.json"))) {
      bundles.push(dir);
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  if (fs.existsSync(path.join(input, "executor-facts.json"))) bundles.push(input);
  else walk(input);
  return bundles;
};

const loadRunManifest = (file) => {
  if (!file) return {};
  if (!fs.existsSync(file)) throw new Error(`run manifest not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const comparableFor = (classification, selection) => {
  if (classification === "invalid") return false;
  if (classification === "noncanonical") return false;
  return true;
};

export const recordOne = ({ bundle, identity, selection, runManifest, strictMissing, repoRoot = REPO_ROOT }) => {
  const facts = bundle.executorFacts ?? {};
  const caseId = facts.caseId;
  if (!caseId) {
    if (strictMissing) throw new Error("executor-facts is missing caseId");
    return null;
  }
  const caseEntry = findCase(identity.caseSet, caseId);
  const classification = facts.executionMode ?? "canonical";
  const selectionEntry = selection?.[caseId] ?? {};
  const comparable = comparableFor(classification, selectionEntry);

  const deterministic = deriveDeterministic(bundle);

  // Blocker 3/4: freeze the case contract from the EXACT pinned Git blob so the
  // package is self-contained for a fresh blank Judge. Fails loudly on a
  // missing/mismatched blob or an absent/duplicate case block.
  const { caseDocument } = resolveFrozenCase({ repoRoot, caseEntry, identity });

  const corrections = {
    miraCommit: runManifest.miraCommit ?? facts.miraCommit ?? null,
    miraVersion: runManifest.miraVersion ?? null,
    runtimeMode: runManifest.runtimeMode ?? null,
  };

  let fixtures = null;
  try {
    if (facts.workspace?.fixtureId && listFixtures().includes(facts.workspace.fixtureId)) {
      const spec = resolveFixture(facts.workspace.fixtureId, { externalDir: path.join(bundle.repDir ?? "", "external") });
      fixtures = { id: spec.id, fileCount: Object.keys(spec.files ?? {}).length };
    }
  } catch {
    fixtures = null;
  }

  const execution = buildExecution({ bundle, identity, caseEntry, correction: corrections, fixtures });
  const result = buildResult({ deterministic });
  const judgeInput = buildJudgeInput({ bundle, identity, caseEntry, deterministic, execution, result, caseDocument });

  const identityForProjection = {
    benchmarkVersion: identity.benchmarkVersion,
    caseSetVersion: identity.caseSetVersion,
    caseId,
    repetition: facts.repetition ?? null,
    executionMode: classification,
    comparable,
  };
  const publicResult = buildPublicProjection({ identity: identityForProjection, deterministic });

  return {
    caseId,
    repetition: facts.repetition ?? null,
    executionClassification: classification,
    comparable,
    deterministic,
    caseDocument,
    execution,
    result,
    judgeInput,
    publicResult,
    rawSnapshot: serializeRawSnapshot(bundle),
  };
};

const resolveSelection = (repoRoot) => {
  const file = path.join(repoRoot, "scripts", "benchmark", "selection.json");
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const map = {};
  for (const entry of raw.cases ?? []) map[entry.id] = entry;
  return map;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (args.replayFrom) {
    const snapshot = JSON.parse(fs.readFileSync(args.replayFrom, "utf8"));
    const bundle = bundleFromSnapshot(snapshot);
    const identity = loadBenchmarkIdentity(REPO_ROOT);
    const record = recordOne({ bundle, identity, selection: {}, runManifest: {}, strictMissing: true });
    process.stdout.write(`${JSON.stringify({ replay: true, caseId: record.caseId, deterministic: record.deterministic }, null, 2)}\n`);
    return;
  }

  if (!args.inputs.length) throw new Error("at least one --input is required");
  if (!args.out) throw new Error("--out is required");

  const identity = loadBenchmarkIdentity(REPO_ROOT);
  const selection = resolveSelection(REPO_ROOT);
  const runManifest = loadRunManifest(args.manifest);

  const bundleDirs = args.inputs.flatMap(expandInputs).sort();
  if (!bundleDirs.length) throw new Error("no #221 repetition bundles found in the given inputs");

  const records = [];
  for (const dir of bundleDirs) {
    const bundle = ingestRepetition(dir);
    const record = recordOne({ bundle, identity, selection, runManifest, strictMissing: args.strictMissing });
    if (record) records.push(record);
  }
  if (!records.length) throw new Error("no recordable repetitions were produced");

  // Blocker 2: refuse duplicates BEFORE destroying/writing output. A duplicate
  // (caseId, repetition) would overwrite evidence while manifest/summary still
  // counted both, i.e. a self-contradictory "successful" package.
  assertUniqueRepetitions(records);

  // Blocker 4: a case may have multiple repetitions, but they must all resolve
  // to the SAME frozen case contract. A conflicting frozen contract is a hard
  // failure, not something to silently pick.
  const caseDocuments = new Map();
  for (const record of records) {
    const fingerprint = JSON.stringify(record.caseDocument);
    const existing = caseDocuments.get(record.caseId);
    if (!existing) {
      caseDocuments.set(record.caseId, { document: record.caseDocument, fingerprint });
    } else if (existing.fingerprint !== fingerprint) {
      throw new Error(
        `case "${record.caseId}" produced inconsistent frozen case contracts across repetitions; refusing to write`,
      );
    }
  }

  fs.rmSync(args.out, { recursive: true, force: true });
  const publicResults = [];

  for (const record of records) {
    const repDir = path.join(args.out, "cases", record.caseId, "repetitions", String(record.repetition ?? "unknown"));
    writeJson(path.join(repDir, "execution.json"), record.execution);
    writeText(path.join(repDir, "trajectory.jsonl"), serializeTrajectoryJsonl(record.rawSnapshot.executionEvents));
    writeJson(path.join(repDir, "result.json"), record.result);
    writeJson(path.join(repDir, "judge-input.json"), record.judgeInput);
    publicResults.push({ ...record.publicResult, caseId: record.caseId, repetition: record.repetition });
  }

  // Blocker 4: one case.json per case (shared by all its repetitions).
  for (const [caseId, entry] of caseDocuments) {
    writeJson(path.join(args.out, "cases", caseId, "case.json"), entry.document);
  }

  // run-level raw snapshots (for offline replay) live under raw/
  records.forEach((record, i) => {
    writeJson(path.join(args.out, "raw", `${record.caseId}-rep-${record.repetition ?? i}.snapshot.json`), record.rawSnapshot);
  });

  const manifest = buildRunManifest({ identity, repetitions: records });
  const summary = buildSummary({ repetitions: records });
  const report = buildReportMarkdown({
    manifest,
    summary,
    repetitions: records,
    recognizedInput: `${records.length} rep bundle(s) from ${bundleDirs.length} dir(s)`,
  });

  writeJson(path.join(args.out, "manifest.json"), manifest);
  writeJson(path.join(args.out, "summary.json"), summary);
  writeJson(path.join(args.out, "public-summary.json"), {
    schemaVersion: "mira-agent-core-benchmark-public-summary/0.1",
    benchmarkVersion: identity.benchmarkVersion,
    caseSetVersion: identity.caseSetVersion,
    runCount: summary.runCount,
    terminalDistribution: summary.terminalDistribution,
    timingState: summary.timingObservations.policyState,
    results: publicResults,
  });
  writeText(path.join(args.out, "report.md"), report);

  process.stdout.write(
    `${JSON.stringify({ out: path.relative(REPO_ROOT, args.out), repetitions: records.length, cases: [...new Set(records.map((r) => r.caseId))] }, null, 2)}\n`,
  );
};

const runCli = () =>
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
