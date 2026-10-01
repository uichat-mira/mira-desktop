import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getKnowledgeBaseById,
  listKnowledgeBases,
  listKnowledgeBaseDocuments,
  updateKnowledgeBaseDocument,
  type KnowledgeBaseDocument,
  type KnowledgeBaseSummary,
} from "@/shared/api/knowledgeBase";
import { useRoleModelConfigs } from "@/app/providers/RoleModelConfigProvider";
import { type FilterKey } from "../utils/mockData";

export type DocumentRow = {
  id: string;
  name: string;
  type: string;
  source: string;
  enabled: boolean;
  updatedAt: string;
  availability: "enabled" | "disabled";
  syncState: "ready" | "indexing";
  indexStatus: KnowledgeBaseDocument["indexStatus"];
};

export type DocumentSortKey = "name" | "source" | "updatedAt" | "status";
export type DocumentSortOrder = "asc" | "desc";

function toDocumentRow(document: KnowledgeBaseDocument): DocumentRow {
  return {
    id: document.id,
    name: document.name,
    type: document.fileExt,
    source: document.sourceLabel || document.sourceType,
    enabled: document.enabled,
    updatedAt: document.updatedAt.replace("T", " ").slice(5, 10),
    availability: document.enabled ? "enabled" : "disabled",
    syncState: document.indexStatus === "processing" ? "indexing" : "ready",
    indexStatus: document.indexStatus,
  };
}

