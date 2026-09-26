import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import { message } from "@/shared/ui/Message";
import { Modal } from "@/shared/ui/Modal";
import { Select } from "@/shared/ui/Select";
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeBaseDocument,
  updateKnowledgeBase,
} from "@/shared/api/knowledgeBase";
import { filterOptions } from "../utils/mockData";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import AppNotice from "@/app/Layouts/AppNotice";
import KnowledgeBaseEditorForm from "../components/KnowledgeBaseEditorForm";
import KnowledgeBaseMetadataContent from "../components/KnowledgeBaseMetadataContent";
import KnowledgeBaseSidebar from "../components/KnowledgeBaseSidebar";
import KnowledgeBaseToolbar from "../components/KnowledgeBaseToolbar";
import DocumentTable from "../components/DocumentTable";
import { useKnowledgeBase } from "../hooks/useKnowledgeBase";

export default function KnowledgeBaseSettings() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const routeBase = "/knowledge-base";
  const kb = useKnowledgeBase();

  const {
    knowledgeBase,
    knowledgeBases,
    documents,
    selectedDocumentIds,
    setSelectedDocumentIds,
    filter,
    setFilter,
    searchText,
    setSearchText,
    knowledgeBaseSearchText,
    setKnowledgeBaseSearchText,
    sortBy,
    sortOrder,
    togglingDocumentIds,
    loading,
    tableScrollRef,
    modelAccessStatus,
    selectedKnowledgeBaseId,
    visibleDocuments,
    selectedDocumentCount,
    canDeleteKnowledgeBase,
    filteredKnowledgeBases,
    knowledgeBaseSelectOptions,
    refreshAll,
    handleSelectKnowledgeBase,
    toggleSort,
    handleToggleDocumentEnabled,
    resetDocumentViewState,
    setSearchParams,
  } = kb;

  const onToggleDocumentEnabled = useCallback(
    async (document: (typeof documents)[number]) => {
      const success = await handleToggleDocumentEnabled(document);
      if (success) {
        message.success(
          document.enabled
            ? t("settings.knowledgeBase.messages.toggleDisabled")
            : t("settings.knowledgeBase.messages.toggleEnabled"),
        );
        await refreshAll();
      } else {
        message.error(t("settings.knowledgeBase.messages.toggleFailed"));
      }
    },
    [documents, handleToggleDocumentEnabled, refreshAll, t],
  );

  const openMetadataModal = () => {
    Modal.show({
      title: t("settings.knowledgeBase.metadataModal.title"),
      width: 720,
      content: (
        <KnowledgeBaseMetadataContent
          metadata={knowledgeBase?.metadata ?? null}
          documentCount={
            knowledgeBase?.documentCount ?? visibleDocuments.length
          }
          enabledDocumentCount={knowledgeBase?.enabledDocumentCount ?? 0}
          totalChunks={knowledgeBase?.totalChunkCount ?? 0}
        />
      ),
    });
  };

  const confirmRebuildIndex = (document: (typeof documents)[number]) => {
    Modal.confirm({
      title: t("settings.knowledgeBase.rebuildModal.title"),
      description: `${t("settings.knowledgeBase.rebuildModal.description", {
        name: document.name,
      })} ${t("settings.knowledgeBase.rebuildModal.warning")}`,
      width: 440,
      tone: "warning",
      confirmText: t("settings.knowledgeBase.actions.confirmRebuild"),
      onConfirm: async () => {
        message.info(
          t("settings.knowledgeBase.messages.rebuildPending", {
            name: document.name,
          }),
        );
      },
    });
  };

  const confirmDeleteDocument = (document: (typeof documents)[number]) => {
    Modal.confirm({
      title: t("settings.knowledgeBase.actions.deleteDocument"),
      description: `${t("settings.knowledgeBase.deleteModal.description", {
        name: document.name,
      })} ${t("settings.knowledgeBase.deleteModal.warning")}`,
      width: 440,
      tone: "danger",
      confirmText: t("settings.knowledgeBase.actions.confirmDelete"),
      onConfirm: async () => {
        try {
          if (selectedKnowledgeBaseId) {
            await deleteKnowledgeBaseDocument(
              selectedKnowledgeBaseId,
              document.id,
            );
          } else {
            await deleteKnowledgeBaseDocument(document.id);
          }
          message.success(
            t("settings.knowledgeBase.messages.deleted", {
              name: document.name,
            }),
          );
          await refreshAll();
        } catch (error) {
          throw new Error(
            error instanceof Error
              ? error.message
              : t("settings.knowledgeBase.messages.deleteFailed"),
          );
        }
      },
    });
  };

  const confirmBatchDeleteDocuments = () => {
    if (!selectedKnowledgeBaseId || selectedDocumentIds.length === 0) {
      return;
    }

    Modal.confirm({
      title: t("settings.knowledgeBase.messages.batchDeleteTitle"),
      description: t("settings.knowledgeBase.messages.batchDeleteDescription", {
        count: selectedDocumentIds.length,
      }),
      width: 440,
      tone: "danger",
      confirmText: t("settings.knowledgeBase.actions.confirmDelete"),
      onConfirm: async () => {
        try {
          const count = selectedDocumentIds.length;
          await Promise.all(
            selectedDocumentIds.map((id) =>
              deleteKnowledgeBaseDocument(selectedKnowledgeBaseId, id),
            ),
          );
          setSelectedDocumentIds([]);
          message.success(
            t("settings.knowledgeBase.messages.batchDeleteSuccess", { count }),
          );
          await refreshAll();
        } catch (error) {
          throw new Error(
            error instanceof Error
              ? error.message
              : t("settings.knowledgeBase.messages.deleteFailed"),
          );
        }
      },
    });
  };

  const goToDetail = (document: (typeof documents)[number]) => {
    const params = new URLSearchParams({
      id: document.id,
    });
    if (selectedKnowledgeBaseId) {
      params.set("knowledgeBaseId", selectedKnowledgeBaseId);
    }

    navigate(`${routeBase}/detail?${params.toString()}`);
  };

  const openAddDocument = () => {
    if (!modelAccessStatus?.embeddingConnected) {
      message.warning(
        t("settings.knowledgeBase.messages.uploadRequiresEmbedding"),
      );
      return;
    }

    const params = new URLSearchParams({ step: "1" });
    if (selectedKnowledgeBaseId) {
      params.set("knowledgeBaseId", selectedKnowledgeBaseId);
    }
    navigate(`${routeBase}/add?${params.toString()}`);
  };

  const handleCreateKnowledgeBase = () => {
    const modalKey = Modal.show({
      title: t("settings.knowledgeBase.editor.titleCreate"),
      width: 420,
      content: (
        <KnowledgeBaseEditorForm
          title={t("settings.knowledgeBase.editor.titleCreate")}
          confirmLabel={t("settings.knowledgeBase.editor.create")}
          onCancel={() => Modal.close(modalKey)}
          onSubmit={async ({ name, description, persona, scenario, tags }) => {
            const trimmedName = name.trim();
            if (!trimmedName) {
              message.warning(
                t("settings.knowledgeBase.messages.nameRequired"),
              );
              return;
            }

            try {
              const created = await createKnowledgeBase({
                name: trimmedName,
                description: description.trim() || null,
                metadata: {
                  persona: persona.trim() || null,
                  scenario: scenario.trim() || null,
                  tags: tags
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                },
              });
              Modal.close(modalKey);
              await kb.loadKnowledgeBases();
              kb.setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.set("knowledgeBaseId", created.id);
                  return next;
                },
                { replace: true },
              );
              message.success(
                t("settings.knowledgeBase.messages.createSuccess"),
              );
            } catch (error) {
              message.error(
                error instanceof Error
                  ? error.message
                  : t("settings.knowledgeBase.messages.createFailed"),
              );
            }
          }}
        />
      ),
      footer: null,
    });
  };

  const handleEditKnowledgeBase = () => {
    if (!knowledgeBase) {
      return;
    }

    const modalKey = Modal.show({
      title: t("settings.knowledgeBase.editor.titleEdit"),
      width: 480,
      content: (
        <KnowledgeBaseEditorForm
          title={t("settings.knowledgeBase.editor.titleEdit")}
          confirmLabel={t("settings.knowledgeBase.editor.save")}
          initialName={knowledgeBase.name}
          initialDescription={knowledgeBase.description ?? ""}
          initialPersona={knowledgeBase.metadata.persona ?? ""}
          initialScenario={knowledgeBase.metadata.scenario ?? ""}
          initialTags={knowledgeBase.metadata.tags.join(", ")}
          onCancel={() => Modal.close(modalKey)}
          onSubmit={async ({ name, description, persona, scenario, tags }) => {
            const trimmedName = name.trim();
            if (!trimmedName) {
              message.warning(
                t("settings.knowledgeBase.messages.nameRequired"),
              );
              return;
            }

            try {
              await updateKnowledgeBase(knowledgeBase.id, {
                name: trimmedName,
                description: description.trim() || null,
                metadata: {
                  persona: persona.trim() || null,
                  scenario: scenario.trim() || null,
                  tags: tags
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                },
              });
              Modal.close(modalKey);
              await Promise.all([
                kb.loadKnowledgeBases(),
                kb.loadKnowledgeBase(knowledgeBase.id),
              ]);
              message.success(
                t("settings.knowledgeBase.messages.updateSuccess"),
              );
            } catch (error) {
              message.error(
                error instanceof Error
                  ? error.message
                  : t("settings.knowledgeBase.messages.updateFailed"),
              );
            }
          }}
        />
      ),
      footer: null,
    });
  };

  const handleDeleteKnowledgeBase = () => {
    if (!knowledgeBase) {
      return;
    }
    if (knowledgeBase.isSystem) {
      message.warning(t("settings.knowledgeBase.messages.deleteKbSystem"));
      return;
    }

    Modal.confirm({
      title: t("settings.knowledgeBase.messages.deleteKbTitle"),
      description: t("settings.knowledgeBase.messages.deleteKbDescription", {
        name: knowledgeBase.name,
      }),
      width: 440,
      tone: "danger",
      confirmText: t("settings.knowledgeBase.actions.confirmDelete"),
      onConfirm: async () => {
        try {
          const nextSelectedKnowledgeBaseId =
            knowledgeBases.find((item) => item.id !== knowledgeBase.id)?.id ??
            null;
          await deleteKnowledgeBase(knowledgeBase.id);
          resetDocumentViewState();
          await kb.loadKnowledgeBases();
          kb.setSearchParams(
            (current) => {
              const next = new URLSearchParams(current);
              if (nextSelectedKnowledgeBaseId) {
                next.set("knowledgeBaseId", nextSelectedKnowledgeBaseId);
              } else {
                next.delete("knowledgeBaseId");
              }
              return next;
            },
            { replace: true },
          );
          kb.setKnowledgeBase(null);
          message.success(t("settings.knowledgeBase.messages.deleteKbSuccess"));
        } catch (error) {
          throw new Error(
            error instanceof Error
              ? error.message
              : t("settings.knowledgeBase.messages.deleteKbFailed"),
          );
        }
      },
    });
  };

  return (
    <AppPageLayout
      miniTitle={t("settings.knowledgeBase.page.miniTitle")}
      title={t("settings.knowledgeBase.page.title")}
      slot={
        <div className="w-[200px] lg:hidden">
          <Select
            value={selectedKnowledgeBaseId ?? ""}
            onChange={handleSelectKnowledgeBase}
            options={knowledgeBaseSelectOptions}
            compact
          />
        </div>
      }
      bodyClassName="overflow-hidden"
      contentClassName="flex h-full min-h-0 flex-col gap-3 pt-4"
      scrollBody={false}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 border-0 bg-transparent p-0 shadow-none">
        {modelAccessStatus && !modelAccessStatus.embeddingConnected ? (
          <AppNotice
            tone="danger"
            icon={<AlertCircle className="h-4 w-4" />}
          >
            <div className="font-medium">
              {t("settings.knowledgeBase.banner")}
            </div>
          </AppNotice>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="hidden min-h-0 lg:flex lg:h-full lg:flex-col">
            <KnowledgeBaseSidebar
              searchText={knowledgeBaseSearchText}
              onSearchTextChange={setKnowledgeBaseSearchText}
              onCreate={handleCreateKnowledgeBase}
              knowledgeBases={filteredKnowledgeBases}
              selectedKnowledgeBaseId={selectedKnowledgeBaseId}
              onSelectKnowledgeBase={handleSelectKnowledgeBase}
              loading={loading && knowledgeBases.length === 0}
            />
          </div>
          <section className="flex min-h-0 flex-col gap-3">
            <KnowledgeBaseToolbar
              filter={filter}
              selectedDocumentCount={selectedDocumentCount}
              canDeleteKnowledgeBase={canDeleteKnowledgeBase}
              onDeleteKnowledgeBase={handleDeleteKnowledgeBase}
              onEditKnowledgeBase={handleEditKnowledgeBase}
              onOpenMetadata={openMetadataModal}
              onOpenAddDocument={openAddDocument}
              onBatchDelete={confirmBatchDeleteDocuments}
              onFilterChange={setFilter}
              filterOptions={filterOptions}
              loading={loading && !knowledgeBase}
            />

            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface-primary">
              <div className="flex h-full min-h-0 flex-col">
                <DocumentTable
                  data={loading ? [] : visibleDocuments}
                  selectedRowIds={selectedDocumentIds}
                  onSelectedRowIdsChange={setSelectedDocumentIds}
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggleSort={toggleSort}
                  togglingDocumentIds={togglingDocumentIds}
                  onToggleDocumentEnabled={onToggleDocumentEnabled}
                  onRebuildIndex={confirmRebuildIndex}
                  onDeleteDocument={confirmDeleteDocument}
                  onGoToDetail={goToDetail}
                  emptyState={t("settings.knowledgeBase.table.empty")}
                  selectedKnowledgeBaseId={selectedKnowledgeBaseId}
                  tableScrollRef={tableScrollRef}
                  loading={loading}
                />

                <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-1.5 text-xs text-text-secondary">
                  <div>
                    {t("settings.knowledgeBase.table.summary", {
                      total:
                        knowledgeBase?.documentCount ?? visibleDocuments.length,
                      visible: visibleDocuments.length,
                    })}
                  </div>
                  <div>
                    {t("settings.knowledgeBase.table.stats", {
                      enabled:
                        knowledgeBase?.enabledDocumentCount ??
                        visibleDocuments.filter((document) => document.enabled)
                          .length,
                      chunks: knowledgeBase?.totalChunkCount ?? 0,
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppPageLayout>
  );
}
