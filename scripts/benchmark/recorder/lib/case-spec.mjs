// #223 Recorder — case / benchmark identity resolution.
//
// The Recorder must freeze, per repetition: which benchmark contract, which
// case-set, and which case identity the execution belongs to. It reads the RC
// case-set manifest and the contract identity recorded there. It does NOT
// redefine the case-set (owned by #220) or the contract (owned by #216).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadCaseSet, RC_MANIFEST_RELATIVE_PATH } from "../../lib/manifest.mjs";

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

export const loadBenchmarkIdentity = (repoRoot) => {
  const caseSet = loadCaseSet(repoRoot);
  const manifestPath = path.join(repoRoot, RC_MANIFEST_RELATIVE_PATH);
  const manifestSha = sha256(fs.readFileSync(manifestPath));
  const contract = caseSet.generatedFrom?.contract ?? null;
  return {
    caseSet,
    caseSetVersion: caseSet.caseSetVersion,
    benchmarkVersion: caseSet.benchmarkVersion ?? null,
    caseSetManifestPath: RC_MANIFEST_RELATIVE_PATH,
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
 * The frozen case contract handed to the Judge. Only fields the case-set
 * genuinely records are exposed. The RC manifest carries public title/difficulty/
 * prompt/intent + scorer ownership + timing; canonical scoring criteria and
 * hard-fail detail live in the frozen case source packs (referenced by blob SHA)
 * and are intentionally NOT reconstructed here to avoid inventing criteria.
 */
export const frozenCaseContract = (caseEntry, identity) => ({
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
  // Criteria/hard-fail detail is owned by the referenced frozen source pack.
  criteriaSource: caseEntry.source?.path ?? null,
  criteriaBlobSha: caseEntry.source?.blobSha ?? null,
  criteriaNote:
    "canonical scoring criteria and hard-fail definitions live in the frozen case source pack identified by criteriaBlobSha; the Recorder does not reconstruct or invent them",
});
