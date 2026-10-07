import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { CanonicalMessageCleanupService } from "./canonical-message-cleanup.service.js";

const createRepository = () => ({
  listPending: () => [],
  countFailed: () => 0,
  remove: () => true,
  scheduleRetry: () => true,
  markFailed: () => true,
});

test("cleanup drain contains repository failures and resets for the next poll", () => {
  const repository = createRepository();
  repository.listPending = () => {
    throw new Error("injected cleanup repository failure");
  };
  const service = new CanonicalMessageCleanupService({ repository });
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    assert.deepEqual(service.drainOnce(), {
      completed: 0,
      retried: 0,
      failed: 0,
    });
    assert.equal(
      errorSpy.mock.calls.some(
        ([message]) => message === "[canonical-cleanup] drain failed",
      ),
      true,
    );

    repository.listPending = () => [];
    assert.deepEqual(service.drainOnce(), {
      completed: 0,
      retried: 0,
      failed: 0,
    });
  } finally {
    errorSpy.mockRestore();
  }
});

test("cleanup worker startup contains failed-backlog lookup errors", () => {
  const repository = createRepository();
  repository.countFailed = () => {
    throw new Error("injected cleanup backlog failure");
  };
  const service = new CanonicalMessageCleanupService({
    repository,
    pollIntervalMs: 60_000,
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    assert.doesNotThrow(() => service.start());
    assert.equal(
      errorSpy.mock.calls.some(
        ([message]) => message === "[canonical-cleanup] failed backlog check",
      ),
      true,
    );
  } finally {
    service.stop();
    errorSpy.mockRestore();
  }
});
