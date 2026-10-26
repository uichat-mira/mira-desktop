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
// DSK-009: mirrored from @uichat-mira/cloud-auth-contracts. Relay tickets are
// transport-only; they never grant Host tools or business capabilities.
const SERVICE_CREDENTIAL_ISSUER = "mira:cloud-auth";
const RELAY_TRANSPORT_AUDIENCE = "mira:cloud-relay-transport";
const RELAY_TRANSPORT_SCOPE = "relay:transport";
const RELAY_ROOM = /^[A-Za-z0-9._:-]{1,128}$/;
const SERVICE_CREDENTIAL_KID = /^[A-Za-z0-9._-]{1,64}$/;
const RELAY_TICKET_LIFETIME_SECONDS = 600;
const RELAY_TICKET_CLOCK_SKEW_SECONDS = 30;
const RELAY_TICKET_ERROR_CODES = Object.freeze({
  NOT_CONFIGURED: "relay_ticket_not_configured",
  HOST_MISMATCH: "relay_ticket_host_mismatch",
  UNAVAILABLE: "relay_ticket_unavailable",
  REAUTH: "relay_ticket_reauth",
  NOT_AUTHORIZED: "relay_ticket_not_authorized",
  DEVICE_REQUIRED: "relay_ticket_device_required",
  INVALID_RESPONSE: "relay_ticket_invalid_response",
  ABORTED: "relay_ticket_aborted",
});

