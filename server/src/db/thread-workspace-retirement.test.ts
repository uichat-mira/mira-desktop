import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, test } from "vitest";
import { initializeAuthDatabase } from "@/db/auth.db";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { getSqlite, resetDatabaseClients } from "@/db/index.js";
import { initializeThreadDatabase } from "@/db/thread.db";
import { hasSqliteColumn, hasSqliteTable } from "@/db/sqlite-utils.js";
import { userRepository } from "@/db/repositories/user.repository.js";
import {
  createTimestampedTestArtifactPath,
  getTestArtifactDir,
} from "@/test-support/artifacts.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
let dbPath = "";
let root = "";

afterEach(() => {
  resetDatabaseClients();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (root) fs.rmSync(root, { recursive: true, force: true });
  if (dbPath) {
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
  }
  dbPath = "";
  root = "";
});

test("migrates legacy Workdir artifact and AgentRun ownership onto frozen workspace roots", () => {
  root = getTestArtifactDir(
    "workspace-retirement",
    `${process.pid}-${Date.now()}`,
  );
  dbPath = createTimestampedTestArtifactPath(
    "db",
    "workspace-retirement",
    ".sqlite",
  );
  process.env.DATABASE_URL = `file:${dbPath}`;
  resetDatabaseClients();

  initializeAuthDatabase();
  initializeModelConfigDatabase();
  initializeKnowledgeBaseDatabase();
  initializeRoleDatabase();

  const user = userRepository.create({
    username: `migration-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });

  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE chat_workspaces (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      root_path TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      model_name TEXT,
      workspace_id TEXT,
      knowledge_base_id TEXT,
      role_id TEXT,
      agent_enabled INTEGER NOT NULL DEFAULT 0,
      tts_enabled INTEGER NOT NULL DEFAULT 0,
      image_enabled INTEGER NOT NULL DEFAULT 0,
      evolving_knowledge_enabled INTEGER NOT NULL DEFAULT 0,
      context_summary TEXT,
      context_summary_updated_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE conversation_workdirs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      root_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE conversation_artifacts (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      workdir_id TEXT NOT NULL,
      source_relative_path TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      mime_type TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      goal_json TEXT NOT NULL,
      status TEXT NOT NULL,
      observations_json TEXT NOT NULL DEFAULT '[]',
      trace_id TEXT NOT NULL,
      blocked_reason TEXT,
      terminal_reason TEXT,
      pending_approval_json TEXT,
      approved_invocations_json TEXT NOT NULL DEFAULT '[]',
      context_budget_json TEXT,
      selected_tool_id TEXT,
      pending_tool_call_json TEXT,
      last_tool_execution_json TEXT,
      assistant_message_id TEXT,
      assistant_parent_id TEXT,
      runtime_input_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const threadId = crypto.randomUUID().replaceAll("-", "");
  const workdirId = crypto.randomUUID().replaceAll("-", "");
  const artifactId = `artifact-${crypto.randomUUID()}`;
  const runId = crypto.randomUUID();
  const privateRoot = path.join(
    root,
    "conversation-workdirs",
    `user-${user.id}`,
    threadId,
  );
  fs.mkdirSync(privateRoot, { recursive: true });
  fs.writeFileSync(path.join(privateRoot, "report.txt"), "legacy report");

  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO threads (
        id, user_id, title, agent_enabled, status, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 'active', ?, ?)`,
    )
    .run(threadId, user.id, "legacy", now, now);
  sqlite
    .prepare(
      `INSERT INTO conversation_workdirs (
        id, thread_id, user_id, root_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(workdirId, threadId, user.id, privateRoot, now, now);
  sqlite
    .prepare(
      `INSERT INTO conversation_artifacts (
        id, thread_id, user_id, workdir_id, source_relative_path,
        lifecycle, mime_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'report.txt', 'final', 'text/plain', ?, ?)`,
    )
    .run(artifactId, threadId, user.id, workdirId, now, now);

  const runtimeInput = {
    messages: [],
    workspaceRoot: privateRoot,
    conversationWorkdir: {
      id: workdirId,
      threadId,
      rootPath: privateRoot,
    },
    conversationWorkdirOutputs: [
      { sourceRelativePath: "report.txt", lifecycle: "final" },
    ],
    checkpoint: {
      conversationWorkdirOutputs: [
        { sourceRelativePath: "report.txt", lifecycle: "final" },
      ],
    },
  };
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, thread_id, user_id, goal_json, status, observations_json,
        trace_id, approved_invocations_json, runtime_input_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'waiting_approval', '[]', ?, '[]', ?, ?, ?)`,
    )
    .run(
      runId,
      threadId,
      user.id,
      JSON.stringify({
        id: crypto.randomUUID(),
        text: "legacy task",
        successCriteria: [],
        constraints: [],
        riskLevel: "low",
      }),
      crypto.randomUUID(),
      JSON.stringify(runtimeInput),
      now,
      now,
    );

  initializeThreadDatabase();

  assert.equal(hasSqliteTable(sqlite, "conversation_workdirs"), false);
  assert.equal(
    hasSqliteColumn(sqlite, "conversation_artifacts", "workdir_id"),
    false,
  );
  assert.equal(
    hasSqliteColumn(sqlite, "conversation_artifacts", "source_root_path"),
    true,
  );

  const artifact = sqlite
    .prepare(
      "SELECT source_root_path, source_relative_path FROM conversation_artifacts WHERE id = ?",
    )
    .get(artifactId) as {
      source_root_path: string;
      source_relative_path: string;
    };
  assert.equal(artifact.source_root_path, privateRoot);
  assert.equal(artifact.source_relative_path, "report.txt");

  const migratedRun = sqlite
    .prepare("SELECT runtime_input_json FROM agent_runs WHERE id = ?")
    .get(runId) as { runtime_input_json: string };
  const migratedInput = JSON.parse(migratedRun.runtime_input_json) as Record<
    string,
    unknown
  >;
  assert.equal(migratedInput.workspaceRoot, privateRoot);
  assert.equal("conversationWorkdir" in migratedInput, false);
  assert.equal("conversationWorkdirOutputs" in migratedInput, false);
  assert.deepEqual(migratedInput.workspaceOutputs, [
    { sourceRelativePath: "report.txt", lifecycle: "final" },
  ]);

  const checkpoint = migratedInput.checkpoint as Record<string, unknown>;
  assert.equal("conversationWorkdirOutputs" in checkpoint, false);
  assert.deepEqual(checkpoint.workspaceOutputs, [
    { sourceRelativePath: "report.txt", lifecycle: "final" },
  ]);

  // Migration is idempotent after the old domain is gone.
  initializeThreadDatabase();
  assert.equal(hasSqliteTable(sqlite, "conversation_workdirs"), false);
});
