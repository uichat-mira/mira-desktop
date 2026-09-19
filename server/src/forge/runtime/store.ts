import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  FORGE_RUNTIME_SCHEMA_VERSION,
  createEmptyForgeRuntimeState,
  type ForgeRuntimeState,
} from "./state.js";

const RUNTIME_ARRAY_FIELDS = [
  "adapters",
  "sessions",
  "reviews",
  "dispatches",
  "events",
  "threads",
  "threadEvents",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeForgeRuntimeState(parsed: unknown): ForgeRuntimeState {
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== FORGE_RUNTIME_SCHEMA_VERSION ||
    !Array.isArray(parsed.projects) ||
    !Array.isArray(parsed.batches)
  ) {
    throw new Error("Unsupported or invalid Mira Forge state file");
  }

  for (const field of RUNTIME_ARRAY_FIELDS) {
    if (parsed[field] !== undefined && !Array.isArray(parsed[field])) {
      throw new Error("Unsupported or invalid Mira Forge state file");
    }
  }

  return {
    ...parsed,
    schemaVersion: FORGE_RUNTIME_SCHEMA_VERSION,
    projects: parsed.projects,
    batches: parsed.batches,
    adapters: (parsed.adapters ?? []) as ForgeRuntimeState["adapters"],
    sessions: (parsed.sessions ?? []) as ForgeRuntimeState["sessions"],
    reviews: (parsed.reviews ?? []) as ForgeRuntimeState["reviews"],
    dispatches: (parsed.dispatches ?? []) as ForgeRuntimeState["dispatches"],
    events: (parsed.events ?? []) as ForgeRuntimeState["events"],
    threads: (parsed.threads ?? []) as ForgeRuntimeState["threads"],
    threadEvents: (parsed.threadEvents ?? []) as ForgeRuntimeState["threadEvents"],
  } as ForgeRuntimeState;
}

export interface ForgeRuntimeStore {
  readonly filePath: string;
  read(): Promise<ForgeRuntimeState>;
  write(state: ForgeRuntimeState): Promise<ForgeRuntimeState>;
  mutate<T>(
    mutator: (state: ForgeRuntimeState) => T | Promise<T>,
  ): Promise<T extends void ? ForgeRuntimeState : T>;
  flush(): Promise<void>;
}

export function createForgeRuntimeStore(filePath: string): ForgeRuntimeStore {
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<ForgeRuntimeState> {
    try {
      const raw = await readFile(filePath, "utf8");
      return normalizeForgeRuntimeState(JSON.parse(raw) as unknown);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return createEmptyForgeRuntimeState();
      }
      throw error;
    }
  }

  async function write(state: ForgeRuntimeState): Promise<ForgeRuntimeState> {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
    return state;
  }

  function mutate<T>(
    mutator: (state: ForgeRuntimeState) => T | Promise<T>,
  ): Promise<T extends void ? ForgeRuntimeState : T> {
    const operation = queue.then(async () => {
      const state = await read();
      const result = await mutator(state);
      await write(state);
      return result === undefined ? state : result;
    });
    queue = operation.catch(() => undefined);
    return operation as Promise<T extends void ? ForgeRuntimeState : T>;
  }

  async function flush(): Promise<void> {
    await queue;
  }

  return {
    filePath,
    read,
    write,
    mutate,
    flush,
  };
}
