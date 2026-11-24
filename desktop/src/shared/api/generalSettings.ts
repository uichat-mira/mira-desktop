import { del, get, post, put } from "@/shared/lib/request";

export interface GeneralSettings {
  socks5Host: string;
  socks5Port: number;
  socks5Username: string;
  socks5Password: string;
}

export type TailscaleRemoteRuntimeState =
  | "not_installed"
  | "needs_login"
  | "connecting"
  | "connected"
  | "serve_conflict"
  | "serve_not_configured"
  | "unreachable"
  | "ready"
  | "error";

export interface TailscaleRemoteAccessConfig {
  enabled: boolean;
  servePort: number;
  updatedAt: string | null;
}

export interface TailscaleRemoteRuntime {
  state: TailscaleRemoteRuntimeState;
  installed: boolean;
  backendState: string | null;
  version: string | null;
  deviceName: string | null;
  dnsName: string | null;
  tailnetName: string | null;
  tailnetDomain: string | null;
  tailscaleIps: string[];
  serveConfigured: boolean;
  serveManagedByMira: boolean;
  accessUrl: string | null;
  healthOk: boolean | null;
  checkedAt: string;
  error: string | null;
}

export interface TailscalePairedDevice {
  id: string;
  name: string;
  platform: string;
  permissions: string[];
  createdAt: string;
  lastSeenAt: string | null;
}

export type CloudRemoteAccessMode =
  | "signed_out"
  | "signed_in"
  | "restoring"
  | "unknown";

export interface CloudRemoteAccessState {
  mode: CloudRemoteAccessMode;
  directAllowed: boolean;
}

export interface TailscaleRemoteAccessSnapshot {
  config: TailscaleRemoteAccessConfig;
  runtime: TailscaleRemoteRuntime;
  pairedDevices: TailscalePairedDevice[];
  cloudRemoteAccess: CloudRemoteAccessState;
}

export function getGeneralSettings() {
  return get<GeneralSettings>("/general-settings");
}

export function updateGeneralSettings(payload: GeneralSettings) {
  return put<GeneralSettings>("/general-settings", payload);
}

export function getTailscaleRemoteAccess() {
  return get<TailscaleRemoteAccessSnapshot>(
    "/general-settings/tailscale-remote-access",
  );
}

export function checkTailscaleRemoteAccess() {
  return post<TailscaleRemoteAccessSnapshot>(
    "/general-settings/tailscale-remote-access/check",
  );
}

export function updateTailscaleRemoteAccess(enabled: boolean) {
  return put<TailscaleRemoteAccessSnapshot>(
    "/general-settings/tailscale-remote-access",
    { enabled },
  );
}

export function revokeTailscaleRemoteDevice(id: string) {
  return del<{ revoked: boolean }>(
    `/general-settings/tailscale-remote-access/devices/${encodeURIComponent(id)}`,
  );
}
