import fs from "node:fs";

export type FileMutationFilesystem = {
  exists(targetPath: string): boolean;
  lstat(targetPath: string): fs.Stats;
  stat(targetPath: string): fs.Stats;
  realpath(targetPath: string): string;
  mkdir(targetPath: string): void;
  readFile(targetPath: string): Buffer;
  readPrefix(targetPath: string, maxBytes: number): Buffer;
  writeFileSynced(
    targetPath: string,
    content: Buffer,
    options?: { mode?: number },
  ): void;
  rename(sourcePath: string, destinationPath: string): void;
  remove(
    targetPath: string,
    options?: { recursive?: boolean; force?: boolean },
  ): void;
  rmdir(targetPath: string): void;
  unlink(targetPath: string): void;
  readdir(targetPath: string): string[];
  link(existingPath: string, newPath: string): void;
};

export const nodeFileMutationFilesystem: FileMutationFilesystem = {
  exists: (targetPath) => fs.existsSync(targetPath),
  lstat: (targetPath) => fs.lstatSync(targetPath),
  stat: (targetPath) => fs.statSync(targetPath),
  realpath: (targetPath) => fs.realpathSync.native(targetPath),
  mkdir: (targetPath) => {
    fs.mkdirSync(targetPath, { recursive: true });
  },
  readFile: (targetPath) => fs.readFileSync(targetPath),
  readPrefix: (targetPath, maxBytes) => {
    const handle = fs.openSync(targetPath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const bytesRead = fs.readSync(handle, buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      fs.closeSync(handle);
    }
  },
  writeFileSynced: (targetPath, content, options) => {
    const handle = fs.openSync(
      targetPath,
      "wx",
      options?.mode,
    );
    try {
      fs.writeFileSync(handle, content);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
  },
  rename: (sourcePath, destinationPath) => {
    fs.renameSync(sourcePath, destinationPath);
  },
  remove: (targetPath, options) => {
    fs.rmSync(targetPath, {
      recursive: options?.recursive ?? false,
      force: options?.force ?? false,
    });
  },
  rmdir: (targetPath) => {
    fs.rmdirSync(targetPath);
  },
  unlink: (targetPath) => {
    fs.unlinkSync(targetPath);
  },
  readdir: (targetPath) => fs.readdirSync(targetPath),
  link: (existingPath, newPath) => {
    fs.linkSync(existingPath, newPath);
  },
};
