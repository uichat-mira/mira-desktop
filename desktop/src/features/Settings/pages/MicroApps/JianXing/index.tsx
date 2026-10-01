import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Circle, CircleHelp, Copy, Download, Eye, FileDown, FileUp, Globe2, KeyRound, MousePointer2, Pencil, Plus, PlugZap, RefreshCw, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, Card, FileUploadDropzone, IconButton, Modal, NavigationCardTabs, Select, Table, TextInput, Tooltip } from "@/shared/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { message } from "@/shared/ui/Message";
import { ApiError, post } from "@/shared/lib/request";
import { downloadBrowserExtension, getNativeMessagingHostStatus, installNativeMessagingHost, uninstallNativeMessagingHost, type NativeMessagingHostStatus } from "@/shared/platform/desktopRuntime";
import { WebBridgeClient, WebBridgeRequestError, type ClipRule, type ClipRules, type WebBridgeStatus } from "@/shared/api/webbridge";
import MicroAppPageLayout from "../components/MicroAppPageLayout";
import ClipRuleDrawer from "./components/ClipRuleDrawer";
import JianXingGuideDrawer from "./components/JianXingGuideDrawer";
import ExpertPanel from "./components/ExpertPanel";

type Mode = "look" | "browse" | "act" | "transfer";
type WorkspaceTab = "jianxing" | "clipper" | "expert";
type ConfiguredRuleRow = {
  key: string;
  alias: string;
  urlPattern: string;
  urlPatternMode: "wildcard" | "regex";
  enabled: boolean;
  includeSelector: string;
  includeRegion?: ClipRule["includeRegion"];
  imagePolicy: ClipRule["imagePolicy"];
};
type ToolResult = Record<string, unknown>;

const workspaceTabs: WorkspaceTab[] = ["jianxing", "clipper", "expert"];

const modeDefinitions: Array<{ id: Mode; icon: typeof Eye }> = [
  { id: "look", icon: Eye },
  { id: "browse", icon: Globe2 },
  { id: "act", icon: MousePointer2 },
  { id: "transfer", icon: FileUp },
];

const actionDefinitions: Record<Mode, string[]> = {
  look: ["snapshot", "page", "tabs", "element", "screenshot"],
  browse: ["open", "new", "switch", "close", "back", "forward", "reload", "scroll", "scrollTo", "paginate", "wait"],
  act: ["click", "hover", "drag", "fill", "select", "press", "dialog"],
  transfer: ["upload", "download"],
};

const jsonText = (value: unknown) => JSON.stringify(value, null, 2);

const emptyRule = (urlPattern = ""): ClipRule => ({
  urlPattern,
  urlPatternMode: "wildcard",
  enabled: true,
  includeSelector: "",
  excludeSelectors: [],
  imagePolicy: { minWidth: 100, minHeight: 100, maxCount: 20 },
});

const ruleForEditor = (rule: ClipRule): ClipRule => ({
  ...rule,
  urlPatternMode: rule.urlPatternMode === "regex" ? "regex" : "wildcard",
});

const clipRuleKey = (rule: Pick<ClipRule, "urlPattern" | "urlPatternMode">) =>
  `${rule.urlPatternMode}:${rule.urlPattern.trim()}`;

const defaultWildcardPattern = (url: string) => {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return "";
  }
};

