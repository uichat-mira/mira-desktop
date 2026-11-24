import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/index.js", () => ({
  default: { PORT: 8787 },
}));

import {
  RemoteRelayConnectorService,
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

const parsedSent = (socket: FakeRelaySocket) =>
  socket.sent.map((item) => JSON.parse(item) as Record<string, unknown>);

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

  it("cannot start network I/O from retired legacy Relay settings", () => {
    const factory = vi.fn();
    const service = new RemoteRelayConnectorService(
      () => resolveCloudRelayConnectorConfig({
        UI_CHAT_REMOTE_RELAY_ENABLED: "1",
        UI_CHAT_REMOTE_RELAY_URL: "https://relay.tomz.io",
        UI_CHAT_REMOTE_RELAY_ID: "relay_1234567890abcdef",
        UI_CHAT_REMOTE_RELAY_HOST_TOKEN: "h".repeat(48),
        UI_CHAT_REMOTE_RELAY_CLIENT_TOKEN: "c".repeat(48),
      }),
      factory,
      fetch,
      "http://127.0.0.1:8787",
      () => 0,
    );

    service.start();

    // Legacy environment variables are ignored entirely. With no native Cloud
    // ticket bridge the official connector fails closed and never falls back
    // to the old room/token transport or its hostname.
    expect(service.getSnapshot()).toMatchObject({
      enabled: true,
      state: "disconnected",
      relayUrl: "wss://cloud-relay.tomz.io",
      lastError: "relay_ticket_bridge_unavailable",
    });
    expect(factory).not.toHaveBeenCalled();
    service.stop();
  });

  it("activates only for native Cloud login and never uses Legacy Relay infrastructure", () => {
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_REMOTE_RELAY_ENABLED: "1",
      UI_CHAT_REMOTE_RELAY_URL: "https://legacy.example.test",
      UI_CHAT_REMOTE_RELAY_HOST_TOKEN: "h".repeat(48),
    })).toEqual({
      kind: "cloud",
      enabled: true,
      relayUrl: "wss://cloud-relay.tomz.io",
    });
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_CLOUD_RELAY_ENABLED: "1",
      UI_CHAT_CLOUD_RELAY_URL: "https://official.example.test",
      NODE_ENV: "production",
    })).toEqual({ kind: "cloud", enabled: true,
      relayUrl: "wss://official.example.test" });
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_CLOUD_RELAY_URL: "https://official.example.test",
      NODE_ENV: "production",
    })).toEqual({ kind: "cloud", enabled: true,
      relayUrl: "wss://official.example.test" });
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_CLOUD_RELAY_URL: "https://relay.tomz.io",
    }).relayUrl).toBeNull();
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_CLOUD_RELAY_ENABLED: "0",
      UI_CHAT_CLOUD_RELAY_URL: "https://official.example.test",
    }).enabled).toBe(false);
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_CLOUD_RELAY_ENABLED: "1",
      UI_CHAT_CLOUD_RELAY_URL: "ws://insecure.example.test",
      NODE_ENV: "production",
    }).relayUrl).toBeNull();
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_CLOUD_RELAY_ENABLED: "1",
      UI_CHAT_CLOUD_RELAY_URL: "http://insecure.example.test",
      NODE_ENV: "development",
    }).relayUrl).toBeNull();
  });

  it("resolves the application-owned official endpoint without local environment", () => {
    const expected = {
      kind: "cloud" as const,
      enabled: true,
      relayUrl: "wss://cloud-relay.tomz.io",
    };
    expect(resolveCloudRelayConnectorConfig({})).toEqual(expected);
    expect(resolveCloudRelayConnectorConfig({ NODE_ENV: "development" }))
      .toEqual(expected);
    expect(resolveCloudRelayConnectorConfig({ NODE_ENV: "production" }))
      .toEqual(expected);
    expect(resolveCloudRelayConnectorConfig({ UI_CHAT_CLOUD_RELAY_URL: "  " }))
      .toEqual(expected);
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_CLOUD_RELAY_URL: "https://cloud-relay.tomz.io/",
    }).relayUrl).toBe("wss://cloud-relay.tomz.io");
  });

  it("keeps the operator-only emergency disable independent of the endpoint", () => {
    expect(resolveCloudRelayConnectorConfig({
      UI_CHAT_CLOUD_RELAY_ENABLED: "0",
    })).toEqual({
      kind: "cloud",
      enabled: false,
      relayUrl: "wss://cloud-relay.tomz.io",
    });
  });

  it("does not acquire a Cloud ticket or open a socket when emergency-disabled", () => {
    const factory = vi.fn();
    const withHostTicket = vi.fn();
    const service = new RemoteRelayConnectorService(
      () => resolveCloudRelayConnectorConfig({
        UI_CHAT_CLOUD_RELAY_ENABLED: "0",
      }),
      factory,
      fetch,
      "http://127.0.0.1:8787",
      () => 0,
      { withHostTicket, onRevoked: () => () => undefined },
    );
    service.start();
    expect(service.getSnapshot()).toMatchObject({
      enabled: false,
      state: "disabled",
      relayUrl: "wss://cloud-relay.tomz.io",
    });
    expect(withHostTicket).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    service.stop();
  });

  it("fails closed for malformed, unsafe and Legacy endpoint overrides", () => {
    for (const relayUrl of [
      "not-a-url",
      "https://cloud-relay.tomz.io/relay",
      "https://user:pass@cloud-relay.tomz.io",
      "https://cloud-relay.tomz.io/?token=secret",
      "wss://cloud-relay.tomz.io#fragment",
      "ws://cloud-relay.tomz.io",
      "http://cloud-relay.tomz.io",
      "ftp://cloud-relay.tomz.io",
      "https://relay.tomz.io",
      "https://relay.tomz.io.",
      "https://relay.tomz.io...",
      "https://relay.tomz.io" + ".".repeat(512),
      "wss://RELAY.TOMZ.IO",
    ]) {
      expect(
        resolveCloudRelayConnectorConfig({
          UI_CHAT_CLOUD_RELAY_URL: relayUrl,
        }).relayUrl,
        relayUrl,
      ).toBeNull();
    }
  });

  it("keeps an authenticated Cloud socket alive with native WebSocket pings", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeRelaySocket();
      const service = new RemoteRelayConnectorService(
        cloudConfig,
        (() => socket) as RelaySocketFactory,
        fetch,
        "http://127.0.0.1:8787",
        () => 0,
        {
          withHostTicket: async (consume) =>
            consume(ticket("cloud.jwt.signature")),
          onRevoked: () => () => undefined,
        },
      );

      service.start();
      await vi.advanceTimersByTimeAsync(0);
      socket.open();
      socket.message({
        version: 1, type: "hello_ack", role: "host",
        relayId: cloudRoom, protocolVersion: 1,
      });
      vi.advanceTimersByTime(90_000);

      expect(socket.pingCalls).toBe(3);
      service.stop();
      vi.advanceTimersByTime(90_000);
      expect(socket.pingCalls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("streams an authorized Cloud response through the shared frame engine", async () => {
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
      cloudConfig,
      (() => socket) as RelaySocketFactory,
      localFetch as unknown as RelayLocalFetch,
      "http://127.0.0.1:8787",
      () => 0,
      {
        withHostTicket: async (consume) =>
          consume(ticket("cloud.jwt.signature")),
        onRevoked: () => () => undefined,
      },
      async () => "one-shot-private-capability",
    );
    service.start();
    await Promise.resolve();
    socket.open();
    socket.message({
      version: 1, type: "hello_ack", role: "host",
      relayId: cloudRoom, protocolVersion: 1,
    });
    socket.sent = [];

    const id = "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e~stream";
    socket.message({
      version: 1, type: "request", requestId: id,
      method: "GET", path: "/remote/v1/workspaces",
      headers: { authorization: "Bearer forged-local-token" },
      relayProvenance: {
        version: 1, transport: "cloud", accountId: "account-a",
        deviceId: "phone-a", room: cloudRoom, role: "client",
        connectionId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e",
        requestId: id,
      },
    });

    await vi.waitFor(() => {
      expect(parsedSent(socket).some((frame) => frame.type === "complete"))
        .toBe(true);
    });
    const [target, init] = localFetch.mock.calls[0]!;
    expect(String(target)).toBe(
      "http://127.0.0.1:8787/remote/v1/workspaces",
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers["x-mira-cloud-internal-request"])
      .toBe("one-shot-private-capability");

    const frames = parsedSent(socket);
    expect(frames[0]).toMatchObject({
      type: "response",
      requestId: id,
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-mira-test": "yes",
      },
    });
    expect(
      (frames[0]?.headers as Record<string, string>)["set-cookie"],
    ).toBeUndefined();
    const chunk = frames.find((frame) => frame.type === "chunk");
    expect(Buffer.from(String(chunk?.data), "base64").toString("utf8"))
      .toBe('{"ok":true}');
    expect(frames.at(-1)).toMatchObject({ type: "complete", requestId: id });
    service.stop();
  });

  it("uses only the resolved default endpoint when acquiring a Cloud ticket", async () => {
    const urls: string[] = [];
    const sockets: FakeRelaySocket[] = [];
    const source: CloudRelayTicketSource = {
      withHostTicket: async (consumer) => consumer(ticket("cloud.jwt.signature")),
      onRevoked: () => () => undefined,
    };
    const service = new RemoteRelayConnectorService(
      () => resolveCloudRelayConnectorConfig({}),
      (url) => {
        urls.push(url);
        const socket = new FakeRelaySocket();
        sockets.push(socket);
        return socket;
      },
      fetch,
      "http://127.0.0.1:8787",
      () => 0,
      source,
    );
    service.start();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(urls).toEqual([
      `wss://cloud-relay.tomz.io/v1/relay/${cloudRoom}/socket`,
    ]);
    service.stop();
  });

  it("fails closed before ticket acquisition when the endpoint is Legacy", () => {
    const factory = vi.fn();
    const withHostTicket = vi.fn();
    const service = new RemoteRelayConnectorService(
      () => resolveCloudRelayConnectorConfig({
        UI_CHAT_CLOUD_RELAY_URL: "https://relay.tomz.io",
      }),
      factory,
      fetch,
      "http://127.0.0.1:8787",
      () => 0,
      { withHostTicket, onRevoked: () => () => undefined },
    );
    service.start();
    expect(service.getSnapshot()).toMatchObject({
      enabled: true,
      state: "misconfigured",
      relayUrl: null,
      lastError: "cloud_relay_endpoint_unavailable",
    });
    expect(factory).not.toHaveBeenCalled();
    expect(withHostTicket).not.toHaveBeenCalled();
    service.stop();
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
      enabled: true, state: "connected", lastError: null,
    });
    socket.message({
      version: 1, type: "request",
      requestId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e~untrusted-client",
      method: "POST", path: "/remote/v1/tool/invoke",
      headers: { authorization: "Bearer mira_device_legacy" },
      relayProvenance: {
        version: 1, transport: "cloud", accountId: "account-a",
        deviceId: "mobile-a", room: cloudRoom, role: "client",
        connectionId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e",
        requestId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e~untrusted-client",
      },
    });
    expect(parsedSent(socket).at(-1)).toMatchObject({
      type: "error", requestId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e~untrusted-client", code: "CLOUD_GRANT_REQUIRED",
      retryable: false,
    });
    expect(localFetch).not.toHaveBeenCalled();
    // Cloud Relay's socket cleanup sends a bare cancellation; accepting it
    // must not tear down the entire official Host WebSocket.
    socket.message({
      version: 1, type: "cancel",
      requestId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e~untrusted-client",
    });
    expect(socket.closeCalls).toEqual([]);
    expect(service.getSnapshot()).toMatchObject({
      state: "connected", lastError: null, activeRequests: 0,
    });
    expect(localFetch).not.toHaveBeenCalled();
    expect(ticketCount).toBe(1);
    service.stop();
  });

  it("forwards a scoped Cloud request only after a Grant, never forwarding Client JWT", async () => {
    const socket = new FakeRelaySocket();
    const localFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const source: CloudRelayTicketSource = {
      withHostTicket: async (consume) => consume(ticket("cloud.jwt.signature")),
      onRevoked: () => () => undefined,
    };
    const authorize = vi.fn(async () => "one-shot-private-capability");
    const service = new RemoteRelayConnectorService(
      cloudConfig, () => socket,
      localFetch as RelayLocalFetch,
      "http://127.0.0.1:8787", () => 0, source, authorize,
    );
    service.start();
    await Promise.resolve();
    socket.open();
    socket.message({ version: 1, type: "hello_ack", role: "host",
      relayId: cloudRoom, protocolVersion: 1 });
    const id = "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e~good";
    socket.message({
      version: 1, type: "request", requestId: id,
      method: "GET", path: "/remote/v1/workspaces",
      headers: { authorization: "Bearer forged-local-token",
        "x-mira-cloud-internal-request": "client-injected" },
      relayProvenance: {
        version: 1, transport: "cloud", accountId: "account-a",
        deviceId: "phone-a", room: cloudRoom, role: "client",
        connectionId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e",
        requestId: id,
      },
    });
    await vi.waitFor(() => expect(localFetch).toHaveBeenCalledOnce());
    const headers = localFetch.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers["x-mira-cloud-internal-request"])
      .toBe("one-shot-private-capability");
    expect(authorize).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(parsedSent(socket).some((f) =>
      f.type === "complete" && f.requestId === id)).toBe(true));
    service.stop();
  });

  it("cancels a pending Cloud Grant fetch before any local business side effect", async () => {
    const socket = new FakeRelaySocket();
    const localFetch = vi.fn();
    let release!: (value: string | null) => void;
    const waiting = new Promise<string | null>((resolve) => { release = resolve; });
    const source: CloudRelayTicketSource = {
      withHostTicket: async (consume) => consume(ticket("cloud.jwt.signature")),
      onRevoked: () => () => undefined,
    };
    const service = new RemoteRelayConnectorService(
      cloudConfig, () => socket,
      localFetch as unknown as RelayLocalFetch,
      "http://127.0.0.1:8787", () => 0, source, () => waiting,
    );
    service.start();
    await Promise.resolve();
    socket.open();
    socket.message({ version: 1, type: "hello_ack", role: "host",
      relayId: cloudRoom, protocolVersion: 1 });
    const id = "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e~pending";
    const proof = {
      version: 1, transport: "cloud", accountId: "account-a",
      deviceId: "phone-a", room: cloudRoom, role: "client",
      connectionId: "c6afaf4a-b2c0-4912-9ecd-abb3f45fb92e",
      requestId: id,
    };
    socket.message({ version: 1, type: "request", requestId: id,
      method: "GET", path: "/remote/v1/workspaces", relayProvenance: proof });
    socket.message({ version: 1, type: "cancel", requestId: id,
      relayProvenance: proof });
    release("opaque-capability");
    await vi.waitFor(() => expect(service.getSnapshot().state).toBe("connected"));
    await Promise.resolve();
    expect(localFetch).not.toHaveBeenCalled();
    expect(socket.closeCalls).toEqual([]);
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


describe("Cloud Relay T3 contract boundary — REL-001 pending", () => {
  const cloudRoom = "room_dGVzdC1yb29t";
  const makeSource = () => {
    let tickets = 0;
    const source: CloudRelayTicketSource = {
      withHostTicket: async (consumer) => consumer({
        token: "header.payload.signature-" + (++tickets),
        tokenType: "Bearer",
        audience: "mira:cloud-relay-transport",
        room: cloudRoom,
        role: "host",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
      onRevoked: () => () => undefined,
    };
    return { source, count: () => tickets };
  };
  const makeCloud = (socketFactory: RelaySocketFactory, source: CloudRelayTicketSource) =>
    new RemoteRelayConnectorService(
      () => ({ kind: "cloud", enabled: true, relayUrl: "wss://official.example.test" }),
      socketFactory, fetch, "http://127.0.0.1:8787", () => 0, source,
    );

  it("recognizes the real V1 legacy CLIENT_TOKEN_REQUIRED rejection before hello_ack and stops retrying", async () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeRelaySocket[] = [];
      const { source, count } = makeSource();
      const service = makeCloud(() => {
        const socket = new FakeRelaySocket();
        sockets.push(socket);
        return socket;
      }, source);
      service.start();
      await Promise.resolve();
      await Promise.resolve();
      expect(sockets).toHaveLength(1);
      const socket = sockets[0]!;
      socket.open();
      // From uichat-mira-relay@a41ada7: an unprovisioned Host room
      // rejects the cloud hello because it lacks a legacy clientToken.
      socket.message({
        version: 1, type: "error",
        code: "CLIENT_TOKEN_REQUIRED",
        message: "The first host connection must provision a client relay token",
        retryable: false,
      });
      expect(socket.closeCalls.at(-1)?.code).toBe(1008);
      expect(service.getSnapshot()).toMatchObject({
        state: "disconnected",
        lastError: "cloud_relay_protocol_incompatible",
      });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(sockets).toHaveLength(1);
      expect(count()).toBe(1);
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a cloud admission denial instead of replacing it with close reason", async () => {
    const sockets: FakeRelaySocket[] = [];
    const { source } = makeSource();
    const service = makeCloud(() => {
      const socket = new FakeRelaySocket();
      sockets.push(socket);
      return socket;
    }, source);
    service.start();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.open();
    sockets[0]!.message({
      version: 1, type: "error", code: "HOST_AUTH_FAILED",
      message: "cloud session or jwt was rejected: do not expose",
      retryable: false,
    });
    expect(service.getSnapshot()).toMatchObject({
      state: "disconnected", lastError: "cloud_relay_admission_denied",
    });
    expect(JSON.stringify(service.getSnapshot())).not.toContain("jwt was rejected");
    service.stop();
  });

  it("refuses a Host hello_ack with a wrong room without marking cloud connected", async () => {
    const sockets: FakeRelaySocket[] = [];
    const { source } = makeSource();
    const service = makeCloud(() => {
      const socket = new FakeRelaySocket();
      sockets.push(socket);
      return socket;
    }, source);
    service.start();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.open();
    sockets[0]!.message({
      version: 1, type: "hello_ack", role: "host",
      relayId: "room_other_account", protocolVersion: 1,
    });
    expect(service.getSnapshot()).toMatchObject({
      state: "disconnected", connectedAt: null,
      lastError: "cloud_relay_handshake_mismatch",
    });
    expect(sockets[0]!.closeCalls.at(-1)?.code).toBe(1008);
    service.stop();
  });

  it("classifies hello timeout distinctly from a credential/admission rejection", async () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeRelaySocket[] = [];
      const { source } = makeSource();
      const service = makeCloud(() => {
        const socket = new FakeRelaySocket();
        sockets.push(socket);
        return socket;
      }, source);
      service.start();
      await Promise.resolve();
      await Promise.resolve();
      sockets[0]!.open();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(service.getSnapshot()).toMatchObject({
        state: "disconnected",
        lastError: "cloud_relay_handshake_timeout",
      });
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
