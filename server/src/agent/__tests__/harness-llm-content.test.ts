import assert from "node:assert/strict";
import { test } from "vitest";
import {
  getHarnessLlmContentImages,
  getHarnessLlmContentText,
  projectHarnessContentForLlm,
  projectHarnessResultForLlm,
} from "@/harness/llm-content";
import {
  buildHarnessGenerateContextText,
} from "../nodes/harness-generate-context";
import {
  attachHarnessLlmContentToExecution,
} from "../nodes/harness-tool-result";
import type { AgentToolExecutionResult } from "../types";

const createExecution = (
  toolId: string,
  result: unknown,
): AgentToolExecutionResult => ({
  toolCallId: `${toolId}-call`,
  toolId,
  inputHash: `${toolId}-hash`,
  args: {},
  status: "completed",
  result,
  startedAt: "2026-07-18T00:00:00.000Z",
  finishedAt: "2026-07-18T00:00:01.000Z",
});

test("explicit text content remains plain model-facing text", () => {
  const content = projectHarnessContentForLlm([
    { type: "text", text: "line one\nline two" },
  ]);
  const text = getHarnessLlmContentText(content);

  assert.match(text, /line one\nline two/);
  assert.doesNotMatch(text, /\[\s*"line one/);
});

test("Harness preserves image blocks without serializing base64 into text", () => {
  const content = projectHarnessContentForLlm([
    { type: "text", text: "Read image file: pixel.png" },
    {
      type: "image",
      data: "BASE64_IMAGE_DATA",
      mimeType: "image/png",
      filename: "pixel.png",
    },
  ]);

  assert.match(getHarnessLlmContentText(content), /Read image file: pixel\.png/);
  assert.doesNotMatch(getHarnessLlmContentText(content), /BASE64_IMAGE_DATA/);
  assert.deepEqual(getHarnessLlmContentImages(content), [
    {
      type: "image",
      data: "BASE64_IMAGE_DATA",
      mimeType: "image/png",
      filename: "pixel.png",
    },
  ]);
});

test("read_list keeps all returned entries instead of the first five", () => {
  const result = {
    type: "list",
    path: ".",
    entries: Array.from({ length: 10 }, (_, index) => ({
      name: `file-${index + 1}.md`,
      type: "file",
    })),
  };

  const content = projectHarnessResultForLlm(result);
  const text = getHarnessLlmContentText(content);

  assert.match(text, /file-1\.md/);
  assert.match(text, /file-10\.md/);
  assert.equal(content?.truncated, false);
});

test("the real mail_query shape preserves all twenty messages with fair item budgets", () => {
  const result = {
    sync: {
      requested: "none",
      performed: false,
      status: "skipped",
      syncedCount: 0,
      lastSyncedAt: null,
      error: null,
    },
    items: Array.from({ length: 20 }, (_, index) => ({
      id: `mail-${index + 1}`,
      subject: `Subject ${index + 1}`,
      from: { name: `Sender ${index + 1}`, address: `sender-${index + 1}@example.com` },
      previewText: `${`Long preview ${index + 1} `.repeat(200)}END-${index + 1}`,
      receivedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      isRead: false,
      isFlagged: index === 19,
      hasAttachments: false,
      attachments: [],
    })),
    total: 111,
    nextCursor: "next-page",
  };

  const content = projectHarnessResultForLlm(result);
  const text = getHarnessLlmContentText(content);

  assert.equal(content?.collectionPath, "items");
  assert.equal(content?.collectionItemCount, 20);
  assert.match(text, /Subject 1/);
  assert.match(text, /Subject 20/);
  assert.match(text, /sender-20@example\.com/);
  assert.match(text, /\[20\/20\]/);
});

test("read_extract and read_slice content survives without result-type special cases", () => {
  const extractText = getHarnessLlmContentText(
    projectHarnessResultForLlm({
      type: "extract",
      path: "report.pdf",
      slice: { text: "Extracted final paragraph", startLine: 1, endLine: 8 },
    }),
  );
  const sliceText = getHarnessLlmContentText(
    projectHarnessResultForLlm({
      type: "slice",
      slice: { text: "Requested source window", startLine: 20, endLine: 30 },
    }),
  );

  assert.match(extractText, /Extracted final paragraph/);
  assert.match(sliceText, /Requested source window/);
});

test("unknown future Harness tools still receive a faithful bounded projection", () => {
  const text = getHarnessLlmContentText(
    projectHarnessResultForLlm({
      type: "future_tool_result",
      records: [
        { id: "alpha", value: "first" },
        { id: "omega", value: "last" },
      ],
    }),
  );

  assert.match(text, /future_tool_result/);
  assert.match(text, /omega/);
  assert.match(text, /last/);
});

test("oversized terminal output is visibly bounded rather than silently previewed", () => {
  const content = projectHarnessResultForLlm(
    {
      command: "pnpm test",
      stdout: `BEGIN-${"x".repeat(30_000)}-END`,
      stderr: "",
      exitCode: 0,
      timedOut: false,
    },
    4_000,
  );
  const text = getHarnessLlmContentText(content);

  assert.equal(content?.truncated, true);
  assert.match(text, /Harness result truncated by LLM budget/);
  assert.match(text, /originalCharCount=/);
});

test("tool execution retains llmContent through the Evidence payload", () => {
  const execution = createExecution("read_list", {
    type: "list",
    path: ".",
    entries: Array.from({ length: 10 }, (_, index) => ({
      name: `document-${index + 1}.md`,
      type: "file",
    })),
  });

  const enriched = attachHarnessLlmContentToExecution(execution);
  const context = buildHarnessGenerateContextText(enriched ? [enriched] : []);

  assert.ok(enriched && "llmContent" in enriched);
  assert.match(context ?? "", /document-10\.md/);
  assert.match(context ?? "", /不是 Evidence 摘要或前几项预览/);
});
