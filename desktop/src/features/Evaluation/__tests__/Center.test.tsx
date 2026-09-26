// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EvaluationCenter from "../Center";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/shared/i18n", () => ({
  getAppLanguage: () => "zh-CN",
}));

vi.mock("@/shared/api/evaluation", () => ({
  getEvaluationRuns: vi.fn(async () => []),
  deleteEvaluationRun: vi.fn(async () => ({ id: "", deleted: true })),
  deleteEvaluationRuns: vi.fn(async () => ({ deletedIds: [] })),
}));

vi.mock("@/shared/api/knowledgeBase", () => ({
  listKnowledgeBases: vi.fn(async () => []),
}));

vi.mock("@/shared/ui/Message", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/shared/ui/Modal", () => ({
  Modal: {
    confirm: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock("@/app/Layouts/AppPageLayout", () => ({
  default: ({
    children,
    containerClassName,
  }: {
    children: React.ReactNode;
    containerClassName?: string;
  }) => (
    <div data-testid="layout" data-container-class={containerClassName}>
      {children}
    </div>
  ),
}));

vi.mock("@/features/Evaluation/components/StatusBadge", () => ({
  default: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("@/features/Evaluation/components/DetailDrawer", () => ({
  default: () => <div data-testid="detail-drawer">DetailDrawer</div>,
}));

vi.mock("../exportMarkdown", () => ({
  downloadEvaluationRunMarkdown: vi.fn(async () => undefined),
}));

describe("EvaluationCenter", () => {
  it("uses the standard settings content width", async () => {
    render(<EvaluationCenter />);

    await waitFor(() => {
      expect(screen.getByTestId("layout")).not.toHaveAttribute(
        "data-container-class",
        "max-w-none",
      );
    });
  });

  it("renders empty state when no runs exist", async () => {
    render(<EvaluationCenter />);

    await waitFor(() => {
      expect(
        screen.getByText("settings.evaluation.center.empty"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("groups row actions in an overflow menu", async () => {
    const { getEvaluationRuns } = await import("@/shared/api/evaluation");
    vi.mocked(getEvaluationRuns).mockResolvedValueOnce([
      {
        id: "run-1",
        name: "running evaluation",
        status: "running",
        startedAt: "2026-07-27T08:00:00.000Z",
        dataset: {
          datasetName: "dataset",
          summary: { sampleCount: 1 },
        },
        metrics: { hitAtK: 0, faithfulness: 0 },
      },
    ] as never);

    const user = userEvent.setup();
    render(<EvaluationCenter />);

    await user.click(
      await screen.findByRole("button", {
        name: "common.actions.more: running evaluation",
      }),
    );

    expect(screen.getByRole("menuitem", { name: "common.actions.view" })).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "common.actions.download" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "common.actions.delete" })).toHaveAttribute(
      "data-disabled",
      "",
    );
  });
});
