import { describe, expect, it, vi } from "vitest";
import { githubIssueReadTool } from "./github-issue-read.tool.js";
import { githubIssueReadTool as baseGitHubIssueReadTool } from "./github-read.tool.js";

const createContext = (args: Record<string, unknown>) => ({
  invocationId: "github-issue-safe",
  args,
  signal: new AbortController().signal,
  pushEvent() {},
  addArtifact(artifact: { kind: "document" | "table"; title: string }) {
    return { id: "artifact", ...artifact };
  },
  trace: {
    startSpan() {
      return { spanId: "span", end() {} };
    },
  },
});

describe("constrained GitHub Issue reader", () => {
  it("turns free search text into title/body text instead of GitHub qualifiers", async () => {
    const executeSpy = vi
      .spyOn(baseGitHubIssueReadTool, "execute")
      .mockResolvedValue({ structuredContent: {} });

    await githubIssueReadTool.execute(
      createContext({
        repository: "dangjingtao/uichat-mira",
        query: 'crash "quoted" \\path repo:someone/private is:pr',
        assignee: "octocat",
        creator: "dangjingtao",
        updatedSince: "2026-07-01",
      }),
    );

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          repository: "dangjingtao/uichat-mira",
          query: "crash quoted path repo someone/private is pr in:title,body",
          assignee: "octocat",
          creator: "dangjingtao",
          updatedSince: "2026-07-01",
        }),
      }),
    );
  });

  it("rejects filters that could inject additional search qualifiers", async () => {
    expect(() =>
      githubIssueReadTool.execute(
        createContext({
          repository: "dangjingtao/uichat-mira",
          assignee: "octocat repo:someone/private",
        }),
      ),
    ).toThrow("assignee must be a valid GitHub login");

    expect(() =>
      githubIssueReadTool.execute(
        createContext({
          repository: "dangjingtao/uichat-mira",
          updatedSince: "yesterday repo:someone/private",
        }),
      ),
    ).toThrow("updatedSince must be a valid date");
  });
});
