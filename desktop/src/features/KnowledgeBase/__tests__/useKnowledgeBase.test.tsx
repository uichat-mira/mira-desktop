// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

let currentParams = new URLSearchParams();
const setSearchParams = vi.fn((updater) => {
  const next =
    typeof updater === "function"
      ? updater(currentParams)
      : new URLSearchParams(updater);
  currentParams = next;
});

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [currentParams, setSearchParams],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockKnowledgeBases = [
  { id: "kb1", name: "KB One", isSystem: false },
  { id: "kb2", name: "KB Two", isSystem: true },
];

const mockDocuments = [
  {
    id: "d1",
    name: "doc1.md",
    fileExt: "md",
    sourceType: "upload",
    sourceLabel: "Upload",
    indexStatus: "ready",
    enabled: true,
    updatedAt: "2024-01-01T10:00:00Z",
  },
  {
    id: "d2",
    name: "doc2.txt",
    fileExt: "txt",
    sourceType: "upload",
    sourceLabel: "Upload",
    indexStatus: "processing",
    enabled: false,
    updatedAt: "2024-01-02T10:00:00Z",
  },
];

const listKnowledgeBases = vi.fn();
const getKnowledgeBaseById = vi.fn();
const listKnowledgeBaseDocuments = vi.fn();
const updateKnowledgeBaseDocument = vi.fn();

vi.mock("@/shared/api/knowledgeBase", () => ({
  listKnowledgeBases: () => listKnowledgeBases(),
  getKnowledgeBaseById: (id: string) => getKnowledgeBaseById(id),
  listKnowledgeBaseDocuments: (id: string, params: unknown) =>
    listKnowledgeBaseDocuments(id, params),
  updateKnowledgeBaseDocument: (kbId: string, docId: string, data: unknown) =>
    updateKnowledgeBaseDocument(kbId, docId, data),
}));

vi.mock("@/app/providers/RoleModelConfigProvider", () => ({
  useRoleModelConfigs: () => ({
    modelAccessStatus: {
      embeddingConnected: true,
      llmConnected: true,
      rerankConnected: false,
    },
    refresh: vi.fn(),
  }),
}));

async function importHook() {
  const { useKnowledgeBase } = await import("../hooks/useKnowledgeBase");
  return useKnowledgeBase;
}

describe("useKnowledgeBase", () => {
  beforeEach(() => {
    currentParams = new URLSearchParams();
    setSearchParams.mockClear();
    listKnowledgeBases.mockReset();
    getKnowledgeBaseById.mockReset();
    listKnowledgeBaseDocuments.mockReset();
    updateKnowledgeBaseDocument.mockReset();
  });

  it("loads knowledge bases and selects the first one by default", async () => {
    listKnowledgeBases.mockResolvedValue(mockKnowledgeBases);
    getKnowledgeBaseById.mockResolvedValue(mockKnowledgeBases[0]);
    listKnowledgeBaseDocuments.mockResolvedValue(mockDocuments);

    const useKnowledgeBase = await importHook();
    const { result } = renderHook(() => useKnowledgeBase());

    await waitFor(() => {
      expect(result.current.knowledgeBases).toHaveLength(2);
    });

    expect(result.current.selectedKnowledgeBaseId).toBe("kb1");
    expect(result.current.loading).toBe(false);
  });

  it("filters documents by enabled/disabled", async () => {
    listKnowledgeBases.mockResolvedValue(mockKnowledgeBases);
    getKnowledgeBaseById.mockResolvedValue(mockKnowledgeBases[0]);
    listKnowledgeBaseDocuments.mockResolvedValue(mockDocuments);

    const useKnowledgeBase = await importHook();
    const { result } = renderHook(() => useKnowledgeBase());

    await waitFor(() => {
      expect(result.current.documents).toHaveLength(2);
    });

    act(() => {
      result.current.setFilter("enabled");
    });

    await waitFor(() => {
      expect(listKnowledgeBaseDocuments).toHaveBeenCalledWith(
        "kb1",
        expect.objectContaining({ enabled: true }),
      );
    });
  });

  it("toggles sort", async () => {
    listKnowledgeBases.mockResolvedValue(mockKnowledgeBases);
    getKnowledgeBaseById.mockResolvedValue(mockKnowledgeBases[0]);
    listKnowledgeBaseDocuments.mockResolvedValue(mockDocuments);

    const useKnowledgeBase = await importHook();
    const { result } = renderHook(() => useKnowledgeBase());

    await waitFor(() => {
      expect(result.current.documents).toHaveLength(2);
    });

    await act(async () => {
      result.current.toggleSort("name");
    });

    expect(result.current.sortBy).toBe("name");

    await act(async () => {
      result.current.toggleSort("name");
    });

    expect(result.current.sortOrder).toBe("desc");
  });

  it("toggles document enabled state", async () => {
    listKnowledgeBases.mockResolvedValue(mockKnowledgeBases);
    getKnowledgeBaseById.mockResolvedValue(mockKnowledgeBases[0]);
    listKnowledgeBaseDocuments.mockResolvedValue(mockDocuments);
    updateKnowledgeBaseDocument.mockResolvedValue({});

    const useKnowledgeBase = await importHook();
    const { result } = renderHook(() => useKnowledgeBase());

    await waitFor(() => {
      expect(result.current.documents).toHaveLength(2);
    });

    const success = await act(async () => {
      return result.current.handleToggleDocumentEnabled(
        result.current.documents[0],
      );
    });

    expect(success).toBe(true);
    expect(updateKnowledgeBaseDocument).toHaveBeenCalledWith(
      "kb1",
      "d1",
      expect.objectContaining({ enabled: false }),
    );
  });

  it("filters knowledge base list by search text", async () => {
    listKnowledgeBases.mockResolvedValue(mockKnowledgeBases);
    getKnowledgeBaseById.mockResolvedValue(mockKnowledgeBases[0]);
    listKnowledgeBaseDocuments.mockResolvedValue(mockDocuments);

    const useKnowledgeBase = await importHook();
    const { result } = renderHook(() => useKnowledgeBase());

    await waitFor(() => {
      expect(result.current.knowledgeBases).toHaveLength(2);
    });

    act(() => {
      result.current.setKnowledgeBaseSearchText("Two");
    });

    expect(result.current.filteredKnowledgeBases).toHaveLength(1);
    expect(result.current.filteredKnowledgeBases[0].id).toBe("kb2");
  });
});
