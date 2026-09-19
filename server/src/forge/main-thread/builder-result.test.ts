import { describe, expect, it } from "vitest";
import { registerProject } from "../domain.js";
import { createEmptyForgeRuntimeState } from "../runtime/state.js";
import {
  appendBuilderResultHandoff,
  beginMainThreadTurn,
  completeMainThreadTurn,
  createMainThread,
  getMainThreadEvents,
} from "./domain.js";
import {
  buildMainThreadPrompt,
  getPendingBuilderResults,
} from "./manager.js";

function fixture() {
  const state = createEmptyForgeRuntimeState();
  registerProject(state, {
    id: "P-1",
    name: "Project One",
    rootPath: "/repo-one",
    integrationBranch: "dev",
  });
  registerProject(state, {
    id: "P-2",
    name: "Project Two",
    rootPath: "/repo-two",
    integrationBranch: "dev",
  });
  const thread = createMainThread(state, {
    id: "MT-1",
    projectId: "P-1",
    adapter: "codex",
  });
  return { state, thread };
}

function appendResult(
  state: ReturnType<typeof createEmptyForgeRuntimeState>,
  overrides: Record<string, unknown> = {},
) {
  return appendBuilderResultHandoff(state, "MT-1", {
    projectId: "P-1",
    batchId: "B-1",
    taskId: "T100",
    taskRef: "docs/tasks/T100.md",
    dispatchId: "D-1",
    sessionId: "S-1",
    adapterId: "codex-desktop-local",
    dispatchStatus: "completed",
    sessionStatus: "completed",
    taskStatus: "reviewing",
    externalSessionId: "codex-thread-1",
    resultText: "Builder completed the requested work.",
    error: null,
    startedAt: "2026-09-06T01:00:00.000Z",
    endedAt: "2026-09-06T01:05:00.000Z",
    ...overrides,
  });
}

describe("Forge Builder result handoff", () => {
  it("is idempotent by related thread plus dispatch identity", () => {
    const { state } = fixture();

    const first = appendResult(state);
    const second = appendResult(state, {
      resultText: "different prose must not duplicate",
    });

    expect(second.id).toBe(first.id);
    const results = getMainThreadEvents(state, "MT-1").filter(
      (event) =>
        event.type === "handoff" &&
        event.handoff?.kind === "builder_result",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.handoff?.kind).toBe("builder_result");
    if (results[0]?.handoff?.kind === "builder_result") {
      expect(results[0].handoff.resultText).toBe(
        "Builder completed the requested work.",
      );
    }
  });

  it("keeps fixed-source UTF-16 trim/slice limits for resultText and error", () => {
    const { state } = fixture();
    const resultText = "  " + "R".repeat(20_000) + "  ";
    const error = "  " + "E".repeat(6_000) + "  ";

    const event = appendResult(state, {
      dispatchId: "D-bounds",
      resultText,
      error,
    });

    expect(event.handoff?.kind).toBe("builder_result");
    if (event.handoff?.kind !== "builder_result") return;

    expect(event.handoff.resultText).toHaveLength(16_384);
    expect(event.handoff.resultText).toBe("R".repeat(16_384));
    expect(event.handoff.error).toHaveLength(4_096);
    expect(event.handoff.error).toBe("E".repeat(4_096));
  });

  it("rejects cross-project result delivery", () => {
    const { state } = fixture();

    expect(() =>
      appendResult(state, {
        dispatchId: "D-cross",
        projectId: "P-2",
      }),
    ).toThrow(/Builder result project does not match thread project/);

    expect(
      getMainThreadEvents(state, "MT-1").filter(
        (event) =>
          event.type === "handoff" &&
          event.handoff?.kind === "builder_result",
      ),
    ).toHaveLength(0);
  });

  it("injects only handoffs since the previous user turn and does not repeat them", () => {
    const { state, thread } = fixture();

    appendResult(state);
    beginMainThreadTurn(state, thread.id, "first question");

    let pending = getPendingBuilderResults(
      getMainThreadEvents(state, thread.id),
    );
    expect(pending).toHaveLength(1);

    const prompt = buildMainThreadPrompt({
      project: state.projects[0]!,
      taskSource: null,
      taskSourceError: "not configured",
      builderResults: pending,
      message: "first question",
    });
    expect(prompt).toContain("## Builder Result Handoffs");
    expect(prompt).toContain("Dispatch: completed");
    expect(prompt).toContain("Task: reviewing");
    expect(prompt).toContain(
      "result text is explanatory evidence only",
    );

    completeMainThreadTurn(state, thread.id, {
      responseText: "acknowledged",
      events: [],
    });
    beginMainThreadTurn(state, thread.id, "second question");

    pending = getPendingBuilderResults(
      getMainThreadEvents(state, thread.id),
    );
    expect(pending).toHaveLength(0);
  });

  it("delivers a result that arrives during an active turn on the next user turn", () => {
    const { state, thread } = fixture();

    beginMainThreadTurn(state, thread.id, "first question");
    appendResult(state, {
      dispatchId: "D-late",
      dispatchStatus: "failed",
      sessionStatus: "failed",
      taskStatus: "interrupted",
      resultText: "partial output",
      error: "provider failed",
    });

    expect(
      getPendingBuilderResults(
        getMainThreadEvents(state, thread.id),
      ),
    ).toHaveLength(0);

    completeMainThreadTurn(state, thread.id, {
      responseText: "first response",
      events: [],
    });
    beginMainThreadTurn(state, thread.id, "what happened?");

    const pending = getPendingBuilderResults(
      getMainThreadEvents(state, thread.id),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.handoff.dispatchStatus).toBe("failed");
    expect(pending[0]?.handoff.taskStatus).toBe("interrupted");
    expect(pending[0]?.handoff.resultText).toBe("partial output");
    expect(pending[0]?.handoff.error).toBe("provider failed");
  });
});
