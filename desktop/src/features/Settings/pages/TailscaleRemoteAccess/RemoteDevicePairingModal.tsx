import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  Clipboard,
  LoaderCircle,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import {
  approveRemotePairingClaim,
  createRemotePairingChallenge,
  getRemotePairingChallenge,
  rejectRemotePairingClaim,
  type CreatedPairingChallenge,
  type PairingChallengeView,
  type RemoteDeviceScope,
} from "@/shared/api/remoteAccess";
import { ApiError } from "@/shared/lib/request";
import { Button } from "@/shared/ui";
import { ModalShell } from "@/shared/ui/Modal";
import SettingsNotice from "../../components/SettingsNotice";

const readError = (error: unknown, fallback: string) =>
  error instanceof ApiError || error instanceof Error ? error.message : fallback;

const scopeLabels: Record<RemoteDeviceScope, { zh: string; en: string }> = {
  "threads:read": { zh: "读取会话", en: "Read threads" },
  "messages:read": { zh: "读取消息", en: "Read messages" },
  "messages:write": { zh: "发送消息", en: "Send messages" },
  "agent:read": { zh: "读取 Agent 状态", en: "Read agent state" },
  "agent:approve": { zh: "审批工具调用", en: "Approve tool calls" },
  "agent:control": { zh: "停止 Agent", en: "Control agent runs" },
  "tools:read": { zh: "查看远程工具", en: "Discover remote tools" },
  "tools:invoke": { zh: "调用远程工具", en: "Invoke remote tools" },
  "tools:approve": { zh: "审批远程工具", en: "Approve remote tools" },
  "tools:control": { zh: "取消远程工具", en: "Cancel remote tools" },
  "artifacts:read": { zh: "读取产物", en: "Read artifacts" },
};

