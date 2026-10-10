import {
  Braces,
  FileInput,
  Eye,
  FileOutput,
  FileText,
  Info,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Settings2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import Alert from "@/shared/ui/Alert";
import { Button, IconButton } from "@/shared/ui/Button";
import Card from "@/shared/ui/Card";
import Drawer from "@/shared/ui/Drawer";
import CodeBlock from "@/shared/ui/CodeBlock";
import { ModalShell } from "@/shared/ui/Modal";
import NavigationCardTabs from "@/shared/ui/NavigationCardTabs";
import Select from "@/shared/ui/Select";
import type { CapabilityAcceptanceCase, CapabilityTool } from "./types";
import ToolRunConsole from "./components/ToolRunConsole";
import CapabilitiesSidebar, {
  buildCapabilityGroups,
  filterCapabilityGroups,
  type CapabilityGroupFilter,
} from "./components/CapabilitiesSidebar";
import { useCapabilities } from "./hooks/useCapabilities";
import WebSearchConfigPanel from "@/features/Settings/components/WebSearchConfigPanel";
import { useWebSearchConfig } from "@/features/Settings/hooks/useWebSearchConfig";
import {
  resolveCapabilityReadiness,
  resolveToolReadiness,
  stringifyCapabilityValue,
} from "./utils";

export default function CapabilitiesPage() {
  const { t } = useTranslation();
  const capabilities = useCapabilities();
  const invocation = capabilities.runState.invocation;
  const invocationStatus = capabilities.runState.isRunning
    ? "running"
    : capabilities.runState.resolutionInvocation?.status ?? invocation?.status ?? "idle";
  const selectedTool = capabilities.selectedTool;
  const selectedCase = capabilities.selectedCase;
  const [catalogFilter, setCatalogFilter] = useState<CapabilityGroupFilter>("all");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [detailTool, setDetailTool] = useState<CapabilityTool | null>(null);
  const [detailTab, setDetailTab] = useState<
    "input" | "output" | "capabilities" | "config"
  >("input");
  const webSearchConfig = useWebSearchConfig(detailTool?.id === "web_search");
  const [detailCase, setDetailCase] = useState<CapabilityAcceptanceCase | null>(null);
  const [resultConsoleOpen, setResultConsoleOpen] = useState(Boolean(invocation));
  const toolGroups = useMemo(
    () => buildCapabilityGroups(capabilities.tools, t),
    [capabilities.tools, t],
  );
  const visibleGroups = useMemo(
    () => filterCapabilityGroups(toolGroups, catalogFilter),
    [catalogFilter, toolGroups],
  );
  const selectedToolGroup = toolGroups.find((group) =>
    group.tools.some((tool) => tool.id === selectedTool?.id),
  );
  const activeGroup =
    visibleGroups.find((group) => group.id === activeGroupId) ??
    (selectedToolGroup && visibleGroups.some((group) => group.id === selectedToolGroup.id)
      ? selectedToolGroup
      : visibleGroups[0] ?? null);
  const activeGroupTools = activeGroup?.tools ?? [];
  const hasVisibleSelection = Boolean(
    activeGroup &&
      selectedTool &&
      selectedCase &&
      activeGroup.tools.some((tool) => tool.id === selectedTool.id),
  );

  const getToolReadiness = (tool: CapabilityTool) => {
    const runtimeReadiness = resolveToolReadiness(tool);
    if (runtimeReadiness !== "ready") return runtimeReadiness;
    if (tool.capabilities?.workspaceBound && !capabilities.workspaceSelection?.rootPath) {
      return "unavailable" as const;
    }
    return "ready" as const;
  };

  const openToolDetails = (tool: CapabilityTool) => {
    setDetailTool(tool);
    setDetailTab("input");
  };

  const selectGroup = (groupId: string) => {
    if (capabilities.isSelectionLocked) return;
    const group = toolGroups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    setActiveGroupId(group.id);
    if (!selectedTool || !group.tools.some((tool) => tool.id === selectedTool.id)) {
      const firstTool = group.tools[0];
      if (firstTool) capabilities.selectTool(firstTool.id);
    }
  };

  const changeCatalogFilter = (nextFilter: string) => {
    if (capabilities.isSelectionLocked) return;
    const filter = nextFilter as CapabilityGroupFilter;
    setCatalogFilter(filter);
    const nextGroups = filterCapabilityGroups(toolGroups, filter);
    const keepCurrent = activeGroup && nextGroups.some((group) => group.id === activeGroup.id);
    if (keepCurrent) return;
    const nextGroup = nextGroups.find((group) =>
      group.tools.some((tool) => tool.id === selectedTool?.id),
    ) ?? nextGroups[0];
    setActiveGroupId(nextGroup?.id ?? null);
    const nextTool = nextGroup?.tools[0];
    if (nextTool && nextTool.id !== selectedTool?.id) {
      capabilities.selectTool(nextTool.id);
    }
  };

  if (capabilities.isLoading) {
    return (
      <AppPageLayout
        miniTitle={t("app.navigation.extensions")}
        title={t("app.navigation.capabilities")}
        contentClassName="pt-6"
      >
        <div className="flex h-full items-center justify-center text-sm text-text-secondary">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          {t("settings.development.capabilities.loading")}
        </div>
      </AppPageLayout>
    );
  }

  if (capabilities.loadError) {
    return (
      <AppPageLayout
        miniTitle={t("app.navigation.extensions")}
        title={t("app.navigation.capabilities")}
        contentClassName="pt-6"
      >
        <div className="h-full overflow-y-auto">
          <Alert
            variant="danger"
            title={t("settings.development.capabilities.loadFailed")}
            action={
              <Button size="sm" variant="secondary" onClick={() => void capabilities.refresh()}>
                <RefreshCw className="h-4 w-4" />
                {t("settings.development.capabilities.actions.refresh")}
              </Button>
            }
          >
            {capabilities.loadError}
          </Alert>
        </div>
      </AppPageLayout>
    );
  }

  return (
    <AppPageLayout
      miniTitle={t("app.navigation.extensions")}
      title={t("app.navigation.capabilities")}
      slot={
        <div className="w-32">
          <Select
            compact
            value={catalogFilter}
            onChange={changeCatalogFilter}
            options={[
              {
                value: "all",
                label: t("settings.development.capabilities.catalogFilter.all"),
              },
              {
                value: "native",
                label: t("settings.development.capabilities.catalogFilter.native"),
              },
              {
                value: "extension",
                label: t("settings.development.capabilities.catalogFilter.extension"),
              },
            ]}
          />
        </div>
      }
      containerClassName="max-w-none"
      contentClassName="pt-6 !pb-0 !pr-0"
    >
      <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] gap-0 overflow-hidden">
        <CapabilitiesSidebar
          groups={visibleGroups}
          selectedGroupId={activeGroup?.id ?? null}
          onSelectGroup={selectGroup}
          emptyLabel={t("settings.development.capabilities.noMatchingTools")}
        />

        <main className="flex min-h-0 flex-col overflow-hidden">
        {hasVisibleSelection && selectedTool && selectedCase ? (
          <>
          <div className="stable-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pl-4 pr-5 sm:pr-6 xl:pr-8">
            {activeGroup ? (
              <div className="sticky top-0 z-20 flex items-end gap-3 bg-surface-primary py-1">
                <div className="min-w-0 flex-1">
                  <NavigationCardTabs
                    tabs={activeGroupTools.map((tool) => {
                      const readiness = getToolReadiness(tool);
                      return {
                        value: tool.id,
                        label: (
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <span
                              aria-label={t(
                                `settings.development.capabilities.readiness.${readiness}`,
                              )}
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                readiness === "ready"
                                  ? "bg-success"
                                  : readiness === "degraded"
                                    ? "bg-warning"
                                    : "bg-danger"
                              }`}
                            />
                            <span className="truncate">{tool.title}</span>
                          </span>
                        ),
                      };
                    })}
                    value={selectedTool.id}
                    onChange={capabilities.selectTool}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("settings.development.capabilities.actions.toolDetails")}
                  title={t("settings.development.capabilities.actions.toolDetails")}
                  className="shrink-0 px-2 sm:px-3"
                  onClick={() => openToolDetails(selectedTool)}
                >
                  <Info className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {t("settings.development.capabilities.actions.toolDetails")}
                  </span>
                </Button>
              </div>
            ) : null}

            {capabilities.readiness.state === "unavailable" ? (
              <Alert
                variant="warning"
                title={t("settings.development.capabilities.unavailableTitle")}
              >
                {capabilities.readiness.reason}
              </Alert>
            ) : null}

            <section className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {capabilities.toolCases.map((caseDefinition) => {
                  const caseReadiness = resolveCapabilityReadiness({
                    caseDefinition,
                    tool: selectedTool,
                    workspaceRoot: capabilities.workspaceSelection?.rootPath ?? null,
                  });
                  const runningThisCase =
                    (capabilities.isPreparingCase || capabilities.runState.isRunning) &&
                    selectedCase.id === caseDefinition.id;

                  return (
                    <Card
                      key={caseDefinition.id}
                      interactive
                      padding="none"
                      className="h-[92px] w-full min-w-0 max-w-full overflow-hidden"
                    >
                      <div className="flex h-full flex-col gap-2 p-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-surface-secondary text-icon-secondary">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <h3 className="truncate text-sm font-semibold text-text-primary">
                                {caseDefinition.title}
                              </h3>
                              {caseDefinition.group !== "Native" ? (
                                <span className="shrink-0 text-[10px] text-text-tertiary">
                                  {caseDefinition.group === "External MCP"
                                    ? t("settings.development.capabilities.caseGroups.extension")
                                    : caseDefinition.group}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                          <IconButton
                            size="sm"
                            ariaLabel={t("settings.development.capabilities.actions.viewCase")}
                            onClick={() => setDetailCase(caseDefinition)}
                          >
                            <Eye className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            size="sm"
                            tone="primary"
                            ariaLabel={t("settings.development.capabilities.actions.run")}
                            disabled={
                              capabilities.isPreparingCase ||
                              capabilities.runState.isRunning ||
                              (capabilities.runState.invocation?.status ===
                                "awaiting_approval" &&
                                !capabilities.runState.invocation.approval?.resolution) ||
                              caseReadiness.state === "unavailable"
                            }
                            onClick={() => {
                              setResultConsoleOpen(true);
                              void capabilities.runCase(caseDefinition.id);
                            }}
                          >
                            {runningThisCase ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </IconButton>
                          </div>
                        </div>
                        <p className="truncate text-xs leading-5 text-text-secondary">
                          {caseDefinition.purpose}
                        </p>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>

            {selectedTool.id === "terminal" && capabilities.terminalSessionId ? (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-ui-control border border-border bg-surface-secondary px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-text-secondary">
                  <span>session :: {capabilities.terminalSessionId}</span>
                  {capabilities.terminalSummary?.state ? (
                    <span>state :: {capabilities.terminalSummary.state}</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      capabilities.isSelectionLocked ||
                      !capabilities.terminalContinuation ||
                      capabilities.terminalSummary?.continuationAvailable === false
                    }
                    onClick={() => {
                      setResultConsoleOpen(true);
                      void capabilities.runTerminalContinuation();
                    }}
                  >
                    {t("settings.development.capabilities.actions.continueOutput")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      capabilities.isSelectionLocked ||
                      capabilities.terminalSummary?.state === "cancelled"
                    }
                    onClick={() => {
                      setResultConsoleOpen(true);
                      void capabilities.runTerminalStatus();
                    }}
                  >
                    {t("settings.development.capabilities.actions.inspectStatus")}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-outline"
                    disabled={
                      capabilities.isSelectionLocked ||
                      capabilities.terminalSummary?.state === "cancelled"
                    }
                    onClick={() => {
                      setResultConsoleOpen(true);
                      void capabilities.runTerminalStop();
                    }}
                  >
                    {t("settings.development.capabilities.actions.stopTerminal")}
                  </Button>
                </div>
              </section>
            ) : null}

          </div>

          <ToolRunConsole
            open={resultConsoleOpen}
            onToggle={() => setResultConsoleOpen((open) => !open)}
            status={invocationStatus}
            runState={capabilities.runState}
            selectedTool={selectedTool}
            isResolvingApproval={capabilities.isResolvingApproval}
            onResolveApproval={capabilities.resolveApproval}
          />
          </>
        ) : (
          <div className="flex h-full min-h-64 items-center justify-center">
            <div className="max-w-md text-center text-text-secondary">
              <Braces className="mx-auto h-6 w-6 text-text-tertiary" />
              <div className="mt-3 text-sm font-medium text-text-secondary">
                {t("settings.development.capabilities.noCases")}
              </div>
              <div className="mt-1 text-sm text-text-tertiary">
                {t("settings.development.capabilities.noCasesHint")}
              </div>
            </div>
          </div>
        )}
      </main>
      </div>

      <Drawer
        open={Boolean(detailCase)}
        onClose={() => setDetailCase(null)}
        width={560}
        closeLabel={t("common.actions.close")}
        header={
          detailCase ? (
            <div className="space-y-1">
              {detailCase.group !== "Native" ? (
                <div className="text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary">
                  {detailCase.group === "External MCP"
                    ? t("settings.development.capabilities.caseGroups.extension")
                    : detailCase.group}
                </div>
              ) : null}
              <div className="text-base font-semibold text-text-primary">
                {detailCase.title}
              </div>
            </div>
          ) : null
        }
        bodyClassName="space-y-5"
      >
        {detailCase ? (
          <>
            <section>
              <div className="text-xs font-medium text-text-tertiary">
                {t("settings.development.capabilities.labels.purpose")}
              </div>
              <p className="mt-1 text-sm leading-6 text-text-primary">
                {detailCase.purpose}
              </p>
            </section>

            <section>
              <div className="text-xs font-medium text-text-tertiary">
                {t("settings.development.capabilities.labels.expected")}
              </div>
              <p className="mt-1 text-sm leading-6 text-text-secondary">
                {detailCase.expectedObservation}
              </p>
            </section>

            <section>
              <div className="mb-2 text-xs font-medium text-text-tertiary">
                {t("settings.development.capabilities.labels.fixedInput")}
              </div>
              <CodeBlock className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words">
                {stringifyCapabilityValue(detailCase.args)}
              </CodeBlock>
              <div className="mt-2 text-xs leading-5 text-text-tertiary">
                {t("settings.development.capabilities.fixedInputHint")}
              </div>
            </section>
          </>
        ) : null}
      </Drawer>

      <ModalShell
        open={Boolean(detailTool)}
        title={detailTool?.title}
        width={820}
        height={680}
        bodyClassName="!overflow-hidden"
        footer={null}
        onClose={() => setDetailTool(null)}
      >
        {detailTool ? (
          <div className="flex h-full min-h-0 flex-col gap-4">
            <div>
              <div className="text-xs font-medium text-text-tertiary">
                {t("settings.development.capabilities.labels.description")}
              </div>
              <p className="mt-1 text-sm leading-6 text-text-primary">
                {detailTool.description}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-text-tertiary">{t("settings.development.capabilities.labels.toolId")}</div>
                <div className="mt-1 break-all text-sm text-text-primary">
                  {detailTool.id}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-text-tertiary">
                  {t("settings.development.capabilities.labels.source")}
                </div>
                <div className="mt-1 text-sm text-text-primary">
                  {detailTool.sourceInfo.kind === "native"
                    ? t("settings.development.capabilities.catalogKind.native")
                    : `${t("settings.development.capabilities.catalogKind.extension")} · ${detailTool.sourceLabel ?? detailTool.sourceInfo.label}`}
                </div>
              </div>
            </div>
            <NavigationCardTabs
              tabs={[
                {
                  value: "input",
                  label: t("settings.development.capabilities.detailTabs.input"),
                  icon: <FileInput className="h-4 w-4" />,
                },
                {
                  value: "output",
                  label: t("settings.development.capabilities.detailTabs.output"),
                  icon: <FileOutput className="h-4 w-4" />,
                },
                {
                  value: "capabilities",
                  label: t("settings.development.capabilities.detailTabs.capabilities"),
                  icon: <ShieldCheck className="h-4 w-4" />,
                },
                ...(detailTool.id === "web_search"
                  ? [{
                      value: "config" as const,
                      label: t("settings.development.capabilities.detailTabs.config"),
                      icon: <Settings2 className="h-4 w-4" />,
                    }]
                  : []),
              ]}
              value={detailTab}
              onChange={setDetailTab}
            />

            {detailTab === "config" && detailTool.id === "web_search" ? (
              <WebSearchConfigPanel
                config={webSearchConfig.config}
                isLoading={webSearchConfig.isLoading}
                isSaving={webSearchConfig.isSaving}
                onChange={(update) => webSearchConfig.setConfig(update)}
                onSave={webSearchConfig.save}
              />
            ) : (
              <CodeBlock className="min-h-0 flex-1 !overflow-auto whitespace-pre-wrap break-words">
                {stringifyCapabilityValue(
                  detailTab === "input"
                    ? detailTool.inputSchema
                    : detailTab === "output"
                      ? detailTool.outputSchema
                      : detailTool.capabilities,
                )}
              </CodeBlock>
            )}
          </div>
        ) : null}
      </ModalShell>
    </AppPageLayout>
  );
}
