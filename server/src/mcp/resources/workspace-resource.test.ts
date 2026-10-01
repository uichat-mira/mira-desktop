import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { workspaceResource } from "./workspace-resource.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { hasExternalDocumentTooling } from "@/test-support/external-tooling.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-mcp-read");

const createDocx = (filePath: string, text: string) => {
  execFileSync(
    "python",
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
    "python",
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

describe("workspace resource", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
  });

  it("reads directories and text files", async () => {
    fs.mkdirSync(path.join(tempRoot, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "docs", "a.txt"), "hello");
    fs.writeFileSync(path.join(tempRoot, "docs", "app.log"), "line one\nline two");
    fs.writeFileSync(path.join(tempRoot, "docs", "notes"), "plain text without extension");

    const dirEvents: string[] = [];
    const dirResult = await workspaceResource.read!({
      args: { path: "docs" },
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event) {
        dirEvents.push(event.type === "invocation:progress" ? event.message : event.type);
      },
    });
    expect((dirResult.contents as { type: string }).type).toBe("list");
    expect((dirResult.contents as { entries: Array<{ name: string; type: string }> }).entries[0]).toMatchObject({
      name: "a.txt",
      type: "file",
    });
    expect(dirEvents[0]).toContain("Directory listing plan");

    const fileEvents: string[] = [];
    const fileResult = await workspaceResource.read!({
      args: { path: "docs/a.txt" },
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event) {
        fileEvents.push(event.type === "invocation:progress" ? event.message : event.type);
      },
    });
    expect((fileResult.contents as { source: { text: string } }).source.text).toContain("hello");
    expect((fileResult.contents as { source: { metadata: { readerStrategy: string } } }).source.metadata.readerStrategy).toBe(
      "text-known-extension",
    );
    expect(fileEvents[0]).toContain("Read plan:");

    const logResult = await workspaceResource.read!({
      args: { path: "docs/app.log" },
      environment: createHarnessEnvironmentSnapshot(),
    });
    expect((logResult.contents as { source: { text: string } }).source.text).toContain("line one");
    expect((logResult.contents as { source: { metadata: { readerStrategy: string } } }).source.metadata.readerStrategy).toBe(
      "text-known-extension",
    );

    const extensionlessResult = await workspaceResource.read!({
      args: { path: "docs/notes" },
      environment: createHarnessEnvironmentSnapshot(),
    });
    expect((extensionlessResult.contents as { source: { text: string } }).source.text).toContain(
      "plain text without extension",
    );
    expect(
      (extensionlessResult.contents as { source: { metadata: { readerStrategy: string } } }).source.metadata
        .readerStrategy,
    ).toBe("text-content-probe");
  });

  it("returns a binary summary for unsupported binary files", async () => {
    fs.writeFileSync(path.join(tempRoot, "blob.bin"), Buffer.from([0, 159, 146, 150, 1, 2, 3]));

    const result = await workspaceResource.read!({
      args: { path: "blob.bin" },
      environment: createHarnessEnvironmentSnapshot(),
    });
    expect((result.contents as { source: { text: string } }).source.text).toContain(
      "Binary file preview is not available",
    );
    expect((result.contents as { source: { metadata: { binary: boolean } } }).source.metadata.binary).toBe(true);
    expect((result.contents as { source: { metadata: { readerStrategy: string } } }).source.metadata.readerStrategy).toBe(
      "binary-summary",
    );
  });

  it.skipIf(!hasExternalDocumentTooling())("reads docx, pptx and xlsx files", async () => {
    createDocx(path.join(tempRoot, "sample.docx"), "Hello Docx");
    createPptx(path.join(tempRoot, "sample.pptx"), "Hello Pptx");

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Name", "Value"], ["A", "1"]]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    XLSX.writeFile(workbook, path.join(tempRoot, "sample.xlsx"));

    const docxResult = await workspaceResource.read!({
      args: { path: "sample.docx" },
      environment: createHarnessEnvironmentSnapshot(),
    });
    expect((docxResult.contents as { source: { text: string } }).source.text).toContain("Hello Docx");
    expect((docxResult.contents as { source: { metadata: { readerStrategy: string } } }).source.metadata.readerStrategy).toBe(
      "docx-cli-extract",
    );

    const pptxResult = await workspaceResource.read!({
      args: { path: "sample.pptx" },
      environment: createHarnessEnvironmentSnapshot(),
    });
    expect((pptxResult.contents as { source: { text: string } }).source.text).toContain("Hello Pptx");
    expect((pptxResult.contents as { source: { metadata: { readerStrategy: string } } }).source.metadata.readerStrategy).toBe(
      "pptx-cli-extract",
    );

    const xlsxResult = await workspaceResource.read!({
      args: { path: "sample.xlsx" },
      environment: createHarnessEnvironmentSnapshot(),
    });
    expect((xlsxResult.contents as { source: { text: string } }).source.text).toContain("Sheet Sheet1");
    expect((xlsxResult.contents as { source: { metadata: { readerStrategy: string } } }).source.metadata.readerStrategy).toBe(
      "xlsx-cli-extract",
    );
  });

  it("rejects missing paths", async () => {
    await expect(
      workspaceResource.read!({
        args: { path: "missing.txt" },
        environment: createHarnessEnvironmentSnapshot(),
      }),
    ).rejects.toThrow("Path does not exist");
  });

  it("rejects reads when harness environment is missing", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.txt"), "hello");

    await expect(workspaceResource.read!({ args: { path: "notes.txt" } })).rejects.toThrow(
      "Read execution requires a harness environment snapshot",
    );
  });
});
