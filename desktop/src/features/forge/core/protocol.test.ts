import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgeApi } from "@/shared/api/forge";
import { DesktopForgeProtocol } from "./protocol";

vi.mock("@/shared/api/forge", () => ({
  forgeApi: {
    listBatches: vi.fn(),
    listDispatches: vi.fn(),
    listReviews: vi.fn(),
    listThreads: vi.fn(),
    getEvents: vi.fn(),
    inspectTaskSource: vi.fn(),
    getReadiness: vi.fn(),
    getThread: vi.fn(),
  },
}));

describe("DesktopForgeProtocol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(forgeApi.listBatches).mockResolvedValue([
      {
        id: "B-1",
        projectId: "P-1",
        name: "Batch",
        status: "active",
        baseSha: null,
        tasks: [],
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
      },
    ]);
    vi.mocked(forgeApi.listDispatches).mockResolvedValue([]);
    vi.mocked(forgeApi.listReviews).mockResolvedValue([]);
    vi.mocked(forgeApi.listThreads).mockResolvedValue([]);
    vi.mocked(forgeApi.getEvents).mockResolvedValue([]);
    vi.mocked(forgeApi.inspectTaskSource).mockResolvedValue({
      kind: "repository-markdown",
      ledgerRef: "TASKS.md",
      taskDirRef: "docs/tasks",
      tasks: [],
    });
  });

  it("keeps readiness request failures instead of silently discarding them", async () => {
    vi.mocked(forgeApi.getReadiness).mockRejectedValueOnce(
      new Error("readiness endpoint unavailable"),
    );

    const data = await new DesktopForgeProtocol().loadProject("P-1");

    expect(data.readiness).toEqual([]);
    expect(data.readinessFailures).toEqual([
      {
        batchId: "B-1",
        error: "readiness endpoint unavailable",
      },
    ]);
  });
});
