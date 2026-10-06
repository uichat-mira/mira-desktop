import { isUtf8 } from "node:buffer";
import fs from "node:fs";
import fsPromises, { type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { mcpBadRequest, mcpInternalError } from "../core/errors.js";

export const DEFAULT_TERMINAL_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;
export const MAX_TERMINAL_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

const OUTPUT_WRITE_PAUSE_BYTES = 1024 * 1024;
const OUTPUT_WRITE_RESUME_BYTES = 512 * 1024;

type PersistentOutputRecord = {
  id: string;
  sessionId: string;
  command: string;
  filePath: string;
  handlePromise: Promise<FileHandle>;
  writeChain: Promise<void>;
  pendingBytes: number;
  pausedForBackpressure: boolean;
  completed: boolean;
  exitCode: number | null;
  error: Error | null;
};

const records = new Map<string, PersistentOutputRecord>();
const sessionRecords = new Map<string, Set<string>>();
const rootDir = path.join(os.tmpdir(), "uichat-mira-terminal-output");

const ensureRoot = () => {
  fs.mkdirSync(rootDir, { recursive: true });
};

const getRecord = (id: string) => {
  const record = records.get(id);
  if (!record) {
    throw mcpBadRequest("terminal output continuation not found: " + id);
  }
  return record;
};

const assertRecordHealthy = (record: PersistentOutputRecord) => {
  if (record.error) {
    throw mcpInternalError(
      "terminal output spool failed: " + record.error.message,
    );
  }
};

export const normalizeTerminalOutputLimitBytes = (value: unknown) => {
  if (value === undefined) return DEFAULT_TERMINAL_OUTPUT_LIMIT_BYTES;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw mcpBadRequest("outputLimitBytes must be a positive finite number");
  }
  return Math.min(Math.trunc(value), MAX_TERMINAL_OUTPUT_LIMIT_BYTES);
};

export const normalizeTerminalOutputOffset = (value: unknown) => {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw mcpBadRequest("outputOffset must be a non-negative integer");
  }
  return value;
};

export const createPersistentTerminalOutput = (input: {
  sessionId: string;
  command: string;
}) => {
  ensureRoot();
  const id = crypto.randomUUID();
  const filePath = path.join(rootDir, id + ".log");
  const record: PersistentOutputRecord = {
    id,
    sessionId: input.sessionId,
    command: input.command,
    filePath,
    handlePromise: fsPromises.open(filePath, "wx", 0o600),
    writeChain: Promise.resolve(),
    pendingBytes: 0,
    pausedForBackpressure: false,
    completed: false,
    exitCode: null,
    error: null,
  };
  records.set(id, record);
  const ids = sessionRecords.get(input.sessionId) ?? new Set<string>();
  ids.add(id);
  sessionRecords.set(input.sessionId, ids);
  return {
    id,
    sessionId: record.sessionId,
    command: record.command,
  };
};

export const appendPersistentTerminalOutput = (
  id: string,
  text: string,
  input?: {
    pause?: () => void;
    resume?: () => void;
  },
) => {
  if (!text) return;
  const record = getRecord(id);
  assertRecordHealthy(record);
  if (record.completed) return;

  const bytes = Buffer.from(text, "utf8");
  record.pendingBytes += bytes.byteLength;

  if (
    record.pendingBytes >= OUTPUT_WRITE_PAUSE_BYTES &&
    !record.pausedForBackpressure &&
    input?.pause &&
    input.resume
  ) {
    record.pausedForBackpressure = true;
    input.pause();
  }

  record.writeChain = record.writeChain
    .then(async () => {
      assertRecordHealthy(record);
      const handle = await record.handlePromise;
      await handle.write(bytes, 0, bytes.byteLength, null);
    })
    .catch((error) => {
      record.error =
        error instanceof Error ? error : new Error(String(error));
    })
    .finally(() => {
      record.pendingBytes = Math.max(
        0,
        record.pendingBytes - bytes.byteLength,
      );
      if (
        record.pausedForBackpressure &&
        record.pendingBytes <= OUTPUT_WRITE_RESUME_BYTES &&
        input?.resume
      ) {
        record.pausedForBackpressure = false;
        input.resume();
      }
    });
};

