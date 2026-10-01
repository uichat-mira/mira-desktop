// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import KnowledgeBaseToolbar from "../components/KnowledgeBaseToolbar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const defaultProps = {
  filter: "all" as const,
  selectedDocumentCount: 0,
  canDeleteKnowledgeBase: false,
  onDeleteKnowledgeBase: vi.fn(),
  onEditKnowledgeBase: vi.fn(),
  onOpenMetadata: vi.fn(),
  onOpenAddDocument: vi.fn(),
  onBatchDelete: vi.fn(),
  onFilterChange: vi.fn(),
  filterOptions: ["all", "enabled", "disabled"] as const,
};

describe("KnowledgeBaseToolbar", () => {
  it("renders filter options", () => {
    render(<KnowledgeBaseToolbar {...defaultProps} />);

    expect(
      screen.getByText("settings.knowledgeBase.filter.all"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.knowledgeBase.filter.enabled"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.knowledgeBase.filter.disabled"),
    ).toBeInTheDocument();
  });

  it("calls onFilterChange when filter clicked", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();

    render(
      <KnowledgeBaseToolbar {...defaultProps} onFilterChange={onFilterChange} />,
    );

    await user.click(
      screen.getByText("settings.knowledgeBase.filter.enabled"),
    );

    expect(onFilterChange).toHaveBeenCalledWith("enabled");
  });

  it("calls onEditKnowledgeBase", async () => {
    const user = userEvent.setup();
    const onEditKnowledgeBase = vi.fn();

    render(
      <KnowledgeBaseToolbar
        {...defaultProps}
        onEditKnowledgeBase={onEditKnowledgeBase}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.toolbar\.editKnowledgeBase/,
      }),
    );

    expect(onEditKnowledgeBase).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenMetadata", async () => {
    const user = userEvent.setup();
    const onOpenMetadata = vi.fn();

    render(
      <KnowledgeBaseToolbar
        {...defaultProps}
        onOpenMetadata={onOpenMetadata}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.toolbar\.metadata/,
      }),
    );

    expect(onOpenMetadata).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenAddDocument", async () => {
    const user = userEvent.setup();
    const onOpenAddDocument = vi.fn();

    render(
      <KnowledgeBaseToolbar
        {...defaultProps}
        onOpenAddDocument={onOpenAddDocument}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.toolbar\.addFile/,
      }),
    );

    expect(onOpenAddDocument).toHaveBeenCalledTimes(1);
  });

  it("batch delete button is disabled without selection", () => {
    render(<KnowledgeBaseToolbar {...defaultProps} />);

    expect(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.toolbar\.batchDelete/,
      }),
    ).toBeDisabled();
  });

  it("batch delete button shows count and calls onBatchDelete", async () => {
    const user = userEvent.setup();
    const onBatchDelete = vi.fn();

    render(
      <KnowledgeBaseToolbar
        {...defaultProps}
        selectedDocumentCount={3}
        onBatchDelete={onBatchDelete}
      />,
    );

    const button = screen.getByRole("button", {
      name: /settings\.knowledgeBase\.toolbar\.batchDelete/,
    });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("(3)");

    await user.click(button);
    expect(onBatchDelete).toHaveBeenCalledTimes(1);
  });

  it("delete knowledge base button respects permission", () => {
    const { rerender } = render(<KnowledgeBaseToolbar {...defaultProps} />);

    expect(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.toolbar\.deleteKnowledgeBase/,
      }),
    ).toBeDisabled();

    rerender(
      <KnowledgeBaseToolbar {...defaultProps} canDeleteKnowledgeBase />,
    );

    expect(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.toolbar\.deleteKnowledgeBase/,
      }),
    ).toBeEnabled();
  });

  it("calls onDeleteKnowledgeBase when allowed", async () => {
    const user = userEvent.setup();
    const onDeleteKnowledgeBase = vi.fn();

    render(
      <KnowledgeBaseToolbar
        {...defaultProps}
        canDeleteKnowledgeBase
        onDeleteKnowledgeBase={onDeleteKnowledgeBase}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.toolbar\.deleteKnowledgeBase/,
      }),
    );

    expect(onDeleteKnowledgeBase).toHaveBeenCalledTimes(1);
  });
});
