import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REVIEW_ROUTING_VERSION = "mira-desktop-opencode-routing/v1";
export const REVIEW_ROUTE_ROLES = ["routine", "fallback", "escalation"];
export const DEFAULT_REVIEW_ROUTING_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.github/ai-review/opencode-routing.json",
);

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
const CREDENTIAL_ENV_PATTERN =
  /^(?:OPENCODE_[A-Z0-9_]+_API_KEY|AI_PROVIDER_[A-Z0-9_]+_KEY)$/;

function fail(reason) {
  throw new Error(`review_route_${reason}`);
}

function object(value, reason) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(reason);
  return value;
}

function exactKeys(value, allowed, reason) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) fail(reason);
}

function token(value, reason) {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) fail(reason);
  return value;
}

function credentialEnv(value) {
  if (typeof value !== "string" || !CREDENTIAL_ENV_PATTERN.test(value)) {
    fail("credential_env_invalid");
  }
  return value;
}

function parseRole(value, role) {
  const route = object(value, `${role}_not_object`);
  exactKeys(
    route,
    ["enabled", "provider", "model", "variant", "credentialEnv"],
    `${role}_unknown_field`,
  );

  if (typeof route.enabled !== "boolean") fail(`${role}_enabled_invalid`);

  return Object.freeze({
    role,
    enabled: route.enabled,
    provider: token(route.provider, `${role}_provider_invalid`),
    model: token(route.model, `${role}_model_invalid`),
    variant: token(route.variant, `${role}_variant_invalid`),
    credentialEnv: credentialEnv(route.credentialEnv),
  });
}

export function parseReviewRoutingConfig(value) {
  const root = object(value, "config_not_object");
  exactKeys(root, ["version", "roles"], "config_unknown_field");

  if (root.version !== REVIEW_ROUTING_VERSION) fail("version_unsupported");

  const roles = object(root.roles, "roles_not_object");
  exactKeys(roles, REVIEW_ROUTE_ROLES, "roles_unknown_field");

  for (const role of REVIEW_ROUTE_ROLES) {
    if (!Object.prototype.hasOwnProperty.call(roles, role)) {
      fail(`${role}_missing`);
    }
  }

  return Object.freeze({
    version: REVIEW_ROUTING_VERSION,
    roles: Object.freeze({
      routine: parseRole(roles.routine, "routine"),
      fallback: parseRole(roles.fallback, "fallback"),
      escalation: parseRole(roles.escalation, "escalation"),
    }),
  });
}

export async function loadReviewRoutingConfig(
  path = DEFAULT_REVIEW_ROUTING_PATH,
) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    fail("config_unavailable");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("config_json_invalid");
  }

  return parseReviewRoutingConfig(parsed);
}

export function resolveReviewRoute(config, role = "routine") {
  if (!REVIEW_ROUTE_ROLES.includes(role)) fail("role_unsupported");

  const route = config?.roles?.[role];
  if (!route) fail(`${role}_missing`);
  if (!route.enabled) fail(`${role}_disabled`);
  return route;
}

export function reviewRouteModelRef(route) {
  return `${route.provider}/${route.model}`;
}

export function reviewRouteCredential(route, env = process.env) {
  const value = env?.[route.credentialEnv];
  if (typeof value !== "string" || !value.trim()) {
    fail("credential_unavailable");
  }
  return value.trim();
}
