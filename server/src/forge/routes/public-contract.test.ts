import { describe, expect, it } from "vitest";
import { createEmptyForgeRuntimeState } from "../runtime/state.js";
import {
  projectInspector,
  projectRuntimeSummary,
  publicRuntimeEvent,
} from "./public-contract.js";

describe("Forge public runtime projections", () => {
  it("does not leak unrelated events when inspector identifiers do not resolve", () => {
    const state = createEmptyForgeRuntimeState();
    state.events.push({
      id: "E-1",
      type: "dispatch.started",
      projectId: "P-real",
      batchId: "B-real",
      taskId: "T-real",
      dispatchId: "D-real",
      sessionId: "S-real",
      data: { secret: "unrelated" },
      createdAt: "2026-09-06T00:00:00.000Z",
    });

    const inspector = projectInspector(state, {
      projectId: "P-missing",
      dispatchId: "D-missing",
    });

    expect(inspector.project).toBeNull();
    expect(inspector.dispatch).toBeNull();
    expect(inspector.events).toEqual([]);
  });

  it("bounds public runtime event metadata instead of exposing unbounded raw payloads", () => {
    const projected = publicRuntimeEvent({
      id: "E-1",
      type: "dispatch.provider_event",
      projectId: "P-1",
      batchId: "B-1",
      taskId: "T100",
      dispatchId: "D-1",
      sessionId: "S-1",
      data: {
        provider: {
          adapter: "codex",
          raw: "x".repeat(10_000),
          nested: {
            deeper: {
              tooDeep: {
                value: "must be bounded",
              },
            },
          },
        },
      },
      createdAt: "2026-09-06T00:00:00.000Z",
    });

    const provider = projected.data.provider as Record<string, unknown>;
    expect(String(provider.raw)).toHaveLength(4096);
    const nested = provider.nested as Record<string, unknown>;
    const deeper = nested.deeper as Record<string, unknown>;
    expect(deeper.tooDeep).toBe("[bounded]");
  });

  it("derives summary from authoritative runtime state", () => {
    const state = createEmptyForgeRuntimeState();
    state.projects.push({
      id: "P-1",
      name: "Project",
      rootPath: "/repo",
      repository: null,
      taskLedger: null,
      taskDir: null,
      integrationBranch: "dev",
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
    });
    state.batches.push({
      id: "B-1",
      projectId: "P-1",
      name: "Batch",
      status: "attention",
      baseSha: null,
      tasks: [
        {
          id: "T100",
          title: "Task",
          status: "interrupted",
          builder: null,
          builderSessionId: null,
          reviewerSessionId: null,
          worktree: null,
          baseSha: null,
          currentSha: null,
          reviewedSha: null,
          reviewRound: 0,
          dependsOn: [],
          previewUrls: {},
          createdAt: "2026-09-06T00:00:00.000Z",
          updatedAt: "2026-09-06T00:01:00.000Z",
        },
      ],
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:01:00.000Z",
    });

    const summary = projectRuntimeSummary(state);
    expect(summary.projectCount).toBe(1);
    expect(summary.batchCount).toBe(1);
    expect(summary.activeBatchCount).toBe(1);
    expect(summary.attentionTaskCount).toBe(1);
    expect(summary.updatedAt).toBe("2026-09-06T00:01:00.000Z");
  });
});
