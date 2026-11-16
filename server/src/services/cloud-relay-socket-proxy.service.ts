import { SocksProxyAgent } from "socks-proxy-agent";
import type { GeneralSettingsRecord } from "@/db/repositories/general-settings.repository.js";
import { buildSocks5ProxyUrl } from "@/services/socks5-proxy-config.js";

// Applies to the official Cloud Relay socket only. No process-wide proxy,
// legacy Relay, Tailscale or native Cloud OAuth behavior is changed.
export const createCloudRelaySocketFactory = <Socket>(
  direct: (url: string) => Socket,
  proxied: (url: string, agent: SocksProxyAgent) => Socket,
  readSettings: () => GeneralSettingsRecord,
): ((url: string) => Socket) =>
  (url) => {
    // Re-read on each connection so a reconnect picks up updated settings.
    // If configured proxy setup or settings access fails, let the Cloud
    // connector fail closed; never silently retry via direct transport.
    const proxyUrl = buildSocks5ProxyUrl(readSettings(), "socks5h");
    return proxyUrl
      ? proxied(url, new SocksProxyAgent(proxyUrl))
      : direct(url);
  };
