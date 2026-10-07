import { getSqlite } from "../../index.js";
import type { ComputerUseTask, ComputerUseEvidence } from "@/microapps/computer-use/core/types.js";
import type { ToolArtifact, ToolInvocation, ToolTrace, ToolInvocationEvent } from "@/mcp/core/definitions.js";

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
    getSqlite().exec(`
      CREATE TABLE IF NOT EXISTS computer_use_tasks (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_computer_use_tasks_updated_at ON computer_use_tasks(updated_at);
    `);
    ensureInvocationTable();
  },
  create(task: ComputerUseTask) {
    getSqlite().prepare(`INSERT INTO computer_use_tasks (id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(task.id, JSON.stringify(task), task.createdAt, task.updatedAt);
  },
  update(task: ComputerUseTask) {
    getSqlite().prepare(`UPDATE computer_use_tasks SET payload_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(task), task.updatedAt, task.id);
  },
  getById(id: string): ComputerUseTask | null {
    const row = getSqlite().prepare(`SELECT payload_json FROM computer_use_tasks WHERE id = ?`).get(id) as { payload_json?: string } | undefined;
    return row?.payload_json ? JSON.parse(row.payload_json) as ComputerUseTask : null;
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

export const createPersistentComputerUseTaskStore = () => ({
  async create(task: ComputerUseTask) { computerUseRepository.create(task); },
  async update(task: ComputerUseTask) { computerUseRepository.update(task); },
  async getById(id: string) { return computerUseRepository.getById(id); },
});

export const createPersistentComputerUseEvidenceStore = () => ({
  async append(input: { taskId: string; entries?: ComputerUseEvidence["entries"]; artifacts?: ComputerUseEvidence["artifacts"] }) {
    const task = computerUseRepository.getById(input.taskId);
    if (!task) throw new Error(`Computer Use task not found: ${input.taskId}`);
    const next = { entries: [...task.evidence.entries, ...(input.entries ?? [])], artifacts: [...task.evidence.artifacts, ...(input.artifacts ?? [])], lastUpdatedAt: new Date().toISOString() };
    computerUseRepository.update({ ...task, evidence: next, updatedAt: next.lastUpdatedAt });
    return next;
  },
});
