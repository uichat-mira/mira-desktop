import assert from "node:assert/strict";
import { test } from "vitest";
import {
  getProviderCapabilities,
  getProviderDefinition,
  getPlannerStructuredOutputAdapter,
  supportsRoleForProvider,
} from "./catalog.js";

test("rerank support is declared independently from chat compatibility", () => {
  assert.equal(getProviderDefinition("volcengine").rerankAdapter, "openai-compatible");
  assert.equal(getProviderDefinition("openai").chatAdapter, "openai-compatible");
  assert.equal(getProviderDefinition("openai").rerankAdapter, "none");
  assert.equal(getProviderDefinition("cloudflare").chatAdapter, "openai-compatible");
  assert.equal(getProviderDefinition("cloudflare").rerankAdapter, "none");
});

test("image-generation capability is declared independently from chat compatibility", () => {
  assert.equal(getProviderDefinition("openai").imageAdapter, "openai-images");
  assert.equal(getProviderDefinition("volcengine").imageAdapter, "openai-images");
  assert.equal(getProviderDefinition("ollama").imageAdapter, "none");

  const openAiCapabilities = getProviderCapabilities("openai");
  assert.ok(openAiCapabilities.supportsRoles.includes("imageGeneration"));
  assert.equal(supportsRoleForProvider("openai", "imageGeneration"), true);
  assert.equal(supportsRoleForProvider("volcengine", "imageGeneration"), true);
  assert.equal(supportsRoleForProvider("cloudflare", "imageGeneration"), false);
});

test("Volcengine Plan templates expose separate services under one provider", () => {
  assert.equal(
    getProviderDefinition("volcengine-code-plan").displayName,
    "火山引擎 Code Plan",
  );
  assert.equal(
    getProviderDefinition("volcengine-agent-plan").displayName,
    "火山引擎 Agent Plan",
  );
  assert.equal(
    getProviderDefinition("volcengine-code-plan").embeddingAdapter,
    "none",
  );
  assert.equal(
    getProviderDefinition("volcengine-agent-plan").embeddingAdapter,
    "none",
  );
  assert.equal(supportsRoleForProvider("volcengine-code-plan", "task"), true);
  assert.equal(
    supportsRoleForProvider("volcengine-agent-plan", "agentTask"),
    true,
  );
  assert.equal(
    supportsRoleForProvider("volcengine-code-plan", "embedding"),
    false,
  );
  assert.equal(
    getProviderDefinition("volcengine-code-plan").imageAdapter,
    "none",
  );
  assert.equal(
    getProviderDefinition("volcengine-agent-plan").imageAdapter,
    "none",
  );
  assert.equal(
    supportsRoleForProvider("volcengine-code-plan", "voice"),
    false,
  );
  assert.equal(
    supportsRoleForProvider("volcengine-agent-plan", "voice"),
    false,
  );
  assert.equal(
    supportsRoleForProvider("volcengine", "voice"),
    true,
  );
});

test("Planner structured output capability is explicit and independent from chat protocol", () => {
  assert.equal(
    getPlannerStructuredOutputAdapter("volcengine-agent-plan"),
    "ark-json-schema",
  );
  assert.equal(
    getPlannerStructuredOutputAdapter("volcengine-code-plan"),
    "ark-json-schema",
  );
  assert.equal(getPlannerStructuredOutputAdapter("ollama"), "ollama-json-schema");
  assert.equal(getPlannerStructuredOutputAdapter("openai"), "none");
  assert.equal(getPlannerStructuredOutputAdapter("lmstudio"), "none");
  assert.equal(getPlannerStructuredOutputAdapter("google"), "none");
  assert.equal(getPlannerStructuredOutputAdapter("cloudflare"), "none");
  assert.equal(getPlannerStructuredOutputAdapter("volcengine"), "none");
  assert.equal(
    getPlannerStructuredOutputAdapter("openai-compatible-custom"),
    "none",
  );
});
