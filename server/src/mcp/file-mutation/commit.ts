import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileMutationFilesystem } from "./filesystem.js";

const createSiblingScratchPath = (
  targetPath: string,
  label: "backup" | "write",
) =>
  path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.mira-${label}-${process.pid}-${randomUUID()}`,
  );

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const commitFileBuffer = (input: {
  targetPath: string;
  content: Buffer;
  overwrite: boolean;
  filesystem: FileMutationFilesystem;
}) => {
  const { targetPath, content, overwrite, filesystem } = input;
  const tempPath = createSiblingScratchPath(targetPath, "write");
  const existingMode = overwrite
    ? filesystem.stat(targetPath).mode
    : undefined;

  filesystem.writeFileSynced(tempPath, content, {
    ...(existingMode === undefined ? {} : { mode: existingMode }),
  });

  try {
    if (overwrite) {
      // Same-directory temp + fsync + rename mirrors the established
      // write-file-atomic commit strategy without delete-first replacement.
      filesystem.rename(tempPath, targetPath);
      return;
    }

    // Publish create-only writes with a hard link so a target that appears
    // after preflight is never silently replaced by rename semantics.
    filesystem.link(tempPath, targetPath);
    filesystem.unlink(tempPath);
  } finally {
    if (filesystem.exists(tempPath)) {
      filesystem.remove(tempPath, { recursive: false, force: true });
    }
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
