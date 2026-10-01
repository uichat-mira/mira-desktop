import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/lib/request", () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

import { get, patch, post } from "@/shared/lib/request";
import { forgeApi } from "../client";

describe("Forge Desktop API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps product reads to stable /forge routes without /api or ports", async () => {
    vi.mocked(get).mockResolvedValue({ projectCount: 0 } as never);

    await forgeApi.getMeta();
    await forgeApi.listDispatches({ status: "running" });
    await forgeApi.getRuntimeSummary();
    await forgeApi.listBatches("P 1");
    await forgeApi.getInspector({ dispatchId: "D/1" });

    expect(get).toHaveBeenNthCalledWith(1, "/forge/meta");
    expect(get).toHaveBeenNthCalledWith(2, "/forge/dispatches", {
      params: { status: "running" },
    });
    expect(get).toHaveBeenNthCalledWith(3, "/forge/runtime/summary");
    expect(get).toHaveBeenNthCalledWith(4, "/forge/batches", {
      params: { projectId: "P 1" },
    });
    expect(get).toHaveBeenNthCalledWith(5, "/forge/inspector", {
      params: { dispatchId: "D/1" },
    });

    for (const call of vi.mocked(get).mock.calls) {
      const url = String(call[0]);
      expect(url.startsWith("/api/")).toBe(false);
      expect(url).not.toMatch(/:\d+/);
      expect(url).not.toContain("127.0.0.1");
    }
  });

  it("maps explicit task, dispatch and guarded review actions only", async () => {
    vi.mocked(post).mockResolvedValue({} as never);
    vi.mocked(patch).mockResolvedValue({} as never);

    await forgeApi.updateRepositoryTask("P/1", "T 1", {
      status: "DOING",
    });
    await forgeApi.dispatchTask("B/1", "T 1", {
      builder: "opencode",
      sourceThreadId: "MT-1",
    });
    await forgeApi.requestReview({
      projectId: "P-1",
      batchId: "B-1",
      taskId: "T100",
      reviewerSessionId: "S-review",
      requestedSha: "sha-1",
    });
    await forgeApi.integrateTask("B/1", "T 1", {
      projectId: "P-1",
      expectedSha: "sha-1",
    });

    expect(patch).toHaveBeenCalledWith(
      "/forge/projects/P%2F1/tasks/T%201",
      { status: "DOING" },
    );
    expect(post).toHaveBeenCalledWith(
      "/forge/batches/B%2F1/tasks/T%201/dispatch",
      {
        builder: "opencode",
        sourceThreadId: "MT-1",
      },
    );
    expect(post).toHaveBeenCalledWith("/forge/reviews", {
      projectId: "P-1",
      batchId: "B-1",
      taskId: "T100",
      reviewerSessionId: "S-review",
      requestedSha: "sha-1",
    });
    expect(post).toHaveBeenCalledWith(
      "/forge/batches/B%2F1/tasks/T%201/integrate",
      {
        projectId: "P-1",
        expectedSha: "sha-1",
      },
    );
    expect("updateRuntimeTask" in forgeApi).toBe(false);
    expect("patchTaskStatus" in forgeApi).toBe(false);
  });
});
