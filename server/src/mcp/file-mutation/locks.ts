import path from "node:path";
import { mcpBadRequest } from "../core/errors.js";

const lockTails = new Map<string, Promise<void>>();

export const normalizeMutationLockKey = (value: string) => {
  const normalized = path.normalize(path.resolve(value)).normalize("NFC");
  return process.platform === "win32" || process.platform === "darwin"
    ? normalized.toLowerCase()
    : normalized;
};

const waitForTurn = async (
  previous: Promise<void>,
  signal?: AbortSignal,
) => {
  if (!signal) {
    await previous;
    return;
  }
  if (signal.aborted) {
    throw mcpBadRequest("file mutation was cancelled before commit");
  }

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(mcpBadRequest("file mutation was cancelled before commit"));
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    previous.then(
      () => {
        cleanup();
        resolve();
      },
      () => {
        cleanup();
        resolve();
      },
    );
  });
};

const acquireMutationLock = async (
  rawKey: string,
  signal?: AbortSignal,
) => {
  const key = normalizeMutationLockKey(rawKey);
  const previous = lockTails.get(key) ?? Promise.resolve();

  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const tail = previous.then(() => gate);
  lockTails.set(key, tail);
  void tail.finally(() => {
    if (lockTails.get(key) === tail) {
      lockTails.delete(key);
    }
  });

  try {
    await waitForTurn(previous, signal);
  } catch (error) {
    releaseGate();
    throw error;
  }

  if (signal?.aborted) {
    releaseGate();
    throw mcpBadRequest("file mutation was cancelled before commit");
  }

  return releaseGate;
};

export type MutationLockScope = ReadonlySet<string>;

export const normalizeMutationLockKeys = (rawKeys: string[]) =>
  [...new Set(rawKeys.map(normalizeMutationLockKey))].sort((left, right) =>
    left.localeCompare(right),
  );

export const withMutationLocks = async <T>(
  rawKeys: string[],
  signal: AbortSignal | undefined,
  run: (scope: MutationLockScope) => Promise<T> | T,
): Promise<T> => {
  const keys = normalizeMutationLockKeys(rawKeys);
  const releases: Array<() => void> = [];

  try {
    for (const key of keys) {
      releases.push(await acquireMutationLock(key, signal));
    }
    return await run(new Set(keys));
  } finally {
    for (const release of releases.reverse()) {
      release();
    }
  }
};
