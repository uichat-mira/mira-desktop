// Reads the frozen/RR case-set manifest as the runner's case input.
//
// The manifest is owned by #220; the runner only consumes `public.prompt` and
// `timing`. It does not define or persist any benchmark artifact schema.

import fs from "node:fs";
import path from "node:path";

export const RC_MANIFEST_RELATIVE_PATH =
  "docs/development/agent-core-benchmark-v0.1-case-set-rc1.json";

export const loadCaseSet = (repoRoot) => {
  const manifestPath = path.join(repoRoot, RC_MANIFEST_RELATIVE_PATH);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Case-set manifest not found: ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error("Case-set manifest has no cases");
  }
  return { ...parsed, manifestPath };
};

export const getCase = (caseSet, caseId) => {
  const found = caseSet.cases.find((entry) => entry.id === caseId);
  if (!found) {
    const known = caseSet.cases.map((entry) => entry.id).join(", ");
    throw new Error(`Case "${caseId}" not found in ${caseSet.caseSetVersion}. Known: ${known}`);
  }
  return found;
};

/**
 * Frozen timing for a case. Returns null values during pre-freeze calibration,
 * which is the expected RC state and must NOT be treated as an unlimited or
 * invented cutoff.
 */
export const caseTiming = (caseEntry) => ({
  tSoftMs: typeof caseEntry?.timing?.tSoftMs === "number" ? caseEntry.timing.tSoftMs : null,
  tHardMs: typeof caseEntry?.timing?.tHardMs === "number" ? caseEntry.timing.tHardMs : null,
  status: caseEntry?.timing?.status ?? "unknown",
});

export const isTimingFrozen = (timing) =>
  typeof timing.tSoftMs === "number" && typeof timing.tHardMs === "number";
