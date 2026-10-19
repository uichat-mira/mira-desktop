import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, HelpCircle } from "lucide-react";
import { Alert, Badge, Button, Card, Modal } from "@/shared/ui";
import MicroAppPageLayout from "../components/MicroAppPageLayout";
import { useComputerUseRuntimeState, type ComputerUseRuntimeApi } from "./useComputerUseDebuggerState";
import ComputerUseGuideDrawer from "./ComputerUseGuideDrawer";

export default function ComputerUseStudioPage({ api }: { api?: ComputerUseRuntimeApi }) {
  const { t } = useTranslation();
  const state = useComputerUseRuntimeState(api);
  const [guideOpen, setGuideOpen] = useState(false);
  const runtimeCandidates = state.runtime.details?.inspectedCandidates ?? [];
  const hasManagedRuntime = runtimeCandidates.some((candidate) => candidate.source === "managed");
  const hasSystemBrowser = runtimeCandidates.some((candidate) => candidate.source === "system");

  useEffect(() => { void state.refreshStatus(); }, [state.refreshStatus]);

  const requestRuntimeInstall = () => {
    const needsConfirmation = hasManagedRuntime || hasSystemBrowser;
    if (!needsConfirmation) {
      void state.installRuntime();
      return;
    }

    Modal.confirm({
      title: hasManagedRuntime
        ? t("settings.microApps.computerUseRuntime.runtimeCard.reinstallTitle")
        : t("settings.microApps.computerUseRuntime.runtimeCard.systemBrowserTitle"),
      description: hasManagedRuntime
        ? t("settings.microApps.computerUseRuntime.runtimeCard.reinstallDescription")
        : t("settings.microApps.computerUseRuntime.runtimeCard.systemBrowserDescription"),
      confirmText: t("settings.microApps.computerUseRuntime.runtimeCard.confirmDownload"),
      cancelText: t("settings.microApps.computerUseRuntime.runtimeCard.cancel"),
      tone: "warning",
      onConfirm: async () => {
        await state.installRuntime(true);
      },
    });
  };

  return (
    <MicroAppPageLayout
      miniTitle={t("settings.microApps.computerUseRuntime.page.miniTitle")}
      title={t("settings.microApps.computerUseRuntime.page.title")}
      description={t("settings.microApps.computerUseRuntime.page.description")}
      contentClassName="gap-4 pt-6"
      slot={<div className="flex flex-wrap items-center justify-end gap-2"><Badge variant={state.runtime.status === "ready" ? "success" : "warning"}>{t(`settings.microApps.computerUseRuntime.runtime.${state.runtime.status}`)}</Badge><Button size="xs" variant="ghost" onClick={() => setGuideOpen(true)}><HelpCircle className="h-4 w-4" />{t("settings.microApps.computerUseRuntime.actions.openGuide")}</Button></div>}
    >
      <ComputerUseGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} labels={t("settings.microApps.computerUseRuntime.guide", { returnObjects: true }) as never} />
      {state.error && <Alert variant="danger" title={t("settings.microApps.computerUseRuntime.errors.title")}>{state.error}</Alert>}
      <Card className="space-y-4" padding="md">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionTitle icon={<Download className="h-4 w-4" />} title={t("settings.microApps.computerUseRuntime.runtimeCard.title")} />
            <p className="mt-1 text-sm text-text-secondary">{t("settings.microApps.computerUseRuntime.runtimeCard.description")}</p>
          </div>
          <Button size="sm" variant="primary" onClick={requestRuntimeInstall} disabled={state.busy}>
            <Download className="h-4 w-4" />
            {t("settings.microApps.computerUseRuntime.actions.installRuntime")}
          </Button>
        </div>
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <RuntimeFact label={t("settings.microApps.computerUseRuntime.runtimeCard.status")} value={t(`settings.microApps.computerUseRuntime.runtime.${state.runtime.status}`)} tone={state.runtime.status === "ready" ? "success" : "warning"} />
          <RuntimeFact label={t("settings.microApps.computerUseRuntime.runtimeCard.managed")} value={hasManagedRuntime ? t("settings.microApps.computerUseRuntime.runtimeCard.detected") : t("settings.microApps.computerUseRuntime.runtimeCard.notDetected")} tone={hasManagedRuntime ? "success" : "muted"} />
          <RuntimeFact label={t("settings.microApps.computerUseRuntime.runtimeCard.system")} value={hasSystemBrowser ? t("settings.microApps.computerUseRuntime.runtimeCard.detected") : t("settings.microApps.computerUseRuntime.runtimeCard.notDetected")} tone={hasSystemBrowser ? "success" : "muted"} />
        </div>
        <div className="rounded-ui-control border border-border bg-surface-secondary/40 px-3 py-2 text-xs text-text-tertiary">
          <span className="font-medium text-text-secondary">{t("settings.microApps.computerUseRuntime.runtimeCard.path")}: </span>
          <span className="break-all font-mono">{state.runtime.details?.executablePath ?? t("settings.microApps.computerUseRuntime.runtimeCard.pathEmpty")}</span>
        </div>
        {state.runtime.message && <p className="text-sm text-text-secondary">{state.runtime.message}</p>}
      </Card>
    </MicroAppPageLayout>
  );
}

function SectionTitle({ icon, title }: { icon?: React.ReactNode; title: string }) { return <h2 className="flex items-center gap-2 text-heading-2 text-text-primary">{icon}{title}</h2>; }
function RuntimeFact({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "muted" }) { return <div className="flex items-center justify-between gap-3 rounded-ui-control border border-border bg-surface-secondary/30 px-3 py-2"><span className="text-text-tertiary">{label}</span><Badge variant={tone}>{value}</Badge></div>; }
