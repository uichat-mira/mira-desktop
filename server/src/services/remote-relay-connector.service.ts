import CONFIG from "@/config/index.js";
import type {
  CloudRelayHostTicket,
  CloudRelayRevocationReason,
} from "@/services/cloud-relay-ticket-ipc.service.js";
import {
  RELAY_MAX_REQUEST_BODY_BYTES,
  RELAY_MAX_RESPONSE_BYTES,
  RELAY_PROTOCOL_VERSION,
  RELAY_STREAM_CHUNK_BYTES,
  parseRelayInboundHostFrame,
  serializeRelayFrame,
  type RelayErrorFrame,
  type RelayOutboundHostFrame,
  type RelayRequestFrame,
} from "@/remote-relay/protocol.js";

const RELAY_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const TOKEN_MIN_LENGTH = 32;
const TOKEN_MAX_LENGTH = 512;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const KEEPALIVE_INTERVAL_MS = 30_000;
const KEEPALIVE_TIMEOUT_MS = 45_000;

const BLOCKED_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const ALLOWED_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-disposition",
  "content-type",
  "etag",
  "last-modified",
]);

export type RemoteRelayConnectorState =
  | "disabled"
  | "misconfigured"
  | "connecting"
  | "connected"
  | "disconnected"
  | "stopped";

export type RemoteRelayConnectorConfig = {
  enabled: boolean;
  relayUrl: string | null;
  relayId: string | null;
  hostToken: string | null;
  clientToken: string | null;
};

// Official Cloud is an independent, opt-in transport, never a legacy token fallback.
export type CloudRelayConnectorConfig = {
  kind: "cloud";
  enabled: boolean;
  relayUrl: string | null;
};
export type AnyRelayConnectorConfig = RemoteRelayConnectorConfig | CloudRelayConnectorConfig;
export type CloudRelayTicketSource = {
  withHostTicket<T>(consumer: (ticket: CloudRelayHostTicket) => Promise<T> | T): Promise<T>;
  onRevoked(listener: (reason: CloudRelayRevocationReason) => void): () => void;
};
const isCloud = (config: AnyRelayConnectorConfig): config is CloudRelayConnectorConfig =>
  "kind" in config && config.kind === "cloud";

export type RemoteRelayConnectorSnapshot = {
  enabled: boolean;
  state: RemoteRelayConnectorState;
  relayUrl: string | null;
  relayId: string | null;
  connectedAt: string | null;
  lastError: string | null;
  activeRequests: number;
  reconnectAttempt: number;
};

type RelaySocketMessageEvent = { data: unknown };
type RelaySocketCloseEvent = { code?: number; reason?: string };

type RelaySocket = {
  readonly readyState: number;
  send(data: string): void;
  ping(): void;
  on(event: "pong", listener: () => void): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  addEventListener(
    type: "message",
    listener: (event: RelaySocketMessageEvent) => void,
  ): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event: RelaySocketCloseEvent) => void,
  ): void;
};

export type RelaySocketFactory = (url: string) => RelaySocket;
export type RelayLocalFetch = typeof fetch;

type ActiveLocalRequest = {
  controller: AbortController;
  cancelled: boolean;
};

const missingSocketFactory: RelaySocketFactory = () => {
  throw new Error(
    "Mira Relay requires an explicit WebSocket client runtime from the host application",
  );
};

const normalizeToken = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  return normalized.length >= TOKEN_MIN_LENGTH &&
    normalized.length <= TOKEN_MAX_LENGTH
    ? normalized
    : null;
};

const normalizeRelayId = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  return RELAY_ID_PATTERN.test(normalized) ? normalized : null;
};

const normalizeRelayUrl = (
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV,
) => {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;

    if (url.protocol === "https:") {
      url.protocol = "wss:";
    } else if (url.protocol === "http:" && nodeEnv !== "production") {
      url.protocol = "ws:";
    } else if (url.protocol === "ws:" && nodeEnv === "production") {
      return null;
    } else if (url.protocol !== "wss:" && url.protocol !== "ws:") {
      return null;
    }

    url.pathname = "/";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
};

