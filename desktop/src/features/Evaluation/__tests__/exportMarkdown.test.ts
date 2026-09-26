// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildEvaluationRunMarkdown } from "../exportMarkdown";
import type { EvaluationRunRecord } from "../types";

const createRun = (): EvaluationRunRecord => ({
  id: "run-1",
  name: "Test Run",
  status: "completed",
  startedAt: "2024-01-01T00:00:00Z",
  completedAt: "2024-01-01T01:00:00Z",
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
    datasetName: "Sample Dataset",
    fileName: "sample.zip",
    fileSize: 1024,
    uploadedAt: "2024-01-01T00:00:00Z",
    knowledgeBaseId: "kb1",
    summary: {
      documentCount: 2,
      sampleCount: 1,
      hasReferenceAnswers: true,
      hasGoldSources: true,
    },
    config: {
      mode: "retrieve-generate",
      topK: 5,
      topN: 3,
      repeat: 1,
      concurrency: 2,
      timeoutSeconds: 30,
    },
    documents: [],
    previewSamples: [],
    validations: [
      { id: "v1", label: "Check", status: "pass", detail: "OK" },
    ],
  },
  logs: [
    { id: "l1", timestamp: "2024-01-01T00:00:00Z", level: "info", text: "started" },
  ],
  sampleResults: [
    {
      id: "s1",
      question: "What is RAG?",
      goldSources: ["doc1"],
      matchedGoldSources: ["doc1"],
      retrievedSources: [],
      referenceAnswer: "Retrieval-Augmented Generation",
      answerText: "RAG is retrieval augmented generation.",
      status: "success",
      hit: true,
      recall: 1,
      latencyMs: 1200,
      sourceHit: true,
      faithfulness: 0.9,
      answerRelevance: 0.85,
      answerCompleteness: 0.8,
      attempts: [
        {
          attempt: 1,
          status: "success",
          latencyMs: 1200,
          hit: true,
          recall: 1,
          faithfulness: 0.9,
          answerRelevance: 0.85,
          answerCompleteness: 0.8,
          retrievedSources: [],
        },
      ],
    },
  ],
});

describe("buildEvaluationRunMarkdown", () => {
  it("includes run name and dataset info", async () => {
    const markdown = await buildEvaluationRunMarkdown(createRun());

    expect(markdown).toContain("Test Run");
    expect(markdown).toContain("Sample Dataset");
  });

  it("includes metric values formatted as percentages", async () => {
    const markdown = await buildEvaluationRunMarkdown(createRun());

    expect(markdown).toContain("Hit@K");
    expect(markdown).toContain("80%");
    expect(markdown).toContain("Faithfulness");
    expect(markdown).toContain("90%");
  });

  it("includes validation table", async () => {
    const markdown = await buildEvaluationRunMarkdown(createRun());

    expect(markdown).toContain("Check");
    expect(markdown).toContain("OK");
  });

  it("includes sample overview with question", async () => {
    const markdown = await buildEvaluationRunMarkdown(createRun());

    expect(markdown).toContain("What is RAG?");
    expect(markdown).toContain("RAG is retrieval augmented generation.");
  });

  it("includes log entries", async () => {
    const markdown = await buildEvaluationRunMarkdown(createRun());

    expect(markdown).toContain("started");
  });
});
