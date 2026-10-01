import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(pathToFileURL(path.join(process.cwd(), "package.json")));

function loadRuntimeConfig() {
  const candidates = [
    path.resolve(process.cwd(), "runtime.config.cjs"),
    path.resolve(process.cwd(), "..", "runtime.config.cjs"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }

  return {
    backend: {
      host: "127.0.0.1",
      port: 0,
    },
  };
}

const runtimeConfig = loadRuntimeConfig();
const DEFAULT_REMOTE_RELAY_URL = "https://relay.tomz.io";

const CONFIG = {
  PORT: Number(
    process.env.UI_CHAT_BACKEND_PORT ??
      process.env.PORT ??
      runtimeConfig.backend.port,
  ),
  HOST:
    process.env.UI_CHAT_BACKEND_HOST ??
    process.env.HOST ??
    runtimeConfig.backend.host,
  DATABASE_DIR: process.env.UI_CHAT_DATABASE_DIR ?? "data",
  DATABASE_NAME: "uichat-rag-test.db",
  JWT_EXPIRES_IN: "24h" as const,
  SWAGGER_PREFIX: "/api-docs",
  LOG_DIR: process.env.UI_CHAT_LOG_DIR ?? "logs",
  TOOLS_DIR: process.env.UI_CHAT_TOOLS_DIR ?? "tools",
  EXTEND_TOOLS_DIR: process.env.UI_CHAT_EXTEND_TOOLS_DIR ?? "extendTools",
  ATTACHMENTS_DIR: process.env.UI_CHAT_ATTACHMENTS_DIR ?? "data/attachments",
  WECOM_BIND_RELAY_BASE_URL: process.env.WECOM_BIND_RELAY_BASE_URL ?? "",
  REMOTE_RELAY_DEFAULT_URL:
    process.env.UI_CHAT_REMOTE_RELAY_DEFAULT_URL ??
    runtimeConfig.remoteRelay?.defaultUrl ??
    DEFAULT_REMOTE_RELAY_URL,
  HARNESS_RETENTION_MAX_ENTRIES: Number(
    process.env.UI_CHAT_HARNESS_RETENTION_MAX_ENTRIES ?? 200,
  ),
  HARNESS_RETENTION_TTL_MS: Number(
    process.env.UI_CHAT_HARNESS_RETENTION_TTL_MS ?? 1000 * 60 * 30,
  ),
};

export default CONFIG;
