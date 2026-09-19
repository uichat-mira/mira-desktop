import { describe, expect, it } from "vitest";
import {
  appendRuntimeEvent,
  createDispatch,
  transitionDispatch,
} from "./dispatch-domain.js";
import {
  CODEX_ADAPTER_ID,
  OPENCODE_ADAPTER_ID,
  PIAGENT_ADAPTER_ID,
  resolveBuilderAdapterId,
  resolveBuiltinBuilder,
} from "./builder-contract.js";
import type { ForgeCoreState } from "./types.js";

describe("Forge dispatch primitives", () => {
  it("preserves dispatch transition guards and terminal timestamps", () => {
    const state = createCoreState();
    const dispatch = createDispatch(state, {
      id: "D-1",
      projectId: "P-1",
      batchId: "B-1",
      taskId: "T001",
      adapterId: "builder-local",
      sessionId: "S-1",
      promptSource: "task_ref",
      taskRef: "docs/tasks/T001.md",
    });

    expect(dispatch.status).toBe("starting");
    expect(dispatch.promptSource).toBe("task_ref");

    transitionDispatch(state, dispatch.id, "running", {
      externalSessionId: "external-1",
      pid: 42,
    });
    expect(dispatch.startedAt).toBeTruthy();

    transitionDispatch(state, dispatch.id, "completed", {
      exitCode: 0,
      resultText: "done",
    });
    const endedAt = dispatch.endedAt;
    expect(endedAt).toBeTruthy();
    expect(dispatch.resultText).toBe("done");

    transitionDispatch(state, dispatch.id, "completed");
    expect(dispatch.endedAt).toBe(endedAt);
    expect(() => transitionDispatch(state, dispatch.id, "running")).toThrow(
      /invalid dispatch transition/,
    );
  });

  it("rejects duplicate dispatch ids and invalid statuses", () => {
    const state = createCoreState();
    const input = {
      id: "D-fixed",
      projectId: "P-1",
      batchId: "B-1",
      taskId: "T001",
      adapterId: "builder-local",
      sessionId: "S-1",
    };
    createDispatch(state, input);
    expect(() => createDispatch(state, input)).toThrow(/duplicate dispatch id/);
    expect(() => transitionDispatch(state, "D-fixed", "done-ish")).toThrow(
      /invalid dispatch status/,
    );
  });

  it("appends bounded-shape runtime event data without inventing provider semantics", () => {
    const state = createCoreState();
    const event = appendRuntimeEvent(state, {
      id: "E-1",
      type: "dispatch.started",
      projectId: "P-1",
      data: { provider: "opencode", raw: 1 },
    });

    expect(event.type).toBe("dispatch.started");
    expect(event.data).toEqual({ provider: "opencode", raw: 1 });
    expect(state.events).toHaveLength(1);
  });
});

describe("Forge Builder contract", () => {
  it("preserves the three product-level Builder choices", () => {
    expect(resolveBuiltinBuilder("opencode")?.id).toBe(OPENCODE_ADAPTER_ID);
    expect(resolveBuiltinBuilder("pi")?.id).toBe(PIAGENT_ADAPTER_ID);
    expect(resolveBuiltinBuilder("codex-desktop")?.id).toBe(CODEX_ADAPTER_ID);
  });

  it("defaults to OpenCode and rejects adapter/preferred Builder conflicts", () => {
    expect(resolveBuilderAdapterId()).toBe(OPENCODE_ADAPTER_ID);
    expect(resolveBuilderAdapterId({ preferredBuilder: "codex" })).toBe(CODEX_ADAPTER_ID);
    expect(() =>
      resolveBuilderAdapterId({
        adapterId: OPENCODE_ADAPTER_ID,
        preferredBuilder: "codex",
      }),
    ).toThrow(/conflicts with builder/);
    expect(() => resolveBuilderAdapterId({ builder: "unknown" })).toThrow(
      /unsupported builder/,
    );
  });
});
function createCoreState(): ForgeCoreState {
  return { projects: [], batches: [], adapters: [], sessions: [], reviews: [], dispatches: [], events: [] };
}

