import { describe, expect, it } from "vitest";
import {
  createBatch,
  createSession,
  registerAdapter,
  registerProject,
  updateTask,
} from "./domain.js";
import { getDispatchReadiness, validateBatchDependencies } from "./readiness.js";
import type { ForgeCoreState } from "./types.js";

function projectState() {
  const state = createCoreState();
  const project = registerProject(state, {
    name: "Dispatch Demo",
    rootPath: "/tmp/dispatch-demo",
  });
  return { state, project };
}

describe("Forge dispatch readiness", () => {
  it("rejects missing, self and cyclic dependencies", () => {
    {
      const { state, project } = projectState();
      const batch = createBatch(state, {
        projectId: project.id,
        tasks: [{ id: "T001", dependsOn: ["T999"] }],
      });
      expect(() => validateBatchDependencies(batch)).toThrow(/dependency T999 not found/);
    }

    {
      const { state, project } = projectState();
      const batch = createBatch(state, {
        projectId: project.id,
        tasks: [{ id: "T001", dependsOn: ["T001"] }],
      });
      expect(() => validateBatchDependencies(batch)).toThrow(/cannot depend on itself/);
    }

    {
      const { state, project } = projectState();
      const batch = createBatch(state, {
        projectId: project.id,
        tasks: [
          { id: "T001", dependsOn: ["T002"] },
          { id: "T002", dependsOn: ["T001"] },
        ],
      });
      expect(() => validateBatchDependencies(batch)).toThrow(/cyclic task dependencies/);
    }
  });

  it("reports independent tasks together and waits for integrated dependencies", () => {
    const { state, project } = projectState();
    const batch = createBatch(state, {
      projectId: project.id,
      tasks: [
        { id: "T001", title: "Foundation" },
        { id: "T002", title: "Dependent", dependsOn: ["T001"] },
        { id: "T003", title: "Independent" },
      ],
    });

    const initial = getDispatchReadiness(state, batch.id);
    expect(initial.ready.map((task) => task.taskId)).toEqual(["T001", "T003"]);
    expect(initial.blocked.find((task) => task.taskId === "T002")?.reasons[0]?.code).toBe(
      "dependency_not_integrated",
    );

    updateTask(state, batch.id, "T001", { status: "integrated" });
    expect(getDispatchReadiness(state, batch.id).ready.map((task) => task.taskId)).toEqual([
      "T002",
      "T003",
    ]);
  });

  it("blocks a task with an active Builder session", () => {
    const { state, project } = projectState();
    const batch = createBatch(state, { projectId: project.id, tasks: [{ id: "T001" }] });
    const builder = registerAdapter(state, {
      id: "builder-local",
      name: "Builder",
      kind: "builder",
    });
    const session = createSession(state, {
      id: "S-active-builder",
      role: "builder",
      adapterId: builder.id,
      projectId: project.id,
      batchId: batch.id,
      taskId: "T001",
    });

    const readiness = getDispatchReadiness(state, batch.id);
    expect(readiness.ready).toHaveLength(0);
    expect(
      readiness.blocked[0]?.reasons.find((item) => item.code === "active_builder_session")
        ?.sessionId,
    ).toBe(session.id);
  });

  it("allows fixing tasks when dependencies are satisfied and no Builder is active", () => {
    const { state, project } = projectState();
    const batch = createBatch(state, { projectId: project.id, tasks: [{ id: "T001" }] });
    updateTask(state, batch.id, "T001", { status: "fixing" });

    expect(getDispatchReadiness(state, batch.id).ready.map((task) => task.taskId)).toEqual([
      "T001",
    ]);
  });
});
function createCoreState(): ForgeCoreState {
  return { projects: [], batches: [], adapters: [], sessions: [], reviews: [], dispatches: [], events: [] };
}

