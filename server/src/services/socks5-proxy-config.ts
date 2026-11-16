import type { GeneralSettingsRecord } from "@/db/repositories/general-settings.repository.js";

// One source of truth for the encrypted General Settings SOCKS5 fields.
// Cloud Relay requires proxy-side DNS ("socks5h") on networks where
// the local DNS result is unroutable; existing consumers retain "socks5".
export const buildSocks5ProxyUrl = (
  settings: GeneralSettingsRecord,
  scheme: "socks5" | "socks5h" = "socks5",
): string | null => {
  const host = settings.socks5Host.trim();
  const port = Number.isInteger(settings.socks5Port) ? settings.socks5Port : 0;
  if (!host || port <= 0 || port > 65535) return null;

  const username = settings.socks5Username.trim();
  const password = settings.socks5Password.trim();
  const auth =
    username || password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : "";
  return `${scheme}://${auth}${host}:${port}`;
};
