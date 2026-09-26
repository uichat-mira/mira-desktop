import { describe, expect, it, vi } from "vitest";
import { checkGithubTagUpdate, compareVersions } from "./githubUpdate";

describe("githubUpdate", () => {
  it("compares stable and prerelease semantic versions", () => {
    expect(compareVersions("1.0.0", "0.99.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBeGreaterThan(0);
  });

  it("selects the highest semantic GitHub tag", async () => {
    const fetchTags = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { name: "nightly" },
        { name: "v0.99.0" },
        { name: "v1.0.0" },
        { name: "v0.100.0" },
      ],
    });

    await expect(
      checkGithubTagUpdate(
        "https://github.com/uichat-mira/mira-desktop.git",
        "0.99.0",
        fetchTags,
      ),
    ).resolves.toEqual({
      currentVersion: "0.99.0",
      latestVersion: "1.0.0",
      latestTag: "v1.0.0",
      tagUrl: "https://github.com/uichat-mira/mira-desktop/tree/v1.0.0",
      updateAvailable: true,
    });
    expect(fetchTags).toHaveBeenCalledWith(
      "https://api.github.com/repos/uichat-mira/mira-desktop/tags?per_page=100",
      { cache: "no-store" },
    );
  });

  it("reports GitHub request failures", async () => {
    const fetchTags = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    await expect(
      checkGithubTagUpdate(
        "https://github.com/dangjingtao/uichat-mira",
        "0.99.0",
        fetchTags,
      ),
    ).rejects.toThrow("GitHub Tag 查询失败（HTTP 403）");
  });

  it("reports no update when the latest tag matches the app version", async () => {
    const fetchTags = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ name: "v0.99.0" }, { name: "v0.98.0" }],
    });

    const result = await checkGithubTagUpdate(
      "https://github.com/dangjingtao/uichat-mira",
      "0.99.0",
      fetchTags,
    );

    expect(result.updateAvailable).toBe(false);
    expect(result.latestTag).toBe("v0.99.0");
  });
});
