import { getSqlite } from "@/db";
import { applySqliteConnectionPragmas } from "@/db/init-utils";
import { hasSqliteColumn, hasSqliteTable } from "@/db/sqlite-utils";

const createThreadTables = () => {
  const sqlite = getSqlite();

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS chat_workspaces (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      root_path TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      model_name TEXT,
      workspace_id TEXT REFERENCES chat_workspaces(id) ON DELETE SET NULL,
      knowledge_base_id TEXT REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
      agent_enabled INTEGER NOT NULL DEFAULT 0 CHECK (agent_enabled IN (0, 1)),
      evolving_knowledge_enabled INTEGER NOT NULL DEFAULT 0 CHECK (evolving_knowledge_enabled IN (0, 1)),
      context_summary TEXT,
      context_summary_updated_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_workdirs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      root_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      parts_json TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_workspaces_user_id ON chat_workspaces(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_workspaces_status ON chat_workspaces(status);
    CREATE INDEX IF NOT EXISTS idx_chat_workspaces_updated_at ON chat_workspaces(updated_at);
    CREATE INDEX IF NOT EXISTS idx_threads_user_id ON threads(user_id);
    CREATE INDEX IF NOT EXISTS idx_threads_workspace_id ON threads(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
    CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_workdirs_thread_id ON conversation_workdirs(thread_id);
    CREATE INDEX IF NOT EXISTS idx_conversation_workdirs_user_id ON conversation_workdirs(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_workdirs_root_path ON conversation_workdirs(root_path);
    CREATE TABLE IF NOT EXISTS conversation_artifacts (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workdir_id TEXT NOT NULL REFERENCES conversation_workdirs(id) ON DELETE CASCADE,
      source_relative_path TEXT NOT NULL,
      lifecycle TEXT NOT NULL CHECK (lifecycle IN ('temporary', 'final')),
      mime_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_artifacts_thread_id ON conversation_artifacts(thread_id);
    CREATE INDEX IF NOT EXISTS idx_conversation_artifacts_workdir_id ON conversation_artifacts(workdir_id);
    CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
  `);
};

const createAgentRunTables = () => {
  const sqlite = getSqlite();

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      thread_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      goal_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting_approval', 'waiting_user', 'completed', 'failed', 'blocked', 'cancelled')),
      observations_json TEXT NOT NULL DEFAULT '[]',
      trace_id TEXT NOT NULL,
      blocked_reason TEXT,
      terminal_reason TEXT,
      pending_approval_json TEXT,
      approved_invocations_json TEXT NOT NULL DEFAULT '[]',
      context_budget_json TEXT,
      selected_capability_id TEXT,
      selected_tool_id TEXT,
      pending_tool_call_json TEXT,
      last_tool_execution_json TEXT,
      assistant_message_id TEXT,
      assistant_parent_id TEXT,
      runtime_input_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_id ON agent_runs(thread_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id ON agent_runs(user_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_trace_id ON agent_runs(trace_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_updated_at ON agent_runs(updated_at);
  `);
};

const rebuildAgentRunsWithoutStaticPlan = () => {
  const sqlite = getSqlite();
  if (
    !hasSqliteTable(sqlite, "agent_runs") ||
    (!hasSqliteColumn(sqlite, "agent_runs", "plan_json") &&
      !hasSqliteColumn(sqlite, "agent_runs", "current_step_id"))
  ) {
    return;
  }

  // Existing databases may still have the old NOT NULL plan column. Rebuild
  // the table once so runtime persistence no longer carries static plan state.
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec("BEGIN");
  try {
    sqlite.exec("ALTER TABLE agent_runs RENAME TO agent_runs_static_plan_legacy");
    createAgentRunTables();

    const legacyColumns = new Set(
      (sqlite
        .prepare("PRAGMA table_info(agent_runs_static_plan_legacy)")
        .all() as Array<{ name: string }>).map((column) => column.name),
    );
    const column = (name: string, fallback: string) =>
      legacyColumns.has(name) ? name : fallback;

    sqlite.exec(`
      INSERT INTO agent_runs (
        id, thread_id, user_id, goal_json, status, observations_json,
        trace_id, blocked_reason, terminal_reason, pending_approval_json,
        approved_invocations_json, context_budget_json, selected_tool_id,
        pending_tool_call_json, last_tool_execution_json, assistant_message_id,
        assistant_parent_id, runtime_input_json, created_at, updated_at
      )
      SELECT
        id,
        thread_id,
        user_id,
        goal_json,
        status,
        ${column("observations_json", "'[]'")},
        trace_id,
        ${column("blocked_reason", "NULL")},
        ${column("terminal_reason", "NULL")},
        ${column("pending_approval_json", "NULL")},
        ${column("approved_invocations_json", "'[]'")},
        ${column("context_budget_json", "NULL")},
        ${column("selected_tool_id", "NULL")},
        ${column("pending_tool_call_json", "NULL")},
        ${column("last_tool_execution_json", "NULL")},
        ${column("assistant_message_id", "NULL")},
        ${column("assistant_parent_id", "NULL")},
        ${column("runtime_input_json", "NULL")},
        created_at,
        updated_at
      FROM agent_runs_static_plan_legacy;
    `);
    sqlite.exec("DROP TABLE agent_runs_static_plan_legacy");
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }
};

const hasMessagesForeignKeyToLegacyThreads = () => {
  const sqlite = getSqlite();

  if (!hasSqliteTable(sqlite, "messages")) {
    return false;
  }

  const rows = sqlite
    .prepare("PRAGMA foreign_key_list(messages)")
    .all() as Array<{ table: string }>;

  return rows.some((row) => row.table === "threads_legacy");
};

const rebuildMessagesTableForThreadSupport = () => {
  const sqlite = getSqlite();

  const hasMessagesTable = hasSqliteTable(sqlite, "messages");
  const hasPartsJsonColumn = hasSqliteColumn(sqlite, "messages", "parts_json");
  const hasLegacyThreadForeignKey = hasMessagesForeignKeyToLegacyThreads();

  if (!hasMessagesTable || (hasPartsJsonColumn && !hasLegacyThreadForeignKey)) {
    return;
  }

    sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec("BEGIN");

  try {
    sqlite.exec("ALTER TABLE messages RENAME TO messages_legacy");

    sqlite.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        parts_json TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    sqlite.exec(`
      INSERT INTO messages (
        id,
        thread_id,
        role,
        content,
        parts_json,
        metadata,
        created_at
      )
      SELECT
        id,
        thread_id,
        role,
        content,
        NULL,
        COALESCE(metadata, '{}'),
        created_at
      FROM messages_legacy;
    `);

    sqlite.exec(`
      DROP TABLE messages_legacy;
      CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    `);

    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }
};

const rebuildThreadsTableForWorkspaceSupport = () => {
  const sqlite = getSqlite();

  const hasThreadsTable = hasSqliteTable(sqlite, "threads");
  const hasWorkspaceColumn = hasSqliteColumn(sqlite, "threads", "workspace_id");

  if (!hasThreadsTable || hasWorkspaceColumn) {
    return;
  }

  const hasKnowledgeBaseColumn = hasSqliteColumn(
    sqlite,
    "threads",
    "knowledge_base_id",
  );
  const hasRoleIdColumn = hasSqliteColumn(sqlite, "threads", "role_id");
  const hasAgentEnabledColumn = hasSqliteColumn(
    sqlite,
    "threads",
    "agent_enabled",
  );
  const hasEvolvingKnowledgeEnabledColumn = hasSqliteColumn(
    sqlite,
    "threads",
    "evolving_knowledge_enabled",
  );
  const hasContextSummaryColumn = hasSqliteColumn(
    sqlite,
    "threads",
    "context_summary",
  );
  const hasContextSummaryUpdatedAtColumn = hasSqliteColumn(
    sqlite,
    "threads",
    "context_summary_updated_at",
  );

  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec("BEGIN");

  try {
    sqlite.exec("ALTER TABLE threads RENAME TO threads_legacy");

    sqlite.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        model_name TEXT,
        workspace_id TEXT REFERENCES chat_workspaces(id) ON DELETE SET NULL,
        knowledge_base_id TEXT REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        agent_enabled INTEGER NOT NULL DEFAULT 0 CHECK (agent_enabled IN (0, 1)),
        evolving_knowledge_enabled INTEGER NOT NULL DEFAULT 0 CHECK (evolving_knowledge_enabled IN (0, 1)),
        context_summary TEXT,
        context_summary_updated_at TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    sqlite.exec(`
      INSERT INTO threads (
        id,
        user_id,
        title,
        model_name,
        workspace_id,
        knowledge_base_id,
        role_id,
        agent_enabled,
        evolving_knowledge_enabled,
        context_summary,
        context_summary_updated_at,
        status,
        created_at,
        updated_at
      )
      SELECT
        id,
        user_id,
        title,
        model_name,
        NULL,
        ${hasKnowledgeBaseColumn ? "knowledge_base_id" : "NULL"},
        ${hasRoleIdColumn ? "role_id" : "NULL"},
        ${hasAgentEnabledColumn ? "COALESCE(agent_enabled, 0)" : "0"},
        ${hasEvolvingKnowledgeEnabledColumn ? "COALESCE(evolving_knowledge_enabled, 0)" : "0"},
        ${hasContextSummaryColumn ? "context_summary" : "NULL"},
        ${hasContextSummaryUpdatedAtColumn ? "context_summary_updated_at" : "NULL"},
        status,
        created_at,
        updated_at
      FROM threads_legacy;
    `);

    sqlite.exec(`
      DROP TABLE threads_legacy;
      CREATE INDEX IF NOT EXISTS idx_threads_user_id ON threads(user_id);
      CREATE INDEX IF NOT EXISTS idx_threads_workspace_id ON threads(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_threads_knowledge_base ON threads(knowledge_base_id);
      CREATE INDEX IF NOT EXISTS idx_threads_role_id ON threads(role_id);
      CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
      CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at);
    `);

    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }
};

const ensureThreadKnowledgeBaseColumn = () => {
  const sqlite = getSqlite();

  const hasKnowledgeBaseColumn = hasSqliteColumn(
    sqlite,
    "threads",
    "knowledge_base_id",
  );

  if (!hasKnowledgeBaseColumn) {
    sqlite.exec(`
      ALTER TABLE threads
      ADD COLUMN knowledge_base_id TEXT REFERENCES knowledge_bases(id) ON DELETE CASCADE;
    `);
  }

  sqlite.exec(
    "CREATE INDEX IF NOT EXISTS idx_threads_knowledge_base ON threads(knowledge_base_id);",
  );
};

const ensureThreadWorkspaceColumn = () => {
  const sqlite = getSqlite();

  if (!hasSqliteColumn(sqlite, "threads", "workspace_id")) {
    sqlite.exec(`
      ALTER TABLE threads
      ADD COLUMN workspace_id TEXT REFERENCES chat_workspaces(id) ON DELETE SET NULL;
    `);
  }

  sqlite.exec(
    "CREATE INDEX IF NOT EXISTS idx_threads_workspace_id ON threads(workspace_id);",
  );
};

const ensureThreadRoleColumn = () => {
  const sqlite = getSqlite();

  const hasRoleIdColumn = hasSqliteColumn(sqlite, "threads", "role_id");
  if (!hasRoleIdColumn) {
    sqlite.exec(`
      ALTER TABLE threads
      ADD COLUMN role_id TEXT REFERENCES roles(id) ON DELETE SET NULL;
    `);
  }

  sqlite.exec(
    "CREATE INDEX IF NOT EXISTS idx_threads_role_id ON threads(role_id);",
  );
};

const ensureThreadAgentEnabledColumn = () => {
  const sqlite = getSqlite();

  if (!hasSqliteColumn(sqlite, "threads", "agent_enabled")) {
    sqlite.exec(`
      ALTER TABLE threads
      ADD COLUMN agent_enabled INTEGER NOT NULL DEFAULT 0 CHECK (agent_enabled IN (0, 1));
    `);
  }

  if (!hasSqliteColumn(sqlite, "threads", "tts_enabled")) {
    sqlite.exec("ALTER TABLE threads ADD COLUMN tts_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasSqliteColumn(sqlite, "threads", "image_enabled")) {
    sqlite.exec("ALTER TABLE threads ADD COLUMN image_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasSqliteColumn(sqlite, "threads", "evolving_knowledge_enabled")) {
    sqlite.exec("ALTER TABLE threads ADD COLUMN evolving_knowledge_enabled INTEGER NOT NULL DEFAULT 0");
  }
};

const ensureThreadContextSummaryColumns = () => {
  const sqlite = getSqlite();

  if (!hasSqliteColumn(sqlite, "threads", "context_summary")) {
    sqlite.exec(`
      ALTER TABLE threads
      ADD COLUMN context_summary TEXT;
    `);
  }

  if (!hasSqliteColumn(sqlite, "threads", "context_summary_updated_at")) {
    sqlite.exec(`
      ALTER TABLE threads
      ADD COLUMN context_summary_updated_at TEXT;
    `);
  }
};

const ensureMessagePartsJsonColumn = () => {
  const sqlite = getSqlite();

  const hasPartsJsonColumn = hasSqliteColumn(sqlite, "messages", "parts_json");

  if (!hasPartsJsonColumn) {
    sqlite.exec(`
      ALTER TABLE messages
      ADD COLUMN parts_json TEXT;
    `);
  }
};

const ensureAgentRunMessageLinkColumns = () => {
  const sqlite = getSqlite();

  if (!hasSqliteColumn(sqlite, "agent_runs", "assistant_message_id")) {
    sqlite.exec(`
      ALTER TABLE agent_runs
      ADD COLUMN assistant_message_id TEXT;
    `);
  }

  if (!hasSqliteColumn(sqlite, "agent_runs", "assistant_parent_id")) {
    sqlite.exec(`
      ALTER TABLE agent_runs
      ADD COLUMN assistant_parent_id TEXT;
    `);
  }
};

const ensureAgentRunExecutionStateColumns = () => {
  const sqlite = getSqlite();

  if (!hasSqliteColumn(sqlite, "agent_runs", "blocked_reason")) {
    sqlite.exec(`
      ALTER TABLE agent_runs
      ADD COLUMN blocked_reason TEXT;
    `);
  }

  if (!hasSqliteColumn(sqlite, "agent_runs", "terminal_reason")) {
    sqlite.exec(`
      ALTER TABLE agent_runs
      ADD COLUMN terminal_reason TEXT;
    `);
  }

  if (!hasSqliteColumn(sqlite, "agent_runs", "approved_invocations_json")) {
    sqlite.exec(`
      ALTER TABLE agent_runs
      ADD COLUMN approved_invocations_json TEXT NOT NULL DEFAULT '[]';
    `);
  }

  if (!hasSqliteColumn(sqlite, "agent_runs", "pending_tool_call_json")) {
    sqlite.exec(`
      ALTER TABLE agent_runs
      ADD COLUMN pending_tool_call_json TEXT;
    `);
  }

  if (!hasSqliteColumn(sqlite, "agent_runs", "last_tool_execution_json")) {
    sqlite.exec(`
      ALTER TABLE agent_runs
      ADD COLUMN last_tool_execution_json TEXT;
    `);
  }

  if (!hasSqliteColumn(sqlite, "agent_runs", "selected_tool_id")) {
    sqlite.exec(`
      ALTER TABLE agent_runs
      ADD COLUMN selected_tool_id TEXT;
    `);
  }
};

export const initializeThreadDatabase = () => {
  try {
    const sqlite = getSqlite();
    applySqliteConnectionPragmas(sqlite);

    rebuildThreadsTableForWorkspaceSupport();
    createThreadTables();
    rebuildMessagesTableForThreadSupport();
    ensureThreadWorkspaceColumn();
    ensureThreadKnowledgeBaseColumn();
    ensureThreadRoleColumn();
    ensureThreadAgentEnabledColumn();
    ensureThreadContextSummaryColumns();
    ensureMessagePartsJsonColumn();
    rebuildAgentRunsWithoutStaticPlan();
    createAgentRunTables();
    ensureAgentRunExecutionStateColumns();
    ensureAgentRunMessageLinkColumns();
  } catch (error) {
    console.error("Failed to initialize thread database:", error);
    throw error;
  }
};

export const getThreadDatabaseHealth = () => ({
  hasChatWorkspacesTable: hasSqliteTable(getSqlite(), "chat_workspaces"),
  hasThreadsTable: hasSqliteTable(getSqlite(), "threads"),
  hasConversationWorkdirsTable: hasSqliteTable(
    getSqlite(),
    "conversation_workdirs",
  ),
  hasMessagesTable: hasSqliteTable(getSqlite(), "messages"),
  hasAgentRunsTable: hasSqliteTable(getSqlite(), "agent_runs"),
  hasThreadUserIdColumn: hasSqliteColumn(getSqlite(), "threads", "user_id"),
  hasThreadWorkspaceIdColumn: hasSqliteColumn(
    getSqlite(),
    "threads",
    "workspace_id",
  ),
  hasThreadKnowledgeBaseIdColumn: hasSqliteColumn(
    getSqlite(),
    "threads",
    "knowledge_base_id",
  ),
  hasThreadRoleIdColumn: hasSqliteColumn(getSqlite(), "threads", "role_id"),
  hasThreadAgentEnabledColumn: hasSqliteColumn(
    getSqlite(),
    "threads",
    "agent_enabled",
  ),
  hasEvolvingKnowledgeEnabledColumn: hasSqliteColumn(
    getSqlite(),
    "threads",
    "evolving_knowledge_enabled",
  ),
});
