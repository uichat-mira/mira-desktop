import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { NumberInput, TextArea, TextInput } from "@/shared/ui/Input";
import SettingsPageLayout from "../../components/SettingsPageLayout";
import ToolsPackagePanel from "./components/ToolsPackagePanel";
import ToolsSidebar from "./components/ToolsSidebar";
import ToolsTracePanel from "./components/ToolsTracePanel";
import ToolsWorkbenchPanel from "./components/ToolsWorkbenchPanel";
import { useToolsWorkbench } from "./hooks/useToolsWorkbench";
import type { ToolWorkbenchHandoff } from "./types";

const getToolWorkbenchHandoff = (state: unknown): ToolWorkbenchHandoff | null => {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }

  const value = (state as { toolLabHandoff?: unknown }).toolLabHandoff;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const handoff = value as Record<string, unknown>;
  if (
    typeof handoff.toolId !== "string" ||
    !handoff.args ||
    typeof handoff.args !== "object" ||
    Array.isArray(handoff.args)
  ) {
    return null;
  }

  return {
    toolId: handoff.toolId,
    args: handoff.args as Record<string, unknown>,
  };
};

export default function ToolsSettings() {
  const { t } = useTranslation();
  const location = useLocation();
  const workbench = useToolsWorkbench(getToolWorkbenchHandoff(location.state));
  const [isArgsModalOpen, setIsArgsModalOpen] = useState(false);

  return (
    <SettingsPageLayout
      miniTitle={t("settings.tools.miniTitle")}
      title={t("settings.tools.title")}
      description={t("settings.tools.description")}
      scrollBody={false}
      contentClassName="min-h-0 pt-6"
    >
      <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] gap-4 overflow-hidden">
        <ToolsSidebar
          activeGroupId={workbench.activeGroupId}
          summaries={workbench.groupSummaries}
          onSelectGroup={workbench.selectGroup}
        />

        <div className="flex min-h-0 h-full flex-col gap-4 overflow-hidden">
          {workbench.workspaceSelection && workbench.requiresWorkspace ? (
            <ToolsWorkbenchPanel
              isSelectingWorkspace={workbench.isSelectingWorkspace}
              isWorkspaceLoading={workbench.isWorkspaceLoading}
              workspaceRootInput={workbench.workspaceRootInput}
              workspaceSelection={workbench.workspaceSelection}
              onWorkspaceChange={workbench.setWorkspaceRootInput}
              onWorkspaceApply={() => void workbench.updateWorkspaceRoot()}
              labels={{
                applyWorkspace: t("settings.tools.workbench.applyWorkspace"),
                workspaceCurrent: t("settings.tools.workbench.workspaceCurrent"),
                workspaceDescription: t("settings.tools.workbench.workspaceDescription"),
                workspaceRoot: t("settings.tools.workbench.workspaceRoot"),
                workspaceRootInput: t("settings.tools.workbench.workspaceRootInput"),
                workspaceRootPlaceholder: t("settings.tools.workbench.workspaceRootPlaceholder"),
                workspaceUnset: t("settings.tools.workbench.workspaceUnset"),
              }}
            />
          ) : null}

          <ToolsPackagePanel
            tools={workbench.filteredTools}
            selectedTool={workbench.selectedTool}
            terminalSummary={workbench.terminalSummary}
            runStatus={workbench.runStatus}
            isRunning={workbench.isRunning}
            tracePanel={
              <ToolsTracePanel
                activeToolId={workbench.selectedTool?.id ?? null}
                artifacts={workbench.artifacts}
                events={workbench.events}
                emptyPlaceholder={t("settings.tools.workbench.consolePlaceholder")}
                panelTitle={t("settings.tools.workbench.console")}
                runError={workbench.runError}
                runStatus={workbench.runStatus}
                trace={workbench.trace}
                terminalSummary={workbench.terminalSummary}
              />
            }
            onSelectTool={workbench.selectTool}
            onOpenArgsModal={() => setIsArgsModalOpen(true)}
            onRun={() => void workbench.runSelectedTool()}
            labels={{
              empty: t("settings.tools.package.empty"),
              config: t("settings.tools.package.config"),
              execute: t("settings.tools.workbench.execute"),
              packageTitle: t("settings.tools.package.title"),
              terminalApprovalRequired: t("settings.tools.package.terminalApprovalRequired"),
              terminalTimeout: t("settings.tools.package.terminalTimeout"),
              terminalReused: t("settings.tools.package.terminalReused"),
              terminalExit: (exitCode) =>
                t("settings.tools.package.terminalExit", { exitCode }),
              terminalStreamMerged: t("settings.tools.package.terminalStreamMerged"),
              terminalStreamSplit: t("settings.tools.package.terminalStreamSplit"),
              terminalPtyMerged: t("settings.tools.package.terminalPtyMerged"),
              terminalSession: (sessionId) =>
                t("settings.tools.package.terminalSession", { sessionId }),
              terminalCwd: (cwd) => t("settings.tools.package.terminalCwd", { cwd }),
            }}
          />
        </div>
      </div>

      <Modal
        open={isArgsModalOpen}
        title={t("settings.tools.package.argsModalTitle")}
        width={760}
        maxHeight="80vh"
        onClose={() => setIsArgsModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsArgsModalOpen(false)}>
              {t("common.actions.close")}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (workbench.selectedTool?.id === "web_search") {
                  await workbench.saveWebSearchConfig();
                }
                setIsArgsModalOpen(false);
              }}
            >
              {t("common.actions.confirm")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {workbench.selectedTool ? (
            <div className="rounded-ui-control border border-border bg-surface-secondary px-3 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text-primary">
                    {workbench.selectedTool.title}
                  </div>
                  <div className="mt-1 break-all text-xs text-text-tertiary">
                    {workbench.selectedTool.id}
                  </div>
                  {workbench.selectedTool.description ? (
                    <div className="mt-3 text-sm leading-6 text-text-secondary">
                      {workbench.selectedTool.description}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-primary px-2 py-0.5 text-xs text-text-secondary">
                    {workbench.selectedTool.domain}
                  </span>
                  {workbench.selectedTool.capabilities.requiresApproval ? (
                    <span className="rounded-full bg-warning-background px-2 py-0.5 text-xs text-warning-text">
                      approval
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {workbench.selectedTool?.id === "web_search" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-ui-control border border-border bg-surface-primary px-3 py-3">
                  <div className="flex items-center gap-2">
                    <img
                      src="https://www.tavily.com/logos/tavily-full.svg"
                      alt="Tavily"
                      className="h-4 w-auto"
                    />
                    <span className="text-xs text-text-tertiary">
                      {t("settings.tools.package.webSearchTavilyHint")}
                    </span>
                  </div>
                  <div className="mt-3">
                    <TextInput
                      label={t("settings.tools.package.webSearchApiKey")}
                      value={workbench.webSearchConfig.apiKey}
                      onChange={(value) =>
                        workbench.setWebSearchConfig((current) => ({
                          ...current,
                          apiKey: value,
                        }))
                      }
                      placeholder={t("settings.tools.package.webSearchApiKeyPlaceholder")}
                    />
                  </div>
                </div>

                <div className="rounded-ui-control border border-border bg-surface-primary px-3 py-3">
                  <div className="flex items-center gap-2">
                    <img
                      src="https://upload.wikimedia.org/wikipedia/en/a/a3/SearXNG_logo.svg"
                      alt="SearXNG"
                      className="h-4 w-auto"
                    />
                    <span className="text-xs text-text-tertiary">
                      {t("settings.tools.package.webSearchSearxngHint")}
                    </span>
                  </div>
                  <div className="mt-3">
                    <TextInput
                      label={t("settings.tools.package.webSearchBaseUrl")}
                      value={workbench.webSearchConfig.baseUrl}
                      onChange={(value) =>
                        workbench.setWebSearchConfig((current) => ({
                          ...current,
                          baseUrl: value,
                        }))
                      }
                      placeholder={t("settings.tools.package.webSearchBaseUrlPlaceholder")}
                    />
                  </div>
                </div>

                <div className="rounded-ui-control border border-border bg-surface-primary px-3 py-3">
                  <NumberInput
                    label={t("settings.tools.package.webSearchMaxResults")}
                    value={workbench.webSearchConfig.maxResults}
                    onChange={(value) =>
                      workbench.setWebSearchConfig((current) => ({
                        ...current,
                        maxResults: value,
                      }))
                    }
                    step={1}
                    labelHelp={t("settings.tools.package.webSearchMaxResultsHint")}
                  />
                </div>
              </div>

            </div>
          ) : (
            <>
              <div className="text-sm text-text-secondary">
                {t("settings.tools.package.argsModalDescription")}
              </div>
            </>
          )}
          <TextArea
            label={t("settings.tools.workbench.args")}
            value={workbench.argsDraft}
            onChange={workbench.setArgsDraft}
            placeholder={t("settings.tools.workbench.argsPlaceholder")}
            rows={workbench.selectedTool?.id === "web_search" ? 8 : 18}
          />
        </div>
      </Modal>
    </SettingsPageLayout>
  );
}
