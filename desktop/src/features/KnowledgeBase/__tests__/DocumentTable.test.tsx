// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import DocumentTable from "../components/DocumentTable";

vi.mock("react-i18next", () => {
  const t = (key: string) => key;

  return {
    useTranslation: () => ({ t }),
  };
});

const documents = [
  {
    id: "d1",
    name: "intro.md",
    type: "md",
    updatedAt: new Date().toISOString(),
    availability: "enabled" as const,
    syncState: "ready" as const,
    indexStatus: "ready" as const,
    enabled: true,
    source: "upload",
    charCount: 100,
    hits: 5,
    uploadedAt: new Date().toISOString(),
  },
  {
    id: "d2",
    name: "guide.txt",
    type: "txt",
    updatedAt: new Date().toISOString(),
    availability: "disabled" as const,
    syncState: "ready" as const,
    indexStatus: "ready" as const,
    enabled: false,
    source: "upload",
    charCount: 200,
    hits: 0,
    uploadedAt: new Date().toISOString(),
  },
];

const defaultProps = {
  data: documents,
  selectedRowIds: [] as string[],
  onSelectedRowIdsChange: vi.fn(),
  sortBy: "updatedAt" as const,
  sortOrder: "desc" as const,
  onToggleSort: vi.fn(),
  togglingDocumentIds: [] as string[],
  onToggleDocumentEnabled: vi.fn(),
  onRebuildIndex: vi.fn(),
  onDeleteDocument: vi.fn(),
  onGoToDetail: vi.fn(),
  emptyState: "No documents",
  selectedKnowledgeBaseId: "kb1",
  tableScrollRef: createRef<HTMLDivElement>(),
};

describe("DocumentTable", () => {
  it("renders document rows", () => {
    render(<DocumentTable {...defaultProps} />);

    expect(screen.getByText("intro.md")).toBeInTheDocument();
    expect(screen.getByText("guide.txt")).toBeInTheDocument();
  });

  it("renders empty state", () => {
    render(<DocumentTable {...defaultProps} data={[]} />);

    expect(screen.getByText("No documents")).toBeInTheDocument();
  });

  it("calls onToggleSort when header clicked", async () => {
    const user = userEvent.setup();
    const onToggleSort = vi.fn();

    render(<DocumentTable {...defaultProps} onToggleSort={onToggleSort} />);

    await user.click(screen.getByText("settings.knowledgeBase.table.name"));

    expect(onToggleSort).toHaveBeenCalledWith("name");
  });

  it("calls onGoToDetail on row double click", async () => {
    const user = userEvent.setup();
    const onGoToDetail = vi.fn();

    render(<DocumentTable {...defaultProps} onGoToDetail={onGoToDetail} />);

    await user.dblClick(screen.getByText("intro.md"));

    expect(onGoToDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1" }),
    );
  });

  it("opens document detail when the file name is clicked", async () => {
    const user = userEvent.setup();
    const onGoToDetail = vi.fn();

    render(<DocumentTable {...defaultProps} onGoToDetail={onGoToDetail} />);

    await user.click(screen.getByRole("button", { name: "intro.md" }));

    expect(onGoToDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1" }),
    );
  });

  it("fixes the name column at 30% and delegates overflow text to Tooltip", () => {
    render(<DocumentTable {...defaultProps} />);

    const nameHeader = screen
      .getByText("settings.knowledgeBase.table.name")
      .closest("th");
    const nameButton = screen.getByRole("button", { name: "intro.md" });

    expect(nameHeader).toHaveStyle({
      width: "30%",
      minWidth: "30%",
      maxWidth: "30%",
    });
    expect(nameButton).toHaveClass("text-ellipsis");
    expect(nameButton).not.toHaveAttribute("title");
  });

  it("shows an index failure before the enabled state", () => {
    render(
      <DocumentTable
        {...defaultProps}
        data={[
          {
            ...documents[0],
            indexStatus: "failed" as const,
            enabled: true,
          },
        ]}
      />,
    );

    expect(
      screen.getByText("settings.knowledgeBase.status.failed"),
    ).toHaveClass("text-danger-text");
    expect(
      screen.queryByText("settings.knowledgeBase.status.enabled"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("uses switches as the normal availability status", () => {
    render(<DocumentTable {...defaultProps} />);

    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(documents.length);
    expect(switches[0]).toBeChecked();
    expect(switches[1]).not.toBeChecked();
    expect(
      screen.queryByText("settings.knowledgeBase.status.enabled"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("settings.knowledgeBase.status.disabled"),
    ).not.toBeInTheDocument();
  });

  it("calls onToggleDocumentEnabled when switch clicked", async () => {
    const user = userEvent.setup();
    const onToggleDocumentEnabled = vi.fn();

    render(
      <DocumentTable
        {...defaultProps}
        onToggleDocumentEnabled={onToggleDocumentEnabled}
      />,
    );

    const switches = screen.getAllByRole("switch");
    await user.click(switches[0]);

    expect(onToggleDocumentEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1" }),
    );
  });

  it("opens action menu and calls onRebuildIndex", async () => {
    const user = userEvent.setup();
    const onRebuildIndex = vi.fn();

    const { rerender } = render(
      <DocumentTable
        {...defaultProps}
        onRebuildIndex={onRebuildIndex}
      />,
    );

    const menuButtons = screen.getAllByLabelText(
      /settings\.knowledgeBase\.filters\.moreActionsAria/,
    );
    await user.click(menuButtons[0]);

    expect(screen.getAllByRole("menu")).toHaveLength(1);

    rerender(
      <DocumentTable
        {...defaultProps}
        onRebuildIndex={onRebuildIndex}
      />,
    );

    expect(screen.getAllByRole("menu")).toHaveLength(1);

    const rebuildButton = await screen.findByRole("menuitem", {
      name: "settings.knowledgeBase.actions.rebuildIndex",
    });
    await user.click(rebuildButton);

    expect(onRebuildIndex).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1" }),
    );
  });

  it("calls onDeleteDocument from action menu", async () => {
    const user = userEvent.setup();
    const onDeleteDocument = vi.fn();

    render(
      <DocumentTable
        {...defaultProps}
        onDeleteDocument={onDeleteDocument}
      />,
    );

    const menuButtons = screen.getAllByLabelText(
      /settings\.knowledgeBase\.filters\.moreActionsAria/,
    );
    await user.click(menuButtons[0]);
    await user.click(
      await screen.findByRole("menuitem", { name: "common.actions.delete" }),
    );

    expect(onDeleteDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1" }),
    );
  });

  it("disables switch while toggling", () => {
    render(<DocumentTable {...defaultProps} togglingDocumentIds={["d1"]} />);

    const switches = screen.getAllByRole("switch");
    expect(switches[0]).toBeDisabled();
  });
});
