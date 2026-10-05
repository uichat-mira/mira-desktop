import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { clearHarnessRegistry } from "../../harness/registry.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { readTool } from "./read.tool.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "universal-read-tool");

const context = (args: Record<string, unknown>) => ({
  invocationId: "read-test",
  args,
  signal: new AbortController().signal,
  environment: createHarnessEnvironmentSnapshot(),
  pushEvent() {},
  addArtifact(artifact: any) {
    return { id: "artifact-1", ...artifact };
  },
});

describe("read tool", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearHarnessRegistry();
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearHarnessRegistry();
    clearWorkspaceSelection();
  });

  it("uses a small model-facing contract", () => {
    expect(readTool.definition.id).toBe("read");
    expect(readTool.definition.description).toContain("known file");
    expect(Object.keys(readTool.definition.inputSchema.properties ?? {})).toEqual([
      "path",
      "offset",
      "limit",
    ]);
  });

  it("reads a known file and reports continuation metadata", async () => {
    fs.writeFileSync(
      path.join(tempRoot, "large.txt"),
      Array.from({ length: 450 }, (_, index) => `line-${index + 1}`).join("\n"),
    );

    const result = await readTool.execute(context({ path: "large.txt" }));
    expect(result.structuredContent).toMatchObject({
      type: "read",
      path: "large.txt",
      offset: 0,
      limit: 400,
      returnedCount: 400,
      startLine: 1,
      endLine: 400,
      hasMore: true,
      truncated: true,
      nextOffset: 400,
    });
    expect(result.structuredContent).not.toHaveProperty("totalLines");
    const text = (result.structuredContent as { source: { text: string } }).source.text;
    expect(text).toContain("line-400");
    expect(text).not.toContain("line-401");
  });

  it("continues from offset without imposing a permanent result ceiling", async () => {
    fs.writeFileSync(
      path.join(tempRoot, "large.txt"),
      Array.from({ length: 450 }, (_, index) => `line-${index + 1}`).join("\n"),
    );

    const result = await readTool.execute(
      context({ path: "large.txt", offset: 400, limit: 100 }),
    );
    expect(result.structuredContent).toMatchObject({
      offset: 400,
      returnedCount: 50,
      totalLines: 450,
      startLine: 401,
      endLine: 450,
      hasMore: false,
      truncated: false,
    });
    const text = (result.structuredContent as { source: { text: string } }).source.text;
    expect(text).toContain("line-401");
    expect(text).toContain("line-450");
  });

  it("returns image content through canonical read without putting base64 in structuredContent", async () => {
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";
    fs.writeFileSync(
      path.join(tempRoot, "pixel.png"),
      Buffer.from(pngBase64, "base64"),
    );

    const result = await readTool.execute(context({ path: "pixel.png" }));

    expect(result.structuredContent).toEqual({
      type: "read",
      path: "pixel.png",
      mediaType: "image",
      mimeType: "image/png",
      sizeBytes: Buffer.from(pngBase64, "base64").byteLength,
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain(pngBase64);
    expect(result.content).toEqual([
      { type: "text", text: "Read image file: pixel.png" },
      {
        type: "image",
        data: pngBase64,
        mimeType: "image/png",
        filename: "pixel.png",
      },
    ]);
  });

  it("rejects image transport above Gemini's 20 MB baseline without reading it into model content", async () => {
    const target = path.join(tempRoot, "oversized.png");
    const fd = fs.openSync(target, "w");
    fs.ftruncateSync(fd, 20 * 1024 * 1024 + 1);
    fs.closeSync(fd);

    const result = await readTool.execute(context({ path: "oversized.png" }));
    expect(result.structuredContent).toMatchObject({
      type: "unsupported",
      path: "oversized.png",
      reason: "file_too_large",
      mimeType: "image/png",
      sizeBytes: 20 * 1024 * 1024 + 1,
      maxBytes: 20 * 1024 * 1024,
    });
    expect(result.content).toBeUndefined();
  });

  it("keeps SVG on the text read path like Gemini CLI", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Mira</text></svg>';
    fs.writeFileSync(path.join(tempRoot, "diagram.svg"), svg, "utf8");

    const result = await readTool.execute(context({ path: "diagram.svg" }));
    expect(result.structuredContent).toMatchObject({
      type: "read",
      path: "diagram.svg",
      source: {
        kind: "text",
        text: svg,
      },
    });
    expect(result.content).toBeUndefined();
  });

  it("routes Office-native files out of generic read without parsing them", async () => {
    fs.writeFileSync(path.join(tempRoot, "sample.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const result = await readTool.execute(context({ path: "sample.docx" }));
    expect(result.structuredContent).toMatchObject({
      type: "unsupported",
      path: "sample.docx",
      reason: "office_owned",
      fileType: "docx",
      suggestedSkill: "docx",
    });
  });

  it("decodes UTF-8 BOM and UTF-16LE text", async () => {
    fs.writeFileSync(
      path.join(tempRoot, "utf8-bom.txt"),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello bom", "utf8")]),
    );
    fs.writeFileSync(
      path.join(tempRoot, "utf16.txt"),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("你好 Mira", "utf16le")]),
    );

    const utf8 = await readTool.execute(context({ path: "utf8-bom.txt" }));
    expect(utf8.structuredContent).toMatchObject({
      source: { text: "hello bom", metadata: { encoding: "utf-8-bom" } },
    });

    const utf16 = await readTool.execute(context({ path: "utf16.txt" }));
    expect(utf16.structuredContent).toMatchObject({
      source: { text: "你好 Mira", metadata: { encoding: "utf-16le" } },
    });
  });

  it("decodes GB18030 text without mojibake", async () => {
    const expected = "这是 GBK/GB18030 编码内容，Mira 应该正确读取。";
    fs.writeFileSync(
      path.join(tempRoot, "gbk.txt"),
      iconv.encode(expected, "gb18030"),
    );

    const result = await readTool.execute(context({ path: "gbk.txt" }));
    expect(result.structuredContent).toMatchObject({
      type: "read",
      source: {
        text: expected,
        metadata: { encoding: "gb18030" },
      },
    });
  });

  it("returns a structured unsupported outcome for generic binary files", async () => {
    fs.writeFileSync(path.join(tempRoot, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const result = await readTool.execute(context({ path: "blob.bin" }));
    expect(result.structuredContent).toMatchObject({
      type: "unsupported",
      path: "blob.bin",
      reason: "binary",
    });
  });

  it("rejects invalid offset without nested selection protocol", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.txt"), "hello");
    await expect(readTool.execute(context({ path: "notes.txt", offset: -1 }))).rejects.toThrow(
      "offset must be a non-negative integer",
    );
  });
});
