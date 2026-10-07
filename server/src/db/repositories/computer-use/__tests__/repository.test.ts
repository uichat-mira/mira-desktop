import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getSqlite, resetDatabaseClients } from "@/db/index.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import type { ToolInvocation, ToolTrace, ToolInvocationEvent } from "@/mcp/core/definitions.js";
import { computerUseRepository } from "../repository.js";

describe("Computer Use observability persistence", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = `file:${createTimestampedTestArtifactPath("db", "computer-use", ".sqlite")}`;
    resetDatabaseClients();
    computerUseRepository.initialize();
  });
  afterEach(() => { resetDatabaseClients(); delete process.env.DATABASE_URL; });

  test("reads invocation, trace, and approval events after database client reset", () => {
    const record: ToolInvocation = { id: "invocation-1", toolId: "browser_act", status: "awaiting_approval", args: { sessionId: "session-1", pageUrl: "https://example.com", snapshotHash: "hash", action: { kind: "click", ref: "e1" } }, traceId: "trace-1", artifacts: [], approval: { required: true, reason: "approval" }, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
    const trace: ToolTrace = { traceId: "trace-1", invocationId: "invocation-1", toolId: "browser_act", startedAt: record.startedAt!, finishedAt: record.finishedAt, spans: [] };
    const events: ToolInvocationEvent[] = [{ type: "invocation:approval_required", invocationId: "invocation-1", message: "approval", at: new Date().toISOString() }];
    computerUseRepository.persistInvocation(record);
    computerUseRepository.persistTrace(trace);
    computerUseRepository.persistEvents(record.id, events);
    resetDatabaseClients();
    expect(computerUseRepository.getInvocation(record.id)?.approval?.reason).toBe("approval");
    expect(computerUseRepository.getTrace(record.id)?.traceId).toBe("trace-1");
    expect(computerUseRepository.getEvents(record.id)).toHaveLength(1);
    expect(getSqlite().prepare("SELECT trace_json, events_json FROM computer_use_invocations WHERE id = ?").get(record.id)).toMatchObject({ trace_json: expect.any(String), events_json: expect.any(String) });
  });
});
