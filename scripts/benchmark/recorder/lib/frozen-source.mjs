// #223 Recorder — frozen case-source resolution (Blocker 3 / Blocker 4).
//
// A fresh blank Judge must be able to score a repetition with NO access to the
// repository, GitHub, the source markdown, a running Mira, or any executor
// context. The ONLY way that is possible is if the Recorder copies the frozen
// semantic contract (success criteria + judge questions) into the package.
//
// The frozen semantic contract lives in the candidate source pack, at the exact
// Git blob the RC manifest pins (`source.path` + `source.blobSha`). This module:
//
//   1. reads the EXACT pinned Git blob (never the drifted working tree);
//   2. extracts the `~~~yaml` fenced case block for the requested case id;
//   3. asserts exactly one matching block;
//   4. parses it with the repo's existing YAML parser;
//   5. self-checks the frozen contract (weights, judge mapping).
//
// It must fail loudly when the blob is missing, the block is absent/duplicated,
// or the contract is not self-consistent. It never invents criteria.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

export class FrozenSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "FrozenSourceError";
  }
}

/** Run a git command against the repo and return trimmed stdout. */
const git = (repoRoot, args) => {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  } catch (error) {
    throw new FrozenSourceError(`git ${args.join(" ")} failed: ${error.message}`);
  }
};

/**
 * Read the exact content of a pinned Git blob, verifying the object identity.
 * Never falls back to the (possibly drifted) working-tree file: if the exact
 * blob cannot be produced, this fails loudly.
 *
 * @returns {{ source: string, blobSha: string, objectType: string }}
 */
