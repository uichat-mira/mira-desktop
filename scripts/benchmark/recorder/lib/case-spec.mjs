// #223 Recorder — case / benchmark identity resolution.
//
// The Recorder must freeze, per repetition: which benchmark contract, which
// case-set, and which case identity the execution belongs to. It reads the RC
// case-set manifest and the contract identity recorded there. It does NOT
// redefine the case-set (owned by #220) or the contract (owned by #216).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CASE_SET_MANIFEST_RELATIVE_PATH, loadCaseSet } from "../../lib/manifest.mjs";

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

export const loadBenchmarkIdentity = (repoRoot) => {
  const caseSet = loadCaseSet(repoRoot);
  const manifestPath = path.join(repoRoot, CASE_SET_MANIFEST_RELATIVE_PATH);
  const manifestSha = sha256(fs.readFileSync(manifestPath));
  const contract = caseSet.generatedFrom?.contract ?? null;
  return {
    caseSet,
    caseSetVersion: caseSet.caseSetVersion,
    benchmarkVersion: caseSet.benchmarkVersion ?? null,
    caseSetManifestPath: CASE_SET_MANIFEST_RELATIVE_PATH,
    caseSetManifestSha256: manifestSha,
    contractPath: contract?.path ?? null,
    contractBlobSha: contract?.blobSha ?? null,
    timingPolicy: caseSet.timingPolicy ?? null,
  };
};

export const findCase = (caseSet, caseId) => {
  const entry = caseSet.cases.find((c) => c.id === caseId);
  if (!entry) {
    throw new Error(`case "${caseId}" not present in case-set ${caseSet.caseSetVersion}`);
  }
  return entry;
};

/**
 * Frozen case identity handed to a fresh blank Judge.
 *
 * Criteria/hard-fail detail is NOT sourced from here: it is extracted from the
 * exact pinned Git blob by `frozen-source.mjs` and embedded in `case.json` /
 * `judge-input.json`, so the Judge needs no repository access. This identity
 * document only carries the frozen-manifest-level facts.
 */
export const frozenCaseIdentity = (caseEntry, identity) => ({
  caseId: caseEntry.id,
  title: caseEntry.title ?? null,
  difficulty: caseEntry.difficulty ?? null,
  caseSetVersion: identity.caseSetVersion,
  source: caseEntry.source ?? null,
  scorerOwnership: caseEntry.scorerOwnership ?? null,
  timing: caseEntry.timing ?? null,
  public: {
    prompt: caseEntry.public?.prompt ?? null,
    intentSummary: caseEntry.public?.intentSummary ?? null,
  },
});
