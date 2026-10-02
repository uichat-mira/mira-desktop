// Selection resolution + strict validation for the benchmark runner.
//
// Benchmark runners must never "pass green without running anything". These
// helpers make illegal selection input a hard error instead of a silent no-op,
// so a filtered-to-empty case set, an unknown --cases id, or a non-positive
// --repetitions value cannot masquerade as a successful run.

export class SelectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "SelectionError";
  }
}

/**
 * Parse a repetition count. Returns null when no value was supplied.
 * Rejects anything that is not a positive integer (0, negatives, NaN, floats).
 */
export const parseRepetitions = (raw) => {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new SelectionError(
      `repetitions must be a positive integer, received ${JSON.stringify(raw)}`,
    );
  }
  return value;
};

/**
 * Resolve the effective case list + repetition count.
 *
 * @param {{cases: Array<object>, repetitions?: number}} selection
 * @param {{cases?: string[]|null, repetitions?: number|null}} overrides
 * @param {{knownCaseIds?: string[]}} context
 */
export const resolveSelection = (selection, overrides, context = {}) => {
  if (!selection || !Array.isArray(selection.cases) || selection.cases.length === 0) {
    throw new SelectionError("selection config must define at least one case");
  }

  const selectedIds = new Set(selection.cases.map((entry) => entry.id));
  const knownCaseIds = new Set(context.knownCaseIds ?? []);

  let cases = selection.cases;

  if (Array.isArray(overrides.cases)) {
    const requested = overrides.cases.filter((id) => typeof id === "string" && id.trim());
    if (requested.length === 0) {
      throw new SelectionError("--cases was provided but did not contain any case id");
    }
    const notInSelection = requested.filter((id) => !selectedIds.has(id));
    if (notInSelection.length > 0) {
      throw new SelectionError(
        `--cases id(s) not present in selection config: ${notInSelection.join(", ")}`,
      );
    }
    if (knownCaseIds.size > 0) {
      const notInCaseSet = requested.filter((id) => !knownCaseIds.has(id));
      if (notInCaseSet.length > 0) {
        throw new SelectionError(
          `--cases id(s) not present in the case set: ${notInCaseSet.join(", ")}`,
        );
      }
    }
    cases = selection.cases.filter((entry) => requested.includes(entry.id));
  }

  if (cases.length === 0) {
    throw new SelectionError("resolved case set is empty; nothing would be executed");
  }

  const repetitions =
    parseRepetitions(overrides.repetitions) ??
    parseRepetitions(selection.repetitions ?? 1) ??
    1;

  for (const entry of cases) {
    const mode = entry.executionMode ?? "canonical";
    if (mode !== "canonical") {
      if (typeof entry.comparabilityImpact !== "string" || !entry.comparabilityImpact.trim()) {
        throw new SelectionError(
          `case "${entry.id}" is classified "${mode}" but does not record a comparabilityImpact`,
        );
      }
    }
  }

  return { ...selection, cases, repetitions };
};

export const caseIdsOf = (caseSet) => caseSet.cases.map((entry) => entry.id);
