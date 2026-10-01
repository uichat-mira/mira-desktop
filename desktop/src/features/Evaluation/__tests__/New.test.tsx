// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EvaluationWorkbench from "../New";

const navigate = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({ createEvaluationRun: vi.fn(), getEvaluationRun: vi.fn(), parseEvaluationDataset: vi.fn() }));
const messages = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
const modal = vi.hoisted(() => ({ close: vi.fn(), show: vi.fn() }));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/evaluation/new" }),
  useNavigate: () => navigate,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }) }));
vi.mock("@/shared/i18n", () => ({ getAppLanguage: () => "en-US" }));
vi.mock("@/shared/api/evaluation", () => api);
vi.mock("@/shared/ui/Message", () => ({ message: messages }));
vi.mock("@/shared/ui/Modal", () => ({ Modal: modal }));

const dataset = {
  id: "dataset-1", datasetName: "Regression pack", fileName: "regression.zip", fileSize: 2048,
  uploadedAt: "2026-08-04T00:00:00.000Z", knowledgeBaseId: "kb-1",
  summary: { documentCount: 2, sampleCount: 3, hasReferenceAnswers: true, hasGoldSources: true },
  config: { mode: "retrieve-generate", topK: 5, topN: 3, repeat: 1, concurrency: 1, timeoutSeconds: 30 },
  documents: [], previewSamples: [], validations: [{ id: "manifest", label: "Manifest", detail: "Valid", status: "pass" }],
};
const completedRun = {
  id: "run-1", name: "Regression run", dataset, status: "completed",
  startedAt: "2026-08-04T00:00:01.000Z", completedAt: "2026-08-04T00:00:02.000Z",
  logs: [{ id: "log-1", timestamp: "00:00:01", text: "done" }], sampleResults: [],
  metrics: { hitAtK: 1, recallAtK: 1, mrr: 1, faithfulness: 1, answerRelevance: 1, answerCompleteness: 1, sourceHitRate: 1, averageLatencyMs: 100, failedCount: 0 },
};

describe("current Evaluation workbench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.parseEvaluationDataset.mockResolvedValue(dataset);
    api.createEvaluationRun.mockResolvedValue(completedRun);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  });

  it("starts empty, navigates back, and opens the package generator", async () => {
    const user = userEvent.setup();
    render(<EvaluationWorkbench />);
    expect(screen.getByRole("button", { name: "settings.evaluation.workbench.actions.startEvaluation" })).toBeDisabled();
    await user.click(screen.getAllByRole("button")[0]);
    expect(navigate).toHaveBeenCalledWith("/evaluation/center");
    await user.click(screen.getByRole("button", { name: "settings.evaluation.workbench.actions.generatePackage" }));
    expect(modal.show).toHaveBeenCalledWith(expect.objectContaining({ title: "settings.evaluation.packageGenerator.title", width: 820 }));
  });

  it("rejects non-zip files before calling the parser", () => {
    const { container } = render(<EvaluationWorkbench />);
    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["text"], "dataset.json")] } });
    expect(api.parseEvaluationDataset).not.toHaveBeenCalled();
    expect(messages.warning).toHaveBeenCalledWith("settings.evaluation.workbench.messages.uploadZip");
  });

  it("parses a valid package and creates an evaluation run", async () => {
    const user = userEvent.setup();
    const { container } = render(<EvaluationWorkbench />);
    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["zip"], "regression.zip", { type: "application/zip" });
    await user.upload(input, file);
    expect(await screen.findAllByText("Regression pack")).toHaveLength(2);
    expect(api.parseEvaluationDataset).toHaveBeenCalledWith(file);
    const start = screen.getByRole("button", { name: "settings.evaluation.workbench.actions.startEvaluation" });
    expect(start).toBeEnabled();
    await user.click(start);
    await waitFor(() => expect(api.createEvaluationRun).toHaveBeenCalledWith({ datasetId: "dataset-1" }));
    expect(await screen.findByText("done")).toBeInTheDocument();
    expect(messages.success).toHaveBeenCalledWith("settings.evaluation.workbench.messages.runCreated");
  });
});
