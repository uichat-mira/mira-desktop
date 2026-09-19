import type { FastifyPluginAsync } from "fastify";
import { verifyAccessToken } from "@/db/auth.db.js";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";

export const WEBBRIDGE_NATIVE_PIPE_PATH = process.env.UI_CHAT_WEBBRIDGE_PIPE?.trim()
  || (process.platform === "win32"
    ? "\\\\.\\pipe\\uichat-mira-webbridge-v1"
    : `/tmp/uichat-mira-webbridge-${typeof process.getuid === "function" ? process.getuid() : "user"}.sock`);

type WebBridgeSocket = {
  readonly readyState: number;
  send(payload: string): void;
  close(): void;
  on(event: "message" | "close" | "error", listener: (...args: unknown[]) => void): void;
};

type WebBridgeClient = {
  id: string;
  socket: WebBridgeSocket;
  role: "unknown" | "extension" | "ui";
  authenticated: boolean;
  accessToken?: string;
  userId?: number;
  transport?: "websocket" | "native";
  capabilities?: unknown[];
  cleanedUp?: boolean;
};

type PendingRequest = {
  client?: WebBridgeClient;
  userId?: number;
  originalId: string;
  resolve?: (value: unknown) => void;
  reject?: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export type WebBridgeInvocationErrorDetail = {
  code: string;
  message: string;
  retryable: boolean;
  suggestedAction?: string | null;
};

export class WebBridgeInvocationError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly suggestedAction?: string | null;

  constructor(detail: WebBridgeInvocationErrorDetail) {
    super(detail.message);
    this.name = "WebBridgeInvocationError";
    this.code = detail.code;
    this.retryable = detail.retryable;
    if (detail.suggestedAction !== undefined) {
      this.suggestedAction = detail.suggestedAction;
    }
  }
}

export const toWebBridgeInvocationError = (
  value: unknown,
  fallback: WebBridgeInvocationErrorDetail,
) => {
  if (!value || typeof value !== "object") {
    return new WebBridgeInvocationError(fallback);
  }

  const detail = value as Record<string, unknown>;
  return new WebBridgeInvocationError({
    code: typeof detail.code === "string" && detail.code
      ? detail.code
      : fallback.code,
    message: typeof detail.message === "string" && detail.message
      ? detail.message
      : fallback.message,
    retryable: typeof detail.retryable === "boolean"
      ? detail.retryable
      : fallback.retryable,
    ...(typeof detail.suggestedAction === "string" || detail.suggestedAction === null
      ? { suggestedAction: detail.suggestedAction }
      : fallback.suggestedAction === undefined
        ? {}
        : { suggestedAction: fallback.suggestedAction }),
  });
};

const PROTOCOL_VERSION = 1;
const MIN_EXTENSION_VERSION = "0.7.1";
const HELLO_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const EXPERT_REQUEST_TIMEOUT_MS = 125_000;
const clients = new Map<string, WebBridgeClient>();
const pending = new Map<string, PendingRequest>();
const extensionClients = new Map<number, WebBridgeClient>();
let clientSequence = 0;
let extensionTools: unknown[] = [];
let extensionCapabilities: unknown[] = [];

const send = (client: WebBridgeClient, payload: Record<string, unknown>) => {
  if (client.socket.readyState === 1) client.socket.send(JSON.stringify(payload));
};

const sendError = (client: WebBridgeClient, id: string | null, code: string, message: string) => {
  send(client, {
    version: PROTOCOL_VERSION,
    type: "response",
    id,
    ok: false,
    error: { code, message, retryable: false },
  });
};

const broadcastStatus = (status: string) => {
  for (const client of clients.values()) {
    if (client.role !== "ui" || !client.authenticated) continue;
    send(client, {
      version: PROTOCOL_VERSION,
      type: "status",
      status,
      extensionConnected: client.userId !== undefined && extensionClients.has(client.userId),
      transport: client.userId === undefined ? undefined : extensionClients.get(client.userId)?.transport,
      tools: extensionTools,
      capabilities: extensionCapabilities,
    });
  }
};

