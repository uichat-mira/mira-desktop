import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/index.js", () => ({
  default: { PORT: 8787 },
}));

import {
  RemoteRelayConnectorService,
  resolveRemoteRelayConnectorConfig,
  resolveCloudRelayConnectorConfig,
  type CloudRelayTicketSource,
  type RelayLocalFetch,
  type RelaySocketFactory,
} from "./remote-relay-connector.service.js";

type ListenerMap = {
  open: Array<() => void>;
  message: Array<(event: { data: unknown }) => void>;
  error: Array<() => void>;
  close: Array<(event: { code?: number; reason?: string }) => void>;
  pong: Array<() => void>;
};

class FakeRelaySocket {
  readyState = 0;
  sent: string[] = [];
  pingCalls = 0;
  autoPong = true;
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  private listeners: ListenerMap = {
    open: [],
    message: [],
    error: [],
    close: [],
    pong: [],
  };

  send(data: string) {
    this.sent.push(data);
  }

  ping() {
    this.pingCalls += 1;
    if (this.autoPong) {
      for (const listener of this.listeners.pong) listener();
    }
  }

  on(type: "pong", listener: () => void) {
    this.listeners[type].push(listener);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    if (this.readyState === 3) return;
    this.readyState = 3;
    for (const listener of this.listeners.close) {
      listener({ code, reason });
    }
  }

  addEventListener(
    type: keyof ListenerMap,
    listener:
      | (() => void)
      | ((event: { data: unknown }) => void)
      | ((event: { code?: number; reason?: string }) => void),
  ) {
    (this.listeners[type] as Array<typeof listener>).push(listener);
  }

  open() {
    this.readyState = 1;
    for (const listener of this.listeners.open) listener();
  }

  message(frame: Record<string, unknown>) {
    const data = JSON.stringify(frame);
    for (const listener of this.listeners.message) listener({ data });
  }
}

const validConfig = () => ({
  enabled: true,
  relayUrl: "wss://relay.example.com",
  relayId: "relay_1234567890abcdef",
  hostToken: "h".repeat(48),
  clientToken: "c".repeat(48),
});

const parsedSent = (socket: FakeRelaySocket) =>
  socket.sent.map((item) => JSON.parse(item) as Record<string, unknown>);

const connectHost = (service: RemoteRelayConnectorService, socket: FakeRelaySocket) => {
  service.start();
  socket.open();
  socket.message({
    version: 1,
    type: "hello_ack",
    role: "host",
    relayId: validConfig().relayId,
    protocolVersion: 1,
  });
};

describe("resolveRemoteRelayConnectorConfig", () => {
  it("keeps Relay disabled by default and normalizes HTTPS to WSS", () => {
    expect(resolveRemoteRelayConnectorConfig({})).toEqual({
      enabled: false,
      relayUrl: null,
      relayId: null,
      hostToken: null,
      clientToken: null,
    });

    const config = resolveRemoteRelayConnectorConfig({
      NODE_ENV: "production",
      UI_CHAT_REMOTE_RELAY_ENABLED: "1",
      UI_CHAT_REMOTE_RELAY_URL: "https://relay.example.com",
      UI_CHAT_REMOTE_RELAY_ID: "relay_1234567890abcdef",
      UI_CHAT_REMOTE_RELAY_HOST_TOKEN: "h".repeat(48),
      UI_CHAT_REMOTE_RELAY_CLIENT_TOKEN: "c".repeat(48),
    });

    expect(config.relayUrl).toBe("wss://relay.example.com");
    expect(config.enabled).toBe(true);
  });

  it("rejects plaintext Relay URLs in production", () => {
    const config = resolveRemoteRelayConnectorConfig({
      NODE_ENV: "production",
      UI_CHAT_REMOTE_RELAY_ENABLED: "1",
      UI_CHAT_REMOTE_RELAY_URL: "ws://relay.example.com",
      UI_CHAT_REMOTE_RELAY_ID: "relay_1234567890abcdef",
      UI_CHAT_REMOTE_RELAY_HOST_TOKEN: "h".repeat(48),
      UI_CHAT_REMOTE_RELAY_CLIENT_TOKEN: "c".repeat(48),
    });

    expect(config.relayUrl).toBeNull();
  });
});

