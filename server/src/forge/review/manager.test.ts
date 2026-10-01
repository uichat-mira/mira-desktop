import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createBatch,
  createSession,
  registerAdapter,
  registerProject,
  updateSession,
  updateTask,
} from "../domain.js";
import { createForgeRuntimeStore } from "../runtime/store.js";
import { createForgeReviewManager } from "./manager.js";

const artifactRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.test-artifact/forge-t007-review",
);

async function fixture(taskIds = ["T100", "T101"]) {
  await mkdir(artifactRoot, { recursive: true });
  const root = await mkdtemp(path.join(artifactRoot, "case-"));
  const store = createForgeRuntimeStore(path.join(root, "state.json"));

  const seeded = await store.mutate((state) => {
    registerProject(state, {
      id: "P-1",
      name: "Review fixture",
      rootPath: root,
      integrationBranch: "dev",
    });
    registerAdapter(state, {
      id: "reviewer-local",
      name: "Reviewer",
      kind: "reviewer",
      capabilities: ["review"],
      status: "available",
    });
    const batch = createBatch(state, {
      id: "B-1",
      projectId: "P-1",
      name: "Review batch",
      tasks: taskIds.map((id) => ({ id, title: id })),
    });
    for (const task of batch.tasks) {
      updateTask(state, batch.id, task.id, {
        currentSha: "sha-" + task.id,
      });
    }
    const reviewer = createSession(state, {
      id: "S-reviewer",
      role: "reviewer",
      adapterId: "reviewer-local",
      projectId: "P-1",
      batchId: batch.id,
      taskId: taskIds[0],
    });
    updateSession(state, reviewer.id, { status: "running" });
    return { batchId: batch.id, reviewerSessionId: reviewer.id };
  });

  return { root, store, ...seeded };
}