export const invokeWebBridge = (input: {
  userId: number;
  tool: string;
  params: Record<string, unknown>;
  signal?: AbortSignal;
}) => new Promise<unknown>((resolve, reject) => {
  const extensionClient = extensionClients.get(input.userId);
  if (!extensionClient || extensionClient.socket.readyState !== 1) {
    reject(new WebBridgeInvocationError({
      code: "BRIDGE_DISCONNECTED",
      message: "触界扩展尚未连接",
      retryable: true,
      suggestedAction: "连接触界 Chrome 扩展后重试",
    }));
    return;
  }
  if (input.signal?.aborted) {
    reject(new WebBridgeInvocationError({
      code: "ACTION_ABORTED",
      message: "触界浏览器操作已取消",
      retryable: false,
      suggestedAction: null,
    }));
    return;
  }
  const id = `server_${crypto.randomUUID()}`;
  const relayId = `${extensionClient.id}:${id}`;
  const pendingRequest: PendingRequest = { userId: input.userId, originalId: id, resolve, reject };
  pending.set(relayId, pendingRequest);
  send(extensionClient, { version: PROTOCOL_VERSION, type: "request", id: relayId, tool: input.tool, params: input.params });
  const isExpertRequest = input.tool.startsWith("expert.");
  const timer = setTimeout(() => {
    if (pending.delete(relayId)) {
      reject(new WebBridgeInvocationError({
        code: isExpertRequest ? "CHATGPT_RESPONSE_TIMEOUT" : "ACTION_TIMEOUT",
        message: isExpertRequest ? "等待外部专家回复超时" : "触界浏览器操作超时",
        retryable: true,
        suggestedAction: isExpertRequest ? "确认外部网页仍在生成回复后再重试" : "重新观察当前页面状态后再决定是否重试",
      }));
    }
  }, isExpertRequest ? EXPERT_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS);
  pendingRequest.timer = timer;
  const abort = () => {
    clearTimeout(timer);
    if (pending.delete(relayId)) {
      reject(new WebBridgeInvocationError({
        code: "ACTION_ABORTED",
        message: "触界浏览器操作已取消",
        retryable: false,
        suggestedAction: null,
      }));
    }
  };
  input.signal?.addEventListener("abort", abort, { once: true });
});

