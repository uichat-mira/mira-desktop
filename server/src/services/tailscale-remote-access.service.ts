import { execFile } from "node:child_process";
import CONFIG from "@/config/index.js";
import { getSqlite } from "@/db/index.js";
import { hostNotificationRepository } from "@/db/repositories/host-notification.repository.js";
import {
  tailscaleRemoteAccessRepository,
  type TailscalePairedDevice,
  type TailscaleRemoteAccessConfig,
} from "@/db/repositories/tailscale-remote-access.repository.js";

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

export type TailscaleRuntimeSnapshot = {
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
};

export type TailscaleRemoteAccessSnapshot = {
  config: TailscaleRemoteAccessConfig;
  runtime: TailscaleRuntimeSnapshot;
  pairedDevices: TailscalePairedDevice[];
};

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export type TailscaleCommandRunner = (
  args: string[],
) => Promise<CommandResult>;

export type TailscaleHealthChecker = (url: string) => Promise<boolean>;

export type TailscaleRemoteAccessErrorCode =
  | "TAILSCALE_NOT_INSTALLED"
  | "TAILSCALE_NOT_CONNECTED"
  | "TAILSCALE_SERVE_CONFLICT"
  | "TAILSCALE_COMMAND_FAILED";

export class TailscaleRemoteAccessError extends Error {
  constructor(
    public readonly code: TailscaleRemoteAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TailscaleRemoteAccessError";
  }
}

type TailscaleStatusJson = {
  Version?: unknown;
  BackendState?: unknown;
  TailscaleIPs?: unknown;
  Self?: {
    HostName?: unknown;
    DNSName?: unknown;
    Online?: unknown;
    TailscaleIPs?: unknown;
  } | null;
  CurrentTailnet?: {
    Name?: unknown;
    MagicDNSSuffix?: unknown;
    MagicDNSEnabled?: unknown;
  } | null;
};

type ServeOwnership = {
  configured: boolean;
  managedByMira: boolean;
};

const COMMAND_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 4_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const normalizeDnsName = (value: string | null) =>
  value ? value.replace(/\.+$/, "") : null;

const parseJson = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  return JSON.parse(trimmed) as unknown;
};

const defaultCommandRunner: TailscaleCommandRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      "tailscale",
      args,
      {
        windowsHide: true,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });

const defaultHealthChecker: TailscaleHealthChecker = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/health`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const getErrorCode = (error: unknown) =>
  isRecord(error) && typeof error.code === "string" ? error.code : null;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const hasMeaningfulServeValue = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.some(hasMeaningfulServeValue);
  }

  if (isRecord(value)) {
    return Object.values(value).some(hasMeaningfulServeValue);
  }

  return false;
};

const meaningfulEntries = (value: unknown) =>
  isRecord(value)
    ? Object.entries(value).filter(([, item]) =>
        hasMeaningfulServeValue(item),
      )
    : [];

const isManagedTarget = (value: unknown, backendPort: number) => {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes(`127.0.0.1:${backendPort}`) ||
    normalized.includes(`localhost:${backendPort}`)
  );
};

const inspectServeOwnership = (
  value: unknown,
  backendPort: number,
  servePort: number,
): ServeOwnership => {
  const configured = hasMeaningfulServeValue(value);
  if (!configured) {
    return { configured: false, managedByMira: false };
  }

  if (!isRecord(value)) {
    return { configured: true, managedByMira: false };
  }

  const allowedRootKeys = new Set(["TCP", "Web", "AllowFunnel"]);
  const hasUnknownRootConfig = Object.entries(value).some(
    ([key, item]) =>
      !allowedRootKeys.has(key) && hasMeaningfulServeValue(item),
  );
  if (hasUnknownRootConfig || hasMeaningfulServeValue(value.AllowFunnel)) {
    return { configured: true, managedByMira: false };
  }

  const tcpEntries = meaningfulEntries(value.TCP);
  if (tcpEntries.length !== 1 || tcpEntries[0]?.[0] !== String(servePort)) {
    return { configured: true, managedByMira: false };
  }

  const tcpConfig = tcpEntries[0]?.[1];
  if (
    !isRecord(tcpConfig) ||
    tcpConfig.HTTPS !== true ||
    Object.entries(tcpConfig).some(
      ([key, item]) => key !== "HTTPS" && hasMeaningfulServeValue(item),
    )
  ) {
    return { configured: true, managedByMira: false };
  }

  const webEntries = meaningfulEntries(value.Web);
  if (webEntries.length !== 1 || !webEntries[0]?.[0].endsWith(`:${servePort}`)) {
    return { configured: true, managedByMira: false };
  }

  const webConfig = webEntries[0]?.[1];
  if (!isRecord(webConfig)) {
    return { configured: true, managedByMira: false };
  }

  const webExtraConfig = Object.entries(webConfig).some(
    ([key, item]) => key !== "Handlers" && hasMeaningfulServeValue(item),
  );
  if (webExtraConfig) {
    return { configured: true, managedByMira: false };
  }

  const handlerEntries = meaningfulEntries(webConfig.Handlers);
  if (handlerEntries.length !== 1 || handlerEntries[0]?.[0] !== "/") {
    return { configured: true, managedByMira: false };
  }

  const handler = handlerEntries[0]?.[1];
  if (!isRecord(handler) || !isManagedTarget(handler.Proxy, backendPort)) {
    return { configured: true, managedByMira: false };
  }

  const handlerExtraConfig = Object.entries(handler).some(
    ([key, item]) => key !== "Proxy" && hasMeaningfulServeValue(item),
  );

  return {
    configured: true,
    managedByMira: !handlerExtraConfig,
  };
};

const buildAccessUrl = (dnsName: string | null, servePort: number) => {
  if (!dnsName) {
    return null;
  }

  return servePort === 443
    ? `https://${dnsName}`
    : `https://${dnsName}:${servePort}`;
};

