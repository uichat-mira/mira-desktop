export type CustomMcpMode = "local" | "cloud";
export type CustomMcpConfig =
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { url: string; headers?: Record<string, string> };

export interface CustomMcpDraft {
  id: string;
  mode: CustomMcpMode;
  name: string;
  config: CustomMcpConfig;
}

export type CustomMcpParseError =
  | "invalidJson"
  | "serversRequired"
  | "serverConfigInvalid"
  | "mixedTransport"
  | "modeMismatch"
  | "localCommandRequired"
  | "localArgsInvalid"
  | "localEnvInvalid"
  | "cloudUrlRequired"
  | "cloudUrlInvalid"
  | "cloudHeadersInvalid"
  | "unsupportedProperty";

type ParseResult =
  | { ok: true; servers: Array<{ name: string; config: CustomMcpConfig }> }
  | { ok: false; error: CustomMcpParseError };

type ServerConfigResult =
  | { ok: true; server: { name: string; config: CustomMcpConfig } }
  | { ok: false; error: CustomMcpParseError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function parseServerConfig(name: string, value: unknown, mode: CustomMcpMode): ServerConfigResult {
  if (!isRecord(value) || !name.trim()) return { ok: false, error: "serverConfigInvalid" };
  const hasCommand = Object.hasOwn(value, "command");
  const hasUrl = Object.hasOwn(value, "url");
  if (hasCommand && hasUrl) return { ok: false, error: "mixedTransport" };
  const supported = mode === "local" ? ["command", "args", "env"] : ["url", "headers"];
  if (Object.keys(value).some((key) => !supported.includes(key))) {
    return { ok: false, error: hasCommand || hasUrl ? "modeMismatch" : "unsupportedProperty" };
  }
  if (mode === "local") {
    if (hasUrl) return { ok: false, error: "modeMismatch" };
    if (typeof value.command !== "string" || !value.command.trim()) return { ok: false, error: "localCommandRequired" };
    if (Object.hasOwn(value, "args") && (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string"))) {
      return { ok: false, error: "localArgsInvalid" };
    }
    if (Object.hasOwn(value, "env") && !isStringRecord(value.env)) return { ok: false, error: "localEnvInvalid" };
    return {
      ok: true,
      server: {
        name,
        config: {
          command: value.command,
          ...(Object.hasOwn(value, "args") ? { args: value.args as string[] } : {}),
          ...(Object.hasOwn(value, "env") ? { env: value.env as Record<string, string> } : {}),
        },
      },
    };
  }

  if (hasCommand) return { ok: false, error: "modeMismatch" };
  if (typeof value.url !== "string" || !value.url.trim()) return { ok: false, error: "cloudUrlRequired" };
  try {
    const url = new URL(value.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "cloudUrlInvalid" };
  } catch {
    return { ok: false, error: "cloudUrlInvalid" };
  }
  if (Object.hasOwn(value, "headers") && !isStringRecord(value.headers)) return { ok: false, error: "cloudHeadersInvalid" };
  return {
    ok: true,
    server: {
      name,
      config: {
        url: value.url,
        ...(Object.hasOwn(value, "headers") ? { headers: value.headers as Record<string, string> } : {}),
      },
    },
  };
}

export function parseCustomMcpConfig(raw: string, mode: CustomMcpMode): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalidJson" };
  }
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers) || Object.keys(parsed.mcpServers).length === 0) {
    return { ok: false, error: "serversRequired" };
  }

  const servers: Array<{ name: string; config: CustomMcpConfig }> = [];
  for (const [name, value] of Object.entries(parsed.mcpServers)) {
    if (!isRecord(value) || !name.trim()) return { ok: false, error: "serverConfigInvalid" };
    const result = parseServerConfig(name, value, mode);
    if (!result.ok) return result;
    servers.push(result.server);
  }
  return { ok: true, servers };
}

export function formatCustomMcpConfig(raw: string, mode: CustomMcpMode):
  | { ok: true; value: string }
  | { ok: false; error: CustomMcpParseError } {
  const result = parseCustomMcpConfig(raw, mode);
  if (!result.ok) return result;
  return { ok: true, value: JSON.stringify({ mcpServers: Object.fromEntries(result.servers.map(({ name, config }) => [name, config])) }, null, 2) };
}

export function upsertCustomMcpDrafts(existing: CustomMcpDraft[], additions: CustomMcpDraft[]): CustomMcpDraft[] {
  const result = [...existing];
  for (const draft of additions) {
    const index = result.findIndex(({ id }) => id === draft.id);
    if (index === -1) result.push(draft);
    else result[index] = draft;
  }
  return result;
}

export function removeCustomMcpDraft(drafts: CustomMcpDraft[], id: string): CustomMcpDraft[] {
  return drafts.filter((draft) => draft.id !== id);
}
