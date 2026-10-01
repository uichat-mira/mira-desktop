// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import KnowledgeBaseSidebar from "../components/KnowledgeBaseSidebar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, data?: Record<string, unknown>) => key }),
}));

const knowledgeBases = [
  {
    id: "kb1",
    name: "Product Docs",
    documentCount: 12,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "kb2",
    name: "User Manual",
    documentCount: 5,
    updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
];

const defaultProps = {
  searchText: "",
  onSearchTextChange: vi.fn(),
  onCreate: vi.fn(),
  knowledgeBases,
  selectedKnowledgeBaseId: null as string | null,
  onSelectKnowledgeBase: vi.fn(),
};

describe("KnowledgeBaseSidebar", () => {
  it("renders search input and create button", () => {
    render(<KnowledgeBaseSidebar {...defaultProps} />);

    expect(
      screen.getByPlaceholderText("settings.knowledgeBase.sidebar.searchPlaceholder"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "" }),
    ).toBeInTheDocument();
  });

  it("calls onSearchTextChange when search input changes", () => {
    const onSearchTextChange = vi.fn();

    render(
      <KnowledgeBaseSidebar
        {...defaultProps}
        onSearchTextChange={onSearchTextChange}
      />,
    );

    const input = screen.getByPlaceholderText(
      "settings.knowledgeBase.sidebar.searchPlaceholder",
    );
    fireEvent.change(input, { target: { value: "Product" } });

    expect(onSearchTextChange).toHaveBeenCalledWith("Product");
  });

  it("calls onCreate when create button clicked", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(<KnowledgeBaseSidebar {...defaultProps} onCreate={onCreate} />);

    await user.click(screen.getByRole("button", { name: "" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("renders knowledge base list with document counts", () => {
    render(<KnowledgeBaseSidebar {...defaultProps} />);

    expect(screen.getByText("Product Docs")).toBeInTheDocument();
    expect(screen.getByText("User Manual")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("marks selected knowledge base as active", () => {
    render(
      <KnowledgeBaseSidebar
        {...defaultProps}
        selectedKnowledgeBaseId="kb1"
      />,
    );

    const activeButton = screen.getByText("Product Docs").closest("button");
    expect(activeButton).toHaveClass("bg-surface-soft");
  });

  it("calls onSelectKnowledgeBase when item clicked", async () => {
    const user = userEvent.setup();
    const onSelectKnowledgeBase = vi.fn();

    render(
      <KnowledgeBaseSidebar
        {...defaultProps}
        onSelectKnowledgeBase={onSelectKnowledgeBase}
      />,
    );

    await user.click(screen.getByText("User Manual"));

    expect(onSelectKnowledgeBase).toHaveBeenCalledWith("kb2");
  });

  it("shows just now for recent updates", () => {
    render(<KnowledgeBaseSidebar {...defaultProps} />);

    expect(
      screen.getByText("settings.knowledgeBase.sidebar.updatedJustNow"),
    ).toBeInTheDocument();
  });

  it("shows minutes ago label", () => {
    const items = [
      {
        ...knowledgeBases[0],
        updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      },
    ];

    render(<KnowledgeBaseSidebar {...defaultProps} knowledgeBases={items} />);

    expect(
      screen.getByText("settings.knowledgeBase.sidebar.updatedMinutesAgo"),
    ).toBeInTheDocument();
  });

  it("shows hours ago label", () => {
    const items = [
      {
        ...knowledgeBases[0],
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      },
    ];

    render(<KnowledgeBaseSidebar {...defaultProps} knowledgeBases={items} />);

    expect(
      screen.getByText("settings.knowledgeBase.sidebar.updatedHoursAgo"),
    ).toBeInTheDocument();
  });

  it("shows days ago label", () => {
    const items = [
      {
        ...knowledgeBases[0],
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      },
    ];

    render(<KnowledgeBaseSidebar {...defaultProps} knowledgeBases={items} />);

    expect(
      screen.getByText("settings.knowledgeBase.sidebar.updatedDaysAgo"),
    ).toBeInTheDocument();
  });
});
