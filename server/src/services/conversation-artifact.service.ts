import fs from "node:fs";
import path from "node:path";
import { conversationArtifactRepository, conversationWorkdirRepository, threadRepository } from "@/db/repositories/index.js";
import { nowIso } from "@/utils/time.js";
import { conversationWorkdirService, ConversationWorkdirError } from "./conversation-workdir.service.js";

export type ConversationArtifactLifecycle = "temporary" | "final";
export type ConversationArtifactErrorCode = "invalid_ownership" | "invalid_source" | "missing_source" | "stale_reference" | "unsupported_absolute_path" | "path_escape" | "containment_failure";
export class ConversationArtifactError extends Error { constructor(readonly code: ConversationArtifactErrorCode, message: string) { super(message); this.name = "ConversationArtifactError"; } }
export interface ConversationArtifactReference { id: string; threadId: string; workdirId: string; sourceRelativePath: string; lifecycle: ConversationArtifactLifecycle; mimeType?: string | null; }

const fail = (code: ConversationArtifactErrorCode, message: string): never => { throw new ConversationArtifactError(code, message); };
const toReference = (row: any): ConversationArtifactReference => ({ id: row.id, threadId: row.threadId, workdirId: row.workdirId, sourceRelativePath: row.sourceRelativePath, lifecycle: row.lifecycle, mimeType: row.mimeType });

const validateRelativeSource = (sourceRelativePath: string) => {
  if (!sourceRelativePath || path.isAbsolute(sourceRelativePath) || path.win32.isAbsolute(sourceRelativePath)) fail(path.isAbsolute(sourceRelativePath) || path.win32.isAbsolute(sourceRelativePath) ? "unsupported_absolute_path" : "invalid_source", "Artifact source must be a non-empty relative path");
  const normalized = path.posix.normalize(sourceRelativePath.replaceAll("\\", "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) fail("path_escape", "Artifact source escapes the conversation workdir");
  return normalized;
};

const isParentPath = (relative: string) => relative === ".." || relative.startsWith(`..${path.sep}`);

const mapWorkdirReferenceFailure = (error: unknown): never | undefined => {
  if (!(error instanceof ConversationWorkdirError)) return undefined;
  if (error.code === "path_escape" || error.code === "linked_path") {
    fail("containment_failure", `Artifact workdir cannot be reopened: ${error.message}`);
  }
  if (error.code === "missing" || error.code === "identity_conflict") {
    fail("stale_reference", `Artifact workdir cannot be reopened: ${error.message}`);
  }
  return undefined;
};

const resolveSource = (rootPath: string, relative: string) => {
  const candidate = path.resolve(rootPath, relative);
  const contained = path.relative(rootPath, candidate);
  if (!contained || isParentPath(contained) || path.isAbsolute(contained)) fail("path_escape", "Artifact source escapes the conversation workdir");
  let real = "";
  try { real = fs.realpathSync(candidate); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("missing_source", "Artifact source is missing"); fail("containment_failure", "Artifact source cannot be resolved"); }
  const realRelative = path.relative(rootPath, real);
  if (!realRelative || isParentPath(realRelative) || path.isAbsolute(realRelative)) fail("containment_failure", "Artifact source is outside the conversation workdir");
  return real;
};

export const conversationArtifactService = {
  register(input: { id?: string; threadId: string; userId: number; storageRoot?: string; sourceRelativePath: string; lifecycle: ConversationArtifactLifecycle; mimeType?: string | null }): ConversationArtifactReference {
    const thread = threadRepository.findById(input.threadId, input.userId);
    if (!thread) fail("invalid_ownership", "Artifact owner thread does not belong to user");
    const workdir = conversationWorkdirRepository.findByThreadId(input.threadId, input.userId) ?? fail("invalid_ownership", "Artifact owner workdir is missing");
    const relative = validateRelativeSource(input.sourceRelativePath);
    if (input.lifecycle === "temporary") fail("invalid_source", "Temporary execution files cannot be registered as final artifacts");
    const activeWorkdir = (() => {
      try {
        return conversationWorkdirService.reopen({
          threadId: input.threadId,
          userId: input.userId,
          storageRoot: input.storageRoot,
          reference: { id: workdir.id, threadId: workdir.threadId, rootPath: workdir.rootPath },
        });
      } catch (error) {
        mapWorkdirReferenceFailure(error);
        throw error;
      }
    })();
    resolveSource(activeWorkdir.rootPath, relative);
    const now = nowIso();
    return toReference(conversationArtifactRepository.create({ id: input.id ?? `artifact-${crypto.randomUUID()}`, threadId: input.threadId, userId: input.userId, workdirId: activeWorkdir.id, sourceRelativePath: relative, lifecycle: input.lifecycle, mimeType: input.mimeType ?? null, createdAt: now, updatedAt: now }));
  },
  resolve(input: { id: string; threadId: string; userId: number; storageRoot?: string }): { reference: ConversationArtifactReference; absolutePath: string } {
    const row = conversationArtifactRepository.findById(input.id, input.userId) ?? fail("invalid_ownership", "Artifact ownership does not match the requested thread");
    if (row.threadId !== input.threadId) fail("invalid_ownership", "Artifact ownership does not match the requested thread");
    const persistedWorkdir = conversationWorkdirRepository.findByThreadId(input.threadId, input.userId) ?? fail("stale_reference", "Artifact workdir reference is stale");
    const workdir = (() => {
      try {
        return conversationWorkdirService.reopen({ threadId: input.threadId, userId: input.userId, storageRoot: input.storageRoot, reference: { id: row.workdirId, threadId: row.threadId, rootPath: persistedWorkdir.rootPath } });
      } catch (error) {
        mapWorkdirReferenceFailure(error);
        throw error;
      }
    })();
    if (workdir.id !== row.workdirId) fail("stale_reference", "Artifact workdir reference is stale");
    return { reference: toReference(row), absolutePath: resolveSource(workdir.rootPath, row.sourceRelativePath) };
  },
};