function relayTicketError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function decodeJwtSegment(segment) {
  if (typeof segment !== "string" || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function validateRelayTicket(ticket, host, accountId) {
  const invalid = () => relayTicketError(RELAY_TICKET_ERROR_CODES.INVALID_RESPONSE,
    "Cloud Relay 票据响应无效，已拒绝使用。");
  if (!hasExactKeys(ticket, ["audience", "expiresAt", "token", "tokenType"]) ||
      typeof ticket.token !== "string" || ticket.token.length < 16 ||
      ticket.token.length > 8192 ||
      ticket.tokenType !== "Bearer" ||
      ticket.audience !== RELAY_TRANSPORT_AUDIENCE ||
      typeof ticket.expiresAt !== "string") throw invalid();

  const parts = ticket.token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw invalid();
  }
  const header = decodeJwtSegment(parts[0]);
  const claims = decodeJwtSegment(parts[1]);
  if (!hasExactKeys(header, ["alg", "kid", "typ"]) || header.alg !== "EdDSA" ||
      header.typ !== "JWT" || !SERVICE_CREDENTIAL_KID.test(header.kid) ||
      !hasExactKeys(claims, ["aud", "device_id", "exp", "iat", "iss", "nbf",
        "relay", "scope", "sub"]) ||
      claims.iss !== SERVICE_CREDENTIAL_ISSUER ||
      claims.sub !== accountId ||
      claims.device_id !== host.deviceId ||
      claims.aud !== RELAY_TRANSPORT_AUDIENCE ||
      !Array.isArray(claims.scope) || claims.scope.length !== 1 ||
      claims.scope[0] !== RELAY_TRANSPORT_SCOPE ||
      !hasExactKeys(claims.relay, ["room", "role"]) ||
      claims.relay.room !== host.relayRoom ||
      claims.relay.role !== "host" ||
      !Number.isSafeInteger(claims.iat) || claims.iat < 0 ||
      !Number.isSafeInteger(claims.nbf) || claims.nbf < claims.iat ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= claims.nbf) {
    throw invalid();
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.iat > now + RELAY_TICKET_CLOCK_SKEW_SECONDS ||
      claims.nbf > now + RELAY_TICKET_CLOCK_SKEW_SECONDS ||
      claims.exp <= now ||
      claims.exp - claims.iat > RELAY_TICKET_LIFETIME_SECONDS) {
    throw invalid();
  }
  const expiresAt = Date.parse(ticket.expiresAt);
  if (!Number.isFinite(expiresAt) ||
      Math.abs(claims.exp * 1000 - expiresAt) > 2000 ||
      expiresAt <= Date.now()) {
    throw invalid();
  }
  return Object.freeze({
    token: ticket.token,
    tokenType: ticket.tokenType,
    audience: ticket.audience,
    expiresAt: ticket.expiresAt,
    room: claims.relay.room,
    role: claims.relay.role,
  });
}

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
  // Accept standard optional OAuth error metadata and RFC 9207 issuer, but
  // continue to reject duplicate, unknown, or untrusted callback parameters.
  const allowed = ["state", "code", "error", "error_description", "error_uri", "iss"];
  if (keys.length < 2 || keys.length > allowed.length ||
      keys.some((key) => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1) ||
      keys.filter((key) => key === "state").length !== 1 ||
      keys.filter((key) => key === "code" || key === "error").length !== 1 ||
      ((keys.includes("error_description") || keys.includes("error_uri")) && !keys.includes("error")) ||
      (url.searchParams.get("error_description") || "").length > 512 ||
      (url.searchParams.get("error_uri") || "").length > 1024 ||
      (keys.includes("iss") && url.searchParams.get("iss") !== ORIGIN)) return null;
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
    origin = ORIGIN, authorizationTimeoutMs = 10 * 60 * 1000 } = options;
  // Origin is controlled by native code, never supplied by renderer.
  if (origin !== ORIGIN && !options.allowTestOrigin) throw new Error("Invalid Cloud Auth origin");
  if (!Number.isSafeInteger(authorizationTimeoutMs) || authorizationTimeoutMs < 1) {
    throw new Error("Invalid OAuth authorization timeout");
  }
  let record = null;
  let pending = null;
  let authorizationTimer = null;
  let revision = 0;
  let credentialRecoveryAvailable = false;
  function clearPending() {
    if (authorizationTimer) clearTimeout(authorizationTimer);
    authorizationTimer = null;
    pending = null;
  }
  let view = { status: "signed_out", account: null, hostId: null,
    scopes: [], message: "", expiresAt: null, permissionsConfigured: false,
    canResetCredentials: false };

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
    } catch {
      const err = new Error(SAFE_ERROR);
      err.code = "network";
      throw err;
    }
    if (!response.ok) {
      let serverCode = null;
      try {
        const payload = await response.json();
        if (isRecord(payload) && isRecord(payload.error)) serverCode = payload.error.code;
      } catch { /* bounded error envelope is optional */ }
      if (response.status === 401) {
        const err = new Error("云账号认证已失效，需要重新登录");
        err.code = "reauth";
        err.status = 401;
        if (serverCode) err.serverCode = serverCode;
        throw err;
      }
      if (response.status === 409) {
        const err = new Error("云端权限版本发生变化，请重新登录并确认权限");
        err.code = "conflict";
        err.status = 409;
        throw err;
      }
      const err = new Error(response.status === 403 ? "云端拒绝此操作或设备已被撤销" : SAFE_ERROR);
      err.status = response.status;
      if (serverCode) err.serverCode = serverCode;
      throw err;
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      const err = new Error("Cloud Auth 返回数据无法识别");
      err.code = "invalid_response";
      throw err;
    }
  }
  function validateAccount(result) {
    if (!result || !result.account || typeof result.account.id !== "string" ||
      typeof result.account.username !== "string" ||
      typeof result.expiresAt !== "string") throw new Error("Cloud Auth 会话响应无效");
  }
  function resetRejectedSession() {
    record = { installationId: record.installationId };
    persist(record);
    return publish({ status: "rejected", account: null, scopes: [],
      hostId: null, permissionsConfigured: false, expiresAt: null,
      canResetCredentials: false,
      message: "云账号会话已撤销或过期，请重新登录；本地 Mira 不受影响。" });
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
        const complete = Boolean(record.permissionsConfigured && record.hostId);
        return publish({ status: complete ? "signed_in" : "setup_failed",
          account: result.account, hostId: complete ? record.hostId : null,
          scopes: complete ? (record.scopes || []) : [],
          permissionsConfigured: complete, expiresAt: result.expiresAt,
          message: complete ? "" :
            "云账号会话已恢复，但 Host 权限设置尚未完成。可直接重试，无需重新登录。" });
      } catch (error) {
        if (restoreRevision !== revision) return status();
        if (error.code === "reauth") {
          return resetRejectedSession();
        }
        return publish({ status: "unavailable", account: record.account || null,
          hostId: record.hostId || null, scopes: record.scopes || [],
          permissionsConfigured: Boolean(record.permissionsConfigured),
          expiresAt: record.expiresAt || null,
          message: "无法联系 Cloud Auth；保留原会话，本地功能不受影响。" });
      }
    } catch {
      credentialRecoveryAvailable = !record && secureAvailable() && fs.existsSync(storagePath);
      return publish({ status: "unavailable", account: null, hostId: null, scopes: [],
        permissionsConfigured: false, expiresAt: null,
        canResetCredentials: credentialRecoveryAvailable,
        message: credentialRecoveryAvailable
          ? "本机加密 Cloud 凭据无法读取；可明确重置本机记录，旧云端会话不会自动撤销。"
          : "系统安全凭据存储不可用；本地 Mira 不受影响。" });
    }
  }
  function resetLocalCredentials() {
    if (!credentialRecoveryAvailable || record || !secureAvailable()) {
      throw new Error("当前不允许重置 Cloud 凭据");
    }
    // This explicit recovery may rotate the device identity. Never silently
    // overwrite an unreadable record or claim the remote session was revoked.
    const fresh = { installationId: crypto.randomUUID() };
    persist(fresh);
    ++revision;
    clearPending();
    record = fresh;
    credentialRecoveryAvailable = false;
    return publish({ status: "signed_out", account: null, hostId: null,
      scopes: [], permissionsConfigured: false, expiresAt: null,
      canResetCredentials: false,
      message: "已重置本机 Cloud 凭据；旧云端会话未确认撤销，请在 Cloud Portal 检查并撤销旧设备。" });
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
    authorizationTimer = setTimeout(() => {
      if (pending !== transaction || transaction.revision !== revision) return;
      ++revision;
      clearPending();
      publish({ status: "signed_out", message: "云账号授权等待超时，请重新发起登录。" });
    }, authorizationTimeoutMs);
    authorizationTimer.unref?.();
    const params = new URLSearchParams({
      response_type: "code", client_id: "mira-desktop", redirect_uri: CALLBACK,
      state, code_challenge: challenge, code_challenge_method: "S256",
    });
    // Show an immediate cancel action even if the OS takes time to launch the browser.
    publish({ status: "authorizing", message: "请在系统浏览器完成授权，完成后会自动返回 Mira。" });
    try {
      await shell.openExternal(origin + "/v1/oauth/authorize?" + params.toString());
    } catch {
      if (pending !== transaction || transaction.revision !== revision) return status();
      ++revision;
      clearPending();
      publish({ status: "signed_out", message: "无法打开系统浏览器，请重试。" });
      throw new Error("无法打开系统浏览器");
    }
    // An early callback, timeout or cancellation may finish before openExternal resolves.
    return status();
  }
  function cancelAuthorization() {
    if (!pending) return status();
    ++revision;
    clearPending();
    return publish({ status: "signed_out", message: "已取消云账号授权，可重新发起登录。" });
  }
  async function configureHost(token, selected, expectedRevision) {
    const host = await request("/v1/hosts", "POST", token, {});
    if (expectedRevision !== revision) return null;
    if (!host || typeof host.id !== "string") throw new Error("Cloud Host 注册响应无效");
    const snapshot = await request("/v1/hosts/" + encodeURIComponent(host.id) + "/grants",
      "GET", token);
    if (expectedRevision !== revision) return null;
    if (!snapshot || snapshot.hostId !== host.id ||
        !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
        typeof snapshot.policyConfigured !== "boolean" ||
        !Array.isArray(snapshot.policyScopes)) {
      throw new Error("云端 Host 权限快照无效");
    }
    // Server-owned policy wins over previously selected local scopes, on retry too.
    const existingPolicy = snapshot.policyConfigured;
    const scopes = existingPolicy ? validateScopes(snapshot.policyScopes) : selected;
    if (!existingPolicy) {
      const policy = await request("/v1/hosts/" + encodeURIComponent(host.id) + "/grant-policy",
        "PUT", token, { expectedRevision: snapshot.revision, scopes });
      if (expectedRevision !== revision) return null;
      if (!policy || !Number.isSafeInteger(policy.revision) || policy.hostId !== host.id) {
        throw new Error("云端权限保存响应无效");
      }
    }
    if (expectedRevision !== revision) return null;
    const { requestedScopes: _completedSelection, ...saved } = record;
    record = { ...saved, hostId: host.id, scopes, permissionsConfigured: true };
    persist(record);
    return { hostId: host.id, scopes, existingPolicy };
  }
  function publishConfiguredHost(result) {
    return publish({ status: "signed_in", account: record.account,
      expiresAt: record.expiresAt, hostId: result.hostId,
      scopes: result.scopes, permissionsConfigured: true,
      message: result.existingPolicy
        ? "云账号已登录，已保留云端原有 Host 权限设置；修改请前往 Cloud Portal。"
        : "云账号已登录，Host 权限范围已保存。实际调用仍由 Desktop Gateway 决定。" });
  }
  async function retryHostSetup() {
    if (view.status !== "setup_failed" || !record?.sessionToken ||
        (record.permissionsConfigured && record.hostId)) {
      throw new Error("没有待恢复的 Host 权限设置");
    }
    const selected = validateScopes(record.requestedScopes || []);
    const expectedRevision = ++revision;
    const token = record.sessionToken;
    publish({ status: "checking", message: "正在重试 Host 权限设置…" });
    try {
      const result = await configureHost(token, selected, expectedRevision);
      if (result) return publishConfiguredHost(result);
    } catch (error) {
      if (expectedRevision !== revision) return status();
      if (error.code === "reauth") return resetRejectedSession();
      return publish({ status: "setup_failed", account: record.account || null,
        hostId: null, scopes: [], permissionsConfigured: false,
        message: "Host 权限设置仍未完成：" + error.message });
    }
    return status();
  }
  function relayFailure(error, expectedRevision) {
    if (expectedRevision !== revision) {
      return relayTicketError(RELAY_TICKET_ERROR_CODES.ABORTED,
        "云账号状态已变化，已丢弃过期的 Relay 票据请求。");
    }
    if (error?.code === "reauth" || error?.status === 401) {
      resetRejectedSession();
      return relayTicketError(RELAY_TICKET_ERROR_CODES.REAUTH,
        "云账号会话已失效，请重新登录；本地 Mira 不受影响。");
    }
    if (error?.status === 403) {
      return relayTicketError(
        error.serverCode === "SERVICE_CREDENTIAL_DEVICE_REQUIRED"
          ? RELAY_TICKET_ERROR_CODES.DEVICE_REQUIRED
          : RELAY_TICKET_ERROR_CODES.NOT_AUTHORIZED,
        "云端未授权当前 Host 使用 Mira Relay 传输；本地功能不受影响。");
    }
    if (error?.code === "invalid_response") {
      return relayTicketError(RELAY_TICKET_ERROR_CODES.INVALID_RESPONSE,
        "Cloud Relay 票据响应无效，已拒绝使用。");
    }
    return relayTicketError(RELAY_TICKET_ERROR_CODES.UNAVAILABLE,
      "Cloud Relay 票据暂时不可用；本地功能与已恢复的会话不受影响。");
  }
  function validateHostPresence(host, expectedHostId) {
    const invalid = () => relayTicketError(RELAY_TICKET_ERROR_CODES.INVALID_RESPONSE,
      "Cloud Host 归属响应无效，已拒绝申请 Relay 票据。");
    if (!isRecord(host) || typeof host.id !== "string" ||
        typeof host.deviceId !== "string" ||
        host.deviceId.length < 1 || host.deviceId.length > 128 ||
        typeof host.relayRoom !== "string" || !RELAY_ROOM.test(host.relayRoom) ||
        (host.availability !== "available" && host.availability !== "offline")) {
      throw invalid();
    }
    if (host.id !== expectedHostId) {
      throw relayTicketError(RELAY_TICKET_ERROR_CODES.HOST_MISMATCH,
        "云端返回的 Host 归属与本机 Cloud Host 不匹配，已拒绝申请 Relay 票据。");
    }
    if (host.availability !== "available") {
      throw relayTicketError(RELAY_TICKET_ERROR_CODES.NOT_AUTHORIZED,
        "当前 Host 在云端不可用，暂时无法申请 Relay 票据；本地功能不受影响。");
    }
    return host;
  }
  async function requestRelayHostTicket() {
    if (!record?.sessionToken || !isRecord(record.account) ||
        typeof record.account.id !== "string" || !record.account.id ||
        typeof record.hostId !== "string" || !record.hostId ||
        !record.permissionsConfigured) {
      throw relayTicketError(RELAY_TICKET_ERROR_CODES.NOT_CONFIGURED,
        "当前没有已完成 Host 配置的 Cloud Session，无法申请 Relay 票据。");
    }
    const token = record.sessionToken;
    const accountId = record.account.id;
    const expectedRevision = revision;
    let host;
    try {
      // Refresh the server-owned Host lease and read the authoritative room.
      // The renderer never supplies an account, room, role, or audience.
      host = await request("/v1/hosts", "POST", token, {});
    } catch (error) {
      throw relayFailure(error, expectedRevision);
    }
    if (expectedRevision !== revision) throw relayFailure(null, expectedRevision);
    host = validateHostPresence(host, record.hostId);
    let ticket;
    try {
      ticket = await request("/v1/service-credentials", "POST", token, {
        audience: RELAY_TRANSPORT_AUDIENCE,
        relay: { room: host.relayRoom, role: "host" },
      });
    } catch (error) {
      throw relayFailure(error, expectedRevision);
    }
    if (expectedRevision !== revision) throw relayFailure(null, expectedRevision);
    return validateRelayTicket(ticket, host, accountId);
  }
  async function withRelayHostTicket(consumer) {
    if (typeof consumer !== "function") {
      throw new Error("Relay 票据只能交给受信任的原生连接消费接口");
    }
    const ticket = await requestRelayHostTicket();
    // The ticket is delivered only to trusted native code. It is never stored
    // in the renderer-visible status, local JWT/DB, or logs.
    await consumer(ticket);
  }
  async function handleCallback(rawUrl) {
    const parsed = parseCallback(rawUrl);
    if (!parsed || !pending || parsed.state !== pending.state) return false;
    const transaction = pending;
    clearPending(); // single-use; also cancel the authorization timeout
    if (parsed.error || !parsed.code) {
      publish({ status: "signed_out", message: "浏览器授权未完成，请重新发起。" });
      return true;
    }
    // The browser transaction is complete; token/Host setup is a separate in-flight step.
    // Do not keep displaying a cancel action that cannot cancel an exchanged bearer.
    publish({ status: "checking", message: "正在完成云账号登录…" });
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
        sessionToken, account: result.account, expiresAt: result.expiresAt,
        requestedScopes: transaction.selected };
      persist(record); // token and pending Host selection never reach React or local JWT/DB
      // A successful code exchange is durable even if Host setup is interrupted.
      // The owner's initial choice stays in the same encrypted native record.
      const hostSetup = await configureHost(sessionToken, transaction.selected, transaction.revision);
      if (hostSetup) publishConfiguredHost(hostSetup);
    } catch (error) {
      if (transaction.revision !== revision) return true;
      if (record && record.sessionToken) {
        if (error.code === "reauth") {
          resetRejectedSession();
          return true;
        }
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
    clearPending();
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
  return { initialize, begin, cancelAuthorization, handleCallback, retryHostSetup,
    resetLocalCredentials, signOut, status, withRelayHostTicket };
}

module.exports = { createCloudAccountController, parseCallback, validateScopes, SCOPES,
  RELAY_TICKET_ERROR_CODES };