export default function RemoteDevicePairingModal({
  open,
  onClose,
  onPaired,
}: {
  open: boolean;
  onClose: () => void;
  onPaired: () => void | Promise<void>;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.resolvedLanguage?.toLowerCase().startsWith("zh") ?? true;
  const [challenge, setChallenge] = useState<CreatedPairingChallenge | null>(null);
  const [current, setCurrent] = useState<PairingChallengeView | null>(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"code" | "uri" | null>(null);
  const [scopeSelection, setScopeSelection] = useState<{
    claimId: string | null;
    scopes: RemoteDeviceScope[];
  }>({ claimId: null, scopes: [] });

  const copy = useMemo(
    () =>
      zh
        ? {
            title: "配对手机设备",
            intro: "配对挑战五分钟后失效。",
            loading: "正在创建一次性配对挑战...",
            failed: "创建配对挑战失败",
            uri: "配对链接",
            scan: "使用 Mira Mobile 扫描",
            fallback: "无法扫码时，复制完整配对链接到手机端。",
            copy: "复制",
            copied: "已复制",
            waiting: "等待手机提交设备信息",
            waitingHint:
              "在 Mira Mobile 中扫描二维码，或粘贴完整配对链接。手机提交后，这里会出现确认信息。",
            requestTitle: "设备请求",
            fingerprint: "公钥指纹",
            transport: "申请通道",
            transportRelay: "Mira Relay",
            transportDirect: "Tailscale Direct",
            transportUnknown: "未知",
            scopes: "申请权限",
            scopeHint: "批准前可以缩减权限，不能增加手机未申请的权限。",
            scopeRequired: "至少保留一项权限才能批准设备。",
            approve: "批准设备",
            reject: "拒绝",
            approved: "设备已批准，等待手机领取凭证",
            delivered: "手机已经领取设备凭证",
            rejected: "本次配对已拒绝",
            expired: "配对挑战已过期，请重新生成",
            close: "关闭",
            approveFailed: "批准设备失败",
            rejectFailed: "拒绝设备失败",
          }
        : {
            title: "Pair a mobile device",
            intro: "This pairing challenge expires in five minutes.",
            loading: "Creating a one-time pairing challenge...",
            failed: "Failed to create pairing challenge",
            uri: "Pairing URI",
            scan: "Scan with Mira Mobile",
            fallback: "If scanning is unavailable, paste the complete pairing URI on the phone.",
            copy: "Copy",
            copied: "Copied",
            waiting: "Waiting for the phone to submit device details",
            waitingHint:
              "Scan the QR code in Mira Mobile, or paste the complete pairing URI. The device request will appear here for confirmation.",
            requestTitle: "Device request",
            fingerprint: "Public-key fingerprint",
            transport: "Request channel",
            transportRelay: "Mira Relay",
            transportDirect: "Tailscale Direct",
            transportUnknown: "Unknown",
            scopes: "Requested access",
            scopeHint:
              "You may reduce access before approval, but cannot add permissions the phone did not request.",
            scopeRequired: "Select at least one permission before approval.",
            approve: "Approve device",
            reject: "Reject",
            approved: "Device approved; waiting for mobile to collect its credential",
            delivered: "Mobile collected the device credential",
            rejected: "This pairing request was rejected",
            expired: "The pairing challenge expired. Generate a new one.",
            close: "Close",
            approveFailed: "Failed to approve device",
            rejectFailed: "Failed to reject device",
          },
    [zh],
  );

  useEffect(() => {
    if (!open) {
      setChallenge(null);
      setCurrent(null);
      setError("");
      setCopied(null);
      setScopeSelection({ claimId: null, scopes: [] });
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const created = await createRemotePairingChallenge();
        if (!cancelled) {
          setChallenge(created);
          setCurrent(created);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(readError(requestError, copy.failed));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [copy.failed, open]);

  useEffect(() => {
    if (!open || !challenge || !current) {
      return;
    }
    if (!["pending", "claimed", "approved"].includes(current.status)) {
      return;
    }

    let stopped = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const next = await getRemotePairingChallenge(challenge.challengeId);
          if (!stopped) {
            setCurrent(next);
          }
        } catch (requestError) {
          if (!stopped) {
            setError(readError(requestError, copy.failed));
          }
        }
      })();
    }, 1500);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [challenge, copy.failed, current, open]);

  const requestedScopes = current?.claim?.requestedScopes ?? [];
  const selectedScopes =
    scopeSelection.claimId === current?.claim?.claimId
      ? scopeSelection.scopes
      : requestedScopes;

  const toggleScope = (scope: RemoteDeviceScope, checked: boolean) => {
    if (!current?.claim) return;
    const nextScopes = checked
      ? requestedScopes.filter(
          (requestedScope) =>
            requestedScope === scope || selectedScopes.includes(requestedScope),
        )
      : selectedScopes.filter((selectedScope) => selectedScope !== scope);
    setScopeSelection({
      claimId: current.claim.claimId,
      scopes: nextScopes,
    });
  };

  const handleCopy = async (kind: "code" | "uri", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied((currentValue) => (currentValue === kind ? null : currentValue)), 1500);
  };

  const handleApprove = async () => {
    if (!current?.claim || selectedScopes.length === 0) return;
    setApproving(true);
    setError("");
    try {
      const next = await approveRemotePairingClaim(
        current.claim.claimId,
        selectedScopes,
      );
      setCurrent(next);
      await onPaired();
    } catch (requestError) {
      setError(readError(requestError, copy.approveFailed));
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!current?.claim) return;
    setRejecting(true);
    setError("");
    try {
      setCurrent(await rejectRemotePairingClaim(current.claim.claimId));
    } catch (requestError) {
      setError(readError(requestError, copy.rejectFailed));
    } finally {
      setRejecting(false);
    }
  };

  const statusNotice =
    current?.status === "approved"
      ? copy.approved
      : current?.status === "delivered"
        ? copy.delivered
        : current?.status === "rejected"
          ? copy.rejected
          : current?.status === "expired"
            ? copy.expired
            : null;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={copy.title}
      width={620}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {copy.close}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-text-secondary">{copy.intro}</p>

        {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div className="flex flex-col items-center text-center">
              <div
                aria-label={copy.loading}
                className="h-[220px] w-[220px] animate-pulse rounded-ui-control border border-border bg-surface-secondary"
              />
              <div className="mt-3 h-4 w-32 animate-pulse rounded bg-surface-secondary" />
            </div>
            <div className="min-w-0 space-y-3">
              <div className="h-24 animate-pulse rounded-ui-panel border border-border bg-surface-secondary" />
              <div className="h-36 animate-pulse rounded-ui-panel border border-border bg-surface-secondary" />
            </div>
          </div>
        ) : challenge ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
              <div className="flex flex-col items-center text-center">
                <QRCodeSVG
                  value={challenge.pairingUri}
                  size={204}
                  level="M"
                  marginSize={2}
                  title={copy.scan}
                  className="rounded-ui-control border border-border bg-white p-2"
                />
                <div className="mt-3 text-sm font-medium text-text-primary">
                  {copy.scan}
                </div>
              </div>

              <div className="min-w-0 space-y-3">
                <div className="min-w-0 rounded-ui-panel border border-border bg-surface-secondary p-4">
                  <div className="text-xs font-medium text-text-secondary">{copy.uri}</div>
                  <div className="mt-2 max-h-20 overflow-auto break-all font-mono text-xs leading-5 text-text-primary">
                    {challenge.pairingUri}
                  </div>
                  <Button
                    className="mt-3"
                    size="xs"
                    variant="ghost"
                    onClick={() => void handleCopy("uri", challenge.pairingUri)}
                  >
                    {copied === "uri" ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                    {copied === "uri" ? copy.copied : copy.copy}
                  </Button>
                  <div className="mt-2 text-xs leading-5 text-text-tertiary">
                    {copy.fallback}
                  </div>
                </div>
              </div>
            </div>

            {statusNotice ? (
              <SettingsNotice
                tone={current?.status === "rejected" || current?.status === "expired" ? "danger" : "success"}
              >
                {statusNotice}
              </SettingsNotice>
            ) : current?.claim ? (
              <div className="rounded-ui-panel border border-border bg-surface-primary p-4 shadow-shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2 text-primary">
                    <Smartphone className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text-primary">{copy.requestTitle}</div>
                    <div className="mt-1 text-sm text-text-primary">
                      {current.claim.deviceName} · {current.claim.platform}
                    </div>
                    <div className="mt-1 text-xs text-text-secondary">
                      {copy.transport}: {current.claim.transport === "relay"
                        ? copy.transportRelay
                        : current.claim.transport === "direct"
                          ? copy.transportDirect
                          : copy.transportUnknown}
                    </div>
                    {current.claim.publicKeyFingerprint ? (
                      <div className="mt-1 font-mono text-xs text-text-secondary">
                        {copy.fingerprint}: {current.claim.publicKeyFingerprint}
                      </div>
                    ) : null}

                    <div className="mt-3 flex items-center gap-2 text-xs font-medium text-text-secondary">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {copy.scopes}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-text-tertiary">
                      {copy.scopeHint}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {requestedScopes.map((scope) => (
                        <label
                          key={scope}
                          className="flex items-center gap-2 rounded-ui-control border border-border bg-surface-secondary px-3 py-2 text-xs text-text-secondary"
                        >
                          <input
                            type="checkbox"
                            checked={selectedScopes.includes(scope)}
                            aria-label={scopeLabels[scope][zh ? "zh" : "en"]}
                            className="h-4 w-4 rounded border-border accent-primary focus:ring-primary/20"
                            onChange={(event) =>
                              toggleScope(scope, event.target.checked)
                            }
                          />
                          {scopeLabels[scope][zh ? "zh" : "en"]}
                        </label>
                      ))}
                    </div>
                    {selectedScopes.length === 0 ? (
                      <div className="mt-2 text-xs text-status-danger">
                        {copy.scopeRequired}
                      </div>
                    ) : null}

                    <div className="mt-4 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="danger-outline"
                        disabled={approving || rejecting}
                        onClick={() => void handleReject()}
                      >
                        {rejecting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        {copy.reject}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={
                          approving || rejecting || selectedScopes.length === 0
                        }
                        onClick={() => void handleApprove()}
                      >
                        {approving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        {copy.approve}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-ui-panel border border-dashed border-border bg-surface-secondary px-4 py-5 text-center">
                <div className="text-sm font-medium text-text-primary">{copy.waiting}</div>
                <div className="mt-1 text-xs leading-5 text-text-secondary">{copy.waitingHint}</div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </ModalShell>
  );
}
