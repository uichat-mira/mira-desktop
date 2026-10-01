import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { readExtractTool } from "./read-extract.tool.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import {
  hasPythonOfficeTooling,
  resolveExternalToolingPython,
} from "@/test-support/external-tooling.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-read-extract-tool");

const createDocx = (filePath: string, text: string) => {
  execFileSync(
    resolveExternalToolingPython(),
    [
      "-c",
      [
        "from docx import Document",
        "import sys",
        "doc = Document()",
        "doc.add_paragraph(sys.argv[2])",
        "doc.save(sys.argv[1])",
      ].join(";"),
      filePath,
      text,
    ],
    { stdio: "ignore" },
  );
};

const createPptx = (filePath: string, text: string) => {
  execFileSync(
    resolveExternalToolingPython(),
    [
      "-c",
      [
        "from pptx import Presentation",
        "import sys",
        "prs = Presentation()",
        "slide = prs.slides.add_slide(prs.slide_layouts[5])",
        "slide.shapes.title.text = sys.argv[2]",
        "prs.save(sys.argv[1])",
      ].join(";"),
      filePath,
      text,
    ],
    { stdio: "ignore" },
  );
};

describe("read_extract tool", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("extracts text from workspace targets", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.txt"), "line1\nline2\nline3");
    const events: string[] = [];
    const artifacts: unknown[] = [];

    const result = await readExtractTool.execute({
      invocationId: "read-extract-1",
      args: {
        path: "notes.txt",
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

    expect((result.result as { type: string }).type).toBe("extract");
    expect((result.result as { slice: { text: string } }).slice.text).toContain("line2");
    expect(events[0]).toContain("Extract plan:");
    expect(events[0]).not.toContain("@");
    expect(artifacts).toHaveLength(1);
  });

  it.skipIf(!hasPythonOfficeTooling())("extracts office documents through CLI-first adapters", async () => {
    createDocx(path.join(tempRoot, "sample.docx"), "Hello Docx");
    createPptx(path.join(tempRoot, "sample.pptx"), "Hello Pptx");

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Name", "Value"], ["A", "1"]]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    XLSX.writeFile(workbook, path.join(tempRoot, "sample.xlsx"));

    const docxResult = await readExtractTool.execute({
      invocationId: "read-extract-2",
      args: { path: "sample.docx" },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "artifact-1", ...artifact };
      },
    });
    expect((docxResult.result as { source: { text: string } }).source.text).toContain("Hello Docx");

    const pptxResult = await readExtractTool.execute({
      invocationId: "read-extract-3",
      args: { path: "sample.pptx" },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "artifact-1", ...artifact };
      },
    });
    expect((pptxResult.result as { source: { text: string } }).source.text).toContain("Hello Pptx");

    const xlsxResult = await readExtractTool.execute({
      invocationId: "read-extract-4",
      args: { path: "sample.xlsx" },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "artifact-1", ...artifact };
      },
    });
    expect((xlsxResult.result as { source: { text: string } }).source.text).toContain("Sheet Sheet1");
  });
});
