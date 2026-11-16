import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, LockKeyhole, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import SectionCard, { SectionCardRow } from "@/shared/ui/SectionCard";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import { useAuth } from "@/app/providers/AuthProvider";

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

export default function CloudAccountPage() {
  const api = window.cloudAccount;
  const { session, isCheckingSession } = useAuth();
  const { i18n } = useTranslation();
  const english = i18n.resolvedLanguage?.toLowerCase().startsWith("en") ?? false;
  const [view, setView] = useState<CloudView>(emptyView);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [policyScopes, setPolicyScopes] = useState<string[]>([]);
  const [policyRevision, setPolicyRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Different Cloud accounts never inherit a previous user's initial Host scope choices.
  useEffect(() => {
    setSelected([]);
    setEditingPolicy(false);
    setPolicyScopes([]);
    setPolicyRevision(null);
  }, [view.account?.id]);

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
      if (isCheckingSession || !session?.token) {
        throw new Error("请先登录 Mira 本地账户，再关联云账号");
      }
      const result = await api.signIn(selected, session.token);
      if (result && typeof result === "object" && "status" in result) {
        setView(result as CloudView);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法发起云登录");
    } finally {
      setBusy(false);
    }
  };
  const cancelSignIn = async () => {
    if (!api) return;
    setError("");
    try { setView(await api.cancelSignIn() as CloudView); }
    catch (err) { setError(err instanceof Error ? err.message : "无法取消云账号授权"); }
  };
  const retryHostSetup = async () => {
    if (!api) return;
    setBusy(true); setError("");
    try { setView(await api.retryHostSetup() as CloudView); }
    catch (err) { setError(err instanceof Error ? err.message : "Host 权限重试失败"); }
    finally { setBusy(false); }
  };
  const resetLocalCredentials = async () => {
    if (!api) return;
    setBusy(true); setError("");
    try { setView(await api.resetLocalCredentials() as CloudView); setSelected([]); }
    catch (err) { setError(err instanceof Error ? err.message : "无法重置本机 Cloud 凭据"); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    if (!api) return;
    setBusy(true); setError("");
    try { setView(await api.signOut() as CloudView); setSelected([]); }
    catch (err) { setError(err instanceof Error ? err.message : "云账号退出失败"); }
    finally { setBusy(false); }
  };
  const beginPolicyEdit = async () => {
    if (!api || !session?.token || isCheckingSession ||
        view.status !== "signed_in" || view.localOwnerBound !== true) {
      setError("请先登录当前 Mira 本地账户并确认云端 Host 身份");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // The server's CURRENT policy is the edit baseline, never the restored
      // encrypted local snapshot or a renderer-owned default.
      const fresh = await api.readHostPolicy(session.token);
      setPolicyScopes(fresh.scopes);
      setPolicyRevision(fresh.revision);
      setEditingPolicy(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取云端 Host 权限失败");
    } finally {
      setBusy(false);
    }
  };
  const updateHostPolicy = async () => {
    if (!api || !session?.token || isCheckingSession ||
        view.status !== "signed_in" || view.localOwnerBound !== true ||
        policyRevision === null) {
      setError("请先从 Cloud Auth 读取最新 Host 授权，再保存");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Native compares against the latest server snapshot and obtains a
      // trusted Electron-owned confirmation before ANY scope widening.
      setView(await api.updateHostPolicy(policyScopes, policyRevision, session.token));
      setEditingPolicy(false);
      setPolicyRevision(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "云端 Host 授权保存失败");
    } finally {
      setBusy(false);
    }
  };
  const togglePolicyScope = (scope: string) => {
    setPolicyScopes((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : [...current, scope]);
  };
  const toggle = (scope: string) => {
    setSelected((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : [...current, scope]);
  };
  const hasNative = Boolean(api);
  const canSignIn = hasNative && !busy && !isCheckingSession &&
    Boolean(session?.token) &&
    (view.status === "signed_out" || view.status === "rejected");
  const signedIn = Boolean(view.account) &&
    (view.status === "signed_in" || view.status === "unavailable" ||
     view.status === "setup_failed" || view.status === "checking");

  return (
    <AppPageLayout miniTitle="Mira Cloud" title={english ? "Cloud Account" : "云账号"}
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
              <div className="flex flex-wrap gap-2">
                {view.status === "setup_failed" ? (
                  <Button variant="primary" disabled={busy} onClick={() => void retryHostSetup()}>
                    {english ? "Retry Host setup" : "重试 Host 权限设置"}
                  </Button>
                ) : null}
                <Button variant="outline" disabled={busy} onClick={() => void signOut()}>
                  {english ? "Sign out" : "退出云账号"}
                </Button>
              </div> :
              view.status === "authorizing" && hasNative ?
              <Button variant="outline" onClick={() => void cancelSignIn()}>
                {english ? "Cancel sign-in" : "取消本次授权"}
              </Button> :
              <span className="text-xs text-text-secondary">
                <LockKeyhole size={16} aria-hidden="true" />
              </span>}
          </SectionCardRow>
          {view.message ? <p role="status" className="px-4 pb-3 text-sm text-text-secondary">{view.message}</p> : null}
          {view.canResetCredentials && !view.account && hasNative ? (
            <div className="px-4 pb-3">
              <Button variant="outline" disabled={busy} onClick={() => void resetLocalCredentials()}>
                {english ? "Reset local Cloud credentials" : "重置本机 Cloud 凭据"}
              </Button>
            </div>
          ) : null}
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
              {view.localOwnerBound !== true ? (
                <p role="alert" className="text-xs text-danger-text">
                  此云登录早于本地用户绑定，手机访问仍被拒绝。请退出云账号，再以当前 Mira 本地账户重新登录云账号。
                </p>
              ) : null}
              <p className="text-xs text-text-secondary">本页修改 Host 的权限上限；单台手机的缩小或撤销仍在 Mira Cloud Account Portal 管理。</p>
              {view.status === "signed_in" && view.localOwnerBound === true && api ? (
                <div className="space-y-3 pt-2">
                  {!editingPolicy ? (
                    <Button variant="outline" disabled={busy || isCheckingSession || !session?.token}
                      onClick={() => void beginPolicyEdit()}>
                      {english ? "Edit Host permission ceiling" : "调整 Host 权限上限"}
                    </Button>
                  ) : (
                    <>
                      <p className="text-xs text-text-secondary">
                        {english
                          ? "The editor loads the latest Cloud Auth policy. Widening requires a separate native confirmation, and current or future eligible devices may inherit the new ceiling."
                          : "正在编辑 Cloud Auth 最新权限策略。扩大权限需要再次在系统确认框中授权，现有或未来符合条件的手机可能继承新的上限。"}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {SCOPE_OPTIONS.map(([id, zh, en]) => (
                          <label key={id} className="flex cursor-pointer items-center gap-3 rounded-ui-control border border-border px-3 py-2 text-sm text-text-primary">
                            <input type="checkbox" checked={policyScopes.includes(id)}
                              disabled={busy} onChange={() => togglePolicyScope(id)}
                              aria-label={english ? en : zh} />
                            <span>{english ? en : zh}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="primary" disabled={busy || isCheckingSession || !session?.token}
                          onClick={() => void updateHostPolicy()}>
                          {english ? "Save Host policy to Cloud Auth" : "保存 Host 授权"}
                        </Button>
                        <Button variant="outline" disabled={busy}
                          onClick={() => { setEditingPolicy(false); setPolicyRevision(null); }}>
                          {english ? "Cancel" : "取消"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </SectionCard>
        ) : !signedIn && hasNative ? (
          <SectionCard title={english ? "Set initial Mobile Host permissions" : "登录时设置手机可访问的权限"}
            icon={<LockKeyhole size={16} />}>
            <div className="space-y-4 p-4">
              <p className="text-sm leading-6 text-text-secondary">
                {english ? "Choose initial Mobile scopes before sign-in; all start disabled. If this Host already has a Cloud policy, existing scopes are preserved. After login change the Host ceiling here; individual device restrictions remain in Cloud Portal. No QR pairing is needed."
                  : "首次登录可选择手机可调用的权限，默认全部关闭；若云端已有此 Host 的权限策略，将保留原设置；登录后可在本页修改权限上限，单台手机权限在 Cloud Portal 管理。不需要二维码或现场配对。"}
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
    </AppPageLayout>
  );
}
