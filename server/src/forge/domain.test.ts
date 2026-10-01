import { describe, expect, it } from "vitest";
import {
  createBatch,
  createReviewHandoff,
  createSession,
  heartbeatAdapter,
  registerAdapter,
  registerProject,
  resolveReviewHandoff,
  updateSession,
  updateTask,
} from "./domain.js";
import type { ForgeCoreState } from "./types.js";

function sessionFixture() {
  const state = createCoreState();
  const project = registerProject(state, { name: "Demo", rootPath: "/tmp/demo" });
  const batch = createBatch(state, { projectId: project.id, tasks: [{ id: "T001" }] });
  const builder = registerAdapter(state, {
    id: "builder-local",
    name: "Builder",
    kind: "builder",
  });
  const reviewer = registerAdapter(state, {
    id: "reviewer-local",
    name: "Reviewer",
    kind: "reviewer",
  });
  return { state, project, batch, builder, reviewer };
}

function reviewFixture() {
  const state = createCoreState();
  const project = registerProject(state, { name: "Review Demo", rootPath: "/tmp/review-demo" });
  const batch = createBatch(state, { projectId: project.id, tasks: [{ id: "T001" }] });
  const reviewer = registerAdapter(state, {
    id: "reviewer-local",
    name: "Reviewer",
    kind: "reviewer",
  });
  const reviewerSession = createSession(state, {
    id: "S-reviewer-1",
    role: "reviewer",
    adapterId: reviewer.id,
    projectId: project.id,
    batchId: batch.id,
    taskId: "T001",
  });
  updateSession(state, reviewerSession.id, { status: "running" });
  updateTask(state, batch.id, "T001", { currentSha: "abc" });
  return { state, project, batch, reviewerSession };
}

