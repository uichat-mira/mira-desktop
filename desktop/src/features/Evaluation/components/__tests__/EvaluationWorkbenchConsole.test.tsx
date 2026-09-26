// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EvaluationWorkbenchConsole from "../EvaluationWorkbenchConsole";
import type {
  EvaluationJobStatus,
  EvaluationRunRecord,
  ParsedDataset,
} from "../../utils/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/shared/i18n", () => ({ getAppLanguage: () => "en-US" }));

const dataset: ParsedDataset = {
  id: "dataset-1",
  datasetName: "客服数据集",
  fileName: "support.zip",
  fileSize: 1024,
  uploadedAt: "2026-07-27T07:00:00.000Z",
  summary: {
    documentCount: 2,
    sampleCount: 1,
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
  validations: [{ id: "valid", label: "结构检查", status: "pass", detail: "通过" }],
};

const runRecord: EvaluationRunRecord = {
  id: "run-1",
  name: "客服检索评测",
  status: "completed",
  startedAt: "2026-07-27T08:00:00.000Z",
  completedAt: "2026-07-27T08:05:00.000Z",
  dataset,
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
  logs: [{ id: "log-1", timestamp: "08:01", level: "info", text: "开始评测" }],
  sampleResults: [
    {
      id: "sample-1",
      question: "如何退款？",
      goldSources: [],
      matchedGoldSources: [],
      retrievedSources: [],
      answerText: "请联系客服。",
      referenceAnswer: "联系客服处理。",
      status: "success",
      hit: true,
      recall: 1,
      latencyMs: 1500,
      sourceHit: true,
      faithfulness: 0.9,
      answerRelevance: 0.8,
      answerCompleteness: 0.7,
      attempts: [],
    },
  ],
};

const renderConsole = (
  overrides: Partial<React.ComponentProps<typeof EvaluationWorkbenchConsole>> = {},
) =>
  render(
    <EvaluationWorkbenchConsole
      consoleTab="log"
      onConsoleTabChange={vi.fn()}
      dataset={dataset}
      runRecord={runRecord}
      status={"queued" as EvaluationJobStatus}
      progressWidth={42}
      savedRunId="run-1"
      logScrollRef={{ current: null }}
      resultScrollRef={{ current: null }}
      {...overrides}
    />,
  );

describe("EvaluationWorkbenchConsole", () => {
  it("renders logs, validation output, progress, and queued state", () => {
    renderConsole();

    expect(screen.getByText("load support.zip")).toBeInTheDocument();
    expect(screen.getByText("pass").parentElement).toHaveTextContent("结构检查 :: pass");
    expect(screen.getByText("evaluation queued...")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("开始评测")).toBeInTheDocument();
  });

  it("switches to result output and shows sample summaries", () => {
    const onConsoleTabChange = vi.fn();
    renderConsole({ consoleTab: "result", onConsoleTabChange });

    expect(screen.getByText("客服检索评测")).toBeInTheDocument();
    expect(screen.getByText("如何退款？")).toBeInTheDocument();
    expect(screen.getByText("settings.evaluation.workbench.console.success")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.evaluation.workbench.console.log",
      }),
    );
    expect(onConsoleTabChange).toHaveBeenCalledWith("log");
  });

  it("shows empty result state when no run exists", () => {
    renderConsole({ consoleTab: "result", runRecord: null, savedRunId: null });

    expect(
      screen.getByText("settings.evaluation.workbench.console.emptyResultTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.evaluation.workbench.console.emptyResultDescription"),
    ).toBeInTheDocument();
  });
});