describe("Forge SHA-bound review guards", () => {
  it("blocks generic review_passed/integrated/review metadata forgery", async () => {
    const { root, store, batchId } = await fixture(["T100"]);
    try {
      await expect(
        store.mutate((state) =>
          updateTask(state, batchId, "T100", {
            status: "review_passed",
          }),
        ),
      ).rejects.toThrow(/review_passed is managed by review handoff/);

      await expect(
        store.mutate((state) =>
          updateTask(state, batchId, "T100", {
            status: "integrated",
          }),
        ),
      ).rejects.toThrow(/integrated is managed by guarded integration/);

      await expect(
        store.mutate((state) =>
          updateTask(state, batchId, "T100", {
            reviewedSha: "forged",
          }),
        ),
      ).rejects.toThrow(/reviewedSha is managed by review handoff/);

      await expect(
        store.mutate((state) =>
          updateTask(state, batchId, "T100", {
            reviewRound: 99,
          }),
        ),
      ).rejects.toThrow(/reviewRound is managed by review handoff/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires exact requested/reviewed/current SHA and an actionable PASS before integration", async () => {
    const { root, store, batchId, reviewerSessionId } =
      await fixture(["T100"]);
    try {
      const manager = createForgeReviewManager({ store });

      await expect(
        manager.requestReview({
          projectId: "P-1",
          batchId,
          taskId: "T100",
          reviewerSessionId,
          requestedSha: "wrong-sha",
        }),
      ).rejects.toThrow(/review sha must match task currentSha/);

      const requested = await manager.requestReview({
        projectId: "P-1",
        batchId,
        taskId: "T100",
        reviewerSessionId,
        requestedSha: "sha-T100",
      });
      expect(requested.round).toBe(1);
      expect(requested.requestedSha).toBe("sha-T100");

      await expect(
        manager.resolveReview(requested.id, {
          result: "passed",
          reviewedSha: "wrong-sha",
        }),
      ).rejects.toThrow(/reviewedSha must match review requestedSha/);

      const passed = await manager.resolveReview(requested.id, {
        result: "passed",
        reviewedSha: "sha-T100",
      });
      expect(passed.actionable).toBe(true);

      let state = await store.read();
      let task = state.batches[0]?.tasks[0];
      expect(task?.status).toBe("review_passed");
      expect(task?.reviewedSha).toBe("sha-T100");
      expect(task?.reviewRound).toBe(1);

      await expect(
        manager.integrateTask({
          projectId: "P-1",
          batchId,
          taskId: "T100",
          expectedSha: "wrong-sha",
        }),
      ).rejects.toThrow(/integration sha must match task currentSha/);

      const integrated = await manager.integrateTask({
        projectId: "P-1",
        batchId,
        taskId: "T100",
        expectedSha: "sha-T100",
      });
      expect(integrated.status).toBe("integrated");

      state = await store.read();
      task = state.batches[0]?.tasks[0];
      expect(task?.status).toBe("integrated");
      expect(state.batches[0]?.status).toBe("integrated");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("invalidates an old PASS and makes the task stale when currentSha changes", async () => {
    const { root, store, batchId, reviewerSessionId } =
      await fixture(["T100"]);
    try {
      const manager = createForgeReviewManager({ store });
      const requested = await manager.requestReview({
        projectId: "P-1",
        batchId,
        taskId: "T100",
        reviewerSessionId,
        requestedSha: "sha-T100",
      });
      await manager.resolveReview(requested.id, {
        result: "passed",
        reviewedSha: "sha-T100",
      });

      await store.mutate((state) =>
        updateTask(state, batchId, "T100", {
          currentSha: "sha-T100-v2",
        }),
      );

      const state = await store.read();
      const task = state.batches[0]?.tasks[0];
      const review = state.reviews.find(
        (item) => item.id === requested.id,
      );

      expect(task?.status).toBe("stale");
      expect(task?.reviewedSha).toBeNull();
      expect(review?.status).toBe("passed");
      expect(review?.actionable).toBe(false);
      expect(review?.invalidatedAt).not.toBeNull();

      await expect(
        manager.integrateTask({
          projectId: "P-1",
          batchId,
          taskId: "T100",
          expectedSha: "sha-T100",
        }),
      ).rejects.toThrow(/integration requires review_passed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records a late old-SHA PASS but cannot promote current task state", async () => {
    const { root, store, batchId, reviewerSessionId } =
      await fixture(["T100"]);
    try {
      const manager = createForgeReviewManager({ store });
      const requested = await manager.requestReview({
        projectId: "P-1",
        batchId,
        taskId: "T100",
        reviewerSessionId,
        requestedSha: "sha-T100",
      });

      await store.mutate((state) =>
        updateTask(state, batchId, "T100", {
          currentSha: "sha-T100-v2",
        }),
      );

      const resolved = await manager.resolveReview(requested.id, {
        result: "passed",
        reviewedSha: "sha-T100",
      });
      expect(resolved.status).toBe("passed");
      expect(resolved.actionable).toBe(false);

      const state = await store.read();
      const task = state.batches[0]?.tasks[0];
      expect(task?.currentSha).toBe("sha-T100-v2");
      expect(task?.status).not.toBe("review_passed");
      expect(task?.reviewedSha).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("moves actionable changes_requested to fixing", async () => {
    const { root, store, batchId, reviewerSessionId } =
      await fixture(["T100"]);
    try {
      const manager = createForgeReviewManager({ store });
      const requested = await manager.requestReview({
        projectId: "P-1",
        batchId,
        taskId: "T100",
        reviewerSessionId,
        requestedSha: "sha-T100",
      });
      const result = await manager.resolveReview(requested.id, {
        result: "changes_requested",
        reviewedSha: "sha-T100",
      });
      expect(result.actionable).toBe(true);

      const state = await store.read();
      expect(state.batches[0]?.tasks[0]?.status).toBe("fixing");
      expect(state.batches[0]?.tasks[0]?.reviewedSha).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


});
