import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../harness/environment.js";
import {
  buildReadStrategies,
  listDirectory,
  readStructuredDocument,
} from "./document-readers.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { hasExternalDocumentTooling } from "@/test-support/external-tooling.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-document-readers");

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

const createPdf = (filePath: string, text: string) => {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const chunks = [
    "%PDF-1.4\n",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${`BT\n/F1 24 Tf\n72 72 Td\n(${escaped}) Tj\nET\n`.length} >>\nstream\nBT\n/F1 24 Tf\n72 72 Td\n(${escaped}) Tj\nET\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let offset = 0;
  const offsets = ["0000000000 65535 f \n"];
  for (const chunk of chunks) {
    offset += Buffer.byteLength(chunk, "utf8");
    if (offsets.length < chunks.length) {
      offsets.push(`${String(offset - Buffer.byteLength(chunk, "utf8")).padStart(10, "0")} 00000 n \n`);
    }
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""), "utf8");
  const content =
    chunks.join("") +
    `xref\n0 6\n${offsets.join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  fs.writeFileSync(filePath, content);
};

describe("document readers", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("uses the known-text strategy for common text files", async () => {
    const targetPath = path.join(tempRoot, "server.log");
    fs.writeFileSync(targetPath, "alpha\nbeta");

    const result = await readStructuredDocument(createHarnessEnvironmentSnapshot(), targetPath);
    expect(result.text).toContain("alpha");
    expect(result.metadata.readerStrategy).toBe("text-known-extension");
  });

  it("falls back to content probing for extensionless text files", async () => {
    const targetPath = path.join(tempRoot, "README");
    fs.writeFileSync(targetPath, "plain text without an extension");

    const result = await readStructuredDocument(createHarnessEnvironmentSnapshot(), targetPath);
    expect(result.text).toContain("plain text without an extension");
    expect(result.metadata.readerStrategy).toBe("text-content-probe");
    expect(result.metadata.detectedBy).toBe("content-probe");
  });

  it("falls back to binary summary when the text probe rejects the buffer", async () => {
    const targetPath = path.join(tempRoot, "blob.dat");
    fs.writeFileSync(targetPath, Buffer.from([0, 159, 146, 150, 1, 2, 3]));

    const result = await readStructuredDocument(createHarnessEnvironmentSnapshot(), targetPath);
    expect(result.text).toContain("Binary file preview is not available");
    expect(result.metadata.readerStrategy).toBe("binary-summary");
    expect(result.metadata.binary).toBe(true);
  });

  it.skipIf(!hasExternalDocumentTooling())("uses structured readers for office documents", async () => {
    const docxPath = path.join(tempRoot, "sample.docx");
    createDocx(docxPath, "Hello Docx");

    const xlsxPath = path.join(tempRoot, "sample.xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Name", "Value"], ["A", "1"]]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    XLSX.writeFile(workbook, xlsxPath);
    const pdfPath = path.join(tempRoot, "sample.pdf");
    createPdf(pdfPath, "Hello Pdf");

    const docxResult = await readStructuredDocument(createHarnessEnvironmentSnapshot(), docxPath);
    expect(docxResult.text).toContain("Hello Docx");
    expect(docxResult.metadata.readerStrategy).toBe("docx-cli-extract");

    const pdfResult = await readStructuredDocument(createHarnessEnvironmentSnapshot(), pdfPath);
    expect(pdfResult.text).toContain("Hello Pdf");
    expect(pdfResult.metadata.readerStrategy).toBe("pdf-cli-extract");

    const xlsxResult = await readStructuredDocument(createHarnessEnvironmentSnapshot(), xlsxPath);
    expect(xlsxResult.text).toContain("Sheet Sheet1");
    expect(xlsxResult.metadata.readerStrategy).toBe("xlsx-cli-extract");
  });

  it("lists directory entries with stable ordering and metadata", () => {
    fs.mkdirSync(path.join(tempRoot, "z-dir"));
    fs.writeFileSync(path.join(tempRoot, "b.txt"), "b");
    fs.writeFileSync(path.join(tempRoot, "a.txt"), "a");

    const entries = listDirectory(createHarnessEnvironmentSnapshot(), tempRoot);
    expect(entries.map((entry) => entry.name)).toEqual(["z-dir", "a.txt", "b.txt"]);
    expect(entries[0]).toMatchObject({
      type: "directory",
      listingStrategy: "node-fs-directory",
    });
    expect(entries[1]).toMatchObject({
      type: "file",
      sizeBytes: 1,
    });
    expect(typeof entries[1]?.modifiedAt).toBe("string");
  });

  it("builds the read chain from harness capabilities instead of local hardcoding", () => {
    const environment = createHarnessEnvironmentSnapshot({
      read: {
        capabilities: [
          {
            id: "binary-summary",
            kind: "fallback",
            provider: "node-fs",
            available: true,
            priority: 200,
          },
          {
            id: "text-known-extension",
            kind: "text",
            provider: "node-fs",
            available: true,
            priority: 50,
          },
        ],
      },
    });

    const strategies = buildReadStrategies(environment);
    expect(strategies.map((strategy) => strategy.id)).toEqual([
      "binary-summary",
      "text-known-extension",
    ]);
  });

  it("rejects reads without a harness environment snapshot", async () => {
    const targetPath = path.join(tempRoot, "server.log");
    fs.writeFileSync(targetPath, "alpha\nbeta");

    await expect(readStructuredDocument(undefined, targetPath)).rejects.toThrow(
      "Read execution requires a harness environment snapshot",
    );
  });
});
