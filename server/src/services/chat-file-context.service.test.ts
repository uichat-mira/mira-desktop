import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

process.env.UI_CHAT_ATTACHMENTS_DIR = path.resolve(
  process.cwd(),
  "../.test-artifact/chat-file-context",
);

const workspaceRoot = path.resolve(
  process.cwd(),
  "../.test-artifact/chat-file-workspace",
);

const { attachmentStorageRoot, attachmentStorageService } = await import(
  "./attachment-storage.service.js"
);
const {
  buildAgentAttachmentGoalContext,
  materializeAgentTaskFileAttachments,
  resolveMessagesForGenerate,
  selectAgentTaskFileParts,
} = await import("./chat-file-context.service.js");
const { chatFileContextNode } = await import("./chat-file-context.service.js");
const { removeFileAttachmentsRemovedFromParts } = await import(
  "./chat-file-context.service.js"
);

afterEach(async () => {
  await Promise.all([
    fs.rm(attachmentStorageRoot, { recursive: true, force: true }),
    fs.rm(workspaceRoot, { recursive: true, force: true }),
  ]);
});

describe("chat file context", () => {
  it("keeps the first context node as an identity transform", () => {
    expect(chatFileContextNode.process({ text: "original content" })).toBe(
      "original content",
    );
  });

  it("replaces the latest user file part with its complete parsed text for generation", async () => {
    const uploaded = await attachmentStorageService.save({
      buffer: Buffer.from("first line\nsecond line", "utf8"),
      mimeType: "text/plain",
      originalName: "notes.txt",
    });

    const messages = await resolveMessagesForGenerate([
      {
        role: "user",
        content: "Please read this",
        parts: [
          { type: "text", text: "Please read this" },
          {
            type: "file",
            filename: "notes.txt",
            data: uploaded.url,
            fileId: uploaded.id,
            mimeType: uploaded.contentType,
          },
        ],
      },
    ]);

    const parts = messages[0]?.parts ?? [];
    expect(parts.some((part) => part.type === "file")).toBe(false);
    const text = parts
      .filter((part): part is Extract<(typeof parts)[number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    expect(text).toContain("[文件: notes.txt]");
    expect(text).toContain("first line\nsecond line");
  });

  it("materializes the latest uploaded file inside the active workspace", async () => {
    const uploaded = await attachmentStorageService.save({
      buffer: Buffer.from("# Article\n\nHello Mira", "utf8"),
      mimeType: "text/markdown",
      originalName: "article.md",
    });
    const messages = [
      {
        role: "user" as const,
        content: "排成公众号 HTML",
        parts: [
          { type: "text" as const, text: "排成公众号 HTML" },
          {
            type: "file" as const,
            filename: "article.md",
            data: uploaded.url,
            fileId: uploaded.id,
            mimeType: uploaded.contentType,
          },
        ],
      },
    ];

    const materialized = await materializeAgentTaskFileAttachments({
      messages,
      workspaceRoot,
    });

    expect(materialized).toHaveLength(1);
    expect(materialized[0]?.relativePath).toBe(
      `.mira/staging/chat-attachments/${uploaded.id}/article.md`,
    );
    await expect(
      fs.readFile(materialized[0]!.absolutePath, "utf8"),
    ).resolves.toBe("# Article\n\nHello Mira");
    const goalContext = buildAgentAttachmentGoalContext(materialized);
    expect(goalContext).toContain(materialized[0]!.relativePath);
    expect(goalContext).toContain("canonical read");
    expect(goalContext).not.toContain("read_open");
    expect(goalContext).toContain(
      "真实命令、进程、git、build 或 test 才需要 terminal_session",
    );
  });

  it("reuses only the immediately preceding upload for a natural-language clarification reply", async () => {
    const uploaded = await attachmentStorageService.save({
      buffer: Buffer.from("article body", "utf8"),
      mimeType: "text/markdown",
      originalName: "article.md",
    });
    const originalUserMessage = {
      role: "user" as const,
      content: "把这篇文章排成公众号 HTML",
      parts: [
        { type: "text" as const, text: "把这篇文章排成公众号 HTML" },
        {
          type: "file" as const,
          filename: "article.md",
          data: uploaded.url,
          fileId: uploaded.id,
          mimeType: uploaded.contentType,
        },
      ],
    };

    const clarificationMessages = [
      originalUserMessage,
      {
        role: "assistant" as const,
        content: "请选择排版风格：终端暗黑、清爽简约、杂志暖调、学术规整？",
      },
      { role: "user" as const, content: "杂志暖调" },
    ];
    expect(selectAgentTaskFileParts(clarificationMessages)).toHaveLength(1);
    await expect(
      materializeAgentTaskFileAttachments({
        messages: clarificationMessages,
        workspaceRoot,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        filename: "article.md",
        relativePath: `.mira/staging/chat-attachments/${uploaded.id}/article.md`,
      }),
    ]);

    const switchedTaskMessages = [
      originalUserMessage,
      {
        role: "assistant" as const,
        content: "请选择排版风格？",
      },
      { role: "user" as const, content: "帮我写一封请假邮件" },
    ];
    expect(selectAgentTaskFileParts(switchedTaskMessages)).toEqual([]);
  });

  it("does not delete a file that remains attached when message metadata changes", async () => {
    const uploaded = await attachmentStorageService.save({
      buffer: Buffer.from("keep me", "utf8"),
      mimeType: "text/plain",
      originalName: "keep.txt",
    });
    const parts = [
      {
        type: "file",
        filename: "keep.txt",
        data: uploaded.url,
        fileId: uploaded.id,
        mimeType: uploaded.contentType,
      },
    ];

    removeFileAttachmentsRemovedFromParts(parts, parts);
    await expect(attachmentStorageService.read(uploaded.fileName)).resolves.toBeTruthy();

    removeFileAttachmentsRemovedFromParts(parts, []);
    await expect(attachmentStorageService.read(uploaded.fileName)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