export const readFrozenBlob = (repoRoot, blobSha) => {
  if (typeof blobSha !== "string" || !/^[0-9a-f]{40}$/.test(blobSha)) {
    throw new FrozenSourceError(`source.blobSha must be a full 40-char git blob sha, got: ${blobSha}`);
  }
  const objectType = git(repoRoot, ["cat-file", "-t", blobSha]).trim();
  if (objectType !== "blob") {
    throw new FrozenSourceError(
      `frozen source object ${blobSha} is a "${objectType}", not a git blob; refusing to use it`,
    );
  }
  const source = git(repoRoot, ["cat-file", "-p", blobSha]);
  // Independently confirm the exact bytes re-hash to the requested object id.
  let actual;
  try {
    actual = execFileSync("git", ["hash-object", "--stdin"], {
      cwd: repoRoot,
      input: source,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    throw new FrozenSourceError(`git hash-object failed: ${error.message}`);
  }
  if (actual !== blobSha) {
    throw new FrozenSourceError(
      `frozen source blob identity mismatch: expected ${blobSha}, re-hashed to ${actual}`,
    );
  }
  return { source, blobSha, objectType };
};

/**
 * Extract the YAML fenced block whose top-level `id:` equals `caseId`.
 *
 * The source packs are markdown with one fenced YAML case block per case. The
 * fence marker differs across packs (`~~~yaml` in the intermediate/advanced
 * packs, `````yaml` in the beginner pack), so both are recognized. We do NOT
 * parse the whole markdown; we locate the fenced blocks and let the real YAML
 * parser read each candidate block, then select by id.
 *
 * @returns {string} the raw YAML text of the single matching case block
 */
export const extractCaseYamlBlock = (source, caseId) => {
  const lines = source.split("\n");
  const blocks = [];
  let inBlock = false;
  let fenceChar = null;
  let current = [];
  for (const line of lines) {
    const open = line.match(/^\s*(~~~+|```+)\s*yaml\s*$/i);
    if (!inBlock && open) {
      inBlock = true;
      fenceChar = open[1][0];
      current = [];
      continue;
    }
    const close = inBlock ? line.match(/^\s*(~~~+|```+)\s*$/) : null;
    if (close && close[1][0] === fenceChar) {
      blocks.push(current.join("\n"));
      inBlock = false;
      fenceChar = null;
      current = [];
      continue;
    }
    if (inBlock) current.push(line);
  }
  if (inBlock) {
    throw new FrozenSourceError("unterminated YAML fenced block in frozen source");
  }

  const matches = [];
  for (const block of blocks) {
    let parsed;
    try {
      parsed = parseYaml(block);
    } catch {
      // A non-case YAML block (e.g. the generic shape template) is skipped.
      continue;
    }
    if (parsed && typeof parsed === "object" && parsed.id === caseId) {
      matches.push({ block, parsed });
    }
  }

  if (matches.length === 0) {
    throw new FrozenSourceError(`no frozen YAML case block with id "${caseId}" found in source`);
  }
  if (matches.length > 1) {
    throw new FrozenSourceError(
      `duplicate frozen YAML case blocks with id "${caseId}" found in source (${matches.length})`,
    );
  }
  return matches[0].block;
};

/**
 * Self-check the frozen case contract. The Recorder never changes scoring
 * semantics, but it must refuse to publish a package whose frozen contract is
 * internally inconsistent.
 */
export const assertCaseContract = (caseContract) => {
  const id = caseContract?.id;
  const criteria = Array.isArray(caseContract?.successCriteria) ? caseContract.successCriteria : [];
  if (!criteria.length) {
    throw new FrozenSourceError(`frozen case "${id}" has no successCriteria`);
  }

  let weightTotal = 0;
  const ids = new Set();
  for (const criterion of criteria) {
    if (!criterion?.id) throw new FrozenSourceError(`frozen case "${id}" has a criterion without an id`);
    if (ids.has(criterion.id)) throw new FrozenSourceError(`frozen case "${id}" has duplicate criterion id "${criterion.id}"`);
    ids.add(criterion.id);
    if (typeof criterion.weight !== "number" || !Number.isFinite(criterion.weight)) {
      throw new FrozenSourceError(`criterion "${criterion.id}" of "${id}" has a non-numeric weight`);
    }
    weightTotal += criterion.weight;
  }
  if (weightTotal !== 100) {
    throw new FrozenSourceError(
      `frozen case "${id}" successCriteria weights sum to ${weightTotal}, expected exactly 100`,
    );
  }

  const judgeCriteria = criteria.filter((c) => c.scorer === "judge");
  const judgeCriteriaIds = new Set(judgeCriteria.map((c) => c.id));

  const questions = caseContract?.judge?.semanticQuestions;
  const questionList = Array.isArray(questions) ? questions : [];
  if (questions != null && !Array.isArray(questions)) {
    throw new FrozenSourceError(`frozen case "${id}" judge.semanticQuestions must be an array`);
  }

  const questionIds = new Set();
  const mappedCriterionIds = new Set();
  for (const question of questionList) {
    if (!question?.id) throw new FrozenSourceError(`frozen case "${id}" has a semantic question without an id`);
    if (questionIds.has(question.id)) {
      throw new FrozenSourceError(`frozen case "${id}" has duplicate semantic question id "${question.id}"`);
    }
    questionIds.add(question.id);
    if (!question.criterionId || !ids.has(question.criterionId)) {
      throw new FrozenSourceError(
        `semantic question "${question.id}" of "${id}" references unknown criterion "${question.criterionId}"`,
      );
    }
    if (!judgeCriteriaIds.has(question.criterionId)) {
      throw new FrozenSourceError(
        `semantic question "${question.id}" of "${id}" points at criterion "${question.criterionId}" whose scorer is not "judge"`,
      );
    }
    if (mappedCriterionIds.has(question.criterionId)) {
      throw new FrozenSourceError(
        `frozen case "${id}" maps more than one semantic question to criterion "${question.criterionId}"`,
      );
    }
    mappedCriterionIds.add(question.criterionId);
  }

  // Every judge-scored criterion must have exactly one semantic question.
  for (const criterionId of judgeCriteriaIds) {
    if (!mappedCriterionIds.has(criterionId)) {
      throw new FrozenSourceError(
        `frozen case "${id}" judge criterion "${criterionId}" has no semantic question mapping`,
      );
    }
  }

  return {
    id,
    weightTotal,
    judgeCriterionCount: judgeCriteria.length,
    questionCount: questionList.length,
  };
};

/**
 * Public-safe frozen case document (`case.json`, #216 §15). Contains only the
 * fields the source genuinely records — missing fields are omitted, never
 * invented. This is the single frozen case contract shared by `case.json` and
 * `judge-input.json`.
 */
const CASE_DOCUMENT_FIELDS = [
  "id",
  "version",
  "title",
  "difficulty",
  "difficultyRationale",
  "public",
  "fixture",
  "boundaries",
  "successCriteria",
  "hardFails",
  "timing",
  "expectedObservability",
  "judge",
  "publication",
];

export const buildCaseDocument = ({ caseId, extracted, identity, caseEntry }) => {
  const document = {};
  for (const field of CASE_DOCUMENT_FIELDS) {
    if (extracted[field] !== undefined) document[field] = extracted[field];
  }
  document.source = {
    path: caseEntry?.source?.path ?? null,
    blobSha: caseEntry?.source?.blobSha ?? null,
  };
  document.caseSetVersion = identity.caseSetVersion;
  document.benchmarkVersion = identity.benchmarkVersion;
  document.frozenFrom = "RC case-set manifest source.path + source.blobSha (exact git blob)";
  const selfCheck = assertCaseContract(document);
  document.selfCheck = selfCheck;
  return document;
};

/**
 * Resolve the frozen case contract for `caseId` from the exact pinned blob.
 *
 * @returns {{ caseDocument: object, rawYaml: string, blobSha: string }}
 */
export const resolveFrozenCase = ({ repoRoot, caseEntry, identity }) => {
  const caseId = caseEntry?.id;
  const blobSha = caseEntry?.source?.blobSha;
  const sourcePath = caseEntry?.source?.path;
  if (!blobSha || !sourcePath) {
    throw new FrozenSourceError(
      `case "${caseId}" is missing source.path/source.blobSha in the RC manifest; cannot freeze the semantic contract`,
    );
  }

  const { source } = readFrozenBlob(repoRoot, blobSha);
  const rawYaml = extractCaseYamlBlock(source, caseId);
  const extracted = parseYaml(rawYaml);
  if (!extracted || extracted.id !== caseId) {
    throw new FrozenSourceError(`extracted frozen block id "${extracted?.id}" does not match "${caseId}"`);
  }

  const caseDocument = buildCaseDocument({ caseId, extracted, identity, caseEntry });
  return { caseDocument, rawYaml, blobSha };
};

export { path, fs };