const parseMessage = (raw: unknown): Record<string, unknown> | null => {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const authenticate = (token: unknown) =>
  typeof token === "string" && token.length > 0 ? verifyAccessToken(token) : null;

const attachWebBridgeClient = (socket: WebBridgeSocket) => {
  const client: WebBridgeClient = {
    id: `webbridge_${++clientSequence}`,
    socket,
    role: "unknown",
    authenticated: false,
  };
  clients.set(client.id, client);

  const helloTimer = setTimeout(() => {
    if (client.role === "unknown") client.socket.close();
  }, HELLO_TIMEOUT_MS);

  socket.on("message", (raw) => {
    const message = parseMessage(raw);
    if (!message) {
      sendError(client, null, "INVALID_MESSAGE", "WebBridge 消息不是合法 JSON");
      return;
    }

    if (client.role === "unknown") {
      if (message.type !== "hello") {
        sendError(client, null, "HELLO_REQUIRED", "连接必须先发送 hello");
        client.socket.close();
        return;
      }
      clearTimeout(helloTimer);
      const accessToken = typeof message.accessToken === "string" ? message.accessToken : "";
      const user = authenticate(accessToken);
      if (!user) {
        sendError(client, null, "AUTH_REQUIRED", "WebBridge 需要有效的 Mira 授权令牌");
        client.socket.close();
        return;
      }
      client.authenticated = true;
      client.accessToken = accessToken;
      client.userId = user.id;
      if (message.client === "mira-webbridge-extension") {
        const extensionVersion = typeof message.extensionVersion === "string" ? message.extensionVersion : "unknown";
        const protocolVersion = Number(message.protocolVersion ?? message.version);
        if (protocolVersion !== PROTOCOL_VERSION) {
          sendError(client, null, "PROTOCOL_VERSION_UNSUPPORTED", `触界协议版本不兼容，需要协议 ${PROTOCOL_VERSION}`);
          client.socket.close();
          return;
        }
        client.role = "extension";
        client.transport = message.transport === "native" ? "native" : "websocket";
        const existingExtension = extensionClients.get(user.id);
        if (existingExtension && existingExtension !== client) existingExtension.socket.close();
        extensionClients.set(user.id, client);
        extensionTools = Array.isArray(message.tools) ? message.tools : [];
        extensionCapabilities = Array.isArray(message.capabilities) ? message.capabilities : [];
        send(client, {
          version: PROTOCOL_VERSION,
          type: "hello_ack",
          role: "host",
          protocolVersion: PROTOCOL_VERSION,
          minExtensionVersion: MIN_EXTENSION_VERSION,
          extensionVersion,
          transport: client.transport,
          tools: extensionTools,
          capabilities: extensionCapabilities,
        });
        broadcastStatus("extension_connected");
        return;
      }
      if (message.client === "mira-webbridge-ui") {
        client.role = "ui";
        send(client, {
          version: PROTOCOL_VERSION,
          type: "hello_ack",
          role: "ui",
          extensionConnected: extensionClients.has(user.id),
          transport: extensionClients.get(user.id)?.transport,
          tools: extensionTools,
          capabilities: extensionCapabilities,
        });
        return;
      }
      sendError(client, null, "INVALID_CLIENT", "未知的 WebBridge 客户端类型");
      client.socket.close();
      return;
    }

    if (!client.authenticated || !client.accessToken) return;

    // WebBridge connections can outlive the 24-hour JWT. Revalidate before
    // every post-handshake message so an expired session cannot keep invoking
    // browser operations until the socket happens to reconnect.
    const currentUser = authenticate(client.accessToken);
    if (!currentUser) {
      client.authenticated = false;
      sendError(client, typeof message.id === "string" ? message.id : null, "AUTH_REQUIRED", "WebBridge 授权已失效，请重新登录");
      send(client, {
        version: PROTOCOL_VERSION,
        type: "status",
        status: "auth_required",
        code: "AUTH_REQUIRED",
        message: "WebBridge 授权已失效，请重新登录",
      });
      client.socket.close();
      return;
    }
    if (currentUser.id !== client.userId) {
      client.authenticated = false;
      sendError(client, typeof message.id === "string" ? message.id : null, "AUTH_REQUIRED", "WebBridge 用户身份已变化，请重新登录");
      client.socket.close();
      return;
    }

    if (client.role === "ui" && message.type === "request") {
      const extensionClient = client.userId === undefined ? null : extensionClients.get(client.userId);
      if (!extensionClient) {
        sendError(client, typeof message.id === "string" ? message.id : null, "BRIDGE_DISCONNECTED", "触界扩展尚未连接");
        return;
      }
      if (typeof message.id !== "string" || typeof message.tool !== "string") {
        sendError(client, typeof message.id === "string" ? message.id : null, "INVALID_REQUEST", "工具请求缺少 id 或 tool");
        return;
      }
      const relayId = `${client.id}:${message.id}`;
      pending.set(relayId, { client, userId: client.userId, originalId: message.id });
      send(extensionClient, { ...message, id: relayId, version: PROTOCOL_VERSION });
      return;
    }

    if (client.role === "ui" && message.type === "control" && message.command === "set_transport") {
      const extensionClient = client.userId === undefined ? null : extensionClients.get(client.userId);
      if (!extensionClient || !["websocket", "native"].includes(String(message.transport))) {
        sendError(client, null, "INVALID_TRANSPORT", "连接方式不可用或触界扩展未连接");
        return;
      }
      send(extensionClient, { version: PROTOCOL_VERSION, type: "control", command: "set_transport", transport: message.transport });
      return;
    }

    if (client.role === "ui" && message.type === "control" && ["clip_rules_get", "clip_rules_set", "clip_region_pick"].includes(String(message.command))) {
      const extensionClient = client.userId === undefined ? null : extensionClients.get(client.userId);
      if (!extensionClient) {
        sendError(client, typeof message.id === "string" ? message.id : null, "BRIDGE_DISCONNECTED", "触界扩展尚未连接");
        return;
      }
      if (typeof message.id !== "string") {
        sendError(client, null, "INVALID_REQUEST", "剪藏规则请求缺少 id");
        return;
      }
      const relayId = `${client.id}:${message.id}`;
      pending.set(relayId, { client, userId: client.userId, originalId: message.id });
      send(extensionClient, { ...message, id: relayId, version: PROTOCOL_VERSION });
      return;
    }

    if (client.role === "extension" && message.type === "response" && typeof message.id === "string") {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (request.client) {
        send(request.client, { ...message, id: request.originalId, version: PROTOCOL_VERSION });
      } else if (message.ok === false) {
        if (request.timer) clearTimeout(request.timer);
        request.reject?.(toWebBridgeInvocationError(message.error, {
          code: "WEBBRIDGE_INVOCATION_FAILED",
          message: "触界浏览器操作失败",
          retryable: false,
        }));
      } else {
        if (request.timer) clearTimeout(request.timer);
        request.resolve?.(message.result);
      }
    }

    if (client.role === "extension" && message.type === "status") {
      for (const uiClient of clients.values()) {
        if (uiClient.role !== "ui" || uiClient.userId !== client.userId || !uiClient.authenticated) continue;
        send(uiClient, { ...message, type: "status", extensionConnected: true, transport: client.transport, tools: extensionTools, capabilities: extensionCapabilities });
      }
    }
  });

  const cleanup = () => {
    if (client.cleanedUp) return;
    client.cleanedUp = true;
    clearTimeout(helloTimer);
    clients.delete(client.id);
    for (const [id, request] of pending) {
      if (request.client === client || (client.role === "extension" && request.userId === client.userId)) {
        pending.delete(id);
        if (request.client && request.client !== client) {
          sendError(request.client, request.originalId, "BRIDGE_DISCONNECTED", "触界扩展已断开");
        } else if (!request.client) {
          if (request.timer) clearTimeout(request.timer);
          request.reject?.(new WebBridgeInvocationError({
            code: "BRIDGE_DISCONNECTED",
            message: "触界扩展已断开",
            retryable: true,
            suggestedAction: "重新连接触界 Chrome 扩展后重试",
          }));
        }
      }
    }
    if (client.userId !== undefined && extensionClients.get(client.userId) === client) {
      extensionClients.delete(client.userId);
      extensionTools = [];
      extensionCapabilities = [];
      broadcastStatus("extension_disconnected");
    }
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
};

const createPipeSocketAdapter = (socket: net.Socket): WebBridgeSocket => {
  let buffer = "";
  const messageListeners: Array<(...args: unknown[]) => void> = [];

  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += String(chunk);
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      for (const listener of messageListeners) listener(line);
    }
  });

  return {
    get readyState() {
      return socket.destroyed ? 3 : 1;
    },
    send(payload: string) {
      if (!socket.destroyed && socket.writable) socket.write(`${payload}\n`);
    },
    close() {
      socket.destroy();
    },
    on(event, listener) {
      if (event === "message") {
        messageListeners.push(listener);
        return;
      }
      socket.on(event, listener as (...args: unknown[]) => void);
    },
  };
};

