import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Cloud,
  ExternalLink,
  HelpCircle,
  Link2,
  LoaderCircle,
  Network,
  Plus,
  Smartphone,
  Trash2,
} from "lucide-react";
import AppNotice from "@/app/Layouts/AppNotice";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import {
  checkTailscaleRemoteAccess,
  getTailscaleRemoteAccess,
  revokeTailscaleRemoteDevice,
  updateTailscaleRemoteAccess,
  type TailscaleRemoteAccessSnapshot,
  type TailscaleRemoteRuntimeState,
} from "@/shared/api/generalSettings";
import {
  getRemoteRelayConfig,
  getRemoteRelayStatus,
  updateRemoteRelayConfig,
  type RemoteRelayConnectorSnapshot,
  type RemoteRelayConnectorState,
  type RemoteRelayEndpointMode,
  type RemoteRelayUserConfig,
} from "@/shared/api/remoteAccess";
import { ApiError } from "@/shared/lib/request";
import { openExternalUrl } from "@/shared/platform/desktopRuntime";
import { Badge, Button, Switch, TextInput } from "@/shared/ui";
import { message } from "@/shared/ui/Message";
import { Modal, ModalShell } from "@/shared/ui/Modal";
import SectionCard, { SectionCardRow } from "@/shared/ui/SectionCard";
import TailscaleRemoteAccessGuideDrawer from "./TailscaleRemoteAccessGuideDrawer";
import RemoteDevicePairingModal from "./RemoteDevicePairingModal";
import { getTailscaleRemoteAccessCopy } from "./copy";

const tailscaleStatusVariant = (state: TailscaleRemoteRuntimeState) => {
  if (state === "ready") return "success" as const;
  if (
    state === "serve_conflict" ||
    state === "unreachable" ||
    state === "error"
  ) {
    return "danger" as const;
  }
  if (
    state === "connecting" ||
    state === "serve_not_configured" ||
    state === "needs_login"
  ) {
    return "warning" as const;
  }
  return "muted" as const;
};

const relayStatusVariant = (state: RemoteRelayConnectorState | null) => {
  if (state === "connected") return "success" as const;
  if (state === "connecting") return "warning" as const;
  if (state === "misconfigured" || state === "disconnected") {
    return "danger" as const;
  }
  return "muted" as const;
};

const readErrorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError || error instanceof Error ? error.message : fallback;