export default function JianXingPage() {
  const { t } = useTranslation();
  const modes = useMemo(() => modeDefinitions.map((item) => ({ ...item, label: t(`settings.microApps.jianXing.modes.${item.id}`), description: t(`settings.microApps.jianXing.modes.${item.id}Description`) })), [t]);
  const actions = useMemo(() => Object.fromEntries(Object.entries(actionDefinitions).map(([key, values]) => [key, values.map((value) => ({ value, label: t(`settings.microApps.jianXing.actions.${value}`) }))])) as Record<Mode, Array<{ value: string; label: string }>>, [t]);
  const tabItems = useMemo(() => workspaceTabs.map((value) => ({ value, label: t(`settings.microApps.jianXing.tabs.${value}`) })), [t]);
  const clientRef = useRef<WebBridgeClient | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("jianxing");
  const [mode, setMode] = useState<Mode>("look");
  const [action, setAction] = useState("snapshot");
  const [ref, setRef] = useState("");
  const [value, setValue] = useState("");
  const [file, setFile] = useState<{ name: string; mimeType: string; dataUrl: string } | null>(null);
  const [status, setStatus] = useState<WebBridgeStatus>({ status: "disconnected" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState("");
  const [extensionCode, setExtensionCode] = useState("");
  const [extensionCodeLoading, setExtensionCodeLoading] = useState(false);
  const [extensionModalOpen, setExtensionModalOpen] = useState(false);
  const [extensionDownloadLoading, setExtensionDownloadLoading] = useState(false);
  const [nativeHostLoading, setNativeHostLoading] = useState(false);
  const [nativeHostChecking, setNativeHostChecking] = useState(true);
  const [nativeHostStatus, setNativeHostStatus] = useState<NativeMessagingHostStatus | null>(null);
  const [clipRules, setClipRules] = useState<ClipRules>({});
  const [ruleKey, setRuleKey] = useState("");
  const [ruleForm, setRuleForm] = useState<ClipRule>(() => emptyRule());
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [regionPicking, setRegionPicking] = useState<"include" | "exclude" | null>(null);
  const [rulesMessage, setRulesMessage] = useState("");
  const [rulesError, setRulesError] = useState("");
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const refreshNativeHostStatus = useCallback(async () => {
    setNativeHostChecking(true);
    try {
      const nextStatus = await getNativeMessagingHostStatus();
      setNativeHostStatus(nextStatus);
      return nextStatus;
    } catch (cause) {
      const nextStatus: NativeMessagingHostStatus = {
        status: "repair_needed",
        installed: false,
        reason: cause instanceof Error ? cause.message : t("settings.microApps.jianXing.messages.nativeReadFailed"),
      };
      setNativeHostStatus(nextStatus);
      return nextStatus;
    } finally {
      setNativeHostChecking(false);
    }
  }, []);

  useEffect(() => {
    const client = new WebBridgeClient();
    clientRef.current = client;
    const unsubscribe = client.onStatus(setStatus);
    return () => {
      unsubscribe();
      client.close();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    void refreshNativeHostStatus();
  }, [refreshNativeHostStatus]);

  const connected = status.status === "connected";
  const extensionConnected = status.extensionConnected === true;
  const nativeHostInstalled = nativeHostStatus?.status === "installed";
  const nativeHostRepairNeeded = nativeHostStatus?.status === "repair_needed";
  const nativeHostActionLabel = nativeHostLoading
    ? t("settings.microApps.jianXing.connection.nativeInstalling")
    : nativeHostChecking
      ? t("settings.microApps.jianXing.connection.nativeCheck")
      : nativeHostStatus?.status === "unsupported"
        ? t("settings.microApps.jianXing.connection.nativeUnavailable")
        : nativeHostInstalled || nativeHostRepairNeeded
          ? t("settings.microApps.jianXing.connection.nativeRepair")
          : t("settings.microApps.jianXing.connection.nativeInstall");
  const nativeHostStatusLabel = nativeHostChecking
    ? t("settings.microApps.jianXing.connection.nativeCheck")
    : nativeHostStatus?.status === "installed"
      ? t("settings.microApps.jianXing.connection.nativeInstalled")
      : nativeHostStatus?.status === "repair_needed"
        ? t("settings.microApps.jianXing.connection.nativeNeedsRepair")
        : nativeHostStatus?.status === "unsupported"
          ? t("settings.microApps.jianXing.connection.nativeUnavailable")
          : t("settings.microApps.jianXing.connection.nativeNotInstalled");
  const visibleOperation = status.event === "started" ? t("settings.microApps.jianXing.operation.started", { operation: status.operation || t("settings.microApps.jianXing.operation.browserPage") }) : status.event === "finished" ? `${status.operationOk === false ? t("settings.microApps.jianXing.operation.failed") : t("settings.microApps.jianXing.operation.completed")}${status.operation ? `：${status.operation}` : ""}` : "";
  const isLook = mode === "look";
  const needsRef = action === "element" || ["click", "hover", "fill", "select", "scrollTo", "paginate", "switch", "close"].includes(action);
  const isFileUpload = mode === "transfer" && action === "upload";

  const loadClipRules = async () => {
    if (!clientRef.current || !connected || !extensionConnected) {
      setRulesError(t("settings.microApps.jianXing.messages.connectExtension"));
      return;
    }
    setRulesLoading(true);
    setRulesError("");
    try {
      const nextRules = await clientRef.current.requestClipRules("clip_rules_get");
      setClipRules(nextRules);
      const selectedKey = nextRules[ruleKey] ? ruleKey : Object.keys(nextRules).sort()[0] || "";
      setRuleKey(selectedKey);
      setRuleForm(nextRules[selectedKey] ? ruleForEditor(nextRules[selectedKey]) : emptyRule());
      setRulesMessage(t("settings.microApps.jianXing.messages.rulesLoaded"));
    } catch (cause) {
      setRulesError(cause instanceof Error ? cause.message : t("settings.microApps.jianXing.messages.rulesReadFailed"));
    } finally {
      setRulesLoading(false);
    }
  };

  useEffect(() => {
    if (connected && extensionConnected) void loadClipRules();
    // 扩展上线后立即从插件读取规则；插件是运行时规则唯一真源。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, extensionConnected]);

  const selectRule = (key: string) => {
    setRuleKey(key);
    setRuleForm(clipRules[key] ? ruleForEditor(clipRules[key]) : emptyRule());
    setRulesMessage("");
    setRulesError("");
  };

  const openRuleEditor = (key: string) => {
    selectRule(key);
    setRuleDrawerOpen(true);
  };

  const openNewRuleDrawer = () => {
    setRuleKey("");
    setRuleForm(emptyRule());
    setRulesMessage("");
    setRulesError("");
    setRuleDrawerOpen(true);
  };

  const updateRuleForm = (patch: Partial<ClipRule>) => setRuleForm((current) => ({ ...current, ...patch }));

  const configuredRuleRows = useMemo<ConfiguredRuleRow[]>(
    () => Object.entries(clipRules).sort(([left], [right]) => left.localeCompare(right)).map(([key, rule]) => ({
      key,
      alias: rule.alias?.trim() || "",
      urlPattern: rule.urlPattern,
      urlPatternMode: rule.urlPatternMode,
      enabled: rule.enabled,
      includeSelector: rule.includeSelector,
      includeRegion: rule.includeRegion,
      imagePolicy: rule.imagePolicy,
    })),
    [clipRules],
  );

  const configuredRuleColumns = useMemo<ColumnDef<ConfiguredRuleRow>[]>(
    () => [
      {
        header: t("settings.microApps.jianXing.rules.alias"),
        accessorKey: "alias",
        meta: { width: 160, ellipsisTooltip: true },
        cell: ({ row }) => (
          <span className={`block truncate text-sm font-medium ${row.original.alias ? "text-text-primary" : "text-text-tertiary"}`}>
            {row.original.alias || t("settings.microApps.jianXing.rules.unnamed")}
          </span>
        ),
      },
      {
        header: t("settings.microApps.jianXing.rules.urlPattern"),
        id: "urlPattern",
        meta: { width: 320, ellipsisTooltip: true },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-xs text-text-tertiary">{row.original.urlPatternMode === "regex" ? t("settings.microApps.jianXing.rules.regex") : t("settings.microApps.jianXing.rules.wildcard")}</span>
            <span className="truncate font-mono text-xs text-text-secondary">{row.original.urlPattern}</span>
          </div>
        ),
      },
      {
        header: t("settings.microApps.jianXing.rules.content"),
        id: "content",
        meta: { width: 120, ellipsisTooltip: true },
        cell: ({ row }) => (
          <span className="text-xs text-text-secondary">
            {row.original.includeRegion ? t("settings.microApps.jianXing.rules.selected", { tag: row.original.includeRegion.tag }) : row.original.includeSelector ? t("settings.microApps.jianXing.rules.configured") : t("settings.microApps.jianXing.rules.defaultExtract")}
          </span>
        ),
      },
      {
        header: t("settings.microApps.jianXing.rules.images"),
        id: "images",
        meta: { width: 140, nowrap: true },
        cell: ({ row }) => (
          <span className="text-xs text-text-secondary">
            ≥ {row.original.imagePolicy.minWidth} × {row.original.imagePolicy.minHeight} · {t("settings.microApps.jianXing.rules.imageCount", { count: row.original.imagePolicy.maxCount })}
          </span>
        ),
      },
      {
        header: t("settings.microApps.jianXing.rules.status"),
        accessorKey: "enabled",
        meta: { width: 72, align: "center" },
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? "success" : "muted"}>
            {row.original.enabled ? t("settings.microApps.jianXing.rules.enabled") : t("settings.microApps.jianXing.rules.disabled")}
          </Badge>
        ),
      },
      {
        header: t("settings.microApps.jianXing.rules.actions"),
        id: "actions",
        meta: { width: 64, align: "center" },
        cell: ({ row }) => (
          <Tooltip text={t("settings.microApps.jianXing.rules.edit")} placement="top">
            <IconButton
              size="xs"
              ariaLabel={t("settings.microApps.jianXing.rules.editAria", { name: row.original.alias || row.original.urlPattern })}
              onClick={() => openRuleEditor(row.original.key)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [openRuleEditor],
  );

  const pickRuleRegion = async (kind: "include" | "exclude") => {
    if (!clientRef.current || !connected || !extensionConnected) {
      setRulesError(t("settings.microApps.jianXing.messages.connectExtension"));
      return;
    }
    setRegionPicking(kind);
    setRulesError("");
    setRulesMessage(t(`settings.microApps.jianXing.messages.${kind === "include" ? "regionIncludePrompt" : "regionExcludePrompt"}`));
    try {
      const picked = await clientRef.current.pickClipRegion(kind);
      const baseRule = ruleForm;
      const urlPattern = baseRule.urlPattern || defaultWildcardPattern(picked.url);
      if (kind === "include") {
        setRuleForm({ ...baseRule, urlPattern, includeSelector: picked.selector, includeRegion: picked.summary });
        setRulesMessage(t("settings.microApps.jianXing.messages.regionIncluded"));
      } else {
        const existing = baseRule.excludeRegions
          || baseRule.excludeSelectors.map((selector) => ({ selector, summary: undefined }));
        const nextRegions = existing.some((region) => region.selector === picked.selector)
          ? existing
          : [...existing, { selector: picked.selector, summary: picked.summary }];
        setRuleForm({
          ...baseRule,
          urlPattern,
          excludeSelectors: nextRegions.map((region) => region.selector),
          excludeRegions: nextRegions,
        });
        setRulesMessage(t("settings.microApps.jianXing.messages.regionExcluded"));
      }
    } catch (cause) {
      setRulesError(cause instanceof Error ? cause.message : t("settings.microApps.jianXing.messages.regionFailed"));
      setRulesMessage("");
    } finally {
      setRegionPicking(null);
    }
  };

  const removeExcludeRegion = (selector: string) => {
    setRuleForm((current) => {
      const nextRegions = (current.excludeRegions || []).filter((region) => region.selector !== selector);
      return { ...current, excludeSelectors: nextRegions.map((region) => region.selector), excludeRegions: nextRegions };
    });
  };

  const saveClipRule = async () => {
    if (!clientRef.current || !connected || !extensionConnected) {
      setRulesError(t("settings.microApps.jianXing.messages.connectExtension"));
      return;
    }
    const nextRule: ClipRule = {
      ...ruleForm,
      alias: ruleForm.alias?.trim().slice(0, 80) || undefined,
      urlPattern: ruleForm.urlPattern.trim(),
      urlPatternMode: ruleForm.urlPatternMode === "regex" ? "regex" : "wildcard",
      includeSelector: ruleForm.includeSelector.trim(),
      excludeSelectors: ruleForm.excludeSelectors.map((item) => item.trim()).filter(Boolean),
      includeRegion: ruleForm.includeRegion,
      excludeRegions: ruleForm.excludeRegions,
      imagePolicy: {
        minWidth: Math.max(0, Math.min(10000, Math.round(Number(ruleForm.imagePolicy.minWidth) || 0))),
        minHeight: Math.max(0, Math.min(10000, Math.round(Number(ruleForm.imagePolicy.minHeight) || 0))),
        maxCount: Math.max(1, Math.min(50, Math.round(Number(ruleForm.imagePolicy.maxCount) || 20))),
      },
    };
    if (!nextRule.urlPattern) {
      setRulesError(t("settings.microApps.jianXing.messages.urlRequired"));
      return;
    }
    try {
      if (nextRule.urlPatternMode === "regex") new RegExp(nextRule.urlPattern);
    } catch {
      setRulesError(t("settings.microApps.jianXing.messages.invalidRegex"));
      return;
    }
    const nextKey = clipRuleKey(nextRule);
    const nextRules = { ...clipRules };
    if (ruleKey && ruleKey !== nextKey) delete nextRules[ruleKey];
    nextRules[nextKey] = nextRule;
    setRulesSaving(true);
    setRulesError("");
    try {
      const savedRules = await clientRef.current.requestClipRules("clip_rules_set", nextRules);
      setClipRules(savedRules);
      setRuleKey(nextKey);
      setRuleForm(savedRules[nextKey] ? ruleForEditor(savedRules[nextKey]) : nextRule);
      setRulesMessage(t("settings.microApps.jianXing.messages.rulesSaved"));
      setRuleDrawerOpen(false);
    } catch (cause) {
      setRulesError(cause instanceof Error ? cause.message : t("settings.microApps.jianXing.messages.rulesSaveFailed"));
    } finally {
      setRulesSaving(false);
    }
  };

  const deleteClipRule = async () => {
    if (!ruleKey || !clipRules[ruleKey]) {
      setRulesError(t("settings.microApps.jianXing.messages.ruleNotSaved"));
      return;
    }
    if (!clientRef.current || !connected || !extensionConnected) {
      setRulesError(t("settings.microApps.jianXing.messages.connectExtension"));
      return;
    }
    const nextRules = { ...clipRules };
    delete nextRules[ruleKey];
    setRulesSaving(true);
    setRulesError("");
    try {
      const savedRules = await clientRef.current.requestClipRules("clip_rules_set", nextRules);
      setClipRules(savedRules);
      const nextKey = Object.keys(savedRules).sort()[0] || "";
      setRuleKey(nextKey);
      setRuleForm(savedRules[nextKey] ? ruleForEditor(savedRules[nextKey]) : emptyRule());
      setRulesMessage(t("settings.microApps.jianXing.messages.rulesDeleted"));
      setRuleDrawerOpen(false);
    } catch (cause) {
      setRulesError(cause instanceof Error ? cause.message : t("settings.microApps.jianXing.messages.rulesDeleteFailed"));
    } finally {
      setRulesSaving(false);
    }
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    setAction(actions[next][0].value);
    setRef("");
    setValue("");
    setFile(null);
    setError("");
  };

  const connect = async () => {
    try {
      setError("");
      await clientRef.current?.connect();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.microApps.jianXing.messages.connectFailed"));
    }
  };

  const buildParams = (): Record<string, unknown> => {
    if (mode === "look") {
      if (action === "page") return { mode: action, include: ["text", "interactive"] };
      if (action === "element") return { mode: action, ref };
      return { mode: action };
    }
    if (mode === "browse") {
      if (action === "open" || action === "new") return { mode: action, url: value, after: { wait: "navigation", include: ["snapshot"] } };
      if (action === "switch") return { mode: action, tabId: Number(ref) };
      if (action === "close") return { mode: action, tabId: ref ? Number(ref) : undefined };
      if (["scrollTo", "paginate"].includes(action)) return { mode: action, ref, after: { include: ["snapshot"] } };
      if (action === "scroll" || action === "wait") return { mode: action, amount: Number(value) || undefined, after: { include: ["snapshot"] } };
      return { mode: action, after: { wait: action === "reload" ? "navigation" : "none", include: ["snapshot"] } };
    }
    if (mode === "act") {
      if (action === "drag") {
        const [fromRef, toRef] = value.split(",").map((item) => item.trim());
        return { mode: action, fromRef, toRef, after: { include: ["snapshot"] } };
      }
      if (action === "press") return { mode: action, key: value, ref: ref || undefined, after: { include: ["snapshot"] } };
      if (action === "dialog") return { mode: action, action: value || "accept" };
      return { mode: action, ref, value, after: { include: ["snapshot"] } };
    }
    if (action === "upload") return { mode: action, ref, file };
    return { mode: action, ref: ref || undefined, url: value || undefined };
  };

  const run = async () => {
    if (!clientRef.current || !connected || !extensionConnected) return;
    setBusy(true);
    setError("");
    try {
      const response = await clientRef.current.request(mode, buildParams());
      setResult((response && typeof response === "object" ? response : { value: response }) as ToolResult);
    } catch (cause) {
      if (cause instanceof WebBridgeRequestError) setError(`${cause.code}: ${cause.message}`);
      else setError(cause instanceof Error ? cause.message : t("settings.microApps.jianXing.messages.browserFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onFileChange = (selected: File | undefined) => {
    if (!selected) return;
    const reader = new FileReader();
    reader.onload = () => setFile({ name: selected.name, mimeType: selected.type || "application/octet-stream", dataUrl: String(reader.result) });
    reader.readAsDataURL(selected);
  };

  const generateExtensionCode = async () => {
    setExtensionCodeLoading(true);
    try {
      const response = await post<{ code: string }>("/oauth/extension/authorization-code");
      setExtensionCode(response.code);
      message.success(t("settings.microApps.jianXing.messages.codeGenerated"));
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : t("settings.microApps.jianXing.messages.codeGenerateFailed"));
    } finally {
      setExtensionCodeLoading(false);
    }
  };

  const copyExtensionCode = async () => {
    if (!extensionCode) return;
    await navigator.clipboard.writeText(extensionCode);
    message.success(t("settings.microApps.jianXing.messages.codeCopied"));
  };

  const handleDownloadExtension = async () => {
    setExtensionDownloadLoading(true);
    try {
      await downloadBrowserExtension();
      message.success(t("settings.microApps.jianXing.messages.extensionDownloaded"));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : t("settings.microApps.jianXing.messages.extensionDownloadFailed"));
    } finally {
      setExtensionDownloadLoading(false);
    }
  };

  const handleInstallNativeHost = async () => {
    setNativeHostLoading(true);
    try {
      await installNativeMessagingHost();
      const nextStatus = await refreshNativeHostStatus();
      if (nextStatus.status === "installed") {
        message.success(t("settings.microApps.jianXing.messages.nativeInstalled"));
      } else {
        message.warning(nextStatus.reason || t("settings.microApps.jianXing.messages.nativeNeedsRepair"));
      }
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : t("settings.microApps.jianXing.messages.nativeInstallFailed"));
    } finally {
      setNativeHostLoading(false);
    }
  };

  const handleUninstallNativeHost = async () => {
    setNativeHostLoading(true);
    try {
      await uninstallNativeMessagingHost();
      await refreshNativeHostStatus();
      clientRef.current?.close();
      message.success(t("settings.microApps.jianXing.messages.nativeUnregistered"));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : t("settings.microApps.jianXing.messages.nativeUnregisterFailed"));
    } finally {
      setNativeHostLoading(false);
    }
  };

  return (
    <MicroAppPageLayout
      miniTitle={t("settings.microApps.jianXing.page.miniTitle")}
      title={t("settings.microApps.jianXing.page.title")}
      description={t("settings.microApps.jianXing.page.description")}
      contentClassName="gap-4 pt-5"
      slot={<Button size="xs" variant="ghost" onClick={() => setGuideOpen(true)}><BookOpen className="h-4 w-4" />{t("settings.microApps.jianXing.page.guide")}</Button>}
    >
      <JianXingGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />
      {error ? <Alert variant="danger" title={t("settings.microApps.jianXing.operation.error")}>{error}</Alert> : null}
      {visibleOperation ? <Alert variant={status.operationOk === false ? "danger" : "info"} title={t("settings.microApps.jianXing.operation.status")}>{visibleOperation}{status.operationError ? `：${status.operationError}` : ""}</Alert> : null}
      <Card padding="sm" className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-text-primary">{t("settings.microApps.jianXing.connection.chrome")}</div>
          <Badge variant={extensionConnected ? "success" : "warning"}>
            <Circle className="mr-1 inline h-2 w-2 fill-current" />
            {extensionConnected ? t("settings.microApps.jianXing.connection.extensionConnected") : connected ? t("settings.microApps.jianXing.connection.waitingExtension") : t("settings.microApps.jianXing.connection.disconnected")}
          </Badge>
          <Badge variant={nativeHostInstalled ? "success" : nativeHostRepairNeeded ? "warning" : "neutral"}>{nativeHostStatusLabel}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button size="xs" variant="outline" onClick={() => void handleDownloadExtension()} disabled={extensionDownloadLoading || nativeHostChecking || nativeHostStatus?.status === "unsupported"}>
            <Download className="h-4 w-4" />{extensionDownloadLoading ? t("settings.microApps.jianXing.connection.downloading") : t("settings.microApps.jianXing.connection.download")}
          </Button>
          <Button size="xs" variant="outline" onClick={() => void handleInstallNativeHost()} disabled={nativeHostLoading || nativeHostChecking || nativeHostStatus?.status === "unsupported"}>
            <PlugZap className="h-4 w-4" />{nativeHostActionLabel}
          </Button>
          {nativeHostStatus && nativeHostStatus.status !== "not_installed" && nativeHostStatus.status !== "unsupported" ? <Button size="xs" variant="ghost" onClick={() => void handleUninstallNativeHost()} disabled={nativeHostLoading || nativeHostChecking}>{t("settings.microApps.jianXing.connection.unregister")}</Button> : null}
          <Button size="xs" variant="secondary" onClick={() => setExtensionModalOpen(true)}>
            <KeyRound className="h-4 w-4" />{t("settings.microApps.jianXing.connection.authorize")}
          </Button>
          <Button size="xs" variant="outline" onClick={() => (connected ? clientRef.current?.close() : void connect())}>
            <PlugZap className="h-4 w-4" />{connected ? t("settings.microApps.jianXing.connection.disconnect") : t("settings.microApps.jianXing.connection.connect")}
          </Button>
          {nativeHostStatus?.reason ? <span className="text-xs text-text-tertiary">{nativeHostStatus.reason}</span> : null}
          {extensionConnected ? <span className="text-xs text-text-tertiary">{t("settings.microApps.jianXing.connection.extensionVersion", { version: status.extensionVersion || t("settings.microApps.jianXing.connection.unknown") })} · {status.capabilities?.includes("clip_rules") ? t("settings.microApps.jianXing.connection.supportedRegion") : t("settings.microApps.jianXing.connection.unsupportedRegion")}</span> : null}
        </div>
      </Card>
      <NavigationCardTabs<WorkspaceTab>
        tabs={tabItems}
        value={workspaceTab}
        onChange={setWorkspaceTab}
        activeTabStyle="plain"
        className="w-full"
      />
      {workspaceTab === "expert" ? (
        <ExpertPanel extensionConnected={extensionConnected} />
      ) : workspaceTab === "jianxing" ? (
        <div className="grid min-h-0 gap-4 md:grid-cols-2">
          <Card padding="md" className="space-y-4">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-heading-2 text-text-primary">{modes.find((item) => item.id === mode)?.label} · {t("settings.microApps.jianXing.fields.parameters")}</h2><p className="mt-1 text-sm text-text-secondary">{t("settings.microApps.jianXing.fields.parametersHint")}</p></div><Badge variant="neutral">{t("settings.microApps.jianXing.connection.local")}</Badge></div>
            <div className="grid gap-2 sm:grid-cols-2">{modes.map((item) => <button key={item.id} type="button" onClick={() => changeMode(item.id)} className={`rounded-ui-control border px-3 py-2 text-left text-sm ${mode === item.id ? "border-primary bg-primary/5 font-medium" : "border-border text-text-secondary hover:bg-surface-secondary"}`}>{item.label} <span className="ml-1 text-xs text-text-tertiary">{item.id}</span></button>)}</div>
            <Select label={t("settings.microApps.jianXing.fields.operation")} value={action} onChange={setAction} options={actions[mode]} />
            {needsRef ? <TextInput label={t("settings.microApps.jianXing.fields.ref")} value={ref} onChange={setRef} placeholder={t("settings.microApps.jianXing.fields.refPlaceholder")} /> : null}
            {isFileUpload ? (
              <div className="space-y-1">
                <div className="text-sm text-text-secondary">{t("settings.microApps.jianXing.fields.file")}</div>
                <FileUploadDropzone
                  onSelectFiles={(files) => onFileChange(files?.[0])}
                  maxCount={1}
                  helperText={file?.name || t("settings.microApps.jianXing.fields.filePlaceholder")}
                />
              </div>
            ) : null}
            {!isLook && !isFileUpload && !["back", "forward", "reload", "paginate", "scrollTo", "switch", "close"].includes(action) ? <TextInput label={action === "open" || action === "new" ? t("settings.microApps.jianXing.fields.url") : action === "scroll" ? t("settings.microApps.jianXing.fields.scrollAmount") : action === "wait" ? t("settings.microApps.jianXing.fields.waitTime") : action === "drag" ? t("settings.microApps.jianXing.fields.dragRefs") : action === "download" ? t("settings.microApps.jianXing.fields.downloadUrl") : t("settings.microApps.jianXing.fields.value")} value={value} onChange={setValue} placeholder={t("settings.microApps.jianXing.fields.valuePlaceholder")} /> : null}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><span className="text-xs text-text-tertiary">{extensionConnected ? t("settings.microApps.jianXing.fields.sendViaNative") : t("settings.microApps.jianXing.fields.authorizeFirst")}</span><Button variant="primary" onClick={() => void run()} disabled={busy || !extensionConnected || (isFileUpload && !file)}><Send className="h-4 w-4" />{busy ? t("settings.microApps.jianXing.fields.run") : isLook ? t("settings.microApps.jianXing.fields.observe") : t("settings.microApps.jianXing.fields.send")}</Button></div>
          </Card>

          <Card padding="md" className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-heading-2 text-text-primary">{t("settings.microApps.jianXing.result.title")}</h2><Button size="xs" variant="ghost" onClick={() => { setResult(null); setError(""); }}><RotateCcw className="h-4 w-4" />{t("settings.microApps.jianXing.result.clear")}</Button></div><div className="rounded-ui-control border border-border bg-surface-secondary p-3"><div className="text-xs text-text-tertiary">{t("settings.microApps.jianXing.result.currentConnection")}</div><div className="mt-2 text-sm font-medium text-text-primary">{extensionConnected ? t("settings.microApps.jianXing.connection.extensionConnected") : connected ? t("settings.microApps.jianXing.connection.waitingExtension") : t("settings.microApps.jianXing.connection.disconnected")}</div><div className="mt-1 font-mono text-xs text-text-tertiary">{status.status}</div></div>{result ? <div className="space-y-3"><pre className="max-h-[520px] overflow-auto rounded-ui-control border border-border bg-surface-secondary p-3 font-mono text-xs leading-5 text-text-secondary">{jsonText(result)}</pre>{typeof result.dataUrl === "string" ? <img src={result.dataUrl} alt={t("settings.microApps.jianXing.result.screenshot")} className="max-h-64 w-full rounded-ui-control border border-border object-contain" /> : null}</div> : <div className="flex min-h-40 flex-col items-center justify-center text-center text-sm text-text-tertiary"><Eye className="mb-2 h-5 w-5" />{t("settings.microApps.jianXing.result.noResult")}</div>}<div className="border-t border-border pt-3 text-xs text-text-tertiary"><div className="flex items-center gap-2"><FileDown className="h-4 w-4" />{t("settings.microApps.jianXing.result.localOnly")}</div></div></Card>
        </div>
      ) : (
        <Card padding="md" className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
            <h2 className="text-heading-2 text-text-primary">{t("settings.microApps.jianXing.clipper.title")}</h2>
              <Tooltip text={t("settings.microApps.jianXing.clipper.help")} placement="top">
                <span aria-label={t("settings.microApps.jianXing.clipper.help")} className="cursor-help text-icon-secondary">
                  <CircleHelp className="h-3.5 w-3.5" />
                </span>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void loadClipRules()}
                disabled={rulesLoading}
              >
                <RefreshCw className={`h-4 w-4 ${rulesLoading ? "animate-spin" : ""}`} />
                {rulesLoading ? t("settings.microApps.jianXing.clipper.refreshing") : t("settings.microApps.jianXing.clipper.refresh")}
              </Button>
              <Button size="sm" onClick={openNewRuleDrawer}>
                <Plus className="h-4 w-4" />{t("settings.microApps.jianXing.clipper.add")}
              </Button>
            </div>
          </div>
          {rulesError ? <Alert variant="danger" title={t("settings.microApps.jianXing.clipper.refreshFailed")}>{rulesError}</Alert> : null}
          {rulesMessage ? <Alert variant="success" title={t("settings.microApps.jianXing.clipper.status")}>{rulesMessage}</Alert> : null}
          <div className="min-h-0 flex-1 overflow-hidden rounded-ui-control border border-border">
            <Table
              data={configuredRuleRows}
              columns={configuredRuleColumns}
              compact
              stickyHeader
              emptyState={<span className="text-xs text-text-tertiary">{t("settings.microApps.jianXing.clipper.empty")}</span>}
              className="h-full rounded-none border-0 shadow-none"
            />
          </div>
        </Card>
      )}
      <ClipRuleDrawer
        open={ruleDrawerOpen}
        onClose={() => setRuleDrawerOpen(false)}
        ruleKey={ruleKey}
        ruleForm={ruleForm}
        clipRules={clipRules}
        rulesSaving={rulesSaving}
        regionPicking={regionPicking}
        extensionConnected={extensionConnected}
        rulesError={rulesError}
        rulesMessage={rulesMessage}
        onRuleFormChange={updateRuleForm}
        onPickRuleRegion={(kind) => void pickRuleRegion(kind)}
        onRemoveExcludeRegion={removeExcludeRegion}
        onDelete={() => void deleteClipRule()}
        onSave={() => void saveClipRule()}
      />
      <Modal
        open={extensionModalOpen}
        title={t("settings.microApps.jianXing.auth.title")}
        width={560}
        onClose={() => setExtensionModalOpen(false)}
        footer={<Button variant="secondary" size="sm" onClick={() => setExtensionModalOpen(false)}>{t("settings.microApps.jianXing.auth.close")}</Button>}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
            <p className="text-sm leading-6 text-text-secondary">{t("settings.microApps.jianXing.auth.intro")}</p>
          </div>
          <div className="space-y-2">
            <Button size="sm" disabled={extensionCodeLoading} onClick={() => void generateExtensionCode()}>
              <KeyRound className="h-4 w-4" />{extensionCodeLoading ? t("settings.microApps.jianXing.auth.generating") : t("settings.microApps.jianXing.auth.generate")}
            </Button>
            {extensionCode ? <div className="flex min-w-0 items-center gap-2">
              <code title={extensionCode} className="min-w-0 flex-1 truncate rounded-ui-control border border-border bg-surface-secondary px-3 py-2 text-sm font-semibold tracking-[0.16em] text-text-primary">{extensionCode}</code>
              <Button variant="ghost" size="sm" onClick={() => void copyExtensionCode()}><Copy className="h-4 w-4" />{t("settings.microApps.jianXing.auth.copy")}</Button>
            </div> : null}
          </div>
          <p className="text-xs leading-5 text-text-tertiary">{t("settings.microApps.jianXing.auth.expiry")}</p>
        </div>
      </Modal>
    </MicroAppPageLayout>
  );
}
