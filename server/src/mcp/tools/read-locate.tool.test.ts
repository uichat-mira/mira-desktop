import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { readLocateTool } from "./read-locate.tool.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-read-locate-tool");

describe("read_locate tool", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tempRoot, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "docs", "notes.log"), "alpha beta gamma");
    fs.writeFileSync(path.join(tempRoot, "docs", "guide.md"), "project guide");
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("locates files by path pattern", async () => {
    const events: string[] = [];

    const result = await readLocateTool.execute({
      invocationId: "read-locate-1",
      args: {
        query: "notes",
        searchMode: "path",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot({
        read: {
          capabilities: [
            {
              id: "fast-glob-locate",
              kind: "locate",
              provider: "fast-glob",
              available: true,
              priority: 100,
            },
          ],
        },
      }),
      pushEvent(event) {
        events.push(event.type === "invocation:progress" ? event.message : event.type);
      },
      addArtifact(artifact) {
        return { id: "artifact-1", ...artifact };
      },
    });

    const matches = (result.structuredContent as { matches: Array<{ path: string; matchType: string }> }).matches;
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "docs/notes.log",
          matchType: "path",
        }),
      ]),
    );
    expect(events[0]).toContain("Locate plan:");
    expect(events[0]).not.toContain("@");
  });

  it("locates content using the node scan fallback chain", async () => {
    const longPreviewLine =
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega";
    fs.writeFileSync(path.join(tempRoot, "docs", "long-preview.txt"), longPreviewLine);

    const result = await readLocateTool.execute({
      invocationId: "read-locate-2",
      args: {
        query: "beta",
        searchMode: "content",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot({
        read: {
          capabilities: [
            {
              id: "node-content-scan-locate",
              kind: "locate",
              provider: "node-fs",
              available: true,
              priority: 100,
            },
          ],
        },
      }),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "artifact-1", ...artifact };
      },
    });

    const matches = (result.structuredContent as { matches: Array<{ path: string; matchType: string; preview?: string }> }).matches;
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "docs/notes.log",
          matchType: "content",
        }),
        expect.objectContaining({
          path: "docs/long-preview.txt",
          matchType: "content",
        }),
      ]),
    );
    expect(matches[0]?.preview).toContain("alpha beta gamma");
    const longPreviewMatch = matches.find((match) => match.path === "docs/long-preview.txt");
    expect(longPreviewMatch?.preview?.length).toBeLessThanOrEqual(120);
    expect(longPreviewMatch?.preview).toContain("...");
  });

  it("rejects missing query", async () => {
    await expect(
      readLocateTool.execute({
        invocationId: "read-locate-3",
        args: {},
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "artifact-1", ...artifact };
        },
      }),
    ).rejects.toThrow("query is required");
  });
});
