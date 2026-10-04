import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { readOpenTool } from "./read-open.tool.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { getDefaultSkillContextProvider } from "@/skills/context/index.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-read-open-tool");
const skillRoot = createTimestampedTestArtifactPath("skills", "rag-demo-read-open-skill");

describe("read_open tool", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "notes.log"), "hello read open");
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(skillRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    delete process.env.MIRA_SKILLS_ROOT;
    getDefaultSkillContextProvider().invalidate();
    clearWorkspaceSelection();
  });

  it("opens workspace files", async () => {
    const artifacts: unknown[] = [];
    const events: string[] = [];

    const result = await readOpenTool.execute({
      invocationId: "read-open-1",
      args: { path: "notes.log" },
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

    expect((result.structuredContent as { type: string }).type).toBe("open");
    expect((result.structuredContent as { source: { text: string } }).source.text).toContain("hello read open");
    expect(artifacts).toHaveLength(1);
    expect(events[0]).toContain("Read plan:");
    expect(events[0]).not.toContain("@");
  });

  it("opens a read-only skill resource URI", async () => {
    const xlsxRoot = path.join(skillRoot, "xlsx");
    fs.mkdirSync(path.join(xlsxRoot, "reference"), { recursive: true });
    fs.writeFileSync(
      path.join(xlsxRoot, "SKILL.md"),
      "---\nname: xlsx\ndescription: Spreadsheet skill\n---\n# Routing\nUse references on demand.",
      "utf8",
    );
    fs.writeFileSync(
      path.join(xlsxRoot, "reference", "DCF_SKILL.md"),
      "# DCF\nKeep valuation formula-linked and auditable.",
      "utf8",
    );
    process.env.MIRA_SKILLS_ROOT = skillRoot;
    getDefaultSkillContextProvider().invalidate();

    const artifacts: unknown[] = [];
    const events: string[] = [];
    const result = await readOpenTool.execute({
      invocationId: "read-open-skill-1",
      // Simulates the form produced after generic workspace path normalization
      // collapses the double slash in a URI-like path.
      args: { path: "skill:/xlsx/reference/DCF_SKILL.md" },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event) {
        events.push(event.type === "invocation:progress" ? event.message : event.type);
      },
      addArtifact(artifact) {
        artifacts.push(artifact);
        return { id: "artifact-skill-1", ...artifact };
      },
    });

    const opened = result.structuredContent as {
      path: string;
      source: { text: string; metadata: Record<string, unknown> };
    };
    expect(opened.path).toBe("skill://xlsx/reference/DCF_SKILL.md");
    expect(opened.source.text).toContain("formula-linked");
    expect(opened.source.metadata).toMatchObject({
      scheme: "skill",
      skillId: "xlsx",
      resourceKind: "reference",
    });
    expect(artifacts).toHaveLength(1);
    expect(events[0]).toContain("skill-resource");
  });

  it("keeps the compatibility alias behavior through read", async () => {
    const { readTool } = await import("./read.tool.js");
    const result = await readTool.execute({
      invocationId: "read-open-alias-1",
      args: { path: "notes.log" },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "artifact-1", ...artifact };
      },
    });

    expect((result.structuredContent as { type: string }).type).toBe("open");
  });

  it("opens a declared line selection", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.log"), "one\ntwo\nthree");
    const result = await readOpenTool.execute({
      invocationId: "read-open-selection-1",
      args: { path: "notes.log", selection: { kind: "lines", start: 2, end: 2 } },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) { return { id: "artifact-1", ...artifact }; },
    });
    expect((result.structuredContent as { source: { text: string } }).source.text).toBe("two");
    expect((result.structuredContent as { operation: string }).operation).toBe("extract");
  });

  it("rejects unsupported selection kinds", async () => {
    await expect(readOpenTool.execute({
      invocationId: "read-open-selection-2",
      args: { path: "notes.log", selection: { kind: "pages", start: 1, end: 2 } },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) { return { id: "artifact-1", ...artifact }; },
    })).rejects.toThrow("selection.kind must be one of: lines, range");
  });
});