export default function RemoteAccessSettings() {
  const { i18n } = useTranslation();
  const copy = getTailscaleRemoteAccessCopy(i18n.resolvedLanguage);
  const isZh = i18n.resolvedLanguage?.toLowerCase().startsWith("zh") ?? true;

  const [snapshot, setSnapshot] =
    useState<TailscaleRemoteAccessSnapshot | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [relayConfig, setRelayConfig] =
    useState<RemoteRelayUserConfig | null>(null);
  const [relaySnapshot, setRelaySnapshot] =
    useState<RemoteRelayConnectorSnapshot | null>(null);
  const [relayMode, setRelayMode] =
    useState<RemoteRelayEndpointMode>("default");
  const [relayCustomUrl, setRelayCustomUrl] = useState("");
  const [relayLoading, setRelayLoading] = useState(true);
  const [relaySaving, setRelaySaving] = useState(false);
  const [relayError, setRelayError] = useState("");

  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] =
    useState<TailscaleRemoteAccessSnapshot | null>(null);

  const applySnapshot = (next: TailscaleRemoteAccessSnapshot) => {
    setSnapshot(next);
    setEnabled(next.config.enabled);
  };

  const applyRelayConfig = (next: RemoteRelayUserConfig) => {
    setRelayConfig(next);
    setRelayMode(next.endpointMode);
    setRelayCustomUrl(next.customUrl);
  };

  const refreshSnapshot = async () => {
    const next = await getTailscaleRemoteAccess();
    applySnapshot(next);
    return next;
  };

  const refreshRelayStatus = async () => {
    const next = await getRemoteRelayStatus();
    setRelaySnapshot(next);
    return next;
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        const next = await getTailscaleRemoteAccess();
        if (!cancelled) {
          applySnapshot(next);
          setError("");
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(readErrorMessage(requestError, copy.messages.loadFailed));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [copy.messages.loadFailed]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setRelayLoading(true);
        const [config, status] = await Promise.all([
          getRemoteRelayConfig(),
          getRemoteRelayStatus(),
        ]);
        if (!cancelled) {
          applyRelayConfig(config);
          setRelaySnapshot(status);
          setRelayError("");
        }
      } catch (requestError) {
        if (!cancelled) {
          setRelayError(
            readErrorMessage(requestError, copy.relay.messages.loadFailed),
          );
        }
      } finally {
        if (!cancelled) setRelayLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [copy.relay.messages.loadFailed]);

  const runtime = snapshot?.runtime;
  const statusCopy = runtime
    ? copy.status.states[runtime.state]
    : copy.status.states.connecting;
  const relayState = relaySnapshot?.state ?? null;
  const relayLabel = relayLoading
    ? copy.actions.checking
    : relayState
      ? copy.relay.states[relayState]
      : copy.relay.states.unavailable;
  const dirty = snapshot ? enabled !== snapshot.config.enabled : false;
  const canChangeRemoteAccess =
    runtime?.state === "connected" ||
    runtime?.state === "ready" ||
    runtime?.state === "unreachable" ||
    runtime?.state === "serve_not_configured";
  const canPairDevice =
    (runtime?.state === "ready" || relayState === "connected") &&
    !loading &&
    !checking &&
    !saving &&
    !relayLoading &&
    !relaySaving;

  const saveRelay = async (input: {
    enabled?: boolean;
    endpointMode?: RemoteRelayEndpointMode;
    customUrl?: string;
  }) => {
    setRelaySaving(true);
    setRelayError("");
    try {
      const next = await updateRemoteRelayConfig(input);
      applyRelayConfig(next);
      await refreshRelayStatus();
      return next;
    } catch (requestError) {
      setRelayError(
        readErrorMessage(requestError, copy.relay.messages.saveFailed),
      );
      return null;
    } finally {
      setRelaySaving(false);
    }
  };

  const handleRelayEnabledChange = () => {
    if (!relayConfig) return;
    void saveRelay({
      enabled: !relayConfig.enabled,
      endpointMode: relayMode,
      customUrl: relayCustomUrl,
    });
  };

  const handleRelayModeChange = (mode: RemoteRelayEndpointMode) => {
    setRelayMode(mode);
    if (!relayConfig) return;

    if (mode === "default") {
      void saveRelay({ endpointMode: mode });
      return;
    }

    if (!relayConfig.enabled || relayCustomUrl.trim()) {
      void saveRelay({ endpointMode: mode, customUrl: relayCustomUrl });
    }
  };

  const commitRelayCustomUrl = () => {
    if (!relayConfig || relayMode !== "custom") return;
    const normalized = relayCustomUrl.trim();
    if (
      relayConfig.endpointMode === "custom" &&
      relayConfig.customUrl === normalized
    ) {
      return;
    }
    void saveRelay({ endpointMode: "custom", customUrl: normalized });
  };

  const renderDiagnostics = (nextSnapshot: TailscaleRemoteAccessSnapshot) => {
    const nextRuntime = nextSnapshot.runtime;
    const nextServeValue = nextRuntime.serveManagedByMira
      ? copy.diagnostics.serveManaged
      : nextRuntime.serveConfigured
        ? copy.diagnostics.serveOther
        : copy.diagnostics.serveMissing;
    const nextHealthValue =
      nextRuntime.healthOk === true
        ? copy.diagnostics.healthOk
        : nextRuntime.healthOk === false
          ? copy.diagnostics.healthFailed
          : copy.diagnostics.healthPending;
    const checkedAtValue = nextRuntime.checkedAt
      ? new Date(nextRuntime.checkedAt)
      : null;
    const nextCheckedAt =
      checkedAtValue && !Number.isNaN(checkedAtValue.getTime())
        ? new Intl.DateTimeFormat(i18n.resolvedLanguage || "zh-CN", {
            dateStyle: "medium",
            timeStyle: "medium",
          }).format(checkedAtValue)
        : nextRuntime.checkedAt || "-";

    return (
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">
            {copy.device.title}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label={copy.device.name}
              value={nextRuntime.deviceName || copy.device.unavailable}
              onChange={() => void 0}
              disabled
            />
            <TextInput
              label={copy.device.tailnet}
              value={
                nextRuntime.tailnetDomain ||
                nextRuntime.tailnetName ||
                copy.device.unavailable
              }
              onChange={() => void 0}
              disabled
            />
          </div>
          <div className="rounded-ui-panel border border-border bg-surface-secondary px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-text-secondary">
                <Link2 className="h-3.5 w-3.5 shrink-0" />
                {copy.device.accessAddress}
              </div>
              {nextRuntime.accessUrl ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={nextRuntime.state !== "ready"}
                  onClick={() => void openExternalUrl(nextRuntime.accessUrl!)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {copy.device.open}
                </Button>
              ) : null}
            </div>
            <div className="mt-2 break-all font-mono text-sm text-text-primary">
              {nextRuntime.accessUrl || copy.device.unavailable}
            </div>
          </div>
        </section>

        <section>
          <div className="-mx-4 divide-y divide-border border-y border-border">
            {[
              [copy.diagnostics.version, nextRuntime.version || "-"],
              [copy.diagnostics.backend, nextRuntime.backendState || "-"],
              [
                copy.diagnostics.ips,
                nextRuntime.tailscaleIps.length
                  ? nextRuntime.tailscaleIps.join(", ")
                  : "-",
              ],
              [copy.diagnostics.serve, nextServeValue],
              [copy.diagnostics.health, nextHealthValue],
              [copy.diagnostics.checkedAt, nextCheckedAt],
            ].map(([label, value]) => (
              <SectionCardRow
                key={label}
                className="grid-cols-[minmax(140px,1fr)_minmax(0,2fr)]"
              >
                <span className="text-sm text-text-secondary">{label}</span>
                <span className="min-w-0 w-full break-words text-right font-mono text-xs text-text-primary">
                  {value}
                </span>
              </SectionCardRow>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const handleDiagnose = async () => {
    setChecking(true);
    setError("");
    try {
      let next = await checkTailscaleRemoteAccess();
      applySnapshot(next);

      if (enabled !== next.config.enabled) {
        setSaving(true);
        next = await updateTailscaleRemoteAccess(enabled);
        applySnapshot(next);
        message.success(copy.messages.saved);
      }

      setDiagnosticsSnapshot(next);
    } catch (requestError) {
      setError(
        readErrorMessage(
          requestError,
          dirty ? copy.messages.saveFailed : copy.messages.checkFailed,
        ),
      );
    } finally {
      setSaving(false);
      setChecking(false);
    }
  };

  const handleRevokeDevice = (id: string, name: string) => {
    Modal.confirm({
      title: copy.devices.revoke,
      description: name,
      tone: "danger",
      confirmText: copy.devices.revoke,
      cancelText: isZh ? "取消" : "Cancel",
      onConfirm: async () => {
        setRevokingDeviceId(id);
        try {
          await revokeTailscaleRemoteDevice(id);
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  pairedDevices: current.pairedDevices.filter(
                    (device) => device.id !== id,
                  ),
                }
              : current,
          );
          message.success(copy.devices.revoked);
        } catch (requestError) {
          message.error(
            readErrorMessage(requestError, copy.devices.revokeFailed),
          );
        } finally {
          setRevokingDeviceId(null);
        }
      },
      onCancel: () => void 0,
    });
  };

  return (
    <>
      <AppPageLayout
        miniTitle={copy.page.miniTitle}
        title={copy.page.title}
        slot={
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setGuideOpen(true)}
          >
            <HelpCircle className="h-4 w-4" />
            {copy.actions.help}
          </Button>
        }
        contentClassName="space-y-4 pt-6"
        contentMode="flow"
      >
        {error ? <AppNotice tone="danger">{error}</AppNotice> : null}

        <SectionCard
          title={copy.relay.title}
          icon={<Cloud className="h-4 w-4" />}
          meta={
            <Badge variant={relayStatusVariant(relayState)} outline>
              {relayLabel}
            </Badge>
          }
          action={
            <Switch
              checked={relayConfig?.enabled ?? false}
              onChange={handleRelayEnabledChange}
              ariaLabel={copy.relay.title}
              disabled={relayLoading || relaySaving || !relayConfig}
            />
          }
          divided
        >
          <SectionCardRow>
            <div
              className="flex flex-wrap items-center gap-x-6 gap-y-2"
              role="radiogroup"
              aria-label={copy.relay.title}
            >
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name="remote-relay-endpoint"
                  value="default"
                  checked={relayMode === "default"}
                  onChange={() => handleRelayModeChange("default")}
                  disabled={relayLoading || relaySaving}
                  className="h-4 w-4 accent-primary"
                />
                {copy.relay.default}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name="remote-relay-endpoint"
                  value="custom"
                  checked={relayMode === "custom"}
                  onChange={() => handleRelayModeChange("custom")}
                  disabled={relayLoading || relaySaving}
                  className="h-4 w-4 accent-primary"
                />
                {copy.relay.custom}
              </label>
            </div>
          </SectionCardRow>

          {relayMode === "custom" ? (
            <div className="px-4 py-3">
              <label className="block text-xs font-medium text-text-secondary">
                {copy.relay.customAddress}
              </label>
              <input
                type="url"
                value={relayCustomUrl}
                placeholder={copy.relay.customPlaceholder}
                disabled={relayLoading || relaySaving}
                onChange={(event) => setRelayCustomUrl(event.target.value)}
                onBlur={commitRelayCustomUrl}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="mt-2 h-9 w-full rounded-ui-control border border-border bg-surface-primary px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-primary"
              />
            </div>
          ) : null}

          {relayError ? (
            <div className="px-4 py-3 text-xs text-danger-text">{relayError}</div>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Tailscale"
          icon={<Network className="h-4 w-4" />}
          action={
            <Button
              size="xs"
              variant="secondary"
              disabled={loading || checking || saving}
              onClick={() => void handleDiagnose()}
            >
              {checking ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {checking
                ? saving
                  ? copy.actions.saving
                  : copy.actions.checking
                : copy.actions.diagnose}
            </Button>
          }
          divided
        >
          <SectionCardRow>
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-primary">
                {copy.status.connection}
              </div>
              {runtime?.error ? (
                <div className="mt-1 text-xs leading-5 text-danger-text">
                  {runtime.error}
                </div>
              ) : null}
            </div>
            <Badge
              variant={runtime ? tailscaleStatusVariant(runtime.state) : "muted"}
              outline
            >
              {loading ? copy.actions.checking : statusCopy[0]}
            </Badge>
          </SectionCardRow>

          <SectionCardRow>
            <div className="text-sm font-medium text-text-primary">
              {copy.status.enable}
            </div>
            <Switch
              checked={enabled}
              onChange={() => setEnabled((current) => !current)}
              ariaLabel={copy.status.enable}
              disabled={
                loading || checking || saving || !canChangeRemoteAccess
              }
            />
          </SectionCardRow>
        </SectionCard>

        <SectionCard
          title={copy.devices.title}
          icon={<Smartphone className="h-4 w-4" />}
          action={
            <Button
              size="xs"
              variant="secondary"
              disabled={!canPairDevice}
              title={
                canPairDevice
                  ? undefined
                  : isZh
                    ? "请先连接 Tailscale 或 Mira Relay"
                    : "Connect Tailscale or Mira Relay before pairing"
              }
              onClick={() => setPairingOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {isZh ? "配对新设备" : "Pair device"}
            </Button>
          }
          divided={Boolean(snapshot?.pairedDevices.length)}
          contentClassName={snapshot?.pairedDevices.length ? undefined : "p-4"}
        >
          {snapshot?.pairedDevices.length ? (
            snapshot.pairedDevices.map((device) => (
              <SectionCardRow key={device.id}>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary">
                    {device.name}
                  </div>
                  <div className="mt-0.5 text-xs text-text-secondary">
                    {device.platform} · {copy.devices.lastSeen}: {" "}
                    {device.lastSeenAt || copy.devices.neverSeen}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {device.permissions.map((permission) => (
                      <Badge key={permission} variant="muted" outline>
                        {permission}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={revokingDeviceId === device.id}
                  onClick={() => handleRevokeDevice(device.id, device.name)}
                >
                  {revokingDeviceId === device.id ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  {copy.devices.revoke}
                </Button>
              </SectionCardRow>
            ))
          ) : (
            <div className="px-1 py-2 text-sm text-text-secondary">
              {copy.devices.empty}
            </div>
          )}
        </SectionCard>
      </AppPageLayout>

      <TailscaleRemoteAccessGuideDrawer
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
      />
      <RemoteDevicePairingModal
        open={pairingOpen}
        onClose={() => setPairingOpen(false)}
        onPaired={async () => {
          await refreshSnapshot();
        }}
      />
      <ModalShell
        open={Boolean(diagnosticsSnapshot)}
        title={copy.diagnostics.title}
        width={640}
        onClose={() => setDiagnosticsSnapshot(null)}
      >
        {diagnosticsSnapshot ? renderDiagnostics(diagnosticsSnapshot) : null}
      </ModalShell>
    </>
  );
}
