import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileMutationFilesystem } from "./filesystem.js";

const createSiblingScratchPath = (
  targetPath: string,
  label: "backup" | "write" | "rename",
) =>
  path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.mira-${label}-${process.pid}-${randomUUID()}`,
  );

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const commitFileBuffer = async (input: {
  targetPath: string;
  content: Buffer;
  overwrite: boolean;
  filesystem: FileMutationFilesystem;
}) => {
  const { targetPath, content, overwrite, filesystem } = input;
  const scratchPath = createSiblingScratchPath(targetPath, "write");
  const existingMode = overwrite
    ? filesystem.stat(targetPath).mode
    : undefined;

  // Delegate durable scratch-file writing to write-file-atomic. The library is
  // intentionally not given targetPath: it realpaths its target, while Mira's
  // mutation policy must stay authoritative over final symlink/path semantics.
  await filesystem.writeAtomic(scratchPath, content, {
    ...(existingMode === undefined ? {} : { mode: existingMode }),
  });

  try {
    if (overwrite) {
      // Same-directory rename replaces the directory entry without a
      // delete-first window. A failed rename leaves the old target in place.
      filesystem.rename(scratchPath, targetPath);
      return;
    }

    // Create-only publish must never replace a path that appeared after
    // preflight. Hard-link creation is exclusive and fails if targetPath exists.
    filesystem.link(scratchPath, targetPath);
  } finally {
    if (filesystem.exists(scratchPath)) {
      filesystem.remove(scratchPath, { recursive: false, force: true });
    }
  }
};

export const renameCaseOnlySafely = (input: {
  sourcePath: string;
  destinationPath: string;
  filesystem: FileMutationFilesystem;
}) => {
  const { sourcePath, destinationPath, filesystem } = input;
  const scratchPath = createSiblingScratchPath(sourcePath, "rename");
  filesystem.rename(sourcePath, scratchPath);

  try {
    filesystem.rename(scratchPath, destinationPath);
  } catch (commitError) {
    try {
      filesystem.rename(scratchPath, sourcePath);
    } catch (rollbackError) {
      throw new Error(
        `case-only rename failed and rollback also failed: commit=${errorMessage(commitError)}; rollback=${errorMessage(rollbackError)}; scratch=${scratchPath}`,
      );
    }
    throw commitError;
  }
};

export const replaceDirectorySafely = (input: {
  sourcePath: string;
  destinationPath: string;
  filesystem: FileMutationFilesystem;
}) => {
  const { sourcePath, destinationPath, filesystem } = input;
  const backupPath = createSiblingScratchPath(destinationPath, "backup");
  filesystem.rename(destinationPath, backupPath);

  try {
    filesystem.rename(sourcePath, destinationPath);
  } catch (commitError) {
    try {
      filesystem.rename(backupPath, destinationPath);
    } catch (rollbackError) {
      throw new Error(
        `directory replacement failed and rollback also failed: commit=${errorMessage(commitError)}; rollback=${errorMessage(rollbackError)}; backup=${backupPath}`,
      );
    }
    throw commitError;
  }

  try {
    filesystem.remove(backupPath, { recursive: true, force: false });
  } catch (cleanupError) {
    try {
      filesystem.rename(destinationPath, sourcePath);
      filesystem.rename(backupPath, destinationPath);
    } catch (rollbackError) {
      throw new Error(
        `directory replacement committed but cleanup and rollback failed: cleanup=${errorMessage(cleanupError)}; rollback=${errorMessage(rollbackError)}; backup=${backupPath}`,
      );
    }
    throw cleanupError;
  }
};
