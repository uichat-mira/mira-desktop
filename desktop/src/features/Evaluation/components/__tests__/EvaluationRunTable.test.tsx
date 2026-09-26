// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EvaluationRunTable from "../EvaluationRunTable";
import type { EvaluationRunRecord } from "../../utils/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/shared/i18n", () => ({ getAppLanguage: () => "en-US" }));

const run: EvaluationRunRecord = {
  id: "run-1",
  name: "客服检索评测",
  status: "completed",
  startedAt: "2026-07-27T08:00:00.000Z",
  completedAt: "2026-07-27T08:05:00.000Z",
  dataset: {
    id: "dataset-1",
    datasetName: "客服数据集",
    fileName: "support.zip",
    fileSize: 1024,
    uploadedAt: "2026-07-27T07:00:00.000Z",
    knowledgeBaseId: "kb-1",
    summary: {
      documentCount: 2,
      sampleCount: 4,
      hasReferenceAnswers: true,
      hasGoldSources: true,
    },
    config: {
      mode: "retrieve",
      topK: 10,
      topN: 5,
      repeat: 1,
      concurrency: 1,
      timeoutSeconds: 300,
    },
    documents: [],
    previewSamples: [],
    validations: [],
  },
  metrics: {
    hitAtK: 0.75,
    recallAtK: 0.5,
    mrr: 0.4,
    faithfulness: 0.8,
    answerRelevance: 0.7,
    answerCompleteness: 0.6,
    sourceHitRate: 0.5,
    averageLatencyMs: 200,
    failedCount: 0,
  },
  logs: [],
  sampleResults: [],
};

describe("EvaluationRunTable", () => {
  it("renders run fields and dispatches row actions", async () => {
    const user = userEvent.setup();
    const onViewRun = vi.fn();
    const onDownloadRun = vi.fn();
    const onDeleteRun = vi.fn();
    const onSelectedRunIdsChange = vi.fn();

    render(
      <EvaluationRunTable
        data={[run]}
        knowledgeBaseNameById={{ "kb-1": "知识库" }}
        deletingRunId={null}
        selectedRunIds={[]}
        onSelectedRunIdsChange={onSelectedRunIdsChange}
        onViewRun={onViewRun}
        onDownloadRun={onDownloadRun}
        onDeleteRun={onDeleteRun}
      />,
    );

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("客服检索评测");
    expect(table).toHaveTextContent("客服数据集");
    expect(table).toHaveTextContent("75%");
    expect(table).toHaveTextContent("知识库");

    await user.click(screen.getByRole("button", { name: "common.actions.view" }));
    await user.click(screen.getByRole("button", { name: "common.actions.download" }));
    await user.click(screen.getByRole("button", { name: "common.actions.delete" }));

    expect(onViewRun).toHaveBeenCalledWith(run);
    expect(onDownloadRun).toHaveBeenCalledWith(run);
    expect(onDeleteRun).toHaveBeenCalledWith(run);
  });
});
