import { describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { readSliceTool } from "./read-slice.tool.js";

describe("read_slice tool", () => {
  it("slices text by requested lines", async () => {
    const events: string[] = [];
    const artifacts: unknown[] = [];

    const result = await readSliceTool.execute({
      invocationId: "read-slice-1",
      args: {
        text: "line1\nline2\nline3\nline4",
        startLine: 2,
        endLine: 3,
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event) {
        events.push(event.type === "invocation:progress" ? event.message : event.type);
      },
      addArtifact(artifact) {
        artifacts.push(artifact);
        return { id: "artifact-1", ...artifact };
      },
    });

    expect((result.structuredContent as { type: string }).type).toBe("slice");
    expect((result.structuredContent as { slice: { text: string } }).slice.text).toBe("line2\nline3");
    expect(events[0]).toContain("Slice plan:");
    expect(artifacts).toHaveLength(1);
  });
});
