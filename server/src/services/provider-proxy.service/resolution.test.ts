import assert from "node:assert/strict";
import fs from "node:fs";
import { afterAll, test } from "vitest";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { resetDatabaseClients } from "@/db/index.js";
import { modelConfigRepository } from "@/db/repositories";
import {
  applyRoleSpecificProviderParams,
  resolveAgentTaskProvider,
  resolveProviderForRole,
} from "./resolution.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const testDbPath = createTimestampedTestArtifactPath(
  "db",
  "rag-demo-agent-task-resolution",
  ".sqlite",
);

process.env.DATABASE_URL = `file:${testDbPath}`;
resetDatabaseClients();
initializeModelConfigDatabase();

afterAll(() => {
  resetDatabaseClients();
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // ignore cleanup failure on Windows file locking
  }
});

test("applyRoleSpecificProviderParams disables thinking only for task ollama", () => {
  assert.deepEqual(
    applyRoleSpecificProviderParams("task", "ollama", { temperature: 0 }),
    {
      temperature: 0,
      think: false,
    },
  );
});

test("applyRoleSpecificProviderParams disables thinking only for task volcengine", () => {
  assert.deepEqual(
    applyRoleSpecificProviderParams("task", "volcengine", { temperature: 0 }),
    {
      temperature: 0,
      thinking: false,
    },
  );
});

test("applyRoleSpecificProviderParams treats agentTask like task", () => {
  assert.deepEqual(
    applyRoleSpecificProviderParams("agentTask", "ollama", { temperature: 0 }),
    {
      temperature: 0,
      think: false,
    },
  );
});

test("applyRoleSpecificProviderParams disables thinking for every default chat role", () => {
  const params = { temperature: 0.7 };

  assert.deepEqual(applyRoleSpecificProviderParams("llm", "ollama", params), {
    temperature: 0.7,
    think: false,
  });
  assert.deepEqual(
    applyRoleSpecificProviderParams("evaluation", "volcengine", params),
    { temperature: 0.7, thinking: false },
  );
});

test("resolveAgentTaskProvider falls back to task until agentTask is configured", () => {
  const taskConfig = modelConfigRepository.findDefaultByType("task");
  assert.ok(taskConfig);

  modelConfigRepository.updateDefault("agentTask", {
    name: "",
    providerCode: null,
    remoteModelId: null,
  });

  const fallbackResolved = resolveAgentTaskProvider("default");
  assert.equal(fallbackResolved.modelConfigId, taskConfig?.id);

  modelConfigRepository.updateDefault("agentTask", {
    name: "agent-task-model",
    providerCode: "ollama",
    remoteModelId: "agent-task-model",
  });

  const agentTaskResolved = resolveAgentTaskProvider("default");
  assert.equal(agentTaskResolved.model, "agent-task-model");
});

test("resolveAgentTaskProvider accepts providerConnectionId-only agentTask config", () => {
  modelConfigRepository.updateDefault("agentTask", {
    name: "agent-task-custom",
    providerCode: null,
    providerConnectionId: "ollama",
    remoteModelId: "agent-task-custom",
  });

  const resolved = resolveAgentTaskProvider("default");
  assert.equal(resolved.model, "agent-task-custom");
  assert.equal(resolved.providerConnectionId, "ollama");
});

test("resolveProviderForRole rejects explicit provider mismatch for providerConnectionId-only config", () => {
  modelConfigRepository.updateDefault("llm", {
    name: "llama3.1",
    providerCode: null,
    providerConnectionId: "ollama",
    remoteModelId: "llama3.1",
  });

  assert.throws(
    () => resolveProviderForRole("llm", "openai"),
    /Requested provider "openai" does not match current default LLM provider "ollama"/,
  );
});

test("resolveProviderForRole keeps runtime provider identity for providerConnectionId-only config", () => {
  modelConfigRepository.updateDefault("llm", {
    name: "llama3.1",
    providerCode: null,
    providerConnectionId: "ollama",
    remoteModelId: "llama3.1",
  });

  const resolved = resolveProviderForRole("llm", "ollama");
  assert.equal(resolved.providerCode, "ollama");
  assert.equal(resolved.providerConnectionId, "ollama");
});
