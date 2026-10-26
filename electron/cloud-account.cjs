"use strict";

// DSK-005: Cloud identity belongs to the native shell, NEVER to renderer/local JWT.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ORIGIN = "https://cloud-auth.tomzlab.cn";
const CALLBACK = "mira-desktop://oauth/callback";
const SCOPES = Object.freeze([
  "threads:read", "messages:read", "messages:write", "agent:read",
  "agent:approve", "agent:control", "tools:read", "tools:invoke",
  "tools:approve", "tools:control", "artifacts:read",
]);
const SAFE_ERROR = "Mira Cloud 请求失败。请检查网络或稍后重试。";

function validateScopes(input) {
  if (!Array.isArray(input) || input.length > SCOPES.length ||
      input.some((item) => !SCOPES.includes(item))) {
    throw new Error("无效的远程权限范围");
  }
  return SCOPES.filter((scope) => input.includes(scope));
}
function parseCallback(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "mira-desktop:" || url.hostname !== "oauth" ||
      url.pathname !== "/callback" || url.username || url.password ||
      url.port || url.hash) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || keys.filter((k) => k === "state").length !== 1 ||
      keys.filter((k) => k === "code" || k === "error").length !== 1) return null;
  const state = url.searchParams.get("state");
  if (!state || !/^[A-Za-z0-9._~-]{16,512}$/.test(state)) return null;
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if ((code && !/^mca_v1\.[A-Za-z0-9._~-]+$/.test(code)) ||
      (error && !/^[a-z_]{1,64}$/.test(error))) return null;
  return { state, code, error };
}

