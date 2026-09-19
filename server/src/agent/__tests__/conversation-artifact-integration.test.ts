import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runAgentRuntime: vi.fn(),
}));

vi.mock("../runtime", () => ({
  runAgentRuntime: mocks.runAgentRuntime,
}));

import { getDb, resetDatabaseClients } from "@/db/index.js";
import { initializeAuthDatabase } from "@/db/auth.db";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { conversationArtifacts } from "@/db/schema.js";
import { threadRepository, userRepository } from "@/db/repositories/index.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { conversationArtifactService } from "@/services/conversation-artifact.service.js";
import { readConversationArtifact } from "@/services/conversation-artifact-read.service.js";
import { createAndRunAgent } from "../index.js";
import { agentRunStore } from "../run-store.js";
import type { AgentGraphOutput } from "../types.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
let dbPath = "";

const output = (): AgentGraphOutput => ({
  answer: "done",
  observations: [],
  evidence: { observations: [], toolExecutions: [], retrievals: [] },
  retrievedChunks: [],
  status: "completed",
});

const initializeTestDatabase = () => {
  dbPath = createTimestampedTestArtifactPath(
    "db",
    `conversation-artifact-integration-${process.pid}-${Date.now()}`,
    ".sqlite",
  );
  process.env.DATABASE_URL = `file:${dbPath}`;
  resetDatabaseClients();
  initializeAuthDatabase();
  initializeModelConfigDatabase();
  initializeKnowledgeBaseDatabase();
  initializeRoleDatabase();
  initializeThreadDatabase();
};

beforeEach(() => {
  initializeTestDatabase();
  agentRunStore.clear();
});

afterEach(() => {
  agentRunStore.clear();
  resetDatabaseClients();
  if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  else delete process.env.DATABASE_URL;
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  dbPath = "";
  mocks.runAgentRuntime.mockReset();
});

test("registers explicit final runtime output and reads it after reload", async () => {
  const user = userRepository.create({
    username: `artifact-runtime-${Date.now()}`,
    passwordHash: "x",
    role: "user",
  });
  const thread = threadRepository.create({ userId: user.id, title: "runtime artifact" });

  mocks.runAgentRuntime.mockImplementation(async (input) => {
    assert.ok(input.conversationWorkdir);
    fs.writeFileSync(
      path.join(input.conversationWorkdir.rootPath, "final.txt"),
      "final payload",
    );
    fs.writeFileSync(
      path.join(input.conversationWorkdir.rootPath, "temporary.tmp"),
      "temporary payload",
    );
    return {
      ...output(),
      conversationWorkdirOutputs: [
        { sourceRelativePath: "temporary.tmp", lifecycle: "temporary" },
        { sourceRelativePath: "final.txt", lifecycle: "final", mimeType: "text/plain" },
      ],
    };
  });

  const result = await createAndRunAgent({
    threadId: thread.id,
    userId: user.id,
    goalText: "produce a report",
    messages: [
      {
        role: "user",
        content: "produce a report",
        parts: [{ type: "text", text: "produce a report" }],
      },
    ],
  });

  assert.equal(result.output.conversationArtifacts?.length, 1);
  const reference = result.output.conversationArtifacts?.[0];
  assert.ok(reference);
  assert.equal(reference.sourceRelativePath, "final.txt");
  assert.equal("absolutePath" in reference, false);
  assert.equal(
    getDb().select().from(conversationArtifacts).all().length,
    1,
  );

  agentRunStore.clear();
  resetDatabaseClients();
  initializeAuthDatabase();
  initializeModelConfigDatabase();
  initializeKnowledgeBaseDatabase();
  initializeRoleDatabase();
  initializeThreadDatabase();

  const readBack = readConversationArtifact({
    id: reference.id,
    threadId: thread.id,
    userId: user.id,
  });
  assert.deepEqual(readBack.reference, reference);
  assert.equal(readBack.contents.toString(), "final payload");
  assert.equal(
    conversationArtifactService.resolve({
      id: reference.id,
      threadId: thread.id,
      userId: user.id,
    }).reference.id,
    reference.id,
  );
});

test("does not promote temporary runtime output", async () => {
  const user = userRepository.create({
    username: `artifact-runtime-temp-${Date.now()}`,
    passwordHash: "x",
    role: "user",
  });
  const thread = threadRepository.create({ userId: user.id, title: "runtime temporary" });
  mocks.runAgentRuntime.mockImplementation(async (input) => {
    assert.ok(input.conversationWorkdir);
    fs.writeFileSync(path.join(input.conversationWorkdir.rootPath, "temporary.tmp"), "tmp");
    return {
      ...output(),
      conversationWorkdirOutputs: [
        { sourceRelativePath: "temporary.tmp", lifecycle: "temporary" },
      ],
    };
  });

  const result = await createAndRunAgent({
    threadId: thread.id,
    userId: user.id,
    goalText: "temporary work",
    messages: [{ role: "user", content: "temporary work", parts: [{ type: "text", text: "temporary work" }] }],
  });

  assert.equal(result.output.conversationArtifacts, undefined);
  assert.equal(getDb().select().from(conversationArtifacts).all().length, 0);
});