const createBaseRuntime = (
  patch: Partial<TailscaleRuntimeSnapshot> = {},
): TailscaleRuntimeSnapshot => ({
  state: "error",
  installed: false,
  backendState: null,
  version: null,
  deviceName: null,
  dnsName: null,
  tailnetName: null,
  tailnetDomain: null,
  tailscaleIps: [],
  serveConfigured: false,
  serveManagedByMira: false,
  accessUrl: null,
  healthOk: null,
  checkedAt: new Date().toISOString(),
  error: null,
  ...patch,
});

export class TailscaleRemoteAccessService {
  constructor(
    private readonly runCommand: TailscaleCommandRunner = defaultCommandRunner,
    private readonly checkHealth: TailscaleHealthChecker = defaultHealthChecker,
  ) {}

  private async readStatus(): Promise<TailscaleStatusJson> {
    try {
      const result = await this.runCommand(["status", "--json"]);
      const parsed = parseJson(result.stdout);
      if (!isRecord(parsed)) {
        throw new Error("Unexpected Tailscale status response");
      }
      return parsed as TailscaleStatusJson;
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") {
        throw new TailscaleRemoteAccessError(
          "TAILSCALE_NOT_INSTALLED",
          "Tailscale CLI is not installed or is not available on PATH",
        );
      }
      throw error;
    }
  }

  private async readServeStatus(): Promise<unknown> {
    try {
      const result = await this.runCommand(["serve", "status", "--json"]);
      return parseJson(result.stdout);
    } catch (error) {
      const message = errorMessage(error).toLowerCase();
      if (
        message.includes("no serve config") ||
        message.includes("not configured")
      ) {
        return {};
      }
      throw error;
    }
  }

  private connectionState(status: TailscaleStatusJson) {
    const backendState = asString(status.BackendState);
    const online = status.Self?.Online === true;

    if (
      backendState === "NeedsLogin" ||
      backendState === "NoState" ||
      backendState === "Stopped"
    ) {
      return "needs_login" as const;
    }

    if (backendState === "Running" && online) {
      return "connected" as const;
    }

    return "connecting" as const;
  }

  async getSnapshot(
    options: { verifyHealth?: boolean } = {},
  ): Promise<TailscaleRemoteAccessSnapshot> {
    const config = tailscaleRemoteAccessRepository.getConfig();
    const pairedDevices = tailscaleRemoteAccessRepository.listDevices();

    try {
      const status = await this.readStatus();
      const connectionState = this.connectionState(status);
      const dnsName = normalizeDnsName(asString(status.Self?.DNSName));
      const tailnetDomain = asString(status.CurrentTailnet?.MagicDNSSuffix);
      const tailscaleIps = [
        ...asStringArray(status.Self?.TailscaleIPs),
        ...asStringArray(status.TailscaleIPs),
      ].filter((value, index, values) => values.indexOf(value) === index);
      const accessUrl = buildAccessUrl(dnsName, config.servePort);
      const common = {
        installed: true,
        backendState: asString(status.BackendState),
        version: asString(status.Version),
        deviceName: asString(status.Self?.HostName),
        dnsName,
        tailnetName: asString(status.CurrentTailnet?.Name),
        tailnetDomain,
        tailscaleIps,
        accessUrl,
      };

      if (connectionState !== "connected") {
        return {
          config,
          pairedDevices,
          runtime: createBaseRuntime({
            ...common,
            state: connectionState,
          }),
        };
      }

      const serveStatus = await this.readServeStatus();
      const ownership = inspectServeOwnership(
        serveStatus,
        CONFIG.PORT,
        config.servePort,
      );

      if (ownership.configured && !ownership.managedByMira) {
        return {
          config,
          pairedDevices,
          runtime: createBaseRuntime({
            ...common,
            state: "serve_conflict",
            serveConfigured: true,
            error:
              "An existing Tailscale Serve, Funnel, Service, or mixed endpoint configuration is not exclusively managed by Mira",
          }),
        };
      }

      if (config.enabled && !ownership.managedByMira) {
        return {
          config,
          pairedDevices,
          runtime: createBaseRuntime({
            ...common,
            state: "serve_not_configured",
            serveConfigured: ownership.configured,
            serveManagedByMira: ownership.managedByMira,
          }),
        };
      }

      if (!config.enabled) {
        return {
          config,
          pairedDevices,
          runtime: createBaseRuntime({
            ...common,
            state: "connected",
            serveConfigured: ownership.configured,
            serveManagedByMira: ownership.managedByMira,
          }),
        };
      }

      const healthOk =
        options.verifyHealth === false || !accessUrl
          ? null
          : await this.checkHealth(accessUrl);

      return {
        config,
        pairedDevices,
        runtime: createBaseRuntime({
          ...common,
          state: healthOk === false ? "unreachable" : "ready",
          serveConfigured: true,
          serveManagedByMira: true,
          healthOk,
        }),
      };
    } catch (error) {
      if (
        error instanceof TailscaleRemoteAccessError &&
        error.code === "TAILSCALE_NOT_INSTALLED"
      ) {
        return {
          config,
          pairedDevices,
          runtime: createBaseRuntime({
            state: "not_installed",
            error: error.message,
          }),
        };
      }

      return {
        config,
        pairedDevices,
        runtime: createBaseRuntime({
          state: "error",
          installed: true,
          error: errorMessage(error),
        }),
      };
    }
  }

  async updateEnabled(
    enabled: boolean,
  ): Promise<TailscaleRemoteAccessSnapshot> {
    const currentConfig = tailscaleRemoteAccessRepository.getConfig();
    const status = await this.readStatus();

    if (this.connectionState(status) !== "connected") {
      throw new TailscaleRemoteAccessError(
        "TAILSCALE_NOT_CONNECTED",
        "Connect this device to a Tailnet before changing remote access",
      );
    }

    const serveStatus = await this.readServeStatus();
    const ownership = inspectServeOwnership(
      serveStatus,
      CONFIG.PORT,
      currentConfig.servePort,
    );

    if (ownership.configured && !ownership.managedByMira) {
      throw new TailscaleRemoteAccessError(
        "TAILSCALE_SERVE_CONFLICT",
        "Mira did not change Tailscale because a Serve, Funnel, Service, or mixed endpoint configuration already exists",
      );
    }

    try {
      if (enabled && !ownership.managedByMira) {
        await this.runCommand([
          "serve",
          "--bg",
          "--yes",
          `--https=${currentConfig.servePort}`,
          `127.0.0.1:${CONFIG.PORT}`,
        ]);
      } else if (!enabled && ownership.managedByMira) {
        await this.runCommand([
          "serve",
          `--https=${currentConfig.servePort}`,
          "off",
        ]);
      }
    } catch (error) {
      throw new TailscaleRemoteAccessError(
        "TAILSCALE_COMMAND_FAILED",
        errorMessage(error),
      );
    }

    tailscaleRemoteAccessRepository.updateConfig({ enabled });
    return this.getSnapshot({ verifyHealth: true });
  }

  async check(): Promise<TailscaleRemoteAccessSnapshot> {
    return this.getSnapshot({ verifyHealth: true });
  }

  revokeDevice(id: string, userId?: number): boolean {
    const device = tailscaleRemoteAccessRepository.getActiveDeviceById(id);
    if (!device || (typeof userId === "number" && device.userId !== userId)) {
      return false;
    }

    return getSqlite().transaction(() => {
      const revoked = tailscaleRemoteAccessRepository.revokeDevice(id, userId);
      if (!revoked) return false;
      hostNotificationRepository.revokeBindingsForRemoteDevice(
        id,
        device.userId,
      );
      return true;
    })();
  }
}

export const tailscaleRemoteAccessService = new TailscaleRemoteAccessService();
