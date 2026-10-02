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

    if (typeof entry.provider !== "string" || !entry.provider.trim()) {
      throw new SelectionError(
        `case "${entry.id}" must declare an explicit provider; the runner never falls back to "default"`,
      );
    }
    if (!/^[A-Za-z0-9._-]+$/.test(entry.provider)) {
      throw new SelectionError(
        `case "${entry.id}" has an invalid provider "${entry.provider}"`,
      );
    }

    // #221 exposes approval/resume control but the current product surface has
    // no reject endpoint. Refuse unsupported deny policies instead of recording
    // a denial that was never sent to Mira.
    if (entry.approvalPolicy !== "auto-approve") {
      throw new SelectionError(
        `case "${entry.id}" approvalPolicy must be "auto-approve"; deny/reject is not supported by the current #221 runner control surface`,
      );
    }

    if (
      entry.initialPrompt !== undefined &&
      (typeof entry.initialPrompt !== "string" || !entry.initialPrompt.trim())
    ) {
      throw new SelectionError(
        `case "${entry.id}" initialPrompt must be a non-empty string`,
      );
    }

    if (entry.turns !== undefined && entry.followUps !== undefined) {
      throw new SelectionError(
        `case "${entry.id}" must not declare both legacy turns and followUps`,
      );
    }

    if (entry.turns !== undefined) {
      if (
        !Array.isArray(entry.turns) ||
        entry.turns.length === 0 ||
        entry.turns.some((turn) => typeof turn !== "string" || !turn.trim())
      ) {
        throw new SelectionError(
          `case "${entry.id}" turns must be a non-empty array of non-empty strings`,
        );
      }
    }

    if (entry.followUps !== undefined) {
      if (!Array.isArray(entry.followUps) || entry.followUps.length === 0) {
        throw new SelectionError(
          `case "${entry.id}" followUps must be a non-empty array`,
        );
      }
      for (const followUp of entry.followUps) {
        if (
          !followUp ||
          !["completed", "waiting_user"].includes(followUp.when) ||
          typeof followUp.text !== "string" ||
          !followUp.text.trim()
        ) {
          throw new SelectionError(
            `case "${entry.id}" followUps require { when: "completed" | "waiting_user", text: non-empty string }`,
          );
        }
      }
    }
  }

  return { ...selection, cases, repetitions };
};

export const caseIdsOf = (caseSet) => caseSet.cases.map((entry) => entry.id);
