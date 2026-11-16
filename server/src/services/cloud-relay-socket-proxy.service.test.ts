import { describe, expect, it, vi } from "vitest";
import { SocksProxyAgent } from "socks-proxy-agent";
import { createCloudRelaySocketFactory } from "./cloud-relay-socket-proxy.service.js";

const emptySettings = {
  socks5Host: "",
  socks5Port: 0,
  socks5Username: "",
  socks5Password: "",
};
const CLOUD_URL = "wss://isolated.example.test/v1/relay/server-room/socket";

describe("Cloud Relay WebSocket SOCKS5 boundary", () => {
  it("uses the original direct WebSocket when no SOCKS5 Host/Port is configured", () => {
    const direct = vi.fn((url: string) => ({ route: "direct", url }));
    const proxied = vi.fn(() => ({ route: "proxy", url: CLOUD_URL }));
    const socket = createCloudRelaySocketFactory(
      direct, proxied, () => emptySettings,
    )(CLOUD_URL);
    expect(socket).toEqual({ route: "direct", url: CLOUD_URL });
    expect(direct).toHaveBeenCalledExactlyOnceWith(CLOUD_URL);
    expect(proxied).not.toHaveBeenCalled();
  });

  it("routes Cloud WebSocket through socks5h with the original target URL intact", () => {
    const direct = vi.fn(() => ({}));
    const proxied = vi.fn((_url: string, _agent: SocksProxyAgent) => ({}));
    const readSettings = vi.fn(() => ({
      ...emptySettings, socks5Host: "127.0.0.1", socks5Port: 1080,
    }));
    const factory = createCloudRelaySocketFactory(direct, proxied, readSettings);

    factory(CLOUD_URL);
    expect(direct).not.toHaveBeenCalled();
    expect(proxied).toHaveBeenCalledOnce();
    const [url, agent] = proxied.mock.calls[0]!;
    expect(url).toBe(CLOUD_URL);
    expect(agent).toBeInstanceOf(SocksProxyAgent);
    expect(agent.proxyUrl).toBe("socks5h://127.0.0.1:1080");
  });

  it("re-reads the saved settings on reconnect; disabling the proxy restores direct mode", () => {
    const direct = vi.fn((url: string) => url);
    const proxied = vi.fn((url: string, _agent: SocksProxyAgent) => url);
    let settings = { ...emptySettings, socks5Host: "127.0.0.1", socks5Port: 1080 };
    const factory = createCloudRelaySocketFactory(direct, proxied, () => settings);
    factory(CLOUD_URL);
    settings = { ...emptySettings };
    factory(CLOUD_URL);
    expect(proxied).toHaveBeenCalledTimes(1);
    expect(direct).toHaveBeenCalledTimes(1);
  });

  it("never silently falls back to direct when saved settings or proxy setup fails", () => {
    const direct = vi.fn(() => ({}));
    const proxied = vi.fn(() => { throw new Error("proxy unreachable"); });
    const config = { ...emptySettings, socks5Host: "127.0.0.1", socks5Port: 1080 };

    expect(() => createCloudRelaySocketFactory(direct, proxied, () => config)(CLOUD_URL))
      .toThrow("proxy unreachable");
    expect(() => createCloudRelaySocketFactory(direct, proxied, () => {
      throw new Error("settings unavailable");
    })(CLOUD_URL)).toThrow("settings unavailable");
    expect(direct).not.toHaveBeenCalled();
  });
});