const webbridgeRoute: FastifyPluginAsync = async (app) => {
  let nativePipeServer: net.Server | null = null;

  app.get("/webbridge", { websocket: true }, (connection) => {
    attachWebBridgeClient(connection.socket as unknown as WebBridgeSocket);
  });

  app.addHook("onListen", async () => {
    if (nativePipeServer) return;
    if (process.platform !== "win32" && fs.existsSync(WEBBRIDGE_NATIVE_PIPE_PATH)) {
      fs.unlinkSync(WEBBRIDGE_NATIVE_PIPE_PATH);
    }

    nativePipeServer = net.createServer((socket) => {
      attachWebBridgeClient(createPipeSocketAdapter(socket));
    });

    await new Promise<void>((resolve, reject) => {
      const server = nativePipeServer;
      if (!server) return reject(new Error("WebBridge Native pipe server unavailable"));
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(WEBBRIDGE_NATIVE_PIPE_PATH);
    });

    nativePipeServer.on("error", (error) => {
      app.log.error({ err: error }, "WebBridge Native pipe server error");
    });
    app.log.info({ pipe: WEBBRIDGE_NATIVE_PIPE_PATH }, "WebBridge Native pipe listening");
  });

  app.addHook("onClose", async () => {
    const server = nativePipeServer;
    nativePipeServer = null;
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (process.platform !== "win32" && fs.existsSync(WEBBRIDGE_NATIVE_PIPE_PATH)) {
      try { fs.unlinkSync(WEBBRIDGE_NATIVE_PIPE_PATH); } catch { /* ignore cleanup race */ }
    }
  });
};

export default webbridgeRoute;