const flushRecord = async (record: PersistentOutputRecord) => {
  try {
    await record.handlePromise;
  } catch (error) {
    record.error =
      error instanceof Error ? error : new Error(String(error));
  }
  await record.writeChain;
  assertRecordHealthy(record);
};

export const completePersistentTerminalOutput = async (
  id: string,
  exitCode: number | null,
) => {
  const record = getRecord(id);
  if (record.completed) return;
  try {
    await flushRecord(record);
    const handle = await record.handlePromise;
    await handle.close();
  } catch (error) {
    record.error =
      error instanceof Error ? error : new Error(String(error));
  } finally {
    record.exitCode = exitCode;
    record.completed = true;
  }
};

export const readPersistentTerminalOutput = async (input: {
  id: string;
  offset?: number;
  limitBytes?: number;
}) => {
  const record = getRecord(input.id);
  const offset = normalizeTerminalOutputOffset(input.offset);
  const limitBytes = normalizeTerminalOutputLimitBytes(input.limitBytes);

  await flushRecord(record);
  const commandCompletedAtSnapshot = record.completed;
  const exitCodeAtSnapshot = record.exitCode;
  const stats = await fsPromises.stat(record.filePath);
  const availableBytes = stats.size;
  if (offset > availableBytes) {
    throw mcpBadRequest(
      "outputOffset " +
        offset +
        " exceeds available terminal output " +
        availableBytes,
    );
  }

  const requestedBytes = Math.min(limitBytes, availableBytes - offset);
  const buffer = Buffer.alloc(requestedBytes);
  if (requestedBytes > 0) {
    const handle = await fsPromises.open(record.filePath, "r");
    try {
      await handle.read(buffer, 0, requestedBytes, offset);
    } finally {
      await handle.close();
    }
  }

  let bytesToRead = requestedBytes;
  while (
    bytesToRead > 0 &&
    !isUtf8(buffer.subarray(0, bytesToRead)) &&
    requestedBytes - bytesToRead < 4
  ) {
    bytesToRead -= 1;
  }
  if (
    requestedBytes > 0 &&
    (bytesToRead === 0 || !isUtf8(buffer.subarray(0, bytesToRead)))
  ) {
    throw mcpBadRequest(
      "outputOffset must use a previous nextOutputOffset and outputLimitBytes must fit at least one UTF-8 character",
    );
  }

  const endOffset = offset + bytesToRead;
  const hasBufferedMore = endOffset < availableBytes;
  return {
    continuationId: record.id,
    sessionId: record.sessionId,
    command: record.command,
    output: buffer.subarray(0, bytesToRead).toString("utf8"),
    outputOffset: offset,
    outputEndOffset: endOffset,
    nextOutputOffset: endOffset,
    outputBytesAvailable: availableBytes,
    outputLimitBytes: limitBytes,
    truncated: hasBufferedMore,
    commandCompleted: commandCompletedAtSnapshot,
    exitCode: exitCodeAtSnapshot,
    continuationAvailable: hasBufferedMore || !commandCompletedAtSnapshot,
  };
};

const disposeRecord = async (record: PersistentOutputRecord) => {
  records.delete(record.id);
  const ids = sessionRecords.get(record.sessionId);
  ids?.delete(record.id);
  if (ids && ids.size === 0) sessionRecords.delete(record.sessionId);

  await record.writeChain;
  try {
    const handle = await record.handlePromise;
    await handle.close().catch(() => undefined);
  } catch {
    // The output file may have failed before a handle was created.
  }
  await fsPromises.rm(record.filePath, { force: true }).catch(() => undefined);
};

export const clearPersistentTerminalOutput = async (id: string) => {
  const record = records.get(id);
  if (!record) return;
  await disposeRecord(record);
};

export const clearPersistentTerminalOutputsForSession = async (
  sessionId: string,
) => {
  const ids = [...(sessionRecords.get(sessionId) ?? [])];
  await Promise.all(ids.map((id) => clearPersistentTerminalOutput(id)));
};

export const clearAllPersistentTerminalOutputs = async () => {
  await Promise.all(
    [...records.keys()].map((id) => clearPersistentTerminalOutput(id)),
  );
};
