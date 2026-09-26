// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  readEvaluationRuns,
  saveEvaluationRun,
  removeEvaluationRun,
  writeEvaluationRuns,
} from "../storage";
import type { EvaluationRunRecord } from "../types";

const createRun = (
  id: string,
  startedAt: string,
  completedAt?: string,
): EvaluationRunRecord => ({
  id,
  name: `run-${id}`,
  status: "completed",
  startedAt,
  completedAt,
  metrics: {
    hitAtK: 0.8,
    recallAtK: 0.7,
    mrr: 0.6,
    faithfulness: 0.9,
    answerRelevance: 0.85,
    answerCompleteness: 0.8,
    sourceHitRate: 0.75,
    averageLatencyMs: 1200,
    failedCount: 0,
  },
  dataset: {
    id: "ds1",
    datasetName: "dataset",
    fileName: "dataset.zip",
    fileSize: 1024,
    uploadedAt: "2024-01-01T00:00:00Z",
    summary: {
      documentCount: 2,
      sampleCount: 10,
      hasReferenceAnswers: true,
      hasGoldSources: true,
    },
    config: {
      mode: "retrieve",
      topK: 5,
      topN: 3,
      repeat: 1,
      concurrency: 2,
      timeoutSeconds: 30,
    },
    documents: [],
    previewSamples: [],
    validations: [],
  },
  logs: [],
  sampleResults: [],
});

describe("evaluation storage", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("returns empty array when storage is empty", () => {
    expect(readEvaluationRuns()).toEqual([]);
  });

  it("saves and reads runs sorted by completedAt desc", () => {
    const runA = createRun("a", "2024-01-01T00:00:00Z", "2024-01-01T01:00:00Z");
    const runB = createRun("b", "2024-01-02T00:00:00Z", "2024-01-02T01:00:00Z");

    writeEvaluationRuns([runA, runB]);
    const result = readEvaluationRuns();

    expect(result.map((run) => run.id)).toEqual(["b", "a"]);
  });

  it("falls back to startedAt when completedAt is missing", () => {
    const runA = createRun("a", "2024-01-02T00:00:00Z");
    const runB = createRun("b", "2024-01-01T00:00:00Z", "2024-01-03T00:00:00Z");

    writeEvaluationRuns([runA, runB]);
    const result = readEvaluationRuns();

    expect(result.map((run) => run.id)).toEqual(["b", "a"]);
  });

  it("updates existing run on save", () => {
    const run = createRun("a", "2024-01-01T00:00:00Z");
    saveEvaluationRun(run);
    const updated = { ...run, name: "updated" };
    saveEvaluationRun(updated);

    const result = readEvaluationRuns();
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("updated");
  });

  it("removes run by id", () => {
    const runA = createRun("a", "2024-01-01T00:00:00Z");
    const runB = createRun("b", "2024-01-02T00:00:00Z");
    writeEvaluationRuns([runA, runB]);

    removeEvaluationRun("a");
    const result = readEvaluationRuns();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("b");
  });

  it("returns empty array when storage contains invalid json", () => {
    globalThis.localStorage.setItem("rag_eval_center_runs", "not-json");
    expect(readEvaluationRuns()).toEqual([]);
  });
});
