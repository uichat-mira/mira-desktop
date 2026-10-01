import {
  createReviewHandoff,
  integrateReviewedTask,
  resolveReviewHandoff,
} from "../domain.js";
import type {
  ForgeReview,
  ForgeTask,
} from "../types.js";
import type { ForgeRuntimeStore } from "../runtime/store.js";

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(name + " is required");
  }
  return value.trim();
}

export interface RequestReviewInput {
  projectId?: unknown;
  batchId?: unknown;
  taskId?: unknown;
  reviewerSessionId?: unknown;
  requestedSha?: unknown;
}

export interface ResolveReviewInput {
  result?: unknown;
  reviewedSha?: unknown;
}

export interface IntegrateTaskInput {
  projectId?: unknown;
  batchId?: unknown;
  taskId?: unknown;
  expectedSha?: unknown;
}

export interface ForgeReviewManager {
  requestReview(input: RequestReviewInput): Promise<ForgeReview>;
  resolveReview(
    reviewId: unknown,
    input: ResolveReviewInput,
  ): Promise<ForgeReview>;
  integrateTask(input: IntegrateTaskInput): Promise<ForgeTask>;
}

export function createForgeReviewManager(input: {
  store: ForgeRuntimeStore;
}): ForgeReviewManager {
  const { store } = input;
  if (!store?.read || !store?.mutate) {
    throw new Error("store is required");
  }

  async function requestReview(
    request: RequestReviewInput,
  ): Promise<ForgeReview> {
    const projectId = requiredString(request.projectId, "projectId");
    const batchId = requiredString(request.batchId, "batchId");
    const taskId = requiredString(request.taskId, "taskId");
    const reviewerSessionId = requiredString(
      request.reviewerSessionId,
      "reviewerSessionId",
    );
    const requestedSha = requiredString(
      request.requestedSha,
      "requestedSha",
    );

    return store.mutate((state) =>
      structuredClone(
        createReviewHandoff(state, {
          projectId,
          batchId,
          taskId,
          reviewerSessionId,
          sha: requestedSha,
        }),
      ),
    );
  }

  async function resolveReview(
    reviewId: unknown,
    resolution: ResolveReviewInput,
  ): Promise<ForgeReview> {
    const id = requiredString(reviewId, "reviewId");
    return store.mutate((state) =>
      structuredClone(
        resolveReviewHandoff(state, id, {
          result: resolution.result,
          reviewedSha: resolution.reviewedSha,
        }),
      ),
    );
  }

  async function integrateTask(
    request: IntegrateTaskInput,
  ): Promise<ForgeTask> {
    const projectId = requiredString(request.projectId, "projectId");
    const batchId = requiredString(request.batchId, "batchId");
    const taskId = requiredString(request.taskId, "taskId");
    const expectedSha = requiredString(
      request.expectedSha,
      "expectedSha",
    );

    return store.mutate((state) =>
      structuredClone(
        integrateReviewedTask(state, {
          projectId,
          batchId,
          taskId,
          expectedSha,
        }),
      ),
    );
  }

  return {
    requestReview,
    resolveReview,
    integrateTask,
  };
}
