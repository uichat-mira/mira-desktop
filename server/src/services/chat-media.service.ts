import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chatMediaRepository, type ChatMediaType } from "@/db/repositories/chat-media.repository.js";
import { imageGenerationJobsRepository } from "@/db/repositories/image-generation-jobs.repository.js";
import { ttsSynthesisJobsRepository } from "@/db/repositories/tts-synthesis-jobs.repository.js";
import { messageRepository, threadRepository } from "@/db/repositories/thread.repository.js";
import { getSqlite } from "@/db/index.js";

let roots: string[] = [];

const mediaMetadataKey = (mediaType: ChatMediaType) => mediaType === "audio" ? "tts" : "image";
const parseMetadata = (value: string | null | undefined): Record<string, unknown> => {
  try { return JSON.parse(value || "{}") as Record<string, unknown>; } catch { return {}; }
};

const isWithinRoot = (candidate: string, root: string) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const validatePath = (value: string) => {
  if (!path.isAbsolute(value)) throw new Error("Media path must be absolute.");
  const resolved = path.resolve(value);
  if (!roots.some((root) => isWithinRoot(resolved, root))) throw new Error("Media path is outside the managed media roots.");
  return resolved;
};

export const chatMediaService = {
  configureRoots(input: { imageGenerationRoot: string; ttsRoot: string }) {
    roots = [input.imageGenerationRoot, input.ttsRoot].map((root) => path.resolve(root));
  },
  async attach(input: { threadId: string; messageId: string; taskId: string; mediaType: ChatMediaType; absolutePath: string; mimeType: string }) {
    const thread = threadRepository.findById(input.threadId);
    const message = messageRepository.findById(input.messageId);
    if (!thread || !message || message.threadId !== input.threadId || message.role !== "assistant") throw new Error("Media must be attached to an existing assistant message.");
    const audioTask = input.mediaType === "audio" ? ttsSynthesisJobsRepository.getById(input.taskId) : null;
    const imageTask = input.mediaType === "image" ? await imageGenerationJobsRepository.getById(input.taskId) : null;
    const task = audioTask ?? imageTask;
    if (!task) throw new Error("Media task was not found.");
    if (task.status !== "succeeded") throw new Error("Media task must be succeeded before it can be attached.");
    const absolutePath = validatePath(input.absolutePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) throw new Error("Media file does not exist.");
    const expectedPath = audioTask
      ? audioTask.outputPath
      : imageTask?.artifacts.find((artifact) => artifact.localPath === absolutePath)?.localPath;
    const expectedMimeType = audioTask
      ? audioTask.mimeType
      : imageTask?.artifacts.find((artifact) => artifact.localPath === absolutePath)?.mimeType;
    if (expectedPath !== absolutePath || expectedMimeType !== input.mimeType) throw new Error("Media does not match the task artifact.");
    const metadata = parseMetadata(message.metadata);
    const media = (metadata.media && typeof metadata.media === "object" && !Array.isArray(metadata.media))
      ? { ...(metadata.media as Record<string, unknown>) } : {};
    const recordInput = { id: randomUUID(), ...input, absolutePath };
    let record: ReturnType<typeof chatMediaRepository.create> | null = null;
    getSqlite().transaction(() => {
      const created = chatMediaRepository.create(recordInput);
      record = created;
      const updated = messageRepository.updateById(message.id, { metadata: JSON.stringify({ ...metadata, media: { ...media, [mediaMetadataKey(input.mediaType)]: { status: "succeeded", mediaId: created.id, jobId: input.taskId, absolutePath, mimeType: input.mimeType } } }) });
      if (!updated) throw new Error("Failed to update assistant message metadata.");
    })();
    if (!record) throw new Error("Failed to create chat media record.");
    return record;
  },
  getForRead(id: string) {
    const media = chatMediaRepository.getById(id);
    if (!media) return null;
    const absolutePath = validatePath(media.absolutePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
    return { ...media, absolutePath };
  },
  getForThreadRead(id: string, threadId: string, userId: number) {
    if (!threadRepository.findById(threadId, userId)) return null;
    const media = this.getForRead(id);
    return media?.threadId === threadId ? media : null;
  },
  createCleanupSnapshot(messageIds: string[]) {
    return chatMediaRepository.listByMessageIds(messageIds).map((record) => ({
      id: record.id,
      messageId: record.messageId,
      mediaType: record.mediaType as ChatMediaType,
      absolutePath: record.absolutePath,
    }));
  },

  removeCleanupSnapshot(
    records: Array<{
      id: string;
      messageId: string;
      mediaType: ChatMediaType;
      absolutePath: string;
    }>,
  ) {
    for (const record of records) {
      const absolutePath = validatePath(record.absolutePath);
      const message = messageRepository.findById(record.messageId);
      const previousMetadata = message?.metadata ?? "{}";
      const metadata = parseMetadata(previousMetadata);
      const media =
        metadata.media &&
        typeof metadata.media === "object" &&
        !Array.isArray(metadata.media)
          ? { ...(metadata.media as Record<string, unknown>) }
          : {};
      const key = mediaMetadataKey(record.mediaType);
      const entry = media[key];
      const ownsMetadataEntry =
        entry &&
        typeof entry === "object" &&
        (entry as { mediaId?: unknown }).mediaId === record.id;

      fs.rmSync(absolutePath, { force: true });
      getSqlite().transaction(() => {
        if (message && ownsMetadataEntry) {
          delete media[key];
          const updated = messageRepository.updateById(message.id, {
            metadata: JSON.stringify({ ...metadata, media }),
          });
          if (!updated) {
            throw new Error(
              "Failed to update assistant message metadata during cleanup.",
            );
          }
        }
        chatMediaRepository.deleteByIds([record.id]);
      })();
    }
  },

  removeForMessages(messageIds: string[]) {
    const records = chatMediaRepository.listByMessageIds(messageIds);
    let files = 0;
    const removableIds: string[] = [];
    const errors: Array<{ mediaId: string; message: string }> = [];
    for (const record of records) {
      try {
        const absolutePath = validatePath(record.absolutePath);
        const shouldDeleteFile = chatMediaRepository.countByPath(record.absolutePath) === 1;
        const message = messageRepository.findById(record.messageId);
        const previousMetadata = message?.metadata ?? "{}";
        const metadata = parseMetadata(previousMetadata);
        const media = metadata.media && typeof metadata.media === "object" && !Array.isArray(metadata.media)
          ? { ...(metadata.media as Record<string, unknown>) } : {};
        const key = mediaMetadataKey(record.mediaType as ChatMediaType);
        const entry = media[key];
        if (entry && typeof entry === "object" && (entry as { mediaId?: unknown }).mediaId === record.id) delete media[key];
        getSqlite().transaction(() => {
          if (message) {
            const updated = messageRepository.updateById(message.id, { metadata: JSON.stringify({ ...metadata, media }) });
            if (!updated) throw new Error("Failed to update assistant message metadata during cleanup.");
          }
          chatMediaRepository.deleteByIds([record.id]);
        })();
        try {
          if (shouldDeleteFile) { fs.rmSync(absolutePath, { force: true }); files += 1; }
          removableIds.push(record.id);
        } catch (error) {
          getSqlite().transaction(() => {
            chatMediaRepository.restore(record);
            if (message) messageRepository.updateById(message.id, { metadata: previousMetadata });
          })();
          throw error;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown media cleanup failure.";
        errors.push({ mediaId: record.id, message });
        console.error("[chat-media] failed to remove media", { mediaId: record.id, error });
      }
    }
    return { records: removableIds.length, files, failed: errors.length, errors };
  },
  removeForThread(threadId: string) {
    const records = chatMediaRepository.listByThreadId(threadId);
    return this.removeForMessages(records.map((record) => record.messageId));
  },
};
