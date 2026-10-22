import { getSqlite } from "../../index.js";
import type { ToolInvocation, ToolTrace, ToolInvocationEvent } from "@/mcp/core/definitions.js";

const ensureInvocationTable = () => {
  const sqlite = getSqlite();
  sqlite.exec(`CREATE TABLE IF NOT EXISTS computer_use_invocations (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, trace_json TEXT, events_json TEXT)`);
  for (const column of ["trace_json", "events_json"]) {
    try { sqlite.exec(`ALTER TABLE computer_use_invocations ADD COLUMN ${column} TEXT`); } catch { /* already exists */ }
  }
  return sqlite;
};

export const computerUseRepository = {
  initialize() {
    ensureInvocationTable();
  },
  persistInvocation(record: ToolInvocation) {
    const sqlite = ensureInvocationTable();
    sqlite.prepare(`INSERT INTO computer_use_invocations (id, payload_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`).run(record.id, JSON.stringify(record), record.finishedAt ?? record.startedAt ?? new Date().toISOString());
  },
  getInvocation(id: string): ToolInvocation | null {
    try { const row = ensureInvocationTable().prepare(`SELECT payload_json FROM computer_use_invocations WHERE id = ?`).get(id) as { payload_json?: string } | undefined; return row?.payload_json ? JSON.parse(row.payload_json) as ToolInvocation : null; } catch { return null; }
  },
  persistTrace(trace: ToolTrace) {
    try { ensureInvocationTable().prepare(`UPDATE computer_use_invocations SET trace_json = ? WHERE id = ?`).run(JSON.stringify(trace), trace.invocationId); } catch { /* optional before database startup */ }
  },
  getTrace(id: string): ToolTrace | null {
    try { const row = ensureInvocationTable().prepare(`SELECT trace_json FROM computer_use_invocations WHERE id = ?`).get(id) as { trace_json?: string } | undefined; return row?.trace_json ? JSON.parse(row.trace_json) as ToolTrace : null; } catch { return null; }
  },
  persistEvents(id: string, events: ToolInvocationEvent[]) {
    try { ensureInvocationTable().prepare(`UPDATE computer_use_invocations SET events_json = ? WHERE id = ?`).run(JSON.stringify(events), id); } catch { /* optional before database startup */ }
  },
  getEvents(id: string): ToolInvocationEvent[] {
    try { const row = ensureInvocationTable().prepare(`SELECT events_json FROM computer_use_invocations WHERE id = ?`).get(id) as { events_json?: string } | undefined; return row?.events_json ? JSON.parse(row.events_json) as ToolInvocationEvent[] : []; } catch { return []; }
  },
};