describe("RemoteRelayConnectorService", () => {
  it("performs host hello before accepting relay traffic", () => {
    const socket = new FakeRelaySocket();
    let requestedUrl = "";
    const socketFactory: RelaySocketFactory = (url) => {
      requestedUrl = url;
      return socket;
    };
    const service = new RemoteRelayConnectorService(
      validConfig,
      socketFactory,
      fetch,
      "http://127.0.0.1:8787",
      () => 0,
    );

    service.start();
    expect(service.getSnapshot().state).toBe("connecting");
    expect(requestedUrl).toBe(
      "wss://relay.example.com/v1/relay/relay_1234567890abcdef/socket",
    );

    socket.open();
    expect(parsedSent(socket)[0]).toEqual({
      version: 1,
      type: "hello",
      role: "host",
      relayId: "relay_1234567890abcdef",
      token: "h".repeat(48),
      clientToken: "c".repeat(48),
    });

    socket.message({
      version: 1,
      type: "hello_ack",
      role: "host",
      relayId: "relay_1234567890abcdef",
      protocolVersion: 1,
    });

    expect(service.getSnapshot()).toMatchObject({
      state: "connected",
      relayId: "relay_1234567890abcdef",
      lastError: null,
      reconnectAttempt: 0,
    });
    service.stop();
  });

  it("keeps an authenticated host socket alive with native WebSocket pings", () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeRelaySocket();
      const service = new RemoteRelayConnectorService(
        validConfig,
        (() => socket) as RelaySocketFactory,
        fetch,
        "http://127.0.0.1:8787",
      );

      connectHost(service, socket);
      vi.advanceTimersByTime(90_000);

      expect(socket.pingCalls).toBe(3);
      service.stop();
      vi.advanceTimersByTime(90_000);
      expect(socket.pingCalls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnects when Relay stops acknowledging keepalive pings", () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeRelaySocket();
      socket.autoPong = false;
      const service = new RemoteRelayConnectorService(
        validConfig,
        (() => socket) as RelaySocketFactory,
        fetch,
        "http://127.0.0.1:8787",
      );

      connectHost(service, socket);
      vi.advanceTimersByTime(60_000);

      expect(socket.closeCalls.at(-1)).toMatchObject({
        code: 1001,
        reason: "Relay keepalive timeout",
      });
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards an authenticated local request and streams response bytes", async () => {
    const socket = new FakeRelaySocket();
    const localFetch = vi.fn(async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-mira-test": "yes",
          "set-cookie": "must-not-leak=1",
        },
      }),
    );
    const service = new RemoteRelayConnectorService(
      validConfig,
      (() => socket) as RelaySocketFactory,
      localFetch as unknown as RelayLocalFetch,
      "http://127.0.0.1:8787",
      () => 0,
    );
    connectHost(service, socket);
    socket.sent = [];

    socket.message({
      version: 1,
      type: "request",
      requestId: "client-1~req_1",
      method: "GET",
      path: "/remote/v1/manifest",
      headers: {
        authorization: "Bearer mira_device_example",
        host: "evil.example.com",
        "x-forwarded-host": "evil.example.com",
      },
    });

    await vi.waitFor(() => {
      expect(parsedSent(socket).some((frame) => frame.type === "complete")).toBe(
        true,
      );
    });

    expect(localFetch).toHaveBeenCalledTimes(1);
    const [target, init] = localFetch.mock.calls[0]!;
    expect(String(target)).toBe("http://127.0.0.1:8787/remote/v1/manifest");
    expect(init).toMatchObject({ method: "GET" });
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer mira_device_example",
    );
    expect((init?.headers as Record<string, string>).host).toBeUndefined();
    expect(
      (init?.headers as Record<string, string>)["x-forwarded-host"],
    ).toBeUndefined();

    const frames = parsedSent(socket);
    expect(frames[0]).toMatchObject({
      type: "response",
      requestId: "client-1~req_1",
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-mira-test": "yes",
      },
    });
    const chunk = frames.find((frame) => frame.type === "chunk");
    expect(Buffer.from(String(chunk?.data), "base64").toString("utf8")).toBe(
      '{"ok":true}',
    );
    expect(frames.at(-1)).toMatchObject({
      type: "complete",
      requestId: "client-1~req_1",
    });
    service.stop();
  });

  it("aborts the local fetch when Relay sends cancel", async () => {
    const socket = new FakeRelaySocket();
    let aborted = false;
    const localFetch = vi.fn(
      async (_target: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            },
            { once: true },
          );
        }),
    );
    const service = new RemoteRelayConnectorService(
      validConfig,
      (() => socket) as RelaySocketFactory,
      localFetch as unknown as RelayLocalFetch,
      "http://127.0.0.1:8787",
      () => 0,
    );
    connectHost(service, socket);
    socket.sent = [];

    socket.message({
      version: 1,
      type: "request",
      requestId: "client-1~req_cancel",
      method: "POST",
      path: "/proxy/chat/default",
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from('{"id":"thread-1"}', "utf8").toString("base64"),
    });

    await vi.waitFor(() => expect(localFetch).toHaveBeenCalledTimes(1));
    socket.message({
      version: 1,
      type: "cancel",
      requestId: "client-1~req_cancel",
    });

    await vi.waitFor(() => expect(aborted).toBe(true));
    await vi.waitFor(() => expect(service.getSnapshot().activeRequests).toBe(0));
    expect(parsedSent(socket).some((frame) => frame.type === "error")).toBe(false);
    service.stop();
  });

  it("does not start when required Relay credentials are missing", () => {
    const socketFactory = vi.fn();
    const service = new RemoteRelayConnectorService(
      () => ({
        enabled: true,
        relayUrl: "wss://relay.example.com",
        relayId: "relay_1234567890abcdef",
        hostToken: null,
        clientToken: null,
      }),
      socketFactory,
      fetch,
      "http://127.0.0.1:8787",
    );

    service.start();

    expect(service.getSnapshot()).toMatchObject({
      state: "misconfigured",
      enabled: true,
    });
    expect(socketFactory).not.toHaveBeenCalled();
  });
});