export function useKnowledgeBase() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>(
    [],
  );
  const [knowledgeBase, setKnowledgeBase] =
    useState<KnowledgeBaseSummary | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [knowledgeBaseSearchText, setKnowledgeBaseSearchText] = useState("");
  const [sortBy, setSortBy] = useState<DocumentSortKey>("updatedAt");
  const [sortOrder, setSortOrder] = useState<DocumentSortOrder>("desc");
  const [togglingDocumentIds, setTogglingDocumentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const knowledgeBaseRequestIdRef = useRef(0);
  const documentsRequestIdRef = useRef(0);
  const { modelAccessStatus, refresh: refreshRoleModelConfigs } =
    useRoleModelConfigs();

  const selectedKnowledgeBaseId = useMemo(() => {
    const knowledgeBaseIdFromQuery = searchParams.get("knowledgeBaseId");
    if (
      knowledgeBaseIdFromQuery &&
      knowledgeBases.some((item) => item.id === knowledgeBaseIdFromQuery)
    ) {
      return knowledgeBaseIdFromQuery;
    }

    return knowledgeBases[0]?.id ?? null;
  }, [knowledgeBases, searchParams]);

  const loadKnowledgeBase = useCallback(async (id: string) => {
    const requestId = knowledgeBaseRequestIdRef.current + 1;
    knowledgeBaseRequestIdRef.current = requestId;
    const data = await getKnowledgeBaseById(id);

    if (requestId === knowledgeBaseRequestIdRef.current) {
      setKnowledgeBase(data);
    }
  }, []);

  const loadKnowledgeBases = useCallback(async () => {
    const data = await listKnowledgeBases();
    setKnowledgeBases(data);
    return data;
  }, []);

  const loadDocuments = useCallback(async () => {
    const requestId = documentsRequestIdRef.current + 1;
    documentsRequestIdRef.current = requestId;

    if (!selectedKnowledgeBaseId) {
      setDocuments([]);
      setSelectedDocumentIds([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const apiSortBy =
        sortBy === "updatedAt"
          ? "updatedAt"
          : sortBy === "name"
            ? "createdAt"
            : undefined;
      const data = await listKnowledgeBaseDocuments(selectedKnowledgeBaseId, {
        search: debouncedSearchText.trim() || undefined,
        enabled:
          filter === "enabled"
            ? true
            : filter === "disabled"
              ? false
              : undefined,
        sortBy: apiSortBy,
        sortOrder,
      });
      const rows = data.map(toDocumentRow);

      if (requestId !== documentsRequestIdRef.current) {
        return;
      }

      if (sortBy === "name") {
        rows.sort((left, right) =>
          sortOrder === "asc"
            ? left.name.localeCompare(right.name, "zh-CN")
            : right.name.localeCompare(left.name, "zh-CN"),
        );
      } else if (sortBy === "source") {
        rows.sort((left, right) =>
          sortOrder === "asc"
            ? left.source.localeCompare(right.source, "zh-CN")
            : right.source.localeCompare(left.source, "zh-CN"),
        );
      } else if (sortBy === "status") {
        rows.sort((left, right) =>
          sortOrder === "asc"
            ? left.indexStatus.localeCompare(right.indexStatus, "zh-CN")
            : right.indexStatus.localeCompare(left.indexStatus, "zh-CN"),
        );
      }

      setDocuments(rows);
      setSelectedDocumentIds((current) =>
        current.filter((id) => rows.some((row) => row.id === id)),
      );
    } finally {
      if (requestId === documentsRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [debouncedSearchText, filter, selectedKnowledgeBaseId, sortBy, sortOrder]);

  useEffect(() => {
    void loadKnowledgeBases();
  }, [loadKnowledgeBases]);

  useEffect(() => {
    if (!selectedKnowledgeBaseId) {
      return;
    }

    if (searchParams.get("knowledgeBaseId") === selectedKnowledgeBaseId) {
      return;
    }

    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("knowledgeBaseId", selectedKnowledgeBaseId);
        return next;
      },
      { replace: true },
    );
  }, [searchParams, selectedKnowledgeBaseId, setSearchParams]);

  useEffect(() => {
    if (!selectedKnowledgeBaseId) {
      knowledgeBaseRequestIdRef.current += 1;
      setKnowledgeBase(null);
      return;
    }

    void loadKnowledgeBase(selectedKnowledgeBaseId);
  }, [loadKnowledgeBase, selectedKnowledgeBaseId]);

  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [selectedKnowledgeBaseId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [searchText]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const refreshAll = useCallback(async () => {
    const nextKnowledgeBases = await loadKnowledgeBases();
    if (
      selectedKnowledgeBaseId &&
      !nextKnowledgeBases.some((item) => item.id === selectedKnowledgeBaseId)
    ) {
      const nextKnowledgeBaseId = nextKnowledgeBases[0]?.id;
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextKnowledgeBaseId) {
            next.set("knowledgeBaseId", nextKnowledgeBaseId);
          } else {
            next.delete("knowledgeBaseId");
          }
          return next;
        },
        { replace: true },
      );
      return;
    }

    await Promise.all([
      loadDocuments(),
      refreshRoleModelConfigs(),
      selectedKnowledgeBaseId
        ? loadKnowledgeBase(selectedKnowledgeBaseId)
        : Promise.resolve(),
    ]);
  }, [
    loadKnowledgeBase,
    loadDocuments,
    loadKnowledgeBases,
    refreshRoleModelConfigs,
    selectedKnowledgeBaseId,
    setSearchParams,
  ]);

  const resetDocumentViewState = useCallback(() => {
    setFilter("all");
    setSearchText("");
    setDebouncedSearchText("");
    setSelectedDocumentIds([]);
    setSortBy("updatedAt");
    setSortOrder("desc");
  }, []);

  const handleSelectKnowledgeBase = useCallback(
    (id: string) => {
      if (id === selectedKnowledgeBaseId) {
        return;
      }

      resetDocumentViewState();
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("knowledgeBaseId", id);
          return next;
        },
        { replace: true },
      );
    },
    [resetDocumentViewState, selectedKnowledgeBaseId, setSearchParams],
  );

  const toggleSort = useCallback((nextSortBy: DocumentSortKey) => {
    setSortBy((currentSortBy) => {
      if (currentSortBy === nextSortBy) {
        setSortOrder((currentOrder) =>
          currentOrder === "asc" ? "desc" : "asc",
        );
        return currentSortBy;
      }

      setSortOrder(nextSortBy === "updatedAt" ? "desc" : "asc");
      return nextSortBy;
    });
  }, []);

  const handleToggleDocumentEnabled = useCallback(
    async (document: DocumentRow) => {
      try {
        setTogglingDocumentIds((current) => [...current, document.id]);
        if (!selectedKnowledgeBaseId) {
          throw new Error(t("settings.knowledgeBase.messages.kbNotFound"));
        }
        await updateKnowledgeBaseDocument(
          selectedKnowledgeBaseId,
          document.id,
          {
            enabled: !document.enabled,
          },
        );
        return true;
      } catch {
        return false;
      } finally {
        setTogglingDocumentIds((current) =>
          current.filter((id) => id !== document.id),
        );
      }
    },
    [selectedKnowledgeBaseId],
  );

  const visibleDocuments = useMemo(() => documents, [documents]);
  const selectedDocumentCount = selectedDocumentIds.length;
  const canDeleteKnowledgeBase = !knowledgeBase?.isSystem;
  const filteredKnowledgeBases = useMemo(() => {
    const keyword = knowledgeBaseSearchText.trim().toLowerCase();
    if (!keyword) {
      return knowledgeBases;
    }

    return knowledgeBases.filter((item) =>
      item.name.toLowerCase().includes(keyword),
    );
  }, [knowledgeBaseSearchText, knowledgeBases]);
  const knowledgeBaseSelectOptions = useMemo(
    () =>
      knowledgeBases.map((item) => ({
        value: item.id,
        label: item.name,
      })),
    [knowledgeBases],
  );

  return {
    knowledgeBases,
    setKnowledgeBases,
    knowledgeBase,
    setKnowledgeBase,
    documents,
    setDocuments,
    selectedDocumentIds,
    setSelectedDocumentIds,
    filter,
    setFilter,
    searchText,
    setSearchText,
    debouncedSearchText,
    setDebouncedSearchText,
    knowledgeBaseSearchText,
    setKnowledgeBaseSearchText,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    togglingDocumentIds,
    setTogglingDocumentIds,
    loading,
    setLoading,
    tableScrollRef,
    modelAccessStatus,
    refreshRoleModelConfigs,
    selectedKnowledgeBaseId,
    visibleDocuments,
    selectedDocumentCount,
    canDeleteKnowledgeBase,
    filteredKnowledgeBases,
    knowledgeBaseSelectOptions,
    searchParams,
    setSearchParams,
    loadKnowledgeBases,
    loadKnowledgeBase,
    loadDocuments,
    refreshAll,
    handleSelectKnowledgeBase,
    resetDocumentViewState,
    toggleSort,
    handleToggleDocumentEnabled,
  };
}