describe("Forge core domain", () => {
  it("forms the project -> batch -> task runtime pipeline", () => {
    const state = createCoreState();
    const project = registerProject(state, { name: "Demo", rootPath: "/tmp/demo" });
    const batch = createBatch(state, {
      projectId: project.id,
      tasks: [{ id: "T001", title: "Build control plane" }],
    });

    updateTask(state, batch.id, "T001", { status: "building", builder: "opencode" });
    expect(batch.status).toBe("active");

    updateTask(state, batch.id, "T001", { status: "reviewing", currentSha: "abc" });
    expect(batch.status).toBe("reviewing");
  });

  it("rejects invalid task status and forged review fields", () => {
    const state = createCoreState();
    const project = registerProject(state, { name: "Demo", rootPath: "/tmp/demo" });
    const batch = createBatch(state, { projectId: project.id, tasks: [{ id: "T001" }] });
    updateTask(state, batch.id, "T001", { currentSha: "abc" });

    expect(() => updateTask(state, batch.id, "T001", { status: "done-ish" })).toThrow(
      /invalid task status/,
    );
    expect(() => updateTask(state, batch.id, "T001", { status: "review_passed" })).toThrow(
      /review_passed is managed by review handoff/,
    );
    expect(() => updateTask(state, batch.id, "T001", { reviewedSha: "abc" })).toThrow(
      /reviewedSha is managed by review handoff/,
    );
    expect(() => updateTask(state, batch.id, "T001", { reviewRound: 99 })).toThrow(
      /reviewRound is managed by review handoff/,
    );
  });

  it("rejects duplicate batch ids and malformed dependency declarations", () => {
    const state = createCoreState();
    const project = registerProject(state, { name: "Demo", rootPath: "/tmp/demo" });
    createBatch(state, {
      id: "B-fixed",
      projectId: project.id,
      tasks: [{ id: "T001" }],
    });

    expect(() =>
      createBatch(state, {
        id: "B-fixed",
        projectId: project.id,
        tasks: [{ id: "T002" }],
      }),
    ).toThrow(/duplicate batch id: B-fixed/);

    expect(() =>
      createBatch(state, {
        projectId: project.id,
        tasks: [{ id: "T002", dependsOn: "T001" }],
      }),
    ).toThrow(/task.dependsOn must be an array/);
  });

  it("keeps the adapter registry provider-neutral and heartbeat-driven", () => {
    const state = createCoreState();
    const adapter = registerAdapter(state, {
      id: "builder-local",
      name: "Local Builder",
      kind: "builder",
      capabilities: ["code", "terminal", "code"],
    });

    expect(adapter.status).toBe("offline");
    expect(adapter.capabilities).toEqual(["code", "terminal"]);
    expect(adapter.lastSeenAt).toBeNull();

    heartbeatAdapter(state, adapter.id, { status: "busy" });
    expect(adapter.status).toBe("busy");
    expect(adapter.lastSeenAt).toBeTruthy();

    expect(() =>
      registerAdapter(state, {
        id: "builder-local",
        name: "Duplicate",
        kind: "builder",
      }),
    ).toThrow(/duplicate adapter id/);
    expect(() => registerAdapter(state, { name: "Unknown", kind: "browser" })).toThrow(
      /invalid adapter kind/,
    );
  });

  it("preserves session lifecycle guards and history", () => {
    const { state, project, batch, builder, reviewer } = sessionFixture();

    expect(() =>
      createSession(state, {
        role: "builder",
        adapterId: reviewer.id,
        projectId: project.id,
        batchId: batch.id,
        taskId: "T001",
      }),
    ).toThrow(/incompatible/);

    const session = createSession(state, {
      id: "S-builder-1",
      role: "builder",
      adapterId: builder.id,
      projectId: project.id,
      batchId: batch.id,
      taskId: "T001",
    });

    expect(() =>
      createSession(state, {
        role: "builder",
        adapterId: builder.id,
        projectId: project.id,
        batchId: batch.id,
        taskId: "T001",
      }),
    ).toThrow(/active builder session already exists/);

    expect(() => updateSession(state, session.id, { status: "waiting" })).toThrow(
      /invalid session transition/,
    );
    updateSession(state, session.id, { status: "running", externalSessionId: "external-42" });
    expect(session.startedAt).toBeTruthy();
    expect(session.externalSessionId).toBe("external-42");

    updateSession(state, session.id, { status: "completed" });
    const endedAt = session.endedAt;
    updateSession(state, session.id, { status: "completed" });
    expect(session.endedAt).toBe(endedAt);

    const next = createSession(state, {
      id: "S-builder-2",
      role: "builder",
      adapterId: builder.id,
      projectId: project.id,
      batchId: batch.id,
      taskId: "T001",
    });
    expect(batch.tasks[0]?.builderSessionId).toBe(next.id);
    expect(state.sessions).toHaveLength(2);
  });

  it("binds review PASS to the exact current SHA", () => {
    const { state, project, batch, reviewerSession } = reviewFixture();
    const review = createReviewHandoff(state, {
      id: "R-1",
      projectId: project.id,
      batchId: batch.id,
      taskId: "T001",
      reviewerSessionId: reviewerSession.id,
      sha: "abc",
    });

    expect(review.status).toBe("requested");
    expect(review.round).toBe(1);
    expect(batch.tasks[0]?.status).toBe("reviewing");

    expect(() =>
      resolveReviewHandoff(state, review.id, { result: "passed", reviewedSha: "def" }),
    ).toThrow(/reviewedSha must match review requestedSha/);

    resolveReviewHandoff(state, review.id, { result: "passed", reviewedSha: "abc" });
    expect(review.actionable).toBe(true);
    expect(batch.tasks[0]?.status).toBe("review_passed");
    expect(batch.tasks[0]?.reviewedSha).toBe("abc");
  });

  it("derives review rounds from durable history, not mutable task projection", () => {
    const { state, project, batch, reviewerSession } = reviewFixture();
    const first = createReviewHandoff(state, {
      projectId: project.id,
      batchId: batch.id,
      taskId: "T001",
      reviewerSessionId: reviewerSession.id,
      sha: "abc",
    });
    resolveReviewHandoff(state, first.id, { result: "cancelled" });

    if (!batch.tasks[0]) throw new Error("fixture task missing");
    batch.tasks[0].reviewRound = 99;

    const second = createReviewHandoff(state, {
      projectId: project.id,
      batchId: batch.id,
      taskId: "T001",
      reviewerSessionId: reviewerSession.id,
      sha: "abc",
    });
    expect(second.round).toBe(2);
    expect(batch.tasks[0].reviewRound).toBe(2);
  });

  it("invalidates an old PASS when currentSha changes", () => {
    const { state, project, batch, reviewerSession } = reviewFixture();
    const review = createReviewHandoff(state, {
      projectId: project.id,
      batchId: batch.id,
      taskId: "T001",
      reviewerSessionId: reviewerSession.id,
      sha: "abc",
    });
    resolveReviewHandoff(state, review.id, { result: "passed", reviewedSha: "abc" });

    updateTask(state, batch.id, "T001", { currentSha: "def" });

    expect(batch.tasks[0]?.status).toBe("stale");
    expect(batch.tasks[0]?.reviewedSha).toBeNull();
    expect(review.status).toBe("passed");
    expect(review.actionable).toBe(false);
    expect(review.invalidatedAt).toBeTruthy();
  });

  it("records late review completion as non-actionable after SHA changed", () => {
    const { state, project, batch, reviewerSession } = reviewFixture();
    const review = createReviewHandoff(state, {
      projectId: project.id,
      batchId: batch.id,
      taskId: "T001",
      reviewerSessionId: reviewerSession.id,
      sha: "abc",
    });

    updateTask(state, batch.id, "T001", { currentSha: "def" });
    resolveReviewHandoff(state, review.id, { result: "passed", reviewedSha: "abc" });

    expect(review.status).toBe("passed");
    expect(review.actionable).toBe(false);
    expect(batch.tasks[0]?.status).not.toBe("review_passed");
    expect(batch.tasks[0]?.reviewedSha).toBeNull();
  });
});
function createCoreState(): ForgeCoreState {
  return { projects: [], batches: [], adapters: [], sessions: [], reviews: [], dispatches: [], events: [] };
}