function createCloudAccountController(options) {
  const { app, safeStorage, shell, notify, fetcher = globalThis.fetch,
    storagePath = path.join(app.getPath("userData"), "cloud-account.v1.enc"),
    origin = ORIGIN } = options;
  // Origin is controlled by native code, never supplied by renderer.
  if (origin !== ORIGIN && !options.allowTestOrigin) throw new Error("Invalid Cloud Auth origin");
  let record = null;
  let pending = null;
  let revision = 0;
  let view = { status: "signed_out", account: null, hostId: null,
    scopes: [], message: "", expiresAt: null, permissionsConfigured: false };

  function publish(patch) {
    view = { ...view, ...patch };
    notify({ ...view, scopes: [...view.scopes] });
    return status();
  }
  function status() { return { ...view, scopes: [...view.scopes] }; }
  function secureAvailable() {
    return safeStorage.isEncryptionAvailable() &&
      (!safeStorage.getSelectedStorageBackend ||
        safeStorage.getSelectedStorageBackend() !== "basic_text");
  }
  function persist(value) {
    if (!secureAvailable()) throw new Error("系统安全凭据存储不可用，不会明文保存 Cloud Session");
    fs.mkdirSync(path.dirname(storagePath), { recursive: true, mode: 0o700 });
    const buffer = safeStorage.encryptString(JSON.stringify(value));
    const tmp = storagePath + ".tmp";
    try {
      fs.writeFileSync(tmp, buffer, { mode: 0o600, flag: "w" });
      fs.renameSync(tmp, storagePath);
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* no leftover */ }
    }
  }
  function load() {
    if (!secureAvailable()) throw new Error("系统安全凭据存储不可用");
    if (!fs.existsSync(storagePath)) return null;
    const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(storagePath)));
    if (!parsed || typeof parsed.installationId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(parsed.installationId)) {
      throw new Error("本机 Cloud 身份记录损坏，需要重新配置");
    }
    return parsed;
  }
  async function request(route, method, token, body) {
    let response;
    try {
      response = await fetcher(origin + route, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(12000),
      });
    } catch { throw new Error(SAFE_ERROR); }
    if (!response.ok) {
      if (response.status === 401) {
        const err = new Error("云账号认证已失效，需要重新登录");
        err.code = "reauth";
        throw err;
      }
      if (response.status === 409) {
        const err = new Error("云端权限版本发生变化，请重新登录并确认权限");
        err.code = "conflict";
        throw err;
      }
      throw new Error(response.status === 403 ? "云端拒绝此操作或设备已被撤销" : SAFE_ERROR);
    }
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new Error("Cloud Auth 返回数据无法识别"); }
  }
  function validateAccount(result) {
    if (!result || !result.account || typeof result.account.id !== "string" ||
      typeof result.account.username !== "string" ||
      typeof result.expiresAt !== "string") throw new Error("Cloud Auth 会话响应无效");
  }
  async function initialize() {
    try {
      record = load();
      if (!record) {
        record = { installationId: crypto.randomUUID() };
        persist(record);
        return status();
      }
      if (!record.sessionToken) return status();
      const restoreRevision = revision;
      const restoreToken = record.sessionToken;
      publish({ status: "checking", message: "正在验证云账号会话" });
      try {
        const result = await request("/v1/auth/session", "GET", restoreToken);
        if (restoreRevision !== revision) return status();
        validateAccount(result);
        record = { ...record, account: result.account, expiresAt: result.expiresAt };
        persist(record);
        return publish({ status: "signed_in", account: result.account,
          hostId: record.hostId || null, scopes: record.scopes || [],
          permissionsConfigured: Boolean(record.permissionsConfigured),
          expiresAt: result.expiresAt, message: "" });
      } catch (error) {
        if (restoreRevision !== revision) return status();
        if (error.code === "reauth") {
          record = { installationId: record.installationId };
          persist(record);
          return publish({ status: "rejected", account: null, scopes: [],
            hostId: null, permissionsConfigured: false, expiresAt: null,
            message: "云账号会话已撤销或过期，请重新登录；本地 Mira 不受影响。" });
        }
        return publish({ status: "unavailable", account: record.account || null,
          hostId: record.hostId || null, scopes: record.scopes || [],
          permissionsConfigured: Boolean(record.permissionsConfigured),
          expiresAt: record.expiresAt || null,
          message: "无法联系 Cloud Auth；保留原会话，本地功能不受影响。" });
      }
    } catch {
      return publish({ status: "unavailable", message: "系统安全凭据存储不可用或记录无法读取；本地 Mira 不受影响。" });
    }
  }
  async function begin(scopes) {
    const selected = validateScopes(scopes);
    if (!secureAvailable()) throw new Error("系统安全凭据存储不可用，无法安全登录");
    if (pending) throw new Error("已有登录流程正在等待浏览器授权");
    if (record && record.sessionToken) throw new Error("请先退出当前云账号");
    if (!record) { record = { installationId: crypto.randomUUID() }; persist(record); }
    const verifier = crypto.randomBytes(32).toString("base64url");
    const state = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const transaction = { state, verifier, selected, revision: ++revision };
    pending = transaction;
    const params = new URLSearchParams({
      response_type: "code", client_id: "mira-desktop", redirect_uri: CALLBACK,
      state, code_challenge: challenge, code_challenge_method: "S256",
    });
    try {
      await shell.openExternal(origin + "/v1/oauth/authorize?" + params.toString());
    } catch {
      if (pending !== transaction) return status();
      pending = null;
      throw new Error("无法打开系统浏览器");
    }
    // A fast callback or concurrent sign-out can finish this transaction
    // before the OS resolves openExternal; never restore an obsolete UI state.
    if (pending !== transaction || transaction.revision !== revision) return status();
    return publish({ status: "authorizing", message: "请在系统浏览器完成授权，完成后会自动返回 Mira。" });
  }
  async function handleCallback(rawUrl) {
    const parsed = parseCallback(rawUrl);
    if (!parsed || !pending || parsed.state !== pending.state) return false;
    const transaction = pending;
    pending = null; // single-use even if code exchange fails
    if (parsed.error || !parsed.code) {
      publish({ status: "signed_out", message: "浏览器授权未完成，请重新发起。" });
      return true;
    }
    try {
      const result = await request("/v1/oauth/token", "POST", null, {
        grant_type: "authorization_code", client_id: "mira-desktop",
        redirect_uri: CALLBACK, code: parsed.code, code_verifier: transaction.verifier,
        installation_id: record.installationId, platform: "desktop",
      });
      if (!result || typeof result.sessionToken !== "string" ||
          !result.sessionToken.startsWith("mcs_v1.")) throw new Error("Cloud Auth 凭据响应无效");
      validateAccount(result);
      if (transaction.revision !== revision) {
        // A sign-out during the network exchange must not leave a newly
        // issued Cloud Session usable, even though React never saw the token.
        try { await request("/v1/auth/logout", "POST", result.sessionToken); }
        catch { /* no bearer is retained; server TTL remains the upper bound */ }
        return true;
      }
      const sessionToken = result.sessionToken;
      record = { installationId: record.installationId,
        sessionToken, account: result.account, expiresAt: result.expiresAt };
      persist(record); // token never reaches React or local JWT/DB
      // Keep the exchanged bearer local to this transaction: signOut may reset
      // record while one of the following Cloud requests is in flight.
      const host = await request("/v1/hosts", "POST", sessionToken, {});
      if (transaction.revision !== revision) return true;
      if (!host || typeof host.id !== "string") throw new Error("Cloud Host 注册响应无效");
      const snapshot = await request("/v1/hosts/" + encodeURIComponent(host.id) + "/grants",
        "GET", sessionToken);
      if (transaction.revision !== revision) return true;
      if (!snapshot || snapshot.hostId !== host.id ||
          !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
          typeof snapshot.policyConfigured !== "boolean" ||
          !Array.isArray(snapshot.policyScopes)) {
        throw new Error("云端 Host 权限快照无效");
      }
      // Existing owner policy (including Portal restrictions) is authoritative.
      // Re-login must not silently replace it with the pre-login default [].
      const existingPolicy = snapshot.policyConfigured;
      const scopes = existingPolicy ? validateScopes(snapshot.policyScopes) : transaction.selected;
      if (!existingPolicy) {
        const policy = await request("/v1/hosts/" + encodeURIComponent(host.id) + "/grant-policy",
          "PUT", sessionToken,
          { expectedRevision: snapshot.revision, scopes });
        if (transaction.revision !== revision) return true;
        if (!policy || !Number.isSafeInteger(policy.revision) ||
            policy.hostId !== host.id) throw new Error("云端权限保存响应无效");
      }
      if (transaction.revision !== revision) return true;
      record = { ...record, hostId: host.id, scopes, permissionsConfigured: true };
      persist(record);
      publish({ status: "signed_in", account: result.account, expiresAt: result.expiresAt,
        hostId: host.id, scopes, permissionsConfigured: true,
        message: existingPolicy
          ? "云账号已登录，已保留云端原有 Host 权限设置；修改请前往 Cloud Portal。"
          : "云账号已登录，Host 权限范围已保存。实际调用仍由 Desktop Gateway 决定。" });
    } catch (error) {
      if (transaction.revision !== revision) return true;
      if (record && record.sessionToken) {
        publish({ status: "setup_failed", account: record.account || null,
          expiresAt: record.expiresAt || null, hostId: null,
          scopes: [], permissionsConfigured: false,
          message: "云账号已登录，但 Host 权限设置未完成：" + error.message });
      } else {
        publish({ status: "signed_out", message: "云登录失败：" + error.message });
      }
    }
    return true;
  }
  async function signOut() {
    ++revision;
    pending = null;
    const token = record && record.sessionToken;
    const installationId = (record && record.installationId) || crypto.randomUUID();
    record = { installationId };
    persist(record);
    publish({ status: "signed_out", account: null, hostId: null, scopes: [],
      expiresAt: null, permissionsConfigured: false, message: "" });
    if (token) {
      try { await request("/v1/auth/logout", "POST", token); }
      catch {
        publish({ message: "本机已退出云账号，但云端撤销未确认。可前往 Cloud Portal 撤销该设备。" });
      }
    }
    return status();
  }
  return { initialize, begin, handleCallback, signOut, status };
}

module.exports = { createCloudAccountController, parseCallback, validateScopes, SCOPES };
