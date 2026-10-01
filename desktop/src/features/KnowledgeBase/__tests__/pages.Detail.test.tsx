// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import KnowledgeBaseDetail from "../pages/Detail";

const navigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/knowledge-base/detail" }),
  useNavigate: () => navigate,
  useSearchParams: () => [
    new URLSearchParams({ id: "d1", knowledgeBaseId: "kb1" }),
  ],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, data?: Record<string, unknown>) => key,
  }),
}));

const mockDocument = {
  id: "d1",
  name: "intro.md",
  fileExt: "md",
  sourceType: "upload",
  sourceLabel: "Upload",
  indexStatus: "ready",
  enabled: true,
  charCount: 1234,
  chunkCount: 10,
  fileSize: 5678,
  createdAt: "2024-01-01T10:00:00Z",
  updatedAt: "2024-01-02T12:00:00Z",
  chunks: [
    {
      id: "c1",
      chunkIndex: 0,
      content: "First chunk content",
    },
  ],
};

const getKnowledgeBaseDocument = vi.fn();

vi.mock("@/shared/api/knowledgeBase", () => ({
  getKnowledgeBaseDocument: (...args: unknown[]) =>
    getKnowledgeBaseDocument(...args),
}));

describe("KnowledgeBaseDetail page", () => {
  it("shows loading state", () => {
    getKnowledgeBaseDocument.mockImplementation(() => new Promise(() => {}));

    const { container } = render(<KnowledgeBaseDetail />);

    expect(
      container.querySelectorAll('[aria-hidden="true"]').length,
    ).toBeGreaterThan(0);
  });

  it("shows not found when documentId is missing", async () => {
    vi.resetModules();
    vi.doMock("react-router-dom", () => ({
      useLocation: () => ({ pathname: "/knowledge-base/detail" }),
      useNavigate: () => navigate,
      useSearchParams: () => [new URLSearchParams()],
    }));

    const { default: Page } = await import("../pages/Detail");
    render(<Page />);

    expect(
      screen.getByText("settings.knowledgeBase.detail.notFoundTitle"),
    ).toBeInTheDocument();

    vi.doUnmock("react-router-dom");
  });

  it("shows not found when API fails", async () => {
    getKnowledgeBaseDocument.mockRejectedValue(new Error("not found"));

    render(<KnowledgeBaseDetail />);

    await waitFor(() => {
      expect(
        screen.getByText("settings.knowledgeBase.detail.notFoundTitle"),
      ).toBeInTheDocument();
    });
  });

  it("renders document details after loading", async () => {
    getKnowledgeBaseDocument.mockResolvedValue(mockDocument);

    render(<KnowledgeBaseDetail />);

    await waitFor(() => {
      expect(screen.getByText("intro.md")).toBeInTheDocument();
    });

    expect(screen.getAllByText("MD").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1.2k")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("5.7k")).toBeInTheDocument();
  });

  it("navigates back to knowledge base", async () => {
    const user = userEvent.setup();
    getKnowledgeBaseDocument.mockResolvedValue(mockDocument);

    render(<KnowledgeBaseDetail />);

    await waitFor(() => {
      expect(screen.getByText("intro.md")).toBeInTheDocument();
    });

    await user.click(
      screen.getByText("settings.knowledgeBase.actions.backToKnowledgeBase"),
    );

    expect(navigate).toHaveBeenCalledWith(
      "/knowledge-base?knowledgeBaseId=kb1",
    );
  });

  it("renders preview chunks", async () => {
    getKnowledgeBaseDocument.mockResolvedValue(mockDocument);

    render(<KnowledgeBaseDetail />);

    await waitFor(() => {
      expect(screen.getByText("First chunk content")).toBeInTheDocument();
    });
  });

  it("shows no chunks placeholder", async () => {
    getKnowledgeBaseDocument.mockResolvedValue({ ...mockDocument, chunks: [] });

    render(<KnowledgeBaseDetail />);

    await waitFor(() => {
      expect(
        screen.getByText("settings.knowledgeBase.detail.noChunks"),
      ).toBeInTheDocument();
    });
  });
});
