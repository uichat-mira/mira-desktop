// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import KnowledgeBaseSettings from "../pages";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

let embeddingConnected = true;

vi.mock("../hooks/useKnowledgeBase", () => ({
  useKnowledgeBase: () => ({
    knowledgeBase: {
      id: "kb1",
      name: "KB One",
      documentCount: 2,
      enabledDocumentCount: 1,
      totalChunkCount: 10,
      isSystem: false,
      metadata: { persona: "", scenario: "", tags: [] },
    },
    knowledgeBases: [{ id: "kb1", name: "KB One", isSystem: false }],
    documents: [],
    selectedDocumentIds: [],
    setSelectedDocumentIds: vi.fn(),
    filter: "all",
    setFilter: vi.fn(),
    searchText: "",
    setSearchText: vi.fn(),
    knowledgeBaseSearchText: "",
    setKnowledgeBaseSearchText: vi.fn(),
    sortBy: "updatedAt",
    sortOrder: "desc",
    togglingDocumentIds: [],
    loading: false,
    tableScrollRef: { current: null },
    modelAccessStatus: {
      embeddingConnected,
      llmConnected: true,
      rerankConnected: false,
    },
    selectedKnowledgeBaseId: "kb1",
    visibleDocuments: [],
    selectedDocumentCount: 0,
    canDeleteKnowledgeBase: true,
    filteredKnowledgeBases: [{ id: "kb1", name: "KB One", isSystem: false }],
    knowledgeBaseSelectOptions: [{ value: "kb1", label: "KB One" }],
    refreshAll: vi.fn(),
    handleSelectKnowledgeBase: vi.fn(),
    toggleSort: vi.fn(),
    handleToggleDocumentEnabled: vi.fn(),
    resetDocumentViewState: vi.fn(),
    setSearchParams: vi.fn(),
  }),
}));

vi.mock("@/app/Layouts/AppPageLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

vi.mock("@/app/Layouts/AppNotice", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="notice">{children}</div>
  ),
}));

vi.mock("../components/KnowledgeBaseSidebar", () => ({
  default: () => <div data-testid="sidebar">Sidebar</div>,
}));

vi.mock("../components/KnowledgeBaseToolbar", () => ({
  default: () => <div data-testid="toolbar">Toolbar</div>,
}));

vi.mock("../components/DocumentTable", () => ({
  default: () => <div data-testid="table">DocumentTable</div>,
}));

describe("KnowledgeBaseSettings page", () => {
  beforeEach(() => {
    embeddingConnected = true;
  });

  it("renders layout with sidebar, toolbar and table", () => {
    render(<KnowledgeBaseSettings />);

    expect(screen.getByTestId("layout")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("table")).toBeInTheDocument();
    expect(
      screen.getByText(
        'settings.knowledgeBase.table.summary:{"total":2,"visible":0}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'settings.knowledgeBase.table.stats:{"enabled":1,"chunks":10}',
      ),
    ).toBeInTheDocument();
  });

  it("shows notice when embedding is disconnected", () => {
    embeddingConnected = false;

    render(<KnowledgeBaseSettings />);

    expect(screen.getByTestId("notice")).toBeInTheDocument();
  });
});
