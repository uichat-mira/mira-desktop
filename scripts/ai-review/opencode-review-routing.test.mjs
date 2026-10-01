import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_REVIEW_ROUTING_PATH,
  REVIEW_ROUTING_VERSION,
  loadReviewRoutingConfig,
  parseReviewRoutingConfig,
  resolveReviewRoute,
  reviewRouteCredential,
  reviewRouteModelRef,
} from "./opencode-review-routing.mjs";

function baseConfig() {
  return {
    version: REVIEW_ROUTING_VERSION,
    roles: {
      routine: {
        enabled: true,
        provider: "opencode-go",
        model: "minimax-m3",
        variant: "none",
        credentialEnv: "OPENCODE_GO_API_KEY",
      },
      fallback: {
        enabled: false,
        provider: "opencode-go",
        model: "deepseek-v4-flash",
        variant: "none",
        credentialEnv: "OPENCODE_GO_API_KEY",
      },
      escalation: {
        enabled: false,
        provider: "opencode-go",
        model: "deepseek-v4-pro",
        variant: "none",
        credentialEnv: "OPENCODE_GO_API_KEY",
      },
    },
  };
}

test("loads the trusted versioned Desktop routing configuration", async () => {
  const config = await loadReviewRoutingConfig();

  assert.equal(config.version, REVIEW_ROUTING_VERSION);
  assert.deepEqual(config.roles.routine, {
    role: "routine",
    enabled: true,
    provider: "opencode-go",
    model: "minimax-m3",
    variant: "none",
    credentialEnv: "OPENCODE_GO_API_KEY",
  });
  assert.equal(config.roles.fallback.enabled, false);
  assert.equal(config.roles.fallback.model, "deepseek-v4-flash");
  assert.equal(config.roles.escalation.enabled, false);
  assert.equal(config.roles.escalation.model, "deepseek-v4-pro");
});

test("resolves only enabled routes and fails explicitly for disabled roles", () => {
  const config = parseReviewRoutingConfig(baseConfig());

  assert.equal(reviewRouteModelRef(resolveReviewRoute(config, "routine")), "opencode-go/minimax-m3");
  assert.throws(() => resolveReviewRoute(config, "fallback"), /review_route_fallback_disabled/);
  assert.throws(() => resolveReviewRoute(config, "escalation"), /review_route_escalation_disabled/);
});

test("rejects invalid, incomplete, or secret-bearing route configuration", () => {
  const missing = baseConfig();
  delete missing.roles.escalation;
  assert.throws(() => parseReviewRoutingConfig(missing), /review_route_escalation_missing/);

  const unsupported = baseConfig();
  unsupported.version = "mira-desktop-opencode-routing/v2";
  assert.throws(() => parseReviewRoutingConfig(unsupported), /review_route_version_unsupported/);

  const secretBearing = baseConfig();
  secretBearing.roles.routine.apiKey = "do-not-commit";
  assert.throws(() => parseReviewRoutingConfig(secretBearing), /review_route_routine_unknown_field/);
});

test("requires the credential named by the selected route without logging or storing its value", () => {
  const route = resolveReviewRoute(parseReviewRoutingConfig(baseConfig()), "routine");

  assert.equal(
    reviewRouteCredential(route, { OPENCODE_GO_API_KEY: "runtime-secret" }),
    "runtime-secret",
  );
  assert.throws(
    () => reviewRouteCredential(route, {}),
    /review_route_credential_unavailable/,
  );
});

test("a supported alternate model is a routing configuration change, not a Control Room adapter change", () => {
  const alternate = baseConfig();
  alternate.roles.routine.model = "deepseek-v4-flash";

  const route = resolveReviewRoute(parseReviewRoutingConfig(alternate), "routine");
  assert.equal(reviewRouteModelRef(route), "opencode-go/deepseek-v4-flash");
  assert.equal(route.credentialEnv, "OPENCODE_GO_API_KEY");
});

test("routing is bound to the trusted repository source rather than a workflow/env override", () => {
  assert.match(
    DEFAULT_REVIEW_ROUTING_PATH.replaceAll("\\", "/"),
    /\/\.github\/ai-review\/opencode-routing\.json$/,
  );

  const runner = readFileSync(
    new URL("./opencode-review-runner.mjs", import.meta.url),
    "utf8",
  );
  const workflow = readFileSync(
    new URL("../../.github/workflows/mira-ai-review.yml", import.meta.url),
    "utf8",
  );

  assert.match(runner, /await loadReviewRoutingConfig\(\)/);
  assert.doesNotMatch(runner, /MIRA_REVIEW_ROUTING_PATH/);
  assert.doesNotMatch(workflow, /MIRA_REVIEW_ROUTING_PATH/);
});

test("missing routing files fail explicitly instead of selecting an implicit default", async () => {
  await assert.rejects(
    () => loadReviewRoutingConfig("/definitely/missing/mira-routing.json"),
    /review_route_config_unavailable/,
  );
});

test("the committed routing source contains references only, not credential values", () => {
  const raw = readFileSync(DEFAULT_REVIEW_ROUTING_PATH, "utf8");
  assert.match(raw, /"credentialEnv": "OPENCODE_GO_API_KEY"/);
  assert.doesNotMatch(raw, /"apiKey"|"token"|"secret"\s*:/i);
  assert.doesNotMatch(raw, /sk-[A-Za-z0-9_-]+/);
});
