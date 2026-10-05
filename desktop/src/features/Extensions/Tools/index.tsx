import {
  Braces,
  FileInput,
  Eye,
  FileOutput,
  FileText,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
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
import type { ToolLabCaseDefinition, ToolLabTool } from "./types";
import ToolRunConsole from "./components/ToolRunConsole";
import AcceptanceToolsSidebar, {
  buildAcceptanceToolGroups,
  filterAcceptanceToolGroups,
  type ToolCatalogFilter,
} from "./components/AcceptanceToolsSidebar";
import { useToolLab } from "./hooks/useToolLab";
import {
  resolveToolLabReadiness,
  stringifyToolLabValue,
} from "./utils";

export default function ExtensionsToolsPage() {
  const { t } = useTranslation();
  const toolLab = useToolLab();
  const invocation = toolLab.runState.invocation;
  const invocationStatus = toolLab.runState.isRunning
    ? "running"
    : toolLab.runState.resolutionInvocation?.status ?? invocation?.status ?? "idle";
  const selectedTool = toolLab.selectedTool;
  const selectedCase = toolLab.selectedCase;
  const [catalogFilter, setCatalogFilter] = useState<ToolCatalogFilter>("all");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [detailTool, setDetailTool] = useState<ToolLabTool | null>(null);
  const [detailTab, setDetailTab] = useState<"input" | "output" | "capabilities">("input");
  const [detailCase, setDetailCase] = useState<ToolLabCaseDefinition | null>(null);
  const [resultConsoleOpen, setResultConsoleOpen] = useState(Boolean(invocation));
  const toolGroups = useMemo(
    () => buildAcceptanceToolGroups(toolLab.tools),
    [toolLab.tools],
  );
  const visibleGroups = useMemo(
    () => filterAcceptanceToolGroups(toolGroups, catalogFilter),
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

  const getToolReadiness = (tool: ToolLabTool) => {
    if (tool.runtimeReadiness?.state) return tool.runtimeReadiness.state;
    if (tool.capabilities?.workspaceBound && !toolLab.workspaceSelection?.rootPath) {
      return "unavailable" as const;
    }
    return "ready" as const;
  };

  const openToolDetails = (tool: ToolLabTool) => {
    setDetailTool(tool);
    setDetailTab("input");
  };

  const selectGroup = (groupId: string) => {
    if (toolLab.isSelectionLocked) return;
    const group = toolGroups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    setActiveGroupId(group.id);
    if (!selectedTool || !group.tools.some((tool) => tool.id === selectedTool.id)) {
      const firstTool = group.tools[0];
      if (firstTool) toolLab.selectTool(firstTool.id);
    }
  };

  const changeCatalogFilter = (nextFilter: string) => {
    if (toolLab.isSelectionLocked) return;
    const filter = nextFilter as ToolCatalogFilter;
    setCatalogFilter(filter);
    const nextGroups = filterAcceptanceToolGroups(toolGroups, filter);
    const keepCurrent = activeGroup && nextGroups.some((group) => group.id === activeGroup.id);
    if (keepCurrent) return;
    const nextGroup = nextGroups.find((group) =>
      group.tools.some((tool) => tool.id === selectedTool?.id),
    ) ?? nextGroups[0];
    setActiveGroupId(nextGroup?.id ?? null);
    const nextTool = nextGroup?.tools[0];
    if (nextTool && nextTool.id !== selectedTool?.id) {
      toolLab.selectTool(nextTool.id);
    }
  };

  if (toolLab.isLoading) {
    return (
      <AppPageLayout
        miniTitle={t("app.navigation.extensions")}
        title={t("app.navigation.tools")}
        contentClassName="pt-6"
      >
        <div className="flex h-full items-center justify-center text-sm text-text-secondary">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          {t("settings.development.toolLab.loading")}
        </div>
      </AppPageLayout>
    );
  }

  if (toolLab.loadError) {
    return (
      <AppPageLayout
        miniTitle={t("app.navigation.extensions")}
        title={t("app.navigation.tools")}
        contentClassName="pt-6"
      >
        <div className="h-full overflow-y-auto">
          <Alert
            variant="danger"
            title={t("settings.development.toolLab.loadFailed")}
            action={
              <Button size="sm" variant="secondary" onClick={() => void toolLab.refresh()}>
                <RefreshCw className="h-4 w-4" />
                {t("settings.development.toolLab.actions.refresh")}
              </Button>
            }
          >
            {toolLab.loadError}
          </Alert>
        </div>
      </AppPageLayout>
    );
  }

  return (
    <AppPageLayout
      miniTitle={t("app.navigation.extensions")}
      title={t("app.navigation.tools")}
      slot={
        <div className="w-32">
          <Select
            compact
            value={catalogFilter}
            onChange={changeCatalogFilter}
            options={[
              {
                value: "all",
                label: t("settings.development.toolLab.catalogFilter.all"),
              },
              {
                value: "extension",
                label: t("settings.development.toolLab.catalogFilter.extension"),
              },
            ]}
          />
        </div>
      }
      containerClassName="max-w-none"
      contentClassName="pt-6 !pb-0 !pr-0"
    >
      <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] gap-0 overflow-hidden">
        <AcceptanceToolsSidebar
          groups={visibleGroups}
          selectedGroupId={activeGroup?.id ?? null}
          onSelectGroup={selectGroup}
          emptyLabel={t("settings.development.toolLab.noCases")}
        />

        <main className="flex min-h-0 flex-col overflow-hidden">
        {selectedTool && selectedCase ? (
          <>
          <div className="stable-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pl-4 pr-5 sm:pr-6 xl:pr-8">
            {activeGroup ? (
              <div className="flex items-end gap-3">
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
                                `settings.development.toolLab.readiness.${readiness}`,
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
                    onChange={toolLab.selectTool}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openToolDetails(selectedTool)}
                >
                  {t("settings.development.toolLab.actions.details")}
                </Button>
              </div>
            ) : null}

            {toolLab.readiness.state === "unavailable" ? (
              <Alert
                variant="warning"
                title={t("settings.development.toolLab.unavailableTitle")}
              >
                {toolLab.readiness.reason}
              </Alert>
            ) : null}

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <FileText className="h-4 w-4" />
                {t("settings.development.toolLab.cases")}
              </div>

              <div className="flex flex-wrap items-start gap-3">
                {toolLab.toolCases.map((caseDefinition) => {
                  const caseReadiness = resolveToolLabReadiness({
                    caseDefinition,
                    tool: selectedTool,
                    workspaceRoot: toolLab.workspaceSelection?.rootPath ?? null,
                  });
                  const runningThisCase =
                    (toolLab.isPreparingCase || toolLab.runState.isRunning) &&
                    selectedCase.id === caseDefinition.id;

                  return (
                    <Card
                      key={caseDefinition.id}
                      interactive
                      padding="none"
                      className="h-[92px] w-[276px] max-w-full overflow-hidden"
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
                              {caseDefinition.group !== "Core" ? (
                                <span className="shrink-0 text-[10px] text-text-tertiary">
                                  {caseDefinition.group}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                          <IconButton
                            size="sm"
                            ariaLabel={t("settings.development.toolLab.actions.viewCase")}
                            onClick={() => setDetailCase(caseDefinition)}
                          >
                            <Eye className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            size="sm"
                            tone="primary"
                            ariaLabel={t("settings.development.toolLab.actions.run")}
                            disabled={
                              toolLab.isPreparingCase ||
                              toolLab.runState.isRunning ||
                              (toolLab.runState.invocation?.status ===
                                "awaiting_approval" &&
                                !toolLab.runState.invocation.approval?.resolution) ||
                              caseReadiness.state === "unavailable"
                            }
                            onClick={() => {
                              setResultConsoleOpen(true);
                              void toolLab.runCase(caseDefinition.id);
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

          </div>

          <ToolRunConsole
            open={resultConsoleOpen}
            onToggle={() => setResultConsoleOpen((open) => !open)}
            status={invocationStatus}
            runState={toolLab.runState}
            selectedTool={selectedTool}
            isResolvingApproval={toolLab.isResolvingApproval}
            onResolveApproval={toolLab.resolveApproval}
          />
          </>
        ) : (
          <Card variant="dashed" className="flex h-full min-h-64 items-center justify-center">
            <div className="max-w-md text-center">
              <Braces className="mx-auto h-6 w-6 text-text-tertiary" />
              <div className="mt-3 text-sm font-medium text-text-primary">
                {t("settings.development.toolLab.noCases")}
              </div>
              <div className="mt-1 text-sm text-text-secondary">
                {t("settings.development.toolLab.noCasesHint")}
              </div>
            </div>
          </Card>
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
              {detailCase.group !== "Core" ? (
                <div className="text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary">
                  {detailCase.group}
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
                {t("settings.development.toolLab.labels.purpose")}
              </div>
              <p className="mt-1 text-sm leading-6 text-text-primary">
                {detailCase.purpose}
              </p>
            </section>

            <section>
              <div className="text-xs font-medium text-text-tertiary">
                {t("settings.development.toolLab.labels.expected")}
              </div>
              <p className="mt-1 text-sm leading-6 text-text-secondary">
                {detailCase.expectedObservation}
              </p>
            </section>

            <section>
              <div className="mb-2 text-xs font-medium text-text-tertiary">
                {t("settings.development.toolLab.labels.fixedInput")}
              </div>
              <CodeBlock className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words">
                {stringifyToolLabValue(detailCase.args)}
              </CodeBlock>
              <div className="mt-2 text-xs leading-5 text-text-tertiary">
                {t("settings.development.toolLab.fixedInputHint")}
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
                {t("settings.development.toolLab.labels.description")}
              </div>
              <p className="mt-1 text-sm leading-6 text-text-primary">
                {detailTool.description}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-text-tertiary">Tool ID</div>
                <div className="mt-1 break-all text-sm text-text-primary">
                  {detailTool.id}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-text-tertiary">
                  {t("settings.development.toolLab.labels.source")}
                </div>
                <div className="mt-1 text-sm text-text-primary">
                  {detailTool.sourceInfo.label}
                </div>
              </div>
            </div>
            <NavigationCardTabs
              tabs={[
                {
                  value: "input",
                  label: t("settings.development.toolLab.detailTabs.input"),
                  icon: <FileInput className="h-4 w-4" />,
                },
                {
                  value: "output",
                  label: t("settings.development.toolLab.detailTabs.output"),
                  icon: <FileOutput className="h-4 w-4" />,
                },
                {
                  value: "capabilities",
                  label: t("settings.development.toolLab.detailTabs.capabilities"),
                  icon: <ShieldCheck className="h-4 w-4" />,
                },
              ]}
              value={detailTab}
              onChange={setDetailTab}
            />

            <CodeBlock className="min-h-0 flex-1 !overflow-auto whitespace-pre-wrap break-words">
              {stringifyToolLabValue(
                detailTab === "input"
                  ? detailTool.inputSchema
                  : detailTab === "output"
                    ? detailTool.outputSchema
                    : detailTool.capabilities,
              )}
            </CodeBlock>
          </div>
        ) : null}
      </ModalShell>
    </AppPageLayout>
  );
}
