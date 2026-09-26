import type { EvaluationRunRecord } from "./types";

const STORAGE_KEY = "rag_eval_center_runs";

const sortByCompletedAtDesc = (runs: EvaluationRunRecord[]) =>
  [...runs].sort((left, right) =>
    (right.completedAt ?? right.startedAt).localeCompare(
      left.completedAt ?? left.startedAt,
    ),
  );

export const readEvaluationRuns = (): EvaluationRunRecord[] => {
  const serialized = globalThis.localStorage.getItem(STORAGE_KEY);
  if (!serialized) {
    return [];
  }

  try {
    const parsed = JSON.parse(serialized) as EvaluationRunRecord[];
    return sortByCompletedAtDesc(parsed);
  } catch {
    return [];
  }
};

export const writeEvaluationRuns = (runs: EvaluationRunRecord[]) => {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(sortByCompletedAtDesc(runs)));
};

export const saveEvaluationRun = (run: EvaluationRunRecord) => {
  const current = readEvaluationRuns();
  const next = [run, ...current.filter((item) => item.id !== run.id)];
  writeEvaluationRuns(next);
};

export const removeEvaluationRun = (runId: string) => {
  writeEvaluationRuns(readEvaluationRuns().filter((item) => item.id !== runId));
};
