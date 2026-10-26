import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, LockKeyhole, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import SectionCard, { SectionCardRow } from "@/shared/ui/SectionCard";
import SettingsPageLayout from "../../components/SettingsPageLayout";

const SCOPE_OPTIONS = [
  ["threads:read", "读取会话", "Read threads"],
  ["messages:read", "读取消息", "Read messages"],
  ["messages:write", "发送消息", "Write messages"],
  ["agent:read", "查看 Agent", "Read Agent"],
  ["agent:approve", "Agent 审批", "Approve Agent"],
  ["agent:control", "控制 Agent", "Control Agent"],
  ["tools:read", "查看工具", "Read tools"],
  ["tools:invoke", "调用工具", "Invoke tools"],
  ["tools:approve", "工具审批", "Approve tools"],
  ["tools:control", "控制工具", "Control tools"],
  ["artifacts:read", "读取产物", "Read artifacts"],
] as const;

type CloudView = Awaited<ReturnType<NonNullable<Window["cloudAccount"]>["status"]>>;
const emptyView: CloudView = {
  status: "checking", account: null, hostId: null, scopes: [],
  message: "", expiresAt: null, permissionsConfigured: false,
};

export default function AccountSettings() {
  const api = window.cloudAccount;
  const { i18n } = useTranslation();
  const english = i18n.resolvedLanguage?.toLowerCase().startsWith("en") ?? false;
  const [view, setView] = useState<CloudView>(emptyView);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!api) return;
    let active = true;
    const dispose = api.subscribe((next) => { if (active) setView(next); });
    void api.status().then((next) => { if (active) setView(next); })
      .catch(() => { if (active) setError("无法读取 Cloud Account 状态"); });
    return () => { active = false; dispose(); };
  }, [api]);

  const signIn = async () => {
    if (!api) return;
    setBusy(true); setError("");
    try {
      const result = await api.signIn(selected);
      if (result && typeof result === "object" && "status" in result) {
        setView(result as CloudView);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法发起云登录");
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    if (!api) return;
    setBusy(true); setError("");
    try { setView(await api.signOut() as CloudView); }
    catch (err) { setError(err instanceof Error ? err.message : "云账号退出失败"); }
    finally { setBusy(false); }
  };
  const toggle = (scope: string) => {
    setSelected((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : [...current, scope]);
  };
  const hasNative = Boolean(api);
  const canSignIn = hasNative && !busy &&
    (view.status === "signed_out" || view.status === "rejected");
  const signedIn = Boolean(view.account) &&
    (view.status === "signed_in" || view.status === "unavailable" ||
     view.status === "setup_failed");

  return (
    <SettingsPageLayout miniTitle="Mira Cloud" title={english ? "Cloud Account" : "云账号"}
      description={english
        ? "Optional cloud identity, separate from your local Mira sign-in."
        : "可选的云端身份，与 Mira 本地账户和工作空间完全独立。"}
      contentMode="flow">
      <div className="space-y-4 pt-3">
        <SectionCard title={english ? "Mira Cloud Account" : "Mira 云账号"}
          icon={<Cloud size={18} />} contentClassName="space-y-0">
          <SectionCardRow>
            <div className="min-w-0">
              <p className="font-medium text-sm text-text-primary">
                {signedIn ? view.account?.username : "Mira Cloud"}
              </p>
              <p className="text-xs text-text-secondary">
                {!hasNative ? "此构建尚不支持原生 Cloud OAuth，请使用支持的 Desktop 客户端。" :
                 view.status === "checking" ? "正在检查云端会话…" :
                 view.status === "signed_in" ? "云账号已登录" :
                 view.status === "authorizing" ? "等待系统浏览器授权" :
                 view.status === "unavailable" ? "云服务暂不可用，本地 Mira 不受影响" :
                 view.status === "rejected" ? "云凭据已失效，本地 Mira 不受影响" :
                 view.status === "setup_failed" ? "云账号已登录，但首次授权尚未完成" :
                 "当前未登录云账号"}
              </p>
            </div>
            {signedIn ?
              <Button variant="outline" disabled={busy} onClick={() => void signOut()}>
                {english ? "Sign out" : "退出云账号"}
              </Button> :
              <span className="text-xs text-text-secondary">
                <LockKeyhole size={16} aria-hidden="true" />
              </span>}
          </SectionCardRow>
          {view.message ? <p role="status" className="px-4 pb-3 text-sm text-text-secondary">{view.message}</p> : null}
          {error ? <p role="alert" className="px-4 pb-3 text-sm text-danger-text">{error}</p> : null}
        </SectionCard>

        {signedIn && view.permissionsConfigured ? (
          <SectionCard title={english ? "Authorized Mobile scopes" : "已保存的手机访问权限"}>
            <div className="space-y-2 px-4 py-4 text-sm">
              <p className="text-text-secondary">授权仅代表云端允许范围。具体执行还必须通过 Desktop Gateway 和 Harness 检查。</p>
              <div className="flex flex-wrap gap-2">
                {view.scopes.length === 0 ? <span>未开放任何权限</span> :
                  view.scopes.map((scope) => (
                    <span key={scope} className="rounded-ui-control border border-border bg-surface-secondary px-2 py-1 text-xs">
                      {SCOPE_OPTIONS.find(([id]) => id === scope)?.[english ? 2 : 1] ?? scope}
                    </span>
                  ))}
              </div>
              <p className="text-xs text-text-secondary">修改或撤销某台手机的权限，请前往 Mira Cloud Account Portal。</p>
            </div>
          </SectionCard>
        ) : !signedIn && hasNative ? (
          <SectionCard title={english ? "Set initial Mobile Host permissions" : "登录时设置手机可访问的权限"}
            icon={<LockKeyhole size={16} />}>
            <div className="space-y-4 p-4">
              <p className="text-sm leading-6 text-text-secondary">
                {english ? "Choose initial Mobile scopes before sign-in; all start disabled. If this Host already has a Cloud policy, its existing scopes are preserved. Change them later in Cloud Portal. No QR pairing is needed."
                  : "首次登录可选择手机可调用的权限，默认全部关闭；若云端已有此 Host 的权限策略，将保留原设置，后续可在 Cloud Portal 修改。不需要二维码或现场配对。"}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {SCOPE_OPTIONS.map(([id, zh, en]) => (
                  <label key={id} className="flex cursor-pointer items-center gap-3 rounded-ui-control border border-border px-3 py-2 text-sm text-text-primary">
                    <input type="checkbox" checked={selected.includes(id)}
                      disabled={!canSignIn} onChange={() => toggle(id)}
                      aria-label={english ? en : zh} />
                    <span>{english ? en : zh}</span>
                  </label>
                ))}
              </div>
              <Button variant="primary" disabled={!canSignIn} onClick={() => void signIn()}>
                {busy ? <RefreshCw size={16} /> : <Cloud size={16} />}
                {english ? "Sign in via system browser" : "使用系统浏览器登录云账号"}
              </Button>
              <p className="text-xs text-text-secondary">Cloud 登录不会替换本地账户、Provider Key、MCP 密钥或 Tailscale 配对。</p>
            </div>
          </SectionCard>
        ) : null}
      </div>
    </SettingsPageLayout>
  );
}
