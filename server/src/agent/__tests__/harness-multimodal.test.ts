import assert from "node:assert/strict";
import { test } from "vitest";
import {
  appendHarnessImagesToLatestUserMessage,
  projectHarnessImagesToMessageParts,
} from "../harness-multimodal";

test("Harness image blocks project into Mira's existing image message contract", () => {
  assert.deepEqual(
    projectHarnessImagesToMessageParts({
      version: 1,
      source: "harness_result",
      blocks: [
        {
          type: "image",
          data: "YWJj",
          mimeType: "image/png",
          filename: "tool.png",
        },
      ],
      truncated: false,
      originalCharCount: 0,
      includedCharCount: 0,
      omittedArrayItems: 0,
      omittedObjectKeys: 0,
    }),
    [
      {
        type: "image",
        image: "data:image/png;base64,YWJj",
        filename: "tool.png",
        mediaType: "image/png",
      },
    ],
  );
});

test("Tool images attach only to the latest user message and preserve existing parts", () => {
  const messages = [
    {
      role: "user" as const,
      content: "old",
      parts: [
        { type: "text" as const, text: "old" },
        {
          type: "image" as const,
          image: "data:image/png;base64,T0xE",
          filename: "old.png",
          mediaType: "image/png",
        },
      ],
    },
    {
      role: "assistant" as const,
      content: "ok",
      parts: [{ type: "text" as const, text: "ok" }],
    },
    {
      role: "user" as const,
      content: "inspect",
      parts: [
        { type: "text" as const, text: "inspect" },
        {
          type: "file" as const,
          filename: "notes.txt",
          data: "data:text/plain;base64,bm90ZXM=",
          mimeType: "text/plain",
        },
      ],
    },
  ];

  const result = appendHarnessImagesToLatestUserMessage(messages, [
    {
      type: "image",
      image: "data:image/png;base64,TkVX",
      filename: "tool.png",
      mediaType: "image/png",
    },
  ]);

  assert.deepEqual(result[0], messages[0]);
  assert.deepEqual(result[2]?.parts, [
    ...messages[2]!.parts!,
    {
      type: "image",
      image: "data:image/png;base64,TkVX",
      filename: "tool.png",
      mediaType: "image/png",
    },
  ]);
});