describe("Cloud Relay connector — DSK-010 Round 2", () => {
  const cloudRoom = "room_dGVzdC1yb29t";
  const cloudUrl = "wss://cloud-relay.example.test";
  const cloudConfig = () => ({
    kind: "cloud" as const,
    enabled: true,
    relayUrl: cloudUrl,
  });
  const ticket = (token: string) => ({
    token, tokenType: "Bearer" as const,
    audience: "mira:cloud-relay-transport" as const,
    room: cloudRoom, role: "host" as const,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  });

  it("is opt-in and never inherits self-hosted/legacy Relay token settings", () => {
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_REMOTE_RELAY_ENABLED: "1",
      UI_CHAT_REMOTE_RELAY_URL: "https://legacy.example.test",
      UI_CHAT_REMOTE_RELAY_HOST_TOKEN: "h".repeat(48),
    })).toEqual({ kind: "cloud", enabled: false, relayUrl: null });
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_CLOUD_RELAY_ENABLED: "1",
      UI_CHAT_CLOUD_RELAY_URL: "https://official.example.test",
      NODE_ENV: "production",
    })).toEqual({ kind: "cloud", enabled: true,
      relayUrl: "wss://official.example.test" });
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_CLOUD_RELAY_ENABLED: "1",
      UI_CHAT_CLOUD_RELAY_URL: "ws://insecure.example.test",
      NODE_ENV: "production",
    }).relayUrl).toBeNull();
  });

  it("uses the native ticket for Host hello, never sends a legacy clientToken and blocks all business", async () => {
    const sockets: FakeRelaySocket[] = [];
    const urls: string[] = [];
    const localFetch = vi.fn();
    let ticketCount = 0;
    const source: CloudRelayTicketSource = {
      withHostTicket: async (consumer) => {
        ticketCount++;
        return consumer(ticket("cloud.jwt.signature"));
      },
      onRevoked: () => () => undefined,
    };
    const service = new RemoteRelayConnectorService(
      cloudConfig,
      (url) => {
        urls.push(url);
        const socket = new FakeRelaySocket();
        sockets.push(socket);
        return socket;
      },
      localFetch as unknown as RelayLocalFetch,
      "http://127.0.0.1:8787",
      () => 0,
      source,
    );
    service.start();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(urls).toEqual([
      cloudUrl + "/v1/relay/" + cloudRoom + "/socket",
    ]);
    const socket = sockets[0]!;
    socket.open();
    expect(parsedSent(socket)[0]).toEqual({
      version: 1, type: "hello", role: "host",
      relayId: cloudRoom, token: "cloud.jwt.signature",
    });
    socket.message({
      version: 1, type: "hello_ack", role: "host",
      relayId: cloudRoom, protocolVersion: 1,
    });
    expect(service.getSnapshot()).toMatchObject({
      enabled: true, state: "connected", relayId: null, lastError: null,
    });
    socket.message({
      version: 1, type: "request", requestId: "untrusted-client",
      method: "POST", path: "/remote/v1/tool/invoke",
      headers: { authorization: "Bearer mira_device_legacy" },
    });
    expect(parsedSent(socket).at(-1)).toMatchObject({
      type: "error", requestId: "untrusted-client", code: "CLOUD_GRANT_REQUIRED",
      retryable: false,
    });
    expect(localFetch).not.toHaveBeenCalled();
    expect(ticketCount).toBe(1);
    service.stop();
  });

  it("refreshes the ticket for every reconnect, not when a healthy socket ticket expires", async () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeRelaySocket[] = [];
      let ticketCount = 0;
      const source: CloudRelayTicketSource = {
        withHostTicket: async (consumer) => {
          ticketCount++;
          return consumer(ticket("cloud.jwt.ticket-" + ticketCount));
        },
        onRevoked: () => () => undefined,
      };
      const service = new RemoteRelayConnectorService(
        cloudConfig, () => {
          const s = new FakeRelaySocket();
          sockets.push(s);
          return s;
        }, fetch, "http://127.0.0.1:8787", () => 0, source,
      );
      service.start();
      await Promise.resolve();
      await Promise.resolve();
      expect(sockets).toHaveLength(1);
      const first = sockets[0]!;
      first.open();
      first.message({ version: 1, type: "hello_ack", role: "host",
        relayId: cloudRoom, protocolVersion: 1 });
      await vi.advanceTimersByTimeAsync(301_000);
      expect(service.getSnapshot().state).toBe("connected");
      expect(ticketCount).toBe(1);
      first.close(1001, "transport lost");
      await vi.advanceTimersByTimeAsync(1000);
      expect(sockets).toHaveLength(2);
      expect(ticketCount).toBe(2);
      sockets[1]!.open();
      expect(parsedSent(sockets[1]!)[0]).toMatchObject({
        token: "cloud.jwt.ticket-2",
      });
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("revocation stops the live socket and cannot reconnect with an old ticket", async () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeRelaySocket[] = [];
      let revoked: ((reason: "signout" | "reauth" | "bridge_disconnected") => void)
        | undefined;
      let available = true;
      let issuance = 0;
      const source: CloudRelayTicketSource = {
        withHostTicket: async (consumer) => {
          issuance++;
          if (!available) throw Object.assign(
            new Error("never forward raw cloud token"), { code: "relay_ticket_reauth" });
          return consumer(ticket("cloud.jwt.ticket-" + issuance));
        },
        onRevoked(listener) {
          revoked = listener;
          return () => { revoked = undefined; };
        },
      };
      const service = new RemoteRelayConnectorService(
        cloudConfig, () => {
          const s = new FakeRelaySocket();
          sockets.push(s);
          return s;
        }, fetch, "http://127.0.0.1:8787", () => 0, source,
      );
      service.start();
      await Promise.resolve();
      await Promise.resolve();
      expect(sockets).toHaveLength(1);
      sockets[0]!.open();
      sockets[0]!.message({ version: 1, type: "hello_ack", role: "host",
        relayId: cloudRoom, protocolVersion: 1 });
      available = false;
      revoked?.("signout");
      await Promise.resolve();
      await Promise.resolve();
      expect(sockets[0]!.closeCalls.length).toBeGreaterThan(0);
      expect(service.getSnapshot().state).toBe("disconnected");
      await vi.advanceTimersByTimeAsync(1000);
      expect(sockets).toHaveLength(1);
      expect(service.getSnapshot().lastError).toBe("relay_ticket_reauth");
      expect(issuance).toBeGreaterThanOrEqual(2);
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed without native IPC, never attempts the configured legacy Relay", async () => {
    const factory = vi.fn();
    const source: CloudRelayTicketSource = {
      withHostTicket: async () => { throw Object.assign(
        new Error("native IPC unavailable"), { code: "relay_ticket_bridge_unavailable" }); },
      onRevoked: () => () => undefined,
    };
    const service = new RemoteRelayConnectorService(
      cloudConfig, factory, fetch, "http://127.0.0.1:8787", () => 0, source,
    );
    service.start();
    await vi.waitFor(() => {
      expect(service.getSnapshot()).toMatchObject({
        state: "disconnected", lastError: "relay_ticket_bridge_unavailable",
      });
    });
    expect(factory).not.toHaveBeenCalled();
    service.stop();
  });
});
