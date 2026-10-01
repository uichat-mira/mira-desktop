import fs from "node:fs";
import path from "node:path";
import {
  chatWorkspaceRepository,
  conversationArtifactRepository,
  threadRepository,
} from "@/db/repositories/index.js";
import { nowIso } from "@/utils/time.js";
import { privateAgentWorkspaceService } from "./agent-workspace.service.js";

export type ConversationArtifactLifecycle = "temporary" | "final";
export type ConversationArtifactErrorCode =
  | "invalid_ownership"
  | "invalid_source"
  | "missing_source"
  | "stale_reference"
  | "unsupported_absolute_path"
  | "path_escape"
  | "containment_failure";

export class ConversationArtifactError extends Error {
  constructor(
    readonly code: ConversationArtifactErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConversationArtifactError";
  }
}

export interface ConversationArtifactReference {
  id: string;
  threadId: string;
  sourceRelativePath: string;
  lifecycle: ConversationArtifactLifecycle;
  mimeType?: string | null;
}

const fail = (
  code: ConversationArtifactErrorCode,
  message: string,
): never => {
  throw new ConversationArtifactError(code, message);
};

const samePath = (left: string, right: string) => {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
};

const toReference = (row: {
  id: string;
  threadId: string;
  sourceRootPath: string;
  sourceRelativePath: string;
  lifecycle: ConversationArtifactLifecycle;
  mimeType: string | null;
}): ConversationArtifactReference => ({
  id: row.id,
  threadId: row.threadId,
  sourceRelativePath: row.sourceRelativePath,
  lifecycle: row.lifecycle,
  mimeType: row.mimeType,
});

const validateRelativeSource = (sourceRelativePath: string) => {
  if (
    !sourceRelativePath ||
    path.isAbsolute(sourceRelativePath) ||
    path.win32.isAbsolute(sourceRelativePath)
  ) {
    fail(
      path.isAbsolute(sourceRelativePath) ||
        path.win32.isAbsolute(sourceRelativePath)
        ? "unsupported_absolute_path"
        : "invalid_source",
      "Artifact source must be a non-empty relative path",
    );
  }

  const normalized = path.posix.normalize(
    sourceRelativePath.replaceAll("\\", "/"),
  );
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    fail("path_escape", "Artifact source escapes its frozen workspace root");
  }
  return normalized;
};

const isParentPath = (relative: string) =>
  relative === ".." || relative.startsWith(`..${path.sep}`);

const resolveCanonicalRoot = (
  rootPath: string,
  missingCode: ConversationArtifactErrorCode,
): string => {
  if (!rootPath.trim() || !path.isAbsolute(rootPath)) {
    fail("invalid_source", "Artifact source root must be an absolute path");
  }

  try {
    const stat = fs.statSync(rootPath);
    if (!stat.isDirectory()) {
      fail("containment_failure", "Artifact source root is not a directory");
    }
    return fs.realpathSync(rootPath);
  } catch (error) {
    if (error instanceof ConversationArtifactError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fail(missingCode, "Artifact source root is missing");
    }
    return fail(
      "containment_failure",
      "Artifact source root cannot be resolved",
    );
  }
};

const resolveSource = (rootPath: string, relative: string) => {
  const canonicalRoot = resolveCanonicalRoot(rootPath, "stale_reference");
  const candidate = path.resolve(canonicalRoot, relative);
  const contained = path.relative(canonicalRoot, candidate);
  if (
    !contained ||
    isParentPath(contained) ||
    path.isAbsolute(contained)
  ) {
    fail("path_escape", "Artifact source escapes its frozen workspace root");
  }

  let real = "";
  try {
    real = fs.realpathSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail("missing_source", "Artifact source is missing");
    }
    fail("containment_failure", "Artifact source cannot be resolved");
  }

  const realRelative = path.relative(canonicalRoot, real);
  if (
    !realRelative ||
    isParentPath(realRelative) ||
    path.isAbsolute(realRelative)
  ) {
    fail(
      "containment_failure",
      "Artifact source is outside its frozen workspace root",
    );
  }
  return { absolutePath: real, canonicalRoot };
};

const assertRegistrationRootOwned = (input: {
  threadId: string;
  userId: number;
  sourceRootPath: string;
}) => {
  const thread =
    threadRepository.findById(input.threadId, input.userId) ??
    fail("invalid_ownership", "Artifact owner thread does not belong to user");
  const canonicalRoot = resolveCanonicalRoot(
    input.sourceRootPath,
    "missing_source",
  );

  if (
    privateAgentWorkspaceService.isExpectedRoot({
      threadId: input.threadId,
      userId: input.userId,
      rootPath: canonicalRoot,
    })
  ) {
    return canonicalRoot;
  }

  const workspaceId = thread.workspaceId;
  if (!workspaceId) {
    return fail(
      "invalid_ownership",
      "Artifact source root does not belong to this Agent conversation",
    );
  }

  const workspace = chatWorkspaceRepository.findById(
    workspaceId,
    input.userId,
  );
  if (!workspace?.rootPath || !samePath(workspace.rootPath, canonicalRoot)) {
    fail(
      "invalid_ownership",
      "Artifact source root does not match the thread's explicit Workspace",
    );
  }

  return canonicalRoot;
};

export const conversationArtifactService = {
  register(input: {
    id?: string;
    threadId: string;
    userId: number;
    sourceRootPath: string;
    sourceRelativePath: string;
    lifecycle: ConversationArtifactLifecycle;
    mimeType?: string | null;
  }): ConversationArtifactReference {
    const sourceRootPath = assertRegistrationRootOwned(input);
    const relative = validateRelativeSource(input.sourceRelativePath);
    if (input.lifecycle === "temporary") {
      fail(
        "invalid_source",
        "Temporary execution files cannot be registered as final artifacts",
      );
    }

    resolveSource(sourceRootPath, relative);
    const now = nowIso();
    return toReference(
      conversationArtifactRepository.create({
        id: input.id ?? `artifact-${crypto.randomUUID()}`,
        threadId: input.threadId,
        userId: input.userId,
        sourceRootPath,
        sourceRelativePath: relative,
        lifecycle: input.lifecycle,
        mimeType: input.mimeType ?? null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  },

  resolve(input: {
    id: string;
    threadId: string;
    userId: number;
  }): {
    reference: ConversationArtifactReference;
    absolutePath: string;
  } {
    const row =
      conversationArtifactRepository.findById(input.id, input.userId) ??
      fail(
        "invalid_ownership",
        "Artifact ownership does not match the requested thread",
      );

    if (row.threadId !== input.threadId) {
      fail(
        "invalid_ownership",
        "Artifact ownership does not match the requested thread",
      );
    }

    const relative = validateRelativeSource(row.sourceRelativePath);
    if (relative !== row.sourceRelativePath) {
      fail("invalid_source", "Artifact source identity is not canonical");
    }

    const resolved = resolveSource(row.sourceRootPath, relative);
    return {
      reference: {
        ...toReference(row),
        sourceRelativePath: relative,
      },
      absolutePath: resolved.absolutePath,
    };
  },
};