export const resolveCloudRelayConnectorConfig = (
  env: NodeJS.ProcessEnv = process.env,
): CloudRelayConnectorConfig => ({
  kind: "cloud",
  enabled: env.UI_CHAT_CLOUD_RELAY_ENABLED === "1",
  // Explicit deployment setting until REL-001 publishes its hosted URL.
  relayUrl: normalizeRelayUrl(env.UI_CHAT_CLOUD_RELAY_URL, env.NODE_ENV),
});

export const resolveRemoteRelayConnectorConfig = (
  env: NodeJS.ProcessEnv = process.env,
): RemoteRelayConnectorConfig => {
  const enabled = env.UI_CHAT_REMOTE_RELAY_ENABLED === "1";
  return {
    enabled,
    relayUrl: normalizeRelayUrl(env.UI_CHAT_REMOTE_RELAY_URL, env.NODE_ENV),
    relayId: normalizeRelayId(env.UI_CHAT_REMOTE_RELAY_ID),
    hostToken: normalizeToken(env.UI_CHAT_REMOTE_RELAY_HOST_TOKEN),
    clientToken: normalizeToken(env.UI_CHAT_REMOTE_RELAY_CLIENT_TOKEN),
  };
};

const configError = (config: AnyRelayConnectorConfig) => {
  if (!config.enabled) return null;
  if (isCloud(config)) {
    return config.relayUrl ? null : "cloud_relay_endpoint_unavailable";
  }
  if (!config.relayUrl) return "UI_CHAT_REMOTE_RELAY_URL is missing or invalid";
  if (!config.relayId) return "UI_CHAT_REMOTE_RELAY_ID is missing or invalid";
  if (!config.hostToken) {
    return "UI_CHAT_REMOTE_RELAY_HOST_TOKEN must contain at least 32 characters";
  }
  if (!config.clientToken) {
    return "UI_CHAT_REMOTE_RELAY_CLIENT_TOKEN must contain at least 32 characters";
  }
  return null;
};

const buildSocketUrl = (relayUrl: string, relayId: string) => {
  const url = new URL(relayUrl);
  url.pathname = `/v1/relay/${encodeURIComponent(relayId)}/socket`;
  return url.toString();
};

const toTextMessage = (value: unknown) =>
  typeof value === "string" ? value : null;

const sanitizeRequestHeaders = (headers: Record<string, string> | undefined) => {
  const result: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers ?? {})) {
    const name = rawName.trim().toLowerCase();
    if (
      !name ||
      BLOCKED_REQUEST_HEADERS.has(name) ||
      name.startsWith("cf-") ||
      name.startsWith("x-forwarded-")
    ) {
      continue;
    }
    result[name] = value;
  }
  result["accept-encoding"] = "identity";
  return result;
};

const responseHeaders = (headers: Headers) => {
  const result: Record<string, string> = {};
  headers.forEach((value, rawName) => {
    const name = rawName.toLowerCase();
    if (ALLOWED_RESPONSE_HEADERS.has(name) || name.startsWith("x-mira-")) {
      result[name] = value;
    }
  });
  return result;
};

const decodeRequestBody = (bodyBase64: string | undefined) => {
  if (!bodyBase64) return undefined;
  const body = Buffer.from(bodyBase64, "base64");
  if (body.byteLength > RELAY_MAX_REQUEST_BODY_BYTES) {
    throw new Error("Relay request body exceeds the V1 size limit");
  }
  return body;
};

const splitChunk = (value: Uint8Array) => {
  const chunks: Uint8Array[] = [];
  for (
    let offset = 0;
    offset < value.byteLength;
    offset += RELAY_STREAM_CHUNK_BYTES
  ) {
    chunks.push(value.subarray(offset, offset + RELAY_STREAM_CHUNK_BYTES));
  }
  return chunks;
};

const abortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export class RemoteRelayConnectorService {
  private state: RemoteRelayConnectorState = "disabled";
  private socket: RelaySocket | null = null;
  private currentConfig: AnyRelayConnectorConfig | null = null;
  private currentRelayId: string | null = null;
  private unsubscribeRevocation: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private connectedAt: string | null = null;
  private lastError: string | null = null;
  private stopped = false;
  private generation = 0;
  private readonly activeRequests = new Map<string, ActiveLocalRequest>();

  constructor(
    private readonly configProvider: () => AnyRelayConnectorConfig =
      resolveRemoteRelayConnectorConfig,
    private readonly socketFactory: RelaySocketFactory = missingSocketFactory,
    private readonly localFetch: RelayLocalFetch = fetch,
    private readonly localBaseUrl = `http://127.0.0.1:${CONFIG.PORT}`,
    private readonly random = Math.random,
    private readonly cloudTicketSource?: CloudRelayTicketSource,
  ) {}

  start() {
    this.stopTimers();
    this.stopped = false;
    this.currentConfig = this.configProvider();
    this.currentRelayId = null;
    this.unsubscribeRevocation?.();
    this.unsubscribeRevocation = null;
    if (isCloud(this.currentConfig) && this.cloudTicketSource) {
      this.unsubscribeRevocation = this.cloudTicketSource.onRevoked(() => {
        // Never retain a socket admitted under a revoked Cloud account.
        this.restart();
      });
    }
    this.connectedAt = null;
    this.lastError = null;
    this.reconnectAttempt = 0;

    if (!this.currentConfig.enabled) {
      this.state = "disabled";
      return;
    }

    const error = configError(this.currentConfig);
    if (error) {
      this.state = "misconfigured";
      this.lastError = error;
      return;
    }

    this.connect();
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    this.stopTimers();
    this.abortAllRequests();
    this.currentRelayId = null;
    this.unsubscribeRevocation?.();
    this.unsubscribeRevocation = null;

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close(1000, "Mira Relay connector stopped");
      } catch {
        // Socket may already be closed.
      }
    }

    this.state = this.currentConfig?.enabled ? "stopped" : "disabled";
    this.connectedAt = null;
  }

  restart() {
    this.stop();
    this.start();
  }

  getSnapshot(): RemoteRelayConnectorSnapshot {
    return {
      enabled: this.currentConfig?.enabled ?? false,
      state: this.state,
      relayUrl: this.currentConfig?.relayUrl ?? null,
      // Cloud rooms are not exposed via the legacy pairing/status contract.
      relayId: this.currentConfig && !isCloud(this.currentConfig)
        ? this.currentConfig.relayId : null,
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      activeRequests: this.activeRequests.size,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  private connect() {
    const config = this.currentConfig;
    if (this.stopped || !config?.enabled || !config.relayUrl) return;

    this.stopTimers();
    this.state = "connecting";
    this.connectedAt = null;
    const generation = ++this.generation;

    if (isCloud(config)) {
      if (!this.cloudTicketSource) {
        this.handleConnectionFailure(generation, "relay_ticket_bridge_unavailable");
        return;
      }
      // Every socket generation must request a fresh, native-owned ticket.
      void this.cloudTicketSource.withHostTicket((ticket) => {
        if (this.stopped || generation !== this.generation) return;
        this.openSocket(config.relayUrl!, ticket.room, ticket.token, generation, true);
      }).catch((error: unknown) => {
        const code = error instanceof Error && "code" in error &&
          typeof error.code === "string" ? error.code : "relay_ticket_unavailable";
        this.handleConnectionFailure(generation, code);
      });
      return;
    }
    if (!config.relayId || !config.hostToken || !config.clientToken) return;
    this.openSocket(config.relayUrl, config.relayId,
      config.hostToken, generation, false, config.clientToken);
  }

  private handleConnectionFailure(generation: number, code: string) {
    if (this.stopped || generation !== this.generation) return;
    // Only bounded codes reach status; never serialize upstream error messages.
    this.lastError = code.startsWith("relay_ticket_")
      ? code : "cloud_relay_transport_unavailable";
    this.state = "disconnected";
    this.scheduleReconnect();
  }

  private openSocket(
    url: string,
    relayId: string,
    token: string,
    generation: number,
    cloud: boolean,
    clientToken?: string,
  ) {
    if (this.stopped || generation !== this.generation) return;
    this.currentRelayId = relayId;
    let socket: RelaySocket;
    try {
      socket = this.socketFactory(buildSocketUrl(url, relayId));
    } catch (error) {
      if (cloud) {
        this.handleConnectionFailure(generation, "cloud_relay_transport_unavailable");
      } else {
        // Preserve legacy/self-hosted Relay diagnostics.
        this.lastError = error instanceof Error ? error.message : String(error);
        this.state = "disconnected";
        this.scheduleReconnect();
      }
      return;
    }
    this.socket = socket;
    // Discard the captured transport credential immediately after hello; it is
    // admission-only and must not be kept for the lifetime of the healthy socket.
    let pendingToken: string | null = token;
    socket.addEventListener("open", () => {
      if (!this.isCurrent(socket, generation) || !pendingToken) return;
      const hello = {
        version: RELAY_PROTOCOL_VERSION,
        type: "hello",
        role: "host",
        relayId,
        token: pendingToken,
        ...(cloud ? {} : { clientToken }),
      };
      pendingToken = null;
      try {
        socket.send(JSON.stringify(hello));
      } catch {
        this.lastError = cloud ? "cloud_relay_transport_unavailable"
          : "Mira Relay hello failed";
        socket.close(1008, "Relay hello send failed");
        return;
      }
      this.handshakeTimer = setTimeout(() => {
        if (!this.isCurrent(socket, generation) || this.state === "connected") {
          return;
        }
        this.lastError = "Mira Relay hello acknowledgement timed out";
        try {
          socket.close(1008, "Relay hello timeout");
        } catch {
          // Close failures are handled by reconnect state below.
        }
      }, HANDSHAKE_TIMEOUT_MS);
      this.handshakeTimer.unref?.();
    });

    socket.addEventListener("message", (event) => {
      if (!this.isCurrent(socket, generation)) return;
      const text = toTextMessage(event.data);
      if (!text) {
        this.lastError = "Mira Relay sent a non-text frame";
        socket.close(1003, "Text relay frames required");
        return;
      }
      this.handleMessage(socket, generation, text);
    });

    socket.addEventListener("error", () => {
      if (!this.isCurrent(socket, generation)) return;
      this.lastError = this.lastError ?? "Mira Relay WebSocket error";
    });

    socket.addEventListener("close", (event) => {
      if (!this.isCurrent(socket, generation)) return;
      this.stopHandshakeTimer();
      this.stopKeepaliveTimer();
      this.socket = null;
      this.connectedAt = null;
      this.abortAllRequests();
      if (this.stopped) return;
      if (event.reason) {
        this.lastError = this.currentConfig && isCloud(this.currentConfig)
          ? "cloud_relay_transport_disconnected"
          : `Mira Relay disconnected: ${event.reason}`;
      }
      this.state = "disconnected";
      this.scheduleReconnect();
    });
  }

  private handleMessage(socket: RelaySocket, generation: number, raw: string) {
    const frame = parseRelayInboundHostFrame(raw);
    if (!frame) {
      this.lastError = "Mira Relay returned an invalid protocol frame";
      socket.close(1002, "Invalid Mira Relay frame");
      return;
    }

    if (frame.type === "hello_ack") {
      const config = this.currentConfig;
      if (
        frame.role !== "host" ||
        frame.protocolVersion !== RELAY_PROTOCOL_VERSION ||
        !this.currentRelayId ||
        frame.relayId !== this.currentRelayId
      ) {
        this.lastError =
          "Mira Relay hello acknowledgement does not match this host";
        socket.close(1008, "Relay identity mismatch");
        return;
      }
      this.stopHandshakeTimer();
      this.state = "connected";
      this.connectedAt = new Date().toISOString();
      this.lastError = null;
      this.reconnectAttempt = 0;
      this.startKeepalive(socket, generation);
      return;
    }

    if (this.state !== "connected" || !this.isCurrent(socket, generation)) {
      return;
    }

    if (frame.type === "request") {
      if (this.currentConfig && isCloud(this.currentConfig)) {
        // DSK-007 owns verified Cloud Grants. Transport ticket ≠ Tool Grant.
        this.sendError(frame.requestId, "CLOUD_GRANT_REQUIRED",
          "Cloud Host Grant is not available for business requests", false);
        return;
      }
      void this.handleLocalRequest(frame);
      return;
    }

    if (frame.type === "cancel") {
      const active = this.activeRequests.get(frame.requestId);
      if (active) {
        active.cancelled = true;
        active.controller.abort();
      }
      return;
    }

    if (frame.type === "error") {
      // Hosted Relay messages are remote input; never reflect raw text into local status.
      this.lastError = this.currentConfig && isCloud(this.currentConfig)
        ? (frame.code.endsWith("AUTH_FAILED")
          ? "cloud_relay_admission_denied" : "cloud_relay_transport_error")
        : `${frame.code}: ${frame.message}`;
      if (!frame.requestId && frame.code.endsWith("AUTH_FAILED")) {
        socket.close(1008, "Relay authentication failed");
      }
    }
  }

  private async handleLocalRequest(frame: RelayRequestFrame) {
    if (this.activeRequests.has(frame.requestId)) {
      this.sendError(
        frame.requestId,
        "REQUEST_ID_IN_USE",
        "A local relay request with this id is already active",
        false,
      );
      return;
    }

    let body: Buffer | undefined;
    try {
      body = decodeRequestBody(frame.bodyBase64);
    } catch (error) {
      this.sendError(
        frame.requestId,
        "REQUEST_BODY_TOO_LARGE",
        error instanceof Error ? error.message : String(error),
        false,
      );
      return;
    }

    if ((frame.method === "GET" || frame.method === "HEAD") && body?.byteLength) {
      this.sendError(
        frame.requestId,
        "REQUEST_BODY_NOT_ALLOWED",
        `${frame.method} relay requests cannot include a body`,
        false,
      );
      return;
    }

    let target: URL;
    try {
      const base = new URL(this.localBaseUrl);
      target = new URL(frame.path, base);
      if (target.origin !== base.origin) {
        throw new Error("Relay request escaped the local Mira origin");
      }
    } catch (error) {
      this.sendError(
        frame.requestId,
        "INVALID_LOCAL_PATH",
        error instanceof Error ? error.message : String(error),
        false,
      );
      return;
    }

    const active: ActiveLocalRequest = {
      controller: new AbortController(),
      cancelled: false,
    };
    this.activeRequests.set(frame.requestId, active);

    try {
      const response = await this.localFetch(target, {
        method: frame.method,
        headers: sanitizeRequestHeaders(frame.headers),
        ...(body?.byteLength ? { body } : {}),
        signal: active.controller.signal,
      });

      if (active.cancelled) return;
      if (
        !this.send({
          version: RELAY_PROTOCOL_VERSION,
          type: "response",
          requestId: frame.requestId,
          status: response.status,
          headers: responseHeaders(response.headers),
        })
      ) {
        active.controller.abort();
        return;
      }

      if (!response.body) {
        this.sendComplete(frame.requestId);
        return;
      }

      const reader = response.body.getReader();
      let totalBytes = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done || active.cancelled) break;

          totalBytes += next.value.byteLength;
          if (totalBytes > RELAY_MAX_RESPONSE_BYTES) {
            active.controller.abort();
            this.sendError(
              frame.requestId,
              "RESPONSE_TOO_LARGE",
              "Local Mira response exceeds the Relay V1 response limit",
              false,
            );
            return;
          }

          for (const chunk of splitChunk(next.value)) {
            if (
              !this.send({
                version: RELAY_PROTOCOL_VERSION,
                type: "chunk",
                requestId: frame.requestId,
                encoding: "base64",
                data: Buffer.from(chunk).toString("base64"),
              })
            ) {
              active.controller.abort();
              return;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!active.cancelled) this.sendComplete(frame.requestId);
    } catch (error) {
      if (active.cancelled || (active.controller.signal.aborted && abortError(error))) {
        return;
      }
      this.sendError(
        frame.requestId,
        "LOCAL_REQUEST_FAILED",
        error instanceof Error ? error.message : String(error),
        true,
      );
    } finally {
      this.activeRequests.delete(frame.requestId);
    }
  }

  private sendComplete(requestId: string) {
    this.send({
      version: RELAY_PROTOCOL_VERSION,
      type: "complete",
      requestId,
    });
  }

  private sendError(
    requestId: string | undefined,
    code: string,
    message: string,
    retryable: boolean,
  ) {
    const frame: RelayErrorFrame = {
      version: RELAY_PROTOCOL_VERSION,
      type: "error",
      ...(requestId ? { requestId } : {}),
      code,
      message,
      retryable,
    };
    this.send(frame);
  }

  private send(frame: RelayOutboundHostFrame) {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return false;

    try {
      socket.send(serializeRelayFrame(frame));
      return true;
    } catch (error) {
      this.lastError = this.currentConfig && isCloud(this.currentConfig)
        ? "cloud_relay_transport_unavailable"
        : error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  private isCurrent(socket: RelaySocket, generation: number) {
    return this.socket === socket && this.generation === generation;
  }

  private scheduleReconnect() {
    if (this.stopped || !this.currentConfig?.enabled || this.reconnectTimer) {
      return;
    }

    const exponential = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempt, 5),
    );
    const jitter = Math.round(exponential * 0.2 * this.random());
    const delay = exponential + jitter;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private abortAllRequests() {
    for (const active of this.activeRequests.values()) {
      active.cancelled = true;
      active.controller.abort();
    }
    this.activeRequests.clear();
  }

  private stopHandshakeTimer() {
    if (!this.handshakeTimer) return;
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  private startKeepalive(socket: RelaySocket, generation: number) {
    this.stopKeepaliveTimer();
    let lastPongAt = Date.now();
    socket.on("pong", () => {
      if (this.isCurrent(socket, generation)) lastPongAt = Date.now();
    });
    this.keepaliveTimer = setInterval(() => {
      if (!this.isCurrent(socket, generation) || this.state !== "connected") {
        this.stopKeepaliveTimer();
        return;
      }
      if (Date.now() - lastPongAt > KEEPALIVE_TIMEOUT_MS) {
        this.lastError = "Mira Relay keepalive timed out";
        try {
          socket.close(1001, "Relay keepalive timeout");
        } catch {
          // Close failures are handled by the reconnect path.
        }
        return;
      }
      try {
        socket.ping();
      } catch (error) {
        this.lastError =
          error instanceof Error ? error.message : "Mira Relay keepalive failed";
        try {
          socket.close(1001, "Relay keepalive failed");
        } catch {
          // Close failures are handled by the reconnect path.
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
    this.keepaliveTimer.unref?.();
  }

  private stopKeepaliveTimer() {
    if (!this.keepaliveTimer) return;
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }

  private stopTimers() {
    this.stopHandshakeTimer();
    this.stopKeepaliveTimer();
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
