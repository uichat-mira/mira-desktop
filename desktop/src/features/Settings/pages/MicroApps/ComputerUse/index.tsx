import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, CircleStop, Download, Eye, HelpCircle, Play, Plus, RotateCcw } from "lucide-react";
import { Alert, Badge, Button, Card, Modal, NavigationCardTabs, Select, TextInput } from "@/shared/ui";
import { resolveComputerUseArtifactUrl, type ComputerUseActionInput, type ComputerUseAssertionInput } from "@/shared/api/computerUse";
import MicroAppPageLayout from "../components/MicroAppPageLayout";
import { useComputerUseDebuggerState, type ComputerUseDebuggerApi } from "./useComputerUseDebuggerState";
import ComputerUseGuideDrawer from "./ComputerUseGuideDrawer";

const actionNames = ["navigate", "click", "type", "select", "press", "scroll", "wait"];
const assertionNames = ["title", "url", "text", "visible", "value"];
const tr = (key: string) => `settings.microApps.computerUseDebugger.${key}`;

export default function ComputerUseDebuggerPage({ api }: { api?: ComputerUseDebuggerApi }) {
  const { t } = useTranslation();
  const state = useComputerUseDebuggerState(api);
  const [tab, setTab] = useState<"feedback" | "json">("feedback");
  const [action, setAction] = useState("navigate");
  const [ref, setRef] = useState("");
  const [value, setValue] = useState("");
  const [assertion, setAssertion] = useState("title");
  const [expected, setExpected] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"playwright">("playwright");
  const browser = state.session?.browser;
  const config = state.config;
  const rawJson = useMemo(() => JSON.stringify(state.session ?? state.status, null, 2), [state.session, state.status]);
  const runtimeCandidates = state.runtime.details?.inspectedCandidates ?? [];
  const hasManagedRuntime = runtimeCandidates.some((candidate) => candidate.source === "managed");
  const hasSystemBrowser = runtimeCandidates.some((candidate) => candidate.source === "system");

  useEffect(() => { void state.refreshStatus(); }, [state.refreshStatus]);

  const runAction = () => {
    if (!browser?.url || !browser.snapshotHash) return;
    void state.executeAction(buildActionInput(action, ref, value, browser.url, browser.snapshotHash));
  };

  const requestRuntimeInstall = () => {
    const needsConfirmation = hasManagedRuntime || hasSystemBrowser;
    if (!needsConfirmation) {
      void state.installRuntime();
      return;
    }

    Modal.confirm({
      title: hasManagedRuntime
        ? t(tr("runtimeCard.reinstallTitle"))
        : t(tr("runtimeCard.systemBrowserTitle")),
      description: hasManagedRuntime
        ? t(tr("runtimeCard.reinstallDescription"))
        : t(tr("runtimeCard.systemBrowserDescription")),
      confirmText: t(tr("runtimeCard.confirmDownload")),
      cancelText: t(tr("runtimeCard.cancel")),
      tone: "warning",
      onConfirm: async () => {
        await state.installRuntime(true);
      },
    });
  };

  return (
    <MicroAppPageLayout
      miniTitle={t(tr("page.miniTitle"))}
      title={t(tr("page.title"))}
      description={t(tr("page.description"))}
      contentClassName="gap-4 pt-6"
      slot={<div className="flex flex-wrap items-center justify-end gap-2"><Badge variant={state.runtime.status === "ready" ? "success" : "warning"}>{t(tr(`runtime.${state.runtime.status}`))}</Badge><Button size="xs" variant="ghost" onClick={() => setGuideOpen(true)}><HelpCircle className="h-4 w-4" />{t(tr("actions.openGuide"))}</Button></div>}
    >
      <ComputerUseGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} labels={t(tr("guide"), { returnObjects: true }) as never} />
      {state.error && <Alert variant="danger" title={t(tr("errors.title"))}>{state.error}</Alert>}
      <NavigationCardTabs
        tabs={[{ value: "playwright", label: t(tr("tabs.playwright")) }]}
        value={activeTab}
        onChange={setActiveTab}
      />
      <Card className="space-y-4" padding="md">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionTitle icon={<Download className="h-4 w-4" />} title={t(tr("runtimeCard.title"))} />
            <p className="mt-1 text-sm text-text-secondary">{t(tr("runtimeCard.description"))}</p>
          </div>
          <Button size="sm" variant="primary" onClick={requestRuntimeInstall} disabled={state.busy}>
            <Download className="h-4 w-4" />
            {t(tr("actions.installRuntime"))}
          </Button>
        </div>
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <RuntimeFact label={t(tr("runtimeCard.status"))} value={t(tr(`runtime.${state.runtime.status}`))} tone={state.runtime.status === "ready" ? "success" : "warning"} />
          <RuntimeFact label={t(tr("runtimeCard.managed"))} value={hasManagedRuntime ? t(tr("runtimeCard.detected")) : t(tr("runtimeCard.notDetected"))} tone={hasManagedRuntime ? "success" : "muted"} />
          <RuntimeFact label={t(tr("runtimeCard.system"))} value={hasSystemBrowser ? t(tr("runtimeCard.detected")) : t(tr("runtimeCard.notDetected"))} tone={hasSystemBrowser ? "success" : "muted"} />
        </div>
        <div className="rounded-ui-control border border-border bg-surface-secondary/40 px-3 py-2 text-xs text-text-tertiary">
          <span className="font-medium text-text-secondary">{t(tr("runtimeCard.path"))}: </span>
          <span className="break-all font-mono">{state.runtime.details?.executablePath ?? t(tr("runtimeCard.pathEmpty"))}</span>
        </div>
      </Card>
      <div className="grid min-h-0 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <Card className="space-y-4" padding="md">
          <SectionTitle icon={<Activity className="h-4 w-4" />} title={t(tr("runConfig.title"))} />
          <Select label={t(tr("runConfig.runtime"))} value={config.runtime} onChange={(v) => state.setConfig({ runtime: v as "managed" | "system" })} options={[{ value: "managed", label: t(tr("runtimeOptions.managed")) }, { value: "system", label: t(tr("runtimeOptions.system")) }]} />
          <TextInput label={t(tr("runConfig.url"))} value={config.url} onChange={(v) => state.setConfig({ url: v })} placeholder={t(tr("placeholders.url"))} />
          <TextInput label={t(tr("runConfig.allowedDomains"))} value={config.allowedDomains.join(", ")} onChange={(v) => state.setConfig({ allowedDomains: v.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder={t(tr("placeholders.domain"))} />
          <div className="grid grid-cols-2 gap-2 text-body-small text-text-secondary"><span>{t(tr("runConfig.timeout"))}: {config.limits.timeoutMs} ms</span><span>{t(tr("runConfig.snapshot"))}: {config.limits.maxSnapshotChars}</span></div>
          <Select label={t(tr("runConfig.approvalPolicy"))} value={config.approvalPolicy} onChange={(v) => state.setConfig({ approvalPolicy: v as typeof config.approvalPolicy })} options={[{ value: "always", label: t(tr("approvalOptions.always")) }, { value: "write_actions", label: t(tr("approvalOptions.writeActions")) }, { value: "never", label: t(tr("approvalOptions.never")) }]} />
          <div className="flex flex-wrap gap-2 border-t border-border pt-3"><Button size="sm" variant="primary" onClick={() => void state.newSession()}><Plus className="h-4 w-4" />{t(tr("actions.newSession"))}</Button><Button size="sm" variant="outline" onClick={() => state.reset()}><RotateCcw className="h-4 w-4" />{t(tr("actions.reset"))}</Button></div>
        </Card>
        <div className="space-y-4">
          <Card className="space-y-3">
            <SectionTitle icon={<Eye className="h-4 w-4" />} title={t(tr("browserState.title"))} />
            <div className="grid gap-2 text-body-small">
              <Field label={t(tr("browserState.urlLabel"))} value={browser?.url} empty={t(tr("common.emptyValue"))} />
              <Field label={t(tr("browserState.titleLabel"))} value={browser?.title} empty={t(tr("common.emptyValue"))} />
              <Field label={t(tr("browserState.snapshotHashLabel"))} value={browser?.snapshotHash} empty={t(tr("common.emptyValue"))} />
            </div>
            <pre className="max-h-48 overflow-auto rounded-ui-control bg-surface-secondary p-3 font-mono text-xs text-text-secondary">{browser?.snapshot || t(tr("browserState.empty"))}</pre>
            <FeedbackBlock title={t(tr("browserState.visibleText"))} value={browser?.visibleText || t(tr("common.emptyValue"))} />
            {browser?.screenshotArtifact ? <div><div className="text-caption uppercase text-text-tertiary">{t(tr("browserState.screenshot"))}</div><img src={resolveComputerUseArtifactUrl(browser.screenshotArtifact)} alt={t(tr("browserState.screenshot"))} className="mt-1 max-h-48 w-full object-contain" /></div> : null}
            <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={!state.session || state.busy} onClick={() => void state.observe()}><Eye className="h-4 w-4" />{t(tr("actions.inspect"))}</Button><Button size="sm" variant="danger-ghost" disabled={!state.session || state.busy} onClick={() => void state.stop()}><CircleStop className="h-4 w-4" />{t(tr("actions.stop"))}</Button></div>
          </Card>
          <Card className="space-y-3">
            <SectionTitle icon={<Play className="h-4 w-4" />} title={t(tr("manual.title"))} />
            <div className="grid gap-2 md:grid-cols-[150px_1fr_1fr_auto]"><Select label={t(tr("manual.action"))} value={action} onChange={setAction} options={actionNames.map((item) => ({ value: item, label: t(tr("actionOptions." + item)) }))} /><TextInput label={t(tr("manual.ref"))} value={ref} onChange={setRef} placeholder={t(tr("placeholders.ref"))} /><TextInput label={t(tr("manual.value"))} value={value} onChange={setValue} placeholder={t(tr("placeholders.value"))} /><Button className="self-end h-10" size="sm" variant="primary" disabled={!state.session || !browser?.url || !browser?.snapshotHash || state.busy} onClick={runAction}>{t(tr("actions.execute"))}</Button></div>
            <div className="grid gap-2 md:grid-cols-[150px_1fr_auto]"><Select label={t(tr("manual.assertion"))} value={assertion} onChange={setAssertion} options={assertionNames.map((item) => ({ value: item, label: t(tr("assertionOptions." + item)) }))} /><TextInput label={t(tr("manual.expected"))} value={expected} onChange={setExpected} placeholder={t(tr("placeholders.expected"))} /><Button className="self-end h-10" size="sm" variant="secondary" disabled={!state.session || state.busy} onClick={() => void state.assertState(buildAssertionInput(assertion, ref, expected))}>{t(tr("actions.assert"))}</Button></div>
          </Card>
        </div>
        <Card className="flex min-h-[420px] flex-col gap-3">
          <div className="flex items-center justify-between">
            <SectionTitle title={t(tr("feedback.title"))} />
            <div className="flex gap-1">
              <Button size="xs" variant={tab === "feedback" ? "secondary" : "ghost"} onClick={() => setTab("feedback")}>{t(tr("feedback.events"))}</Button>
              <Button size="xs" variant={tab === "json" ? "secondary" : "ghost"} onClick={() => setTab("json")}>{t(tr("feedback.json"))}</Button>
            </div>
          </div>
          {tab === "json" ? (
            <pre className="min-h-0 flex-1 overflow-auto rounded-ui-control bg-surface-secondary p-3 font-mono text-xs text-text-secondary">{rawJson}</pre>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-auto">
              {state.session?.approval ? (
                <div>
                  <FeedbackBlock title={t(tr("feedback.approval"))} value={state.session.approval} />
                  {state.session.approval.status === "pending" ? <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => void state.approve()} disabled={state.busy}>{t(tr("actions.approve"))}</Button><Button size="sm" variant="danger-ghost" onClick={() => void state.reject()} disabled={state.busy}>{t(tr("actions.reject"))}</Button></div> : null}
                </div>
              ) : null}
              {state.session?.invocations.length ? state.session.invocations.map((item) => (
                <div key={item.invocationId} className="border-b border-border pb-3 text-body-small">
                  <div className="flex justify-between"><strong className="text-text-primary">{item.tool}</strong><Badge variant={item.status === "failed" ? "danger" : item.status === "succeeded" ? "success" : item.status === "awaiting_approval" ? "warning" : "neutral"}>{t(tr("status." + item.status))}</Badge></div>
                  <div className="font-mono text-xs text-text-tertiary">{item.invocationId}</div>
                  <FeedbackBlock title={t(tr("feedback.toolArgs"))} value={item.args} />
                  {item.artifactIds?.length ? <FeedbackBlock title={t(tr("feedback.artifacts"))} value={item.artifactIds} /> : null}
                  {item.error ? <FeedbackBlock title={t(tr("feedback.result"))} value={`${item.error.code}: ${item.error.message}`} /> : null}
                </div>
              )) : <div className="text-body-small text-text-secondary">{t(tr("feedback.empty"))}</div>}
              {state.session?.evidence ? <FeedbackBlock title={t(tr("feedback.evidence"))} value={state.session.evidence} /> : null}
              {state.session?.result ? <FeedbackBlock title={t(tr("feedback.result"))} value={state.session.result} /> : null}
            </div>
          )}
        </Card>
      </div>
    </MicroAppPageLayout>
  );
}

function SectionTitle({ icon, title }: { icon?: React.ReactNode; title: string }) { return <h2 className="flex items-center gap-2 text-heading-2 text-text-primary">{icon}{title}</h2>; }
function Field({ label, value, empty }: { label: string; value?: string; empty: string }) { return <div className="flex justify-between gap-3 border-b border-border pb-1"><span className="text-text-tertiary">{label}</span><span className="truncate font-mono text-text-primary">{value || empty}</span></div>; }
function FeedbackBlock({ title, value }: { title: string; value: unknown }) { return <div className="mt-2"><div className="text-caption uppercase text-text-tertiary">{title}</div><pre className="mt-1 max-h-32 overflow-auto rounded-ui-control bg-surface-secondary p-2 font-mono text-xs text-text-secondary">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre></div>; }
function RuntimeFact({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "muted" }) { return <div className="flex items-center justify-between gap-3 rounded-ui-control border border-border bg-surface-secondary/30 px-3 py-2"><span className="text-text-tertiary">{label}</span><Badge variant={tone}>{value}</Badge></div>; }

export function buildActionInput(action: string, ref: string, value: string, pageUrl: string, snapshotHash: string): ComputerUseActionInput {
  if (action === "navigate") return { pageUrl, snapshotHash, action: { kind: "navigate", url: value } };
  if (action === "click") return { pageUrl, snapshotHash, action: { kind: "click", ref } };
  if (action === "type") return { pageUrl, snapshotHash, action: { kind: "type", ref, text: value } };
  if (action === "select") return { pageUrl, snapshotHash, action: { kind: "select", ref, value } };
  if (action === "press") return { pageUrl, snapshotHash, action: { kind: "press", ref, key: value } };
  if (action === "scroll") return { pageUrl, snapshotHash, action: { kind: "scroll", y: Number(value) || 0 } };
  return { pageUrl, snapshotHash, action: { kind: "wait", timeoutMs: Number(value) || undefined } };
}


export function buildAssertionInput(assertion: string, ref: string, expected: string): ComputerUseAssertionInput {
  if (assertion === "visible") return { assertion: { kind: "visible", ref } };
  if (assertion === "value") return { assertion: { kind: "value", ref, expected } };
  return { assertion: { kind: assertion as "title" | "url" | "text", expected } };
}
